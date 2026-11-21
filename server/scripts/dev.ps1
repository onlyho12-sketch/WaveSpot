# 개발 실행 (Windows PowerShell): 백엔드(8000) + 프론트 개발 서버(5173)를 각각 새 창으로 띄움
# 사용: WaveSpot_UI 폴더에서  powershell -ExecutionPolicy Bypass -File server/scripts/dev.ps1
$root = Resolve-Path "$PSScriptRoot\..\.."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; .\.venv\Scripts\fastapi dev app/main.py --port 8000"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\frontend'; npm run dev"
Write-Host "감독관 앱: http://localhost:5173  (같은 와이파이의 태블릿 · 휴대폰은 http://<이 PC IP>:5173)"
