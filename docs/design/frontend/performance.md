# 프론트엔드 성능 개선

2026-11-11 기존 측정·개발 기록과 현재 소스를 대조해 정리했다. 이번 문서화에서 벤치마크를 새로 실행하지 않았다. 수치는 아래에 표시한 과거 환경의 결과이며 현재 운영 서비스의 응답 시간으로 해석하지 않는다.

성능 작업은 첫 화면을 늦추는 요청, 태스크 변경 때의 불필요한 렌더, 카드마다 반복되는 API 조회, 화면 이동 때의 중복 계산을 줄이는 데 집중했다. 사전 조회와 로딩 표시는 별도로 사용자 대기 경험을 다듬었다.

## 개선 결과를 읽는 기준

| 작업 | 확인한 결과 | 수치의 의미와 한계 |
|---|---|---|
| Bold 폰트 preload 제거 | HTTP/2 로그인 LCP 중앙값 4,340 → 3,848ms | production·Slow 4G·캐시 없음·구성별 7회. 실제 API 지연은 제외했다. |
| 태스크 보기의 재렌더 감소 | 단일 태스크 변경 시 다른 항목의 재렌더가 보드 309 → 0, 간트 311 → 0, 캘린더 315 → 6 | 태스크 310건의 렌더 계측이다. 화면 전체의 렌더 횟수나 처리 시간은 아니다. |
| 막힌 카드별 추가 조회 제거 | 막힌 카드 세 개의 회귀 검사에서 목록 조회 1회, 카드별 상세·이력 조회 0회 | 과거 500건 측정과 수정 후 세 카드 검사는 데이터 규모가 다르다. 같은 규모의 속도 개선율은 산출하지 않았다. |
| 보기 전환의 파생 계산 제거 | URL의 보기·달·주만 바뀔 때 `buildTaskBoard` 호출 0회 | 개발 빌드 프로파일과 호출 계측이다. 화면 전환 전체 시간의 차이는 잡음과 겹쳤다. |
| 최신 완료 회의 선택 | 1만 건 함수 호출 중앙값 약 61ms → 1.5~1.6ms | Node 마이크로벤치마크다. 실제 규모인 수십 건의 체감 개선은 주장하지 않는다. |

각 행은 서로 다른 측정이다. 요청 수·렌더 횟수·함수 실행 시간을 하나의 서비스 성능 개선율로 합치지 않는다.

## 첫 화면에서 폰트와 JavaScript의 대역폭 경쟁을 줄였다

기존에는 Regular와 Bold 폰트를 동시에 preload했다. 제한 네트워크에서 두 폰트가 첫 화면 JavaScript와 같은 회선을 사용했고, 화면 코드를 다 받기 전까지 첫 렌더가 기다렸다.

여섯 구성을 비교한 뒤 Regular preload만 유지했다. Bold는 해당 굵기가 쓰일 때 받는다. 현재 [index.html](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/index.html)에도 Regular 하나만 preload한다.

아래는 2026-11-05 측정의 중앙값과 최소~최대다. 각 행은 변경 전후 각각 7회다. 전체 실험은 여섯 구성 × 두 화면 × 두 프로토콜 × 7회로 168회이며, 기록상 예상하지 않은 HTTP 오류와 녹화되지 않은 API 호출은 0건이다.

| 프로토콜·화면 | 변경 전 LCP, ms | 변경 후 LCP, ms | 중앙값 차이 |
|---|---|---|---|
| HTTP/2 로그인 | 4,340, 범위 4,332~4,368 | 3,848, 범위 3,820~3,876 | 492ms 감소 |
| HTTP/2 대시보드 | 4,700, 범위 4,684~4,732 | 4,136, 범위 4,096~4,176 | 564ms 감소 |
| HTTP/1.1 로그인 | 6,520, 범위 6,500~6,592 | 5,512, 범위 5,448~5,544 | 1,008ms 감소 |
| HTTP/1.1 대시보드 | 7,300, 범위 7,224~7,344 | 6,732, 범위 6,716~6,772 | 568ms 감소 |

