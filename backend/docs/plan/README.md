# 백엔드 계획과 마일스톤

[전체 계획](backend-plan.md)의 M0~M7 번호·순서를 기준으로 폴더를 준비했다. 마일스톤별 기존 계획 문서가 없어 M0~M7의 plan.md는 모두 0바이트 초기화 파일이다.

## 마일스톤 연결

상태는 전체 계획에 적힌 값(기준일 2026-10-02)을 옮긴 것이다. 이번 구조화에서 완료를 판정하지 않았다.

| 번호 | 전체 계획의 범위 | 계획 | 전체 계획의 상태 |
|---|---|---|---|
| M0 | 서버·DB·실행·검증 기반 | [plan.md](m0/plan.md) | 구현됨 · 보완 필요 |
| M1 | 인증·워크스페이스·온보딩·권한 | [plan.md](m1/plan.md) | 부분 구현 |
| M2 | 태스크·승인·변경 이력·동기화 | [plan.md](m2/plan.md) | 핵심 구현됨 |
| M3 | 회의·전사·AI 결과 수신 | [plan.md](m3/plan.md) | 핵심 구현됨 |
| M4 | Google·Discord·Notion 실제 연결 | [plan.md](m4/plan.md) | 대부분 미구현 |
| M5 | 웹 음성 업로드·비동기 처리 | [plan.md](m5/plan.md) | 스텁 |
| M6 | 프론트·AI 통합과 계약 확정 | [plan.md](m6/plan.md) | 검증 대기 |
| M7 | 운영 배포·관찰·복구 | [plan.md](m7/plan.md) | 부분 구현 |

각 마일스톤 폴더에는 빈 `basis-for-decision/`, `trouble-shooting/`만 있다. `result.md`와 개별 결정·트러블슈팅 기록은 실제 개발 뒤 작성한다.

## 원문 보존과 경로 해석

전체 계획은 `backend-development-plan.md`에서 `backend-plan.md`로 이름만 바꿨고 내용은 그대로다. 원문 머리말의 "문서 경로" 표기는 이동 전 경로로 남아 있으며, 현재 위치는 이 폴더의 [backend-plan.md](backend-plan.md)다.
