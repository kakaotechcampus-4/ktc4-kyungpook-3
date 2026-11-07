# M7 리뷰 지적 사항

- 작성일: 2026-10-17
- 출처: M7 구현 뒤 두 검증 에이전트가 같은 미커밋 변경을 각각 따로 검토한 결과.
  - Claude Opus 5.5: `/code-review` high
  - Codex gpt-6.1-sol high: `review-agent`
- 상태: E-01·E-02 해결(2026-10-17), E-03·E-04·E-05 해결(2026-10-18). E-06은 M7 범위 밖이라 별도 이슈 [#236](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/236)로 분리했다. 아래 순서대로 하나씩 확인하고 해결한다.

두 리뷰 모두 치명적 버그는 없다고 판단했다. 리뷰 당시 AC-05·AC-06은 아래 문제로 미충족 또는 부분 충족이었다. 현재 [결과 문서](../result.md)는 AC-05를 E-01·E-02 해결로 충족, AC-06을 E-04 해결(2026-10-18)로 충족, AC-03을 E-03 해결(2026-10-18)로 충족으로 기록한다.

| 번호 | 문제 | 심각도 (Claude / Codex) | 관련 AC | 상태 |
|---|---|---|---|---|
| [E-01](E-01-member-sees-pm-link.md) | 일반 팀원에게 되돌린 행의 PM 전용 `확인 필요 보기` 링크가 보인다 | 중간 / P2 | AC-05 | 해결 (2026-10-17) |
| [E-02](E-02-refetch-error-hidden.md) | 재조회 실패가 화면에 안 보이고 polling이 조용히 멈춘다 | 낮음 / P2 | AC-03, AC-05 | 해결 (2026-10-17, 후속 두 번 2026-10-18) |
| [E-03](E-03-reverted-row-stale.md) | 재생성 승인을 처리해도 행이 `되돌림`과 낡은 링크에 머문다 | 중간 / 지적 없음 | AC-03 | 해결 (2026-10-18) |
| [E-04](E-04-focus-lost-after-revert.md) | 키보드로 되돌리기에 성공하면 포커스가 사라진다 | 지적 없음 / P2 | AC-06 | 해결 (2026-10-18) |
| [E-05](E-05-test-hygiene.md) | 테스트 이름·헬퍼 정확도 | 낮음 / 지적 없음 | — | 해결 (2026-10-18) |
| [E-06](E-06-m6-detail-refetch-error-hidden.md) | M6 태스크 상세도 재조회 실패를 숨긴다(E-02 검토 중 발견) | — / — | M7 범위 밖 | 별도 이슈 [#236](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/236) |

## 검증 범위

- Codex가 Node v24.21.0에서 대시보드 관련 테스트 5개 파일, 108개를 직접 실행해 모두 통과했다.
- Codex는 E-01·E-02·E-04를 메모리에서만 추가한 단언으로 재현했다. 저장소 파일은 수정하지 않았다.
- 전체 게이트는 두 리뷰 모두 다시 실행하지 않았다. 대상은 테스트 1766개, E2E, Storybook, 빌드다.

## 정리 항목

동작에는 영향이 없다. 해결 순서에 넣지 않고 기록만 한다. 출처는 Claude 리뷰다.

- `Dashboard.tsx`·`RecentSection.tsx`의 `useMemo`
  - 의존성이 매 렌더 새로 만드는 `Loadable` 객체라 메모가 무의미하다.
  - 그래서 3초 polling마다 전체 정렬·집계를 다시 한다.
- `ReviewSection`이 이미 정렬된 `waiting`을 다시 정렬한다.
- `recentEmptyReason`의 앞 두 분기는 실행되지 않는다. 판정 순서가 두 곳에 적혀 있다.
- 로직 복제 세 건
  - `approvalReason`: `ApprovalCard` 문구 로직 복제
  - `clock`: 시각 포맷 네 번째 복제
  - `latestDoneMeeting`: `latestMinutesId`와 같은 규칙
