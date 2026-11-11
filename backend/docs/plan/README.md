# 백엔드 계획과 마일스톤

[전체 계획](backend-plan.md)의 M0~M7 번호·순서를 기준으로 폴더를 준비했다. 마일스톤별 plan.md 는 전체 계획의 해당 절(범위, 작업, 완료 기준)을 옮긴 것이다.

## 마일스톤 연결

현재 근거 열은 2026-11-09 develop `70534a85`의 코드·결과 문서를 연결한다. 아래는 새 실행 검증·배포 확인이 아니다.

| 번호 | 전체 계획의 범위 | 계획 | 현재 코드·결과 근거 |
|---|---|---|---|
| M0 | 서버·DB·실행·검증 기반 | [plan.md](m0/plan.md) | [결과](m0/result.md). CI·테스트 설정 |
| M1 | 인증·워크스페이스·온보딩·권한 | [plan.md](m1/plan.md) | [결과](m1/result.md). 이메일 증명 가입·카카오·계정 탈퇴 |
| M2 | 태스크·승인·변경 이력·동기화 | [plan.md](m2/plan.md) | [결과](m2/result.md). 승인 시 제목 확인과 후속 수정 기록 |
| M3 | 회의·전사·AI 결과 수신 | [plan.md](m3/plan.md) | [결과](m3/result.md). 근거·별칭·회의 삭제. 삭제 운영 활성화는 별도 |
| M4 | Google·Discord·Notion 실제 연결 | [plan.md](m4/plan.md) | [연동 API 코드](../../app/api/integrations.py), [현재 API 계약](../../../frontend/docs/contracts/frontend-api-contract.md). Discord·Notion 연결 코드 존재. 외부 운영 성공 판정 없음 |
| M5 | 웹 음성 업로드·비동기 처리 | [plan.md](m5/plan.md) | [BE 결과](m5/result.md), [AI 워커](../../../ai/capture/worker.py). 후속 구현 포함 |
| M6 | 프론트·AI 통합과 계약 확정 | [plan.md](m6/plan.md) | [결과](m6/result.md). 진행 보고·승인 합치기·메시지 읽지 않은 수. 각 합의·검증 범위는 대표 계약 참조 |
| M7 | 운영 배포·관찰·복구 | [plan.md](m7/plan.md) | [결과](m7/result.md), [배포 안내](../../../deploy/README.md). CI·복구 절차 존재. 현재 배포 성공은 별도 확인 |

M0·M1·M2·M3·M5·M6·M7에는 결과 기록이 있다. M4는 별도 result.md가 없어 코드·대표 계약으로 연결한다.

## 원문 보존과 경로 해석

전체 계획은 `backend-development-plan.md`에서 `backend-plan.md`로 이름만 바꿨고 내용은 그대로다. 원문 머리말의 "문서 경로" 표기는 이동 전 경로로 남아 있으며, 현재 위치는 이 폴더의 [backend-plan.md](backend-plan.md)다.
