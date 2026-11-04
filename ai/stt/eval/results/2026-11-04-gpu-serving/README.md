# GPU 전사 서버 측정 (2026-11-04)

#313 의 결과다. AWS 서울 g4dn.xlarge(T4 16GB)에 vLLM 0.19.1 로 whisper-large-v3 를 올려 Elice 기준선(2026-10-06 night3)과 같은 시나리오를 돌렸다. large-v3-turbo 는 비교용이다. 비용과 판단은 [0039](../../../../docs/basis_for_decision/ai/2026-11-04-0039-gpu-stt-server.md) 에 있다. 전사 API 끼리의 비교는 #282 에서 다룬다.

## 결론

기본 모델의 정확도는 Elice 와 같았다. 6인 정렬본 CER 이 6.52%, 4.86% 로 일치했고 m01, m02 의 전사문 14줄도 글자까지 모두 같았다.

속도는 Elice 의 약 2.5배 걸렸다. 62.42분 합성 회의를 Elice 는 65.07초, T4 large-v3 는 159.8초에 전사했다. CPU 폴백(84.93분)보다는 약 32배 빠르다. turbo 는 68.9초로 Elice 와 비슷했고 CER 은 6.65%, 4.99% 였다.

회의를 동시에 넣어도 회의당 시간이 줄지 않았다. large-v3 는 회의가 늘어나는 만큼 끝나는 시간도 늘어 m01 10개에 58.47초 걸렸고, 처리량은 회의 길이 기준 실시간의 약 25배에서 멈췄다. 이때 호출 최대는 42.68초였고, stt/elice.py 의 제한 시간까지 가장 적게 남은 호출이 2.22초였다. 실패와 재시도는 0건이었다.

콜드 스타트는 디스크 설정이 갈랐다. AMI 로 띄운 기본 gp3 는 첫 응답까지 22.1분 걸렸고, EBS 볼륨 초기화 속도를 300MiB/s 로 지정하면 5.0분 걸렸다. 각각 한 번씩 잰 값이다. 5.0분에 large-v3 전사 2.7분을 더하면 62.42분 회의의 전사 완료까지 7.7분이다(계산값). 기본 gp3 는 24.7분이다. 장애를 알아채 켜는 시간, 운영 서버와 GPU 서버 사이 전송, 추출과 인계는 재지 않아서 7.7분은 초안 10분 기준의 전사 몫 하한이다.

## 측정 조건

| 항목 | 값 |
|---|---|
| 서버 | g4dn.xlarge, 서울, 4 vCPU, Tesla T4 15360MiB, 드라이버 595.112.07, gp3 75GB |
| 서빙 | vLLM 0.19.1, float16, `--gpu-memory-utilization 0.6`, 오디오 1개 제한 |
| 코드 | 커밋 910e241, 코드 변경 없음 |
| 호출 경로 | 측정 도구를 GPU 서버 안에서 실행해 `https://localhost:8000` 호출, 자체 서명 인증서, `--backend elice` |
| 프롬프트 | 없음(이름 힌트를 끈 Elice 기준선과 같음) |
| 측정 시각 | 2026-11-04 15:46 ~ 15:57(한국 시각), 콜드 스타트 17:11 ~ 18:05 |

`stt/elice.py` 가 보내는 모델 이름과 맞추려고 turbo 도 `--served-model-name openai/whisper-large-v3` 로 띄웠다. 그래서 원자료의 turbo 실행도 백엔드 이름이 `elice/whisper-large-v3` 로 찍힌다. 라벨은 폴더 이름(`run/large-v3`, `run/turbo`)을 따른다.

견줄 때 볼 차이가 둘 있다. Elice 기준선은 t3.medium 에서 네트워크를 거쳐 잰 값이고, GPU 값은 네트워크가 없는 대신 측정 도구가 전사 서버의 CPU 4개를 같이 쓴 값이다. 운영 서버에서 이 GPU 서버를 부를 때의 왕복 시간은 재지 않았다.

