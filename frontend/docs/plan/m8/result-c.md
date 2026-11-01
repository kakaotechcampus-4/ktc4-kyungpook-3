# M8-C 구현 결과 — 메시지

- 기록일: 2026-10-31 (2026-11-01 디자인 캔버스 기준 재작업과 검증 VR-C 발견 수정 반영)
- 이슈: #245
- 대상: [M8 계획](plan.md) C 절의 구현 순서 1~6(결정 전)과 최종 게이트, 2026-11-01 사용자 결정(결정 4의 UI 범위 = 디자인 캔버스 기준, MSW 목)에 따른 재작업
- 상태: **AC-01~AC-07 충족(프론트·MSW 기준, UI/UX만), 목록·보내기 전 확인·대화·빈 상태가 디자인 캔버스의 항목·문구·상태와 일치(차이표, 남은 차이 4개는 아래).** 메시지 API가 없어 화면은 MSW 모드에서만 보이고, 실 API 모드와 production은 기존 「메시지는 준비 중이에요」 안내를 그대로 둔다. 보내기 전 확인의 행동(발송·보내지 않음·고쳐 쓰기·발송 시점, 대화의 승인·반려)은 MSW 목으로 서버 성공 뒤 반영한다. 권한 분기·상태 동기화(polling)·메시지 E2E는 하지 않았다. 전체 `test:e2e`는 실행하지 않았다. 실제 메시지 API 연동과 Discord 발송은 범위 밖이며 검증하지 않았다.

## 2026-11-01 재작업 — 디자인 캔버스 기준

### 근거와 요약

사용자가 메시지 화면을 디자인 캔버스([Messages](../../design/canvas/Messages.dc.html)·[MessagesThread](../../design/canvas/MessagesThread.dc.html)·[EmptyMessages](../../design/canvas/EmptyMessages.dc.html), 보조 [디자인 시스템](../../design/design-system.md))와 비교해 상세 영역이 많이 비어 있다고 보고 디자인대로 재작업하라고 했다(코디네이터 지시, 2026-11-01). 서버가 지켜야 할 정책이 아닌 UI는 MSW 목으로 디자인대로 만들고, 이전에 「결정 4 뒤로 보류」·「의도적으로 뺐다」고 적은 항목도 구현했다. 이것을 결정 4의 UI 범위에 대한 사용자 결정으로 [기록](basis-for-decision/2026-11-01-message-ui-scope-design-canvas-msw.md)했다. 서버 연동·계약 문서는 만들지 않았다.

계획 [plan.md](plan.md)는 여전히 커밋되지 않은 작업 트리 변경이며 이번 작업도 수정하지 않았다(작업 시작·종료 SHA256 `c054a4f6…cd4194` 같음). 계획 C-6의 7(발송 검토 흐름)은 이 사용자 결정으로 화면·MSW 목 수준까지 구현했고, 8(권한 분기)·9(상태 전이와 동기화·polling)·10(메시지 E2E)은 하지 않았다.

| 커밋 | 요지 |
|---|---|
| `13151bf` | 임시 DTO·도메인 타입에 시안 항목(역할, Discord 주소, 답장 대기 시작 시각, 승인 대기, 메시지 상태·발송 방식·승인자, 마감·사유·근거 링크·발송 시점) 추가, 행동 요청 `requestMessageReviewAction`, MSW handler 행동 3개(PATCH·send·dismiss)와 시나리오 `messages-send-fail`, 모의 DB 저장 버전 3→4, `features/message-review`(행동 훅·실패 알림) |
| `c542a0f` | 보내기 전 확인([ReviewDetail](../../../src/widgets/message-inbox/ui/ReviewDetail.tsx)·[ReviewMessageCard](../../../src/widgets/message-inbox/ui/ReviewMessageCard.tsx)·[SendTimingPicker](../../../src/widgets/message-inbox/ui/SendTimingPicker.tsx)), 대화([ThreadDetail](../../../src/widgets/message-inbox/ui/ThreadDetail.tsx)), 목록·기본 선택·빈 상태 액션([MessageInbox](../../../src/widgets/message-inbox/ui/MessageInbox.tsx)), 아이콘 4개(`edit`·`send`·`clock`·`link-out`), 통합 테스트·스토리 |
| `bbccc5f` | 저장 버전 기대값 3→4([taskScenarios.test.ts](../../../src/shared/mock/taskScenarios.test.ts), [restore.e2e.ts](../../../e2e/restore.e2e.ts)) |
| `d058561` | [MSW 안내](../../msw-guide.md)의 메시지 절(행동 경로, `messages-send-fail`, 기본 선택, 상대 표기와 날짜) |
| `ee14e91` | [결정 기록](basis-for-decision/2026-11-01-message-ui-scope-design-canvas-msw.md) |

### 디자인 차이표

시안 날짜(9/11 금, 마감 9/17)는 픽스처 기준 시각 MOCK_NOW(2026-09-18 금 09:00)로 한 주 옮겼다(마감 9/24, 마감 하루 전 9/23 09:00). 이름·봇 이름은 픽스처 값(`이재환`, `카테캠 3팀`)이다.

| 화면 | 시안 항목 | 2026-10-31 구현 | 지금 |
|---|---|---|---|
| 보내기 전 확인 | 카드 머리 Discord 표식 | 없음 | 있음([DiscordGlyph](../../../src/widgets/message-inbox/ui/DiscordGlyph.tsx)) |
| 보내기 전 확인 | 봇 아바타 매스 마스코트 | 먹색 원 + 첫 글자 | 매스 34px(`Mascot`) |
| 보내기 전 확인 | 봇 이름 옆 `09/16 09:00 예정` | 없음 | `09/23 09:00 예정`, 지금 바로면 `바로 발송` |
| 보내기 전 확인 | 카드 밑단 `문구는 그대로 고칠 수 있어요` + `고쳐 쓰기` | 없음 | 있음. 누르면 문구 칸·글자 수·`취소`·`저장`, 저장은 서버 성공 뒤 반영 |
| 보내기 전 확인 | `왜 보내려 하나요` 박스 + `마지막 메시지 보기` | 없음 | 있음. 근거 링크가 없는 항목은 링크를 숨김 |
| 보내기 전 확인 | `언제 보낼까요?` 세 카드(마감 하루 전 · 지금 바로 · 직접 정하기) | 없음 | 있음. 라디오 카드, 고른 카드는 서버 값. 마감이 없으면 `마감 하루 전` 비활성(`마감 없음`), `직접 정하기`는 날짜·시각 입력 후 저장 |
| 보내기 전 확인 | `보내지 않음` · `이대로 발송` | 없음 | 있음. 서버 성공 뒤 목록에서 빠지고 다음 항목이 골라짐 |
| 보내기 전 확인 | `보낸 메시지는 되돌릴 수 없습니다. 이 화면에는 다른 작업을 두지 않았어요.` | 없음 | 있음 |
| 대화 | 머리 부제 `백엔드 · Discord 개인 메시지 · 캡스톤 5조 봇으로 보냄` | `Discord 개인 메시지` | `백엔드 · Discord 개인 메시지 · 카테캠 3팀 봇으로 보냄`(채널은 `Discord 채널 · …`) |
| 대화 | 머리 배지 강조색 면 흰 글자 `답장 3일째 없음` | 회색 `답장 기다리는 중` | 강조색(`bg-accent`) `답장 3일째 없음` |
| 대화 | `Discord에서 열기` + 바깥 링크 아이콘 | 없음 | 있음(새 창, 목 주소) |
| 대화 | 봇 말풍선 시각 줄 `09:02 · 자동 발송`, `18:00 · 지훈 승인` | 시각만 | `09:02 · 자동 발송`, `18:00 · 최진호 승인` |
| 대화 | 답장 없음 칩(시계 아이콘 + `여기서부터 답장이 없습니다 — 오늘로 3일째예요`) | `여기서부터 답장을 기다리고 있어요` | 시안 문구 그대로 |
| 대화 | 오늘 묶음의 점선 `발송 예정` 말풍선 + `반려`·`승인` | 없음 | 있음. 승인하면 `09/23 09:00 발송 예정 · 최진호 승인` 예약 말풍선이 됨 |
| 대화 | 아래 안내 바 `메시지는 항상 … 봇이 보냅니다. 직접 입력하는 대신 승인 대기 중인 1건을 확인해 주세요.` + `확인하기` | 없음 | 있음. 승인 대기가 없으면 `지금 승인을 기다리는 메시지는 없어요.`(시안에 없는 상태) |
| 목록 | 보내기 전 확인 행 오른쪽 `09/17 마감` · `3일 전` | 만든 날짜(`09/17`) | `09/24 마감` · `3일 전`(오늘 기준 상대 표기) |
| 목록 | `/messages` 기본 진입 때 첫 확인 항목 선택 | 안내문만 | 첫 항목 선택(`review` 파라미터가 없을 때) |
| 빈 상태 | `알림 규칙 보기` 버튼 | 없음 | 있음. 알림 규칙 화면이 없어 가장 가까운 팀 설정(`/settings`)으로 감 |
| 공통(유지) | 목록 308px 2단, 말풍선·날짜 구분선, 빈 상태 문구·레이아웃 | 같음 | 같음 |
| 시안 밖(유지) | 미선택 안내문, 영역별 빈 안내, 목록·대화 오류, 빈 대화, 로딩 스켈레톤, 없는 대화 | 있음 | 유지. 시안과 충돌하지 않음 |

