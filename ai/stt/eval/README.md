# stt/eval: 전사 평가 도구

골든 회의 폴더에 회의를 넣고 명령 둘을 돌리면 같은 측정 행렬과 표가 다시 나온다.

```bash
# ai/ 안에서. 로컬 전사는 무과금, 캐시는 레포 밖에 둔다
.venv/bin/python -m stt.eval.sensitivity run --golden-root "<골든 폴더>" --out stt/eval/results/<날짜>-units --cache ~/.cache/mm-stt-eval
.venv/bin/python -m stt.eval.sensitivity report --out stt/eval/results/<날짜>-units --golden-root "<골든 폴더>"
```

`run` 은 이미 잰 (설정, 회의) 조합을 건너뛰므로 회의를 하나 추가하고 다시 돌리면 새 회의만 전사한다. 모델에 가는 조각은 내용 해시로 캐시해(`sttcache.py`) 같은 조각을 다시 계산하지 않는다. `report` 는 원자료 전체에서 표를 새로 만든다.

## 원자료는 레포 밖에 둔다

레포는 공개다. 실행별 원자료(설정마다 회의별 전사가 든 `runs/`, 추출 출력이 든 `extract/`)에는 회의 발언과 LLM 출력이 들어 있고, 파일이 수백 개라 PR 을 덮고, 재측정할 때마다 레포가 커진다. 그래서 레포 안 결과 폴더(`stt/eval/results/<이름>/`)에는 표(`tables/*.md`), 숫자와 영문 키만 든 요약(`summary.json`, `align_sweep.json`), 비용 장부(`ledger.jsonl`), README 만 둔다. `.gitignore` 가 결과 폴더 아래 `runs/`, `extract/`, `raw/` 를 막는다.

원자료 위치는 이 순서로 정한다(`rawdir.py`). `--raw-dir` 로 준 경로, 환경 변수 `MM_EVAL_RAW_DIR` 아래 `<결과 폴더 이름>`, 첫 `--golden-root` 의 부모 아래 `eval-runs/<결과 폴더 이름>`. 정한 경로가 원격이 있는 git 레포 안이거나 결과 폴더와 같은 레포 안이면 명령이 멈춘다. 골든셋을 담은 로컬 레포처럼 원격이 없는 레포는 허용한다. 전사 캐시(`--cache`)와 합성 회의(`scenarios build --out`), 정렬 변형(`align-sweep --out`)도 같은 검사를 거친다.

2026-09-26 측정의 원자료는 골든 폴더 옆 `eval-runs/2026-09-26-units/`(runs/ 파일 89개, extract/ 281개, 약 4.4MB)에 있다. 표만 다시 만들 때는 `report --out stt/eval/results/2026-09-26-units --golden-root <골든 폴더>` 를 돌린다. 원자료가 없는 곳에서는 아래 재측정 절차로 새로 만든다.

## 용어

- 민감도: 상수 하나를 기본값 주변에서 바꿨을 때 지표가 얼마나 움직이는지. 나머지 상수는 기본값에 둔다
- 잡음 폭: 설정을 안 바꿔도 생기는 흔들림. 로컬은 트랙에 들리지 않는 크기(16비트 1단계)의 잡음을 씨앗 여러 개(`--noise-seeds`, 2026-09-26 측정은 10개)로 넣은 실행의 오류 글자 범위, Elice 는 같은 설정을 세 번 보낸 범위다
- 평탄, 경사, 절벽: 모든 값이 잡음 폭 안이면 평탄(기본값을 방어할 수 있다), 기본값 바로 옆은 잡음 안인데 먼 값에서 움직이면 경사(비용과 맞바꾸는 선택), 기본값 바로 옆 값에서 잡음 폭을 넘거나 실행이 깨지면 절벽(위험). 어느 값에서도 모델 입력과 줄 구조가 같으면 "발동 안 함" 이라 그 데이터로는 판정하지 않는다
- 하네스: 운영 코드를 고치지 않고 상수를 바꿔 끼워 같은 행렬을 돌리는 이 도구 묶음
- CER 과 절대 오류 글자: 공백·부호를 뺀 글자 기준 편집 거리(바꿈+빠짐+더함)를 정답 글자 수로 나눈 것이 CER 이다. 정렬본 두 회의는 정답이 1,527자라 CER 0.5%p 가 약 8자다. 그래서 글자 수를 같이 적는다
- 문장 끝 보존: 정답의 마침표·물음표 자리가 전사에도 있는지. 추출이 같은 부호로 문장을 나눈다(`extract.text.split_sentences`)
- 턴 경계를 넘어간 글자: 정답 턴 단위로 센 오류에서 화자별 오류를 뺀 것. 묶음을 클립으로 되돌릴 때 단어가 다른 화자의 말을 건너 앞 줄로 붙으면 화자별 CER 은 못 보고 이것이 센다

