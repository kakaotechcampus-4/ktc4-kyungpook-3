# #566 정책 문서 진입점과 업로드 전송 안내

## 작업 근거와 요약

2026-11-08 사용자 요청 #572에 따라 #566 중 BE를 기다리지 않는 화면 틀·랜딩 링크·업로드 안내를 구현했다. 마일스톤 계획 밖의 이슈 작업이다. 정책 확정·개인정보처리방침 공개·가입 동의 수집 완료를 뜻하지 않는다.

## 실제 구현

- `/terms`, `/privacy`를 인증 가드 밖에 두어 로그인 여부와 무관하게 연다. 하나의 [policy slice](../../../src/pages/policy/ui/PolicyPage.tsx)와 닫힌 문서 종류·[공통 metadata](../../../src/shared/config/policy.ts)를 사용한다.
- 랜딩 footer의 이용약관·개인정보처리방침을 실제 링크로 바꾸고, 각 화면에 준비 중 안내와 문서 간 이동을 제공한다. 미확정 본문·시행일·운영자·동의 상태는 만들지 않는다.
- [업로드 폼](../../../src/features/meeting-upload/ui/MeetingUploadForm.tsx)의 제출 근처에 #566 요청 문구를 추가한다. 체크박스는 추가하지 않는다. 실제 폼과 aria-hidden skeleton은 [같은 고정 안내](../../../src/shared/config/meetingUpload.ts)를 같은 문단 구조로 표시한다.
- API 요청·응답 규약은 바꾸지 않았다. 계약 문서와 보호 계획·사람의 트러블슈팅 원문은 수정하지 않았다.

## 요청 조건과 결과

| #572가 지정한 독립 범위                   | 상태          | 근거                                                                                                         |
| ----------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------ |
| 두 문서 화면 틀과 랜딩 링크               | 구현·MSW 검증 | [실제 route 단위 테스트](../../../src/app/policyPages.test.tsx), [브라우저 여정](../../../e2e/policy.e2e.ts) |
| 로그인 여부와 관계없이 직접 진입·새로고침 | MSW 검증      | 두 경로의 비로그인·로그인 접근과 reload                                                                      |
| 외부 전송 안내, 추가 체크박스 없음        | 구현·MSW 검증 | 안내를 확인한 뒤 실제 파일 선택·참석자 입력·제출·해당 회의록 도착                                            |
| 업로드 skeleton 정합성                    | MSW 검증      | [route-skeleton](../../../e2e/route-skeleton.e2e.ts)의 1280px·360px 안내 문구 anchor. 기존 허용오차 유지     |
| 확정 문서·가입/로그인 후 동의 API         | 후속          | #565 정책·제공자 확인, #571 원문, #569 API의 선행 조건 필요                                                  |
| upload_unclaimed 목록·실패 안내           | 후속          | #567과 #566 추가 요청을 별도 범위로 유지                                                                     |

## 실제 검증

Node v24.21.0, 기준 develop `fad771968eb5a98d0b734414888641f03ed17a27`에서 실행했다.

- 변경 전 기존 landing·meetingUpload·routes 단위 테스트 75개 통과. 새 routed 테스트 8개는 구현 전에 모두 실패한 뒤 구현 후 통과했다. 최종 4파일 83개 통과.
- 실제 Chromium·Vite·MSW로 정책 여정 7개와 업로드 route skeleton 2개가 통과했다. 별도 검증 에이전트의 같은 9개도 통과했다. 재시도·skip·flaky는 없었다.
- 독립 검토에서 초기 데스크톱 PNG가 로딩 스플래시를 담은 한계를 발견했다. 캡처 전 스플래시 종료 단언을 추가하고 최종 소스로 9개를 다시 실행했다. 최종 데스크톱 화면을 직접 확인했고 실행 전후 소스 hash가 같으며 검증용 포트가 닫힌 것을 확인했다. trace·PNG·Doctor·결과 JSON은 로컬 `.verify/`에 보존했다.
- typecheck, 전체 lint, build, 변경 파일 Prettier와 `git diff --check`가 통과했다. 새 검증 스킬·개인 HTML·실행 증거는 PR에 포함하지 않는다.

저장소 기본 명령으로 같은 테스트를 다시 선택할 수 있다. 아래는 재실행용 명령이며, 실제 증거 수집은 로컬 검증 wrapper로 Doctor·trace·종료 검사를 함께 실행했다.

```powershell
cd frontend
npm run test -- src/app/policyPages.test.tsx src/app/landing.test.tsx src/app/meetingUpload.test.tsx src/app/router/routes.test.tsx
npm run test:e2e -- policy.e2e.ts route-skeleton.e2e.ts --grep '랜딩 하단|비로그인으로|로그인한 사용자도|휴대폰 폭|외부 전송 안내|회의 올리기' --workers=1 --retries=0 --trace=on
```

## 선택과 제한

동적 문서 경로 대신 고정 경로 두 개를 택했다. 정해진 두 문서에 URL kind 검증과 미등록 문서 분기를 추가하지 않기 위해서다. 본문은 #565에서 확정될 때까지 준비 상태로 두고, 미병합 Markdown을 복제하거나 새 렌더러 의존성을 추가하지 않았다.

이 결과는 MSW UI 검증이다. 실계정·실메일·Kakao·Discord·Notion·실제 음성 처리·정책 법률 검토는 증명하지 않는다. #566·#572 전체를 완료 처리하지 않으며 공개 전 선행 정책·동의·음성 삭제 구현과 배포 확인이 남아 있다.
