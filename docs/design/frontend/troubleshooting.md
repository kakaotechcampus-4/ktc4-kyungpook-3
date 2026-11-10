# 주요 문제 해결 사례

2026-11-11 기존 개발 결과·결정 기록을 발표 관점에서 요약했다. 아래 내용은 사람이 당시 작성한 트러블슈팅 원문을 대신하지 않는다. 원문에 없는 시도나 개인적인 배움은 추가하지 않았다. 검증은 각 기록 당시의 결과이며 이번 문서 작업에서 앱 테스트를 다시 실행한 결과가 아니다.

## 계정이 바뀐 뒤 이전 쓰기가 전송되는 문제

오프라인에서 멈춘 승인 mutation이 재연결 후 다른 계정의 쿠키로 전송됐다. 원인은 응답 후처리에서만 세션을 확인하고 요청 실행 직전에는 확인하지 않은 점이다. 늦은 응답을 무시하는 것으로는 요청 자체의 부작용을 막지 못했다.

사용자가 누를 때 세션 세대와 취소 신호를 잡는다. 요청 직전에 같은 세션인지 확인하고, 전송 중 세션이 끝나면 요청을 취소한다. 취소된 쓰기가 새 계정의 캐시나 오류 안내를 바꾸는 후처리도 막는다.

