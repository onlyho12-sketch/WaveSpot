"""Wi-Fi 용도 · 근거 기반 모의 프레임 생성과 특징 (설계안 v10 검증 ⑥ · 실측 아님).

WaveSpot_데이터/_scripts/v10/sim_wifi.py 의 생성 규칙과 특징을 그대로 옮김.
ESP32 감청 모드가 보는 값 = 프레임 길이 · 시각 · 방향만 (내용은 암호화되어 보지 않음)
 - 영상 통화 상향 0.78~1.40 Mbps · 하향 0.84~1.86 Mbps : MacMillan et al., ACM IMC 2021 (arXiv:2105.13478)
 - 영상 패킷 최대 약 1,200 B : libwebrtc kVideoMtu
 - 음성 통화 Opus 16~32 kbps · 초당 50 패킷 : webrtcHacks WhatsApp 통화 분석
 - 사진 1장 0.3~3.5 MB : 12MP HEIC 측정 사례 (메신저 압축분은 가정)
 - 대기 : Huang et al., IMC 2012 (화면 꺼짐 트래픽은 드묾) · 수치는 가정
"""
import numpy as np

OH = 60
CLASSES = ["video_call", "voice_call", "photo_send", "idle"]
LABEL = {"video_call": "영상 통화", "voice_call": "음성 통화", "photo_send": "사진 전송", "idle": "대기"}
RISK = {"video_call": 1.0, "photo_send": 0.9, "voice_call": 0.8, "idle": 0.0}  # v10 결정 함수 · 용도 위험도
FEATS = ["up_kbps", "dn_kbps", "pps", "up_ratio", "mean_size", "std_size", "frac_large", "frac_small",
         "iat_med", "iat_cv", "burst", "active_s"]


def gen_video(rng, T):
    up = rng.uniform(0.78, 1.40) * 1e6; dn = rng.uniform(0.84, 1.86) * 1e6; fps = rng.uniform(15, 30)
    ev = []
    for direction, rate in (("up", up), ("down", dn)):
        t = rng.uniform(0, 1 / fps)
        while t < T:
            frame_bytes = max(200, rng.normal(rate / 8 / fps, rate / 8 / fps * 0.35))
            k = int(np.ceil(frame_bytes / 1200))
            for i in range(k):
                ev.append((t + i * 0.0004, direction, frame_bytes / k + OH))
            t += rng.exponential(1 / fps) * 0.3 + 0.7 / fps
        t = 0
        while t < T:
            ev.append((t, direction, rng.normal(110, 15) + OH)); t += 0.02 + rng.normal(0, 0.002)
    return ev


def gen_voice(rng, T):
    ev = []
    for direction in ("up", "down"):
        t = rng.uniform(0, 0.02); kbps = rng.uniform(16, 32)
        while t < T:
            payload = kbps * 1000 / 8 / 50
            ev.append((t, direction, max(40, rng.normal(payload, payload * 0.25)) + 40 + OH))
            t += 0.02 + rng.normal(0, 0.003)
    return ev


def gen_photo(rng, T):
    ev = []; t = rng.uniform(0, 5)
    while t < T:
        size = rng.uniform(0.3, 3.5) * 1e6; thr = rng.uniform(5, 20) * 1e6 / 8
        n = int(size / 1440); dt = 1440 / thr
        for i in range(n):
            ts = t + i * dt
            if ts >= T: break
            ev.append((ts, "up", 1500 + OH))
            if i % 2 == 0: ev.append((ts + 0.001, "down", 52 + OH))
        t += n * dt + rng.uniform(10, 40)
    ev += [(x, "down", rng.uniform(80, 300) + OH) for x in np.sort(rng.uniform(0, T, int(T * 0.3)))]
    return ev


def gen_idle(rng, T):
    rate = rng.uniform(0.1, 1.0)
    ev = [(x, rng.choice(["up", "down"]), rng.uniform(80, 400) + OH) for x in np.sort(rng.uniform(0, T, rng.poisson(rate * T)))]
    if rng.random() < 0.3:
        t0 = rng.uniform(0, T); ev += [(t0 + i * 0.01, "down", rng.uniform(300, 1500) + OH) for i in range(rng.integers(5, 40))]
    return ev


GEN = {"video_call": gen_video, "voice_call": gen_voice, "photo_send": gen_photo, "idle": gen_idle}


def features(rng, ev, t0, W, loss) -> dict[str, float]:
    a = [e for e in ev if t0 <= e[0] < t0 + W and rng.random() >= loss]
    up = np.array([s for t, d, s in a if d == "up"]); dn = np.array([s for t, d, s in a if d == "down"])
    ts = np.sort([t for t, d, s in a]); iat = np.diff(ts) if len(ts) > 2 else np.array([W])
    allsz = np.array([s for t, d, s in a]) if a else np.array([0.0])
    per_s = np.histogram([t for t, d, s in a], bins=int(W), range=(t0, t0 + W), weights=[s for t, d, s in a])[0] if a else np.zeros(int(W))
    return dict(
        up_kbps=up.sum() * 8 / W / 1e3, dn_kbps=dn.sum() * 8 / W / 1e3, pps=len(a) / W,
        up_ratio=up.sum() / max(1, up.sum() + dn.sum()), mean_size=allsz.mean(), std_size=allsz.std(),
        frac_large=(allsz > 1000).mean(), frac_small=(allsz < 250).mean(),
        iat_med=float(np.median(iat)), iat_cv=iat.std() / max(1e-6, iat.mean()),
        burst=per_s.max() / max(1, per_s.mean()), active_s=(per_s > 0).mean())


def window_features(rng, usage: str, W: float = 10.0) -> dict[str, float]:
    """재생용: 한 창(10초)의 모의 프레임 -> 특징. ESP32 수신 손실 0~40% (가정)."""
    ev = GEN[usage](rng, W)
    return features(rng, ev, 0.0, W, rng.uniform(0, 0.4))
