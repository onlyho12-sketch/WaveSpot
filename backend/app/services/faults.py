"""시스템 오류 · 복구 대응 (설계안 v11 10장).

시험은 다시 치를 수 없으므로 장비 하나가 멈춰도 감시가 끊기지 않고 낮은 단계로 물러나 계속 동작 (단계적 축소).
CATALOG = 설계안 장애 대응 표 (장애 · 감지 · 자동 대응 · 감독관 화면 · 복구 목표).
재생 모드에서는 관리 화면에서 장애를 재현해 복구 시간과 놓친 신호 수를 잴 수 있음 (설계안 20장 실험 7).
"""
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Spec:
    title: str
    detect: str
    action: str
    screen: str
    target: str
    target_sec: float | None  # 숫자 목표가 있는 장애만
    dur: float  # 재현할 때 장애가 이어지는 시간 (재생 시각 기준 초, app 은 실제 초)


CATALOG: dict[str, Spec] = {
    "node1": Spec("수신기 1대 끊김", "5초 주기 상태 신호, 15초 미수신", "3대용 위치 모델로 자동 전환 (빠지는 4가지 조합 미리 학습)",
                  "'수신기 3/4', 구역 표시 한 단계 넓힘", "전원 재연결 즉시 4대 복귀", None, 120),
    "node2": Spec("수신기 2대 이상 끊김", "5초 주기 상태 신호, 15초 미수신", "위치 추정 중단, 반입 금지 기기가 있는지(이상 감지)만 유지",
                  "'위치 추정 중지, 휴대형 순회 권장'", "쉬는 시간 재연결", None, 120),
    "server": Spec("현장 서버 재시작", "프로세스 감시, 자동 재시작", "10초마다 저장한 상태(기준선, 허용 목록, 조사 진행, 경보 단계)로 이어서 판단, 수신기는 최근 60초 재전송",
                   "'복구 중' 표시 후 자동 해제", "30초 이내", 30, 20),
    "model": Spec("모델 오류 또는 이상 출력", "출력 범위, 결측 검사", "해당 모델만 건너뛰고 규칙 기반 점수로 전환 (장비나 모델 이상 때만)",
                  "판단 근거에 '규칙 점수' 표시", "다음 시험 전 재로딩", None, 120),
    "app": Spec("감독관 앱 연결 끊김", "WebSocket 응답 없음", "자동 재연결, 못 받은 알림은 서버에서 다시 보냄",
                "휴대형 수신기 자체 진동과 LED로 대체 알림", "10초 이내", 10, 6),
    "network": Spec("시험장 망(AP) 장애", "수신기, 서버 연결 상실", "수신기 자체 저장 공간에 계속 기록 → 사후 리포트에 반영",
                    "'감시 중단 (수동 감독 모드)' 전환", "망 복구 후 자동 동기화", None, 60),
    "beacon": Spec("기준 비콘 이상", "비콘 세기 급변, 미수신", "보정 중단, 직전 보정값 유지", "'보정 정지' 표시", "쉬는 시간 교체", None, 120),
    "clock": Spec("시계 어긋남", "수신기, 서버 시각 차 200ms 초과", "내부 시간 서버로 재동기화, 그동안 해당 수신기 가중치 낮춤", "-", "즉시", 10, 10),
    "result": Spec("수색 결과 입력 실패", "저장 확인 응답 없음", "태블릿에 먼저 저장 후 연결되면 전송 (이중 저장)", "'전송 대기 1건'", "연결 즉시", None, 60),
}

INJECT_DOWN = {"node1": ["R2"], "node2": ["R2", "R4"]}  # 재현할 때 끊을 수신기


# 관리 화면에 보이는 장애: 장비 · 통신 · AI 에서 하나씩, 감시가 끊기거나 판단이 틀어지는 핵심 장애만 (나머지는 대응 로직만 유지)
SHOWN = ("node1", "network", "model")


def catalog() -> list[dict[str, Any]]:
    return [{"kind": k, "title": v.title, "detect": v.detect, "action": v.action, "screen": v.screen, "target": v.target,
             "target_sec": v.target_sec} for k, v in ((k, CATALOG[k]) for k in SHOWN)]


@dataclass
class Active:
    record_id: int
    kind: str
    started: float
    until: float | None  # None = 조건이 풀릴 때 끝남 (수신기)
    injected: bool
    missed: int = 0  # 그동안 실시간 판단에 못 쓴 측정값 (망 장애: 수신기 자체 저장)
    resent: int = 0  # 재시작 동안 수신기가 보관했다가 다시 보낸 측정값
