# GPU 전사 서버 전환 절차

Elice 전사가 멈추면 운영 워커를 평소 꺼 둔 GPU 서버로 사람이 옮기고, 끝나면 되돌린 뒤 서버를 끈다. 서버는 지우지 않고 꺼 둔다. `setup` 이 대기 서버를 한 번 만들고 `on` 은 start, `off` 는 stop 이다.

`setup`, `on`, `off`, 자동 stop 과 운영 서버에서 GPU 서버를 부르는 데까지는 2026-11-06 에 실제로 돌렸다([측정](../../stt/eval/results/2026-11-05-gpu-fallback-prod/README.md)). 전환 4단계의 drop-in, 워커 재시작, 복귀는 2026-11-07 에 저장된 6인 회의 하나로 돌렸다([리허설 기록](../../docs/basis_for_decision/ai/2026-11-07-gpu-stt-rehearsal.md)). 재처리는 아직 돌려 보지 않았다. 처음 쓰는 날에는 그 단계가 그대로 통하지 않을 수 있다고 보고 시간을 잡는다.

서버는 g4dn.xlarge 의 vLLM, whisper-large-v3 이고 측정값은 [결과 문서](../../stt/eval/results/2026-11-04-gpu-serving/README.md), 판단은 [결정 0039](../../docs/basis_for_decision/ai/2026-11-04-0039-gpu-stt-server.md) 에 있다. 서비스 전체의 복구 절차는 [#359](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/359) 에서 다룬다.

## 언제 쓰나

Elice 전사가 멈췄고 처리할 회의를 운영 CPU 전사로 기다릴 수 없을 때 쓴다. 자동으로 넘어가지 않는다. 사람이 판단해서 켠다.

## 준비

한 번만 한다. 장애가 나기 전에 해 둔다.

Mac 에서 보안 그룹, 고정 IP, 인증서, API 키와 대기 서버를 만든다. 대기 서버는 첫 부팅에서 모델을 한 번 읽고 스스로 꺼진다. 709.6초 걸렸다. 다시 돌려도 있는 것은 그대로 둔다. 운영 서버 IP 가 바뀌었으면 새 IP 로 다시 돌린다.

```bash
ai/deploy/gpu-stt/gpu-stt.sh setup <운영 서버 공인 IP>
```

`setup` 이 끊겼으면 다시 돌린다. 첫 부팅이 돌고 있으면 이어서 기다린다. 이미 꺼졌으면 첫 부팅을 마쳤는지 알 수 없어 멈추니 `destroy` 뒤 `setup` 을 돌린다. `on` 은 `setup` 을 마치지 못한 서버를 쓰지 않는다.

만든 값은 `secrets/gpu-stt/` 에만 있다. 여기서 인증서와 전사 설정을 운영 서버로 옮긴다. 키가 화면에 나오지 않도록 표준 입력으로 보낸다. 운영 서버 접속 방법은 그때의 것을 쓴다.

```bash
cd ~/Desktop/kakaotech4/secrets/gpu-stt
. ./env
prod() { ssh <운영 서버> "$@"; }
prod "sudo sh -c 'mkdir -p /etc/mm; umask 022; cat > /etc/mm/gpu-stt-ca.pem'" < cert.pem
printf 'ELICE_STT_BASE_URL=https://%s:8000\nELICE_API_KEY=%s\nELICE_STT_CA_BUNDLE=/etc/mm/gpu-stt-ca.pem\n' \
  "$EIP" "$(cat api.key)" | prod "sudo sh -c 'umask 077; cat > /etc/mm/gpu-stt.env'"
```

인증서 파일은 워커 프로세스가 직접 여니 모두 읽을 수 있어야 한다. `gpu-stt.env` 는 systemd 가 root 로 읽으니 root 만 읽으면 된다. 인증서와 키는 대기 서버 디스크에도 있다. 고정 IP 가 바뀌었거나 `secrets/gpu-stt/` 를 잃으면 `setup` 이 아무것도 쓰지 않고 멈춘다. `destroy` 뒤 `setup` 으로 서버를 새로 만들고 두 파일도 다시 옮긴다.

운영 서버의 전사 백엔드가 `elice` 인지 확인한다. 아니면 이 절차로 전사가 옮겨 가지 않는다.

```bash
sudo grep '^MM_STT_BACKEND=' /opt/mm/ai/.env
systemctl cat mm-worker | grep MM_STT_BACKEND
```

유닛에 값이 있으면 그 값이 `.env` 를 이긴다.

## 전환

순서를 바꾸지 않는다. 운영 서버 재시작은 그때마다 담당자의 확인을 받는다.

1. Mac 에서 켠다. 기본 3시간 뒤 스스로 꺼지도록 예약된다. 꺼지는 중이면 켜지지 않으니 [끄기](#복귀)의 시간을 본다.

   ```bash
   ai/deploy/gpu-stt/gpu-stt.sh on
   ```

2. 운영 서버에서 200 이 올 때까지 확인한다. 보안 그룹이 운영 서버만 열어 두어 Mac 에서는 닿지 않는다. `on` 부터 운영 서버가 받은 첫 전사 응답까지 161.8초와 158.6초였다.

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' --cacert /etc/mm/gpu-stt-ca.pem https://<고정 IP>:8000/health
   ```

3. 워커가 읽을 파일로 실제 호출을 해 본다. `/health` 의 200 은 키와 `gpu-stt.env` 의 내용을 확인해 주지 않는다. 틀린 채 워커를 다시 시작하면 모든 회의가 실패한다. 200 이면 다음으로 간다. 401 이면 키가, 000 이면 인증서나 주소가 맞지 않는다.

   ```bash
   sudo sh -c '. /etc/mm/gpu-stt.env; printf "Authorization: Bearer %s\n" "$ELICE_API_KEY" | curl -s -o /dev/null -w "%{http_code}\n" -H @- --cacert "$ELICE_STT_CA_BUNDLE" "$ELICE_STT_BASE_URL/v1/models"'
   ```

4. 운영 서버에 drop-in 을 두고 워커를 다시 시작한다. 전사하는 프로세스는 `mm-worker` 뿐이고 봇은 저장만 하니 봇은 건드리지 않는다.

   ```bash
   sudo install -D -m 0644 /opt/mm/ai/deploy/gpu-stt/mm-worker-gpu.conf.example \
     /etc/systemd/system/mm-worker.service.d/gpu-stt.conf
   sudo systemctl daemon-reload
   sudo systemctl restart mm-worker
   systemctl show mm-worker -p EnvironmentFiles
   ```

   SIGTERM 을 받은 워커는 하던 회의를 마치고 끝나므로 재시작은 `TimeoutStopSec=1200` 인 20분까지 걸릴 수 있다. drop-in 은 `.env` 를 고치지 않는다. `load_env` 가 이미 있는 환경변수를 덮지 않아서 drop-in 의 값이 이긴다. `ELICE_API_KEY` 는 워커에서 전사만 쓰니 추출과 인계는 영향이 없다.

5. 그다음 [실패 회의를 재처리](#실패-회의-재처리)한다.

## 복귀

Elice 가 돌아오면 워커부터 되돌리고 서버를 끈다. 재시작이 하던 회의를 마친 뒤에 꺼야 그 회의가 끊기지 않는다.

그 전에 [전사에서 포기한 회의가 남지 않았는지](#실패-회의-재처리) 확인한다. 재처리 중에 재시작하면 남은 회의는 다시 돌지 않는다.

```bash
sudo rm /etc/systemd/system/mm-worker.service.d/gpu-stt.conf
sudo systemctl daemon-reload
sudo systemctl restart mm-worker
```

Mac 에서 끄고 `stopped` 인지 확인한다. `off` 는 켜진 인스턴스가 남으면 실패로 끝난다. stop 이 끝날 때까지 기다려서 약 400초(403.7초와 402.0초) 걸렸고, 그동안은 `on` 으로 다시 켤 수 없다. 끄자마자 장애가 다시 나도 약 7분을 기다린 뒤 켠다.

```bash
ai/deploy/gpu-stt/gpu-stt.sh off
ai/deploy/gpu-stt/gpu-stt.sh status
```

## 실패 회의 재처리

GPU 서버가 200 을 주고 워커를 다시 시작한 뒤에만 돌린다. 워커 유닛의 사용자로 돌린다. 사용자는 `systemctl cat mm-worker` 로 확인한다.

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

서버마다 돌린다. `--retry` 는 한 서버만 깨운다.

```bash
cd /opt/mm/ai && sudo -u <워커 사용자> .venv/bin/python -m capture.worker --retry <서버ID>
```

끝나면 위 목록을 다시 본다. 포기한 단계가 `stt` 인 줄이 없어질 때까지 복귀하지 않는다. 다른 단계이거나 `--retry` 뒤에도 그대로인 줄은 복귀를 막지 않고 담당자가 따로 본다. 장애 전에 포기한 회의나 BE 가 발화 저장을 거절한 회의는 전사와 상관없이 남는다.

순서가 중요한 이유는 한 번 포기한 회의가 실패 한 번에 다시 포기되기 때문이다([`_count_failure`](../../capture/recorder.py)). GPU 가 준비되기 전에 돌리면 그 기회를 버린다.

복구 재시도의 대기 시간 합은 약 15분이다. `MM_RECOVERY_MAX_ATTEMPTS` 가 5 라 60, 120, 240, 480초를 기다리고 다섯 번째 실패에서 포기한다. 실제로는 호출 실패에 드는 시간이 더해져 실패 양상과 회의 길이에 따라 더 걸린다. 그래서 전환 전에 들어온 회의가 포기될 수 있다. 호출이 전부 실패한 회의는 예상한 동작이고 위 명령으로 다시 돌린다. 결과는 그 회의의 채널에 올라온다.

호출이 일부만 실패한 회의는 다르다. 재처리가 세 번(`MM_PARTIAL_RETRY_MAX`) 지나면 빠진 구간을 둔 채 인계되고 `--retry` 로 되돌릴 수 없다. 서버가 회의 도중 죽거나 일부만 응답하면 이렇게 된다.

재처리는 처음 전사와 경로가 다르다. 회의를 하나씩 돌고 클립을 하나씩 보낸다. 시간은 재지 않았다.

저장된 회의를 복제해 리허설하면 실제 회의처럼 처리된다. BE 에 새 회의가 생기고, 추출 결과가 자동으로 태스크가 되면 Notion 까지 동기화되고, 승인 대기도 쌓인다. BE 에는 회의 삭제 API 가 없다. 리허설을 다시 하면 쓸 워크스페이스와 정리 방법을 먼저 정한다.

## 잊지 말 것

서버는 켠 뒤 3시간에 스스로 stop 한다. 지우지 않으니 대기 서버는 남는다. 부팅할 때마다 다시 예약하고, 짧은 시각으로 실제 꺼지는 것을 확인했다. 분 단위로 올려 잡고 종료 처리도 있어 정한 시각보다 1분에서 2분 늦게 꺼지기 시작할 수 있다. 끝나면 `off` 와 `status` 를 돌린다. 더 필요하면 켤 때 `on --hours N` 을 준다. 회의가 남았는데 꺼졌으면 꺼짐이 끝난 뒤 `on` 을 다시 돌린다. 고정 IP 와 인증서가 같아서 운영 서버는 그대로 두면 되고, 켜는 시간만 다시 기다린다.

`on` 은 켜져 있는 서버의 종료 시각을 늘리지 않는다. 종료 시각은 부팅 때 정해지고 `status` 로 볼 수 있다.

종료 시각에 처리 중이던 회의는 일부만 전사된 채 끊겨 위의 구멍 난 인계가 될 수 있다. 종료 시각 전에 복귀를 끝낸다.

자동 stop 은 워커를 되돌리지 않는다. drop-in 이 남아 있으면 워커는 꺼진 서버를 계속 부르고 전사가 실패한다. 다시 켜거나 복귀 절차를 끝까지 한다.

`off` 와 `destroy` 는 고정 IP 를 놓지 않는다. 놓으면 인증서와 운영 서버 설정을 다시 만들어야 한다. 놓을 때만 `destroy --release-ip` 를 쓴다.

`destroy` 는 대기 서버와 디스크를 지운다. 인증서를 새로 만들 때와 장애 대응 기간이 끝날 때만 쓴다. 다시 만들려면 `setup` 약 12분과 초기화 약 $0.30 이 든다.

## 한계

지금은 김동우만 전환할 수 있다. 켜고 끄려면 개인 AWS 자격 증명이 필요하고 운영 서버에는 개인 키를 두지 않는다.

G 계열 vCPU 한도 8 을 같은 계정의 다른 GPU 작업과 나눠 쓴다. 꺼 둔 서버는 한도를 쓰지 않는다. `on` 이 한도로 실패하면 켜진 인스턴스를 알려 주니, 그 작업을 멈추거나 끝나기를 기다린다.

꺼 둔 서버는 켤 때 AWS 의 남은 용량에 기댄다. `InsufficientInstanceCapacity` 로 실패하면 잠시 뒤 다시 돌린다. 측정에서는 나오지 않았다.

서버에 접속할 수단을 넣지 않았다. 키 페어도 SSM 역할도 없어서 `/var/log/vllm.log` 를 볼 수 없다. 200 이 오지 않으면 `off` 로 끈 뒤 `on` 을 해 보는 것 말고 원인을 찾기 어렵다. 그래도 안 되면 `destroy` 뒤 `setup` 으로 다시 만든다.

GPU 서버는 이름 프롬프트를 넣으면 전사가 크게 나빠진다. 리허설 회의의 CER 은 프롬프트 없이 Elice 와 같은 6.72% 였고, 프롬프트를 넣으면 Elice 8.33%, GPU 19.89% 였다. 워커는 프롬프트를 끄는 설정이 없어 전환하면 이 경로로 돈다. 15구간 중 2구간이 오류 없이 빈 응답으로 왔고, 회의는 실패 0으로 인계됐으며 `--retry` 대상도 아니다. 전환 중 처리한 회의는 전사에 빠진 구간이 없는지 사람이 확인한다. 근거는 [리허설 기록](../../docs/basis_for_decision/ai/2026-11-07-gpu-stt-rehearsal.md#빈-전사-재현)에 있다.

장애 동안 실제 회의 음성이 TLS 로 개인 AWS 계정을 지난다. 동의 범위는 팀이 정할 일이고 [#360](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/360), [결정 0039](../../docs/basis_for_decision/ai/2026-11-04-0039-gpu-stt-server.md) 와 함께 다룬다.

서버는 음성을 파일로 남기도록 띄우지 않았다. 다만 업로드가 1MiB 를 넘으면 받는 동안 `/tmp` 의 이름 없는 임시 파일에 쓴다. `/tmp` 는 꺼 둔 뒤에도 남는 EBS 디스크다. 운영 워커가 보내는 묶음은 공백을 합쳐 최대 28.2초, 902,444바이트라 이 기준 아래다. 요청이 끝난 뒤 보이는 음성 파일은 합성음 측정에서 0개였다. 자세한 근거와 한계는 [측정](../../stt/eval/results/2026-11-05-gpu-fallback-prod/README.md#음성-임시-파일)에 있다.

인증서 키와 API 키는 꺼 둔 서버의 디스크와 user-data 에 남는다.

비용은 켜 둔 동안 시간당 $0.647 이고 켤 때 초기화 비용은 없다. 켜지 않아도 디스크 75GB 가 월 $6.84, 고정 IP 가 시간당 $0.005 로 든다. 초기화 약 $0.30 은 `setup` 이 서버를 만들 때 한 번만 든다.

장애 대응 기간은 2026-12-31 까지다. 끝나면 `destroy --release-ip` 로 대기 서버를 지우고 고정 IP 를 놓는다. AMI 삭제 시점은 [결정 0039](../../docs/basis_for_decision/ai/2026-11-04-0039-gpu-stt-server.md) 를 따른다.
