# 요구사항·리스크

기능·비기능 요구사항과 안정성 장치(가드레일, 예외 처리, 장애 대응, 보안), 알려진 한계를 정리한다.

## 기능 요구사항

| ID | 요구사항 | 구현 | 상태 |
|---|---|---|---|
| F1 | 회의 음성·웹 업로드·Discord 채팅에서 새 할 일과 기존 task 변경(마감·담당·상태·범위)을 뽑는다 | 입력 경로 3개 + judge 파이프라인 | 구현 |
| F2 | 모든 항목에 근거(원문 인용·화자·회의 내 시각)를 붙이고 회의록 원문으로 이동할 수 있다 | `evidence_seqs` → BE Evidence. 녹음 재생(Range)은 웹 업로드 회의의 화자 지정용(PM) | 구현 |
| F3 | 확실한 것만 자동 반영하고 애매한 것은 PM 이 확인한다 | 조건 게이트 auto / review / hold | 구현 |
| F4 | PM 이 값을 고쳐 승인·반려하고, auto 반영도 되돌린다 | `task_overrides`, auto 되돌리기 | 구현 |
| F5 | 승인된 태스크를 Notion 보드와 동기화한다 | outbox 워커 | 구현 |
| F6 | 마감 전 재촉 제안 → PM 승인 → DM → 답장 판단 → 반영, 72시간 무응답 막힘 | 리마인드 스케줄러, 답장 판단 | 구현 |
| F7 | PM / 팀원 권한, 팀원 초대 | 역할 pm/member | 구현 |
| F8 | 회의 요약·프로젝트 맵 | #560 | 구현(품질 검증 별도) |

## 비기능 요구사항

