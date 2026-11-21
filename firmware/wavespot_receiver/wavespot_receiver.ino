// WaveSpot 수신기 펌웨어 (ESP32)
// 설치형(R1~R4)과 휴대형(H1~)이 같은 코드를 쓰고, WS_ROLE_HANDHELD 로 구분한다.
//
// 하는 일
//  1) BLE 광고를 계속 듣고(수동 스캔), 기기별로 세기 평균 · 흔들림 · 광고 간격 · 제조사 번호를 모은다.
//  2) Wi-Fi 감청 모드로 데이터 프레임의 길이 · 시각 · 방향만 재고(내용은 보지 않음), 10초마다
//     backend/app/ml/wifi_sim.py 의 FEATS 12개와 같은 특징을 계산한다.
//  3) 1초마다 MQTT 로 보낸다. 토픽 · 내용은 docs/API.md 'MQTT' 절과 같다.
//       wavespot/devices/{device_id}/{node_id}   {"rssi":-67.0,"rssiVar":4.1,"company":"0x004C","interval":104}
//       wavespot/devices/{device_id}/{node_id}   {"rssi":-58.0,"wifi":true,"wifi_feat":{...}}   (Wi-Fi 기기)
//       wavespot/rooms/{node_id}/status          online | offline (retain, 5초 생존 신호, 끊기면 LWT 로 offline)
//       wavespot/handheld/{device_id}/{node_id}  휴대형 수신기 측정 (WS_ROLE_HANDHELD=1)
//
// 개인정보: MAC 주소는 회차별 키(WS_HASH_KEY)와 함께 SHA-256 으로 해시해 앞 6바이트만 device_id 로 보낸다.
//           원본 주소 · 패킷 내용은 저장하거나 보내지 않는다.
//
// 라이브러리: NimBLE-Arduino 1.4.x (Apache-2.0), PubSubClient 2.8 (MIT), Arduino-ESP32 core 2.x (LGPL-2.1),
//             mbedTLS (Apache-2.0, ESP32 core 에 포함)

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <NimBLEDevice.h>
#include <math.h>
#include <string.h>
#include "esp_wifi.h"
#include "mbedtls/sha256.h"
#include "config.h"

// ESP32 Arduino core 3.x(ESP-IDF 5) 에서는 mbedTLS 의 *_ret 함수 이름이 바뀜
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
#define WS_SHA_START(c)      mbedtls_sha256_starts(c, 0)
#define WS_SHA_UPDATE(c,d,n) mbedtls_sha256_update(c, d, n)
#define WS_SHA_FINISH(c,o)   mbedtls_sha256_finish(c, o)
#else
#define WS_SHA_START(c)      mbedtls_sha256_starts_ret(c, 0)
#define WS_SHA_UPDATE(c,d,n) mbedtls_sha256_update_ret(c, d, n)
#define WS_SHA_FINISH(c,o)   mbedtls_sha256_finish_ret(c, o)
#endif

#ifndef WS_ROLE_HANDHELD
#define WS_ROLE_HANDHELD 0
#endif
#ifndef WS_ENABLE_WIFI_SNIFF
#define WS_ENABLE_WIFI_SNIFF 1
#endif

// ---------- 설정값 ----------
static const uint32_t PUBLISH_MS   = WS_ROLE_HANDHELD ? 500 : 1000;  // 측정값 송출 주기
static const uint32_t WIFI_WIN_MS  = 10000;                          // Wi-Fi 특징 창 (backend window_seconds)
static const uint32_t STATUS_MS    = 5000;                           // 생존 신호 (설계안 10장)
static const uint32_t FORGET_MS    = 60000;                          // 60초 안 들리면 표에서 지움
static const int      MAX_BLE      = 96;
static const int      MAX_WIFI     = 32;
static const int      IAT_BINS     = 24;                             // 프레임 간격 로그 히스토그램 (1us ~ 16s)

// ---------- 공용 ----------
static portMUX_TYPE gMux = portMUX_INITIALIZER_UNLOCKED;
static WiFiClient gNet;
static PubSubClient gMqtt(gNet);
static char gStatusTopic[64];
static uint8_t gSelfMac[6];

