# 일정 · 히스토리 · 스펙 아웃

테크스펙 템플릿의 일정, 담당, 요청사항, 릴리즈, 스펙 아웃, 히스토리를 한 쪽에 모았다. 기획 때 세운 계획이 개발하면서 어떻게 바뀌었는지와, 하지 않기로 한 것을 적는다.

## 일정

기획 때 세운 계획이다(팀 노션 테크스펙 초안, 2026-09).

| 단계 | 기간 | 계획한 내용 |
|---|---|---|
| 기획과 사전 검증 | ~ 08-30 | 문제 정의, 경쟁 서비스 분석, 에이전트 흐름 설계, 기술 리스크 검증 |
| 스프린트 0 (인프라) | 08-31 ~ 09-04 | 녹음·매칭 인프라 검증, 골든셋 구축 |
| 스프린트 1 (핵심 파이프라인) | 09-07 ~ 09-18 | STT, 추출, Notion 반영 |
| 1차 배포 | 09-21 ~ 09-25 | 회의에서 Notion 까지 한 줄로 연결 |
| 스프린트 2 (자동화 확장) | 09-28 ~ 10-09 | 변경 감지, 리마인드 |
| 2차 배포 | 10-12 ~ 10-16 | DM 발송까지 |
| 스프린트 3 (고도화와 QA) | 10-19 ~ 11-06 | 되돌리기, 실패 설계, 통합, 버그 수정 |
| 릴리즈 준비 | 11-09 ~ 11-13 | 산출물과 발표 자료, 11-11 최종 제출 |

