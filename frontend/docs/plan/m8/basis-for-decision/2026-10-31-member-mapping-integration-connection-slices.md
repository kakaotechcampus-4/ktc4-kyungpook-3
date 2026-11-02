# 팀원 매핑을 `features/member-mapping`, 설정 연결을 `features/integration-connection`에 두는 선택

- 기록일: 2026-10-31 (커밋 e33df05·a6ddc2d·dfa3368은 2026-10-30)
- 관련 마일스톤: M8-B(#244) B-1 구현 순서 3~5

## 문제와 제약

- 계획 B-1 3단계는 매핑 모델을 온보딩 밖 슬라이스로 옮기고 "최종 위치는 착수 시 정해 `basis-for-decision`에 남긴다"고 정했다. 예정 위치는 `features/member-mapping`이다([계획](../plan.md) B 「구현 순서」).
- 4단계는 `MembersStep`의 폼 본문을 떼어 내되 위치를 "팀 화면이 쓸 수 있도록 `widgets` 또는 `features`"로 열어 두었다.
- 5단계는 설정 연결 훅을 provider에 대해 일반화하며 위치를 "`features/notion-connection/**` 또는 새 `features/integration-connection`"으로 열어 두었다.
- FSD 경계([eslint.config.js](../../../../eslint.config.js))상 `features`는 다른 `features`를 가져올 수 없다. `pages`·`widgets`는 `features`를 가져올 수 있다.
- 3·4단계는 리팩터링이라 기존 온보딩 테스트를 기대값 변경 없이 통과해야 한다(AC-B-03). 5단계는 Notion 영역의 동작과 기존 테스트 기대값을 바꾸지 않아야 한다(AC-B-04).

## 실제 검토한 선택지

계획이 적어 둔 후보가 검토 범위다. 그 밖의 대안을 비교한 기록은 없다.

1. 매핑 모델: `features/member-mapping`(계획의 예정 위치). 다른 위치를 비교한 기록은 없다.
2. 폼 본문: `widgets` 또는 `features`(계획 4단계의 두 후보).
3. 설정 연결: 기존 `features/notion-connection`에 Discord를 더하거나, 새 `features/integration-connection`으로 옮긴다(계획 5단계의 두 후보).

## 선택과 이유

- **매핑 모델과 폼 본문은 `features/member-mapping`에 함께 둔다.** 모델([memberMapping.ts](../../../../src/features/member-mapping/model/memberMapping.ts))은 내용 변경 없이 옮겼다(Git rename 100%). 폼 상태·검증·부분 저장·재시도는 [useMemberMappingForm](../../../../src/features/member-mapping/model/useMemberMappingForm.ts), 줄·PM 체크·오류 문구는 [MemberMappingFields](../../../../src/features/member-mapping/ui/MemberMappingFields.tsx)가 맡는다. 온보딩 widget의 [MembersStep](../../../../src/widgets/onboarding/ui/MembersStep.tsx)은 `features/member-mapping`과 `features/onboarding`을 조합하고, `확인 완료`·`나중에 하기`·나가기 저장만 직접 맡는다.
  - 폼을 `widgets` 대신 `features`에 둔 이유를 따로 비교한 기록은 없다. 이 배치로 확인되는 경계는 다음과 같다. 폼이 같은 슬라이스의 모델을 쓰므로 슬라이스 간 import가 생기지 않는다. `member-mapping`은 `onboarding` feature를 가져오지 않는다. 온보딩 widget과 B-2의 팀 화면(page·widget)이 모두 이 feature를 가져올 수 있다.
- **설정 연결은 `features/notion-connection`을 `features/integration-connection`으로 이름을 바꾼 슬라이스에 둔다.** 구현 보고의 이유는 "features끼리 import 금지라 Discord 영역과 공용 훅을 한 슬라이스에 둠"이다. Discord 영역이 별도 feature가 되면 공용 훅이 있는 Notion feature를 가져올 수 없다. 그래서 두 provider의 영역과 공용 훅을 한 슬라이스에 두었다.
  - provider 공통의 복귀 확인·`connecting` 대기·세션 종료와 이탈 경합 처리는 [useIntegrationConnection](../../../../src/features/integration-connection/model/useIntegrationConnection.ts)이 맡는다.
  - D-098 업로드 복귀와 `section=notion`은 Notion 래퍼 [useNotionConnection](../../../../src/features/integration-connection/model/useNotionConnection.ts)과 [NotionConnectionSection](../../../../src/features/integration-connection/ui/NotionConnectionSection.tsx)에만 남겼다.
  - 새 [DiscordConnectionSection](../../../../src/features/integration-connection/ui/DiscordConnectionSection.tsx)은 같은 공용 훅을 쓰며 성공 뒤 설정에 머문다(`connectedTo: null`).
  - 이름을 바꾼 별도 이유는 기록에 없다. 슬라이스가 이제 두 provider를 담는다는 사실만 커밋 dfa3368 제목에 있다.

## 장단점과 감수한 제약

- 모듈 경로가 바뀌어 옛 경로를 가리키던 문서 링크가 깨졌다. 아래 대응표가 옛 경로에서 현재 경로를 찾는 안내다. 깨진 위치는 [B 결과](../result-b.md)의 「남은 작업과 제한 사항」에 있다. 보호 문서(계획·refactor 기록)는 고치지 않았다.
- 같은 화면의 두 영역이 같은 연동 Query를 쓴다. 그래서 한 provider가 성공 복귀를 확인하는 동안 다른 영역은 일반 조회를 끈다(dfa3368). 확인 응답은 공유 캐시로 두 영역에 모두 보인다.
- `MemberMappingFields`는 온보딩 모양(`TextField tone="onboarding"`)을 그대로 쓴다. B-2 팀 화면에서 다른 모양이 필요하면 그때 prop으로 나눈다(구현 보고).
- 매핑 폼의 `requirePm`은 온보딩 완료 호출에만 `true`로 넘긴다. 온보딩 뒤 매핑 화면의 PM 체크 정책은 정하지 않았다(계획 「사용자에게 물을 질문」 6).

## 옛 경로와 현재 경로

경로는 `frontend/src/` 기준이다.

| 옛 경로 | 현재 경로 | 비고 |
|---|---|---|
| `features/onboarding/model/memberMapping.ts` | [features/member-mapping/model/memberMapping.ts](../../../../src/features/member-mapping/model/memberMapping.ts) | 내용 동일(rename 100%) |
| `features/onboarding/index.ts`의 매핑 공개 이름(`MappingSaveError`·`buildMappingRows`·`findMappingIssues`·`planRow`·`saveMemberMappings`, 타입 `MappingIssue`·`MappingOperation`·`MappingRow`) | [features/member-mapping/index.ts](../../../../src/features/member-mapping/index.ts) | `features/onboarding` 공개 진입점에서는 뺐다 |
| `features/onboarding/model/onboardingModel.test.ts`의 매핑 테스트(「팀원 매핑 규칙」, 「매핑 옮기기 (U3-r1 #5)」, 「PM 을 골라 잇기 (#228)」와 helper) | [features/member-mapping/model/memberMapping.test.ts](../../../../src/features/member-mapping/model/memberMapping.test.ts) | 기대값 그대로 이동. 「PM 을 골라 잇기 (#228)」는 이 파일 146행. [onboardingModel.test.ts](../../../../src/features/onboarding/model/onboardingModel.test.ts)에는 나머지 온보딩 모델 테스트가 남아 있다 |
| `widgets/onboarding/ui/MembersStep.tsx`의 폼 본문 | [useMemberMappingForm.ts](../../../../src/features/member-mapping/model/useMemberMappingForm.ts), [MemberMappingFields.tsx](../../../../src/features/member-mapping/ui/MemberMappingFields.tsx) | `MembersStep`은 같은 자리에 남아 조합만 한다 |
| `features/notion-connection/index.ts` | [features/integration-connection/index.ts](../../../../src/features/integration-connection/index.ts) | Discord 영역 공개 이름 추가 |
| `features/notion-connection/model/useNotionConnection.ts` | [model/useIntegrationConnection.ts](../../../../src/features/integration-connection/model/useIntegrationConnection.ts)(일반화한 본체) + [model/useNotionConnection.ts](../../../../src/features/integration-connection/model/useNotionConnection.ts)(Notion 래퍼, 새 파일) | 공개 이름 `useNotionConnection`은 유지 |
| `features/notion-connection/ui/NotionConnectionSection.tsx`·`.stories.tsx` | [ui/NotionConnectionSection.tsx](../../../../src/features/integration-connection/ui/NotionConnectionSection.tsx)·[.stories.tsx](../../../../src/features/integration-connection/ui/NotionConnectionSection.stories.tsx) | 스토리는 내용 동일 |
| `features/notion-connection/ui/NotionRequiredModal.tsx`·`.stories.tsx` | [ui/NotionRequiredModal.tsx](../../../../src/features/integration-connection/ui/NotionRequiredModal.tsx)·[.stories.tsx](../../../../src/features/integration-connection/ui/NotionRequiredModal.stories.tsx) | 내용 동일 |
| `features/notion-connection/lib/uploadReturn.ts`·`.test.ts` | [lib/uploadReturn.ts](../../../../src/features/integration-connection/lib/uploadReturn.ts)·[.test.ts](../../../../src/features/integration-connection/lib/uploadReturn.test.ts) | 내용 동일 |
| — | [ui/DiscordConnectionSection.tsx](../../../../src/features/integration-connection/ui/DiscordConnectionSection.tsx)·[.stories.tsx](../../../../src/features/integration-connection/ui/DiscordConnectionSection.stories.tsx), [ui/connectionStyles.ts](../../../../src/features/integration-connection/ui/connectionStyles.ts) | 새 파일 |

설정 Notion 통합 테스트([notionConnection.test.tsx](../../../../src/app/notionConnection.test.tsx))와 온보딩 팀원 연결 통합 테스트([onboardingMembers.test.tsx](../../../../src/app/onboardingMembers.test.tsx))는 자리를 옮기지 않았다.

## 영향 범위와 재검토 조건

- B-2의 팀 화면과 팀원 연결 재진입은 `features/member-mapping`을 가져와 조합한다. 재진입 형태(결정 5-a)가 정해져 폼을 widget 수준에서 다시 묶어야 하면 이 배치를 재검토한다.
- 5-b의 `연결 끊기` 등 연결 조작이 생기면 `features/integration-connection`에 넣는 것이 기본이다. 슬라이스가 지나치게 커지면 그때 나눈다.

## 근거와 관련 문서

- [M8 계획](../plan.md) B 「재사용 후보」·「구현 순서」 3~5·AC-B-03·AC-B-04
- [B 결과](../result-b.md)
- 커밋 e33df05(모델 이동), a6ddc2d(폼 분리), dfa3368(일반화·개명)
- 구현 보고(task_5c17d76f17c7)의 「결정·남은 일」. V2 리뷰 V2-01·V2-02, V3 리뷰 V3-DOC-01·V3-DOC-02(모두 저장소 밖 보고서)
- 이동 전 경로를 쓰는 과거 기록: [PM 연결 리팩터 계획](../../refactor/plan-onboarding-pm-discord-link.md), [PM 연결 리팩터 결과](../../refactor/result-onboarding-pm-discord-link.md)