static void hashId(const uint8_t* mac, char out[13]) {
  // device_id = SHA-256(회차 키 || MAC) 앞 6바이트 (12자리 16진수)
  uint8_t digest[32];
  mbedtls_sha256_context ctx;
  mbedtls_sha256_init(&ctx);
  WS_SHA_START(&ctx);
  WS_SHA_UPDATE(&ctx, (const unsigned char*)WS_HASH_KEY, strlen(WS_HASH_KEY));
  WS_SHA_UPDATE(&ctx, mac, 6);
  WS_SHA_FINISH(&ctx, digest);
  mbedtls_sha256_free(&ctx);
  static const char* hx = "0123456789abcdef";
  for (int i = 0; i < 6; i++) { out[i * 2] = hx[digest[i] >> 4]; out[i * 2 + 1] = hx[digest[i] & 0x0f]; }
  out[12] = 0;
}

// ======================================================================
// BLE
// ======================================================================
struct BleDev {
  bool used;
  uint8_t mac[6];
  char id[13];
  float rssiSum, rssiSq;   // 이번 송출 주기 누적
  uint16_t n;
  uint32_t lastAdvMs;      // 직전 광고 수신 시각
  uint32_t minGapMs;       // 이번 주기 최소 광고 간격 (스캔이 놓친 광고 때문에 평균보다 최솟값이 실제 간격에 가까움)
  float intervalMs;        // 최소 간격의 지수 평균
  uint16_t company;        // 제조사 번호 (없으면 0xFFFF)
  uint32_t lastSeenMs;
};
static BleDev gBle[MAX_BLE];

static BleDev* bleSlot(const uint8_t* mac, uint32_t now) {
  int freeIdx = -1, oldest = -1; uint32_t oldestT = UINT32_MAX;
  for (int i = 0; i < MAX_BLE; i++) {
    if (gBle[i].used) {
      if (memcmp(gBle[i].mac, mac, 6) == 0) return &gBle[i];
      if (gBle[i].lastSeenMs < oldestT) { oldestT = gBle[i].lastSeenMs; oldest = i; }
    } else if (freeIdx < 0) freeIdx = i;
  }
  int k = freeIdx >= 0 ? freeIdx : oldest;   // 표가 가득 차면 가장 오래 안 들린 기기를 밀어냄
  BleDev& d = gBle[k];
  memset(&d, 0, sizeof(d));
  d.used = true; memcpy(d.mac, mac, 6); d.company = 0xFFFF; d.minGapMs = UINT32_MAX; d.lastSeenMs = now;
  return &d;
}

class AdvCallbacks : public NimBLEAdvertisedDeviceCallbacks {
  void onResult(NimBLEAdvertisedDevice* adv) override {
    NimBLEAddress addr = adv->getAddress();   // 임시 객체의 포인터를 쓰지 않도록 복사해 둠
    const uint8_t* mac = addr.getNative();
    int rssi = adv->getRSSI();
    uint16_t company = 0xFFFF;
    if (adv->haveManufacturerData()) {
      std::string md = adv->getManufacturerData();
      if (md.size() >= 2) company = (uint8_t)md[0] | ((uint16_t)(uint8_t)md[1] << 8);
    }
    uint32_t now = millis();
    portENTER_CRITICAL(&gMux);
    BleDev* d = bleSlot(mac, now);
    if (d->lastAdvMs) {
      uint32_t gap = now - d->lastAdvMs;
      if (gap >= 15 && gap < 3000 && gap < d->minGapMs) d->minGapMs = gap;
    }
    d->lastAdvMs = now; d->lastSeenMs = now;
    d->rssiSum += rssi; d->rssiSq += (float)rssi * rssi; d->n++;
    if (company != 0xFFFF) d->company = company;
    portEXIT_CRITICAL(&gMux);
  }
};

static void startBleScan() {
  NimBLEDevice::init("");
  NimBLEScan* scan = NimBLEDevice::getScan();
  scan->setAdvertisedDeviceCallbacks(new AdvCallbacks(), true);  // true = 같은 기기 광고도 매번 받음
  scan->setActiveScan(false);       // 수동 스캔: 기기에 아무것도 보내지 않고 듣기만 함
  scan->setDuplicateFilter(false);
  scan->setMaxResults(0);           // 결과 목록을 메모리에 쌓지 않음
  scan->setInterval(100);
  scan->setWindow(WS_ENABLE_WIFI_SNIFF ? 70 : 99);  // Wi-Fi 와 무선을 나눠 쓰므로 창을 조금 줄임
  scan->start(0, nullptr, false);   // 0 = 끝없이
}

