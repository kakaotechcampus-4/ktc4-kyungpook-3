# 랜딩 내용·브랜드 디자인과 탐색 개선

## 작업 근거와 요약

2026-11-11 사용자 요청으로 랜딩 헤더의 제품·기능·연동 이동 위치를 확인했다. 추가로 지적한 기능 카드의 상단 여백 부족을 수정했다. 작업 식별자는 [PR #682](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/682)다. 기존 마일스톤 계획은 수정하지 않았다.

## 실제 구현 및 관련 코드

- [헤더](../../../src/pages/landing/ui/LandingHeader.tsx)의 연동 목적지를 `#values`에서 `#integrations`로 바꿨다.
- [소개 절](../../../src/pages/landing/ui/LandingSections.tsx)의 섹션 ID를 데이터에 명시했다. 연동은 Notion·Discord를 설명하는 "승인한 것만 나갑니다" 절로 이동한다.
- 기능 카드와 가치 절에 `scroll-mt-56`을 적용했다. 제품 미리보기의 기존 내부 여백과 맞춰 내용 상단이 화면 위에서 56px 떨어진다. 일반 문서 배치는 바꾸지 않았다.
- [회귀 검사](../../../e2e/landing-navigation.e2e.ts)는 1280px·1440px 창에서 세 헤더 링크를 클릭해 URL 조각과 내용 위치를 확인한다.

## 요청 조건 확인

| 사용자 요청                          | 상태 | 근거                                                        |
| ------------------------------------ | ---- | ----------------------------------------------------------- |
| 제품·기능·연동의 이동 위치 수정      | 충족 | Chromium에서 제품 미리보기·기능 카드·연동 설명 절 도착 확인 |
| 기능 내용이 화면 위에 붙지 않게 수정 | 충족 | 수정 전 카드 상단 0px, 수정 후 56px                         |

## 검증 내역

2026-11-11 Windows, Node v24.21.0에서 확인했다. 프론트엔드 명령은 `fnm exec --using 24.21.0`으로 실행했다.

- 배포 사이트 Chromium 재현에서 기능은 `#features` 상단 0px, 연동은 `#values`로 이동했다.
- Playwright `landing-navigation.e2e.ts`는 수정 전 4개 실패·2개 통과, 수정 후 6개 통과했다. API는 MSW를 사용했으며 실제 외부 연동은 검증 범위가 아니다.
- `npm.cmd run test -- src/app/landing.test.tsx`는 11개 통과했다.
- `npm.cmd run typecheck`, `npm.cmd run build`, 변경 파일의 ESLint·Prettier, `git diff --check`가 통과했다.
- 기능 화면 PNG를 열어 상단 여백을 확인했다. 로컬 증거는 `.verify/landing-navigation/`의 로그·PNG·trace에 보관했다. 실행 포트 5297의 종료를 확인했다.

## 후속 요청인 업무 소개 탭

같은 날 사용자가 "이런 일을 맡길 수 있어요" 아래 다섯 항목을 선택할 수 있게 하고 각 설명을 작성해 달라고 요청했다.

- 회의록 정리·마감 리마인드·담당자 배치·진행 상황 점검·주간 요약을 ARIA 탭으로 바꿨다. 기본 선택은 회의록 정리다.
- 업무 ID·이름·두 문장을 같은 데이터 목록에 두고 선택한 업무의 설명을 표시한다. 주간 요약 문구는 회의록과 태스크로 한 주를 돌아보는 용도이며 자동 생성·정기 발송을 약속하지 않는다.
- 클릭과 좌우 방향키 순환, Home·End 이동, Tab으로 설명 패널과 다음 링크에 진입하는 동작을 지원한다. 기존 알약 모양과 하단 링크는 유지했다.
- 단일 설명 패널의 최소 높이를 두 줄에 맞췄다. 1280px·1440px에서 다섯 탭을 바꿔도 패널 높이와 하단 링크 위치가 같은 것을 확인했다.

2026-11-11 같은 Node 24 환경에서 추가 검증했다.

- [컴포넌트 검사](../../../src/pages/landing/ui/LandingSections.test.tsx)는 변경 전 탭 부재로 3개 실패했고 변경 후 3개 통과했다.
- Playwright `landing-navigation.e2e.ts`는 기존 앵커 6개와 새 탭 2개를 합쳐 8개 통과했다. 다섯 업무의 설명과 선택 상태, 키보드 전환과 패널 진입, 설명 영역과 하단 링크 위치를 검증했다.
- 기존 랜딩 검사 11개, TypeScript 검사, 프로덕션 빌드가 통과했다. 변경 파일의 ESLint·Prettier와 `git diff --check`도 확인했다.
- 실제 Chromium의 주간 요약 선택 화면 PNG를 열어 선택 표시와 두 줄 설명을 확인했다. 로컬 로그·PNG·trace는 `.verify/landing-capabilities/`에 보관했다.

## 최신 제품 내용과 브랜드 디자인 갱신

2026-11-11 사용자가 develop에 추가된 기능을 반영하고 브랜드 주황색과 먹색으로 랜딩을 다시 디자인해 달라고 요청했다. `origin/develop`의 `59773dd4`를 기존 PR에 병합한 `f82c90ae`를 조사 기준으로 삼았다.

- [회의록](../../../src/widgets/meeting-minutes/ui/MinutesBody.tsx), [프로젝트 맵](../../../src/widgets/project-map/ui/ProjectMapView.tsx), [웹 답장](../../../src/widgets/message-inbox/ui/ReplyForm.tsx), [프로젝트 합본](../../../src/features/project-bundle-download/ui/ProjectBundleDownload.tsx) 구현을 확인해 소개 문구를 작성했다.
- 회의 제목·전사문 수정과 승인 후 요약, 프로젝트 맵, 리스트·보드·캘린더·간트, 웹 메시지와 답장, Markdown 내보내기를 소개한다.
- Notion은 태스크 반영, Discord는 웹 메시지 알림으로 구분했다. 재촉의 자동 승인 설정과 연동 없이 웹에서 시작할 수 있는 범위도 반영했다.
- 근거 없는 10분 처리 시간, 텍스트 붙여넣기 업로드, 모든 작업 복원, 대화창 부재, 모든 발송의 수동 승인으로 읽히는 기존 문구는 제거했다.
- 두 HTML 시안을 1440px·390px Chromium에서 비교했다. 첫 화면에서 설명과 제품 예시를 함께 보는 밝은 분할 구성을 선택하고, 다른 시안의 실제 네 단계 업무 흐름을 가져왔다.
- 주황색은 CTA·선택 탭·업무 흐름에, 먹색은 제목·제품 프레임·연동 영역에 사용한다. 주황 배경의 작은 글자는 먹색이다. 기존 NanumSquare와 전역 색상 토큰은 유지했다.
- [제품 예시](../../../src/pages/landing/ui/ProductPreview.tsx)를 정적 태스크 화면으로 바꾸고 예시임을 명시했다. 개발용 마스코트 포즈 설명, 비활성 문의 버튼과 연결되지 않는 푸터 목록을 정리했다.
- 기존 세 헤더 앵커와 56px 이동 여백, 로그인으로 가는 시작하기 링크 세 개, 다섯 업무 탭과 키보드 계약, 실제 정책 링크를 유지했다.

| 요청 조건 | 상태 | 근거 |
| --- | --- | --- |
| 최신 develop 기능에 맞는 소개 | 충족 | 실제 코드 조사와 새 기능·연동 범위에 대한 별도 리뷰 |
| 주황·먹색 브랜드 디자인 | 충족 | 계산된 CTA 색상과 두 먹색 토큰 확인, 데스크톱·모바일 PNG 직접 검토 |
| 기존 헤더 이동·업무 탭 보존 | 충족 | 기존 Chromium 8개 회귀 통과 |
| 모바일에서도 읽을 수 있는 배치 | 충족 | 360·390·768·1024·1280·1440px 검사에서 가로 넘침 없음 |

추가 검증은 Windows와 Node v24.21.0에서 수행했다.

- 변경 전 baseline에서는 390px 화면의 문서 폭이 771px였다. 변경 후 360~1440px 여섯 폭에서 문서 폭이 창을 넘지 않았다.
- `LandingSections.test.tsx`, `landing.test.tsx`, `landingEntry.test.tsx`, `router/routes.test.tsx` 네 파일의 Vitest 53개가 통과했다.
- `landing-navigation.e2e.ts`의 Chromium 8개가 통과했다. 실행 포트 5302의 종료를 확인했다.
- 기존 `layout.e2e.ts`의 랜딩을 모바일 검사 대상에 등록했다. 여섯 폭의 레이아웃, 실제 정책 링크 두 개와 첫 방문·로그인·랜딩 복귀를 합친 Chromium 9개가 통과했고 포트 5303도 종료됐다. 증거는 `.verify/landing-redesign/smoke-artifacts/`와 `smoke.log`다.
- 독립 검증 helper의 최종 여섯 검사가 통과했다. CTA 경로·색상, 고유 앵커, 다섯 설명 전환, 방향키·Home·End·Tab 포커스, 설명과 하단 링크 위치를 확인했다. `sourceStable=true`, `playwrightExit=0`, `portOpen=false`다.
- 초기 helper는 검사 폭을 여섯 개로 늘린 뒤에도 성공 개수를 세 개로 집계해 실패했다. 집계 설정을 수정하고 실제 재실행해 `passed=true`를 확인했다. 해당 초기 기록은 성공으로 변경하지 않았다.
- 타입 검사, 변경 파일의 ESLint·Prettier, 프로덕션 빌드, `git diff --check`가 통과했다. 주황 면 위 마무리 CTA의 포커스 링은 바깥으로 띄우고 실제 Tab 진입 PNG로 확인했다.
- 로컬 증거는 `.verify/landing-redesign/`에 있다. 최종 화면 검증은 `baseline-artifacts/check-2026-11-10T19-42-24-245Z/`, 구현 검사는 `implementation-artifacts/`에 보관했다. 실행 명령은 저장소 루트의 `fnm exec --using 24.21.0 node .verify/landing-redesign/verify.cjs check`다.

## 먹색 중심 최종 팔레트 조정

같은 날 사용자가 시작하기 버튼·활성 업무 탭·마지막 안내 영역을 먹색 배경과 흰 글씨로 통일하고, 주황은 작은 포인트로만 사용하도록 요청했다.

- 시작하기 세 개와 활성 업무 탭에 기존 `ink-solid` 면과 흰 글씨를 적용했다. 마지막 먹색 영역의 버튼에는 흰 테두리와 바깥 포커스 링을 더했다.
- 마지막 안내 영역의 제목·본문을 흰색 계열로 바꿨다. 업무 흐름·연동의 긴 주황 선과 Markdown 안내의 살구색 면은 중립색으로 바꿨다. 브랜드 점·단계 번호·작은 상태 표식에 주황을 남겼다.
- 기존 내용·레이아웃·앵커·키보드·선택 상태는 유지했다. 앱 변경은 `styles.ts`, `LandingSections.tsx`, `LandingClosing.tsx` 세 파일의 팔레트에 한정했다.
- 360·390·768·1024·1280·1440px Chromium 여섯 검사가 통과했다. 모든 시작하기와 활성 탭의 계산된 색이 먹색 `rgb(51, 51, 51)`과 흰색 `rgb(255, 255, 255)`인지 확인했다. 마지막 영역의 배경·제목과 흰 포커스 링도 확인했다.
- 변경 파일의 ESLint·Prettier, 프로덕션 빌드와 `git diff --check`가 통과했다. 최종 PNG를 직접 검토했다. 근거는 `.verify/landing-redesign/baseline-artifacts/check-2026-11-10T19-59-09-241Z/`이며 소스 해시는 같고 포트 5301은 닫혔다.

## 최종 버튼 윤곽과 매스 소개

같은 날 사용자가 마지막 시작하기의 두 겹 테두리를 수정하고 마스코트 매스 소개를 추가해 달라고 요청했다.

- 기본 테두리와 4px 떨어진 키보드 포커스 외곽선이 두 줄로 보였다. 외곽선 간격을 제거하고 기존 전역 -1px 위치에서 겹치게 해 한 윤곽으로 표시한다. 흰색 2px 키보드 포커스는 유지했다.
- [매스 소개](../../../src/pages/landing/ui/MascotIntroduction.tsx)를 핵심 기능 설명 다음에 추가했다. 기존 공용 `Mascot`의 먹색 캐릭터를 재사용하고, 이름·마스코트 역할·실제로 등장하는 서비스 시작·회의 처리·메시지 확인 맥락을 소개한다.
- 새 상태나 포즈 선택 기능, 이미지 자산은 추가하지 않았다. 기존 눈 깜빡임과 움직임 줄이기 지원을 사용한다. 모바일은 설명 다음 캐릭터, 데스크톱은 왼쪽 캐릭터와 오른쪽 설명으로 배치했다.
- 랜딩 Vitest 12개, 타입 검사, 변경 파일의 ESLint·Prettier, 프로덕션 빌드와 `git diff --check`가 통과했다.
- 360~1440px 여섯 Chromium 검사에서 매스 소개의 접근성 이름과 이미지, 기존 탭·경로·먹색 팔레트, 한 위치로 겹친 포커스 윤곽을 확인했다. 데스크톱·모바일 매스와 마지막 버튼 PNG를 직접 검토했다.
- 실행 근거는 `.verify/landing-redesign/baseline-artifacts/check-2026-11-10T20-10-58-973Z/`다. `sourceStable=true`, `playwrightExit=0`, `portOpen=false`를 확인했다.

## 남은 작업과 제한 사항

운영 배포는 수행하지 않았다. 빌드에는 CSS의 `var(...)` 토큰과 번들 크기 경고가 남아 있다. 마일스톤 전체 완료나 외부 Notion·Discord 연동 완료를 의미하지 않는다.
