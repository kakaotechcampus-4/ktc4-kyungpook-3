# Manager's Manager

카카오테크 캠퍼스 4기 경북대 3팀 프로젝트. 회의 녹음과 전사에서 태스크 후보를 찾고, PM 승인과 팀원 메시지로 진행 상황을 관리한다.

## 실행과 검사

각 파트는 의존성과 실행 환경을 따로 관리한다. 아래 안내에서 환경 변수를 준비하고 실행한다.

| 파트 | 실행·테스트 안내 | 역할 |
|---|---|---|
| Frontend | [설치·실행·검사](frontend/README.md) | React·TypeScript·Vite 웹 앱. Node 24 LTS |
| Backend | [실행·API·검사](backend/README.md) | FastAPI·SQLAlchemy·PostgreSQL API |
| AI | [설치·실행·테스트](ai/README.md) | Discord 녹음, 웹 업로드 처리, 전사·추출·BE 인계 워커 |

Frontend의 MSW 검사는 모의 API를 사용한다. 실제 서비스 연결과 외부 공급사 호출의 성공은 별도 검증 대상이다.

## 문서와 배포

- [문서 안내](docs/README.md)에서 파트별 계약·계획·결과를 찾는다.
- [배포 안내](deploy/README.md)에서 CI 검사, 배포 구성과 복구 절차를 확인한다.
- [FE API 계약](frontend/docs/contracts/frontend-api-contract.md)과 [BE·AI 계약](backend/docs/contracts/backend-ai-contract.md)은 구현 사실과 합의·후속 확인을 구분한다.

코드 병합, CI 통과, 배포 성공, 실제 사용자 환경 검증은 각각 확인한다. 문서의 과거 검증 기록을 현재 운영 검증으로 해석하지 않는다.
