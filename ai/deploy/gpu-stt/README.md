# GPU 전사 서버 전환 절차

Elice 전사가 계속 실패하면 운영 워커가 평소 꺼 둔 GPU 대기 서버를 켜서 전사를 넘긴다. Elice 가 돌아오면 전사를 되돌리고 서버를 끈다. 워커는 다시 시작하지 않는다. 운영 서버에는 개인 AWS 키를 두지 않고, 대기 서버의 켜기, 끄기, 상태 조회만 하는 스위치(개인 AWS 의 Lambda 함수 URL)의 주소와 토큰만 둔다. 사람은 비공개 운영 채널의 `/gpu` 로 켜고 끈다.

서버는 g4dn.xlarge 의 vLLM, whisper-large-v3 이고 측정값은 [결과 문서](../../stt/eval/results/2026-11-04-gpu-serving/README.md), 판단은 [결정 0039](../../docs/basis_for_decision/ai/2026-11-04-0039-gpu-stt-server.md) 에 있다. 대기 서버는 `gpu-stt.sh`, 스위치는 `switch.sh` 가 만든다. 자동 전환의 값은 [`stt/failover.py`](../../stt/failover.py) 의 `Limits` 에 있다. 서비스 전체의 복구 절차는 [#359](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/359) 에서 다룬다.

## 어디까지 돌려 봤나

대기 서버의 `setup`, `on`, `off`, 자동 stop 과 운영 서버에서 GPU 서버를 부르는 데까지는 2026-11-06 에 실제로 돌렸다([측정](../../stt/eval/results/2026-11-05-gpu-fallback-prod/README.md)). 2026-11-07 에는 옛 수동 전환(drop-in 으로 워커의 Elice 주소를 덮고 재시작)으로 저장된 6인 회의 하나를 GPU 로 처리했다([리허설 기록](../../docs/basis_for_decision/ai/2026-11-07-gpu-stt-rehearsal.md)). 옛 수동 전환은 이름 프롬프트를 GPU 로 보내 구간을 비워서 지웠다.

자동 전환, `/gpu`, 스위치는 가짜 AWS 와 가짜 전사 서버로만 시험했다. 테스트는 `tests/stt/test_failover_step.py`, `tests/stt/test_failover_stt.py`, `tests/stt/test_gpu_switch.py`, `tests/capture/test_worker_gpu.py`, `tests/capture/test_discord_gpu.py`, `tests/deploy/test_switch_handler.py`, `tests/deploy/test_switch_script.py` 다.

실제 AWS 에서 `switch.sh setup` 을 돌리고 스위치를 부르는 것, 운영 리허설, 포기한 회의의 실제 재처리는 아직 안 했다. 처음 돌리는 날에는 단계가 그대로 통하지 않을 수 있다고 보고 시간을 잡는다. [들이는 순서](#들이는-순서)의 리허설을 마치기 전에는 `auto` 로 두지 않는다.

## 언제 넘기고 언제 돌아오나

`MM_GPU_FAILOVER` 가 동작을 고른다. 워커의 drop-in 에 둔다.

| 값 | 동작 |
|---|---|
| `off`, 비움 | 지금처럼 Elice 만 쓴다 |
| `manual` | 스스로 켜지 않고, 자동이었으면 켰을 때 운영 채널에 알린다. 켠 뒤의 넘기기, 되돌리기, 끄기는 `auto` 와 같다 |
| `auto` | 아래 기준대로 켜고 끈다 |

`MM_STT_BACKEND` 가 `elice` 가 아니면 이 값과 상관없이 꺼진다. `GPU_STT_BASE_URL`, `GPU_STT_API_KEY`, `GPU_SWITCH_URL`, `GPU_SWITCH_TOKEN` 중 빈 것이 있거나, 두 주소(`GPU_STT_BASE_URL`, `GPU_SWITCH_URL`)가 `https://` 로 시작하지 않거나, `GPU_STT_CA_BUNDLE` 파일이 없어도 꺼진다. `GPU_STT_BASE_URL` 이 `ELICE_STT_BASE_URL` 과 같을 때도 꺼진다. 꺼진 이유는 워커 로그에 설정 이름만 남는다.

### 켜는 기준

1. 실제 Elice 전사 호출이 서비스 오류나 인증 오류(401, 402, 403)로 연속 6번 실패하면 새 호출을 기다리게 한다. 특정 음성 때문에 나는 실패와 장애를 가르려는 단계다.
2. 기다리는 동안 레포의 고정 합성음(`stt/probe.wav`, 1.57초)을 프롬프트 없이 Elice 로 보내 60초 간격으로 확인한다. 글자가 돌아와야 성공이다. 3번 연속 실패하면 서버를 켠다. 첫 확인은 바로 하니 켜기까지 약 2분이다. 확인이나 실제 호출이 한 번이라도 성공하면 평소로 돌아간다.
3. 켠 뒤 같은 합성음을 GPU 서버로 보내 글자가 나오면 전사를 넘긴다. `/health` 의 200 이나 빈 응답은 준비로 보지 않는다. 켜기부터 운영 서버가 받은 첫 전사 응답까지 161.8초와 158.6초였다(2026-11-06). 부팅 뒤 420초 안에 준비되지 않으면 한 번 끄고 다시 켜고, 두 번째도 안 되면 끄고 멈춘다. 다시 켜기는 장애 하나에 한 번이라 넘긴 뒤 응답이 없어 다시 켠 것도 이 한 번으로 센다. 2시간 동안 켜지 못해도 멈춘다.
4. 넘기면 이번 장애 동안 전사 단계에서 포기한 회의의 서버를 깨워 GPU 로 다시 돌린다. 장애 전에 포기한 회의가 있는 서버는 깨우지 않는다. 깨우기는 그 서버의 포기한 회의를 모두 돌려서, 일부러 둔 옛 회의까지 BE 에 새 회의로 만들고 다시 과금한다. 그 서버는 운영 채널에 `--retry` 명령과 함께 알리고 사람이 판단해 돌린다. 업로드 회의는 깨우지 않는다.

기다림은 확인을 시작한 때부터(사람이 켜면 켠 때부터) 최대 30분이다. 기다리는 호출은 실패로 끝나지 않아 재시도와 포기 횟수가 늘지 않는다. 30분이 지나면 기다림을 풀어 지금의 재시도와 포기 규칙이 돈다. 켜는 중이었으면 켜기는 계속한다.

`manual` 에서는 2단계에서 켜지 않는다. 운영 채널에 @everyone 으로 알리고 기다림을 푼다. 그 뒤로는 Elice 가 한 번 성공할 때까지 다시 기다리게 하지 않는다. 사람이 `/gpu on` 으로 켜면 3단계부터 같다.

### 넘긴 동안

GPU 로 가는 전사에는 이름 힌트와 앞 줄 문맥 프롬프트를 싣지 않는다. GPU 서버에서는 프롬프트가 구간을 비웠다. 리허설 회의(1건, 372자)에서 GPU 에 이름 프롬프트를 넣으면 CER 이 19.89% 였고 15구간 중 2구간이 오류 없이 비었다. 프롬프트 없이는 6.72% 로 Elice 의 프롬프트 없는 값과 같았고 빈 구간이 없었다. 앞 줄을 프롬프트로 보내는 짧은 구간도 저장된 다른 회의 6건 중 2건에서 비었고, 프롬프트 없이는 내용이 나왔다. 근거는 [빈 전사 재현](../../docs/basis_for_decision/ai/2026-11-07-gpu-stt-rehearsal.md#빈-전사-재현)에 있다.

워커는 Elice 를 5분 간격, GPU 서버를 60초 간격으로 합성음으로 확인한다. GPU 확인이 실패하거나 실제 GPU 호출이 3번 연속 실패하면 전사를 기다리게 하고 다시 확인한다. 다시 확인해도 안 되면 끄고 다시 켠다. 이번 장애에서 이미 한 번 다시 켰으면 끄고 멈춘다.

### 끄는 기준

1. Elice 확인이 3번 연속 성공하면(5분 간격이라 약 15분) 전사를 Elice 로 되돌린다. 진행 중인 GPU 호출이 끝나면 서버를 끈다. 되돌린 뒤 실제 Elice 호출이 성공하면 평소로 돌아가고, 3번 실패하면 바로 다시 켠다.
2. GPU 호출이 10분 동안 없으면 끈다. 꺼지는 약 400초 동안 새 호출은 기다리고, 다 꺼졌을 때 기다리는 호출이 있으면 다시 켠다.
3. 서버는 켠 뒤 3시간에 스스로 꺼진다(`StopAt` 태그). 종료 5분 전에 최근 10분 안에 GPU 호출이 있었으면 끄고 다시 켠다. 꺼짐과 부팅 동안 전사는 기다린다. 호출이 없었으면 끈다.
4. 아래 상한에 닿으면 끈다.

### 상한

하루(KST) 켠 시간 6시간, 켜기 6번이다. 부팅 실패, 응답 없음, 3시간 종료로 끄고 다시 켜는 것도 켜기 한 번으로 센다. 닿으면 켜지 않고, 켜져 있으면 끈다. KST 날짜가 바뀌면 풀린다.

누적 15시간(900분)은 스위치의 장부가 센다. 닿으면 스위치가 켜기를 거절한다. 상한은 Lambda 환경 변수 `CAP_MIN` 이고 올리는 것은 개인 AWS 관리자가 할 일이다. Lambda 환경 변수를 바꾸는 호출은 변수 전체를 바꾸니 `SWITCH_TOKEN` 을 잃지 않게 한다. 토큰을 새로 만든 `switch.sh setup` 은 환경 변수를 `SWITCH_TOKEN` 하나로 다시 쓰니 `CAP_MIN` 도 지운다.

### 멈춘 상태

하루 상한, 누적 상한, 준비 표시(`Ready`) 없음, 부팅 두 번 실패, 2시간 켜기 실패 뒤에는 멈춘다(단계 `halted`). 멈춘 동안 전사는 Elice 로 가고 지금의 재시도와 포기 규칙이 돈다. 워커를 다시 시작해도 상태 파일(`recordings/.worker/gpu-failover.json`)에서 이어 간다. 하루 상한만 KST 날짜가 바뀌면 스스로 풀린다. 나머지는 원인을 고친 뒤 `/gpu on` 으로 켜야 풀린다.

## 알림

알림은 비공개 운영 채널(`MM_OPS_CHANNEL_ID`)에만 올린다. 회의 채널에는 새 글이 없다. 채널 ID 가 비면 알림은 워커 로그에만 남는다. 워커가 우편함에 쓰고 봇이 채널에 올리니, 봇이 그 채널을 볼 수 없으면 봇이 알림을 버린다.

사람이 판단할 알림에만 @everyone 을 붙인다. 비공개 채널이라 채널 멤버에게만 울린다. 붙는 알림은 이렇다.

- 켜기 시작. 자동과 수동 모두이고, `manual` 에서 자동이었으면 켰을 때도 붙는다.
- 켜기 실패. 준비 표시 없음, vCPU 한도나 AWS 용량 부족(5분마다 다시 켠다), 스위치 5분 무응답, 부팅 뒤 7분 안에 준비되지 않음, 2시간 켜기 실패다.
- 상한. 하루 상한, 누적 상한, 3시간 종료 때의 켜기 수 상한이다.

확인 시작, 넘김, 되돌림, 끔, 포기 회의 다시 돌리기에는 멘션이 없다. 장애 전에 포기한 회의가 있어 깨우지 않은 서버를 알리는 글에도 멘션이 없으니 넘긴 뒤에는 채널을 읽는다.

서버를 끈 알림에는 이번 사용 시간과 비용, 누적 시간과 비용, 오늘 켠 횟수가 붙는다. 아래는 가짜 시계와 스위치로 만든 예다.

```
🛑 GPU 서버를 껐습니다(일 없음). 이번 20분 $0.21(₩297), 누적 0.2/15시간 $0.14(₩196), 오늘 켠 횟수 1/6.
GPU 가동분만, 꺼지는 시간 포함, 고정비 제외
```

비용은 시간당 $0.647, 1달러 ₩1,400 으로 계산한다(결정 0039). "이번" 은 켠 시각부터 워커가 꺼짐을 본 때까지라 꺼지는 시간이 들어간다. "누적" 은 스위치 장부 값이라 끄기를 부른 시각까지만 센다. 그래서 둘은 맞지 않는다.

## 사람이 켜고 끄기

운영 채널에서 `/gpu on`, `/gpu off`, `/gpu status` 를 쓴다. 그 채널에서 친 명령만 받으니 채널에 들어온 사람이 곧 쓸 수 있는 사람이다. 사람이 바뀌면 채널 멤버만 바꾼다. 디스코드 서버 관리자 권한이 있는 사람은 비공개 채널도 본다. 다른 채널에서는 "운영 채널에서만 쓸 수 있습니다" 로 거절한다.

봇은 요청 파일(`recordings/.worker/gpu-request`)만 남긴다. 워커가 다음 확인 때(10초 주기) 처리하고 결과를 운영 채널에 올린다. 나중 요청이 앞 요청을 덮는다.

- `on` 은 꺼져 있으면 켜고 넘긴다. 켜는 중이거나 넘긴 뒤면 아무 일도 없다. 끄는 중이면 다 꺼진 뒤에 처리한다. 하루 상한에 닿았으면 거절한다.
- `off` 는 서버를 끄고 전사를 Elice 로 되돌린다. 24시간 동안 자동 켜기와 `manual` 의 알림도 멈춘다. 그동안에도 `/gpu on` 은 받는다.
- `status` 는 워커의 상태 파일을 읽어 단계, 서버 상태와 종료 예정 시각, 오늘 켠 횟수와 시간, 누적 시간과 비용을 답한다. 상태 파일은 전환을 켠 워커의 첫 tick(10초 안)에 생긴다. 그 전이나 전환이 꺼진 워커면 "GPU 전환 상태가 없습니다. 워커가 MM_GPU_FAILOVER 를 켜고 돈 적이 없습니다." 로 답한다.

운영 서버에서는 같은 일을 워커 유닛의 사용자로 한다. 사용자는 `systemctl show mm-worker -p User` 로 본다.

```bash
cd /opt/mm/ai && sudo -u <워커 사용자> .venv/bin/python -m capture.worker --gpu status
cd /opt/mm/ai && sudo -u <워커 사용자> .venv/bin/python -m capture.worker --gpu on
cd /opt/mm/ai && sudo -u <워커 사용자> .venv/bin/python -m capture.worker --gpu off
```

전환이 켜진 동안에는 Mac 의 `gpu-stt.sh on`, `off` 를 쓰지 않는다. 워커 모르게 켠 서버는 장부에 `StopAt` 까지로 잡혀 실제보다 많이 센다. 넘긴 동안 Mac 에서 끄면 워커는 GPU 응답이 없다고 보고 다시 켠다. `gpu-stt.sh` 는 `setup`, `destroy`, `status` 와 워커가 끄지 못할 때만 쓴다.

## 준비

한 번만 한다. 장애가 나기 전에 해 둔다. 1단계, 2단계와 4단계의 Mac 명령은 `secrets/gpu-stt/` 와 개인 AWS 자격 증명이 있어야 해서 개인 AWS 계정 주인(김동우)이 한다.

### 1. 대기 서버 만들기

Mac 에서 보안 그룹, 고정 IP, 인증서, API 키와 대기 서버를 만든다. 대기 서버는 첫 부팅에서 모델을 한 번 읽고 스스로 꺼진다. 709.6초 걸렸다. 다시 돌려도 있는 것은 그대로 둔다. 운영 서버 IP 가 바뀌었으면 새 IP 로 다시 돌린다.

```bash
ai/deploy/gpu-stt/gpu-stt.sh setup <운영 서버 공인 IP>
```

`setup` 이 끊겼으면 다시 돌린다. 첫 부팅이 돌고 있으면 이어서 기다린다. 이미 꺼졌으면 첫 부팅을 마쳤는지 알 수 없어 멈추니 `destroy` 뒤 `setup` 을 돌린다. 첫 부팅을 마친 서버에만 `Ready=1` 태그가 붙고, 스위치는 이 태그가 없는 서버를 켜지 않는다.

고정 IP 가 바뀌었거나 `secrets/gpu-stt/` 를 잃으면 `setup` 이 아무것도 쓰지 않고 멈춘다. `destroy` 뒤 `setup` 으로 서버를 새로 만들고 4단계의 설정 파일도 다시 쓴다.

### 2. 스위치 만들기

Mac 에서 관리자 권한 프로필로 돌린다. 프로필은 돌릴 때 고른다. 이 프로필의 키는 운영 서버로 옮기지 않는다.

```bash
AWS_PROFILE=<관리자 프로필> ai/deploy/gpu-stt/switch.sh setup
```

대기 서버가 있는 개인 AWS 계정에 Lambda 함수 `mm-gpu-switch`, 같은 이름의 역할과 정책, 예약 동시성 1, 함수 URL, 장부 파라미터 `/mm/gpu-stt/ledger` 를 만든다. `Role=stt-fallback` 대기 서버가 정확히 1대여야 돈다. 다시 돌려도 있는 것은 그대로 두고 정책과 예약 동시성만 다시 맞춘다. 토큰과 주소는 `secrets/gpu-stt/switch.token`, `secrets/gpu-stt/switch-url` 에만 쓰고 화면에 내지 않는다.

함수 역할은 `Role=stt-fallback` 태그가 붙은 인스턴스의 start, stop, `StopAt` 태그 쓰기와 인스턴스 조회, 장부 파라미터 읽기와 쓰기, 로그 그룹 `/aws/lambda/mm-gpu-switch` 쓰기만 할 수 있다. 함수 URL 은 누구나 부를 수 있고 토큰은 함수가 확인한다. 장부는 대기 서버를 `destroy` 뒤 다시 만들어도 남는다.

새 계정은 계정 전체 Lambda 동시 실행 한도가 10일 수 있다. 그러면 예약 동시성을 걸 수 없어 `setup` 이 URL 을 만들기 전에 멈춘다. Service Quotas 에서 한도를 올린 뒤 다시 돌린다.

`switch/handler.py` 를 고친 뒤에는 코드만 올린다.

```bash
AWS_PROFILE=<관리자 프로필> ai/deploy/gpu-stt/switch.sh update
```

### 3. 운영 채널 만들기

봇이 들어가 있는 디스코드 서버에 비공개 채널을 만든다. `DISCORD_GUILD_ID` 가 있으면 슬래시 명령이 그 서버에만 등록되니 그 서버에 만든다. 카테캠 멤버 6명(장원준, 김환, 최진호, 윤지민, 유재환, 김동우)과 봇을 넣는다. 봇에는 채널 보기, 메시지 보내기, @everyone 멘션 권한을 준다. 멘션 권한이 없으면 글은 올라가도 울리지 않는다. 채널 ID 를 적어 둔다.

### 4. 운영 서버에 설정 두기

운영 서버의 `.env` 수정과 재시작은 그때마다 담당자의 확인을 받는다.

운영 서버의 전사 백엔드가 `elice` 인지 본다. `grep -c` 는 1 이 나오고 `systemctl cat` 줄은 아무것도 나오지 않아야 한다. 유닛에 값이 있으면 그 값이 `.env` 를 이긴다.

```bash
sudo grep -c '^MM_STT_BACKEND=elice' /opt/mm/ai/.env
systemctl cat mm-worker | grep MM_STT_BACKEND
```

Mac 에서 인증서와 GPU 설정 파일을 운영 서버로 옮긴다. 키가 화면에 나오지 않도록 표준 입력으로 보낸다. 운영 서버 접속 방법은 그때의 것을 쓴다. 이 명령은 `/etc/mm/gpu-stt.env` 를 통째로 다시 쓴다.

```bash
cd ~/Desktop/kakaotech4/secrets/gpu-stt
. ./env
prod() { ssh <운영 서버> "$@"; }
prod "sudo sh -c 'mkdir -p /etc/mm; umask 022; cat > /etc/mm/gpu-stt-ca.pem'" < cert.pem
printf 'GPU_STT_BASE_URL=https://%s:8000\nGPU_STT_API_KEY=%s\nGPU_STT_CA_BUNDLE=/etc/mm/gpu-stt-ca.pem\nGPU_SWITCH_URL=%s\nGPU_SWITCH_TOKEN=%s\n' \
  "$EIP" "$(cat api.key)" "$(cat switch-url)" "$(cat switch.token)" \
  | prod "sudo sh -c 'umask 077; cat > /etc/mm/gpu-stt.env'"
```

인증서 파일은 워커 프로세스가 직접 여니 모두 읽을 수 있어야 한다. `gpu-stt.env` 는 systemd 가 root 로 읽으니 root 만 읽으면 된다. 인증서와 키는 대기 서버 디스크에도 있다.

운영 서버에서 옛 수동 전환이 남긴 줄이 없는지 센다. 이름이 맞는 줄의 개수만 나온다. `^ELICE_` 는 0, `^GPU_` 는 5 여야 한다.

```bash
sudo grep -c '^ELICE_' /etc/mm/gpu-stt.env
sudo grep -cE '^GPU_(STT_BASE_URL|STT_API_KEY|STT_CA_BUNDLE|SWITCH_URL|SWITCH_TOKEN)=' /etc/mm/gpu-stt.env
```

`^ELICE_` 가 0 이 아니면 drop-in 을 두지 않고 위 명령으로 파일을 다시 쓴다. 옛 수동 전환은 이 파일에 `ELICE_STT_BASE_URL`, `ELICE_API_KEY`, `ELICE_STT_CA_BUNDLE` 을 GPU 서버 값으로 썼다. 새 drop-in 도 이 파일을 싣고, systemd 가 넣은 값은 `.env` 를 이긴다. 그 줄이 남아 있으면 워커가 평소 전사도 꺼져 있는 GPU 서버로 보내 모든 회의가 실패한다. 주소가 `GPU_STT_BASE_URL` 과 같아 자동 전환도 꺼진다.

운영 채널 ID 를 운영 서버의 `.env` 에 더한다. 봇(`/gpu` 권한)과 워커(알림)가 둘 다 `.env` 에서 이 값을 읽는다. drop-in 은 워커에만 실리니 `gpu-stt.env` 에 두면 봇이 보지 못해 `/gpu` 를 모두에게 거절한다. 먼저 이미 있는지 센다.

```bash
sudo grep -c '^MM_OPS_CHANNEL_ID=' /opt/mm/ai/.env
```

0 일 때만 더한다. 1 이면 더하지 않는다. 같은 이름이 둘이면 `load_env` 가 앞의 값을 쓴다.

```bash
printf '\nMM_OPS_CHANNEL_ID=%s\n' '<운영 채널 ID>' | sudo tee -a /opt/mm/ai/.env >/dev/null
```

봇과 워커는 시작할 때 `.env` 를 읽으니 둘 다 다시 시작해야 이 값이 들어간다. 다시 시작은 [들이는 순서](#들이는-순서)에서 한다.

운영 서버에서 스위치를 불러 본다. 상태만 묻고 아무것도 바꾸지 않는다. `{"state": "off", ...}` 와 200 이 오면 주소와 토큰이 맞다. 401 이면 토큰이, 연결 실패면 주소가 맞지 않는다.

```bash
sudo sh -c '. /etc/mm/gpu-stt.env; printf "Authorization: Bearer %s\n" "$GPU_SWITCH_TOKEN" | curl -s -w "\n%{http_code}\n" -H @- -H "content-type: application/json" -d "{\"action\":\"status\"}" "$GPU_SWITCH_URL"'
```

## 들이는 순서

순서를 바꾸지 않는다. `manual` 로 배포하고, 저장된 회의로 리허설한 뒤, `auto` 로 바꾼다.

### 1. 코드 배포

GPU 전환 코드가 develop 에 들어가면 배포가 `mm-worker` 를 다시 시작하고, 녹음 중이 아니면 `mm-bot` 도 다시 시작한다. 이때는 `MM_GPU_FAILOVER` 가 없으니 워커는 지금처럼 Elice 만 쓴다. `/gpu` 는 봇이 다시 뜬 뒤에 생긴다. `DISCORD_GUILD_ID` 가 비어 있으면 등록까지 최대 1시간 걸린다.

`MM_OPS_CHANNEL_ID` 를 배포 뒤에 더했으면 봇을 다시 시작한다. 녹음 중에 다시 시작하면 그 녹음이 끊긴다. 먼저 녹음 중인 회의를 찾는다. 배포 스크립트([`ec2-deploy.sh`](../../../deploy/ec2-deploy.sh) 의 `recording_now`)와 같은 확인이다.

```bash
cd /opt/mm/ai/recordings && for m in session_*.json; do grep -qE '"status": *"recording"' "$m" 2>/dev/null && ! flock -n "${m%.json}.lock" true && echo "녹음 중: $m"; done
```

아무것도 나오지 않을 때만 바로 이어서 다시 시작한다. `녹음 중` 이 나오면 녹음이 끝난 뒤 다시 확인한다.

```bash
sudo systemctl restart mm-bot
```

### 2. manual 로 켜기

[준비](#준비) 4단계의 개수 확인이 0 과 5 인지 다시 본다. 그다음 drop-in 을 두고 워커를 다시 시작한다. drop-in 은 `.env` 를 고치지 않는다.

```bash
sudo install -D -m 0644 /opt/mm/ai/deploy/gpu-stt/mm-worker-gpu.conf.example \
  /etc/systemd/system/mm-worker.service.d/gpu-stt.conf
sudo systemctl daemon-reload
sudo systemctl restart mm-worker
```

SIGTERM 을 받은 워커는 하던 회의를 마치고 끝나므로 재시작은 `TimeoutStopSec=1200` 인 20분까지 걸릴 수 있다.

다시 뜬 워커를 본다. `EnvironmentFiles` 에 `/etc/mm/gpu-stt.env` 가 있어야 하고, heartbeat 는 `"failover": "manual:normal"` 이어야 한다. `journalctl` 줄은 아무것도 나오지 않아야 한다. 나오면 그 줄이 전환을 끈 설정 이름을 알려 준다.

```bash
systemctl show mm-worker -p EnvironmentFiles
sudo grep '"failover"' /opt/mm/ai/recordings/.worker/heartbeat.json
sudo journalctl -u mm-worker -n 200 --no-pager | grep 'GPU 전환을 끈다'
```

운영 채널에서 `/gpu status` 가 답하는지 본다.

### 3. 저장된 회의로 리허설

1. 운영 채널에서 `/gpu on` 을 친다. "수동 요청으로 GPU 서버를 켭니다" 가 @everyone 과 함께 오고, 약 3분 뒤 "GPU 서버로 전사를 넘겼습니다" 가 와야 한다.
2. 넘김 알림이 오면 바로 저장된 회의 하나를 복제해 넣는다. Elice 가 살아 있으니 서버는 GPU 호출이 10분 없을 때나 약 15분 뒤 Elice 확인 3번 성공 때 스스로 꺼진다. 옛 수동 전환 리허설에서 2분 13초 회의는 복제부터 `handed_off` 까지 73초였다.
3. 회의가 `handed_off` 까지 가는지, 전사에 빈 구간이 없는지 본다.
4. "GPU 서버를 껐습니다" 와 비용 줄이 오는지, Mac 의 `gpu-stt.sh status` 가 `stopped` 인지 본다.

리허설을 `/gpu off` 로 끝내지 않는다. 24시간 동안 자동 켜기와 `manual` 의 알림이 멈추고, 그 멈춤은 `auto` 로 바꾼 뒤에도 남는다. 문제가 생겼을 때만 `/gpu off` 로 끈다.

넘김 알림이 오지 않으면 운영 서버에서 GPU 서버를 직접 부른다. 200 이면 키와 주소가 맞다. 401 이면 키가, 000 이면 인증서나 주소가 맞지 않는다.

```bash
sudo sh -c '. /etc/mm/gpu-stt.env; printf "Authorization: Bearer %s\n" "$GPU_STT_API_KEY" | curl -s -o /dev/null -w "%{http_code}\n" -H @- --cacert "$GPU_STT_CA_BUNDLE" "$GPU_STT_BASE_URL/v1/models"'
```

저장된 회의를 복제한 리허설은 실제 회의처럼 처리된다. BE 에 새 회의가 생기고, 추출 결과가 자동으로 태스크가 되면 Notion 까지 동기화되고, 승인 대기도 쌓인다. BE 에는 회의 삭제 API 가 없다. 리허설 전에 쓸 워크스페이스와 정리 방법을 정한다. 복제할 때 음성 파일 이름도 새 회의 ID 로 바꾼다. 원래 이름을 그대로 쓰면 트랙별 중간 전사 파일이 원본 회의의 것을 덮어쓴다.

결과는 수치와 명령으로 남긴다.

### 4. auto 로 바꾸기

리허설이 끝나면 drop-in 의 `MM_GPU_FAILOVER` 만 `auto` 로 바꾸고 워커를 다시 시작한다. heartbeat 줄이 `"failover": "auto:..."` 로 바뀌었는지 본다.

```bash
sudo sed -i 's/^Environment=MM_GPU_FAILOVER=.*/Environment=MM_GPU_FAILOVER=auto/' \
  /etc/systemd/system/mm-worker.service.d/gpu-stt.conf
sudo systemctl daemon-reload
sudo systemctl restart mm-worker
sudo grep '"failover"' /opt/mm/ai/recordings/.worker/heartbeat.json
```

## 포기한 회의 다시 돌리기

넘길 때 워커가 이번 장애에 전사 단계에서 포기한 회의를 스스로 깨운다. 사람이 돌리는 것은 운영 채널이 서버 이름을 알린 경우와 전환이 꺼져 있던 때의 회의다. 재처리를 실제로 돌린 적은 아직 없다.

GPU 로 넘긴 뒤에만 돌린다. 한 번 포기한 회의는 실패 한 번에 다시 포기되니([`_count_failure`](../../capture/recorder.py)) GPU 가 준비되기 전에 돌리면 그 기회를 버린다. 워커 유닛의 사용자로 돌린다.

포기한 회의와 그 서버 ID 를 찾는다. 한 줄에 서버 ID, 매니페스트, 상태, 포기한 단계가 나온다.

```bash
cd /opt/mm/ai/recordings && sudo -u <워커 사용자> python3 -c '
import glob, json
for p in sorted(glob.glob("session_*.json")):
    m = json.load(open(p))
    r = m.get("recovery") or {}
    if r.get("gave_up_at"):
        print(m.get("guild_id"), p, m.get("status"), r.get("failed_stage"))'
```

서버마다 돌린다. `--retry` 는 한 서버의 포기한 회의를 모두 돌린다.

```bash
cd /opt/mm/ai && sudo -u <워커 사용자> .venv/bin/python -m capture.worker --retry <서버ID>
```

끝나면 위 목록을 다시 본다. 다른 단계에서 포기했거나 `--retry` 뒤에도 그대로인 줄은 담당자가 따로 본다. 장애 전에 포기한 회의나 BE 가 발화 저장을 거절한 회의는 전사와 상관없이 남는다. 결과는 그 회의의 채널에 올라온다.

복구 재시도의 대기 시간 합은 약 15분이다. `MM_RECOVERY_MAX_ATTEMPTS` 가 5 라 60, 120, 240, 480초를 기다리고 다섯 번째 실패에서 포기한다. 기다리는 호출은 이 횟수를 늘리지 않지만, 기다림이 시작되기 전의 실패와 30분 기다림이 끝난 뒤의 실패는 센다.

호출이 일부만 실패한 회의는 다르다. 재처리가 세 번(`MM_PARTIAL_RETRY_MAX`) 지나면 빠진 구간을 둔 채 인계되고 `--retry` 로 되돌릴 수 없다. 서버가 회의 도중 죽거나 일부만 응답하면 이렇게 된다. 재처리는 처음 전사와 경로가 달라 회의를 하나씩 돌고 클립을 하나씩 보낸다. 시간은 재지 않았다.

## 되돌리기

워커의 다시 시작은 그때마다 담당자의 확인을 받는다.

자동 켜기를 24시간만 멈추려면 `/gpu off` 를 친다. 다시 시작하지 않아도 된다.

자동 켜기를 그만두려면 drop-in 의 값을 `manual` 로 바꾸고 워커를 다시 시작한다. 바꾸는 명령은 [들이는 순서](#들이는-순서) 4단계의 `sed` 에서 `auto` 를 `manual` 로 바꾼 것이다.

전환을 통째로 끄려면 먼저 `/gpu off` 를 치고 "GPU 서버를 껐습니다" 알림을 기다린다. 그다음 drop-in 을 지우고 다시 시작한다. heartbeat 에 `"failover"` 줄이 없어지면 꺼진 것이다. 상태 파일은 남으니 다시 켜면 그 단계와 멈춤에서 이어 간다.

```bash
sudo rm /etc/systemd/system/mm-worker.service.d/gpu-stt.conf
sudo systemctl daemon-reload
sudo systemctl restart mm-worker
```

서버가 켜진 채로 drop-in 을 지웠으면 서버는 `StopAt` 까지 켜져 있다. Mac 에서 끄고 `stopped` 인지 본다.

```bash
ai/deploy/gpu-stt/gpu-stt.sh off
ai/deploy/gpu-stt/gpu-stt.sh status
```

토큰이 샜거나 스위치를 바로 막아야 하면 Mac 에서 함수 URL 을 지운다. 운영 워커는 그때부터 켜지도 끄지도 못하고, 켜는 중이었으면 5분 뒤 스위치 무응답을 알린다. 켜져 있는 서버는 위처럼 `gpu-stt.sh off` 로 끈다.

```bash
AWS_PROFILE=<관리자 프로필> aws lambda delete-function-url-config --function-name mm-gpu-switch --region ap-northeast-2
```

다시 열려면 `secrets/gpu-stt/switch.token` 을 지우고 `switch.sh setup` 을 돌린 뒤, [준비](#준비) 4단계로 운영 서버의 설정 파일을 다시 쓰고 워커를 다시 시작한다. 새 주소는 이전과 다를 수 있다.

장애 대응 기간(2026-12-31)이 끝나면 전환을 통째로 끈 뒤 스위치와 대기 서버를 지운다. AMI 삭제 시점은 [결정 0039](../../docs/basis_for_decision/ai/2026-11-04-0039-gpu-stt-server.md) 를 따른다.

```bash
export AWS_PROFILE=<관리자 프로필> AWS_REGION=ap-northeast-2
aws lambda delete-function --function-name mm-gpu-switch
aws iam delete-role-policy --role-name mm-gpu-switch --policy-name mm-gpu-switch
aws iam delete-role --role-name mm-gpu-switch
aws ssm delete-parameter --name /mm/gpu-stt/ledger
aws logs delete-log-group --log-group-name /aws/lambda/mm-gpu-switch
ai/deploy/gpu-stt/gpu-stt.sh destroy --release-ip
```

## 스위치 계약

```
POST <GPU_SWITCH_URL>   Authorization: Bearer <GPU_SWITCH_TOKEN>
요청 {"action": "on" | "off" | "status"}
200  {"state": "off"|"starting"|"running"|"stopping", "launched_at": int|null, "stop_at": int|null,
      "refused": null|"limit"|"capacity"|"spent"|"not_ready"|"stopping", "used_min": int, "cap_min": int}
400  {"error": ...}  action 이 셋 중 하나가 아니거나 본문이 JSON 이 아님
401  본문 없음. 토큰이 틀림
500  {"error": ...}  Role=stt-fallback 인스턴스가 정확히 1대가 아님
```

그 밖의 코드는 함수 URL 이 돌려준다. 예약 동시성이 1이라 동시에 온 요청 하나는 거절되고(429 로 추정), 함수 안의 예외는 502 로 추정한다. 둘 다 재지 않았다. 워커는 200 이 아닌 응답과 모르는 모양을 모두 실패한 호출로 다루고 다음 확인 때 다시 부른다([`stt/gpu_switch.py`](../../stt/gpu_switch.py)).

`on` 은 꺼진 서버에 `StopAt`(지금부터 3시간)을 먼저 쓰고 켠다. 켜져 있거나 켜는 중이면 아무것도 바꾸지 않는다. `refused` 는 vCPU 한도(`limit`), AWS 용량 부족(`capacity`), 누적 상한(`spent`), 첫 부팅을 마치지 못한 서버(`not_ready`), 꺼지는 중(`stopping`)이다. `off` 는 켜진 서버를 끄고, 그 서버를 켠 한 번의 사용 시간을 장부에 한 번만 더한다. 켠 한 번은 `launched_at` 으로 가린다. `used_min` 은 장부에 닫힌 시간만 센다. 지금 켜져 있는 시간은 끈 뒤에 더해진다.

## 한계

빈 응답은 지금도 실패로 세지 않는다. 프롬프트 없는 GPU 전사에서 빈 구간이 없던 것은 회의 1건(15구간)에서 잰 값이다. 넘긴 동안 처리한 회의에서 빈 구간을 찾아도 다시 전사해 인계를 고치는 경로는 없다. 그 회의의 PM 에게 빠진 시각을 알려 승인 대기와 할 일을 녹음과 대조하게 한다.

GPU 로 전사한 회의도 회의록과 `batch.json` 의 모델 이름은 `elice/whisper-large-v3` 다. 어느 서버가 전사했는지는 운영 채널 알림의 시각과 워커 로그의 `[failover]` 줄로 가린다.

장부는 서버가 실제로 꺼진 시각을 모른다. 켠 한 번을 `off` 를 부른 시각과 `StopAt` 중 이른 쪽까지로 센다. 스위치를 거치지 않고 끈 서버는 다음 스위치 호출이 `StopAt` 까지로 세어 실제보다 많이 잡힌다.

누적 상한은 켤 때만 본다. 14시간 59분에서 켜면 3시간을 더 쓸 수 있어 최대 약 18시간, 약 $11.6 이다.

G 계열 vCPU 한도 8 을 같은 계정의 다른 GPU 작업과 나눠 쓴다. 꺼 둔 서버는 한도를 쓰지 않지만 켤 때 AWS 의 남은 용량에 기댄다. 한도나 용량에 막히면 스위치가 `limit`, `capacity` 로 거절하고 워커가 5분마다 다시 켠다. 용량 부족은 측정에서 나오지 않았다.

대기 서버에 접속할 수단을 넣지 않았다. 키 페어도 SSM 역할도 없어서 `/var/log/vllm.log` 를 볼 수 없다. 두 번 부팅해도 준비되지 않으면 워커가 멈추고, 그다음은 `destroy` 뒤 `setup` 으로 다시 만든다.

스위치의 로그는 CloudWatch Logs 의 `/aws/lambda/mm-gpu-switch` 에 남는다. 핸들러는 토큰과 요청 본문을 출력하지 않는다. 500 이 오면 `gpu-stt.sh status` 로 대기 서버가 1대인지부터 본다.

토큰을 가진 사람은 누구나 서버를 켜고 끌 수 있다. 피해는 누적 상한 안의 비용과 전사 중단이다. 토큰은 운영 서버의 `/etc/mm/gpu-stt.env`(root 만 읽음), Mac 의 `secrets/gpu-stt/`, Lambda 환경 변수에 있다.

장애 동안 실제 회의 음성이 TLS 로 개인 AWS 계정을 지난다. 팀에는 "지나기만 하고 저장하지 않으며 학습에 쓰지 않는다" 로 알린다([#360](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/360), [결정 0039](../../docs/basis_for_decision/ai/2026-11-04-0039-gpu-stt-server.md)).

서버는 음성을 파일로 남기도록 띄우지 않았다. 다만 업로드가 1MiB 를 넘으면 받는 동안 `/tmp` 의 이름 없는 임시 파일에 쓴다. `/tmp` 는 꺼 둔 뒤에도 남는 EBS 디스크다. 운영 워커가 보내는 묶음은 공백을 합쳐 최대 28.2초, 902,444바이트라 이 기준 아래다. 요청이 끝난 뒤 보이는 음성 파일은 합성음 측정에서 0개였다. 자세한 근거와 한계는 [측정](../../stt/eval/results/2026-11-05-gpu-fallback-prod/README.md#음성-임시-파일)에 있다.

인증서 키와 API 키는 꺼 둔 서버의 디스크와 user-data 에 남는다.

## 비용

켜 둔 동안 시간당 $0.647 이고 켤 때 초기화 비용은 없다. 켜지 않아도 디스크 75GB 가 월 $6.84, 고정 IP 가 시간당 $0.005 로 든다. 초기화 약 $0.30 은 `setup` 이 서버를 만들 때 한 번만 든다. 누적 상한 15시간을 다 쓰면 $9.7 이다.

Elice 확인 호출은 한 번 약 ₩0.16 이다. 넘긴 동안 5분마다 한 번 부른다. Lambda 와 장부 파라미터의 비용은 재지 않았다.

## 잊지 말 것

서버는 켠 뒤 3시간에 스스로 stop 한다. 지우지 않으니 대기 서버는 남는다. 부팅할 때마다 `StopAt` 으로 다시 예약하고, 짧은 시각으로 실제 꺼지는 것을 확인했다. 분 단위로 올려 잡고 종료 처리도 있어 정한 시각보다 1분에서 2분 늦게 꺼지기 시작할 수 있다. `on` 은 켜져 있는 서버의 종료 시각을 늘리지 않는다.

stop 은 약 400초(403.7초와 402.0초) 걸리고 그동안은 다시 켤 수 없다. 끄자마자 장애가 다시 나면 워커는 꺼짐이 끝날 때까지 기다렸다가 켠다.

`off` 와 `destroy` 는 고정 IP 를 놓지 않는다. 놓으면 인증서와 운영 서버 설정을 다시 만들어야 한다. 놓을 때만 `destroy --release-ip` 를 쓴다.

`destroy` 는 대기 서버와 디스크를 지운다. 인증서를 새로 만들 때와 장애 대응 기간이 끝날 때만 쓴다. 다시 만들려면 `setup` 약 12분과 초기화 약 $0.30 이 든다.