## 골든 회의 폴더 형식

`--golden-root` 아래에서 화자 wav, `truth_by_speaker.json`, `truth_aligned.json` 이 있는 폴더를 전부 회의로 읽는다. `meta.json` 은 결과를 묶는 데 쓴다.

| 파일 | 내용 |
|---|---|
| `<화자>.wav` | 16kHz 모노. 모든 트랙이 같은 회의 시계 위에 있다(샘플 위치 = 회의 경과 시각, 말 안 한 곳은 0 또는 배경음) |
| `truth_by_speaker.json` | `{"화자": "그 화자가 말한 것 전부"}`. 파일 이름(확장자 뺀 것)이 화자 이름이다 |
| `truth_aligned.json` | `[{"seq", "speaker", "text", "start", "end"}]` 발화마다 초 단위 시각. 잃은 발화·순서·시작 오차를 이것으로 잰다 |
| `meta.json` | `kind`(real, synthetic-rearranged), `timeline`(합성이면 "합성" 이 들어간 설명), `known_issues` |

`meta.json` 이 결과를 묶는다. `timeline` 에 "합성" 이 있으면 "정렬본(시간축 합성)", `kind` 가 synthetic-rearranged 면 "재배치 합성", 둘 다 아닌 real 이면 "실녹음" 이다. 묶음끼리는 섞어 합치지 않는다. 재배치 합성 회의에 의도한 할일을 적은 `expected_tasks.json` 이 있으면 추출 비교가 담당자·마감 보존을 그 의도에 대고도 잰다.

회의를 더하는 길은 셋이다.

1. 봇 녹음(실녹음): `TrackWriter` 가 쓴 트랙은 이미 회의 시계 위에 있다. 파일 이름을 화자 이름으로 바꾸고, 들으면서 발화마다 시작·끝 초를 적어 `truth_aligned.json` 을 만든다. `meta.json` 의 kind 는 real, timeline 은 비운다
2. 트랙이 각자 0초에서 시작하는 옛 골든셋: `python -m stt.eval.golden align --golden <원본> --out <정렬본>` 이 대본 순서로 1초 간격을 두고 놓는다. 목소리는 진짜, 시간축은 합성이다. 정렬 뒤 `truth_aligned.json` 의 자리에 실제 그 말이 들어갔는지 확인한다(아래 알려진 문제)
3. 재배치 합성: `python -m stt.eval.scenarios build --golden-root <정렬본 폴더> --out <레포 밖> --cache <캐시>` 가 정렬본 조각을 다시 놓아 교대 직후·끼어들기·짧은 대답·긴 침묵·마감 분리·긴 독백을 만든다. 시나리오는 `scenarios.SPECS` 에 정답 글자열(앵커)로 적는다

wav 와 전사 캐시는 레포에 넣지 않는다. 회의 음성과 그 전사다.

## 재측정 절차

1. 회의 폴더를 넣는다. 합성 회의를 쓸 거면 `scenarios build` 로 다시 만든다
2. 로컬: `sensitivity run ... --plan all` (기본값, 잡음, 단위 모드, 상수 흔들기, 프롬프트). 시간이 모자라면 `--priority 1`(전사 단위 상수)부터, 다음 `--priority 2,3`(VAD, 말 필터)
3. 다른 로컬 모델: `--model small --plan base,units --no-prompt`. 로컬 모델은 한 번에 하나씩 돌린다(메모리)
4. Elice: `--backend elice --yes`. 백엔드에 따라 갈릴 수 있는 상수(`constants.py` 의 `elice=True`)만 흔든다. 누적 비용은 결과 폴더의 `ledger.jsonl` 에 쌓이고 `--budget`(기본 4,500원)에 닿기 전에 멈춘다
5. 추출: `python -m stt.eval.extract_diff run --golden-root ... --out <결과> --targets truth,local-large-v3-turbo/base,... --yes`. 정답 전사는 3번, 다른 전사는 1번 뽑는다. 출력은 원자료 폴더의 `extract/` 에 쌓인다
6. `sensitivity report --out <결과> --golden-root <골든 폴더>` 로 `tables/` 와 `summary.json` 을 다시 만든다. `tables/evidence.md` 가 상수 근거 표다
7. 원자료 폴더는 레포 밖에 그대로 둔다. 커밋하는 것은 결과 폴더의 표, 요약, 장부, README 다

