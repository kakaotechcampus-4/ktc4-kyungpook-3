# 실제 표시 이름 힌트와 BE 팀원 이름 힌트 측정 (2026-10-13)

#198 의 이름 힌트를 잰 프롬프트(`환님, 환, 김환` 처럼 사람이 정한 부르는 이름)와 운영 봇이 실제로 만드는 프롬프트가 달랐다(#175 멘토 리뷰). 운영 봇은 디스코드 서버 멤버의 표시 이름으로 프롬프트를 만드는데, 표시 이름은 아이디 꼴이거나 성이 빠져 있다. 실제 문자열, PM 이 온보딩에서 정한 이름(BE)으로 만든 문자열, 그 이름을 실명 먼저 놓은 문자열을 같은 날 같은 자료로 견줬다. 결정은 [0024](../../../../docs/basis_for_decision/member/2026-10-13-0024-member-name-hint.md) 이다.

## 조건

- 전사: Elice 새 주소, 운영과 같은 묶음 설정과 말 필터, 회의당 동시 호출 6. 로컬 맥에서 돌렸다
- 자료: 9/29 1인 실녹음(대본, 이름 자리 4), 10/2 2인 실녹음(이름 자리 2를 손으로 정답), 6인 정렬본 m01·m02
- 프롬프트

| 조건 | 프롬프트 | 만든 법 |
|---|---|---|
| A 운영 | `동우님, 동우, 원준님, 원준, 장원준.` | 팀 서버 멤버 표시 이름(`yujaehwan2261`, `동우`, `장원준`, 10/13 디스코드에서 읽음)을 지금 함수 `hint_prompt` 에 넣었다. 아이디 꼴은 빠지고 두 글자는 성을 떼지 않는다 |
| B BE 이름 | `동우님, 동우, 김동우, 재환님, 재환, 유재환, 원준님, 원준, 장원준, 지민님, 지민, 윤지민, 환님, 환, 김환, 진호님, 진호, 최진호.` | 팀원 실명 여섯을 새 함수 `member_prompt` 에 넣었다. 10/10 세 꼴 측정과 같은 문자열이다 |
| C 실명 먼저 | `김동우, 동우, 동우님, 유재환, 재환, 재환님, ...` | B 와 같은 꼴을 실명, 부르는 이름, 님 순으로 |

- BE 이름은 우리 워크스페이스에 팀원 여섯이 실명으로 등록돼 있다고 놓고 만들었다. 운영 BE 의 실제 명단은 조회 경로가 배포된 뒤 확인한다

## 결과

| 지표 | A 운영 | B BE 이름 | C 실명 먼저 |
|---|---|---|---|
| 9/29 이름 자리(이름+님) | 1/4 | 3/4 | 3/4 |
| 9/29 틀린 이름 | 재환, 지민, 환 | 지민 | 지민 |
| 10/2 이름 자리 | 2/2 | 2/2 | 2/2 |
| 9/29 CER | 21.07% | 21.38% | 21.86% |
| 9/29 치환·삭제·삽입 | 185·69·14 | 195·58·19 | 199·59·20 |
| 9/29 한국어 줄 CER(20줄 426자) | 18.54% | 18.31% | 19.25% |
| 6인 m01 CER | 4.94% | 5.33% | 6.39% |
| 6인 m02 CER | 4.73% | 4.73% | 4.73% |
| 프롬프트 글이 전사에 샌 곳 | 0 | 0 | 0 |

운영 문자열(A)에는 재환·지민·환·진호가 없어서 9/29 의 그 이름 자리를 고치지 못했다. BE 이름(B)은 이름 자리를 3/4 로 올리고 CER 은 9/29 0.31pt, m01 0.39pt 높았다. 10/10 에 같은 문자열을 잰 결과(이름 자리 5/6, m01 은 부르는 이름+님 꼴보다 0.4pt 높음)와 맞는다. 실명을 먼저 놓으면(C) 이름 자리는 같고 CER 이 9/29 0.48pt, m01 1.06pt 더 높았다. 위스퍼는 프롬프트를 앞 문맥으로 읽어서, 회의에서 들리는 꼴(부르는 이름)이 앞에 오는 편이 낫다고 본다.

모든 자료가 이름에 님을 붙여 부르는 대본이다. "김환이가 하자" 처럼 존칭 없이 부르는 회의에서 실명 꼴이 도움이 되는지는 그런 녹음이 없어 아직 재지 않았다.

## 비용

장부 호출 105번(예열 포함), 보낸 소리 1,680.4초. 호출마다 최소 1분으로 친 보수 계산 630원, 초 기준 약 168원이다.

## 재현

```
# ai/ 안에서. ELICE_API_KEY, ELICE_STT_BASE_URL 을 환경에 준다. D 는 자료 폴더(레포 밖)
EL="--backend elice --spend-file RUN/elice_spend.jsonl --cap-krw 900 --min-bill-s 60"
for c in A B C; do   # P_A, P_B, P_C 는 위 표의 프롬프트
  python -m stt.eval.capacity.runner seq --tracks-dir $D/real929 --label real929 --save-lines --prompt-text "$P" $EL --out-dir RUN/$c
  python -m stt.eval.capacity.runner seq --tracks-dir $D/two-person --label two --save-lines --prompt-text "$P" $EL --out-dir RUN/$c
  python -m stt.eval.capacity.runner golden --session $D/m01 --tag m01 --save-lines --prompt-text "$P" $EL --out-dir RUN/$c
  python -m stt.eval.capacity.runner golden --session $D/m02 --tag m02 --save-lines --prompt-text "$P" $EL --out-dir RUN/$c
done
python -m stt.eval.capacity.names --names 동우,재환,원준,지민,환,진호 --script <9/29 대본> --lines A=RUN/A/lines-real929-1.json --lines B=... --lines C=...
python -m stt.eval.capacity.real929 --script <9/29 대본> --lines A=RUN/A/lines-real929-1.json --lines B=... --lines C=... --out RUN/real929
```
