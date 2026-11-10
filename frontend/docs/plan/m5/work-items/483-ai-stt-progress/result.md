# #483 AI 전사 트랙 진행 보고 결과

## 작업 근거와 요약

- 기록일: 2026-11-10.
- 작업 근거: [#483](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/483)의 AI A안과 사용자의 AI 파트 구현 요청.
- 이슈 단위 작업으로 기록한다. 기존 전체 계획과 마일스톤 완료조건은 변경하지 않는다.
- AI가 실제 입력 트랙 완료량을 기존 단계 API로 보고한다. FE 수치·경과 시간 표시와 이슈 전체 완료는 이번 구현 범위에 포함하지 않는다.

## 실제 구현 및 관련 코드

- [batch](../../../../../../ai/stt/batch.py)는 소유 스레드의 입력 index별 원장으로 일반·추가 클립·지연 묶음 처리까지 끝난 트랙을 센다. 기존 네 인자 콜백은 유지한다.
- [transcribe](../../../../../../ai/stt/transcribe.py)는 새 콜백을 전달하고 실패 줄 재시도에도 입력 WAV 분모를 유지한다. 콜백 종결 예외는 산출물 저장 전에 전파한다.
- [Handoff](../../../../../../ai/capture/handoff.py)는 선택 `stt` 본문을 전송하며 시작·최종 보고와 2초 중간 보고 간격을 소유한다. 일반 장애와 삭제 종결을 구분하고 기존 인증·privacy epoch·짧은 타임아웃을 유지한다.
- [recorder](../../../../../../ai/capture/recorder.py)는 Discord 알림 유무와 관계없이 정상·재시도 실행에 보고를 연결한다. 전사를 건너뛴 체크포인트에는 새 수치를 만들지 않는다.
- [대표 계약](../../../../../../backend/docs/contracts/backend-ai-contract.md)에 단위·재시도·전송 순서·삭제·시간 측정 범위를 반영했다.

## 요구사항 확인

| 이슈 요구 | 상태 | 근거 |
|---|---|---|
| AI 전사 진행을 BE에 보낸다 | 구현, 집중 테스트 통과 | 선택 본문·토큰·epoch·간격 및 recorder 알림 없는 경로 테스트 |
| 실제 완료한 트랙을 센다 | 집중 테스트 통과 | 추가 클립·지연 묶음·무음·필터·중복 화자·최종 실패와 재시도 테스트 |
| 일반 보고 실패가 전사를 막지 않는다 | 집중 테스트 통과 | stage 장애 회귀와 실패 시도 간격 테스트 |
| 삭제 신호가 후속 처리와 저장을 막는다 | 집중 테스트 통과 | 대기열 호출 취소·파일 저장 중단·claim 해제 후 purge 테스트 |
| 실제 AI와 BE HTTP 및 전체 회귀 | 통과, 환경 한계 있음 | 격리 HTTPS BE 네 여정 PASS+NOTES, Linux 전체 pytest 통과. 실제 업체 품질·운영 검증과 구분 |
| FE 수치·단계 경과 표시 | 범위 밖 | 별도 FE A안 작업 |

## 검증 내역

2026-11-10 WSL Ubuntu 24.04, Python 3.12와 저장소 AI 의존성 환경에서 아래 다섯 파일을 실행했다. 집중 테스트 **293개, 실패 0, 오류 0**, 종료 코드 0이다. STT는 제공자 인터페이스에서 대역을 사용하고 실제 유료 API는 호출하지 않았다.

```bash
python -m pytest tests/stt/test_batch.py tests/stt/test_transcribe_batch.py \
  tests/capture/test_handoff.py tests/capture/test_recorder.py \
  tests/capture/test_meeting_deletion_regression.py -q --junitxml=owner-final2.xml
```

실행 원본은 로컬 `.verify/issue-483-ai/owner-final2.{json,xml,log}`에 있다. 이어 최종 소스에서 `python -m pytest -q --junitxml=frozen-suite.xml`을 실행해 **2,982개 통과·26개 건너뜀·실패와 오류 0**, 종료 코드 0을 확인했다. 전체 테스트 수는 3,008개다. Windows에서는 Linux 전용 `resource`·`fcntl` 때문에 전체 테스트를 수집하지 못해 WSL에서 검증했다. 이 사유로 production 의존성을 바꾸지 않았다.

독립 검증기는 실제 production `process_session`·`Handoff`·`BeClient`와 격리 HTTPS BE를 연결해 아래 네 여정을 **PASS+NOTES**로 판정했다. 가입·동의·공간·회의는 공개 API로 준비했고 AI는 BE DB를 직접 읽지 않았다.

| 여정 | 별도 인증 GET 및 후속 결과 |
|---|---|
| 정상 | `0/3 → 1/3 → 2/3 → 3/3`, `stage_at` 유지, sources에서 수치 제거, 발화 3개 저장과 인계 후 `done` |
| 보고 전송 오류 | 수치 1/3 요청 하나를 requests 경계에서 실패시킨 뒤 2/3·3/3과 인계를 계속함 |
| 삭제 종결 | service `/fail` 후 PM DELETE의 실제 허용 경로에서 다음 보고가 410 `MEETING_DELETED`. 이후 AI의 sources·extractions·fail 요청 없음 |
| 실패 줄 재시도 | 첫 실행 partial 뒤 전체 WAV 분모 3을 유지해 `0/3` 초기화. 실패 줄 1개만 재시도하고 `done` |

기준 코드 `cb0e9004`에서는 같은 처리 경로가 인계까지 끝나도 STT 수치가 없어 검증이 예상대로 실패했다. 최종 구현에서는 실행 전후 production 해시가 같았고, 서버·scratch 정리 후 증거가 남았다. 원본 보고서는 로컬 `.verify/issue-483-ai/http-verifier/verdict.md`와 `readback.json`에 있다. DB는 SQLite `create_all`, STT·추출·메일 전송은 기존 외부 경계의 대역이다. PostgreSQL·실제 업체 응답 품질·Discord·Notion·운영 배포 성공을 이 결과로 주장하지 않는다.

Claude Opus 5.5의 독립 코드 리뷰에서 차단 결함은 없었다. 재시도 도중 삭제와 재시도의 중복 uid 조합은 recorder 수준의 추가 교차 테스트가 없는 제한으로 기록했다. 기존 단위 테스트와 정상·재시도 실제 HTTP 증거를 해당 교차 조합의 검증으로 확대하지 않는다. 새 주석 점검은 공개 콜백 계약 docstring 3개를 유지하고 삭제 권고 0건이었다.

로컬 AI 검증 스킬로 전사 저장·실패 줄 재처리·업로드 화자 지정도 실행했다. 스킬과 `.verify` 증거는 사용자 요청대로 커밋·푸시하지 않는다. 이 기록은 AI 범위의 구현·검증 결과이며 PR 병합·운영 배포 상태와는 구분한다.

## 배포 후속: 워커 시작 점검

PR [#653](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/653)은 `ba81fdd8`로 병합됐다. 그러나 [배포 42778162091](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/actions/runs/42778162091)은 전체 CI 통과 뒤 기존 요약 활성화 점검에서 실패했다. 이전 워커의 명령·planned 설정은 정상이었지만, 재시작 직후 새 프로세스의 명령 형태가 argc 1·비절대 경로로 관측돼 `worker-command-unsupported`로 끝났다. 운영의 원문 argv는 수집하지 않아 정확한 상태를 단정하지 않는다.

실제 Linux `/proc` 재현에서는 자기 소유의 살아 있는 동일 PID가 그 임시 형태에서 절대 Python의 `-u -m capture.worker`로 전환됐다. 기존 점검은 전환을 기다리지 않고 실패했다. 이 재현은 가능한 실패 메커니즘을 확인한 것이며, systemd 상태·설정 probe·journal과 워커 모듈은 명시적인 대역이다. [systemd 공식 문서](https://www.freedesktop.org/software/systemd/man/255/systemd.service.html)의 `Type=simple`도 실제 실행 전 시작 상태를 반환할 수 있으나, 운영 유닛의 실제 상태를 이 재현으로 확정하지 않는다.

[활성화 함수](../../../../../../deploy/enable-summary.py)의 새 실행 점검 순서를 준비 표식 확인 → 허용 명령·실제 설정 검사 → 최종 PID·시작시각 확인으로 바꾸고, 표식 대기 중의 probe 캐시를 제거했다. 기존 명령 allowlist, 재시작 전 점검, 실제 사용자·환경, 현재 실행의 정확한 표식, 최종 동일성, 30회 대기 상한은 유지한다. 서비스 Type·drop-in 내용·전사 처리 코드는 바꾸지 않았다. 표식을 내지 못하는 잘못된 설정은 구체 설정 오류보다 준비 표식 누락으로 실패할 수 있다.

| 검증 | 실제 결과 |
|---|---|
| 수정 전 새 회귀 5개 | 4개 실패·1개 통과. 정상 전환을 기다리지 않고 미지원 명령으로 종결하는 실패를 확인 |
| 수정 후 활성화 모듈 전체 | 56개 통과·실패와 오류 0, 종료 코드 0 |
| 실제 `/proc` 전환 재현 | 같은 PID가 정상 명령으로 전환될 때까지 한 번 대기하고, release 이후에만 새 프로세스의 실제 probe를 한 번 실행하여 성공 |
| 프로세스·scratch 정리 | 자기 소유 프로세스 종료·scratch 삭제·결과 보존 확인 |
| 전체 AI 회귀 | WSL Python 3.12, 2,987개 통과·26개 건너뜀·실패와 오류 0, 종료 코드 0 |
| 독립 실행 검증 | 실제 `/proc` 기준·수정 코드 비교와 안전 검사 56개 통과, PASS+NOTES. 실행 전후 production 해시 일치 |
| 후속 CI·운영 재배포 | 최종 확인 대기. 격리 증거를 실제 운영 활성화 성공으로 확대하지 않음 |

집중 테스트는 `ai/`에서 `python -m pytest tests/deploy/test_summary_activation.py -q --junitxml=owner-green.xml`로 실행했다. 로컬 원본은 `.verify/issue-483-deploy/owner-red.{json,xml,log}`, `owner-green.{json,xml,log}`, `proc-repro-owner-green/result.json`에 있다. 재현과 테스트는 실제 설정·키·공급사·운영 서비스를 사용하지 않았다. [배포 안내](../../../../../../deploy/README.md#자동-회의-요약-560)에 순서와 진단 제약을 반영했다.

## 계획 대비 변경과 제한

이슈 본문이 가정한 기존 트랙 완료 수는 현재 코드에 없었다. 읽은 트랙·동적으로 늘어나는 호출 수를 재사용하는 대신 실제 수거 경계를 추가했다. 긴 단일 트랙과 생략된 중간값의 표시 지연, HTTP 대기의 처리 시간 포함을 감수한다.

## 관련 기록

[완료 트랙 단위와 동기 보고 선택](../../../../../../ai/docs/basis_for_decision/ai/2026-11-10-0065-stt-completed-track-progress.md)에 실제 대안과 선택 이유를 기록했다.