[#594 결과](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/issues/594-stale-session-writes/result.md)는 오프라인 중단 → 세션 교체 → 재연결 회귀와 같은 세션의 정상 전송을 기록한다. 온보딩의 다중 요청과 다른 탭의 쿠키 변경은 당시 남은 범위다. 여기서 적용한 규칙은 이전 세션의 요청·응답·후처리를 함께 차단하는 것이다.

## 타입이 있어도 잘못된 응답이 정상 화면으로 보이는 문제

손으로 쓴 DTO 타입 단언은 실제 응답을 검사하지 않았다. 모르는 태스크 상태가 `할 일`, 모르는 승인 상태가 `승인 대기`로 보일 수 있었다. 기존 결정은 OpenAPI 생성 타입을 전제로 런타임 검증을 생략했지만 그 전제가 구현돼 있지 않았다.

entity 요청 경계에서 Zod 검증을 추가하고 DTO 타입을 스키마에서 유도했다. 상태·버전처럼 행동을 결정하는 값이 잘못되면 `INVALID_RESPONSE`로 처리한다. 표시용 값은 알 수 없는 값으로 남기거나 명시한 부가 정보 정책을 적용한다. 쓰기 응답이 잘못되면 이미 서버에 반영됐을 수 있으므로 재시도 쓰기 대신 먼저 재조회한다.

근거는 [#348 결과](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/issues/348-response-schema/result.md)와 [D-184](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/decision/frontend-decisions.md)다. 전사 의심 사유는 부가 정보이므로 잘못된 항목만 버리는 예외를 [#643](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/issues/643-asr-suspect-reason/result.md)에 따로 기록했다. 검증 수준을 필드의 영향에 맞춘 사례다.

## 메시지 변경 신호를 받아도 새 글이 사라지는 문제

WebSocket 변경 신호 뒤 재조회해도 진행 중이던 첫 조회의 옛 응답이 뒤늦게 도착할 수 있었다. 초기 구현의 `cancelRefetch`만으로는 캐시 데이터가 없는 첫 조회를 취소하지 못했다.

`thread_updated` 신호에서는 진행 중 조회를 `cancelQueries`로 끊고 다시 조회한다. 소켓이 처음 열릴 때 진행 중인 조회는 완료를 기다린 다음 다시 조회한다. 끊긴 사이 놓친 신호는 재연결 시 재조회로 복구한다.

[#558 결과](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/issues/558-message-websocket/result.md)는 경합 회귀, Chromium·MSW, 가짜 BE를 이용한 Vite 프록시 검증을 기록한다. 실제 BE와 운영 Caddy를 거친 소켓 검증은 해당 기록의 미확인 범위다. 신호 수신과 최신 데이터 조회 완료를 구분해야 한다는 사례다.

## 승인 카드가 갱신돼도 폼이 옛 제안을 보여 주는 문제

서버에서 승인 카드가 합쳐지면 새 카드가 도착해도 처음 값으로 만든 폼이 남았다. PM이 고친 칸만 제출하는 구조에서는 고치지 않은 칸이 실제 승인될 값과 달라질 수 있었다.

카드 버전이 바뀌면 편집한 값은 보존하고 나머지 값과 기본값은 새 카드로 맞춘다. PM이 본 카드 버전을 제출하며 충돌 시 다시 확인한다. 충돌 확인 뒤 입력을 바꾸면 확인을 해제한다. 값을 원래대로 돌려도 옛 확인을 재사용하지 않는다.

[#512 결과](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/issues/512-merged-approval/result.md)와 [결정 원문](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m8/basis-for-decision/2026-11-08-merged-approval-recheck.md)은 카드 갱신·편집 유지 검증을 기록한다. 중간의 모든 변경 이력 대신 처음 본 카드와 현재 카드 차이를 보여 주는 한계가 있다.

## 화자 지정 대기를 실패로 판단해 추적을 멈추는 문제

FE가 `awaiting_speakers`를 기존 상태로 잘못 읽어 처리 추적을 끝냈다. 서버는 사람의 입력을 기다리는데 화면은 진행을 놓친 상태였다.

화자 지정 대기를 도메인 상태에 추가하고 추적을 유지했다. PM에게 지정 화면·목록·토스트 진입점을 제공한다. 대기 중 조회 간격을 늘려 불필요한 요청을 줄였다. 화자 지정이 끝나면 서버 처리를 이어간다.

[화자 지정 결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m5/basis-for-decision/2026-11-05-speaker-assignment-screen.md)에 상태 전이와 MSW·jsdom 검증이 있다. 실제 m4a 재생 지연은 당시 미확인이다. 사람의 입력을 기다리는 상태는 실패나 무한 로딩과 별도로 모델링해야 한다는 사례다.

## 간헐 E2E 실패를 재시도만으로 덮지 않은 사례

연결 해제 직후 새로고침하면 모의 연결 상태가 복원되는 문제가 있었다. MSW의 응답 통지 뒤에 DB를 저장해 HTTP 성공과 저장 완료 사이에 틈이 생겼다. resolver 완료 후 응답 전달 전 이벤트에서 저장하도록 순서를 바꿨다.

별도로 동작 줄이기 CSS의 짧은 transition이 원래 없던 포커스 전환을 만들었다. 전환 시간을 0으로 바꾸고 최초 포커스 시점부터 검사했다.

[#593 결과](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/issues/593-e2e-stability/result.md)는 알림 차단과 동작 설정 대조로 수정 전 실패·수정 후 통과를 기록한다. 당시 CI의 첫 실패 trace는 없어 최초 사건의 정확한 순서까지 확정하지 않았다. 후속 CI에서는 재시도로 통과한 보고서도 보존한다.

## 추가 사례를 찾는 곳

| 사례 | 원인·조치가 남은 원본 |
|---|---|
| 빠른 응답의 스켈레톤 번쩍임과 조건부 래퍼의 재마운트 | [로딩 결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m8/basis-for-decision/2026-11-07-skeleton-delay.md), [#508](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/issues/508-skeleton-delay/result.md). |
| 빌드는 통과하지만 `gap-0` 클래스가 생성되지 않음 | [#497](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/issues/497-spacing-zero/result.md). |
| 실제 API에 없는 메시지 기능을 MSW만 제공 | [실제 메시지 API 연결 결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m8/basis-for-decision/2026-11-04-messages-real-api-drop-unbacked-ui.md). |
| 휴대폰에서 셸과 업무 화면의 가로 넘침 | [#478](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/issues/478-mobile/result.md), [접근성·성능](a11y-performance.md). |

각 문제에서 비교한 대안과 현재 남은 대가는 [대안과 결정](tradeoffs-decisions.md)에서 이어 읽는다.