#### 디자인과 아직 다른 점

- **헤더 `메시지 2`·`태스크 3` 개수 배지** — 앱 셸(헤더)의 집계라 이번 범위 밖이다(계획 C-2 제외 범위, 집계 API 필요).
- **사유 문장의 날짜·채널 강조** — 시안은 `9/17`·`#개발`을 숫자 글꼴·흐린 색으로 구분한다. 서버가 한 문장으로 주는 값이라 구현은 같은 글자색이다.
- **이름** — 시안은 `재환`·`캡스톤 5조`, 구현은 픽스처의 `이재환`·`카테캠 3팀`. 데이터 값의 차이다.
- **1024px 미만** — 시안이 없고 D-124로 범위 밖이다. 390px에서는 앱 헤더가 651px라 페이지가 가로로 넘치고 목록 308px 옆 상세가 좁아진다(아래 측정).

### 동작 — MSW 목과 그 한계

- **서버 성공 뒤 반영(D-137)** — [행동 훅](../../../src/features/message-review/model/useMessageReviewAction.ts)은 요청이 성공하고 메시지 캐시(목록·대화)를 다시 받은 뒤에야 끝난다. 낙관적 갱신은 없다. 요청 중에는 그 화면의 행동이 모두 잠기고(`aria-busy`), 같은 틱의 두 번째 누름도 `isMutating`으로 막는다.
- **실패** — 그 자리에 role=alert와 `다시 시도`(같은 요청을 다시 보냄)를 둔다([ReviewActionFailure](../../../src/features/message-review/ui/ReviewActionFailure.tsx)). 항목이 이미 처리됐거나 없으면(404) 다시 시도 대신 `목록 새로 받기`를 둔다 — 바로 다시 받으면 항목과 함께 알림 자리도 사라지기 때문이다.
- **성공 알림** — 토스트 `09/23 09:00에 이재환님에게 보낼게요`, `정하늘님에게 메시지를 보냈어요`, `이재환님에게 보낼 메시지를 보내지 않기로 했어요`.
- **MSW 목의 한계(확정 정책 아님)** — 발송 권한은 소속 팀원 누구나(PM 전용 여부 미정), 예약 시각이 지나도 메시지가 스스로 나가지 않음(MOCK_NOW 고정), 「며칠째」는 서버가 준 답장 대기 시작 시각에서 화면이 보낸 날을 1일째로 셈, `Discord에서 열기`·`마지막 메시지 보기`는 실제 대화가 없는 목 Discord 주소, 대화 화면의 `승인`·`반려`와 보내기 전 확인의 `이대로 발송`·`보내지 않음`은 같은 요청이다(어느 쪽이 검토 장소인지는 미정, 계획 C-10). 상태 동기화(polling, D-136)는 없다 — 행동 성공 뒤 무효화만 한다.
- **상대 표기와 날짜** — `3일 전`·`답장 N일째 없음`·`지금 바로`의 `금요일 아침`은 기기의 오늘로 계산한다. 테스트는 시계를 MOCK_NOW로 고정했다. 개발 서버를 실제 날짜로 열면 숫자가 시안과 다르다(Storybook play는 숫자를 단언하지 않는다).

### 바꾼 기존 단언과 이유

2026-11-01 검증 발견 수정(아래 절)에서 바꾼 단언은 그 절의 표에 따로 적었다.

| 위치 | 이전 | 지금 | 이유 |
|---|---|---|---|
| [messagesMsw.test.tsx](../../../src/app/messagesMsw.test.tsx) AC-02 첫 사례 | 고르기 전 상세는 안내문 | 첫 확인 항목이 골라짐 | 시안의 기본 진입 상태. 안내문은 확인 항목이 없을 때의 새 사례로 옮김 |
| 같은 파일 AC-02 검토 선택 | 읽기 전용, 버튼 없음 | 시안 항목·문구·버튼 전부 | 결정 4의 UI 범위 결정 |
| 같은 파일 AC-03 | `9월 8일`·`9월 10일`, 시각만, `답장 기다리는 중`, 자동 발송·승인·예정·Discord 링크 없음 | `9월 15일`·`9월 16일`·`오늘`, 시각 줄, `답장 3일째 없음`, 칩, 승인 대기, 안내 바 | 시안 항목 구현, 「3일째」가 되도록 픽스처 날짜를 옮김 |
| 같은 파일 AC-04 빈 상태 | `알림 규칙 보기` 없음 | 팀 설정 링크 | 시안 버튼 구현 |
| 같은 파일 AC-07 Tab 사례 | 이재환 검토 행으로 이동해 선택 | 정하늘 검토 행 | 이재환 항목이 기본 선택이라 눌러도 주소가 바뀌지 않음 |
| [mapper.test.ts](../../../src/entities/message/model/mapper.test.ts) | 화면이 마지막 메시지로 답장 대기를 계산 | 서버가 준 시작 시각을 그대로 옮김 | 답장 대기 판정을 handler로 옮김(며칠째 계산의 기준 시각이 필요) |
| [messageScenarios.test.ts](../../../src/shared/mock/messageScenarios.test.ts) | 조회만 | 행동·검증·실패 시나리오 추가 | 행동 handler 추가 |
| 저장 버전 3 기대값 2곳 | 3 | 4 | MockDb 모양 변경(파일 규칙) |
| [MessageInbox.stories.tsx](../../../src/widgets/message-inbox/ui/MessageInbox.stories.tsx) `검토_항목` | 버튼 없음 | 버튼·시점·사유 있음 | 같은 이유. 스토리 `고쳐_쓰기`·`발송_실패`·`대화_승인` 추가(모두 `M8 메시지/화면`) |

### 검증 (2026-11-01)

Node v24.11.0, 기준 커밋 `ee14e91`. 무거운 명령은 직렬화 wrapper로 하나씩 돌렸다.

