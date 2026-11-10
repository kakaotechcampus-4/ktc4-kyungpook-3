# #551 프로젝트 맵 화면과 회의 요약본 내려받기 결과

## 작업 근거와 요약

- 근거: [이슈 #551](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/551) 본문의 「만들 것」 1~7과 [계약 §4.4.2](../../../../contracts/frontend-api-contract.md). BE 경로는 #560·#602 로 develop 에 있다. 마일스톤 계획 밖 이슈 작업이라 이 결과에만 기록한다.
- 이슈의 2026-11-09 댓글이 더한 세 가지(승인 대기 `summary_status` 와 남은 건수, 주제·결정 고치기, 전사 제목·본문 고치기)는 BE·AI #605 를 기다려 이번에 하지 않았다. 그래서 이슈를 닫지 않는다.
- 화면 배치와 그래프 구성은 [D-186](../../../../decision/frontend-decisions.md), 근거와 측정은 [결정 기록](../../basis-for-decision/2026-11-09-project-map-graph.md)에 있다.

## 실제 구현 및 관련 코드

- **메뉴.** 앱에는 사이드바가 없다. 넓은 화면은 헤더 탭 `메시지` 다음, 휴대폰은 아래 탭 막대 다섯 칸을 그대로 두고 내 계정 메뉴의 `설정` 위다(D-180·D-186). [셸 탭 표](../../../../../src/widgets/app-shell/model/shellTabs.ts)의 `compact` 값이 둘을 정한다. 셸이 탭에 다가갈 때 맵 조회를 미리 받는다(#536).
- **응답 읽기.** [스키마](../../../../../src/shared/types/api/projectMap.ts)는 BE `schemas/project_map.py` 를 따른다. 노드는 `kind` 로 나뉜 합 타입이고 모르는 `kind`·태스크 `status` 는 `INVALID_RESPONSE` 다(D-184). [매퍼](../../../../../src/entities/project-map/model/mapper.ts)가 노드를 `appeared_at` 순서로 줄 세우고, 주제·태스크 선으로 목록 보기의 주제별 묶음과 `주제 없는 태스크` 를 한 번 만든다.
- **그래프.** [배치](../../../../../src/widgets/project-map/lib/layout.ts)는 d3-force 를 프레임마다 10ms 씩 돌린다. [그래프](../../../../../src/widgets/project-map/ui/GraphView.tsx)는 SVG 다. 주제는 진하고 크게, 태스크는 연하게, 선은 한 종류다. 확대 배율 1.6 이상에서 태스크 이름이 보인다. 확대·축소·전체 보기 단추와 끌기·휠 확대가 있다. 노드를 누르면 옆 패널이 열린다.
- **재생.** [상태 기계](../../../../../src/widgets/project-map/lib/replay.ts)가 노드를 `appeared_at` 순서로 하나씩 보인다. 간격은 `clamp(6000 / n, 30, 500)`ms, 선은 두 끝이 보일 때만 그린다. `멈추기` 는 전체로 돌아간다.
- **목록 보기.** 주제별 묶음과 주제 없는 태스크를 단추로 보인다. 그래프와 같은 패널을 연다. 휴대폰 폭의 기본 탭이다. 탭은 주소의 `view` 값으로 남는다.
- **옆 패널.** [패널](../../../../../src/widgets/project-map/ui/SelectionPanel.tsx)은 넓은 화면에서 오른쪽 칸, 휴대폰에서 아래 시트다. 주제는 주제 조회로 설명·결정·태스크·나온 회의를 보인다. `replaced_by` 가 있는 결정은 흐리게 `뒤집힘` 과 `다른 결정으로 바뀌었어요.` 다. 404 `TOPIC_NOT_FOUND` 는 패널 안 안내다. 태스크는 맵 응답으로 상태·담당·마감·막힘·나온 회의, 태스크끼리의 선으로 이어진 태스크(`이어진 태스크` 단추, 누르면 그 태스크 패널)와 `태스크 열기` 를 보인다. 회의를 누르면 회의록이다. 휴대폰 시트도 고른 항목이 바뀌면 그 제목으로 포커스를 옮기고, 닫으면 연 단추로 돌아간다(그 단추가 아직 화면에 있을 때).
- **빈 상태.** 노드가 없으면 `아직 프로젝트 맵이 비어 있어요`. 주제가 없으면(요약 스위치를 켜기 전 운영 상태) 그래프와 목록은 태스크만으로 그리고 `아직 주제가 없어요. 회의 요약이 만들어지면 주제와 결정이 생겨요.` 를 보인다.
- **내려받기.** [파일 요청](../../../../../src/shared/api/client.ts)은 `request` 와 같은 오류·401 경로를 쓰고, 2xx 인데 Markdown 이 아니면 `INVALID_RESPONSE` 다. 이름은 `filename*` 를 먼저 읽는다([파서](../../../../../src/shared/api/contentDisposition.ts)).
  - [요약본](../../../../../src/features/summary-download): 회의록 머리에 `요약본 내려받기`. 요약이 있을 때 팀원에게도 보인다. 404 `SUMMARY_NOT_FOUND` 는 토스트다.
  - [합본](../../../../../src/features/project-bundle-download): 맵 아래에 시작일·종료일과 `프로젝트 합본 내려받기`, 안내 `팀원 발언 요약이 들어 있어요. 외부 AI 에 첨부할 때 주의해 주세요.` 기본은 전체 기간이다. 시작일이 늦으면 보내지 않고 서버 400 도 같은 문구다. 형식이 틀린 날짜도 보내지 않는다.
- **회의록 `summary_status`.** 요약이 있으면 상태와 무관하게 보인다. 없으면 `pending` 은 `요약을 만드는 중이에요`, `none` 은 이슈대로 요약 칸을 비운다. 재시도 단추는 없다. [타입](../../../../../src/entities/minutes/model/types.ts)의 「실 API 에서는 항상 null」 주석과 [매퍼 테스트](../../../../../src/entities/minutes/model/mapper.test.ts) 설명을 바꿨다.
- **모르는 `summary_status`.** 받은 글자를 보존하고(`UnknownValue`) 중립 문구 `요약이 없어요` 를 보인다. 이 값은 빈 요약 칸의 문구만 고르는 표시용이라 응답을 거절하면 전사문까지 못 보게 된다. 중립 문구는 「만드는 중」 도 「없이 끝났다」 도 단정하지 않는다. #605 의 승인 대기 값이 먼저 오더라도 화면이 깨지지 않는다. 키가 없으면 `none` 이다.
- **잘못된 응답의 재요청.** `INVALID_RESPONSE` 는 공용 Query 재시도에서 빠진다(`isRetryableError` 는 네트워크·408·5xx 만). 창 포커스·연결 복귀·간격 재조회는 #604 가 `createQueryClient` 에서 공용으로 막는다. develop 을 병합해 맵·주제·회의록 조회가 그대로 그 차단을 쓴다. 조회마다 막은 곳은 없다. 맵 화면 테스트가 모르는 노드 종류 뒤 창 포커스·연결 복귀에 다시 묻지 않는 것을 본다(공용 차단을 빼면 실패하는 것을 확인했다).
- **MSW.** [주제·결정·선 픽스처](../../../../../src/shared/mock/fixtures/projectMap.ts), [맵 핸들러](../../../../../src/shared/mock/handlers/projectMap.ts), [Markdown 핸들러](../../../../../src/shared/mock/handlers/markdownFiles.ts). 시나리오 `project-map-empty`·`project-map-no-topics`·`project-map-large`(주제 40·태스크 510·선 약 1,184). 모의 db 판은 22 다.

## 요청 조건 확인

| 「만들 것」 | 상태 | 근거 |
|---|---|---|
| 1 메뉴 | 구현. 사이드바 대신 헤더 탭·휴대폰 메뉴(D-186) | `app/projectMap.test.tsx`, `app/appShell.test.tsx` |
| 2 그래프 탭 | 구현 | `app/projectMap.test.tsx`, 브라우저 1280 캡처 |
| 3 옆 패널 | 구현 | 같은 테스트(주제·태스크·뒤집힌 결정·회의 이동), 390 시트 캡처 |
| 4 재생·확대·축소·전체 보기 | 구현 | 같은 테스트(가짜 시계), `widgets/project-map/lib/layout.test.ts` |
| 5 목록 보기 | 구현 | 같은 테스트, 390 캡처 |
| 6 내려받기 | 구현 | `app/meetingSummaryDownload.test.tsx`, `features/project-bundle-download/*.test.*`, 브라우저 실제 내려받기 |
| 7 `summary_status` | 구현 | `app/meetingSummaryDownload.test.tsx`(세 값과 모르는 값), `entities/minutes/model/mapper.test.ts` |
| 댓글 추가 3건 | 하지 않음 | #605 대기 |

## 검증 내역

- 바꾼 곳의 테스트를 `--maxWorkers=1` 로 따로 돌려 통과했다. 전체 검사 결과는 아래 「전체 검사」다.
- 브라우저(Vite 개발 서버 + MSW, Playwright Chromium, 2026-11-09)
  - 1280: 그래프, 주제 패널, 합본 실제 내려받기(이름 `카테캠 3팀 프로젝트 맥락 2026-09-18.md`), 시작일이 늦은 기간의 안내, 회의록 요약본 실제 내려받기(이름 `2026-09-15 3주차 정기회의.md`), 빈 맵·주제 없는 맵. 페이지 오류 없음.
  - 390: 목록 기본 탭, 주제 시트, 그래프 탭, 가로 넘침 0.
  - `project-map-large`(노드 550·선 약 1,184): 60번 끌기 동안 108프레임의 간격 중앙값 17ms, 95% 17ms, 최대 33ms. 개발 모드 한 번의 측정이다.
- 빌드: 초기 chunk 는 develop HEAD 대비 gzip 1.17KB 늘었다(148.41KB → 149.58KB). 화면 chunk 5.20KB, 그래프 chunk 8.23KB(d3-force 포함, gzip). d3-force 는 그래프 chunk 에만 있다.
- 실 API 로는 확인하지 않았다. 운영에서 요약 스위치가 켜진 상태의 주제·결정, 실제 `Content-Disposition` 이름, 태스크 1,000개 이상의 배치 시간은 확인하지 않았다.

### 전체 검사

2026-11-09 커밋 `4bc441f3` 기준, 감독 세션의 차례에 맞춰 돌렸다.

- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`: 통과.
- `npm run test -- --maxWorkers=1`: 313개 파일 중 312 통과, 테스트 4,027개 중 4,026 통과, 1 실패(2,217초). 실패는 `src/app/meetingProcessing.test.tsx` 의 헤더 탭 이름 기대값(다섯 개)이다. 부하가 아니라 탭이 여섯 개가 된 실제 차이라 기대값을 고쳤고 그 파일만 다시 돌려 40개 통과했다.
- 같은 이유로 E2E 의 헤더 탭 기대값(`e2e/layout.e2e.ts`, `e2e/select-switch.e2e.ts`)도 고쳤다. 헤더 한 줄 검사를 768·1024·1280·1440px 에서, 키보드 순서 검사를 돌려 모두 통과했다. 768px 에서도 여섯 탭과 두 메뉴가 한 줄이다.
- 2026-11-10 origin/develop(#604 포함)을 병합했다. 충돌은 없었다. 병합 뒤 typecheck·lint·format:check·build 가 통과했고, 바꾼 곳의 테스트 59개 파일 939개가 통과했다. 전체 테스트는 병합 뒤 다시 돌리지 않았다.

## 리뷰 반영 (2026-11-10, PR #617 독립 리뷰)

Codex·Grok 리뷰에서 감독 세션이 고르게 한 일곱 가지를 고쳤다. 각 항목에 RTL 테스트를 더했고, 1~6 의 새 테스트는 고치기 전 코드에서 실패하는 것을 확인했다(아홉 개 실패). 7 의 테스트는 고치기 전에도 통과한다. 세션이 끝나면 요청 신호가 이미 취소돼 axios 가 보내지 않기 때문이다. 7 은 겹쳐 막는 장치다.

1. 그래프 노드의 누르는 자리. 보이는 점과 따로 투명한 원을 둔다. 반지름은 화면 기준 12px(지름 24px)이고 그래프가 그려진 너비로 viewBox 단위를 정한다. 누르는 원은 보이는 점들 아래 한 층이라 가까운 두 점에서도 보이는 점은 자기 점이 받는다. 390px 브라우저에서 태스크 점 3.6px, 누르는 자리 23.9px, 점에서 9px 옆을 눌러도 시트가 열렸다.
2. 휴대폰 시트를 닫으면 연 줄로 포커스가 돌아온다. [시트](../../../../../src/shared/ui/sheet/Sheet.tsx)에 `returnFocus` 를 더해 Radix `onCloseAutoFocus` 에 잇고, 돌려받은 요소가 아직 문서에 있을 때만 옮긴다.
3. 시트 안에서 다른 항목으로 넘어가면(주제 → 태스크) 새 제목으로 포커스를 옮긴다. 시트가 열린 채 제목이 바뀔 때만이다. 같은 시트를 쓰는 고르기·검색 고르기(47개 테스트)는 열린 동안 제목이 그대로라 영향이 없다.
4. 태스크끼리의 선을 [매퍼](../../../../../src/entities/project-map/model/mapper.ts)가 `relatedTasks` 로 한 번 만들고, 태스크 패널의 `이어진 태스크` 단추로 보인다. 누르면 그 태스크 패널이다. 주제 없는 맵에서도 같다.
5. `summary_status: none` 이면 이슈대로 요약 칸을 비운다. `pending` 과 모르는 값은 그대로다.
6. 목록 줄의 담당 이름은 96px 에서 말줄임하고 전체 이름을 `title` 로 둔다. 390px 브라우저에서 긴 이름(26자)으로 가로 넘침 0 을 확인했다.
7. 두 내려받기의 `mutationFn` 첫 줄에서 세션이 끝났으면 보내지 않는다(`REQUEST_CANCELED`, 알림 없음).

검사: typecheck·lint·build 통과, 바꾼 파일의 prettier 통과. 바꾼 곳 테스트 14개 파일 158개 통과. 전체 테스트(`npm run test -- --maxWorkers=1`, 커밋 `2228fad8`)는 319개 파일 4,105개 모두 통과했다(2,195초). 빌드 뒤 화면 chunk gzip 5.36KB, 그래프 chunk gzip 8.38KB.

## 남은 일

- #605 의 승인 대기 `summary_status` 문구와 남은 건수, 주제·결정 고치기, 전사 제목·본문 고치기.
- 큰 맵을 전체 보기로 보면 주제 이름이 겹친다. 라벨 충돌 피하기는 두지 않았다.
- 노드는 키보드로 고를 수 없다. 목록 보기와 태스크 패널의 `이어진 태스크` 가 같은 노드·연결을 준다(D-186).
- 이슈 예시 화면의 「그래프 아래 회의 요약본 목록」 은 두지 않았다. 요약본은 각 회의록에서 내려받는다.