측정은 production 번들, headless Chromium 1280×900, 캐시 비활성, Slow 4G 지연 562.5ms·다운로드 180,000B/s 조건이다. 구성 순서를 회차마다 순환했다. API는 녹화 응답을 지연 없이 재생했고 CPU 제한은 없었다. HTTP/2는 Node 자체 서명 TLS 서버이며 운영 Caddy 자체를 측정한 결과가 아니다.

관측된 병목은 첫 화면 JavaScript 다운로드다. Bold 약 163KB의 선행 전송을 늦춰 JS가 사용할 대역폭을 확보했다. HTTP/1.1에서 연결 슬롯 해제까지 영향을 줬다는 설명은 원문에서도 추정이다.

대가는 글꼴 교체다. HTTP/2 로그인에서 굵은 글씨는 첫 그림 뒤 약 1.5초 동안 폴백 글꼴로 보였다. 폰트 적용 완료는 늦어졌으므로 모든 로딩이 빨라졌다고 설명하지 않는다. 본문 Regular는 유지했다. 최종 화면·표본 글리프의 동일성과 preload 파일·`crossorigin` 회귀 검사를 기록했다.

근거는 [폰트 재측정 원문](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/performance/2026-11-05-font-loading-remeasure.md), [측정 스크립트](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/performance/2026-11-05-font-loading-bench/measure.mjs), [집계 스크립트](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/performance/2026-11-05-font-loading-bench/summarize.mjs)다.

## 태스크 하나가 바뀔 때 다른 항목의 렌더를 줄였다

태스크 보기에서 하나의 상태 변경이 다른 카드·행·칩의 렌더까지 유발했다. 보기의 항목을 memo로 나누고 전달하는 배열·콜백의 참조를 안정화했다. 변경되지 않은 항목은 같은 입력을 받아 렌더를 건너뛴다.

| 태스크 310건, 단일 상태 변경 | 변경 전 다른 항목의 재렌더 | 변경 후 다른 항목의 재렌더 |
|---|---|---|
| 보드 | 309 | 0 |
| 간트 | 311 | 0 |
| 캘린더 | 315 | 6 |

이 값은 [M8-A 결과의 렌더 계측](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m8/result-a.md)에 기록돼 있다. Vitest·jsdom에서 상세 링크 `GuardedLink` 호출을 주소별로 세고 조건마다 두 번 실행했다. 캘린더에 남은 6회는 확인 필요·회의 칩이다. 당시 React Profiler 시간은 흔들림이 커 성능 근거에서 제외했다. 렌더 계측의 원시 자료는 커밋되지 않았다는 한계도 원문에 남아 있다.

[taskViewsRender.test.tsx](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/src/app/taskViewsRender.test.tsx)는 횟수뿐 아니라 변경된 태스크의 완료 표시도 확인한다. 필요한 화면 갱신을 막아 숫자만 낮추는 회귀를 구분한다. 렌더 시간 상한이나 FPS는 이 기록에서 측정하지 않았다.

## 막힌 카드마다 반복하던 API 조회를 없앴다

기존 보드는 카드가 자동으로 막혔는지 알아내기 위해 카드마다 상세·이력을 조회했다. 2026-11-05의 태스크 500건 조건에서는 보드 전환 중 상세 127회·이력 254회가 기록됐다. 이력이 상세의 두 배였던 이유는 당시 확정하지 않았다.

후속 #365에서는 BE가 목록의 태스크 응답에 `auto_blocked`를 제공하고 FE가 그 값을 사용하도록 맞췄다. 상태를 알아내려고 모든 카드의 이력을 다시 읽을 필요가 없어졌다. FE와 BE가 데이터 계약을 함께 바꿔 반복 조회를 제거한 사례다.

수정 후 [회귀 검사](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/src/app/taskAutoBlock.test.tsx)는 막힌 카드 세 개에서 태스크 목록 1회와 카드별 상세·이력 0회를 확인한다. 원래의 500건 측정 도구는 다시 실행하지 않았으므로 381회가 같은 조건에서 0회가 됐다는 전후 결과로 발표하지 않는다.

