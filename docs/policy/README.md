# 서비스 정책 운영 안내

사용자가 2026-11-09 조사 내용을 반영해 사이트에 최종 정책을 적용하도록 요청했다. 공개 판본과 시행일은 두 문서 모두 `2026-11-10`이다. 교육·평가용 시범 운영 범위와 기존 보관·삭제·탈퇴 정책을 유지한다.

- [이용약관](terms.md)
- [개인정보처리방침](privacy.md)
- [게시와 검증 결과](../../frontend/docs/plan/m4/work-items/565-policy-publication/result.md)
- [잔여 운영 확인 #565](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/565)

## 본문과 판본 관리

사이트 본문의 원본은 [publishedPolicies.ts](../../frontend/src/shared/config/publishedPolicies.ts)다. 위 두 Markdown 문서는 같은 본문에서 생성한다. 공개 참고 자료는 사이트에서 실제로 열 수 있는 링크로 표시한다.

Node 24에서 다음 명령을 실행한다.

```sh
cd frontend
npm run policy:docs
npm run policy:check
```

`policy:docs`는 Markdown을 갱신한다. `policy:check`는 사이트 본문·Markdown과 [BE 동의 판본](../../backend/app/services/consents.py)의 일치를 검사한다. 프론트엔드 CI에도 이 검사를 추가했다. 본문을 바꿀 때는 FE·BE의 판본을 함께 올린다.

[게시 설정](../../frontend/src/shared/config/policyPublication.ts)은 실제 본문을 가진 `published` 상태로 전환한다. 이전 초안 판본 `2026-11-08`은 새 공개 판본의 동의로 재사용하지 않는다. 가입과 기존 사용자 재동의는 기본 두 문서를 확인하고 실제 동의 API에 저장한 후 진행한다. 마케팅 동의는 받지 않는다.

현재 API는 `terms`·`privacy` 두 문서의 기록을 저장한다. 별도 동의가 필요한 처리의 동의까지 받았다는 뜻은 아니다. 서버의 다른 모든 API를 동의 여부로 일괄 차단하거나 가입과 동의 저장을 한 트랜잭션으로 묶는 변경도 포함하지 않는다.

## 외부 업체 조사 내용과 적용 범위

공식 자료 확인일은 2026-11-09다. 자료가 없는 내용을 무보관·학습 미사용·특정 국가 처리로 확정하지 않는다.

| 항목 | 확인된 내용과 남은 범위 |
|---|---|
| Elice 국내 처리 안내 | [공식 ML API 활용 가이드](https://elice.io/ko/resources/blog/open-code-ml-api)는 소개한 구성의 국내 클라우드 처리를 설명한다. 우리 STT·LLM·요약·임베딩의 모든 엔드포인트·설정에 적용됨을 확인한 것은 아니다. |
| Elice 개인정보 원칙 | [일반 개인정보처리방침](https://legal.elice.io/kr/policy/privacy/2025-05-30)은 목적 달성·보유기간 만료 시 파기 원칙을 설명한다. API 음성·입력·응답·로그·캐시·백업의 정확한 보관 기간과 학습 이용 여부는 확인하지 못했다. |
| Elice 계약 | [2026-08-24 기본이용약관](https://legal.elice.io/kr/policy/terms/2026-08-24?locale=ko)은 개별 정책의 우선 적용 가능성을 둔다. Elice 계정 해지 시 삭제 조항을 우리 서비스 이용자 탈퇴 시 API 사본 삭제로 해석하지 않는다. 기존 [#578](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/578)에서 실제 이용 조건을 확인한다. |
| pyannoteAI | [#577의 EU 변경 보고](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/577#issuecomment-6738493396)와 [공식 보관 안내](https://docs.pyannote.ai/data-retention)·[DPA](https://www.pyannote.ai/terms-of-use)를 반영했다. EEA 내 처리와 개별 국가 확인은 구분하며 모든 데이터가 48시간 내 삭제된다고 안내하지 않는다. |
| 기타 연동·운영 | Notion·Discord·메일·푸시와 GPU 대체 경로의 실제 처리·보관 범위, 내부 잔여 기록·백업·보안, 문의 수신·담당자·책임자 표시 확인은 남아 있다. 공개 이메일은 `managersmanager.noreply@gmail.com`이다. |

공개 자료로 확인할 수 있는 내용은 해당 자료를 근거로 정리하고, 정보가 없거나 모호한 부분만 업체 확인 작업에 남긴다. 모든 업체의 별도 회신이나 외부 법률 검토 담당자 선정이 이번 게시 작업의 일률적인 선행 조건은 아니다. 이번 공개 승인을 업체 조건·별도 동의 요건·법률 적합성 확인 완료로 표시하지 않는다.

## 운영 기능과 공개 범위

동의 여부와 관계없이 두 정책 주소와 계정 탈퇴 경로는 열 수 있다. 개별 회의 삭제는 [별도 활성화 절차](../../deploy/README.md#회의-삭제-활성화-576)를 유지하며 이번 변경에서 켜지 않는다. 서비스 전체를 일반 공개 대상으로 넓히거나 기존 업무 데이터로 탈퇴·삭제를 시험하지 않는다.
