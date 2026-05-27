# Data Insight Converter

엑셀/CSV/붙여넣기 데이터를 분석해 핵심 수치, 차트, 보고서 초안을 만드는 MVP입니다.

## 실행

```powershell
npm install
pip install -r requirements.txt
npm run backend
npm run dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:8000

## 주요 기능

- 붙여넣기 텍스트, CSV, XLSX 입력
- 핵심 수치 3개 자동 추출
- 막대/선/파이/테이블 차트 미리보기
- XLSX/PDF/DOCX 파일 내보내기

## 검증

```powershell
npm run typecheck
npm run test
```
