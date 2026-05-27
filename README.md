# Data Insight Converter RN

순수 React Native 기반 프론트엔드 단독 데이터 분석 MVP입니다.
백엔드 서버 없이 앱에서 엑셀/CSV를 읽고, 사용자가 입력한 Gemini API 키로 Google Gemini API를 직접 호출합니다.

## 실행

```powershell
npm install
npm run dev
```

- Metro: http://localhost:8081
- Android: `npm run android`
- iOS: `npm run ios`

## 주요 기능

- React Native UI
- XLSX/CSV/붙여넣기 데이터 파싱
- Gemini API 직접 호출
- 핵심 수치 3개, 인사이트, 보고서 초안 생성
- 백엔드 통신 없음

## 검증

```powershell
npm run typecheck
npm run test
```
