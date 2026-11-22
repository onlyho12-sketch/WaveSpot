# WaveSpot 안드로이드 APK

배포된 웹 시연판(https://wavespot-daup.vercel.app)을 전체 화면으로 여는 Capacitor 앱입니다.
화면 코드는 웹과 같으므로, 웹을 다시 배포하면 APK를 새로 만들지 않아도 앱에 반영됩니다 (인터넷 연결 필요).

- 앱 이름 `WaveSpot`, 패키지 `com.wavespot.supervisor`
- 여는 주소: `capacitor.config.json`의 `server.url`
- 아이콘 · 시작 화면: `frontend/public/icon.png`에서 만든 이미지 (`android/app/src/main/res`)
- 받은 APK: 저장소 Releases

## 빌드

필요: Node.js, Android SDK (platform 36), JDK 21 (Gradle 8.14가 JDK 25에서는 동작하지 않음)

```bash
cd apk
npm install
npx cap sync android
# android/local.properties 에 SDK 경로 (슬래시로)
echo "sdk.dir=C:/Users/<사용자>/AppData/Local/Android/Sdk" > android/local.properties
cd android
JAVA_HOME=<JDK 21 경로> ./gradlew assembleDebug
# 결과: android/app/build/outputs/apk/debug/app-debug.apk
```

Windows에서 프로젝트 경로에 한글이 있으면 안드로이드 빌드 도구가 빌드를 거부합니다. 이 폴더를 영문 경로로 복사해서 빌드하세요.
