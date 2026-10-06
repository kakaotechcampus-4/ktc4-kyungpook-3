# 프론트엔드 계획과 마일스톤

[전체 계획](frontend-plan.md)의 M0~M8 번호·순서를 기준으로 문서를 정리했다. M0~M5의 plan.md는 기존 계획 원문을 그대로 이동한 파일이며, M6~M8은 0바이트 초기화 파일이다.

## 마일스톤 연결

| 번호 | 전체 계획의 범위 | 계획 | 기존 검증·인수인계 기록 | 확인 가능한 상태 |
|---|---|---|---|---|
| M0 | 프로젝트 기반·툴체인 | [plan.md](m0/plan.md) | 별도 결과 기록 없음 | 코드·설정 존재. 이번 구조화에서 완료 판정하지 않음 |
| M1 | API 명세·모델·MSW | [plan.md](m1/plan.md) | [결정 기록](m1/basis-for-decision) | 계약·모델·MSW 존재. 이번 구조화에서 완료 판정하지 않음 |
| M2 | 디자인 토큰·공통 UI | [plan.md](m2/plan.md) | [결정 기록](m2/basis-for-decision), [포커스 구현 계획](m2/focus-visible-outline.md) | 토큰·공통 UI 존재. 이번 구조화에서 완료 판정하지 않음 |
| M3 | 라우팅·접근 제어·데이터 계층 | [plan.md](m3/plan.md) | [착수 전 작업 자료](m3/prev-todo-m3.md) | 라우터·가드·통신 계층 존재. 이번 구조화에서 완료 판정하지 않음 |
| M4 | 인증·온보딩·공간 선택·앱 셸 | [plan.md](m4/plan.md) | [완료 조건](m4/m4-done-criteria.md), [인수인계](m4/m4-handoff.md), [결정 기록](m4/basis-for-decision) | 기존 기록에 MSW 기준 완료 판정 있음. 실 연동 검증과 구분 |
| M5 | 회의 업로드·처리·회의록 | [plan.md](m5/plan.md) | [완료 조건](m5/m5-done-criteria.md), [인수인계](m5/m5-handoff.md), [결정 기록](m5/basis-for-decision) | 기존 기록에 MSW 기준 완료 판정 있음. 실 백엔드 흐름은 미검증 |
| M6 | 태스크 목록·상세·승인 | [plan.md](m6/plan.md) | 별도 기존 기록 없음 | 계획은 빈 파일. 완료 판정 없음 |
| M7 | 대시보드 완성 | [plan.md](m7/plan.md) | 별도 기존 기록 없음 | 계획은 빈 파일. 완료 판정 없음 |
| M8 | 보드·간트·캘린더·메시지·설정 | [plan.md](m8/plan.md) | 별도 기존 기록 없음 | 전체 계획상 골격·착수 전 결정 필요. 완료 판정 없음 |

## 원문 보존과 경로 해석

전체 계획과 M0~M5 계획, 포커스 구현 계획, 착수 전 작업 자료의 원문 내용은 변경하지 않았다. 이전 경로의 파일과 이동 안내는 삭제했다. 보호 계획·코드 주석에 남은 과거 경로 표기는 현재 문서 경로와 다를 수 있다.

M0~M5 계획에 적힌 `../decision/`, `../api/`, `../design/`, `../impl-decision/` 등의 인라인 경로는 이동 전 `frontend/docs/plan/` 기준 표기다. 원문의 경로 표기를 임의로 고치지 않았으며, 현재 자료는 아래 링크로 찾는다.

- [전체 계획](frontend-plan.md)
- [제품·기술 결정](../decision/frontend-decisions.md)
- [대표 API 계약](../contracts/frontend-api-contract.md)
- [디자인 캔버스](../design/canvas/README.md)
- [구현 결정 작성 안내](basis-for-decision-guide.md)

M5 계획의 완료 조건·인수인계 링크는 같은 마일스톤 폴더에 함께 배치해 유지했다. 변경 가능한 문서의 실제 링크는 이동 경로에 맞춰 갱신했다. 원문의 과거 검증은 이번 작업에서 재실행한 검증으로 간주하지 않는다.

`result.md`나 개별 요청·트러블슈팅 기록은 새로 만들지 않았다. 실제 개발 이후 결과를 기록하며 트러블슈팅 원문은 사람이 작성한다.