근거는 [TaskBoard 측정 원문의 후속 기록](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/performance/2026-11-05-taskboard-derived.md)이다. 사용자 지연 시간과 서버 부하의 감소율은 별도로 측정하지 않았다.

## URL 이동 때 필요 없는 파생 계산을 건너뛰었다

마감 조건 배열 `query.due`는 URL을 읽을 때마다 새로 만들어졌다. 내용이 같아도 참조가 달라져 캘린더 달 이동·간트 주 이동·보기 변경마다 리스트용 정렬과 탭 집계인 `buildTaskBoard`가 다시 실행됐다.

이슈 #391에서는 마감 조건을 문자열 값으로 비교하고 같은 `parseDue`로 복원하도록 memo 의존값을 바꿨다. 날짜·보기만 바뀌면 계산을 건너뛰고, 실제 필터·정렬·담당자가 바뀌면 다시 계산한다.

2026-11-05 Chromium·MSW 개발 빌드에서 전 → 후 → 전 → 후로 측정했다. 500·2,000건 각각 동작별 전후 6개 표본이다. 2,000건의 캘린더 다음 달에서는 `buildTaskBoard`의 프로파일 시간이 2.1~3.2ms에서 관측되지 않는 수준으로 바뀌었다. 별도 호출 검사로 해당 이동의 호출 0회를 확인했다.

화면 전체 바쁜 시간은 전후 범위가 겹쳤고 당시 다른 작업도 함께 돌았다. 따라서 화면 전환이 몇 배 빨라졌다는 결론은 내리지 않았다. 확인한 효과는 불필요한 계산 한 번의 제거다.

근거는 [memo 결정·전후 측정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m8/basis-for-decision/2026-11-05-task-board-due-value-memo.md)와 [호출 회귀 검사](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/src/app/taskBoardRecompute.test.tsx)다.

## 최신 완료 회의 하나를 고르기 위한 전체 정렬을 제거했다

대시보드가 회의 하나를 고르려고 전체 목록을 복사·정렬·분류했다. `latestDoneMeeting`을 완료 회의만 한 번 순회하는 방식으로 바꿨다. 같은 시각일 때 앞의 회의를 고르는 규칙과 잘못된 날짜의 처리도 유지했다.

2026-11-05 Windows·Node 24.11.0에서 minify한 실제 함수들을 비교했다. 크기별 전후 7회씩 번갈아 측정한 실험을 두 번 실행했다. 표본마다 약 200ms 반복 호출했고 결과를 소비하며 선택한 객체가 같은지 먼저 확인했다.

| 입력 규모 | 변경 전 중앙값, 두 실행 | 변경 후 중앙값, 두 실행 |
|---|---|---|
| 회의 30건 | 49.2 / 53.4µs | 3.27 / 3.82µs |
| 회의 10,000건 | 61.4 / 61.8ms | 1.59 / 1.50ms |

1만 건의 첫 실행 범위는 전 56.4~71.7ms, 후 1.43~1.72ms다. 두 번째는 전 59.0~69.4ms, 후 1.46~1.58ms다. 별도 CPU 프로파일에서 반복 `Date.parse`가 주요 비용으로 확인됐다. 정렬 비교 때마다 날짜를 다시 읽던 비용을 완료 회의당 한 번으로 줄였다.

