"""로그인 · 접속 토큰.

계정 3개 (역할마다 하나): supervisor 감독관 · admin 관리자 · auditor 검토자. 시연용 비밀번호는 같음.
토큰 = '아이디.만료시각.서명' (HMAC-SHA256). 서명 키는 db 폴더에 파일로 두어
현장 서버가 재시작돼도(복구 중) 감독관이 다시 로그인하지 않아도 됨. 실기기 단계에서 계정 관리 · 관리자 2단계 인증으로 바꿈.
"""
import hashlib
import hmac
import secrets
import time

from app.core.config import settings

# 아이디 -> 역할 (역할 이름은 security.ROLES)
ACCOUNTS = {"supervisor": "supervisor", "admin": "admin", "auditor": "auditor"}
_SALT = b"wavespot-demo-salt"
_ROUNDS = 120_000
# 시연용 비밀번호 'wavespot2026' 의 PBKDF2 값 (평문은 저장하지 않음)
_PW_HASH = bytes.fromhex("564c5d86172c4f88638be0cf3d1ee08651a25a9c161f2b5c79c894e3c85935b9")
TOKEN_TTL = 12 * 3600  # 하루 시험 일정 동안 유지


def _key() -> bytes:
    if settings.auth_secret:
        return settings.auth_secret.encode()
    path = settings.db_path.parent / "auth.key"
    try:
        return path.read_bytes()
    except FileNotFoundError:
        k = secrets.token_bytes(32)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(k)
        except OSError:  # 쓸 수 없는 환경(웹 시연판 등)은 메모리에만
            pass
        return k


_KEY = _key()


def _sign(body: str) -> str:
    return hmac.new(_KEY, body.encode(), hashlib.sha256).hexdigest()[:40]


def _pbkdf2_sha256(password: bytes, salt: bytes, rounds: int) -> bytes:
    """hashlib.pbkdf2_hmac 과 같은 계산 (출력 32바이트 = 블록 1개).
    웹 시연판(Pyodide)의 hashlib 에는 pbkdf2_hmac 이 없어 로그인이 실패했으므로 그때만 씀."""
    if len(password) > 64:
        password = hashlib.sha256(password).digest()
    password = password.ljust(64, b"\0")
    inner = hashlib.sha256(password.translate(bytes(x ^ 0x36 for x in range(256))))
    outer = hashlib.sha256(password.translate(bytes(x ^ 0x5C for x in range(256))))

    def prf(msg: bytes) -> bytes:
        i, o = inner.copy(), outer.copy()
        i.update(msg)
        o.update(i.digest())
        return o.digest()

    u = prf(salt + b"\x00\x00\x00\x01")
    acc = int.from_bytes(u, "big")
    for _ in range(rounds - 1):
        u = prf(u)
        acc ^= int.from_bytes(u, "big")
    return acc.to_bytes(32, "big")


def _hash(password: str) -> bytes:
    if hasattr(hashlib, "pbkdf2_hmac"):
        return hashlib.pbkdf2_hmac("sha256", password.encode(), _SALT, _ROUNDS)
    return _pbkdf2_sha256(password.encode(), _SALT, _ROUNDS)


def check_password(username: str, password: str) -> str | None:
    """맞으면 역할, 틀리면 None (아이디가 없어도 같은 시간만큼 계산 · 아이디 존재 여부를 흘리지 않음)."""
    got = _hash(password)
    ok = hmac.compare_digest(got, _PW_HASH)
    role = ACCOUNTS.get(username)
    return role if ok and role else None


def issue(username: str) -> str:
    body = f"{username}.{int(time.time()) + TOKEN_TTL}"
    return f"{body}.{_sign(body)}"


def verify(token: str | None) -> str | None:
    """토큰 -> 역할 (위조 · 만료 · 없는 계정이면 None)."""
    if not token:
        return None
    try:
        user, exp, sig = token.split(".")
    except ValueError:
        return None
    body = f"{user}.{exp}"
    if not hmac.compare_digest(sig, _sign(body)) or not exp.isdigit() or int(exp) < time.time():
        return None
    return ACCOUNTS.get(user)