// ======================================================================
// Wi-Fi 감청 (데이터 프레임의 길이 · 시각 · 방향만)
// ======================================================================
struct WifiDev {
  bool used;
  uint8_t mac[6];
  char id[13];
  // 10초 창 통계 (wifi_sim.features 와 같은 정의)
  uint32_t n, nLarge, nSmall;
  double upBytes, dnBytes, sumSz, sumSz2;
  uint32_t lastUs;
  uint32_t iatN; double iatSum, iatSum2;
  uint16_t iatHist[IAT_BINS];
  uint32_t secBytes[10];
  // 송출 주기 세기
  float rssiSum; uint16_t rssiN;
  uint32_t lastSeenMs;
};
static WifiDev gWifi[MAX_WIFI];
static volatile uint32_t gWinStartMs = 0;

static WifiDev* wifiSlot(const uint8_t* mac, uint32_t now) {
  int freeIdx = -1, oldest = -1; uint32_t oldestT = UINT32_MAX;
  for (int i = 0; i < MAX_WIFI; i++) {
    if (gWifi[i].used) {
      if (memcmp(gWifi[i].mac, mac, 6) == 0) return &gWifi[i];
      if (gWifi[i].lastSeenMs < oldestT) { oldestT = gWifi[i].lastSeenMs; oldest = i; }
    } else if (freeIdx < 0) freeIdx = i;
  }
  int k = freeIdx >= 0 ? freeIdx : oldest;
  WifiDev& d = gWifi[k];
  memset(&d, 0, sizeof(d));
  d.used = true; memcpy(d.mac, mac, 6); d.lastSeenMs = now;
  return &d;
}

static void snifferCb(void* buf, wifi_promiscuous_pkt_type_t type) {
  if (type != WIFI_PKT_DATA) return;
  const wifi_promiscuous_pkt_t* p = (const wifi_promiscuous_pkt_t*)buf;
  const uint8_t* f = p->payload;
  uint16_t len = p->rx_ctrl.sig_len;
  if (len < 24) return;
  bool toDS = f[1] & 0x01, fromDS = f[1] & 0x02;
  const uint8_t* sta; bool up;
  if (toDS && !fromDS) { sta = f + 10; up = true; }   // 기기 → AP : addr2 가 기기 (상향)
  else if (!toDS && fromDS) { sta = f + 4; up = false; }  // AP → 기기 : addr1 이 기기 (하향)
  else return;
  if (sta[0] & 0x01) return;                          // 멀티캐스트 · 브로드캐스트 제외
  if (memcmp(sta, gSelfMac, 6) == 0) return;          // 수신기 자신의 통신 제외

  uint32_t nowUs = micros(), nowMs = millis();
  portENTER_CRITICAL(&gMux);
  WifiDev* d = wifiSlot(sta, nowMs);
  d->n++;
  if (up) d->upBytes += len; else d->dnBytes += len;
  d->sumSz += len; d->sumSz2 += (double)len * len;
  if (len > 1000) d->nLarge++;
  if (len < 250) d->nSmall++;
  if (d->lastUs) {
    uint32_t iat = nowUs - d->lastUs;
    d->iatN++; d->iatSum += iat; d->iatSum2 += (double)iat * iat;
    int b = 0; while ((1UL << b) < iat && b < IAT_BINS - 1) b++;
    d->iatHist[b]++;
  }
  d->lastUs = nowUs;
  uint32_t sec = (nowMs - gWinStartMs) / 1000; if (sec > 9) sec = 9;
  d->secBytes[sec] += len;
  d->rssiSum += p->rx_ctrl.rssi; d->rssiN++;
  d->lastSeenMs = nowMs;
  portEXIT_CRITICAL(&gMux);
}

static void startSniffer() {
#if WS_ENABLE_WIFI_SNIFF
  wifi_promiscuous_filter_t flt = { .filter_mask = WIFI_PROMIS_FILTER_MASK_DATA };
  esp_wifi_set_promiscuous_filter(&flt);
  esp_wifi_set_promiscuous_rx_cb(&snifferCb);
  esp_wifi_set_promiscuous(true);   // 연결된 AP 의 채널만 감청됨
#endif
}

// 한 창의 특징 계산 (backend/app/ml/wifi_sim.py features() 와 같은 이름 · 단위)
struct WifiFeat { float up_kbps, dn_kbps, pps, up_ratio, mean_size, std_size, frac_large, frac_small, iat_med, iat_cv, burst, active_s; };

