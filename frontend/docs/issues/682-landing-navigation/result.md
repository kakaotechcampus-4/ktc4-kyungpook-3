# 랜딩 헤더 이동 위치와 상단 여백 수정

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

## 남은 작업과 제한 사항

운영 배포는 수행하지 않았다. 빌드에는 CSS의 `var(...)` 토큰과 번들 크기 경고가 남아 있다. 마일스톤 전체 완료나 외부 Notion·Discord 연동 완료를 의미하지 않는다.
