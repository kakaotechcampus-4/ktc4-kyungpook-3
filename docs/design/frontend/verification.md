# 검증 범위와 발표 데모

2026-11-11 기존 결과·설정과 소스를 대조했다. 이번 작업은 문서화이며 앱 전체 회귀나 운영 연동을 새로 실행하지 않았다. 기능 구현, 과거 테스트 통과, 현재 배포 성공은 각각 다른 근거로 판단한다.

## 무엇을 검증했는가

| 검사 | 실제 경계 | 확인할 수 있는 것 | 이 검사로 보장하지 않는 것 |
|---|---|---|---|
| Vitest·React Testing Library | jsdom·MSW·모의 DB | 상태·권한별 화면, 요청값·응답 오류·캐시와 세션 경계 | 실제 브라우저 배치·외부 서비스 성공 |
| Playwright | 실제 Chromium·Vite·MSW | 클릭·키보드·주소·화면 전환·모의 저장·재조회 | 실제 AI·운영 BE·Notion·Discord 성공 |
| 동의 공개 E2E | 별도 설정·시나리오·리포트 | 정책 게시 전후·재동의·필수 항목 저장 | 법적 적정성·실제 가입 공급사의 가용성 |
| API 연동 기록 | 격리 HTTPS·SQLite·메일 수집·Kakao MockTransport | 실제 BE 응답과 DB 저장을 잇는 가입·초대 흐름 | 실제 메일·Kakao 성공, PostgreSQL 잠금·경합 |
| 메시지 소켓 기록 | MSW 소켓, 가짜 BE·Vite 프록시 | 변경 신호·경합·재연결·종료·개발 프록시 | 운영 BE·Caddy를 거친 소켓 성공 |
| 대비·레이아웃·키보드 E2E | Chromium, 지정 화면·너비 | 실제 색 대비·넘침·포커스·업로드·승인 조작 | WCAG 전 항목 준수·스크린 리더 실사용·iOS 실기기 |