정렬본은 진짜 목소리지만 시간축이 일부만 정렬돼 있고 대본 낭독이라 자유 발화가 없다. 62.42분 회의는 정렬본을 이어 붙인 합성 데이터라 시간과 자원만 보고 정확도 근거로 쓰지 않는다. 9/29 실녹음은 한 사람이 대본을 읽은 녹음이다.

## 정확도

| 데이터 | Elice | T4 large-v3 | T4 turbo |
|---|---|---|---|
| 6인 m01 CER | 6.52% | 6.52% | 6.65% |
| 6인 m02 CER | 4.86% | 4.86% | 4.99% |
| 잃은 발화 m01, m02 | 0/7, 0/7 | 0/7, 0/7 | 0/7, 0/7 |
| Elice 전사문과 같은 줄(14줄 중) | | 14 | 3 |
| 9/29 실녹음 CER | 21.2% | 21.1% | 20.2% |
| 9/29 숫자·영문 없는 줄 CER | 17.6% | 17.6% | 20.0% |

large-v3 의 정렬본 결과가 Elice 와 글자까지 같으니, 모델과 vLLM 버전과 디코딩 기본값이 같다고 볼 수 있다(추정). Elice 쪽 설정은 직접 보지 못했다. 9/29 의 0.1pt 차이는 원인을 따로 찾지 않았다. 9/29 Elice 값은 #154 에서 잰 값이고 T4 두 값은 이번에 같은 채점 도구로 쟀다.

turbo 는 정렬본에서 0.13pt 높고 9/29 에서 0.9pt 낮다. 숫자·영문 없는 줄만 보면 2.4pt 높다. 데이터 3개로 어느 쪽이 낫다고 말할 수 없다.

## 속도

| 시나리오 | 회의 길이 | Elice | T4 large-v3 | T4 turbo |
|---|---|---|---|---|
| 2인 실녹음 3회 | 65.1초 | 1.60 ~ 1.72초 | 3.10 ~ 3.27초 | 1.47 ~ 1.79초 |
| 6인 m01 | 146.87초 | 2.80초 | 7.01초 | 2.87초 |
| 6인 m02 | 155.68초 | 2.80초 | 7.16초 | 2.96초 |
| 9/29 실녹음 | 493.4초 | 5.05초 | 11.51초 | 4.0초 |
| 62.42분 합성 | 3745.48초 | 65.07초 | 159.8초 | 68.9초 |
| 62.42분 합성 RTF(회의 길이) | | 0.017 | 0.043 | 0.018 |
| 62.42분 합성 호출 p50 / p95 | | p95 2.42초 | 5.04 / 6.41초 | 1.44 / 2.03초 |
| 회의 1시간당 전사(계산값) | | 62.5초 | 153.6초 | 66.2초 |

62.42분 합성의 호출은 168개, 보낸 오디오는 3402초다. 워커는 모두 6개다. 2인 실녹음만 3번 돌렸고 나머지 시나리오는 모델마다 한 번씩 돌렸다. 그래서 Elice 와 2.5배 차이는 믿어도 turbo 와 Elice 의 몇 % 차이는 근거가 되지 않는다.

## 동시 처리

m01 복사본을 동시에 넣은 값이다. 회의마다 워커 6개라 동시 호출은 최대 6 × N 개다.

| N | Elice 마지막 결과 | large-v3 마지막 결과 | large-v3 호출 p50 / p95 / 최대 | 20초 넘은 호출 | turbo 마지막 결과 | turbo 호출 p50 / p95 / 최대 |
|---|---|---|---|---|---|---|
| 2 | 4.34초 | 12.05초 | 7.96 / 9.15 / 9.18초 | 0/14 | 4.97초 | 1.92 / 2.79 / 2.80초 |
| 3 | 5.90초 | 17.57초 | 11.74 / 13.86 / 13.88초 | 0/21 | 7.62초 | 3.26 / 4.46 / 4.51초 |
| 5 | 9.58초 | 29.86초 | 18.79 / 22.68 / 23.21초 | 10/35 | 12.56초 | 5.94 / 7.82 / 8.07초 |
| 10 | 재지 않음 | 58.47초 | 27.82 / 41.56 / 42.68초 | 52/70 | 23.89초 | 10.74 / 14.25 / 14.60초 |

