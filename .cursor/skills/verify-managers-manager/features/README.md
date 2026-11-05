# Manager's Manager 검증 기능 지도

프론트엔드의 주요 다섯 영역을 다룬다. 메시지 화면과 Discord 봇·AI·실제 백엔드 연동은 아직 지도에 포함하지 않았다. 이 지도를 전체 제품 검증 목록으로 보고하지 않는다.

## 기본 전제

저장소 루트에서 [실행 스킬](../SKILL.md)의 Launch를 따른다. 실행마다 독립 Vite 포트와 새 Chromium 컨텍스트를 만든다. `frontend/e2e/support.ts`의 `start`가 `?msw-scenario=`로 테스트별 데이터를 초기화하고 주소에서 파라미터를 지운다. 같은 여정의 reload나 OAuth 복귀에는 파라미터를 다시 붙이지 않는다.

실제 API·OAuth·Notion 반영은 MSW 증거와 구분한다. 기본 필터는 UI로 상태를 변경하는 테스트를 고른다. 필터를 바꾸면 실제 선택된 테스트 수와 이름을 `results.json`에서 확인한다.

## 기능

| 기능 | 명령의 기능명 | 테스트 파일 | 시작 상태 |
|---|---|---|---|
| [가입·온보딩·공간 선택](auth-workspaces.md) | `auth` | `signup-onboarding.e2e.ts`, `select-switch.e2e.ts`, `onboarding-start.e2e.ts`, `onboarding-design.e2e.ts`, `restore.e2e.ts`, `password-reset.e2e.ts` | signed-out, no-workspace, incomplete-workspace, multiple-workspaces, password-reset-expired |
| [회의 업로드·처리·회의록](meetings.md) | `meetings` | `meeting-flow.e2e.ts` | meeting-instant, meeting-demo, meeting-member, meeting-fail |
| [태스크·확인 필요 승인](tasks-approval.md) | `tasks` | `tasks-approval.e2e.ts`의 UI 테스트 3개 | tasks-default, tasks-member |
| [대시보드·자동 반영 되돌리기](dashboard.md) | `dashboard` | `dashboard.e2e.ts` | dashboard-default, dashboard-member |
| [설정에서 Discord·팀 연결](connections-team.md) | `connections` | `settings-team.e2e.ts`의 PM 연결 테스트 1개 | settings-discord-skipped |

## 증거와 판정

실행 ID별 trace의 동작과 상태 변화, 결과 JSON의 단언, 최종 PNG를 함께 읽는다. 변경은 별도 화면이나 새로고침 뒤에도 확인한다. 각 진입점의 통과·실패·미실행을 구분한다. 기능의 일부 경로만 실행한 경우 기능 전체가 통과했다고 적지 않는다. 미충족 전제조건은 실패 이유와 함께 해당 기능의 Gotchas에 기록한다.

2026-11-03 초기 생성 시 `connections`의 Launch → Doctor → Drive → Cleanup을 실행했다. 전체 다섯 영역의 성공을 이 한 번의 실행에서 추론하지 않는다. 증거 경로와 실제 결과는 [스킬의 Evidence](../SKILL.md#evidence)에서 확인한다.