| 구분 | 요구사항 | 현재 값·장치 |
|---|---|---|
| 처리 시간 | 62분 회의 전사가 서버 한 대에서 감당돼야 함 | Elice 65초(동시 6호출), GPU 예비 159.8초 (2026-10-06, 11-04) |
| 정확도 | 잘못 자동 반영되는 항목을 낮게 | Jev 잘못된 certain 할 일 상한 6.5%, 마감 상한 11.8%(대사 단위, 2026-11-07). 상세 [지표](metrics.md) |
| 가용성 | 외부 STT 장애 때 복구 수단 | GPU 대기 서버 자동 전환(#581, 구현 완료·기본 꺼짐, 실제 Lambda·GPU 리허설 전). 수동 전환 경로는 2026-11-07 에 리허설했다 |
| 일관성 | 중복 카드·중복 태스크 없음 | 추출 등록 멱등, Notion "Task ID" 조회 후 생성 |
| 자원 | t3.medium(2 vCPU, 4GB) 한 대 | 워커 MemoryMax 3G, BE 프로세스 하나 |
| 접근성·모바일 | 360px 폭, 명도 대비 4.5:1 | FE E2E 로 검사(#478, #336) |
| 개인정보 | 회의 음성 보관 기한 | 회의 종료부터 7일 보관한 뒤 지운다. 처리 중인 회의는 지우지 않고 실패한 회의는 바로 지운다(#670). 녹음 공지에 외부 전송을 알린다(#568). 계정 탈퇴·익명화(#584) |

## 가드레일: auto 의 3중 관문

judge 새 항목이 사람 확인 없이 태스크가 되려면 세 관문을 모두 지나야 한다(게이트 전체 조건은 [에이전트 설계](agent-design.md#게이트-be)).

| 관문 | 막는 것 | 실패 때 | 근거 |
|---|---|---|---|
| ① 근거 검증 (Jev) | 근거 원문에 할 일·마감이 명시되지 않은 항목(조건부·질문·제안·근사 마감) | Jev 실패·키 없음 → inferred → auto 안 됨 | [근거 검증](../design/ai/evidence-check.md), 결정 [0031](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/docs/basis_for_decision/ai/2026-11-02-0031-evidence-status-by-source-check.md) |
| ② 전사 오인식 검사 | 근거는 충실하지만 전사가 틀려 제목이 틀린 항목("진도 정리" → "짐도 정리") | 검사 실패 → `asr_check_failed` 로 막음 | [전사 오인식 검사](../design/ai/asr-check.md), 결정 [0051](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/docs/basis_for_decision/ai/2026-11-07-0051-asr-suspect-gate.md) |
| ③ 자동 생성 스위치 `AUTO_CREATE_ENABLED` | 운영 초기 검증 기간에 끌 것을 권고한 자동 생성 전체(코드 기본은 켜짐) | 모르는 값(오타)은 꺼짐으로 봄 | BE `app/api/extractions.py` `auto_create_enabled`, #526 |

- 스위치를 끈 동안에도 검증은 돌고 "켰으면 auto 였을 항목"을 로그로 남겨 PM 결과와 맞춰 본다.
- 운영 값은 서버 환경 변수로 정한다. 예시 파일 기본값은 `true` 이고, 평가 기록은 처음 운영을 `false` 로 두기를 권했다.

자세히: [담당자 매칭과 게이트](../design/backend/gate-matching.md)

## 그 밖의 예외 처리

| 상황 | 처리 |
|---|---|
| 승인 충돌 | 수정 제안마다 AI 가 본 값(`target_snapshot`)을 기준값으로 저장. 승인 때 지금 값이 다르면 409 `APPROVAL_CONFLICT`(base·current·proposed). PM 이 `confirm_task_version` 으로 다시 승인, 그사이 또 바뀌면 다시 409 |
| 같은 카드 동시 처리 | 이미 처리됨 409 `APPROVAL_ALREADY_RESOLVED`, PM 이 카드를 연 뒤 카드 내용이 바뀌었으면(`payload_version` 불일치, 다른 회의 항목이 합쳐짐) 409 `APPROVAL_CHANGED` |
| 추측 이름 학습 방지 | 승인 때 별칭 학습은 추출 때 못 찾은 `thirdname`(이름 지목) 원문만. 2인칭·대명사·역할(추측한 이름), 1인칭이 주어로 쓰인 꼴("제가")은 저장하지 않음. 역할 지목은 이름이 찾아져도 auto 로 보내지 않음 |
| 오인식 용어 오염 방지 | 워크스페이스 용어 목록에는 두 사람 이상이 말한 명사와 PM 이 승인한 제목의 명사만 넣음 |
| finding 하나 실패 | 그 finding 만 `failures`, 나머지는 계속 처리 |
| 채팅 회의 | auto 를 review 로 낮춤(전사를 거치지 않고 맥락이 약함) |
| 잘못된 항목 | update 대상 없음·제목 빈 항목은 그 항목만 건너뜀 |

자세히: [승인과 충돌](../design/backend/approval-conflict.md)

## 장애 대응

| 장애 | 대응 | 근거 |
|---|---|---|
| Elice STT 장애 | 워커가 연속 실패를 감지해 GPU 대기 서버(g4dn.xlarge)를 Lambda 로 켜고, Elice 회복 확인 3번이면 복귀. 하루 6시간·누적 15시간 상한, 운영 채널 `/gpu on\|off\|status` 수동 조작. 기본은 꺼짐이고 자동 전환은 실제 Lambda·GPU 로 아직 리허설하지 않았다 | 결정 [0056](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/docs/basis_for_decision/ai/2026-11-08-0056-gpu-stt-auto-failover.md) |
| Notion API 실패 | outbox. 429·409·5xx 지수 백오프 최대 5회, 401 은 토큰 refresh 한 번. 결과를 모른 채 끝난 생성은 "Task ID" 속성으로 먼저 조회해 중복 방지 | [backend README](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/backend/README.md#notion-연동) |
| 멈춘 업로드·채팅 회의 | BE sweeper(300초): AI 가 가져가지 않은 업로드 24시간(`upload_unclaimed`), 진행 없음 3시간, 화자 지정 대기 7일, 채팅 `/end` 뒤 7시간 → failed | `backend/app/services/upload_sweeper.py` |
| 요청이 몰림 | BE 가 동시 처리 요청을 30개로 막고 DB 연결 풀을 20+20 으로 둔다. 기다리는 요청은 스레드도 연결도 잡지 않는다. 로컬 k6 에서 20 VU 4.0 → 48.0 req/s (2026-11-11, 노트북 Docker) | 결정 [0068](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/docs/basis_for_decision/ai/2026-11-11-0068-request-gate.md) |
| 워커 재시작·중단 | 매니페스트 단계 상태로 마지막 단계 다음부터 재개, 회의 단위 재시도 백오프, 포기 7일 안 `--retry` | [아키텍처](architecture.md#단계-상태와-재시작-매니페스트) |
| LLM 1단계 응답 깨짐 | 그 자리에서 1번 더 부름(#580) | [결정 기록](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/docs/basis_for_decision/ai/2026-11-09-extract-first-stage-retry.md) |
| 임베딩 실패 | 입력 오류 task 만 건너뜀, 그 밖은 지수 백오프(최대 5분). 임베딩 없는 task 가 있으면 auto 를 막음 | BE README |
| 배포 중 녹음 | 녹음 중이면 봇 재시작 건너뜀, 워커는 하던 회의를 마치고 종료 | [deploy/README.md](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/deploy/README.md) |

자세히: [Notion 동기화](../design/backend/notion-sync.md), [리마인드 스케줄러와 백그라운드 작업](../design/backend/reminder-scheduler.md)

## 보안

| 항목 | 내용 |
|---|---|
| 세션 | 쿠키 7일, DB 에는 sha256 해시만 저장. 만료 세션은 워커가 정리 |
| 로그인 제한 | 같은 이메일 15분 10회, 같은 공인 IP 15분 50회 실패 시 15분 429. 막힌 동안 해시 계산 없음, 이메일 존재 여부를 응답으로 구분하지 않음 |
| 서비스 토큰 | 봇·AI 경로 전부 `X-Service-Token`. 서버 토큰이 비면 모두 거절. 사용자 세션으로 대신 못 함 |
| 권한 | 승인·업로드·설정 쓰기는 PM 만. 마지막 PM 보호 |
| 비밀번호 재설정 | 30분 1회용 토큰(해시 저장), 계정당 60초 1회·1시간 5회, 같은 공인 IP 시간당 5회, 서비스 전체 시간당 10회 |
| 배포 | GitHub OIDC → SSM(장기 키 없음), API 는 `127.0.0.1` 에만 열고 Caddy 가 HTTPS |
| AI 비밀값 | `.env` 는 커밋하지 않고, 평가 원문은 레포 밖에 둔다 |

상세: [backend README 세션 토큰·로그인 제한](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/backend/README.md#로그인-제한).

자세히: [보안](../design/backend/security.md)

## 알려진 한계 (프로젝트 상세 §13 요약)

| 구분 | 한계 |
|---|---|
| 단일 서버 | t3.medium 한 대에 DB·API·봇·워커·FE. 확장·장애 격리 없음. 로그인 제한 저장이 프로세스 메모리라 `--workers 1` 전제 |
| 외부 의존 | STT·LLM·Jev·임베딩이 Elice MLAPI 에 몰림 |
| STT | 단어 시각이 없어 묶음 단위 회의록. 업체 비교에서 더 낮은 CER(Soniox 7.54%)이 있었으나 바꾸지 않음. 업로드 회의 겹친 발화 미처리 |
| LLM 비결정성 | 마감 판정이 기준 0.8 근처(0.75~0.86)에서 실행마다 갈림. 1인칭 오분류 약 1% |
| 근거 검증 | 제목의 일과 원문의 일이 조금 다른 경우, 한글 숫자 날짜("이십일")를 놓침. 평가 대사가 합성 |
| 오인식 검사 | 동사·흔한 명사 오류는 못 잡음. 측정 데이터가 교육 방송이라 IT 회의와 분포가 다름 |
| 승인 충돌 | 제목 띄어쓰기만 바뀌어도 충돌 |
| 운영 | DB 백업·downgrade 미연습(#359), systemd 유닛 변경은 수동, AWS 실습 환경 2026-11-20 종료 |

원문: [프로젝트 상세 설명 §13](../프로젝트%20상세%20설명.md#13-알려진-한계와-위험).
