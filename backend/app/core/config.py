"""환경 설정. 값은 환경 변수(WAVESPOT_*) 또는 backend/.env 로 바꿀 수 있음."""
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
UI_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WAVESPOT_", env_file=BACKEND_DIR / ".env", extra="ignore")

    # 데이터 입력: replay = 서버 안에서 시연 시나리오 재생, mqtt = 실제 수신기(브로커 경유)
    source: Literal["replay", "mqtt"] = "replay"
    mqtt_host: str = "127.0.0.1"
    mqtt_port: int = 1883
    mqtt_topic_root: str = "wavespot"

    # 재생 속도 (1.0 = 실제 시간, 10 = 10배속)
    replay_speed: float = 10.0

    # 판단 기준 (설계안 v9)
    window_seconds: float = 10.0  # 판단 창
    confirm_windows: int = 3  # 이 수만큼 연속이면 '있음' 확정 (30초)
    caution_score: int = 40
    request_score: int = 70
    inside_rssi: float = -85.0  # 교실 안 판정: 가장 강한 수신기 세기
    inside_min_nodes: int = 3  # 교실 안 판정: 신호를 들은 수신기 수
    inside_strong_rssi: float = -75.0  # 이보다 강하면 수신기 2대만 들어도 교실 안

    db_path: Path = UI_DIR / "db" / "wavespot.db"
    artifacts_dir: Path = BACKEND_DIR / "app" / "ml" / "artifacts"
    frontend_dist: Path = UI_DIR / "frontend" / "dist"


settings = Settings()