| 명령 | 종료 코드 | 결과 |
|---|---:|---|
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm run format:check` | 0 | frontend 전체 |
| 메시지 대상 테스트 5파일 | 0 | 단위 3파일 38개, `messagesMsw`·`messagesActionsMsw` 47개 통과 |
| `npm run test -- --maxWorkers=2` | 1 | 164파일 중 163, 1884개 중 1883 통과. 실패 1개는 메시지와 무관한 `meetingProcessing.test.tsx` 「StrictMode 에서도 재렌더·탭 이동이 목록·상세 요청을 늘리지 않는다」의 5000ms 시간 초과(전체 2489초 실행 중 부하) |
| `npm run build` | 0 | |
| `STORYBOOK_E2E_PORT=6213 npm run test:storybook` | 결과 없음 | 정적 빌드 뒤 실행 도중 시스템 메모리 부족으로 Claude Code가 백그라운드 셸을 강제 종료했다. M8 블록(`M8 메시지/화면` 11개 스토리 play)을 포함해 끝까지 돌지 못했다 |

남은 확인: `test:storybook` 전체와 `meetingProcessing.test.tsx` 단일 재실행은 메모리 여유가 있을 때 다시 돌려야 한다. 하네스가 메모리 부족 뒤 임의 재시작을 막아 코디네이터에게 물었으나 30분 안에 답이 없어 이 상태로 기록했다.

#### 디자인과 나란히 비교 (Playwright)

이미 떠 있는 `VITE_ENABLE_MSW=true` 개발 서버(포트 5223)를 저장소 밖 임시 스크립트로 열었다(Chromium headless, `ko-KR`, `Asia/Seoul`, 높이 1000, 시계 MOCK_NOW 고정). 상태는 ① `messages-default` 기본 진입(첫 항목 선택) ② `th_01` 대화 ③ `messages-empty` ④ `?review=rv_02`이고, 캔버스 HTML 세 장을 같은 폭으로 찍어 나란히 봤다.

| 너비 | 네 상태의 문서 `scrollWidth / clientWidth` | `scrollHeight / clientHeight` | pageerror |
|---:|---|---|---|
| 1024 | 모두 1024 / 1024 | 모두 1000 / 1000 | 0 |
| 1360 | 모두 1360 / 1360 | 모두 1000 / 1000 | 0 |
| 390 | 모두 651 / 390 | ① 1065 / 1000, 나머지 1000 / 1000 | 0 |

1024·1360px 스크린샷에서 위 차이표의 「지금」 항목이 시안과 같은 자리·문구로 보이는 것을 직접 확인했다(카드 머리·매스·예정 시각·고쳐 쓰기·사유 박스·세 카드·행동 줄·안내, 대화 머리·배지·Discord 링크·시각 줄·칩·점선 말풍선·`반려`/`승인`·안내 바, 빈 상태 버튼). 390px은 범위 밖(D-124)이며 앱 헤더 때문에 가로로 넘친다. 비교 뒤 `마감 없음` 카드가 고를 수 있는 카드와 같아 보이는 것을 발견해 눌린 면·흐린 글자로 구분했다(`c542a0f`에 포함).

## 2026-11-01 검증 발견 수정 (VR-C R2)

### 근거와 처리

검증 에이전트 VR-C가 HEAD `2ad7836`을 검증해 FAIL(major 1 · minor 8)을 남겼다(보고서는 저장소 밖 작업 폴더). 코디네이터 지시로 발견마다 코드에서 재현한 뒤 회귀 테스트를 먼저 더하고 고쳤다. 새 사례와 바꾼 사례 10건은 수정 전 코드에서 실패했다(VR-01~04). 반박하거나 보류한 발견은 없다.

| 발견 | 내용 | 처리 | 커밋 | 회귀 테스트 |
|---|---|---|---|---|
| VR-01 major | `직접 정하기`를 연 채(시각 미저장) `이대로 발송`이 즉시 발송으로 나감 | 시각 칸이 열린 상태를 [ReviewDetail](../../../src/widgets/message-inbox/ui/ReviewDetail.tsx)로 올려(`choosingTime`) 열린 동안 `이대로 발송`·`보내지 않음`·`고쳐 쓰기`를 잠그고, 안내 `정한 시각을 저장하거나 취소한 뒤에 보낼 수 있어요.`를 `aria-describedby`로 잇는다 | `804eac2` | [messagesActionsMsw](../../../src/app/messagesActionsMsw.test.tsx) 「직접 정하기를 연 동안에는 … 잠기고, 취소하면 풀린다」(누름이 요청 0건) |
| VR-02 minor | 저장한 `직접 정하기` 시각을 다시 열 수 없음(checked 라디오는 change 없음) | `직접 정하기` 라디오의 누름(click, Space 포함)으로도 시각 칸을 연다. 저장된 시각이 채워진다 | `804eac2` | 「저장한 직접 정하기 시각은 그 카드를 다시 눌러 고칠 수 있다 — 마우스와 Space 모두」 |
| VR-03 minor | 화살표 키 이동만으로 발송 시점이 저장되고, 저장 중 포커스가 BODY로 떨어짐 | 화살표는 카드 사이로 포커스만 옮기고(끝에서 처음으로, `마감 없음` 건너뜀) Space·누름으로만 고른다. 요청 중 잠금은 `fieldset disabled` 대신 라디오의 `aria-disabled` + 조기 반환. [기록](basis-for-decision/2026-11-01-send-timing-arrow-keys-move-focus-only.md) | `804eac2` | 「화살표 키는 카드 사이를 옮겨 다닐 뿐 저장하지 않는다」, 「… 고를 수 없는 카드(마감 없음)를 건너뛴다」, 「지금 바로를 누르면 …」에 포커스·`aria-disabled` 단언 |
| VR-04 minor | 행동 뒤 포커스가 BODY로 사라짐 | 문구 칸을 열면 그 칸, 닫으면(취소·저장 성공) `고쳐 쓰기`, 시각 칸을 닫으면 `직접 정하기` 카드로 포커스. 요청 중인 버튼은 [LockedButton](../../../src/widgets/message-inbox/ui/LockedButton.tsx)(`aria-disabled` + 누름 버림)으로 포커스를 남기고 실패해도 그 버튼에 있다. 발송·보내지 않음 성공 뒤에는 상세 칸(`메시지 내용`, `tabIndex=-1`)이 포커스를 받는다 — 대화의 승인·반려 성공 뒤 `대화 내용`으로 옮기는 것과 같은 방식 | `804eac2` | 발송·보내지 않음·고쳐 쓰기·발송 시점·대화 승인/반려 사례의 `document.activeElement` 단언, 스토리 `고쳐_쓰기` play의 문구 칸 포커스 |
| VR-05 minor | 발송 시점 카드 포커스 선 offset +4px | 테두리 위 `-1`, 고른 먹 면 카드는 안쪽 흰 선 `-3`(디자인 시스템 §3-3) | `9add5ac` | [messagesMsw](../../../src/app/messagesMsw.test.tsx) 「… 포커스 선은 테두리 위(-1) …」 |
| VR-06 minor | 목록 영역 라벨 700(시안 400) | `font-normal` | `9add5ac` | 「목록 영역 라벨은 400 이다」 |
| VR-07 minor | `보내지 않음` 좌우 22px(시안 18), `이대로 발송` 아이콘 간격 6px(시안 8) — `className` 덮어쓰기가 생성 CSS 순서에 져서 적용되지 않음 | 공용 [Button](../../../src/shared/ui/button/Button.tsx) 크기 표에 `message-dismiss`(44 · 좌우 18 · 14px)·`message-send`(44 · 좌우 24 · 간격 8 · 14.5px)를 더하고 `className` 덮어쓰기를 지웠다. 간격(gap)은 BASE에서 빼 크기마다 하나만 고른다([클래스 병합을 쓰지 않는 결정](../m2/basis-for-decision/2026-09-16-no-cn-clsx-tailwind-merge.md)의 「시각은 size가 API」) | `9add5ac` | 「보내기 전 확인의 버튼은 캔버스 크기 …」, [Button.test](../../../src/shared/ui/button/Button.test.tsx) 새 크기 사례와 「크기마다 간격 하나」 |
| VR-08 minor | 대화 `반려`·`승인` 14px(시안 13), `반려` 좌우 20(시안 16) | `message-thread-dismiss`(36 · 좌우 16 · 13px)·`message-thread-approve`(36 · 좌우 20 · 13px) | `9add5ac` | 「대화의 반려·승인은 13px …」 |
| VR-09 minor | `고쳐 쓰기`·`취소`·`저장`·`이 시각으로 정하기`·시각 칸 `취소`가 32px | `고쳐 쓰기`는 `message-edit`(36 · 좌우 11 · 12px), 나머지 넷은 제품 기본 `md`(36) | `9add5ac` | 「보내기 전 확인의 버튼은 … 모두 36px 이상이다」 |

VR-08을 재현하다 공용 문제를 하나 찾았다. `text-control`(토큰 13px)은 같은 이름의 색 토큰 `--color-control`이 있어 Tailwind가 **색**(`color: var(--color-control)`)으로 생성한다. 그래서 `sm`·`md` 등 `text-control`을 쓰는 버튼은 글자 크기를 받지 못하고 body의 14px로 그려진다(브라우저 생성 CSS에서 확인). 메시지 크기 5개는 13px를 `text-(length:--text-control)`로 적어 피했다. 앱 전체 버튼(29곳 이상이 `text-control`을 씀)을 바꾸는 일은 이번 범위 밖이라 그대로 두었다 — 아래 「남은 작업」.

### 브라우저 확인 (2026-11-01)

수정 뒤 `VITE_ENABLE_MSW=true` 개발 서버(포트 5213)를 Playwright(Chromium, 1360×1000)로 열어 계산 값과 포커스를 쟀다. 서버·브라우저는 측정 뒤 닫았다.

| 대상 | 수정 전 | 수정 뒤 | 캔버스 |
|---|---|---|---|
| `보내지 않음` | 44 · 좌우 22 · 14px | 44 · 좌우 18 · 14px | 44 · 18 · 14px |
| `이대로 발송` | 간격 6 | 간격 8 · 좌우 24 · 14.5px | 8 · 24 · 14.5px |
| `고쳐 쓰기` | 32 · 좌우 12 · 12px | 36 · 좌우 11 · 12px | 36 · 11 · 12px |
| 목록 라벨 `보내기 전 확인 N` | 700 | 400 | 400 |
| 대화 `반려` / `승인` | 14px · 좌우 20 / 14px · 20 | 13px · 16 / 13px · 20 | 13px · 16 / 13px · 20 |
| `저장`·`이 시각으로 정하기` | 32 | 36 | (시안 없음, 제품 최소 36) |
| 발송 시점 카드 포커스 선 | 먹 선, offset +4 | 고르지 않은 카드 먹 선 음수 offset, 고른 먹 면 카드 흰 선 음수 offset | 디자인 시스템 §3-3 |

동작: `마감 하루 전`에서 ArrowRight·ArrowLeft 뒤 PATCH 0건이고 `마감 하루 전`이 그대로 골라져 있었다. `직접 정하기`를 연 채 `이대로 발송`은 `aria-disabled="true"`이고 강제로 눌러도 발송 요청 0건이었다. `document.activeElement`는 문구 칸 열기 → TEXTAREA, 취소 → `고쳐 쓰기`, 시각 칸 취소 → `직접 정하기` 라디오, 발송 응답 대기 중 → `이대로 발송`, 성공 뒤 → `메시지 내용` 칸이었다.

### 바꾼 기존 단언과 이유

| 위치 | 이전 | 지금 | 이유 |
|---|---|---|---|
| [messagesActionsMsw.test.tsx](../../../src/app/messagesActionsMsw.test.tsx) 요청 중·고치는 중 잠금 10곳(`이대로 발송`·`보내지 않음`·`고쳐 쓰기`·`지금 바로` 라디오·`반려`) | `toBeDisabled()` | `aria-disabled="true"` | 잠금을 포커스를 남기는 `aria-disabled`로 바꿨다(VR-03·VR-04). `toBeDisabled`는 네이티브 `disabled`만 본다 |
| 같은 파일 실패·저장 뒤 풀림 3곳 | `toBeEnabled()` | `aria-disabled` 없음 | 같은 이유 — `toBeEnabled`는 `aria-disabled`가 있어도 통과해 잠금 해제를 가리지 못한다 |
| [MessageInbox.stories.tsx](../../../src/widgets/message-inbox/ui/MessageInbox.stories.tsx) `고쳐_쓰기` | `이대로 발송` `toBeDisabled()` | `aria-disabled="true"`, 문구 칸 포커스 | 같은 이유, VR-04 회귀 |
| [Button.tsx](../../../src/shared/ui/button/Button.tsx) BASE | `gap-6` | 크기 표마다 `gap-6`(메시지 발송만 `gap-8`) | 기존 크기 사례는 그대로 통과한다. 그 밖의 렌더 결과는 같다 |

jsdom은 `disabled`가 된 요소에서 포커스를 빼지 않는다. 그래서 `document.activeElement` 단언만으로는 예전 결함이 잡히지 않고(대화 `반려` 실패 사례는 수정 전에도 통과했다), 잠금이 `aria-disabled`인지 함께 단언한다.

### 검증

Node v24.11.0, 수정 커밋 `804eac2`·`9add5ac`·`fe86a28`(주석) 뒤 작업 트리. 무거운 명령은 직렬화 wrapper로 하나씩 돌렸다.

| 명령 | 종료 코드 | 결과 |
|---|---:|---|
| 수정 전 `npx vitest run src/app/messagesActionsMsw.test.tsx` | 1 | 재현 — 새·바뀐 사례 10건 실패, 9건 통과 |
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm run format:check` | 0 | |
| 메시지·버튼 대상 4파일(`messagesMsw`·`messagesActionsMsw`·`widgets/message-inbox`·`shared/ui/button`) | 0 | 116개 통과 |
| `npm run test -- --maxWorkers=2` | 0 | 164파일 · 1911개 모두 통과, 573초. 이번에는 시간 초과가 없었다 |
| `npm run build` | 0 | 생성 CSS 경고 1건은 기존 `[color:var(...)]`([M2 기록](../m2/basis-for-decision/2026-09-16-docs-prose-makes-the-build-warn.md)). `dist/assets/*.js`에 `보내기 전 확인`·`이 메시지, 보낼까요` 0건 |
| `STORYBOOK_E2E_PORT=6213 npm run test:storybook` | 0 | 116개 모두 통과(M8 블록 12개: index 확인 + `M8 메시지/화면` 스토리 11개 play) |

