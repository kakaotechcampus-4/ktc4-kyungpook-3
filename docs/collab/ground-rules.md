# 그라운드룰

팀이 지킨 일하는 방식을 정리한다. 저장소 문서·워크플로·라벨로 확인한 규칙과, PR 기록에서 반복해서 관찰된 관행을 구분해 적는다.

## 팀이 정한 약속 (2026-09-22)

팀 노션 "팀 협업 그라운드 룰 정하기"에 적은 약속이다. 지켜진 정도는 2026-11-11 에 GitHub 기록으로 센 값이다.

| 약속 | 이유 | 실제 기록 |
|---|---|---|
| `develop` 대상 PR 은 파트 안에서 머지한다. PM 은 `main` ← `develop` PR 만 만든다 | 브랜치가 서로 묶이지 않게 하고 git flow 를 유지한다 | `main` PR 9건 중 8건을 PM 이 올렸다 |
| `develop` PR 마다 같은 파트 팀원이 코멘트를 하나 이상 단다. "LGTM"만 남기지 않는다 | 다른 사람 코드를 읽어야 파트 전체를 안다 | 팀원 인라인 코멘트는 474개다. 수치는 [코드 리뷰 기록](code-reviews.md#상호-리뷰-수치) |
| PR 마다 파트 docs 폴더에 진행 사항을 로그로 남긴다 | 왜 그렇게 했는지가 PR 과 함께 남는다 | 아래 [3. 기록 의무](#3-기록-의무) |
| 미팅 전에 자기 파트를 정리해 온다(멘토 피드백, 논의할 것). 다른 파트와 맞출 부분을 먼저 본다 | 미팅에서 리뷰를 처음 읽으면 시간이 샌다 | 팀 노션의 리뷰 미팅·협업 미팅 회의록 |
| 자기 파트의 파이프라인 전체를 이해하고 PR 을 올린다 | 메서드가 하는 일, 테이블 필드의 이유, 산출물 형식을 스스로 설명할 수 있어야 한다 | 주간 멘토 리뷰 PR 본문의 "리뷰에서 봐주셨으면 하는 곳" |
| 기능을 만들 때 파이프라인 그림을 Excalidraw 로 그려 리뷰 때 설명한다 | 말로만 설명하면 파트 사이 이해가 어긋난다 | `docs/` 의 excalidraw 그림 3개 |
| 질의응답은 질문한 사람이 적어 미팅 페이지에 반영한다 | 답한 사람은 자기가 한 말을 기억하지 못할 때가 많다 | 팀 노션 회의록 |
| 트러블슈팅 로그를 주차마다 2개 이상 쓴다 | 같은 문제를 두 번 겪지 않는다 | 아래 [3. 기록 의무](#3-기록-의무)의 트러블슈팅 |
| 기술 멘토링 전에 질문을 준비해 멘토에게 미리 알린다 | 멘토도 답을 준비할 시간이 필요하다 | 팀 노션 "기술멘토링 피드백 일지"(4·8·10주차) |

## 1. 파트 배치와 역할

| 파트 | 인원 | 책임 범위 | 진입 문서 |
|---|---|---|---|
| AI | 3 (dw021213, Y-Jimin, letsgojh) | 녹음 봇·워커, 전사(STT), 할 일 판단(judge), 초안, BE 인계 | [ai/README.md](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/README.md) |
| Backend | 2 (wkddnjswns, hwnv) | API·DB, 매칭·게이트·승인, Notion 동기화, 리마인드, 배포 | [backend/README.md](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/backend/README.md) |
| Frontend | 1 (hotpringles) | 웹 화면 전체, 디자인 시스템, 접근성, 모바일·PWA | [frontend/README.md](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/README.md) |
| 멘토 | 1 (minsang0850) | 주간 `main` 대상 PR 리뷰 | — |

- 파트 경계는 코드 경로(`ai/`, `backend/`, `frontend/`)로 나눈다. 다른 파트 코드를 고치는 PR 은 그 파트 담당에게 리뷰를 요청한다(예: AI 담당이 BE 코드를 고친 #526·#532 본문의 "BE 담당 리뷰 부탁").
- AI 는 BE 와 HTTP API 로만 이야기한다(AI 파트 규칙). 파트 경계를 코드 구조로도 지킨다.
- 팀 역할(팀장, 파트 리드, 플래너, 메이커)은 [협업 문서 첫 쪽](index.md#팀-구성)의 표에 있다.

## 2. 파트 간 계약과 요청

### 계약 문서

| 경계 | 대표 계약 | 비고 |
|---|---|---|
| AI ↔ BE | [backend-ai-contract.md](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/backend/docs/contracts/backend-ai-contract.md) | 회의·발화·추출·업로드·봇 API, 오류 코드, 합의 상태 |
| 웹 ↔ BE | [frontend-api-contract.md](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/contracts/frontend-api-contract.md) | 화면용 API |
| 공유 타입 | [ai/shared/schemas.py](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/shared/schemas.py) | BE 와의 계약. 바꾸면 계약 문서도 함께 고친다 |

- 계약은 대표 문서 중심으로 갱신하고 **구현 사실과 합의 상태를 구분**한다.

### 요청 문서와 라벨

다른 파트에 일을 부탁할 때는 이슈와 요청 문서를 함께 쓴다.

| 수단 | 쓰임 |
|---|---|
| `<part>/docs/requests/*.md` | 요청·수신 파트, 배경, 요청 작업, 완료조건, 처리 상태. 예: [bot-restart-lock.md](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/backend/docs/requests/bot-restart-lock.md)(BE 배포 → AI 녹음 봇). AI 쪽은 [ai/docs/request/](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/tree/develop/ai/docs/request) |
| 라벨 `ai→be` | AI 작업에서 생긴 BE 전달·요청 |
| 라벨 `ai→fe` | AI 작업에서 생긴 FE 전달·요청 |
| 라벨 `contract` | 파트 간 API·데이터 계약 변경 |
| 라벨 `합의됨` | 파트 간 합의가 끝난 이슈. 뒤따르는 작업을 시작해도 된다는 표시다 |

- 워크플로 [`ai-handoff-agreed.yml`](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/.github/workflows/ai-handoff-agreed.yml): 위 세 라벨 중 하나가 붙은 이슈에 `합의됨` 이 붙거나 이슈가 닫히면, 그 이슈를 "선행 이슈"로 적어 둔 열린 AI 요청 이슈를 찾아 팀 Discord 에 "AI 후속 작업 시작 가능"을 알린다.
- 알림을 본 담당자가 후속 작업을 시작한다.

```mermaid
sequenceDiagram
  participant AI as AI 담당
  participant GH as GitHub 이슈
  participant BE as BE/FE 담당
  participant DC as 팀 Discord
  AI->>GH: 요청 이슈 (ai→be / contract)
  AI->>GH: AI Feature 이슈 "선행 이슈: #N"
  BE->>GH: 합의 → `합의됨` 라벨 또는 닫기
  GH->>DC: ai-handoff-agreed 가 "AI 후속 작업 시작 가능" 알림
  DC-->>AI: 후속 작업 시작
```

## 3. 기록 의무

출처: [문서 안내](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/docs/README.md).

| 기록 | 위치 | 언제 |
|---|---|---|
| 결과 | `<part>/docs/plan/mN/result.md` | 의미 있는 개발 뒤. 파트 README 의 마일스톤 상태도 갱신 |
| 결정 근거 (basis-for-decision) | `<part>/docs/plan/mN/basis-for-decision/`, AI 는 [ai/docs/basis_for_decision/](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/tree/develop/ai/docs/basis_for_decision) | 여러 선택지 중 하나를 고를 때 |
| 계약 | `<part>/docs/contracts/` | 인터페이스 변경 때 |
| 트러블슈팅 | `<part>/docs/plan/mN/trouble-shooting/` | 문제를 겪은 사람이 직접 쓴다 |
| 작업 단위 결과(FE) | `frontend/docs/plan/mN/work-items/<식별자>-<이름>/result.md`, 독립 개선은 `plan/refactor/work-items/` | 실제 이슈·PR을 구분한 후속 작업 |

- 파일명은 `YYYY-MM-DD-<slug>.md`. AI 결정 기록은 `YYYY-MM-DD-NNNN-<slug>.md` 로 번호를 이어 쓴다([ai/docs/README.md](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/docs/README.md)).
- 전체 개발 계획(`frontend-plan.md`, `backend-plan.md`, `ai/docs/plan/전체 계획.md`)은 보호 문서라 작업 중에 고치지 않는다.
- 트러블슈팅은 문제를 겪은 사람이 직접 쓴다.
- 빈 결과나 가상의 기록을 미리 만들지 않는다. 검증하지 않은 것을 완료로 적지 않는다.

## 4. 리뷰 응답 규칙

문서화된 규칙과 관찰된 관행을 나눠 적는다.

| 구분 | 내용 | 근거 |
|---|---|---|
| 규칙 | 재리뷰 요청 PR 은 본문 "지난 리뷰 반영" 절에 어떤 피드백을 어디서 반영했는지, 반영하지 않은 것은 이유를 적는다 | [PR 템플릿](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/.github/pull_request_template.md) |
| 규칙 | 멘토 리뷰용 PR 은 "리뷰에서 봐주셨으면 하는 곳"을 구체적으로 쓴다 | PR 템플릿 |
| 관행 | 인라인 지적마다 먼저 "확인했고 반영하겠습니다", 고친 뒤 "반영했습니다 (커밋 해시): 무엇을 어떻게" 로 답한다 | #526·#532·#533 리뷰 스레드 |
| 관행 | 반영하지 않을 때는 이유를 답글과 결정 기록에 남긴다(예: #532 에서 BE 가 아니라 AI 쪽에서 50개로 자르기로 한 이유) | #532 |
| 관행 | 리뷰 반영 커밋은 제목에 `리뷰 반영 -` 을 붙인다. 499개 | `git log`, 2026-11-11 |
| 관행 | 팀 결정이 필요한 지적은 "팀 결정으로 남김"으로 표시하고 다음 리뷰에서 상태를 표로 보고한다 | #382 2차 리뷰 표, #239 본문 |

리뷰는 팀원이 PR 에 인라인 코멘트로 직접 남기고, 작성자가 답글과 반영 커밋으로 답한 뒤 같은 파트 안에서 머지한다. 주고받은 내용은 [코드 리뷰 기록](code-reviews.md#상호-리뷰-사례)에 있다.

## 5. 커뮤니케이션

| 채널 | 무엇을 | 근거 |
|---|---|---|
| 팀 Discord — 한 줄 알림 | 이슈·PR 열림·닫힘, `main` 이 아닌 PR 의 리뷰·코멘트. 봇 이벤트는 거른다 | [`team-notify.yml`](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/.github/workflows/team-notify.yml) (#122) |
| 팀 Discord — 하루 두 번 보고 | 09시·21시 KST, 열린 PR·머지된 PR 목록. 예약 누락에 대비해 세 번 걸고 먼저 돈 실행만 보낸다 | [`team-digest.yml`](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/.github/workflows/team-digest.yml) |
| 팀 Discord — 멘토 리뷰 | `main` 대상 PR 의 리뷰 요청·리뷰 결과 | [`notify-discord.yml`](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/.github/workflows/notify-discord.yml) (운영진 배포 파일) |
| 팀 Discord — 파트 간 합의 | 선행 이슈 합의 시 AI 후속 작업 알림 | [`ai-handoff-agreed.yml`](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/.github/workflows/ai-handoff-agreed.yml) |
| GitHub 이슈·PR | 설계 확정은 이슈 댓글로 남긴다(예: #141 설계 확정 댓글을 #533 본문이 링크) | #533 |

- 알림 워크플로에는 `concurrency` 를 넣지 않는다. 대기하던 실행이 취소되면 그 알림이 사라지기 때문이다(워크플로 주석).
- 리뷰 미팅과 협업 미팅을 매주 열고 회의록을 팀 노션에 남겼다(2026-09-03 ~ 11-01, 20건 넘게). 파트 미팅(AI, BE, FE)과 전체 미팅을 나눠 열었다.
- 위클리 보고서는 매주 일요일 22시까지 쓰고, 기술 멘토링 전에 사전 질문을 일지에 적는다.

## 관련 문서

- [브랜치 전략](branch-strategy.md)
- [코드 리뷰 기록](code-reviews.md)