근거는 [프론트엔드 CI](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/.github/workflows/frontend-ci.yml), [Playwright 설정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/playwright.config.ts), [동의 설정](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/playwright.consent.config.ts), [#626](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m4/work-items/626-backend-integration/result.md), [#631](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m8/work-items/631-backend-integration/result.md), [#558](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m8/work-items/558-message-websocket/result.md)이다.

## 평가표에서 프론트엔드 근거를 찾는 법

점수나 전 항목 충족 여부를 추정하지 않는다. FE가 직접 설명할 수 있는 평가 관점만 연결한다.

| 평가 항목 | FE에서 보여 줄 근거 | 문서 |
|---|---|---|
| ① 문제·타겟·핵심 시나리오 | PM의 검토·수정과 팀원의 확인·답장을 회의 후 관리로 연결 | [테크스펙](techspec.md). |
| ② 완성도·안정성·사용성 | 오류 위치의 안내, 화면 이동 중 처리 추적, 모바일·키보드, 로딩·사전 조회 | [문제 사례](troubleshooting.md), [접근성·성능](a11y-performance.md). |
| ③ Agentic 경험·⑤ 워크플로우 | 자동 반영과 확인 필요 분기, 화자 지정 대기, 처리 실패·복구를 화면에서 이어 주는 역할 | [AI 결과 화면](ai-result-ui.md), [구조](structure.md). 판단·도구 실행 자체의 설계는 [AI 설계](../ai/index.md)와 [BE 설계](../backend/index.md)의 범위다. |
| ④ 서비스 개발 충실성 | 회의·승인·태스크 여러 보기·프로젝트 맵·메시지·팀 연결의 구현 근거 | [기능 구성](techspec.md), [마일스톤 기록](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/README.md). |
| ⑦ 가드레일·예외 대응 | 근거 중심 검토, 충돌 재확인, 비정상 응답 차단, 세션 변경, 되돌리기·재조회 | [대안과 결정](tradeoffs-decisions.md), [문제 사례](troubleshooting.md). |
| ⑧ 코드 품질·테스트 | FSD 의존 검사, 단위·화면 통합·브라우저 E2E, 실패 회귀 | [구조](structure.md), 이 페이지의 검증 경계. |
| ⑨ 배포·운영 | 실제 API·MSW 분리, 환경 변수, CI·번들·프록시 | [환경 변수](../../dev/env.md), [배포](../../dev/deploy.md). 현재 URL·배포 버전은 별도 확인한다. |
| ⑩ 문서화·협업 | README·대표 계약·결정 기록·이슈 결과·리뷰 기록의 연결 | [FE 문서 안내](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/README.md), [코드 리뷰 기록](../../collab/code-reviews.md). |

⑥ AI 품질 평가는 FE 테스트 통과 수로 대신하지 않는다. 모델·테스트셋·실패 분석의 근거는 [AI 설계 문서](../ai/index.md)에서 확인한다. FE는 전사 의심 사유와 근거를 사용자가 검토하도록 표시하는 역할을 설명한다.

## 데모에서 확인할 핵심 흐름

발표에서는 준비된 공간으로 시작하고 핵심 결과 흐름을 먼저 보여 주는 구성을 권한다. 아래는 기존 테스트에 대응하는 데모 제안이다. 실제 운영 시연 성공 기록은 아니다.

| 순서 | 화면에서 할 일 | 보여 줄 가치 | 대응하는 검사 |
|---|---|---|---|
| 1 | 회의 업로드 뒤 다른 화면으로 이동 | 업로드 전송과 서버 처리를 구분하고 진행 추적 유지 | [meeting-flow](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/e2e/meeting-flow.e2e.ts). |
| 2 | 필요 시 화자를 지정하고 회의록 열기 | 사람이 필요한 구간만 입력하고 처리 재개 | [meeting-speakers](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/e2e/meeting-speakers.e2e.ts). |
| 3 | 반영됨·확인 필요·보류와 근거 읽기 | 자동화 결과와 검토 대상을 구분 | [tasks-approval](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/e2e/tasks-approval.e2e.ts). |
| 4 | 빠진 담당자·마감 보완 후 승인 | PM이 본 값과 승인될 값을 일치시키기 | [tasks-approval](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/e2e/tasks-approval.e2e.ts). |
| 5 | 태스크·메시지에서 후속 흐름 확인 | 승인 후 업무 관리와 답장으로 연결 | [messages-approve](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/e2e/messages-approve.e2e.ts), [messages-reply](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/e2e/messages-reply.e2e.ts). |

보조 장면으로 409 충돌 재확인, 자동 반영 되돌리기, 390px·키보드 흐름을 고를 수 있다. 가입·온보딩 전체는 별도 질의나 녹화 자료로 분리하는 편이 핵심 시나리오를 설명하기 쉽다. 이는 발표 구성 제안이다.

MSW를 사용하면 모의 데이터·모의 외부 연동임을 밝힌다. 실서버를 사용하면 회의 처리·외부 반영·메시지 수신까지 사전 확인한다. PWA 설치와 푸시 워커 구현은 오프라인 업무 지원을 의미하지 않는다.

## 발표 직전 확인

아래 항목은 미완료 기능 목록이 아니라 최종 발표 버전에서 확인할 작업이다. 실행 결과를 얻기 전에는 완료 표시하지 않는다.

- [ ] 최종 커밋과 실제 배포 버전·접속 URL을 맞춘다. 로그인에서 핵심 시연을 끝까지 실행한다.
- [ ] 같은 커밋에서 `policy:check`, `typecheck`, `lint`, `format:check`, `test`, `build`, 일반 E2E와 동의 E2E 결과를 남긴다. 실행법은 [테스트 안내](../../dev/testing.md)를 따른다.
- [ ] 결과에 실행일·커밋·환경·통과·실패·skip을 함께 기록한다. 정적 파일 수와 실행된 테스트 수를 구분한다.
- [ ] 실서버 메시지 소켓의 변경 수신·재연결·로그아웃 종료를 확인한다. 기존 #558 기록만으로 완료 처리하지 않는다.
- [ ] 시연에 푸시를 쓰면 실제 데스크톱 또는 홈 화면 설치 iOS에서 수신·클릭 복귀·로그아웃 구독 처리를 확인한다.
- [ ] 현재 작업 중인 랜딩 수정의 배포 반영을 확인한다. 로컬 변경과 운영 반영을 구분한다.

## 과거 수치와 현재 상태를 구분한다

[테스트 안내](../../dev/testing.md)의 2026-11-07 무렵 수치는 역사 기록이다. [#594 결과](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/m3/work-items/594-stale-session-writes/result.md)의 전체 통과 수 역시 독립 리뷰 수정 후 전체 재실행 대기라는 단서를 함께 읽어야 한다. 두 기록 모두 최종 발표 버전의 최신 성공 수로 옮기지 않는다.

성능은 [측정 원문](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/performance/README.md)의 날짜·번들·브라우저·네트워크·반복 조건을 함께 제시한다. 스크린 리더, 운영 소켓, 실제 외부 공급사, 실기기 푸시의 미확인을 자동 테스트 성공으로 대신하지 않는다.

## 문서 자체의 검사

이번 문서화의 목차·로컬 링크와 시작 상태의 보호 문서·앱 소스 보존은 저장소 루트에서 검사한다.

```sh
python tools/check_frontend_docs.py
```

검사는 `.verify/frontend-docs/baseline.json`이 있는 작업 세션에서 보존 여부까지 확인한다. 다른 체크아웃에는 시작 기준이 없으므로 보존 검증 불가로 보고한다. 새 문서 작업 시작 전에만 `--baseline`으로 기준을 만든다. 이 스크립트는 앱의 기능·운영 성공을 검사하지 않는다.

앱을 동시에 수정 중이면 `--docs-only`로 링크·목차·보호 문서만 검사한다. 앱의 시작 해시가 달라졌다는 사실은 별도로 남기고 변경 주체를 해시 차이만으로 판단하지 않는다.