static WifiFeat wifiFeatures(const WifiDev& d, float W) {
  WifiFeat o; memset(&o, 0, sizeof(o));
  o.up_kbps = d.upBytes * 8.0 / W / 1e3;
  o.dn_kbps = d.dnBytes * 8.0 / W / 1e3;
  o.pps = d.n / W;
  double tot = d.upBytes + d.dnBytes;
  o.up_ratio = d.upBytes / (tot > 1 ? tot : 1);
  if (d.n) {
    double m = d.sumSz / d.n;
    o.mean_size = m;
    double v = d.sumSz2 / d.n - m * m; o.std_size = v > 0 ? sqrt(v) : 0;
    o.frac_large = (float)d.nLarge / d.n;
    o.frac_small = (float)d.nSmall / d.n;
  }
  if (d.iatN >= 2) {
    // 중앙값: 로그 히스토그램에서 절반이 넘는 칸의 기하 중심 (초)
    uint32_t half = (d.iatN + 1) / 2, acc = 0; int b = 0;
    for (; b < IAT_BINS; b++) { acc += d.iatHist[b]; if (acc >= half) break; }
    double lo = b == 0 ? 1.0 : (double)(1UL << (b - 1)), hi = (double)(1UL << b);
    o.iat_med = sqrt(lo * hi) / 1e6;
    double mean = d.iatSum / d.iatN, var = d.iatSum2 / d.iatN - mean * mean;
    o.iat_cv = (var > 0 ? sqrt(var) : 0) / (mean > 1e-6 ? mean : 1e-6);
  } else {
    o.iat_med = W; o.iat_cv = 0;   // 프레임이 2개 이하면 wifi_sim 과 같이 처리
  }
  uint32_t mx = 0, sum = 0, act = 0;
  for (int i = 0; i < 10; i++) { if (d.secBytes[i] > mx) mx = d.secBytes[i]; sum += d.secBytes[i]; if (d.secBytes[i]) act++; }
  float meanSec = sum / 10.0f;
  o.burst = mx / (meanSec > 1 ? meanSec : 1);
  o.active_s = act / 10.0f;
  return o;
}

// ======================================================================
// MQTT
// ======================================================================
static void ensureConnected() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.begin(WS_WIFI_SSID, WS_WIFI_PASS);
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < 10000) delay(200);
    if (WiFi.status() != WL_CONNECTED) return;
    WiFi.macAddress(gSelfMac);
    startSniffer();
    Serial.printf("[wifi] %s 채널 %d\n", WiFi.localIP().toString().c_str(), WiFi.channel());
  }
  if (!gMqtt.connected()) {
    char cid[32]; snprintf(cid, sizeof(cid), "wavespot-%s", WS_NODE_ID);
    // 끊기면 브로커가 대신 offline 을 남김 (LWT) → 서버 화면 '수신기 3/4'
    if (gMqtt.connect(cid, nullptr, nullptr, gStatusTopic, 0, true, "offline")) {
      gMqtt.publish(gStatusTopic, "online", true);
      Serial.println("[mqtt] 연결");
    }
  }
}

static void publishBle() {
  static BleDev snap[MAX_BLE];
  int k = 0; uint32_t now = millis();
  portENTER_CRITICAL(&gMux);
  for (int i = 0; i < MAX_BLE; i++) {
    BleDev& d = gBle[i];
    if (!d.used) continue;
    if (now - d.lastSeenMs > FORGET_MS) { d.used = false; continue; }
    if (d.n == 0) continue;
    if (d.minGapMs != UINT32_MAX) d.intervalMs = d.intervalMs > 0 ? d.intervalMs * 0.7f + d.minGapMs * 0.3f : d.minGapMs;
    snap[k++] = d;
    d.rssiSum = 0; d.rssiSq = 0; d.n = 0; d.minGapMs = UINT32_MAX;
  }
  portEXIT_CRITICAL(&gMux);

  const char* kind = WS_ROLE_HANDHELD ? "handheld" : "devices";
  for (int i = 0; i < k; i++) {
    BleDev& d = snap[i];
    if (!d.id[0]) hashId(d.mac, d.id);
    float mean = d.rssiSum / d.n, var = d.rssiSq / d.n - mean * mean;
    char topic[96], payload[160], comp[12] = "null", itv[12] = "null";
    if (d.company != 0xFFFF) snprintf(comp, sizeof(comp), "\"0x%04X\"", d.company);
    if (d.intervalMs > 0) snprintf(itv, sizeof(itv), "%d", (int)lroundf(d.intervalMs));
    snprintf(topic, sizeof(topic), "%s/%s/%s/%s", WS_TOPIC_ROOT, kind, d.id, WS_NODE_ID);
    snprintf(payload, sizeof(payload), "{\"rssi\":%.1f,\"rssiVar\":%.1f,\"company\":%s,\"interval\":%s}",
             mean, var > 0 ? var : 0, comp, itv);
    gMqtt.publish(topic, payload);
  }
  // 해시 결과를 다음 주기에도 쓰도록 되돌려 저장 (같은 MAC 이면 해시를 다시 계산하지 않음)
  portENTER_CRITICAL(&gMux);
  for (int i = 0; i < k; i++)
    for (int j = 0; j < MAX_BLE; j++)
      if (gBle[j].used && !gBle[j].id[0] && memcmp(gBle[j].mac, snap[i].mac, 6) == 0) memcpy(gBle[j].id, snap[i].id, 13);
  portEXIT_CRITICAL(&gMux);
}

