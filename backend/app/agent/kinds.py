"""기기 종류 추정 (규칙 · 종류 모델은 팀 기기 수집 후 학습 예정) 과 종류별 정밀 수색 부위 (설계안 9장 표)."""
from typing import Any

KIND_LABEL = {"earbuds": "무선 이어폰", "glasses": "카메라 안경", "phone": "휴대폰", "watch": "스마트워치", "unknown": "종류 불명"}
KIND_WEIGHT = {"earbuds": 1.0, "glasses": 1.0, "phone": 0.8, "watch": 0.6, "unknown": 0.5}
SEARCH_PARTS = {
    "earbuds": ["귓속", "머리카락 아래", "마스크 끈", "목 주변"],
    "glasses": ["안경테", "안경 다리"],
    "phone": ["상의 안쪽", "소지품", "책상 안"],
    "watch": ["손목", "소매"],
    "unknown": ["가장 강한 좌석 주변 전체"],
}
SECOND_SEARCH_PARTS = ["소지품과 가방", "책상 안쪽과 아래", "다른 신체 부위", "차폐 파우치 재확인"]  # Lv4 2차 수색


def parts_by_signal(has_wifi: bool) -> list[str]:
    """종류가 불확실할 때 (v10): 신호 조합으로 수색 부위 결정."""
    return ["상의 안쪽", "안경", "소지품"] if has_wifi else ["귓속", "머리카락 아래", "손목", "목 주변"]


def guess_kind(meta: dict[str, Any]) -> str:
    interval = meta.get("interval")
    if meta.get("wifi"):
        return "phone"
    if interval is None:
        return "unknown"
    if interval <= 60:
        return "earbuds"  # 짧은 간격으로 재연결 광고 (폰과 끊긴 이어폰의 특징)
    if interval <= 300:
        return "phone"
    return "watch"
