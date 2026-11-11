# #614 화자 지정 대기 토스트 닫기

## 작업 근거

[#614](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/614)는 PM의 화자 지정 대기 카드와 팀원의 대기 알약에 닫기를 추가하도록 요청했다. [작성자 댓글](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/614#issuecomment-6747224135)에서 새로고침 전까지만 숨기고 polling은 유지하는 방식이 확정됐다. 2026-11-10 사용자가 이 내용대로 작업을 요청했다. 마일스톤 계획 밖의 이슈 작업이며 전체 계획과 사람의 트러블슈팅은 수정하지 않았다.

## 실제 변경

- [추적 store](../../../../../src/entities/meeting/model/processingTracker.ts)에 메모리 `dismissed` 목록과 `dismissProcessingToast(TrackedMeeting)`를 추가했다. 공간·회의 복합 ID로 구분하며 중복 닫기는 상태를 바꾸지 않는다. 추적 대상·완료 처리·결과 기록은 유지한다. 기존 `clearTrackedMeetings`가 숨김도 초기화한다.
- [토스트](../../../../../src/features/meeting-processing/ui/ProcessingToast.tsx)는 원본 subject가 진행 중 또는 화자 지정 대기일 때만 숨긴다. 팀원 대기가 processing 모양으로 표시되는 경우와 settled 저장 전 먼저 도착한 done도 구분한다. 완료·실패 결과에는 숨김 기록을 적용하지 않으며 기존 역할 정책을 유지한다.
- [카드와 알약](../../../../../src/features/meeting-processing/ui/ProcessingToastCard.tsx)에 닫기를 제공한다. 같은 표시를 재사용하는 일반 정리 중 카드·알약도 닫을 수 있다. 알약의 펼치기·닫기는 형제 button이며, 각각 키보드 포커스를 갖는다. 펼친 카드의 접기와 닫기도 나란히 둔다.
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

## 병합 뒤 배포 E2E 보정

2026-11-10, [기능 PR #633](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/633) 병합 뒤 [배포 실행 42679198532](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/actions/runs/42679198532)에서 기존 #598 업로드 만료 E2E 한 건이 실패했다. 같은 실행의 나머지 E2E 331개는 통과했다. 이 실행의 배포 단계는 건너뛰었다.

실패한 retry trace와 화면에는 `/meetings/mt_11/processing`의 `정리 시작 기한이 지났어요` 제목과 `실패 사유 보기` 링크가 있었다. 회의 목록 화면은 아니었다. 후속 목록 응답에는 해당 회의의 `failed`와 `upload_unclaimed`가 있으므로 목록 데이터 유실은 아니다. 기존 테스트가 같은 제목만 보고 만료 목록·상세에 도착했다고 가정한 것이 직접 실패 원인이다.

[추적 hook](../../../../../src/features/meeting-processing/model/useProcessingTracker.ts)의 `leaveProcessingScreen`은 커밋된 경로와 현재 기록 경로가 모두 처리 화면일 때만 자동 이동한다. 빠른 실패 응답과 화면 커밋의 순서가 이 조건을 놓쳤다는 설명은 CI trace·소스와 일치하는 추론이다. React 내부 커밋 시점은 직접 계측하지 않았다. [기존 완료 여정 helper](../../../../../e2e/support.ts)도 즉시 완료가 먼저 도착해 처리 화면의 링크로 이동하는 대체 경로를 정상 동작으로 다룬다.

[회의 흐름 E2E](../../../../../e2e/meeting-flow.e2e.ts)의 화자 지정 7일 만료와 업로드 24시간 만료 두 여정에서 제목 확인 뒤 헤더의 **회의록** 메뉴와 **기한 만료** 목록의 업로드 행을 직접 누른다. 기존 행·사유·상세·새로고침·재업로드 단언을 유지했다. 화자 만료의 회의 ID도 상세 본문 확인 뒤 읽는다. 앱 코드·역할 정책·API·추적기·timeout·retry 설정은 변경하지 않았다.

별도 조사에서 변경 전 원래 한 건은 로컬에서 통과했고, lazy 화면 로드 순서를 강제한 네 시도는 CI 실패를 재현하지 못했다. 이미 끝난 회의의 processing URL에 실제로 들어간 뒤 **회의록**, 만료 행, 상세, 새로고침, 재업로드를 누른 별도 Chromium 여정 한 건은 통과했다. 이는 정상 대체 화면에서 이력을 열 수 있다는 검증이며 CI 내부 실행 순서를 재현했다는 뜻은 아니다. 조사 근거는 로컬 `.verify/issue-614/deploy-failure-investigation/`에 보관한다.

Node 24.21.0, 포트 5399에서 `fnm exec --using 24.21.0 npx.cmd playwright test e2e/meeting-flow.e2e.ts --retries=0 --workers=1 --trace=on`으로 최종 소스의 전체 파일 12개가 통과했다. 최종 실행 전후 추적 대상 frontend 파일 1,501개의 SHA256과 `mtime_ns`를 비교해 변경 0건을 확인했다. Vite 종료 뒤 결과 문서만 갱신했다.

앞선 별도 실행에서는 검증 중 결과 문서를 편집해 Vite 재로딩이 관찰됐고 기존 ②가 완료 토스트를 찾지 못했다. 이 실행은 파일 변경의 영향을 받은 검증으로 따로 보관했다. ②의 재시도 없는 단독 실행과 파일을 고정한 최종 전체 실행은 모두 통과했다. ②나 시간 설정은 수정하지 않았다.

로그·receipt·화면·trace는 로컬 `.verify/issue-614/ci-test-fix/`에 보존한다. 이 테스트 보정의 원격 CI·병합·배포 결과는 연결된 PR과 Actions 기록으로 구분한다.

## 제한 사항

새로고침 뒤 다시 보이는 것은 확정한 동작이다. 기기에 계속 숨김을 저장하는 옵션은 없다. 닫기는 화자 지정이나 회의 처리를 취소하지 않는다. PM의 실패 결과와 팀원의 실패 미표시는 기존 역할 정책을 따른다. 원본 API·AI 동작과 서버 데이터에는 변경이 없다.