메시지 E2E는 더하지 않았다(D-117). 전체 `test:e2e`는 실행하지 않았다.

## 작업 근거와 요약 (2026-10-31 결정 전 부분)


코디네이터 지시에 따라 계획 C-6의 결정 전 단계 1~6을 구현했다. 브랜치 `feature/245-m8-messages`, 기준 `develop`(`ff9467e`) 위 커밋 8개다. push·PR은 하지 않았다.

계획 파일 [plan.md](plan.md)는 이 브랜치에서 **커밋되지 않은 작업 트리 변경**으로만 있다(커밋된 파일은 0바이트). 구현·검증·이 문서 작업 모두 계획 파일을 수정하지 않았다. 최종 게이트 검증의 시작·종료 SHA256은 `c054a4f6…cd4194`로 같았고, 이 문서 작업의 시작 시점 값도 같다.

| 커밋 | 단계 | 요지 |
|---|---|---|
| `277f09f` | 1 | `MessagesPage` 모드 분기(`import.meta.env.DEV && config.mswEnabled`), `messages/*` 아래 하위 경로(index · `threads/:threadId` · `*`), 경로 함수 `paths.messageReview`·`paths.messageThread`와 `MESSAGE_PARAMS`(임시·계약 아님 주석) |
| `7c97fa1` | 2 | 임시 DTO, `entities/message`(타입·매퍼·Query, key에 `workspaceId`), 픽스처·조회 handler 2개·메모리 DB 칸 3개·시나리오 4개, 모의 DB 저장 버전 2→3, MSW 안내 문장 갱신 |
| `e8f99f6` | 3 | `widgets/message-inbox`: 2단 레이아웃, 목록 두 영역(`보내기 전 확인 N`, `대화`·`답장 기다리는 중 N`, 채널), 검토 항목 읽기 전용 미리보기, URL 선택 |
| `16676c1` | 4 | 대화: 날짜 구분선(오늘 표시), 봇·상대 말풍선, 시각, 답장 대기 배지·안내 |
| `8c5b665` | 5 | 빈 상태(`EmptyMessages`), 목록·대화·검토 스켈레톤, 목록 오류와 대화 오류 분리, 없는 대화·잘못된 경로 안내 |
| `351a70e` | 6 | 목록·대화 각자 스크롤, 대화 칸 키보드 Tab 자리, AC-07 테스트, Storybook 스토리 8개 |
| `765e37a` | 회귀 | `e2e/restore.e2e.ts`의 저장 버전 기대값 2→3 |
| `58237a8` | 리뷰 수정 | 첫 메시지 시각을 읽을 수 없으면 날짜 구분선 없이 묶는다(V2-01) |

