# 웹 시연판(Vercel) 빌드: 저장소 폴더에서  powershell -ExecutionPolicy Bypass -File server/web/build.ps1
#  1) Pyodide 0.28.3 과 같은 scikit-learn 1.7.0 · numpy 2.2.5 로 웹용 모델 학습 (나무 수를 줄이고 압축)
#  2) 현장 서버 코드 + 웹용 모델 -> frontend/public/py/app.zip, FastAPI 등 휠 -> frontend/public/py/wheels
#  3) VITE_DEMO=1 로 화면 빌드 -> frontend/dist-web  (배포: cd frontend/dist-web; vercel deploy --prod)
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot/../.."
$venv = Join-Path $root "server/web/.venv-web"
$art = Join-Path $root "server/web/artifacts-web"

if (-not (Test-Path "$venv/Scripts/python.exe")) {
    python -m venv $venv
    & "$venv/Scripts/python.exe" -m pip install -q scikit-learn==1.7.0 numpy==2.2.5 scipy joblib pydantic-settings sqlmodel
}
New-Item -ItemType Directory -Force $art | Out-Null
Push-Location "$root/backend"
$env:WAVESPOT_MODEL_SIZE = "web"
$env:WAVESPOT_ARTIFACTS_DIR = $art
& "$venv/Scripts/python.exe" -m app.ml.train_models
Remove-Item Env:WAVESPOT_MODEL_SIZE, Env:WAVESPOT_ARTIFACTS_DIR
Pop-Location

& "$venv/Scripts/python.exe" "$root/server/web/bundle.py" $art

Push-Location "$root/frontend"
# 빌드가 dist-web 을 비우므로 Vercel 프로젝트 연결(.vercel)을 잠시 옮겨 둠 (없으면 새 프로젝트가 생김)
$link = Join-Path $env:TEMP "wavespot-vercel-link"
if (Test-Path "dist-web/.vercel") { Remove-Item -Recurse -Force $link -ErrorAction SilentlyContinue; Copy-Item -Recurse "dist-web/.vercel" $link }
npm run build:web
if (Test-Path $link) { Copy-Item -Recurse $link "dist-web/.vercel" }
Pop-Location
Write-Host "완료: frontend/dist-web  ->  cd frontend/dist-web; vercel deploy --prod"
