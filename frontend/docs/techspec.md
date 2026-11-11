# 프론트엔드 테크스펙

2026-11-11 저장소 코드와 기존 개발 기록을 기준으로 정리했다. 아래 구현 설명과 과거 실행 결과는 구분한다. 현재 운영 배포 상태는 [검증 범위](verification.md)에서 별도로 확인한다.

## 해결하는 문제와 사용자

PM은 회의와 메시지에서 나온 업무를 다시 옮기고, 담당자·마감을 보완하고, 변경을 확인해야 한다. 프론트엔드는 AI가 정리한 결과와 근거를 한곳에 보여 주고 필요한 항목만 검토하도록 연결한다. 팀원은 회의록·태스크를 읽고 자신의 대화에 답장한다. AI 판단과 자동 반영 여부의 최종 결정은 AI·백엔드의 책임이다.

핵심 흐름은 회의 입력 → 처리 추적 → 필요 시 화자 지정 → 회의록 → 확인이 필요한 제안 검토 → 태스크와 후속 메시지다. 근거는 [회의 처리 기록](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m5/result.md), [승인 기록](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m6/result.md), [메시지 기록](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m8/result-c.md)이다.

## 기술 구성과 책임

버전은 [package.json](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/package.json)의 선언 범위다. 정확한 설치 버전은 [package-lock.json](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/package-lock.json)을 기준으로 재현한다.

| 영역 | 기술 | 이 프로젝트에서 맡는 일 |
|---|---|---|
| 실행·빌드 | Node 24, Vite 8, TypeScript 6 | Node `>=24 <25`로 실행 환경을 제한하고 정적 웹 번들을 만든다. |
| 화면·주소 | React 19, React Router 7 | 경로별 화면 분리, 공간·역할별 가드, URL 상태 복원을 담당한다. |
| 서버 상태 | TanStack Query 5 | 조회·캐시·무효화·조건부 polling을 관리한다. |
| 일시적 UI 상태 | Zustand 5 | 토스트·미저장 변경·회의 처리 추적을 관리한다. |
| 요청·검증 | Axios, Zod 4 | 쿠키 요청, 응답 봉투 해제, 오류 정규화, 응답 스키마 검증을 담당한다. |
| 입력 | React Hook Form 7, Zod | 입력값·필드 오류·승인 수정값을 관리한다. |
| 스타일·조작 | Tailwind CSS 4, 디자인 토큰, Radix UI | 공통 외형, 모달·메뉴·선택기·포커스를 구현한다. |
| 보조 표현 | d3-force, date-fns | 프로젝트 맵의 관계 배치와 날짜 표현에 사용한다. |
| 자동 검사 | Vitest, React Testing Library, MSW 2, Playwright | 단위·화면 통합·실제 Chromium 사용자 여정을 검사한다. |

구체적인 데이터 흐름과 계층 규칙은 [구조](structure.md)에 정리했다. 기술 선택의 이유는 [대안과 결정](tradeoffs-decisions.md)에 모았다.

## 기능 구성

| 사용자 작업 | 프론트엔드 구현 | 오류·상태 경계와 근거 |
|---|---|---|
| 서비스 시작 | 가입·로그인·필수 동의·공간 선택·온보딩 | [정책 게시](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m4/work-items/565-policy-publication/result.md), [가입 아이디 연동](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m4/work-items/626-backend-integration/result.md). 실제 메일·Kakao 성공과 모의 공급사 검증을 구분한다. |
| 팀 구성 | 팀원 목록·아이디 초대·Discord 연결 | [아이디 초대](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m8/work-items/631-backend-integration/result.md). 웹 계정과 Discord 연결 상태를 구분한다. |
| 회의 입력·진행 확인 | 업로드, 전송률, 서버 처리 단계, 화면 이동 뒤 진행 토스트 | [M5](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m5/result.md), [진행 토스트](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m5/work-items/424-processing-toast/result.md). 업로드 100%를 처리 완료로 표시하지 않는다. |
| 화자 지정·실패 복구 | 화자별 팀원 지정과 처리 재개, 실패 사유·재업로드 안내 | [화자 지정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m5/basis-for-decision/2026-11-05-speaker-assignment-screen.md), [인계 실패](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m5/work-items/598-upload-unclaimed/result.md). |
| 결과 검토 | 요약·전사문·추출 항목·근거·확인 사유 | [AI 결과 화면](ai-result-ui.md), [전사 의심 사유](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m6/work-items/643-asr-suspect-reason/result.md). 점수로 승인 결정을 유도하지 않는다. |
| 승인과 반영 | 누락값 보완·승인·반려·충돌 비교·자동 반영 되돌리기 | [승인 결정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m6/basis-for-decision/2026-11-04-approval-edits-and-conflict-confirmation.md). Notion은 조회 상태가 `synced`일 때 완료로 표시한다. |
| 업무 확인 | 대시보드, 태스크 리스트·보드·간트·캘린더, 프로젝트 맵 | [M7](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m7/result.md), [태스크 보기](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m8/result-a.md), [프로젝트 맵](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m8/work-items/551-project-map/result.md). |
| 후속 소통 | 발송 전 초안 확인·웹 답장·대화 갱신·알림·브라우저 푸시 | [실시간 메시지](realtime-messages.md). 메시지 변경 신호와 실제 발송 성공을 구분한다. |

## API와 상태 규약

대표 명세는 [프론트엔드 API 계약](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/contracts/frontend-api-contract.md)이다. 이 페이지는 엔드포인트나 오류 코드 원본을 복제하지 않는다.

- 요청 기본 경로는 `/api/v1`이다. Axios는 `withCredentials`로 쿠키를 보낸다. FE는 인증 토큰을 Web Storage에 저장하거나 직접 갱신하지 않는다.
- entity API가 `unknown` 응답을 스키마로 검증하고 DTO를 도메인 모델로 변환한다. 화면은 도메인 모델을 사용한다.
- 알 수 없는 상태를 정상 값으로 꾸미지 않는다. 쓰기 판단에 필요한 값의 오류와 표시용 부가 정보의 오류는 다르게 처리한다.
- 승인에서 필드 생략은 기존 제안을 유지하고, 명시적 `null`은 미정으로 취급한다.
- 읽기 실패와 쓰기 결과 미확인을 구분한다. 쓰기 응답을 해석하지 못하면 서버 반영 여부를 재조회하도록 안내한다.

## 실행과 품질 기준

설치·환경 변수·배포는 [로컬 실행](../../docs/dev/local-setup.md), [환경 변수](../../docs/dev/env.md), [배포](../../docs/dev/deploy.md)가 원본이다. 개발은 실제 API가 기본이며 `VITE_ENABLE_MSW=true`일 때 모의 API를 명시적으로 사용한다. 실제 API 실패를 모의 성공으로 바꾸지 않는다.

주요 품질 기준은 키보드로 업로드·승인을 마치는 흐름, 최소 360px 레이아웃, 오류가 발생한 위치의 안내, 계정 전환 뒤 이전 요청 차단이다. 자동 검사와 운영 확인의 차이는 [검증과 데모](verification.md)에 정리했다.

속도 관련 구현과 측정은 [성능 개선](performance.md)에서 확인한다. 첫 화면 LCP, 재렌더 횟수, API 요청 수, 계산 시간과 로딩 경험을 구분한다.
