# 처음 한 번: 백엔드 가상환경 · 패키지, 프론트 패키지, 위치 모델 학습
# 사용: WaveSpot_UI 폴더에서  powershell -ExecutionPolicy Bypass -File server/scripts/setup.ps1
$root = Resolve-Path "$PSScriptRoot\..\.."
Set-Location "$root\backend"
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
# 모델 학습 · 근거 기반 모의 데이터 (위치 · 교실 안/밖 · Wi-Fi 용도, 외부 데이터 불필요 · 약 15초)
.\.venv\Scripts\python -m app.ml.train_models
Set-Location "$root\frontend"
npm install
npm run build
Write-Host "준비 완료 · server/scripts/dev.ps1 로 실행"