## 실제 구현 및 관련 코드

- **모드 분기** — [MessagesPage](../../../src/pages/messages/ui/MessagesPage.tsx)는 개발 서버 + MSW일 때만 새 화면을, 그 밖에는 기존 준비 중 안내를 그린다. `DEV`를 먼저 봐서 번들러가 새 화면 코드를 production 번들에서 지우게 했다. [기록](basis-for-decision/2026-10-31-messages-screen-msw-mode-only.md).
- **URL 선택** — 사람별 대화는 경로 `messages/threads/:threadId`, 보내기 전 확인 항목은 검색 파라미터 `messages?review=<id>`로 고른다([경로 함수](../../../src/shared/config/routes.ts)). URL 값은 페이지 경계에서 `parseRouteId`로 한 번 검증한다(D-132). 목록에 없는 id·모양이 틀린 id는 선택 없음으로 처리한다. [기록](basis-for-decision/2026-10-31-message-review-selection-search-param.md).
- **임시 엔티티** — [entities/message](../../../src/entities/message): 도메인 타입, DTO→도메인 [매퍼](../../../src/entities/message/model/mapper.ts), 조회 [Query](../../../src/entities/message/api/messageQueries.ts)(key에 `workspaceId`, AbortSignal 전달)와 2026-11-01에 더한 행동 요청 `requestMessageReviewAction`. 답장 대기는 handler가 「상대의 마지막 답 뒤에 처음 나간 봇 메시지의 시각」으로 주고, 화면이 보낸 날을 1일째로 며칠째를 센다(2026-11-01 이전에는 화면이 마지막 메시지로 대기 여부만 정했다). DTO는 [shared/types/api/message.ts](../../../src/shared/types/api/message.ts)에 있고 화면 계층은 DTO를 import하지 않는다.
- **MSW** — [handler](../../../src/shared/mock/handlers/message.ts)는 조회 `GET /api/v1/workspaces/:workspaceId/messages`, `GET /api/v1/workspaces/:workspaceId/messages/threads/:threadId`와 2026-11-01에 더한 행동 `PATCH …/messages/reviews/:reviewId`, `POST …/reviews/:reviewId/send`, `POST …/reviews/:reviewId/dismiss`다. 공간 ID로 걸러 다른 공간의 대화는 404다. 없는 대화의 오류 코드 `MESSAGE_THREAD_NOT_FOUND`도 임시이며 화면은 상태 404만 본다. [픽스처](../../../src/shared/mock/fixtures/message.ts), [메모리 DB](../../../src/shared/mock/db.ts)의 `messageReviews`·`messageThreads`·`messageFailures`, 시나리오 `messages-default`·`messages-empty`·`messages-list-error`·`messages-thread-error`와 2026-11-01의 `messages-send-fail`([scenarios.ts](../../../src/shared/mock/scenarios.ts)). MockDb 모양이 바뀌어 [persistence.ts](../../../src/shared/mock/persistence.ts)의 `MOCK_DB_VERSION`을 2→3으로, 2026-11-01에 다시 4로 올렸다(파일 규칙 「MockDb 모양을 바꾸면 버전을 올린다」).
- **화면** — [widgets/message-inbox](../../../src/widgets/message-inbox): [MessageInbox](../../../src/widgets/message-inbox/ui/MessageInbox.tsx)(2단·목록·빈 상태·목록 오류), [ThreadDetail](../../../src/widgets/message-inbox/ui/ThreadDetail.tsx)(대화·대화 오류·404·승인 대기·안내 바), 보내기 전 확인 [ReviewDetail](../../../src/widgets/message-inbox/ui/ReviewDetail.tsx)(2026-10-31의 읽기 전용 `ReviewPreview`를 대신함), [MessageSkeletons](../../../src/widgets/message-inbox/ui/MessageSkeletons.tsx), 날짜·시각 [format.ts](../../../src/widgets/message-inbox/lib/format.ts). 목록 Query와 대화 Query는 서로 기다리지 않는다.
- **스크롤 칸** — 목록과 대화가 각자 세로로 스크롤한다. 구현 중 첫 측정에서 문서 높이가 5955px로 늘어 페이지가 세로로 스크롤되는 것을 발견했다. 말풍선·행의 `sr-only`(absolute) 글자가 스크롤 칸 밖으로 새어 나간 것이라 스크롤 칸을 `relative`로 고쳤다(`351a70e`).
- **스토리** — [MessageInbox.stories.tsx](../../../src/widgets/message-inbox/ui/MessageInbox.stories.tsx)(`M8 메시지/화면`): 기본, 검토 항목, 고쳐 쓰기, 발송 실패, 대화, 대화 승인, 빈 상태, 로딩, 목록 오류, 대화 오류, 긴 대화(11개, 고쳐 쓰기·발송 실패·대화 승인은 2026-11-01 추가).
- **테스트** — MSW 모드 통합 테스트 [messagesMsw.test.tsx](../../../src/app/messagesMsw.test.tsx)(테스트 파일 안에서만 `config.mswEnabled`를 바꾼다), handler [messageScenarios.test.ts](../../../src/shared/mock/messageScenarios.test.ts), [mapper.test.ts](../../../src/entities/message/model/mapper.test.ts), [format.test.ts](../../../src/widgets/message-inbox/lib/format.test.ts), 2026-11-01에 더한 행동 통합 테스트 [messagesActionsMsw.test.tsx](../../../src/app/messagesActionsMsw.test.tsx)와 두 파일이 함께 쓰는 [messageScreen.ts](../../../src/app/test/messageScreen.ts). 로딩과 「응답 전에는 그대로」는 시나리오가 아니라 응답을 붙잡아(deferred) 재현한다.

임시 도메인 타입, DTO, MSW 경로, 오류 코드, 화면 하위 경로와 `review` 파라미터는 **계약이 아니다.** 코드의 각 파일 머리말에 임시라고 적었고 [대표 계약](../../contracts/frontend-api-contract.md) §5.7(「1차에서 화면을 만들지 않는다(D-171)」)은 고치지 않았다.

## 완료조건 확인

