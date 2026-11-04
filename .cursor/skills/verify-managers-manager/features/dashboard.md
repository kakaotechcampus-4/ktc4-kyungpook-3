# 대시보드·자동 반영 되돌리기

사용자가 확인 필요·마감 임박 항목에서 관련 상세로 이동한다. PM은 자동 반영을 되돌려 새 확인 필요 항목으로 전환한다.

## Sub-features

- `dashboard-links`는 확인 필요 상세, 마감 임박 전체 목록, 태스크 상세로 이동한다.
- `revert-keyboard`는 키보드로 되돌리기를 취소·확정하고 새 승인 링크로 이동한다.
- `member-view`는 일반 팀원에게 PM 전용 행동과 승인 조회를 제공하지 않는다.
- `login-redirect`는 로그인된 사용자의 `/login`을 대시보드로 보낸다.

## How to get to it (user POV)

- 헤더 **대시보드** 또는 `/workspaces/ws_01/dashboard`로 진입한다.
- 로그인된 상태에서 `/login`을 방문해 자동 이동한다.
- **확인하기 — 테스트 계획 정리**, 마감 임박의 **전체 보기**, **DB 스키마 정리 되돌리기**를 선택한다.

## Driving it with Playwright

Preconditions:

- `dashboard-default`는 PM의 확인 필요 3개·마감 임박 6개·최근 반영 3개를 제공한다.
- `dashboard-member`는 일반 팀원이다. 테스트가 서울 시각 `2026-09-18T09:00:00+09:00`으로 날짜만 고정한다.

- **실행.** `node .cursor/skills/verify-managers-manager/scripts/verify.cjs run dashboard`로 네 테스트를 실행한다.
- **목록과 상세.** **확인하기 — 테스트 계획 정리**가 `/approvals/ap_02`를 연다. 마감 임박 **전체 보기**는 `tasks?tab=in_progress&due=overdue,soon`에서 6개를 보인다. **STT 정확도 측정**은 `/tasks/tk_06`을 연다.
- **되돌리기.** **DB 스키마 정리 되돌리기**에 focus 후 Enter를 누른다. **자동 반영을 되돌릴까요?** 대화상자를 Escape로 닫아 트리거 포커스를 확인한다. 다시 열어 **되돌리기**를 확정하면 같은 `recent-row`가 **되돌림**으로 바뀐다. 새 **확인 필요 보기** 링크와 별도 확인 필요 목록 항목이 생기고 Enter로 새 승인 상세가 열린다.
- **권한과 로그인 경로.** 팀원 테스트는 **확인이 필요한 일**과 되돌리기 버튼 부재, 승인 조회 0회를 확인한다. 로그인 이동 테스트는 `/login`에서 최근 반영 목록까지 도달한다.
- **헤더 진입.** 기본 테스트는 주소와 로그인 자동 이동에서 시작한다. 헤더 **대시보드** 클릭까지 범위에 포함되면 `getByRole('banner').getByRole('link', { name: '대시보드', exact: true }).click()`의 이동을 추가로 기록한다.

## Gotchas

- 실제 날짜로 실행하면 마감 임박 건수가 달라진다. 기존 시계 고정을 유지한다.
- 되돌리기는 행의 위치와 포커스도 유지해야 한다. 성공 토스트만 확인하지 않는다.
- Notion 페이지 보관과 실제 백엔드의 되돌리기는 이 모의 상태 변경으로 검증되지 않는다.