전체 시간이 N 에 거의 비례해 회의당 시간은 large-v3 약 5.9초, turbo 약 2.4 ~ 2.5초로 일정했다. 회의 하나의 동시 호출 수를 바꾼 값은 아래와 같다. 3개에서 6개로 늘려도 large-v3 의 전체 시간은 1초 줄고 호출 p95 는 1.5초 늘었다.

| m01 동시 호출 | Elice | large-v3 전체 / 호출 p95 | turbo 전체 / 호출 p95 |
|---|---|---|---|
| 1 | 7.26초 | 11.92 / 2.11초 | 4.26 / 0.56초 |
| 3 | 3.50초 | 8.00 / 3.90초 | 3.11 / 1.10초 |
| 6 | 2.80초 | 7.01 / 5.41초 | 2.87 / 1.51초 |

stt/elice.py 의 제한 시간은 30초 + 오디오 1초당 0.6초다. N=10 의 large-v3 는 24.14초 오디오 호출이 42.26초 걸려 2.22초를 남겼다. 이번에는 실패와 재시도가 없었지만 N 을 더 늘리면 시간 초과와 재시도가 시작된다고 본다(추정). N=10 위는 재지 않았다.

## GPU 자원

| 항목 | large-v3 | turbo |
|---|---|---|
| GPU 메모리 사용 | 10,313MiB | 10,029MiB |
| 바쁠 때 GPU 사용률 평균 | 98% | 87% |
| 전력 최대 | 132.8W | 123.6W |
| 온도 최대 | 49도 | 46도 |

메모리는 `--gpu-memory-utilization 0.6` 으로 미리 잡은 양이라 모델이 실제로 필요한 최소량이 아니다. large-v3 의 사용률이 98% 라 처리량 한계는 메모리가 아니라 T4 연산량이다.

## 콜드 스타트

인스턴스 생성 호출부터 첫 전사 응답까지 잰 값이다. AMI 에 vLLM 과 모델을 넣어 두어 설치와 내려받기는 없다. AMI 스냅샷은 73GB 다.

| 단계 | 기본 gp3 | 초기화 300MiB/s |
|---|---|---|
| 호출 ~ 부팅 스크립트 시작 | 55초 | 35초 |
| vLLM 시작 ~ /health 200 | 1259초 | 266초 |
| 그 가운데 모델 가중치 읽기 | 14분 22초 | 1분 27초 |
| 호출 ~ 첫 응답 | 1324초(22.1분) | 302초(5.0분) |
| 가중치를 다 읽은 뒤 프로세스 재시작 ~ 첫 응답 | 56초 | 54초 |

스냅샷으로 만든 새 볼륨은 블록을 처음 읽을 때 S3 에서 가져와 느리다. 그래서 같은 서버에서 프로세스만 다시 켜면 1분 안에 뜨고, 가중치 읽기도 2 ~ 3초로 줄었다. 볼륨 초기화 속도는 인스턴스를 만들 때 지정하고, 스냅샷 73GB 에 약 $0.30(GB 당 $0.0041, 300MiB/s 등급으로 추정) 붙는다. 같은 AMI 로 재기동을 처음 시도한 회차는 대기 스크립트가 15분에서 끊겨 버렸다(가중치 읽기 13분 27초). 각 설정의 표본은 한 번이다.

## 재현

서버 준비는 서울 g4dn.xlarge 의 NVIDIA 드라이버 포함 AMI 에서 한다. 마지막 `vllm serve` 는 앞에서 계속 돌므로 측정은 다른 터미널에서 한다.