| 계획의 ID | 상태 | 근거 |
|---|---|---|
| AC-01 | 충족 | 기존 [라우트](../../../src/app/router/routes.test.tsx)·[가드](../../../src/app/router/guards.test.tsx)(`messages/threads/1`에서 준비 중 문구와 업무 요청 0건)·[앱 셸](../../../src/app/appShell.test.tsx) 테스트는 수정 없이 V3 전체 Vitest에서 통과했다. 새 build의 `dist/assets/*.js` 57개에서 메시지 표식 17종(`rv_01`, `th_01`, `mg_01`, `messageReviews`, `messageThreads`, `messageFailures`, `이재환`, `API 명세서 진행 상황`, `messages-default`, `MESSAGE_THREAD_NOT_FOUND`, `보낼 메시지가 없어요`, `이 메시지, 보낼까요`, `답장 기다리는 중`, `여기서부터 답장을 기다리고 있어요`, `대화를 찾을 수 없어요`, `mockServiceWorker`, `setupWorker`)을 `rg`로 검색해 모두 0건이고, `메시지는 준비 중이에요`는 1개 청크에 남았다. 계획의 「`msw` 0건」은 글자 그대로는 맞지 않는다 — `msw` 부분 문자열 8곳(4개 청크)이 있으나 모두 기존 승인 전송 리터럴 `'msw'`와 설정 필드 `mswEnabled`이고 대응 소스의 develop 대비 변경은 0이다. MSW 런타임 표식은 0건이다. `/messages/threads` 1건은 공용 경로 함수 `paths.messageThread` 문자열이다. production 브라우저 확인은 하지 않았다 |
| AC-02 | 충족 (MSW) | 통합 테스트 AC-02 묶음: 목록 두 영역 순서, 검토 고르기 → `?review=rv_01`·`aria-current`·미리보기, 주소로 바로 진입, 없는 id `rv_99`·틀린 id `a/b`는 선택 없음(alert 없음), 대화 고르면 검토 현재 표시 해제. 스토리 기본·검토 항목·대화. 뒤로가기(POP) 자체를 실행하는 전용 테스트는 없다 — 선택은 URL에서 바로 파생하고 따로 저장하는 상태가 없다(V2) |
| AC-03 | 충족 (MSW) | 통합 테스트 AC-03 묶음(봇이 마지막인 DM의 답장 대기, 답한 DM·채널은 대기 없음, 오늘 구분선), [format.test.ts](../../../src/widgets/message-inbox/lib/format.test.ts)(서울 시간 날짜 묶기, 첫 메시지 시각 불명 — `58237a8`), [mapper.test.ts](../../../src/entities/message/model/mapper.test.ts)(대기 규칙). 스토리 대화·긴 대화 |
| AC-04 | 충족 (MSW) | 통합 테스트 AC-04 묶음: 빈 상태·한 영역만 빔, 목록·검토·대화 로딩(응답 붙잡기), 목록 오류 중 대화 표시와 다시 시도 성공, 대화 오류 중 목록 선택, 없는 대화·다른 공간 대화·틀린 ID·없는 하위 경로. [messageScenarios.test.ts](../../../src/shared/mock/messageScenarios.test.ts). 스토리 빈 상태·로딩·목록 오류·대화 오류 |
| AC-05 | 충족 (MSW) | 통합 테스트 AC-05 묶음: `ws_02` 응답을 붙잡은 전환 구간에 이전 공간 행이 없고 새 공간 1건만 보임, 이전 공간 대화 ID는 새 공간에서 404 |
| AC-06 | 충족 (MSW 개발 서버, 임시 스크립트) | 아래 「AC-06 세 너비 측정」. 1024/1440/1920px의 12개 상태 모두 가로 넘침 0px, 목록·대화가 각자 스크롤하고 페이지는 움직이지 않음 |
| AC-07 | 충족 (MSW) | 통합 테스트 AC-07 묶음(영역 이름·제목, Tab→Enter로 검토·대화 선택 후 `aria-current`, 대화 칸 Tab 도달, 답장 대기 글자 표현). 세 너비 실제 키보드 확인은 아래 「AC-07 키보드 확인」 |

### AC-06 세 너비 측정

최종 게이트 검증(V3)이 Chromium headless(locale `ko-KR`, timezone `Asia/Seoul`, 높이 900px)로 `VITE_ENABLE_MSW=true` Vite 개발 서버에서 측정했다. 저장소에 남기지 않은 임시 Playwright 스크립트(`frontend/test-results/v3-visual.mjs`, 실행 뒤 삭제)다. 상태는 ① `messages-default` 목록 ② `?review=rv_01` ③ `/messages/threads/th_01` ④ 긴 대화(`th_02`)다. ④는 그 브라우저 컨텍스트의 `sessionStorage`에만 메시지 30개를 더하고 검토·대화를 각각 30개 복제해(검토 32, 대화 35) 목록도 넘치게 했다. 저장소의 픽스처·handler는 바꾸지 않았다.

| 너비 | 네 상태의 문서 `scrollWidth / clientWidth` | 네 상태의 문서 `scrollHeight / clientHeight` |
|---:|---|---|
| 1024 | 모두 1024 / 1024 | 모두 900 / 900 |
| 1440 | 모두 1440 / 1440 | 모두 900 / 900 |
| 1920 | 모두 1920 / 1920 | 모두 900 / 900 |

독립 스크롤(세 너비 같은 값):

| 대상 | scrollHeight | clientHeight | 조작과 결과 |
|---|---:|---:|---|
| 목록 aside | 5043 | 824 | scrollTop `0 → 120`, 대화는 `2974` 유지 |
| 대화 section | 3722 | 748 | scrollTop `2974 → 0`, 목록은 `120` 유지 |
| 페이지 | 900 | 900 | 위 조작 전후 `window.scrollY` `0` 유지 |

긴 대화를 열면 대화는 최신 메시지 위치(scrollTop 2974)로 간다. 검증자는 세 너비 × 네 상태 스크린샷 12장을 직접 열어 겹침·가로 잘림이 없고 목록의 긴 미리보기가 의도한 말줄임으로 보임을 확인했다. 구현 중에도 같은 방식의 임시 스크립트로 세 너비를 측정해 통과했다(목록 22행·대화 42건).

### AC-07 키보드 확인

같은 V3 실행에서 세 너비 모두 실제 `Tab`·`Enter`로 검토 링크 선택(`?review=rv_01`) → 대화 링크 선택(`/messages/threads/th_01`) → `aria-label="대화 내용"` section 포커스를 확인했다.

- 두 선택 모두 현재 항목의 `aria-current="page"`가 있고 목록 안의 현재 항목은 매번 1개였다.
- 검토 링크·대화 링크·대화 section 모두 `:focus-visible`이 true이고 outline은 `solid 2px rgb(23, 23, 23)`이었다. 스크린샷에서 포커스 선이 보임을 직접 확인했다.
- 긴 대화에서 PageDown 뒤 대화 scrollTop의 첫 양수 관측값은 1024px 22, 1440px 49, 1920px 20이고 목록은 120을 유지했다(최종 이동량이 아닌 첫 관측값).
- 이름 있는 목록·상세 영역, 날짜, 봇·상대 구분 글자, `답장 기다리는 중`과 대화 안 답장 대기 문장을 확인했다. pageerror 0건.

## 검증 내역

### 최종 게이트 (V3, 2026-10-31, Node v24.11.0) — 이전 HEAD 기록

HEAD `58237a8`, `frontend/`에서 순차 실행했다. 무거운 명령은 다른 워크트리와 겹치지 않게 직렬화 래퍼(Git Bash) 안에서 돌렸다. 기존 `node_modules`가 있어 `npm ci`는 생략했다.

