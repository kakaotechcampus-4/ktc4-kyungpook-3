# 대안 비교와 결정 근거

2026-11-11 기존 결정 원문을 기준으로 정리했다. 새로운 과거 결정을 만들지 않는다. 아래 표는 당시 비교가 기록된 선택이며, 문제 해결 결과만 있는 사례에 임의의 대안을 붙이지 않았다.

## 개발 속도와 계약 정확성

| 문제·제약 | 비교한 대안 | 기록된 선택·이유 | 감수한 비용 | 근거 |
|---|---|---|---|---|
| BE·AI와 병렬로 화면 개발 | API 완성을 기다림, FE가 가정 계약·MSW로 먼저 개발 | 가정 계약을 문서화하고 entity에서 DTO를 변환한다. 실제 BE가 오면 대조한다. | 수동 계약·MSW가 실제 API와 달라질 수 있어 대조가 필요하다. | [D-159·D-160·D-172](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/decision/frontend-decisions.md), [계약 우선](contract-first-msw.md). |
| 생성 타입 없이 타입 단언만 존재 | 생성 타입·통합 검사에 의존, Zod 경계 검증 | D-184가 D-134의 전제를 대체했다. 응답 스키마를 DTO의 원본으로 둔다. | 스키마 유지 비용과 서버보다 엄격한 검증의 위험이 있다. | [D-184](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/decision/frontend-decisions.md), [#348](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/issues/348-response-schema/result.md). |
| 실제 서버에 없는 메시지 기능 | 화면 제거, MSW 전용 유지, 실제 계약에 맞춤 | 실제 계약에 맞춰 화면·핸들러·검사를 함께 조정한다. 후속 계약이 생긴 기능은 다시 연결한다. | 시안 일부 기능을 제공하지 못한다. | [실제 API 연결 결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m8/basis-for-decision/2026-11-04-messages-real-api-drop-unbacked-ui.md). |
| 같은 동작을 여러 검사 도구에서 관리 | Storybook 제거 후 검증을 옮길 위치 비교 | 상태·권한·요청은 RTL, 배치·색·hover·스크롤은 Playwright에 둔다. | 컴포넌트 탐색 화면이 사라진다. | [제거 결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m8/basis-for-decision/2026-11-07-remove-storybook.md), [#482](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/issues/482-remove-storybook/result.md). |

Storybook 자체의 유지·폐기를 재비교한 기록으로 해석하지 않는다. 제거 결정 후 검사 이동 방식을 비교한 기록이다.

## 사람이 확인한 내용과 서버 반영의 일치

| 문제·제약 | 비교한 대안 | 기록된 선택·이유 | 감수한 비용 | 근거 |
|---|---|---|---|---|
| 승인 수정용 임시 저장 API가 없음 | 수정 저장 후 승인, 승인 요청에 수정값 동봉 | 승인 시 한 요청으로 보낸다. 중간 저장 상태를 만들지 않는다. | 페이지를 떠나면 저장하지 않은 편집값이 사라진다. | [승인까지 수정값 유지](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m6/basis-for-decision/2026-10-11-approval-overrides-held-until-approve.md). |
| 편집·제출·충돌 확인의 정합 | 별도 상태 기계, 기존 mutation·편집 상태 활용 | 기존 mutation을 쓰고 입력 변경 시 확인 해제 규칙을 적용한다. | 모든 편집 경로가 같은 규칙을 지켜야 한다. | [충돌 확인 결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m6/basis-for-decision/2026-11-04-approval-edits-and-conflict-confirmation.md). |
| 합쳐진 카드 때문에 폼이 낡음 | 안내만, 409 때만 갱신, 버전 변경 응답마다 갱신 | 새 응답마다 편집값을 보존하며 폼을 맞춘다. `resetField`는 기본값이 남는 문제로 제외했다. | 중간 변경 전체를 보여 주지 않는다. | [카드 재확인 결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m8/basis-for-decision/2026-11-08-merged-approval-recheck.md). |
| 일반 태스크 PATCH는 버전·409를 제공하지 않음 | 마지막 저장 우선, 저장 전 조회, BE 버전 필드 추가 | 바뀐 필드만 저장하고 마지막 저장을 따른다. 사전 조회는 경합을 없애지 못한다. | 같은 필드의 동시 수정을 알리지 못한다. | [태스크 저장 결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m6/basis-for-decision/2026-11-07-task-detail-save-row-last-write-wins.md). |
| 신뢰도 숫자가 판단을 대신할 위험 | 점수 노출·정렬, 상태·이유·원문 중심 | BE 게이트에 따른 배지와 확인 사유를 표시한다. | 점수 기반의 세밀한 정렬을 제공하지 않는다. | [AI 결과 화면](ai-result-ui.md), [디자인 시스템](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/design/design-system.md). |

승인의 버전 충돌과 일반 태스크 수정은 다른 정책이다. 서버에 없는 충돌 방지를 FE가 보장한다고 설명하지 않는다.

## 갱신 속도와 요청·구현 비용

| 문제·제약 | 비교한 대안 | 기록된 선택·이유 | 감수한 비용 | 근거 |
|---|---|---|---|---|
| 메시지 변경을 화면에 반영 | 상시 polling, 알림 연동·초안 대기 polling, 후속 WebSocket 신호 | 소켓은 변경 신호만 보내고 데이터는 REST로 받는다. 알림과 조건부 polling을 보완 경로로 둔다. | REST 추가 조회와 소켓 수명 관리가 필요하다. 소켓 밖 화면의 갱신은 즉시가 아니다. | [메시지 갱신 결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m8/basis-for-decision/2026-11-06-message-sync-and-e2e.md), [#558](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/issues/558-message-websocket/result.md). |
| 화자 지정은 사람이 끝내야 함 | 짧은 polling 유지, 완전 중단, 간격 확대 | 대기 중에도 추적하되 30초 간격으로 확인한다. | 다른 PM의 지정을 늦게 볼 수 있다. | [화자 지정 결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m5/basis-for-decision/2026-11-05-speaker-assignment-screen.md). |
| 빠른 응답에서 로딩이 번쩍임 | 즉시 표시, 지연·최소 표시 | 높이를 유지하며 200ms 뒤 표시하고 한 번 보이면 최소 400ms 유지한다. | 데이터가 먼저 도착해도 내용 표시가 잠시 늦어진다. | [스켈레톤 결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m8/basis-for-decision/2026-11-07-skeleton-delay.md). |
| 폰트 요청이 첫 화면과 경쟁 | Bold preload 유지·제거, unicode-range 분할 | 기존 측정에서 Bold preload 제거를 적용하고 분할은 채택하지 않았다. | 굵은 글씨가 폴백 글꼴로 먼저 보일 수 있다. | [2026-11-05 측정 원문](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/performance/2026-11-05-font-loading-remeasure.md). |

폰트 판단은 해당 기록의 production 번들·headless Chromium·제한 네트워크 조건에 한정한다. 실제 휴대폰과 운영 서버 체감 성능을 새로 측정한 결과가 아니다.

## 결정에서 남은 구현 규칙

| 현재 규칙 | 문제와의 연결 | 코드·검증을 찾을 곳 |
|---|---|---|
| DTO 검증·변환을 요청 경계에 둔다. | 모르는 응답을 정상 데이터로 바꾸지 않기 위한 선택이다. | [구조](structure.md), [응답 스키마 결과](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/issues/348-response-schema/result.md). |
| 이전 세션의 쓰기는 요청과 후처리 모두 막는다. | 오프라인 재개와 계정 전환이 겹치는 문제를 막는다. | [세션 문제 사례](troubleshooting.md), [#594](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/issues/594-stale-session-writes/result.md). |
| PM이 본 버전과 실제 제출값을 함께 확인한다. | 새 카드·편집 변경 뒤 과거 충돌 확인을 재사용하지 않는다. | [AI 결과 화면](ai-result-ui.md), [#512](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/issues/512-merged-approval/result.md). |
| 완료 표시는 조회한 서버 상태를 따른다. | 업로드 완료·승인 성공을 전체 처리·외부 동기화 완료와 혼동하지 않는다. | [M5](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m5/result.md), [M6](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m6/result.md). |
| 모의 흐름과 실제 운영 성공을 구분한다. | MSW가 실제 API 차이를 숨기는 문제를 줄인다. | [검증 경계](verification.md), [대표 계약](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/contracts/frontend-api-contract.md). |

여러 마일스톤이 공유하는 결정 번호의 원본은 [제품·기술 결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/decision/frontend-decisions.md)이다. 새 결정은 그 원본과 마일스톤별 구현 기록에서 관리한다.