```bash
mkdir -p /opt/m && cd /opt/m
uv venv --python 3.12 /opt/m/vllm-env
uv pip install --python /opt/m/vllm-env/bin/python 'vllm[audio]==0.19.1'
apt-get update && apt-get install -y ninja-build
git clone https://github.com/kakaotechcampus-4/ktc4-kyungpook-3.git repo && git -C repo checkout 910e241
uv venv --python 3.12 /opt/m/ai-env
uv pip install --python /opt/m/ai-env/bin/python faster-whisper==1.2.1 ctranslate2==4.8.2 'jiwer>=3' numpy soundfile requests openai python-dotenv boto3
openssl req -x509 -newkey rsa:2048 -nodes -days 3 -subj /CN=localhost \
  -addext subjectAltName=DNS:localhost,IP:127.0.0.1 -keyout key.pem -out cert.pem
openssl rand -hex 24 > api.key

HF_HOME=/opt/m/hf /opt/m/vllm-env/bin/vllm serve openai/whisper-large-v3 \
  --served-model-name openai/whisper-large-v3 --dtype float16 --host 127.0.0.1 --port 8000 \
  --api-key "$(cat api.key)" --ssl-keyfile key.pem --ssl-certfile cert.pem \
  --gpu-memory-utilization 0.6 --limit-mm-per-prompt '{"audio":1}'
```

측정은 `ai/` 에서 한다. turbo 는 위 서빙 명령의 첫 인자만 `openai/whisper-large-v3-turbo` 로 바꾼다. `$DATA` 는 녹음 폴더, `$RUN` 은 결과 폴더, `$OUT` 은 9/29 채점 결과 폴더이고 `$SCRIPT` 는 레포 밖의 9/29 대본이다.

```bash
export ELICE_API_KEY=$(cat /opt/m/api.key) ELICE_STT_BASE_URL=https://localhost:8000 REQUESTS_CA_BUNDLE=/opt/m/cert.pem
E="--backend elice --spend-file $RUN/spend.jsonl --cap-krw 1000000"; O="--out-dir $RUN --pids-file $RUN/pids"
PY=/opt/m/ai-env/bin/python; R="$PY -m stt.eval.capacity.runner"
$R seq --tracks-dir $DATA/two-person --label two --repeat 3 $E $O
$R golden --session $DATA/m01 --tag m01 --save-lines $E $O
$R golden --session $DATA/m02 --tag m02 --save-lines $E $O
for n in 2 3 5 10; do $R multi --tracks-dir $DATA/m01 --n $n $E $O; done
$R seq --tracks-dir $DATA/m01 --label m01-w1 --workers 1 $E $O
$R seq --tracks-dir $DATA/m01 --label m01-w3 --workers 3 $E $O
$R seq --tracks-dir $DATA/real929 --label real929 --save-lines $E $O
$PY -m stt.eval.capacity.synth --source $DATA/m01 --source $DATA/m02 --out $DATA/long-60 --minutes 60 --gap 5
$R seq --tracks-dir $DATA/long-60 --label long-60 $E $O
$PY -m stt.eval.capacity.real929 --lines large-v3=$RUN/lines-real929-1.json --script $SCRIPT --out $OUT
```

`--spend-file` 장부는 서버 안에서 쓰는 자리값이다. 실제 비용은 인스턴스 시간으로 계산한다. macOS 에서 만든 tar 를 풀면 `._*.wav` 가 섞여 시나리오가 바로 끝나므로 지운 뒤 돌린다. 콜드 스타트는 AMI 로 새 인스턴스를 만들고 부팅 스크립트에서 위 서빙 명령을 띄운 뒤 시각을 남겼다. 초기화 속도는 `--block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeInitializationRate=300,DeleteOnTermination=true}'` 로 지정했다.

원자료는 레포 밖 `mm/eval-runs/2026-11-04-gpu-serving/` 에 있다. 녹음은 측정 뒤 서버와 임시 저장소에서 지운 다음 AMI 를 만들었다. 지운 파일의 블록이 AMI 스냅샷에 남았을 수 있다. AMI 는 비공개이고 학습 후 측정이 끝나면 지운다.
