# M2 디자인 토큰·공통 UI

2026-11-11 GitHub 조회와 저장소 기록을 대조한 사후 안내다. 원래 계획·완료조건과 당시 검증 결과를 소급해 바꾸지 않는다. PR 병합은 운영 검증 완료를 뜻하지 않는다.

[전체 작업 안내](../README.md) · [실제 병합 순서](../implementation-history.md)

## 처음 계획과 구현

| 원래 작업 이슈 | 실제 PR과 병합일 |
|---|---|
| [이슈 #36](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/36) CLOSED | [PR #47](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/47) MERGED · 2026-09-18 UTC |

## 원본 계획·결과·결정

- [basis-for-decision](basis-for-decision/)
- [focus-visible-outline.md](focus-visible-outline.md)
- [plan.md](plan.md)
- [trouble-shooting](trouble-shooting/)

## 실제 이슈·PR별 후속 작업

아래 소속은 사후 탐색을 위한 주 담당 영역이다. 처음 계획에 이 작업들이 모두 포함돼 있었다는 뜻은 아니다.

| 작업 결과 원문 | 실제 이슈 상태 | PR 상태·병합일 |
|---|---|---|
| [결과 — 강조색 레드 다섯 값과 설정 알림 문구 (#423)](work-items/423-accent-red/result.md) | [이슈 #423](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/423) CLOSED | [PR #433](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/433) MERGED · 2026-11-06 UTC |
| [결과 — 나머지 선택 상자 다섯 곳을 공용 선택 상자로 바꾸기 (#477)](work-items/477-select-rollout/result.md) | [이슈 #477](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/477) CLOSED | [PR #493](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/493) MERGED · 2026-11-07 UTC |
| [결과 — 간격 토큰의 0 (#497)](work-items/497-spacing-zero/result.md) | [이슈 #497](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/497) CLOSED | [PR #500](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/500) MERGED · 2026-11-07 UTC |
| [결과 — 스켈레톤 지연·최소 표시 규칙과 화면과 맞지 않는 스켈레톤 정리 (#508)](work-items/508-skeleton-delay/result.md) | [이슈 #508](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/508) CLOSED | [PR #527](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/527) MERGED · 2026-11-07 UTC<br>[PR #534](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/534) MERGED · 2026-11-07 UTC |
| [결과 — 먹색을 글자 `#262626`과 면 `#333333`으로 나눈다 (#677)](work-items/677-ink-split/result.md) | [이슈 #677](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/677) CLOSED | [PR #678](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/678) MERGED · 2026-11-10 UTC |

## 상태를 해석할 때

- OPEN 이슈에 MERGED PR이 연결돼 있어도 이슈를 완료로 바꾸지 않았다.
- 결과 원문의 `PR 전`·`미검증`은 당시 상태다. 위 GitHub 사실은 그 이후 병합 여부만 보완한다.
- 폴더 숫자가 PR인 기록도 있다. 이슈·PR은 위 링크 종류로 구분한다.
- AI·BE 구현과 연동 검증 기록은 FE의 지원·연결 근거로 읽는다. 모든 코드를 FE가 작성했다고 해석하지 않는다.