실제로 `main` 에 들어간 시점은 [브랜치 전략의 주간 PR 표](../collab/branch-strategy.md)에 있다. 첫 멘토 리뷰 PR(#17)이 09-14 에, 자동 배포 워크플로가 10-05 에 돌기 시작했다.

### 상세 마일스톤 (계획과 실제)

계획한 내용 옆에 그 기간에 실제로 머지된 것을 적었다. 날짜는 머지일이다.

| 단계 | 계획 | 실제로 한 것 |
|---|---|---|
| 스프린트 0 | 녹음·매칭 인프라 검증, 골든셋 | 09-08 STT 모델 크기 결정(0001). 09-09 공통 골격(#3), 화자별 녹음(#6), faster-whisper 전사(#12)가 처음 머지됐다 |
| 스프린트 1 | STT, 추출, Notion 반영 | 09-12 회의·추출 API(#19)와 AI·BE 계약 정리(#23). 09-16 배치 전사(#44), 할 일 추출과 골든셋 채점(#30), 워크스페이스·태스크 API(#38). 09-14 첫 `main` 머지(#17) |
| 1차 배포 | 회의에서 Notion 까지 한 줄로 연결 | 09-21 Terra 1단계(#49), 09-23 Terra 2단계(#70)와 Notion 연동 모듈(#61), 09-26 Notion outbox(#80). 자동 배포 워크플로는 10-05 에 돌기 시작했다 |
| 스프린트 2 | 변경 감지, 리마인드 | 판단 파이프라인 통합(8주차 `main` PR #128), 10-07 운영 전사를 Elice API 로(0019), 10-09 배포 전 CI 게이트. 리마인드는 스프린트 3 으로 밀렸다 |
| 2차 배포 | DM 발송까지 | 10-12 디스코드 서버와 워크스페이스 연결(0021), 10-13 회의록 순서 보정(0023)과 처리 워커 단일화(0026). DM 발송은 11-04 에 들어갔다 |
| 스프린트 3 | 되돌리기, 실패 설계, 통합, 버그 수정 | 11-01 업로드 화자 분리(0028), 11-02 근거 검증(0031), 11-04 리마인드·답장 판단(0034 ~ 0043)과 GPU 대기 서버(0039). 11-02 ~ 11-08 에 PR 149건이 머지됐다 |
| 릴리즈 준비 | 산출물과 발표 자료 | 11-09 ~ 11-11 에 PR 108건. 부하 테스트(#703)와 동시 요청 관문(#705), 모니터링(#684), 보안 점검, 녹음 7일 보관(#670), 제출 문서 |

## 담당

팀 역할과 파트별로 맡은 일은 [협업 문서의 팀 구성](../collab/index.md#팀-구성)에 있다. 파트 경계는 코드 경로(`ai/`, `backend/`, `frontend/`)이고, 파트 사이는 계약 문서와 요청 이슈로 잇는다.

## 히스토리: 처음 정한 것에서 달라진 것

| 처음 정한 것 | 지금 | 바꾼 이유 | 기록 |
|---|---|---|---|
| 항목마다 신뢰도 0.0 ~ 1.0 을 매겨 높으면 자동 게시 | 근거 상태(분명 / 추측 / 없음)와 조건 게이트. 조건을 모두 통과해야 자동 반영 | 모델이 스스로 매긴 점수는 거의 다 높게 나온다. 점수에는 중복 위험이 들어가지 않고 탈락 이유도 남지 않는다 | [트레이드오프 4](tradeoffs.md#4-판단-파이프라인) |
| 진행률 % 를 추적 | 상태(할 일 / 진행 중 / 막힘 / 완료)와 막힘 이유 | 멘토: 진행률은 실무에서 믿지 않는 숫자다. 상태 전환과 블로커가 PM 에게 쓸모 있다 | 0032, [코드 리뷰 기록](../collab/code-reviews.md#기술-멘토링에서-받은-방향) |
| 회의 중 실시간 전사 | 회의가 끝난 뒤 배치 전사 | 응답 시간이 2.62초에서 20.58초까지 흔들렸고 복잡도에 비해 얻는 것이 적었다 | 0003, 0008 |
| Notion 과 디스코드 채팅을 주기적으로 읽어 변경 감지 | Notion 은 한 방향 반영이고 원본은 서비스 DB 다. 채팅은 PM 이 고른 채널을 하루 한 번 읽는다 | 태스크 수정, 변경 이력, 승인 흐름을 서비스 안에 뒀다 | 0042, [Notion 동기화](../design/backend/notion-sync.md) |
| 리마인드 답장을 디스코드 DM 으로 받음 | DM 은 안내만 하고 답장은 웹에서 받는다 | DM 기록을 메우는 장치를 없앴다 | 0035, 0048 |
| 승인 전 내용도 회의 요약에 포함 | 승인이 끝난 회의만 요약 | 반려된 일이 정해진 일로 적혔다 | 0059, 0066 |
| 회의 음성은 인계 직후 삭제 | 회의 종료부터 7일 보관, 근거 시각부터 다시 듣기 | 근거 시각부터 원문을 다시 듣는 기능을 넣었다(#670) | 0055, 0066 |
| 서버의 CPU 로 전사 | Elice API 를 기본으로, GPU 대기 서버를 장애 대응으로 | t3.medium 에서 62분 회의에 85분이 걸렸다 | 0019, 0039 |
| 봇이 녹음과 처리를 모두 맡음 | 봇은 저장만, 처리 워커가 전사와 판단 | 처리 경로를 하나로 줄였다(코드 831 → 570줄) | 0026 |

기획 때 세운 수치 목표 둘은 운영 지표로 옮겼다. "회의 종료 뒤 10분 안에 초안"은 처리 시간 p95 로, "자동 반영 되돌림 5% 이하"는 되돌림 비율로 KPI view 에서 뽑는다. 두 값은 Grafana KPI 대시보드에서 주별로 본다([추가 지표](metrics.md)).

### 참고한 자료

기획과 개발에서 찾아보고 쓴 자료다. 어디에 썼는지와 그 판단이 남은 기록을 같이 적었다.

| 자료 | 어디에 썼나 | 기록 |
|---|---|---|
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [Whisper](https://github.com/openai/whisper) 모델 | 로컬 전사 구현, 모델 크기와 속도 비교 | 0001, 0008 |
| [Silero VAD](https://github.com/snakers4/silero-vad) | 전사 앞의 말 필터 | 0005, 0030 |
| [py-cord 문서](https://docs.pycord.dev) | 디스코드 화자별 음성 수신, 슬래시 명령 | #6, #46 |
| [Discord 개발자 문서](https://discord.com/developers/docs) | 봇 권한, DM, 서버 멤버 확인 | 0037, 보안 점검 |
| Elice ML API 문서 | 운영 전사(whisper-large-v3)와 판단 모델 호출, 응답 상한 | 0019, 0061 |
| [pyannoteAI](https://www.pyannote.ai) 화자 분리 API | 업로드 녹음의 화자 분리 | 0028, 0064 |
| [FLEURS](https://huggingface.co/datasets/google/fleurs) 한국어 | STT 공개 셋 비교 | #48 |
| [AI Hub](https://aihub.or.kr) 회의 음성 | 미세조정 학습, 전사 오인식 검사 측정 | 0052, 0051 |
| Soniox, OpenAI, 리턴제로 STT 문서 | STT 업체 비교 | [업체 비교](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/stt/eval/results/2026-10-14-stt-vendors/README.md) |
| [pgvector](https://github.com/pgvector/pgvector) | 비슷한 태스크 검색 | 0010 |
| [Notion API 문서](https://developers.notion.com) | 보드 반영, OAuth | [Notion 동기화](../design/backend/notion-sync.md) |
| [k6 문서](https://grafana.com/docs/k6/latest/) | 부하 테스트 | 0068 |
| [Grafana Alloy 문서](https://grafana.com/docs/alloy/latest/) | 운영 모니터링 | [모니터링 설치](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/deploy/monitoring/README.md) |
| [MSW](https://mswjs.io), [Zod](https://zod.dev) | 계약 먼저 개발, 응답 검증 | [계약 먼저, MSW 먼저](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/contract-first-msw.md) |
| 주간 멘토 리뷰와 기술 멘토링 | 설계 방향과 측정 과제 | [코드 리뷰 기록](../collab/code-reviews.md) |

## 스펙 아웃: 하지 않기로 한 것

| 하지 않은 것 | 이유 | 다시 볼 조건 | 기록 |
|---|---|---|---|
| LoRA 로 미세조정한 STT 모델 | 정렬본 하나는 좋아졌지만 다른 정렬본과 6인 회의에서 나빠졌다. Elice 에 올릴 수 없어 GPU 를 늘 켜야 한다 | 대본 없는 실제 회의 데이터가 모이면 | 0052 |
| STT 업체 교체 | 바꾸면 새 계정, 회의 음성의 외부 전송, 비용이 따른다. Elice 를 유지했다 | 운영 경로와 같은 조건으로 다시 잰 뒤 | [업체 비교](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/stt/eval/results/2026-10-14-stt-vendors/README.md) |
| 전사 전 노이즈 제거 | CER 차이가 8.56 → 8.42% 로 작았다 | 소음이 큰 환경의 녹음이 늘면 | 0007 |
| 겹친 발화 분리 | 분리하면 말을 잃는다 | 업로드 회의에서 겹침이 문제로 확인되면 | 0027 |
| 기존 할 일 수정의 자동 반영 | 판단이 틀리면 이미 있는 데이터가 망가진다 | 수정 제안의 PM 수정·반려 비율을 본 뒤 | [에이전트 설계](agent-design.md#게이트-be) |
| 채팅 회의의 자동 반영 | 판단 규칙과 평가 세트를 회의 대화로 맞췄다 | 실제 채팅 사례를 평가 세트에 넣은 뒤 | 0042 |
| GPU 서버 상시 운영 | 월 약 67만 원. 장애 때만 켜면 된다 | 월 전사량이 손익분기(오디오 1,863시간)에 가까워지면 | 0039 |
| BE 를 async 로 전환 | DB 접근 코드 전체를 바꿔야 한다. 동시 요청 관문으로 먼저 막았다 | 관문 앞 대기로 p95 가 1초를 넘는 부하가 오면 | 0068 |
| Notion 에서 고친 값을 서비스로 가져오기 | 원본을 하나로 둔다 | 팀이 Notion 에서 직접 고치는 일이 잦으면 | [Notion 동기화](../design/backend/notion-sync.md) |

## 요청사항: 파트 사이에 주고받은 것

다른 파트에 일을 부탁할 때는 이슈를 열고 제목 머리와 라벨로 방향을 적었다(2026-11-11 집계).

| 방향 | 건수 | 예 |
|---|---|---|
| FE 요청 (BE·AI → FE, FE → BE) | 제목 머리 `[FE 요청]` 14, `[BE→FE]` 10, `[AI→FE]` 6 | #211 추출 API 에서 수정 대상과 승인 상태를 구분해 달라는 요청 → BE 응답에 `approval_status` 추가 |
| AI → BE | 제목 머리 `[AI→BE]` 8, 라벨 `ai→be` 9 | #502 제3자 호칭 원문 전송과 1인칭 별칭 학습 위험 → #464 리뷰에서 반영 |
| BE → AI | `[BE→AI]` | #522, [bot-restart-lock.md](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/backend/docs/requests/bot-restart-lock.md) 배포와 녹음 시작 사이 잠금 |
| 계약 변경 | 라벨 `contract` 21, `합의됨` 4 | 합의가 끝나면 워크플로가 AI 후속 작업을 Discord 로 알린다 |

초기에는 팀 노션에 요청서를 썼다(예: "[AI] BE 요청사항", "[BE] STT 전사문 저장 API 명세", "[BE] 디스코드 연동 설정 요청"). 그 뒤 이슈와 계약 문서로 옮겼다. 계약의 정본은 [backend-ai-contract.md](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/backend/docs/contracts/backend-ai-contract.md)와 [frontend-api-contract.md](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/contracts/frontend-api-contract.md)다.

## 릴리즈

| 항목 | 내용 |
|---|---|
| 배포 방식 | `develop` 에 push 되면 같은 커밋으로 세 파트 CI 를 다시 돌리고, 모두 통과하면 서버에 올린다. 바뀐 파트만 재시작한다([아키텍처 설계](architecture.md#배포-구성)) |
| 배포 횟수 | 배포 워크플로 실행 307회, 성공 217회, 실패 12회(2026-10-05 ~ 11-11). 나머지는 취소되거나 건너뛴 실행이다 |
| `main` 반영 | 주 1회 멘토 리뷰를 거쳐 8번 머지했다([브랜치 전략](../collab/branch-strategy.md)) |
| 되돌리기 | 문제 커밋을 `develop` 에서 revert 하면 같은 경로로 다시 배포된다. 마이그레이션은 이전 코드와도 맞게 만든다([배포 문서](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/deploy/README.md)) |
| 운영 스위치 | 자동 반영(`AUTO_CREATE_ENABLED`), 회의 삭제(`MEETING_DELETION_ENABLED`), GPU 전환(`MM_GPU_FAILOVER`)을 환경 변수로 켜고 끈다. 배포만으로 동작이 바뀌지 않게 했다 |
