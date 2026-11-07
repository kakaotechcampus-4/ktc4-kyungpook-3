# 새 메시지 화면을 MSW 모드에서만 보이는 선택

- 기록일: 2026-10-31
- 관련 마일스톤: M8-C 메시지(#245)

## 문제와 제약

- 메시지 API가 없다. 2026-10-30 사용자 답변으로 UI/UX만 만들고 데이터는 MSW(D-146)로 대신한다(계획 C-1).
- [D-171](../../../decision/frontend-decisions.md)은 「내비게이션의 `메시지` 항목과 `/messages` 라우트는 유지하고 들어가면 `준비 중` 안내만 표시한다」로 확정돼 있다.
- 실 API 모드에서 새 화면을 그리면 없는 API를 부르게 된다. 준비 중 문구에 기대는 기존 테스트 6개(라우트·가드·앱 셸·늦은 비동기·회의록 경합·처리 추적)도 있다.
- 실 API 모드(production 포함)에서 새 화면을 보일지는 계획 C-3에서 **열림**이다.

## 실제 검토한 선택지

계획 C-3이 「화면 노출 범위」의 임시 기본값을 「MSW 모드에서만 새 화면, 그 밖에는 준비 중 유지」로 정했고 구현은 이를 따랐다. 구현 중 다른 노출 방식을 따로 검토한 기록은 없다.

## 선택과 이유

[MessagesPage](../../../../src/pages/messages/ui/MessagesPage.tsx)는 `import.meta.env.DEV && config.mswEnabled`일 때만 새 화면을 그리고, 그 밖에는 기존 준비 중 안내를 그린다.

- D-171의 준비 중 안내를 실 API 모드와 production에서 그대로 지킨다. 메시지 요청도 나가지 않는다.
- 기존 모드 분기 선례인 [승인 처리 경로](../../../../src/features/approval-resolve/model/transport.ts)의 `import.meta.env.DEV && config.mswEnabled`와 같은 조건이다.
- `DEV`를 먼저 봐서 번들러가 이 분기를 지우게 했다. production 번들에 새 화면 코드와 픽스처가 남지 않는다.
- production과 Vitest 기본 모드의 동작이 바뀌지 않아 기존 테스트 6개를 고치지 않는다. MSW 모드 테스트는 테스트 파일 안에서만 `config.mswEnabled`를 바꾼다([messagesMsw.test.tsx](../../../../src/app/messagesMsw.test.tsx), 선례 [approvalsMsw.test.tsx](../../../../src/app/approvalsMsw.test.tsx)).

검증: 기존 라우트·가드·앱 셸 테스트가 수정 없이 통과했고, 새 build의 `dist/assets/*.js`에서 메시지 화면·픽스처·MSW 런타임 표식 17종이 0건, 준비 중 문구는 1건 남았다([M8-C 결과](../result-c.md) AC-01).

## 장단점과 감수한 제약

- 배포 화면에서는 메시지 화면을 볼 수 없다. 2026-11-20까지의 시연에서 보여야 하는지는 확인이 필요하다(계획 C-10).
- 새 화면은 개발 서버 + `VITE_ENABLE_MSW=true`에서만 확인할 수 있다.
- **D-171 개정 여부는 확인 필요다.** 이번 구현은 사용자 답변에 따라 엔티티·MSW 픽스처를 만들었으므로 D-171의 「계약도 엔티티도 MSW 픽스처도 만들지 않는다」와 다르다. 결정 기록 개정은 이 작업에서 하지 않았다.

## 영향 범위와 재검토 조건

- 실제 메시지 API가 생기면 모드 분기를 없애고 실 API 모드에서도 새 화면을 그린다. 그때 준비 중 문구에 기대는 테스트 6개를 함께 고친다(계획 C-8).
- 사용자가 production 노출을 정하면(시연 등) 다시 정한다.

## 근거와 관련 문서

- [M8 계획](../plan.md) C-1, C-3, C-8, C-10, [M8-C 결과](../result-c.md)
- [제품·기술 결정](../../../decision/frontend-decisions.md) D-146, D-171
