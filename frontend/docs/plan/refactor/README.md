# REFACTOR 독립 개선·검증·제품 정리

2026-11-11 GitHub 조회와 저장소 기록을 대조한 사후 안내다. 원래 계획·완료조건과 당시 검증 결과를 소급해 바꾸지 않는다. PR 병합은 운영 검증 완료를 뜻하지 않는다.

[전체 작업 안내](../README.md) · [실제 병합 순서](../implementation-history.md)

## 실제 이슈·PR별 후속 작업

아래 소속은 사후 탐색을 위한 주 담당 영역이다. 처음 계획에 이 작업들이 모두 포함돼 있었다는 뜻은 아니다.

| 작업 결과 원문 | 실제 이슈 상태 | PR 상태·병합일 |
|---|---|---|
| [결과 — 온보딩에서 기존 PM 멤버를 체크해 Discord 중복 멤버 생성 방지 (#228)](work-items/228-onboarding-pm-discord-link/result.md)<br>[원래 계획](work-items/228-onboarding-pm-discord-link/plan.md) | [이슈 #228](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/228) CLOSED | [PR #231](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/231) MERGED · 2026-10-14 UTC |
| [결과 — 태스크 상세 재조회 실패 안내 수정 (#236)](work-items/236-task-detail-refetch-error/result.md)<br>[원래 계획](work-items/236-task-detail-refetch-error/plan.md) | [이슈 #236](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/236) CLOSED | [PR #272](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/272) MERGED · 2026-11-02 UTC |
| [결정 요약 — 남은 제품 결정 (#293)](work-items/293-product-decisions/decisions.md) | [이슈 #293](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/293) CLOSED | [PR #294](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/294) MERGED · 2026-11-03 UTC |
| [결과 — 최신 완료 회의 선택의 전체 정렬 제거 (#350)](work-items/350-latest-done-meeting/result.md)<br>[원래 계획](work-items/350-latest-done-meeting/plan.md) | [이슈 #350](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/350) CLOSED | [PR #376](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/376) MERGED · 2026-11-05 UTC |
| [결과 — 간트 담당자별 분류를 한 번에 만든다 (#353)](work-items/353-gantt-group-rows/result.md)<br>[원래 계획](work-items/353-gantt-group-rows/plan.md) | [이슈 #353](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/353) CLOSED | [PR #377](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/377) MERGED · 2026-11-05 UTC |
| [결과 — TaskBoard 보기별 파생 연산과 탭 집계 줄이기 (#351)](work-items/351-taskboard-derived/result.md)<br>[원래 계획](work-items/351-taskboard-derived/plan.md) | [이슈 #351](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/351) CLOSED | [PR #387](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/387) MERGED · 2026-11-05 UTC |
| [362 문서 진입점과 현재 상태 정리](work-items/362-documentation-status/result.md) | [이슈 #362](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/362) CLOSED | [PR #591](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/591) MERGED · 2026-11-09 UTC |

## 상태를 해석할 때

- OPEN 이슈에 MERGED PR이 연결돼 있어도 이슈를 완료로 바꾸지 않았다.
- 결과 원문의 `PR 전`·`미검증`은 당시 상태다. 위 GitHub 사실은 그 이후 병합 여부만 보완한다.
- 폴더 숫자가 PR인 기록도 있다. 이슈·PR은 위 링크 종류로 구분한다.
- AI·BE 구현과 연동 검증 기록은 FE의 지원·연결 근거로 읽는다. 모든 코드를 FE가 작성했다고 해석하지 않는다.