static void publishWifi(bool windowEnd) {
#if WS_ENABLE_WIFI_SNIFF
  static WifiDev snap[MAX_WIFI];
  int k = 0; uint32_t now = millis();
  portENTER_CRITICAL(&gMux);
  for (int i = 0; i < MAX_WIFI; i++) {
    WifiDev& d = gWifi[i];
    if (!d.used) continue;
    if (now - d.lastSeenMs > FORGET_MS) { d.used = false; continue; }
    if (d.rssiN == 0 && !(windowEnd && d.n)) continue;
    snap[k++] = d;
    d.rssiSum = 0; d.rssiN = 0;
    if (windowEnd) {   // 창 통계 초기화
      d.n = d.nLarge = d.nSmall = 0; d.upBytes = d.dnBytes = d.sumSz = d.sumSz2 = 0;
      d.iatN = 0; d.iatSum = d.iatSum2 = 0; memset(d.iatHist, 0, sizeof(d.iatHist)); memset(d.secBytes, 0, sizeof(d.secBytes));
    }
  }
  if (windowEnd) gWinStartMs = now;
  portEXIT_CRITICAL(&gMux);

  const char* kind = WS_ROLE_HANDHELD ? "handheld" : "devices";
  for (int i = 0; i < k; i++) {
    WifiDev& d = snap[i];
    hashId(d.mac, d.id);
    float rssi = d.rssiN ? d.rssiSum / d.rssiN : -95.0f;
    char topic[96], payload[512];
    snprintf(topic, sizeof(topic), "%s/%s/%s/%s", WS_TOPIC_ROOT, kind, d.id, WS_NODE_ID);
    if (windowEnd && d.n >= 5) {
      WifiFeat f = wifiFeatures(d, WIFI_WIN_MS / 1000.0f);
      snprintf(payload, sizeof(payload),
               "{\"rssi\":%.1f,\"wifi\":true,\"wifi_feat\":{\"up_kbps\":%.2f,\"dn_kbps\":%.2f,\"pps\":%.2f,\"up_ratio\":%.3f,"
               "\"mean_size\":%.1f,\"std_size\":%.1f,\"frac_large\":%.3f,\"frac_small\":%.3f,\"iat_med\":%.5f,"
               "\"iat_cv\":%.3f,\"burst\":%.2f,\"active_s\":%.2f}}",
               rssi, f.up_kbps, f.dn_kbps, f.pps, f.up_ratio, f.mean_size, f.std_size, f.frac_large, f.frac_small,
               f.iat_med, f.iat_cv, f.burst, f.active_s);
    } else {
      snprintf(payload, sizeof(payload), "{\"rssi\":%.1f,\"wifi\":true}", rssi);
    }
    gMqtt.publish(topic, payload);
  }
#endif
}

// ======================================================================
void setup() {
  Serial.begin(115200);
  snprintf(gStatusTopic, sizeof(gStatusTopic), "%s/rooms/%s/status", WS_TOPIC_ROOT, WS_NODE_ID);
  Serial.printf("[wavespot] 수신기 %s (%s)\n", WS_NODE_ID, WS_ROLE_HANDHELD ? "휴대형" : "설치형");
  gMqtt.setServer(WS_MQTT_HOST, WS_MQTT_PORT);
  gMqtt.setBufferSize(768);
  gWinStartMs = millis();
  ensureConnected();
  startBleScan();
}

void loop() {
  static uint32_t lastPub = 0, lastWin = 0, lastStatus = 0;
  ensureConnected();
  gMqtt.loop();
  uint32_t now = millis();
  if (!gMqtt.connected()) { delay(50); return; }   // 끊겨 있는 동안은 누적만 하고, 다시 연결되면 이어서 보냄
  if (now - lastPub >= PUBLISH_MS) {
    lastPub = now;
    publishBle();
    bool winEnd = now - lastWin >= WIFI_WIN_MS;
    if (winEnd) lastWin = now;
    publishWifi(winEnd);
  }
  if (now - lastStatus >= STATUS_MS) {
    lastStatus = now;
    gMqtt.publish(gStatusTopic, "online", true);   // 5초 생존 신호
  }
  delay(5);
}
