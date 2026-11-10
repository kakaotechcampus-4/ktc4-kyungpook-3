# M8 태스크 보기·메시지·팀·설정

2026-11-11 GitHub 조회와 저장소 기록을 대조한 사후 안내다. 원래 계획·완료조건과 당시 검증 결과를 소급해 바꾸지 않는다. PR 병합은 운영 검증 완료를 뜻하지 않는다.

[전체 작업 안내](../README.md) · [실제 병합 순서](../implementation-history.md)

## 처음 계획과 구현

| 원래 작업 이슈 | 실제 PR과 병합일 |
|---|---|
| [이슈 #243](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/243) CLOSED<br>[이슈 #244](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/244) CLOSED<br>[이슈 #245](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/245) CLOSED<br>[이슈 #259](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/259) CLOSED | [PR #260](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/260) MERGED · 2026-11-02 UTC<br>[PR #262](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/262) MERGED · 2026-11-02 UTC<br>[PR #263](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/263) MERGED · 2026-11-02 UTC<br>[PR #264](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/264) MERGED · 2026-11-02 UTC |

PR #260은 계획 정리이며, 실제 구현은 A 태스크 보기 #262·B 설정과 팀 #264·C 메시지 #263으로 나뉜다.

## 원본 계획·결과·결정

- [basis-for-decision](basis-for-decision/)
- [plan.md](plan.md)
- [result-a.md](result-a.md)
- [result-b.md](result-b.md)
- [result-c.md](result-c.md)
- [trouble-shooting](trouble-shooting/)

## 실제 이슈·PR별 후속 작업

아래 소속은 사후 탐색을 위한 주 담당 영역이다. 처음 계획에 이 작업들이 모두 포함돼 있었다는 뜻은 아니다.

| 작업 결과 원문 | 실제 이슈 상태 | PR 상태·병합일 |
|---|---|---|
| [결과 — 태스크 보드 본문 폭을 리스트와 같게 (#466)](work-items/466-board-width/result.md) | [이슈 #466](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/466) CLOSED | [PR #476](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/476) MERGED · 2026-11-06 UTC |
| [결과 — 설정 Discord 카드의 `채널 바꾸기` 버튼 지우기 (#505)](work-items/505-discord-channel-button/result.md) | [이슈 #505](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/505) CLOSED | [PR #509](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/509) MERGED · 2026-11-07 UTC |
| [결과 — 메시지 묶음의 재촉 이유·근거·목록 요약 되살리기 (#394)](work-items/394-bundle-reason/result.md) | [이슈 #394](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/394) CLOSED | [PR #546](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/546) MERGED · 2026-11-08 UTC |
| [결과: PM·팀원 메시지 입력과 대화 시작, 웹 답장 안내 (#519, #525)](work-items/519-message-compose/result.md) | [이슈 #519](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/519) CLOSED | [PR #583](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/583) MERGED · 2026-11-09 UTC |
| [결과: 메시지 새 글 웹소켓 연결 (#558)](work-items/558-message-websocket/result.md) | [이슈 #558](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/558) CLOSED | [PR #587](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/587) MERGED · 2026-11-09 UTC |
| [364 알림 시나리오 문서 보완](work-items/364-notification-scenario/result.md) | [이슈 #364](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/364) OPEN | [PR #573](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/573) MERGED · 2026-11-09 UTC |
| [551 프로젝트 맵 화면과 회의 요약본 내려받기 결과](work-items/551-project-map/result.md) | [이슈 #551](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/551) CLOSED | [PR #617](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/617) MERGED · 2026-11-09 UTC |
| [613 Discord 연결 전 팀원 추가](work-items/613-member-without-discord/result.md) | [이슈 #613](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/613) CLOSED | [PR #635](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/635) MERGED · 2026-11-10 UTC |
| [631 아이디 초대 백엔드 통합 검증](work-items/631-backend-integration/result.md) | [이슈 #628](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/628) CLOSED | [PR #642](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/642) MERGED · 2026-11-10 UTC |
| [632 아이디로 팀원 초대 화면](work-items/632-invite-by-username/result.md) | [이슈 #632](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/632) CLOSED | [PR #640](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/640) MERGED · 2026-11-10 UTC |
| [결과 — Discord 를 연결한 팀도 서버에 없는 사람을 이름으로 추가한다 (#660)](work-items/660-member-add-discord-connected/result.md) | [이슈 #660](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/660) CLOSED | [PR #663](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/663) MERGED · 2026-11-10 UTC |
| [647 팀원 관리·온보딩 팀원 연결을 팀원 기준 목록으로](work-items/647-member-rows/result.md) | [이슈 #647](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/647) OPEN | [PR #665](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/665) MERGED · 2026-11-10 UTC |
| [551 묶음 B 프로젝트 맵에서 주제와 결정 고치기 결과](work-items/551-project-map/result-topic-edit.md) | [이슈 #551](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/551) CLOSED | [PR #674](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/674) MERGED · 2026-11-10 UTC |

## 상태를 해석할 때

- OPEN 이슈에 MERGED PR이 연결돼 있어도 이슈를 완료로 바꾸지 않았다.
- 결과 원문의 `PR 전`·`미검증`은 당시 상태다. 위 GitHub 사실은 그 이후 병합 여부만 보완한다.
- 폴더 숫자가 PR인 기록도 있다. 이슈·PR은 위 링크 종류로 구분한다.
- AI·BE 구현과 연동 검증 기록은 FE의 지원·연결 근거로 읽는다. 모든 코드를 FE가 작성했다고 해석하지 않는다.
