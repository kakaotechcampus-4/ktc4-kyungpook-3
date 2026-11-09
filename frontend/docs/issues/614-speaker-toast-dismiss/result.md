# #614 화자 지정 대기 토스트 닫기

## 작업 근거

[#614](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/614)는 PM의 화자 지정 대기 카드와 팀원의 대기 알약에 닫기를 추가하도록 요청했다. [작성자 댓글](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/614#issuecomment-6747224135)에서 새로고침 전까지만 숨기고 polling은 유지하는 방식이 확정됐다. 2026-11-10 사용자가 이 내용대로 작업을 요청했다. 마일스톤 계획 밖의 이슈 작업이며 전체 계획과 사람의 트러블슈팅은 수정하지 않았다.

## 실제 변경

- [추적 store](../../../src/entities/meeting/model/processingTracker.ts)에 메모리 `dismissed` 목록과 `dismissProcessingToast(TrackedMeeting)`를 추가했다. 공간·회의 복합 ID로 구분하며 중복 닫기는 상태를 바꾸지 않는다. 추적 대상·완료 처리·결과 기록은 유지한다. 기존 `clearTrackedMeetings`가 숨김도 초기화한다.
- [토스트](../../../src/features/meeting-processing/ui/ProcessingToast.tsx)는 원본 subject가 진행 중 또는 화자 지정 대기일 때만 숨긴다. 팀원 대기가 processing 모양으로 표시되는 경우와 settled 저장 전 먼저 도착한 done도 구분한다. 완료·실패 결과에는 숨김 기록을 적용하지 않으며 기존 역할 정책을 유지한다.
- [카드와 알약](../../../src/features/meeting-processing/ui/ProcessingToastCard.tsx)에 닫기를 제공한다. 같은 표시를 재사용하는 일반 정리 중 카드·알약도 닫을 수 있다. 알약의 펼치기·닫기는 형제 button이며, 각각 키보드 포커스를 갖는다. 펼친 카드의 접기와 닫기도 나란히 둔다.
- 닫기와 회의록 열기에서 상태를 바꾸기 전에 기존 세션 유효성을 검사한다. 끝난 세션의 버튼이 다음 계정의 알림을 바꾸지 않는다.

별도 표시 store는 만들지 않았다. 기존 store가 이미 prompted와 settled를 소유하므로 숨김 collection도 같은 초기화 경로를 쓰는 편이 작다. 서버 API·응답 규약·역할 매핑·추적 hook·discovery hook·polling 간격은 변경하지 않았다. 파트 간 계약 변경이 없어 대표 API 계약은 갱신하지 않았다. localStorage나 sessionStorage에 숨김 상태를 저장하지 않는다.

## 요구사항과 검증

| 요청 | 검증 근거 |
|---|---|
| PM 카드에서 닫은 뒤 다른 화면에서도 다시 나타나지 않는다 | app integration과 Chromium PM 여정에서 닫기·화면 이동을 확인했다. |
| 팀원 대기 알약도 같은 수명을 따른다 | integration과 Chromium 1280px·360px에서 키보드 닫기·이동·새로고침 뒤 재발견을 확인했다. |
| 닫아도 추적이 계속되고 완료 결과가 뜬다 | integration에서 polling·정리 재개·done·캐시 무효화를 확인했다. Chromium에서는 목록 진입·화자 라디오 선택·제출·처리 화면·다른 화면의 완료 카드·회의록 열기를 실제 UI로 수행했다. |
| 닫은 회의의 처리·화자 지정 화면에 접근할 수 있다 | PM은 기존 목록에서 지정하고 처리 화면으로 이동했다. 팀원은 기존 화자 지정 대기 화면을 열었다. 역할 권한은 유지한다. |
| 새로고침 전까지만 숨긴다 | 같은 브라우저 여정에서 시나리오를 재설정하지 않고 reload했다. 대기 카드·알약이 다시 보였다. |
| 다른 공간·계정과 키보드 사용을 보존한다 | store의 복합 ID·clear·중복 닫기와 stale 세션 callback을 검사했다. 형제 button·접기 포커스 복귀·닫기 포커스·가로 넘침 없음과 기존 메시지 위치 기준을 검사했다. |

## 실제 실행

구현 전 Chromium에서 PM 대기 카드가 보이지만 닫기 button이 없음을 재현했다. 수정 후 다음 검사를 실행했다. 명령은 `frontend` 기준이다.

- 관련 unit·integration 10파일 165개 통과. tracker·진행 토스트·processing signal·처리 화면·화자 지정·로그아웃·세션 만료·늦은 응답 회귀를 포함한다.
- `npx playwright test e2e/processing-toast-dismiss.e2e.ts e2e/messages-toast.e2e.ts --retries=0 --workers=1 --trace=on`에서 Chromium 12개 통과. 전용 UI 여정 4개와 기존 메시지 geometry 8개다. 위치 오차 1px와 기존 아래·오른쪽 간격 기준은 유지했다.
- Node 24에서 전체 unit·integration 4,056개와 `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run policy:check`, `npm run build`를 통과했다. `git diff --check`도 통과했다.

화면·trace·명령 로그와 독립 검토는 로컬 `.verify/issue-614/`에 보관한다. 검증 도구나 개인 증거는 커밋하지 않는다. 브라우저 API는 MSW이며 실제 운영 회의·외부 AI·메시지 발송을 검증한 결과는 아니다. 전체 suite·CI·병합·배포 결과는 연결된 PR과 Actions 기록으로 구분한다.

## 제한 사항

새로고침 뒤 다시 보이는 것은 확정한 동작이다. 기기에 계속 숨김을 저장하는 옵션은 없다. 닫기는 화자 지정이나 회의 처리를 취소하지 않는다. PM의 실패 결과와 팀원의 실패 미표시는 기존 역할 정책을 따른다. 원본 API·AI 동작과 서버 데이터에는 변경이 없다.
