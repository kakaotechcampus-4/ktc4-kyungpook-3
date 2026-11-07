# 단어 시각 없는 전사의 회의록 순서 측정 (2026-10-13)

Elice 새 주소는 단어 시각을 주지 않아서, 한 화자의 여러 턴을 한 번에 보낸 묶음이 회의록 한 줄이 되고 그 줄이 다른 화자의 말을 건너뛴다. 묶음을 다른 화자가 말을 시작한 자리에서 가르는 방식(순서 묶음)을 지금 방식(묶음)과 견줬다. 결정은 [0023](../../../../docs/basis_for_decision/member/2026-10-13-0023-ordered-chunks.md) 이다.

## 조건

- 전사: Elice 새 주소(vLLM, openai/whisper-large-v3), 운영과 같은 묶음 설정과 말 필터, 회의당 동시 호출 6. 로컬 맥에서 돌렸다
- 프롬프트(두 방식 같음): `동우님, 동우, 김동우, 재환님, 재환, 유재환, 원준님, 원준, 장원준, 지민님, 지민, 윤지민, 환님, 환, 김환, 진호님, 진호, 최진호.`
- 자료
  - 교차 대화 m01·m02: 6인 정렬본을 `stt.eval.capacity.interleave` 로 다시 놓은 것. 화자마다 VAD 클립을 원래 순서대로 두고 화자를 돌아가며 한 클립씩 0.8초 띄워 놓았다(m01 15턴 149초, m02 17턴 158초). 목소리는 원본, 시간축은 합성이다. 화자별 정답은 정렬본과 같다
  - 10/2 2인 실녹음(7턴, 정답 대본 없음)
  - 9/29 1인 실녹음, 6인 정렬본 m01·m02(한 사람씩 이어 말함). 묶음 구성만 견줬다(호출 없음)
- 반복: 설정마다 한 번. 같은 묶음은 결과가 글자까지 같다(0020 측정)

## 결과

순서는 `stt.eval.capacity.order` 로 쟀다. 건너뛴 줄은 다른 화자가 말을 시작한 자리를 사이에 둔 줄, 문장 순서 역전은 판단 1단계(`judge.semantic_judge._flatten`)가 매긴 문장 순서에서 뒤 문장의 발화가 앞 문장의 발화보다 먼저인 인접 쌍이다.

| 자료 | 방식 | 줄 | 건너뛴 줄 | 화자 순서 편집 | 문장 순서 역전 | 줄 시작 오차 평균 | 호출 | CER |
|---|---|---|---|---|---|---|---|---|
| m01 교차 | 묶음 | 7 | 6 | 8 | 5 | 36.1초 | 7 | 5.33% |
| m01 교차 | 순서 묶음 | 15 | 0 | 0 | 0 | 0.0초 | 15 | 5.20% |
| m02 교차 | 묶음 | 7 | 7 | 10 | 6 | 42.9초 | 7 | 4.73% |
| m02 교차 | 순서 묶음 | 17 | 0 | 0 | 0 | 0.0초 | 17 | 5.78% |
| 10/2 2인 | 묶음 | 3 | 1 | | | | 3 | |
| 10/2 2인 | 순서 묶음 | 7 | 0 | | | | 7 | |

혼자 말한 회의와 한 사람씩 이어 말한 회의는 묶음이 같다. 그래서 호출 수와 전사 결과도 같다.

| 자료 | 묶음 호출 | 순서 묶음 호출 | 묶음 구성 |
|---|---|---|---|
| 9/29 1인 | 10 | 10 | 같음 |
| m01 정렬본 | 7 | 7 | 같음 |
| m02 정렬본 | 7 | 7 | 같음 |

턴마다 하나씩 보내는 방식(`--no-pack-turns`)은 9/29 에서 호출이 10에서 34로 늘고 CER 이 21.2%에서 23.4%로 올랐다(#154). 순서 묶음은 화자가 번갈아 말하는 곳에서만 묶음을 가르므로 혼자 말하는 구간의 문맥을 잃지 않는다.

## 판단 1단계의 문장 순서 (10/2)

같은 녹음을 두 방식으로 전사해 `_flatten` 의 문장 순서를 견줬다. 묶음 방식에서는 화자 한 사람의 말이 전부 한 줄이 되어, 대답이 부탁보다 앞에 놓인다.

| 순서 | 묶음 | 순서 묶음 |
|---|---|---|
| 앞 | (5) 동우: 네, 그것도 제가 할게요. | (9) 재환: 그건 동우님이 같이 해주세요. |
| 뒤 | (12) 재환: 그건 동우님이 같이 해주세요. | (10) 동우: 네, 그것도 제가 할게요. |

1단계는 "제가 할게요" 를 그 말을 한 화자의 할 일로 보고, 무엇을 맡는지는 앞뒤 문장으로 판단한다. 대답이 부탁보다 앞에 오면 "그것" 이 가리킬 일이 앞에 없다. 이 차이가 추출 결과를 얼마나 바꾸는지는 LLM 단가를 확인하지 못해 아직 재지 않았다.

## CER 이 오른 곳

m02 교차에서 CER 이 1.05pt 올랐다. 짧은 클립을 하나씩 보내 문맥이 짧아진 자리다. 화자별로는 최진호 6.19% → 10.31%, 윤지민 10.97% → 12.90%, 장원준 0.00% → 0.73% 이고 나머지는 같았다. 예: "문서화" → "문소아", "서머리" → "혐오리", "세 가지" → "3가지". m01 교차는 장원준이 1.46% → 0.73% 로 내려가 전체가 0.13pt 낮아졌다. 10/2 에서도 "배포" 가 "배터리" 로, "기터 액션" 이 "기타 액션" 으로 바뀐 자리가 있었다. 용어 힌트(기존 태스크 제목)로 메울 수 있는지는 따로 잰다.

## 비용

장부 호출 62번(예열 6번 포함), 보낸 소리 674.6초. 호출마다 최소 1분으로 친 보수 계산 372원, 초 기준 약 67원이다.

## 재현

```
# ai/ 안에서. ELICE_API_KEY, ELICE_STT_BASE_URL 을 환경에 준다(값은 출력하지 않는다). D 는 정렬본·실녹음 폴더(레포 밖)
python -m stt.eval.capacity.interleave --source $D/m01 --out $D/m01-interleaved
python -m stt.eval.capacity.interleave --source $D/m02 --out $D/m02-interleaved
EL="--backend elice --spend-file RUN/elice_spend.jsonl --cap-krw 1500 --min-bill-s 60"
for o in off auto; do
  python -m stt.eval.capacity.runner golden --session $D/m01-interleaved --tag m01-interleaved-$o --save-lines --prompt-text "$ALL" --order $o $EL --out-dir RUN/$o
  python -m stt.eval.capacity.runner golden --session $D/m02-interleaved --tag m02-interleaved-$o --save-lines --prompt-text "$ALL" --order $o $EL --out-dir RUN/$o
  python -m stt.eval.capacity.runner seq --tracks-dir $D/two-person --label two --save-lines --prompt-text "$ALL" --order $o $EL --out-dir RUN/$o
done
python -m stt.eval.capacity.order --truth $D/m01-interleaved/truth_aligned.json --lines 묶음=RUN/off/lines-m01-interleaved-elice.json --lines 순서=RUN/auto/lines-m01-interleaved-elice.json --out RUN/order-m01.json
python -m stt.eval.capacity.order --lines 묶음=RUN/off/lines-two-1.json --lines 순서=RUN/auto/lines-two-1.json --out RUN/order-two.json
```
