# M5 회의 입력·처리·회의록

2026-11-11 GitHub 조회와 저장소 기록을 대조한 사후 안내다. 원래 계획·완료조건과 당시 검증 결과를 소급해 바꾸지 않는다. PR 병합은 운영 검증 완료를 뜻하지 않는다.

[전체 작업 안내](../README.md) · [실제 병합 순서](../implementation-history.md)

## 처음 계획과 구현

| 원래 작업 이슈 | 실제 PR과 병합일 |
|---|---|
| [이슈 #143](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/143) CLOSED | [PR #169](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/169) MERGED · 2026-10-06 UTC |

과거 이슈 #126도 CLOSED이지만 대체·종료 PR 근거는 확인하지 못했다. 실제 구현 이슈 #143과 PR #169에 같은 완료 관계로 묶지 않는다.

## 원본 계획·결과·결정

- [basis-for-decision](basis-for-decision/)
- [m5-done-criteria.md](m5-done-criteria.md)
- [m5-handoff.md](m5-handoff.md)
- [plan.md](plan.md)
- [result.md](result.md)
- [trouble-shooting](trouble-shooting/)

## 실제 이슈·PR별 후속 작업

아래 소속은 사후 탐색을 위한 주 담당 영역이다. 처음 계획에 이 작업들이 모두 포함돼 있었다는 뜻은 아니다.

| 작업 결과 원문 | 실제 이슈 상태 | PR 상태·병합일 |
|---|---|---|
| [결과 — 채팅 출처 회의 표시 (#379)](work-items/379-chat-meeting/result.md) | [이슈 #379](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/379) CLOSED | [PR #386](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/386) MERGED · 2026-11-05 UTC |
| [결과 — 받아 둔 회의 상세 뒤 403·404를 볼 수 없는 회의로 (#405)](work-items/405-meeting-unavailable/result.md) | [이슈 #405](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/405) CLOSED | [PR #414](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/414) MERGED · 2026-11-06 UTC |
| [결과 — 회의 정리 진행 신호를 오른쪽 아래 토스트로 (#424)](work-items/424-processing-toast/result.md) | [이슈 #424](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/424) CLOSED | [PR #453](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/453) MERGED · 2026-11-06 UTC |
| [결과 — 정리 중 채팅 회의가 업로드를 막던 문제 (#450)](work-items/450-chat-upload-entry/result.md) | [이슈 #450](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/450) CLOSED | [PR #487](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/487) MERGED · 2026-11-07 UTC |
| [결과 — 회의 올리기에서 Notion 연결 필수 빼기 (#507)](work-items/507-notion-optional/result.md) | [이슈 #507](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/507) CLOSED | [PR #516](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/516) MERGED · 2026-11-07 UTC |
| [결과 — 회의 정리 중 단계를 실제 처리 순서에 맞추기 (#483 B안)](work-items/483-processing-steps/result.md) | [이슈 #483](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/483) OPEN | [PR #521](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/521) MERGED · 2026-11-07 UTC<br>[PR #656](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/656) MERGED · 2026-11-10 UTC |
| [576 회의 삭제와 보존 태스크 표시](work-items/576-meeting-delete/result.md) | [이슈 #576](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/576) OPEN | [PR #582](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/582) MERGED · 2026-11-08 UTC |
| [560 요약 통합 결과](work-items/560-summary-integration/result.md) | [이슈 #462](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/462) CLOSED | [PR #560](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/560) MERGED · 2026-11-09 UTC<br>[PR #600](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/600) MERGED · 2026-11-09 UTC<br>[PR #602](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/602) MERGED · 2026-11-09 UTC |
| [598 가져가지 않은 업로드의 만료 이력과 안내](work-items/598-upload-unclaimed/result.md) | [이슈 #598](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/598) CLOSED | [PR #615](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/615) MERGED · 2026-11-09 UTC |
| [614 화자 지정 대기 토스트 닫기](work-items/614-speaker-toast-dismiss/result.md) | [이슈 #614](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/614) CLOSED | [PR #633](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/633) MERGED · 2026-11-09 UTC |
| [483 AI 전사 트랙 진행 보고 결과](work-items/483-ai-stt-progress/result.md) | [이슈 #483](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/483) OPEN | [PR #653](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/653) MERGED · 2026-11-10 UTC |
| [645 승인 뒤 요약 PR 리뷰 반영](work-items/645-summary-review/result.md) | 연결 이슈 근거 없음 | [PR #645](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/645) MERGED · 2026-11-10 UTC |
| [669 회의 기록 편집 PR 리뷰 반영](work-items/669-record-edit-review/result.md) | [이슈 #605](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/605) CLOSED | [PR #669](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/669) MERGED · 2026-11-10 UTC |
| [551 회의록 요약 칸의 승인 대기 상태 결과 (묶음 A)](work-items/551-project-map/result-summary-awaiting.md) | [이슈 #551](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/551) CLOSED | [PR #671](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/671) MERGED · 2026-11-10 UTC |
| [551 회의록 제목·전사 줄 고치기 결과](work-items/551-project-map/result-minutes-edit.md) | [이슈 #551](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/551) CLOSED | [PR #672](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/672) MERGED · 2026-11-10 UTC |
| [결과 — '원문 듣기'가 회의록 녹음을 근거 시각부터 튼다 (#676)](work-items/676-audio-playback/result.md) | [이슈 #676](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/676) OPEN | [PR #680](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/680) MERGED · 2026-11-10 UTC |

## 상태를 해석할 때

- OPEN 이슈에 MERGED PR이 연결돼 있어도 이슈를 완료로 바꾸지 않았다.
- 결과 원문의 `PR 전`·`미검증`은 당시 상태다. 위 GitHub 사실은 그 이후 병합 여부만 보완한다.
- 폴더 숫자가 PR인 기록도 있다. 이슈·PR은 위 링크 종류로 구분한다.
- AI·BE 구현과 연동 검증 기록은 FE의 지원·연결 근거로 읽는다. 모든 코드를 FE가 작성했다고 해석하지 않는다.
- FE 원문 듣기 PR #680은 MERGED이며 BE 녹음 보관 PR #670의 조회 상태는 OPEN다. 실제 운영 재생 검증과 구분한다.
