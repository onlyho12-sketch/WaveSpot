"""녹화 재생 시나리오를 실제 MQTT 브로커로 송출 (수신기 4대 흉내).

백엔드를 MQTT 모드로 띄운 뒤 이 스크립트를 실행하면, 실제 수신기가 보내는 것과 같은 형식으로 측정값이 들어간다.
  1) mosquitto -c server/mqtt/mosquitto.conf
  2) backend:  set WAVESPOT_SOURCE=mqtt  &&  .venv/Scripts/fastapi dev app/main.py
  3) 이 폴더:  ../../backend/.venv/Scripts/python publish_mqtt.py --scenario demo --speed 10

토픽 · 내용은 docs/API.md 'MQTT' 절 참고 (ESPresense 형식을 따름)
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

import aiomqtt  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.ml.features import NODES  # noqa: E402
from app.services.replay import Replay  # noqa: E402


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", default="demo")
    ap.add_argument("--speed", type=float, default=10.0)
    ap.add_argument("--host", default=settings.mqtt_host)
    ap.add_argument("--port", type=int, default=settings.mqtt_port)
    a = ap.parse_args()
    root = settings.mqtt_topic_root
    rp = Replay(a.scenario)
    async with aiomqtt.Client(a.host, a.port) as c:
        for n in NODES:
            await c.publish(f"{root}/rooms/{n}/status", "online", retain=True)
        t = 0
        while t < 100 * 60:
            for r in rp.readings_at(t):
                payload = {"rssi": round(r.rssi, 1), **r.meta}
                await c.publish(f"{root}/devices/{r.device_id}/{r.node_id}", json.dumps(payload))
            t += 1
            if t % 60 == 0:
                print(f"{t // 60}분 송출")
            await asyncio.sleep(1 / a.speed)


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
