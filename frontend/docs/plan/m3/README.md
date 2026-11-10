# M3 라우팅·데이터·세션 경계

2026-11-11 GitHub 조회와 저장소 기록을 대조한 사후 안내다. 원래 계획·완료조건과 당시 검증 결과를 소급해 바꾸지 않는다. PR 병합은 운영 검증 완료를 뜻하지 않는다.

[전체 작업 안내](../README.md) · [실제 병합 순서](../implementation-history.md)

## 처음 계획과 구현

| 원래 작업 이슈 | 실제 PR과 병합일 |
|---|---|
| [이슈 #77](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/77) CLOSED | [PR #107](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/107) MERGED · 2026-09-28 UTC |

## 원본 계획·결과·결정

- [basis-for-decision](basis-for-decision/)
- [plan.md](plan.md)
- [prev-todo-m3.md](prev-todo-m3.md)
- [trouble-shooting](trouble-shooting/)

## 실제 이슈·PR별 후속 작업

아래 소속은 사후 탐색을 위한 주 담당 영역이다. 처음 계획에 이 작업들이 모두 포함돼 있었다는 뜻은 아니다.

| 작업 결과 원문 | 실제 이슈 상태 | PR 상태·병합일 |
|---|---|---|
| [결과 — 셸 탭 다섯 개의 화면 코드와 첫 데이터 미리 받기 (#536, #539 B)](work-items/536-shell-tab-prefetch/result.md) | [이슈 #536](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/536) CLOSED | [PR #541](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/541) MERGED · 2026-11-07 UTC |
| [결과 — API 응답 zod 검증과 모르는 enum 처리 (#348)](work-items/348-response-schema/result.md) | [이슈 #348](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/348) CLOSED | [PR #588](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/588) MERGED · 2026-11-09 UTC<br>[PR #592](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/592) MERGED · 2026-11-09 UTC<br>[PR #597](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/597) MERGED · 2026-11-09 UTC<br>[PR #604](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/604) MERGED · 2026-11-09 UTC<br>[PR #634](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/634) MERGED · 2026-11-09 UTC<br>[PR #639](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/639) MERGED · 2026-11-09 UTC |
| [594 누를 때의 세션에서만 쓰기를 보낸다](work-items/594-stale-session-writes/result.md) | [이슈 #594](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/594) CLOSED | [PR #623](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/623) MERGED · 2026-11-09 UTC |

## 상태를 해석할 때

- OPEN 이슈에 MERGED PR이 연결돼 있어도 이슈를 완료로 바꾸지 않았다.
- 결과 원문의 `PR 전`·`미검증`은 당시 상태다. 위 GitHub 사실은 그 이후 병합 여부만 보완한다.
- 폴더 숫자가 PR인 기록도 있다. 이슈·PR은 위 링크 종류로 구분한다.
- AI·BE 구현과 연동 검증 기록은 FE의 지원·연결 근거로 읽는다. 모든 코드를 FE가 작성했다고 해석하지 않는다.