실제 수십 건에서는 절약 시간이 수십 µs여서 사용자 체감 개선을 주장하지 않았다. 브라우저 대시보드 전체 렌더 시간은 재지 않았고 추가 `useMemo`도 넣지 않았다. 당시 CPU 사용률은 다른 작업으로 39~65%였다. 현재 함수에는 후속 인자도 추가돼 있으므로 과거 결과를 현재 함수의 새 측정으로 보지 않는다. 근거와 전체 크기별 범위는 [#350 결과](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/refactor/result-latest-done-meeting.md)에 있다.

## 대기 경험은 별도로 개선했다

| 작업 | 구현·검증 근거 | 발표에서 구분할 점 |
|---|---|---|
| 태스크 보기 코드 분할 | [M8-A 결과](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m8/result-a.md). 보드·캘린더·간트가 별도 청크이며 리스트 진입 시 로드하지 않고 선택 시 불러오는지 검사했다. | 초기 로딩과 선택한 보기의 코드 대기를 나누는 구현이다. 이 변경만의 첫 화면 LCP 차이는 측정하지 않았다. |
| 셸 탭의 코드·첫 데이터 사전 조회 | [#536](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/issues/536-shell-tab-prefetch/result.md). 탭 접근 의도·유휴 시간에 받고 데이터 절약 설정을 고려한다. 과거 다섯 탭 E2E는 API를 350ms 늦추고 사전 조회 완료 뒤 첫 이동의 뼈대·빈 자리가 없는지 검사했다. | 현재 셸은 프로젝트 맵을 포함한 여섯 탭이다. 모든 방문에서 대기가 0이라는 결과는 아니다. 사전 요청량과 캐시 사용이 늘어난다. |
| 로딩 표시의 번쩍임 완화 | [#508](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/issues/508-skeleton-delay/result.md). 200ms 뒤 표시하고 한 번 보이면 최소 400ms 유지한다. | API나 계산을 빠르게 하는 변경이 아니다. 이미 받은 내용 표시를 잠시 늦출 수 있다. |
| 로그인 직후 스플래시 순서 정리 | [#539](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/issues/539-login-splash-instant/result.md). 덮개를 즉시 표시해 뼈대가 먼저 보이는 순서를 막았다. | 300ms는 제거한 표시 대기 설정이다. 로그인 응답이나 전체 진입 시간이 300ms 줄었다는 측정이 아니다. |

## 측정 후 채택하지 않은 시도

- 폰트 unicode-range 분할은 첫 화면 폰트 전송량을 325KB에서 234KB로 줄였다. 하지만 Regular preload 조건을 맞추면 두 화면·두 프로토콜의 LCP가 92~220ms 늦었다. 요청 수·CSS 증가에 비해 이득이 없어 적용하지 않았다. 원인 일부는 추정이며 결과는 [폰트 원문](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/performance/2026-11-05-font-loading-remeasure.md)에 남겼다.
- TaskBoard의 보기별 파생 계산 전면 분리는 보류했다. 2,000건의 독립 계산 비용은 약 5.3~8.7ms였지만 개발 화면에서 관측한 CPU 비중은 최대 약 5%였다. production 화면의 비중은 측정하지 않아 체감 효과를 단정하지 않았다. 후속 memo 수정과 카드별 조회 제거는 별도로 반영했다.
- 대량 보드의 약 41초 진입 기록은 MSW의 DB 전체 `sessionStorage` 저장 비용이 크게 포함됐다. 실제 서비스의 초기 보드 성능이나 개선 전 수치로 사용하지 않는다. 근거는 [측정에서 제외한 결과](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/performance/2026-11-05-taskboard-derived.md)다.

## 다시 측정할 때와 발표에 쓸 범위

폰트와 파생 계산의 재현 도구·환경 준비·명령은 [성능 원자료](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/tree/develop/frontend/docs/performance)에 있다. 폰트 구성 비교 도구는 소스·폰트를 잠시 바꿔 빌드하므로 진행 중인 작업과 분리한 체크아웃에서 사용한다.

후속 측정은 최종 production 번들과 실제 API에서 첫 진입 LCP, 탭 이동, 태스크 변경 지연을 확인하는 것이 우선이다. 현재 기록에는 운영 API 지연·느린 휴대폰 CPU·실기기 브라우저가 함께 포함된 전후 결과가 없다. 폰트 측정에서 남은 JS와 화면 조각의 순차 다운로드도 후보이며, 후속 변경 뒤 최종 네트워크 기록으로 다시 확인해야 한다.

발표에서는 첫 화면 LCP, 다른 항목의 렌더 횟수, 카드별 추가 조회 제거를 각각 설명할 수 있다. 각 수치의 날짜·환경·대상을 함께 제시한다. 평가표의 완성도·속도·사용성 근거와 연결하되 현재 서비스 전체의 개선율로 확대하지 않는다.