## 상수를 더할 때

`constants.py` 의 `REGISTRY` 에 `Const(...)` 한 줄을 더한다. 경로, 근거 종류(여기서 측정, 다른 측정 결과 파일, 외부 사양, 설계 판단, 여기서 측정 불가), 무엇에 영향을 주나, 흔들 값(현재 값 포함), 주 지표, 다시 잴 조건을 적는다. 목록에 빠진 숫자 상수가 있으면 `tests/stt/test_constants.py` 가 깨진다.

수신 상수(재정렬 창, 패킷 공백 등)는 wav 로 잴 수 없어 근거 종류를 "여기서 측정 불가" 로 둔다. `tests/capture/replay.py` 의 패킷 재생은 유실·순서 뒤바뀜을 우리가 정한 값으로 흉내 내서, 그것으로 재면 넣은 가정을 되돌려 받을 뿐이다. 실서버 패킷 도착 기록이 있어야 잰다.

함수 기본 인자로 쓰이는 상수는 `binds` 에 (함수, 인자)를 적는다. 파이썬의 기본 인자는 함수를 정의할 때 한 번 평가되므로 `batch.TURN_GAP_S = 1.0` 만으로는 `build_chunks`·`group_turns`·`merge_turns` 가 바뀌지 않는다. `overrides()` 는 모듈 속성과 적힌 기본 인자를 같이 바꾸고 끝나면 되돌린다. 호출할 때 전역을 읽는 상수(`TAIL_PAD_S`, VAD 의 ms 상수)는 `binds` 가 필요 없다.

## 도구

| 파일 | 하는 일 |
|---|---|
| `golden.py` | 정렬본 만들기(align), 한 설정 채점(score, `session_metrics`) |
| `constants.py` | 상수 목록, 값 바꿔 끼우기 |
| `sensitivity.py`, `sensitivity_report.py` | 행렬 실행과 판정, 표 |
| `textmetrics.py` | 절대 오류, 문장 끝 보존, 클립 가장자리 오류, 환각 구절 |
| `sttcache.py` | 조각 해시 캐시, 호출별 지연 기록 |
| `scenarios.py` | 재배치 합성 회의 |
| `extract_diff.py` | 전사별 할일 추출 비교 |
| `matrix.py`, `rescore.py`, `fleurs.py`, `clip_cer.py` | 2026-09-16 방식 비교표, 저장된 전사 재채점, 공개 셋 모델 순위, 클립 단위 CER |

## 알려진 문제

- 정렬본 두 회의 모두 유재환 첫 발화 끝("저는 마지막에 정리하겠습니다. 그럼 시작할까요.")이 마지막 발화 자리(m01 121초, m02 129초 부근)에 들어가 있다. 유재환은 대본의 두 턴을 한 번에 읽었는데, 정렬본은 대본의 7발화판(`truth_utterances.json.orig`)으로 만들어 그 말을 두 자리로 나눠야 했다. `align` 은 이때 가장 긴 내부 쉼에서 나누고, 두 회의 모두 그 쉼이 "공유하고," 뒤였다. `RUN_GAP_S` 를 1~8초로 바꿔 다시 정렬해도 wav 가 같아서(2026-09-26 확인) 이 상수 탓이 아니다. 화자별 CER 은 시간순으로 이어 붙이므로 영향이 없다. 발화 단위 오류(`utt_err`)에는 회의마다 약 40자가 늘 더해지고(앞 자리에서 빠진 약 20자, 뒷 자리에 더해진 약 20자), 그 발화의 시작 시각·잃은 발화 판정과 추출 비교도 이 자리 기준으로 읽는다
- 지금 원본의 `truth_utterances.json` 은 유재환 두 턴을 한 발화로 합친 6발화판이다. 이것으로 `align` 을 다시 돌리면 기존 정렬본과 다른 정렬본이 나온다. 기존 정렬본은 7발화판과 지금 `align` 으로 바이트까지 같게 다시 만들어진다