| 명령 | exit | 결과 |
|---|---|---|
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm run format:check` | 0 | |
| `npm run test -- --maxWorkers=2` | 0 | 163 files / 1849 tests 통과, 831.28s |
| `npm run build` | 0 | 새 JS 57개, 번들 검색은 AC-01 |
| `npm run test:storybook` (`STORYBOOK_E2E_PORT=6213`) | 0 | Storybook build 후 104 통과 |
| `node test-results/v3-visual.mjs` (`E2E_PORT=5213`, 임시) | 0 | AC-06·AC-07 측정·단언 통과 |
| `git diff --check develop...HEAD` | 0 | 출력 없음 |

### 전체 Vitest를 기본 설정으로는 한 번에 통과하지 못한 사실

이 기계에서 기본 설정(`npm run test`, 테스트 한도 5초, 기본 워커 수)의 전체 Vitest는 병렬 부하로 메시지와 무관한 테스트가 타임아웃해 한 번에 통과하지 못했다. 시간 한도·단언·설정은 바꾸지 않았고, 워커 수만 줄인 `npm run test -- --maxWorkers=2`로 위 exit 0을 얻었다. **기본 설정의 전체 실행이 통과한 기록은 없다.** 실패한 파일을 단독으로 다시 돌려 통과한 것을 전체 통과로 보지 않는다.

| 실행 | 설정 | 결과 |
|---|---|---|
| 구현 1차 전체 | `npm run test` | exit 1, 127 실패 / 1848(90건 5초 타임아웃, Button·Popover 등 무관한 스위트 포함) |
| 구현 2차 전체 | `npm run test` | exit 1, 58 실패 / 1848, 26개 파일 |
| 구현 3차 전체 | `npm run test`, 직렬화 래퍼 | exit 1, 17 실패 / 1848, 10개 파일 → 그 10개 파일만 `--maxWorkers=2`로 재실행 204건 통과 |
| V1 전체 (HEAD `765e37a`) | `npm run test`, 직렬화 래퍼 | exit 1, 24 실패 / 1848, 12개 파일(시간 초과 20, 요소 대기 3, 경로 기록 단언 1) → 12개 파일을 각각 `--maxWorkers=1`로 단독 실행해 244건 모두 통과 |
| V3 전체 (HEAD `58237a8`) | `npm run test -- --maxWorkers=2`, 직렬화 래퍼 | **exit 0**, 1849 통과 |

- 구현 중 `meetingUpload.test.tsx`는 기준 커밋 `ff9467e`에서도 단독 실행 2회 중 1회 3건 실패했다. 기준 커밋에서도 부하 때 흔들리는 테스트다.
- 실패 원인을 메모리 부족 등으로 계측해 확정하지는 않았다. V1은 「병렬 실행 조건에 민감한 실패」로 분류했고 단독 재실행에서 재현된 코드 결함은 없었다.
- 당시 기계 상황(구현 보고): 다른 워크트리 동시 실행, node 프로세스 약 86개, 여유 메모리 6~8GB.
- V1과 V3의 테스트 수 차이(1848 → 1849)는 `58237a8`이 더한 날짜 묶기 사례 1건이다.

### E2E

- 새 E2E 파일은 없다(D-117, 결정 4 이후 고정).
- 구현 중 관련 파일만 돌렸다: `restore.e2e.ts`(저장 버전), `layout.e2e.ts`·`select-switch.e2e.ts`(헤더 `메시지` 탭·공간 전환). 1차 병렬에서 `restore` 2건이 실제 회귀(기대값이 버전 2로 하드코딩)라 `765e37a`로 고쳤다. 2차 병렬에서는 `restore` 2건이 30초 테스트 타임아웃, `layout` 1024px 대시보드 제목 5초 대기가 실패했다. 3차 `restore`+`layout`을 `--workers=1`로 돌려 25 통과 exit 0이었다. `select-switch`는 2차까지 실패 없이 통과했다.
- **전체 `npm run test:e2e`는 실행하지 않았다.** 계획 최종 게이트의 「기존 E2E 회귀」는 위 관련 파일 실행으로만 확인했다.

### Storybook

- `test:storybook` 104건이 통과했고 메시지 스토리 8개가 `storybook-static/index.json`에 등록됐다.
- V3 확인 결과 104건의 play 수집 범위는 기존 M5~M7이다. **메시지 스토리 8개의 play 함수는 이 명령에서 실행되지 않았다.** 구현 보고의 「104 passed, 새 스토리 8개 포함」은 등록을 뜻하며 play 실행 근거가 아니다. 메시지 화면은 전체 Vitest와 위 브라우저 측정으로 확인했다.
- build 중 생성 CSS의 `color: var(...)` 경고 1건은 [M2 기록](../m2/basis-for-decision/2026-09-16-docs-prose-makes-the-build-warn.md)과 같은 기존 경고다.

### 리뷰

- V1(정적·단위 게이트, HEAD `765e37a`): typecheck·lint·format:check·build·AC-01 번들 검사 통과, 기존 테스트 변경의 적절성 확인. 전체 `npm run test` exit 0을 얻지 못해 major 1건으로 FAIL — 위 V3 실행으로 해소.
- V2(읽기 전용 코드 리뷰, HEAD `765e37a`): blocking·major 0건, minor 1건(V2-01)으로 PASS. 범위 위반(7~10단계, polling, 발송, 계약 문서) 없음.
- V3(최종 게이트, HEAD `58237a8`): blocking·major·minor 0건으로 PASS. V2-01 수정 확인.

### 수행하지 않은 검증

- 실제 메시지 API 호출 — API가 없다.
- 실제 Discord 발송과 그 상태 — 범위 밖.
- production 빌드를 브라우저로 띄운 확인 — 번들 문자열 검색으로만 확인했다.
- 메시지 스토리 play 함수 실행, 전체 `test:e2e`.

## 계획 대비 변경

- **검토 항목 선택 표현:** 계획 1단계는 검토 항목의 경로를 결정 4 이후로 미뤘다. 3단계의 「선택은 URL로」를 지키려고 검색 파라미터 `messages?review=<id>`로 임시 표현했다. 구현 워커가 코디네이터에게 물어 승인받은 선택이며 사용자 결정이 아니다. [기록](basis-for-decision/2026-10-31-message-review-selection-search-param.md).
- **모의 DB 저장 버전과 기존 테스트:** 계획에 없던 변경이다. MockDb에 메시지 칸 3개를 더해 `MOCK_DB_VERSION`을 2→3으로 올렸고, 같은 숫자를 기대하던 [taskScenarios.test.ts](../../../src/shared/mock/taskScenarios.test.ts)와 E2E [restore.e2e.ts](../../../e2e/restore.e2e.ts)의 기대값을 3으로 맞췄다. 저장·복원·손상값 폐기 단언은 그대로다(V1 확인).
- **시나리오 독립성 테스트 한도 30초:** [scenarios.test.ts](../../../src/shared/mock/scenarios.test.ts)의 시나리오 간 독립성 검사는 시나리오 수의 제곱만큼 적용·비교한다. 기준 커밋에서도 당시 부하로 5.2초(한도 5초)가 걸려 실패했고, 시나리오 4개와 메시지 데이터가 비교에 더해지면 약 7.5초다. 이 테스트 하나에만 30초 한도를 주었다. 반복·기대값·단언은 그대로이며 다른 테스트의 타임아웃을 가리지 않는다. 실행 시간 한도를 5초에서 30초로 완화한 것은 사실이다(V1 확인).
- **첫 메시지 시각 불명 방어(`58237a8`):** V2 리뷰가 V2-01(minor)로 「첫 메시지의 시각을 읽을 수 없으면 `date: ''` 묶음이 생기고 `dayLabel('')`이 `RangeError: Invalid time value`를 던진다」를 찾았다. 정상 MSW 픽스처에서는 생기지 않는 방어 코드 결함이다. 날짜 없는 묶음을 `null`로 두고 그 묶음은 날짜 구분선을 그리지 않게 고쳤으며 회귀 사례를 더했다. V3가 직전 커밋 함수와 현재 함수를 같은 입력으로 돌려 이전은 `''`·`RangeError`, 현재는 `null`로 새 사례가 실제로 변별함을 확인했다. 미상 날짜에 별도 문구를 쓰지 않은 선택은 [기록](basis-for-decision/2026-10-31-message-unknown-date-no-divider.md).
- **스토리 수:** 계획의 6개(기본, 빈 상태, 로딩, 목록 오류, 대화 오류, 긴 대화)에 검토 항목·대화를 더해 8개다.
- **2026-10-31의 결정 4 전 임시 표현 → 2026-11-01 현재:** 사용자 결정(결정 4의 UI 범위 = 디자인 캔버스 기준, MSW 목)으로 아래를 시안대로 바꿨다. 자세한 대응은 위 「디자인 차이표」.
  - 답장 대기: 회색 `답장 기다리는 중`·`여기서부터 답장을 기다리고 있어요` → 강조색 `답장 N일째 없음`과 `여기서부터 답장이 없습니다 — 오늘로 N일째예요`(서버가 준 시작 시각, 보낸 날이 1일째). 목록 행의 점과 숨긴 글자 `답장 기다리는 중`, 목록 머리 `답장 기다리는 중 N`은 시안 그대로 유지.
  - 검토 행 날짜: 만든 날 → 마감이 있으면 `MM/DD 마감`, 없으면 오늘 기준 `N일 전`.
  - 그대로인 것: 목록은 사람별 대화 최근순·채널은 뒤, 미리보기의 봇 이름은 공간 이름, 없는 대화(404)·잘못된 하위 경로는 「대화를 찾을 수 없어요」(다시 시도 없음)·5xx는 다시 시도.
- **2026-10-31에 만들지 않았다가 2026-11-01에 만든 것:** 발송 검토 흐름(7단계의 화면·MSW 목), `알림 규칙 보기`(팀 설정으로), `Discord에서 열기`, 발송 시점·`고쳐 쓰기`·`이대로 발송`·`보내지 않음`·승인·반려, 대화 하단 「봇이 보냅니다 · 확인하기」 안내, 봇 메시지의 `자동 발송`·`○○ 승인` 줄.
- **지금도 만들지 않은 것:** 권한 분기(8단계), 상태 전이 동기화·polling(9단계), 메시지 E2E(10단계, D-117), 대표 계약 메시지 절, 헤더 개수 배지(집계 API).
- **MSW 안내:** 계획 2단계 대상대로 구현 커밋 `7c97fa1`이 [MSW 안내](../../msw-guide.md)의 「메시지 API는 M1 mock 범위 밖」 문장을 임시 조회 경로 안내로 바꿨다. 2026-10-31 문서 작업에서 메시지 시나리오 4개와 여는 방법을, 2026-11-01(`d058561`)에 행동 경로·`messages-send-fail`·기본 선택·상대 표기 주의를 더했다.

## 남은 작업과 제한 사항

- **결정 4의 나머지** — UI 범위는 2026-11-01 사용자 결정으로 디자인 캔버스 기준·MSW 목이 됐다. 정책(검토 단위, 발송 권한, 재발송, 자동 발송 유무, 예약 메시지의 실제 발송)은 여전히 열려 있다.
  - 8 권한 분기, 9 상태 전이와 동기화(D-136, polling 여부), 10 메시지 E2E 고정(D-117)은 하지 않았다.
  - 7단계의 화면·MSW 목 동작은 위 「동작 — MSW 목과 그 한계」 기준이다. 계획 C-9의 「결정 후 완료조건은 AC-08부터」는 계획에 아직 정의되지 않아 이 문서에서 새 AC를 만들지 않았다 — 이번 재작업은 코디네이터 지시의 완료 조건(차이표·스크린샷 근거·게이트·커밋)으로 기록했다.
- **실제 API 연동** — 메시지 API가 생기면 별도 연동 과제다. 계획 C-8대로 `entities/message`의 경로·DTO·매퍼, MSW handler·픽스처, `MessagesPage` 모드 분기와 준비 중 문구에 기대는 테스트 6개, 대표 계약 §5.7을 함께 바꾼다. 실제 서버 응답·Discord 발송은 MSW 결과로 대체할 수 없어 미검증으로 남는다.
- **화면 노출** — production은 계속 준비 중을 보인다. 2026-11-20까지의 시연에서 메시지 화면을 보여야 하는지는 확인이 필요하다(계획 C-10).
- **D-171 개정** — 이번 구현은 2026-10-30 사용자 답변에 따라 엔티티·MSW 픽스처를 만들었다. [D-171](../../decision/frontend-decisions.md)의 「엔티티도 MSW 픽스처도 만들지 않는다」를 결정 기록에서 개정할지는 확인이 필요하다.
- **전체 Vitest 환경** — 이 기계의 기본 설정 전체 실행은 병렬 부하로 무관한 테스트가 타임아웃한다. 게이트 통과는 `--maxWorkers=2` 실행 기준이다. 기본 설정에서 한 번에 통과하게 하는 일(실행 환경·동시성 조정, 부하에 민감한 테스트 정리)은 남아 있다.
- 메시지 스토리 play 함수는 `057e80a`부터 Storybook 회귀(M8 블록)에서 수집된다. 전체 `test:e2e`는 이번에도 실행하지 않았다.
- **공용 버튼의 `text-control`** — 같은 이름의 색 토큰 때문에 글자 크기가 아니라 색으로 생성돼, `text-control`을 쓰는 버튼·라벨이 13px가 아니라 상속 크기(대개 14px)로 그려진다(2026-11-01 VR-08 재현 중 발견). 메시지 크기는 길이로 적어 피했고, 앱 전체 수정(토큰 이름 또는 `text-(length:--text-control)`)은 다른 화면의 크기가 바뀌므로 별도 과제다.
- **발송·보내지 않음 뒤 목록이 모두 비는 경우** — EmptyMessages 한 장으로 바뀌며 상세 칸이 사라져 포커스가 BODY로 간다. 정상 픽스처에서는 대화가 남아 생기지 않는다.
- 확인 필요: 답장 대기 「며칠째」의 서버 계산 방식(지금은 MSW 목과 화면 계산), `알림 규칙 보기`의 실제 목적지(지금은 팀 설정), `Discord에서 열기`·`마지막 메시지 보기`의 실제 주소(지금은 목 주소), 발송 권한.
- 계획 C-11의 「AC-01~AC-07을 이슈에 옮기는 일」은 이 기록 범위 밖이다.

## 관련 기록

- [검토 항목 선택을 검색 파라미터로 임시 표현한 선택](basis-for-decision/2026-10-31-message-review-selection-search-param.md)
- [새 메시지 화면을 MSW 모드에서만 보이는 선택](basis-for-decision/2026-10-31-messages-screen-msw-mode-only.md)
- [시각을 읽을 수 없는 첫 묶음은 날짜 구분선만 생략한 선택](basis-for-decision/2026-10-31-message-unknown-date-no-divider.md)
- [결정 4의 UI 범위를 디자인 캔버스 기준·MSW 목으로 정한 사용자 결정](basis-for-decision/2026-11-01-message-ui-scope-design-canvas-msw.md)
- [발송 시점 카드의 화살표 키는 포커스만 옮기고 잠금은 aria-disabled로 한 선택](basis-for-decision/2026-11-01-send-timing-arrow-keys-move-focus-only.md)
- [MSW 안내](../../msw-guide.md)의 메시지 절

검증 보고서(구현 보고, V1·V2·V3)와 스크린샷(2026-10-31, 2026-11-01 디자인 비교 포함)은 저장소 밖 작업 폴더에 있어 링크하지 않는다.

## 마일스톤 안내에 넣을 문장 제안

[마일스톤 안내](../README.md)와 [Frontend README](../../../README.md)는 A(#243)·B(#244)·C(#245) 세 브랜치가 병합된 뒤 한 번에 갱신한다. C 부분의 제안 문장은 다음과 같다. 링크는 넣을 문서 기준 경로를 괄호에 적었다.

- 마일스톤 안내 M8 행의 상태 칸: 「C 메시지(#245): MSW 모드에서만 디자인 캔버스대로 구현(목록·보내기 전 확인·대화·빈 상태, 행동은 MSW 목), AC-01~AC-07 프론트·MSW 기준 충족(결과 `m8/result-c.md`). 권한 분기·상태 동기화·메시지 E2E는 결정 4 대기. 완료 판정 없음」
- Frontend README 상태 문단: 「M8-C 메시지는 계획(`docs/plan/m8/plan.md`) C 절의 결정 전 부분과, 2026-11-01 사용자 결정(결정 4의 UI 범위 = 디자인 캔버스 기준, MSW 목)에 따른 발송 검토 화면을 구현했고 결과(`docs/plan/m8/result-c.md`)에 AC-01~AC-07의 프론트·MSW 기준 충족과 디자인 차이표를 기록했다. 메시지 API가 없어 화면은 MSW 모드에서만 보이고 실 API·production은 준비 중 안내를 유지한다. 전체 Vitest는 `--maxWorkers=2`로 통과했으며 기본 설정 전체 실행은 병렬 부하로 통과하지 못했다. 권한·상태 동기화·메시지 E2E는 결정 4 대기, 실제 API 연동은 미검증 과제다.」
