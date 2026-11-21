"""웹 시연판(Vercel) 묶음 만들기: 현장 서버 Python 코드 + 웹용 모델 -> frontend/public/py/

  app.zip        backend/app 의 .py 전부 + artifacts/(웹용 모델, scikit-learn 1.7.0 = Pyodide 0.28.3 과 같은 버전으로 학습)
  wheels/*.whl   Pyodide 에 기본으로 없는 순수 Python 패키지 (FastAPI 등) · 버전 고정
  manifest.json  위 파일 목록

실행 (저장소 폴더, PowerShell):  powershell -ExecutionPolicy Bypass -File server/web/build.ps1
"""
import json
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "backend" / "app"
OUT = ROOT / "frontend" / "public" / "py"

# Pyodide 0.28.3 의 pydantic 2.10.6 과 맞는 버전 (브라우저에서 실행 확인한 조합)
WHEELS = ["fastapi==0.115.14", "starlette==0.46.2", "sqlmodel==0.0.24", "pydantic-settings==2.8.1",
          "python-dotenv==1.1.0", "typing-inspection==0.4.1"]


def main(artifacts: Path) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT / "app.zip", "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(APP.rglob("*.py")):
            if "__pycache__" in f.parts or "artifacts" in f.parts:
                continue
            z.write(f, Path("app") / f.relative_to(APP))
        for f in sorted(artifacts.glob("*")):
            if f.suffix in (".joblib", ".json"):
                z.write(f, Path("artifacts") / f.name)
    wd = OUT / "wheels"
    wd.mkdir(exist_ok=True)
    for old in wd.glob("*.whl"):
        old.unlink()
    subprocess.check_call([sys.executable, "-m", "pip", "download", "--no-deps", "--only-binary=:all:", "-q", "-d", str(wd), *WHEELS])
    manifest = {"app": "app.zip", "wheels": sorted(p.name for p in wd.glob("*.whl"))}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(f"app.zip {(OUT / 'app.zip').stat().st_size / 1e6:.1f} MB · wheels {len(manifest['wheels'])}개")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else APP / "ml" / "artifacts")
