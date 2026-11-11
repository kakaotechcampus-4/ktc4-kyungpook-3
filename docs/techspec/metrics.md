# 추가 지표

AI 품질과 운영 상태를 보는 값을 정리한다. 개발하며 잰 값은 날짜·조건과 함께 적고, 운영에서 쌓이는 값은 무엇을 어디서 어떻게 관측하는지 적는다. 측정 조건이 다른 수치끼리 직접 비교하지 않는다.

## 측정한 값

| 영역 | 지표 | 정의 | 값 (측정일·조건) | 측정 방법 |
|---|---|---|---|---|
| STT | 이름 자리 정확도 | 회의 중 팀원 이름이 맞게 전사된 비율 | 1/6 → 4/6 (2026-10-09, 이름 힌트), 1/4 → 3/4 (2026-10-13, 9/29 녹음, BE 팀원 이름 힌트) | 같음 |
| STT | 전사 처리 시간 | 회의 길이 대비 전사 시간 | 62.42분 회의: Elice 65.07초, 로컬 turbo 84.93분(RTF 1.36), GPU T4 159.8초 (2026-10-06, 11-04) | 워커 처리 기록 |
| 판단 | 잘못된 certain 비율 (할 일) | 정답이 "명시 아님"인 대사 중 certain 으로 나온 비율, 대사 단위 | 1/83 = 1.2%, Wilson 95% 상한 6.5% (2026-11-07, 합성 대사 217개×3회) | `judge.eval_evidence` |
| 판단 | 잘못된 certain 비율 (마감) | 같음 | 1/44 = 2.3%, 95% 상한 11.8% (같음) | 같음 |
| 판단 | 할 일 재현율 | 정답이 "명시"인 대사 중 certain 으로 나온 비율 | 98.5% (134개 중 132개) (같음) | 같음 |
| 판단 | 1단계 정확도 | 골든셋 문장 중 할 일 여부를 맞힌 비율 | 긴 문장 306~309/325, 짧은 문장 14/15~16 (2026-10-02, 3회) | `judge.eval_golden_set` |
| 판단 | 1인칭 오분류율 | 화자 본인 담당을 다른 유형으로 본 비율 | 누적 171건 중 2건(약 1%) (2026-11-07) | 같음 |
| 오인식 | 차단율 | 명사가 틀린 발화 중 막은 비율 | 47% (41~53%) (2026-11-08, AI Hub KconfSpeech 1,397발화, Jev 기준 0.8) | `judge.eval_asr_real` |
| 오인식 | 오차단율 | 명사가 맞는 발화 중 막은 비율 | 19% (17~21%) (같음) | 같음 |
| 답장 | 자동 반영 정밀도 | 자동 반영한 답장 중 맞은 비율 | 26/26 (2026-11-04, 합성 30건×2) | `judge.eval_reply` |
| 답장 | 잘못된 certain | 답장 상태 판정 오류 | 0/38 (같음) | 같음 |
| 처리 시간 | 업로드 → BE 인계 | 업로드부터 추출 등록까지 | 3분 57초 회의 4분 44초(1단계 실패 1회 포함, 2026-11-08 수동 업로드 테스트) | 워커 처리 기록. 운영 분포는 아래 회의 처리 시간 |
| 운영 | 동시 요청 처리량 | 동시 사용자 수별 초당 요청과 실패율 | 20 VU 4.0 → 48.0 req/s, 50 VU 104.4 req/s 서버 실패 0 (2026-11-11, 관문 30·풀 20+20, 노트북 Docker). 운영 서버 5 VU 11.8 req/s, p95 321ms | k6 (PR #703), 결정 0068 |
| 처리 시간 | 답장 판단 시간 | 답장 1건 판단 | 평균 9.4초 (2026-11-04) | `judge.eval_reply` |
| 처리 시간 | GPU 전환 복구 시간 | 꺼 둔 GPU 서버 첫 응답까지 | 161.8초 / 158.6초, 전사 포함 약 5.4분 (2026-11-05/06, 운영 서버) | 운영 채널 알림 |
| 비용 | STT 비용 | 회의 1시간당 | 162~338원, 호출마다 최소 1분 과금이면 438~1,030원 (2026-10-06, 계산값) | 계산 |
| 비용 | 답장 판단 비용 | 1건 | 약 17원 + Jev (2026-11-04) | `judge.eval_reply` |
| 비용 | GPU 장애 대응 비용 | 회의 하나 / 장애 한 번 상한 | 약 $0.17 / 3시간 $1.94, 누적 상한 $9.7 (계산값, 결정 0056) | Lambda 장부 |

## 운영에서 관측하는 값

운영에서 쌓이는 값은 Grafana Cloud 대시보드에서 본다. 운영 서버에 설치해 작동을 확인했다([모니터링 설치](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/deploy/monitoring/README.md), #675).

| 영역 | 지표 | 정의 | 관측 방법 |
|---|---|---|---|
| 오인식 | 검사 실패율 | `asr_check_failed` 비율 | `kpi.approval_fact.asr_flag='check_failed'` 비율([KPI 대시보드](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/deploy/monitoring/README.md), #675). 2026-11-07 이후 회의 추출의 review·hold 생성 카드만 센다 |
| 오인식 | 의심 유무별 PM 제목 수정 비율 | `asr_flag`(none·suspect·check_failed)별로 PM 이 제목을 고쳐 승인한 비율. 막힌 쪽이 뚜렷이 높으면 검사가 제 역할을 한다 | `kpi.approval_fact.asr_flag`·`title_edited` (#675) |
| 게이트 | 자동 반영률 | judge 새 항목 중 auto 비율 | `kpi.extraction_item_fact.gate` ([KPI 대시보드](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/deploy/monitoring/README.md), #675) |
| 게이트 | 탈락 사유 분포 | auto 를 막은 사유별 건수(`task_not_certain`, `asr_suspect` 등) | `auto_blockers` 결과. BE 로그에서 센다 |
| 게이트 | 켰으면 auto 였을 항목 | `AUTO_CREATE_ENABLED=false` 또는 채팅 회의에서 review 로 내린 auto 항목 수 | BE 로그 (`app/api/extractions.py`). BE 로그에서 센다 |
| 승인 | PM 승인·수정·반려 비율 | 승인 카드 처리 결과, 게이트·근거 상태·카테고리별 | `kpi.approval_fact.outcome` (#675). 수정 승인은 `task_overrides` 가 생긴 2026-11-04 이후 카드만 구분된다. 삭제된 회의의 승인 요청은 상태와 관계없이 소급해서 뺀다 |
| 승인 | auto 되돌리기 비율 | auto 로 만든 태스크 중 PM 이 되돌린 비율(기획안 KPI, 목표 5% 이하) | `kpi.extraction_item_fact.reverted` (#675). 하한값이다(아래 읽는 법) |
| 승인 | PM 응답 시간 | 승인 카드가 생기고 PM 이 처리하기까지, p50·p95 | `kpi.approval_fact.response_seconds` (#675) |
| 승인 | 409 충돌 빈도 | 수정 승인 중 `APPROVAL_CONFLICT` 비율 | API 의 409 응답 수로 센다 |
| 답장 | 72시간 무응답 막힘 수 | 자동 막힘 전환·PM 되돌림 건수 | TaskHistory(`change_source=scheduler`) |
| 처리 시간 | 회의 처리 시간 p50·p95, 10분 초과 건수 | 녹음 종료부터 추출 등록까지. 디스코드 회의는 마지막 발화가 끝난 시각(`started_at + duration_ms`, 단 `ended_at` 을 넘지 않게 자름), 업로드 회의는 업로드 시각을 녹음 종료로 본다. 디스코드 회의의 `ended_at` 은 워커가 처리를 시작한 시각이라 쓰지 않는다(큐 대기가 빠지기 때문). 업로드 회의의 화자 지정 대기는 빼고 채팅 회의는 제외 | `kpi.meeting_fact.processing_seconds - speaker_wait_seconds` (#675) |
| 운영 | 회의 실패율·실패 단계 | done·failed 회의 중 failed 비율과 `failed_stage` 별 건수. 다시 녹음해 회복한 회의는 따로 본다 | `kpi.meeting_fact.status`·`failed_stage`·`replaced` (#675) |
| 운영 | 회의 처리 중 서버 최대 메모리 | 회의 처리 구간의 서버 사용 메모리와 `mm-worker` 메모리 최대값 | Grafana Alloy 메모리 지표 + `kpi.meeting_fact` 처리 구간 주석 (#675) |

## 운영 관측 구성

| 무엇을 | 어떻게 재나 | 어디서 보나 |
|---|---|---|
| 서버 자원 | 서버의 수집기 Alloy 가 60초마다 CPU, 메모리와 스왑, 디스크, load, 네트워크 송수신을 읽어 보낸다 | Grafana Cloud Prometheus, 서버 대시보드 |
| 프로세스 | systemd 유닛 `mm-bot`, `mm-worker`, `mm-chat-poll` 의 상태와 재시작 횟수. `mm-worker`·`mm-bot` 서비스와 `api`·`db` 컨테이너의 CPU, 메모리, 네트워크, 시작 시각 | 같음 |
| API 가동 | Synthetic Monitoring 이 바깥에서 `GET /api/v1/health/ready` 를 1분 안팎 주기로 부른다. DB 까지 닿으면 200, 못 닿으면 503 이다 | Synthetic Monitoring |
| 서비스 KPI | 읽기 전용 계정 `kpi_reader` 가 `kpi` view 3개(`meeting_fact`, `extraction_item_fact`, `approval_fact`)만 조회한다. view 에는 사람 이름, 이메일, 회의 제목이 없다 | KPI 대시보드 |
| 회의 처리와 메모리 | 회의 처리 구간을 서버·워커 메모리 그래프 위에 주석으로 겹쳐 처리 중 최대 메모리를 본다 | KPI 대시보드(회의 처리 중 메모리) |

KPI 대시보드는 위쪽 숫자 칸 6개(고른 기간 전체 값: 되돌림 비율, 처리 시간 p95, 10분 넘은 회의, 실패율, PM 승인 비율, PM 응답 시간)와 아래 그래프·표로 본다. 날짜는 KST 주별로 묶는다(식을 바꾸면 일별). 처리 시간은 하루 넘게 잡힌 회의(시드·재처리)를 뺀다.

| 패널 | 읽는 view | 보는 값 |
|---|---|---|
| 자동 반영 되돌림 비율 | `extraction_item_fact` | 자동 반영으로 만든 태스크 중 PM 이 되돌린 비율. 기준선 5% |
| 처리 시간 | `meeting_fact` | 녹음 종료부터 추출 등록까지 p50, p95 와 10분을 넘긴 회의 수 |
| 실패율과 실패 단계 | `meeting_fact` | 끝난 회의 중 실패 비율, `failed_stage` 별 건수, 다시 시도해 회복했는지 |
| 게이트 분포 | `extraction_item_fact` | `auto`, `review`, `hold` 별 항목 수 |
| 승인·수정·반려 | `approval_fact` | 승인 카드 처리 결과별 건수 |
| PM 응답 시간 | `approval_fact` | 카드가 생기고 PM 이 처리하기까지 p50, p95 |
| 오인식 검사 비교 | `approval_fact` | `asr_flag` 별로 PM 이 제목을 고쳐 승인한 비율 |
| 주별 회의 수 | `meeting_fact` | 출처별 끝난 회의 수(다른 패널의 표본 크기) |
| 회의 처리 중 메모리 | `meeting_fact` + Prometheus | 서버·워커 메모리와 회의 처리 구간 주석 |

알림은 메일·Discord 로 보내지 않고 Grafana 화면에서만 본다. 알림 규칙은 API 응답 없음 하나이고, 나머지는 서버 대시보드의 숫자 칸·그래프가 같은 기준으로 색을 바꾼다(2026-11-11 설치, [결정 기록](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/backend/docs/plan/m7/basis-for-decision/2026-11-11-monitoring-install-changes.md)).

| 상황 | 기준 | 어디서 보나 |
|---|---|---|
| API 응답 없음 | 가동 확인이 5분 동안 5번 중 2번 실패 | Synthetic 체크 알림(Alerting 화면) |
| 디스크 | 루트 디스크 남은 공간 20% 미만이면 빨강 | 서버 대시보드 숫자 칸 |
| 메모리 | 사용 가능 메모리 500MB 미만이면 빨강 | 서버 대시보드 숫자 칸 |
| 봇·워커 비활성 | `mm-bot` 이나 `mm-worker` 가 active 가 아니면 빨강 | 서버 대시보드 숫자 칸 |
| 잦은 재시작 | 최근 1시간 재시작 횟수(0 이 정상) | 서버 대시보드 그래프 |

로그로 남기는 것은 다음과 같다.

- BE 는 자동 반영 스위치나 채팅 회의 규칙으로 확인 필요로 내린 항목을 항목 ID 와 함께 남긴다. 자동 반영을 막은 사유(`auto_blockers`)도 회의 ID 와 함께 남긴다.
- 처리 워커는 회의마다 전사, 발화 등록, 판단, 인계의 단계 상태를 매니페스트에 남겨 어느 단계에서 멈췄는지 본다.
- GPU 대기 서버의 전환과 복귀는 운영 채널 알림으로 남는다.
- 개인정보 정리 작업은 원문 토큰, 이름, 개인 Discord ID 를 운영 로그에 넣지 않는다.

## 기준값과 다시 볼 조건

| 기준값 | 현재 | 다시 볼 근거 |
|---|---|---|
| Jev certain 기준 | yes 확률 0.8 | 0.85 면 마감 잘못된 certain 0 이지만 맞는 마감의 57% 만 certain (2026-11-07) |
| 오인식 Jev 기준 `MM_ASR_YES_THRESHOLD` | 0.8 (잠정) | 운영의 PM 제목 수정 비율 |
| 오인식 기본 목록 `MM_ASR_SEED_NOUNS` | 1000 | 1단계 상한 N=1,000 62%, 10,000 34% |
| 유사 검색 threshold | 0.4 | 명확한 불일치 최고 0.33 ~ 명확한 매치 최저 0.42 (결정 0010) |

## 함께 볼 곳

- 평가 방법과 세트: [테스트 전략](test-strategy.md)
- 원자료: [프로젝트 상세 §8](../프로젝트%20상세%20설명.md#8-품질-측정과-검증-수치-모음), `ai/stt/eval/results/`, `ai/judge/eval_results/`
