# M0 프로젝트 기반·검증 도구

2026-11-11 GitHub 조회와 저장소 기록을 대조한 사후 안내다. 원래 계획·완료조건과 당시 검증 결과를 소급해 바꾸지 않는다. PR 병합은 운영 검증 완료를 뜻하지 않는다.

[전체 작업 안내](../README.md) · [실제 병합 순서](../implementation-history.md)

## 처음 계획과 구현

| 원래 작업 이슈 | 실제 PR과 병합일 |
|---|---|
| [이슈 #34](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/34) CLOSED | [PR #35](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/35) MERGED · 2026-09-15 UTC |

## 원본 계획·결과·결정

- [basis-for-decision](basis-for-decision/)
- [plan.md](plan.md)
- [trouble-shooting](trouble-shooting/)

## 실제 이슈·PR별 후속 작업

아래 소속은 사후 탐색을 위한 주 담당 영역이다. 처음 계획에 이 작업들이 모두 포함돼 있었다는 뜻은 아니다.

| 작업 결과 원문 | 실제 이슈 상태 | PR 상태·병합일 |
|---|---|---|
| [결과 — Storybook 을 지우고 필요한 검사만 RTL·E2E 로 옮기기 (#482)](work-items/482-remove-storybook/result.md) | [이슈 #482](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/482) CLOSED | [PR #496](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/496) MERGED · 2026-11-07 UTC |
| [593 E2E 간헐 실패 원인과 교정](work-items/593-e2e-stability/result.md) | [이슈 #593](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/593) CLOSED | [PR #595](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/595) MERGED · 2026-11-09 UTC |

## 상태를 해석할 때

- OPEN 이슈에 MERGED PR이 연결돼 있어도 이슈를 완료로 바꾸지 않았다.
- 결과 원문의 `PR 전`·`미검증`은 당시 상태다. 위 GitHub 사실은 그 이후 병합 여부만 보완한다.
- 폴더 숫자가 PR인 기록도 있다. 이슈·PR은 위 링크 종류로 구분한다.
- AI·BE 구현과 연동 검증 기록은 FE의 지원·연결 근거로 읽는다. 모든 코드를 FE가 작성했다고 해석하지 않는다.
