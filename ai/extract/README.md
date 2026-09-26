# extract/ — 할일 추출기 (Phase 1)

회의 대화록을 받아 **할일 목록**을 만든다. 이 문서는 "무엇이 들어와서 어떤 경로로 무엇이 나가는지"를
한 번에 읽도록 정리한 것이다.

관련 문서 — 서로 역할이 다르니 헷갈리지 말 것:

| 문서 | 무엇 |
|---|---|
| **`TASK_CRITERIA.md`** | **판단 기준의 원본.** "무엇을 할일로 볼 것인가", 담당자 타입, 마감 해석 규칙 |
| `golden_set/README.md` | 골든셋 케이스 파일 형식과 추가하는 법 |
| 이 문서 | 코드 구조와 데이터 흐름 |

> 기준이 바뀌면 **`TASK_CRITERIA.md` 를 먼저 고치고** 프롬프트·골든셋 정답을 거기 맞춘다.
> 반대 순서로 하면 셋이 조용히 어긋난다.

---

## 1. 한눈에 보는 전체 흐름

```
 Discord 음성 (화자별 트랙)
   │
   │  capture/ + stt/          ← 다른 단계. 여기서는 결과만 받는다
   ▼
 Transcript                    ← 추출기의 입력
   │
   ├─(1) split_sentences()     문장 단위로 쪼갠다                     [코드]
   ├─(2) filter_relevant()     할일이 담긴 문장 번호만 고른다          [LLM 호출]
   ├─(3) extract_structured()  그 문장들에서 세부 정보를 뽑는다        [LLM 호출]
   ├─(4) _reconcile()          반복 호출 결과를 합친다                [코드]
   ├─(5) sanity_check_due_date() 날짜를 검증·보정한다                 [코드]
   └─(6) 상태 판정 + ExtractedTask 조립                              [코드]
   │
   ▼
 list[ExtractedTask]           ← 추출기의 출력
   │
   │  capture/recorder.py: extract_after_transcription()
   ▼
 transcripts/session_<ts>.tasks.json
   │
   │  ⚠️ 여기서 끊겨 있다 — BE 로 보내는 코드가 아직 없다 (6장 참고)
   ▼
 BE  POST /extractions
```

**LLM 호출은 (2)와 (3) 두 번뿐이다.** 나머지는 전부 코드다.
"판단"은 LLM 이 하고 "검증"은 코드가 한다 — 이게 이 모듈의 기본 방침이다.

---

## 2. 입력 — 무엇이 들어오는가

`shared/schemas.py` 의 `Transcript`.

```python
@dataclass
class TranscriptSegment:
    speaker: str | None   # 플랫폼 사용자 ID (Discord user ID). 표시 이름이 아니다
    start: float          # 회의 시작 기준 초
    end: float
    text: str
    seq: int = 0          # 회의 전체에서의 발화 순번. 근거 점프가 참조하는 안정된 식별자

@dataclass
class Transcript:
    segments: list[TranscriptSegment]
    source: str = "meeting"
```

**질문: speaker 와 text 둘뿐인가?**
아니다. `start / end / seq` 도 같이 온다. 다만 **추출기가 실제로 쓰는 건 `speaker`, `text`, `seq` 셋이다.**
`start` 는 정렬에만 쓰고(`sorted(segments, key=lambda s: s.start)`) `end` 는 안 쓴다.

여기에 더해 `extract_tasks()` 가 인자로 두 가지를 더 받는다:

| 인자 | 무엇 | 없으면 |
|---|---|---|
| `speaker_names` | `{사용자ID: 표시이름}` — 프롬프트에 "도윤: ..." 으로 넣기 위함 | 화자가 `?` 로 표시됨 |
| `today` | 상대 날짜("내일", "이번 주 목요일")의 **기준일** | `shared.config.today()` = 실행일 |

> ⚠️ `today` 는 **회의 날짜**여야 한다. 9/16 회의를 9/17에 재처리하면 "내일"이 하루 밀린다.
> 현재 `capture/recorder.py` 의 `build_extractor()` 가 이 인자를 넘기지 않는다 (멘토 리뷰 R11, 미해결).

### 2.1 `speaker`(ID) 와 표시 이름은 어디서 오는가

둘은 **완전히 다른 경로**로 들어온다. ID 는 오디오 패킷에서 바로 나오고, 표시 이름은 녹음이 끝난 뒤
Discord API 로 조회해서 나중에 붙인다.

```
패킷 user.id ─→ 파일명 {uid}_{ts}.wav ─→ Track.speaker_id ─→ TranscriptSegment.speaker ─→ ExtractedTask.speaker_id
                      │                                                                        (BE 인계용)
                      └→ 매니페스트 speakers[] ─(guild.get_member().display_name 로 덮어씀)─→ speaker_names
                                                                                                (프롬프트 표시용)
```

#### ID — 오디오 패킷의 화자 키

Discord 가 **화자별로 트랙을 따로** 주므로 별도 diarization 이 필요 없다. 트랙 자체가 화자다.

```python
# capture/streaming_sink.py
def _write(self, data, user) -> None:
    uid = getattr(user, "id", user)      # Member 객체면 .id, 이미 int 면 그대로
```

py-cord 버전마다 키 모양이 달라서 헬퍼가 따로 있다 —
`capture/recording_store.py :: key_to_user_id()` (2.6 은 `int`, 2.9 는 `Member`/`User` 객체 또는 `None`).

이 uid 가 **파일명에 박혀** 저장되고(`recordings/{uid}_{ts}.wav`), STT 가 파일명에서 다시 꺼낸다:

```python
# stt/batch.py :: discover()
uid = stem.split("_", 1)[0] if "_" in stem and stem.split("_", 1)[0].isdigit() else stem
tracks.append(Track(speaker_id=uid, speaker_name=names.get(uid, uid), path=p))
```

> **타입 주의** — 패킷에서는 `int`, 파일명·매니페스트·`TranscriptSegment.speaker` 부터는 `str` 이다.
> BE 로 넘어가는 `speaker_id` 도 문자열이다.

#### 표시 이름 — 녹음이 끝난 뒤 guild 조회

녹음 중에는 이름을 모으지 않는다. `TrackWriterPool.close()` 는 **자리만 만들고 uid 를 그대로 넣어 둔다**:

```python
# capture/track_writer.py :: close()
entries.append({"user_id": str(uid), "display_name": str(uid), ...})   # 값은 호출자가 채운다
```

`/stop` 핸들러가 Discord API 로 덮어쓴다:

```python
# capture/discord_adapter.py
guild = self.bot.get_guild(guild_id)
for e in entries:
    member = guild.get_member(int(e["user_id"])) if guild is not None else None
    if member is not None:
        e["display_name"] = member.display_name
```

- `member.display_name` 은 **서버 별명(nickname)이 있으면 별명, 없으면 글로벌 이름**이다.
  계정명(`member.name`)이 아니다
- `intents.members = True` 가 필요하다 (`capture/discord_adapter.py` 에 주석까지 달려 있다)
- `guild.get_member()` 는 **캐시 조회**라, 멤버 캐시가 비었거나 intent 가 꺼져 있으면 `None` 이 나온다

#### 이름 조회가 실패하면 — 예외가 아니라 uid 로 폴백

네 군데에서 모두 uid 문자열이 이름 자리에 들어간다. 그래서 회의록에 이름 대신 숫자 ID 가 찍힐 수 있다.

| 지점 | 폴백 |
|---|---|
| `track_writer.py :: close()` | `"display_name": str(uid)` (초기값) |
| `discord_adapter.py` | `guild` 나 `member` 가 `None` 이면 덮어쓰기를 건너뜀 → uid 유지 |
| `stt/batch.py :: load_names()` | `sp.get("display_name") or str(sp.get("user_id"))` |
| `stt/batch.py :: discover()` | `names.get(uid, uid)` |

#### 추출기로 넘어오는 지점

```python
# capture/recorder.py
names = {str(e["user_id"]): e["display_name"] for e in manifest["speakers"]}
tasks = extractor(transcript, names)
```

매니페스트에서 dict 를 만들어 `speaker_names` 로 넘기고, 추출기 안에서는 단순 조회다
(`names.get(seg.speaker)`). 조회에 실패하면 `_numbered_lines()` 가 `?` 를 찍는다.

#### 왜 ID 가 신뢰할 수 있는 키인가

**ID 는 소리에서 직접 나오고, 이름은 사후 조회라 실패할 수 있다.** 게다가 `display_name` 은 서버
별명이라 **멤버가 별명을 바꾸면 값이 달라진다.** 그래서 프롬프트에는 이름을 넣어 LLM 이 읽게 하고,
BE 로는 ID 를 넘긴다 — 6장의 `first` 처리가 `speaker_id` 에 기대는 이유다.

> 골든셋에서는 이 ID 자리에 `"A"`, `"B"` 같은 합성 키를 쓰고 `speaker_names` 가
> `{"A": "유진", ...}` 로 들어간다. 구조는 같고 값만 가짜다.

---

## 3. 중간 단계 — 무엇이 어떻게 추출되는가

### (1) `extract/text.py :: split_sentences()` — 문장 쪼개기 [코드]

```python
_SENTENCE_RE = re.compile(r"[^.!?]+[.!?]?")
```

`.!?` 로 자른다. 발화(turn) 하나가 여러 문장이 될 수 있고, **문장 하나가 채점·추출의 기본 단위**다.

이때 **네 개의 배열을 같은 인덱스로 묶어** 만든다. `i` 번째 원소들이 한 세트다.

```python
sentences   = ["저는 로그인 API 붙였고요.", "이번 주 목요일까지 끝낼게요.", "하은님이 리뷰 부탁드려요."]
speakers    = ["도윤",                      "도윤",                        "유진"]   # 표시 이름 (프롬프트용)
speaker_ids = ["847",                       "847",                         "201"]    # 플랫폼 ID (BE 인계용)
seqs        = [1,                           1,                             2]        # 발화 순번
```

| i | seq | speaker_id | speaker | sentence |
|---|---|---|---|---|
| 0 | 1 | 847 | 도윤 | 저는 로그인 API 붙였고요. |
| 1 | **1** | 847 | 도윤 | 이번 주 목요일까지 끝낼게요. |
| 2 | 2 | 201 | 유진 | 하은님이 리뷰 부탁드려요. |

**`seq` 는 문장 번호가 아니라 발화(turn) 번호다.** 한 발화가 여러 문장으로 쪼개지면 같은 seq 를
공유한다 — 위에서 0번과 1번 문장이 둘 다 `seq=1` 이다. 그래서 배열 인덱스와 1:1 이 아니다.

<details>
<summary>인덱스가 순서대로인데 seq 가 왜 또 필요한가</summary>

순서를 나타내려는 게 아니라 **역추적 키**라서 필요하다.

- **배열 인덱스는 `extract_tasks()` 밖으로 나가지 않는다.** `ExtractedTask` 에 문장 인덱스 필드가 없다
- **출력이 희소하다.** 문장 115개에서 할일 34개만 나오므로, 출력 리스트의 위치로는 몇 번째 문장이었는지
  알 수 없다
- **`seq` 는 저장된 전사 파일(`transcript.jsonl`)을 가리킨다.** `stt/batch.py` 가 회의 전체를
  `start_ms` 순으로 정렬한 뒤 1부터 붙이는 값이라, PM 이 "이 할일의 근거 발화" 로 점프할 때 쓰는 키다
- **다른 단계가 이미 쓴다.** `JudgeFinding.seq` 가 같은 값을 "근거 추적용 안정 식별자" 로 정의한다
- **문장 분리 규칙이 바뀌어도 안 흔들린다.** `split_sentences` 의 정규식을 고치면 문장 인덱스는 전부
  밀리지만 seq 는 그대로다

</details>

### (2) `filter_relevant()` — 할일이 담긴 문장 고르기 [LLM 호출 1]

전체 문장에 번호를 붙여 LLM 에 주고, **할일이 담긴 번호만** 돌려받는다.

```
[0] 도윤: 저는 로그인 API 붙일게요.
[1] 유진: 점심 뭐 드세요?
[2] 유진: 하은님이 리뷰 부탁드려요.
```
→ `{"relevant_indices": [0, 2]}`

판단 기준은 `prompts.RELEVANCE_SYSTEM` 에 들어 있다(3원칙 + 애매한 경우 + 예시 7개).

**40문장씩 끊어서 묻는다** (`_RELEVANCE_CHUNK_SIZE = 40`).
한 번에 100문장 넘게 주면 애매한 문장("~하죠", "~기로 했어요")을 조용히 빠뜨린다 —
실측에서 recall 이 96% → 79% 로 떨어졌다. 근거: `decision_log/0009`.

### (3) `extract_structured()` — 세부 정보 뽑기 [LLM 호출 2]

고른 문장만 다시 번호와 함께 주고, 문장마다 아래를 채우게 한다.
프롬프트는 `prompts.extraction_system_prompt(today)` — **기준일이 프롬프트에 박힌다**(이게 빠지면 상대 날짜가 전부 틀린다).

LLM 응답 스키마 (`extract/llm.py :: ExtractionItem`, pydantic 으로 강제):

| 필드 | 무엇 |
|---|---|
| `index` | 몇 번 문장인지 |
| `evidence_span` | 근거가 되는 부분을 **원문 그대로 인용** |
| `reasoning` | 왜 이 담당자/마감으로 판단했는지 |
| `task_raw` | 할일 내용 |
| `assignee_type` | 담당자를 어떻게 지칭했는지 (아래 표) |
| `assignee_mention` | 담당자를 가리킨 표현 원문 ("하은님") |
| `assignee_resolved` | 대명사를 문맥으로 푼 실제 이름 ("그분" → "환") |
| `due_date` | LLM 이 계산한 `YYYY-MM-DD` |
| `due_raw` | 마감 표현 원문 ("이번 주 목요일까지") |
| `ambiguity_flag` | 추측이 필요했으면 true |

**순서가 의도적이다.** `evidence_span` → `reasoning` → 결론 순으로 채우게 해서
"결론부터 정하고 끼워맞추는" 것을 막는다.

담당자 타입 7종:

| 타입 | 예시 | 이후 처리 |
|---|---|---|
| `first` | "제가 하겠습니다" | BE — **AI 가 넘긴 `speaker_id` 로 푼다.** AI 는 이름을 안 채운다 |
| `second` | "이건 너가 하는 걸로" | AI 가 문맥으로 해소 시도 → 실패 시 PM |
| `thirdname` | "환 님이 맡아주세요" | BE — alias 테이블 조회 |
| `thirdpronoun` | "그분이 하시기로" | AI 가 문맥으로 해소 시도 → 실패 시 PM |
| `thirdrole` | "백엔드 리더가 담당" | BE — 매핑 기록, 대체로 PM 확인 |
| `all` | "다 같이", "각자" | BE — **참석자 전원**을 담당자로 채운다 |
| `none` | 담당자 언급 없음 | PM 확인 |

**관련 문장 20개씩 끊어서 묻는다** (`_CHUNK_SIZE = 20`).
게이트웨이가 완료 토큰을 6000 에서 하드캡하는데 항목당 ~180 토큰이라 30개가 천장이고,
넘기면 JSON 이 잘려 **그 회의의 할일이 전량 사라진다.** 근거: `decision_log/0009`.

> ⚠️ 추출 프롬프트에는 **고른 문장만** 들어간다. 전체 대화록이 아니다.
> "환님이 배포 담당이에요" 가 (2)에서 탈락하면 뒤의 "그분이 내일까지 해주세요" 를 풀 문맥이 없다
> (멘토 리뷰 R12, 미해결).

### (4) `_reconcile()` — 반복 호출 합치기 [코드]

`n_samples > 1` 이면 (3)을 여러 번 돌린다(self-consistency). 그 결과를 문장 번호로 모아서:

- **항목 존재 여부는 합집합** — 한 회차라도 잡았으면 채택한다 (놓치는 것보다 낫다)
- **값이 회차마다 다르면** 그 필드를 `inferred` 로 낮춘다 (담당자·마감 각각)

> ⚠️ 문장 번호를 할일의 유일한 키로 쓴다. "API 수정하고 테스트도 추가할게요" 처럼
> 한 문장에 할일이 둘이면 **하나로 줄어든다** (멘토 리뷰 R13, 미해결).

### (5) `dates.py :: sanity_check_due_date()` — 날짜 검증·보정 [코드]

날짜 **해석**은 LLM 이 하고(정규식 파서는 마감 표현 25개 중 48% 만 맞췄고 LLM 은 100%),
결과는 코드가 검증한다.

| 들어온 값 | 나가는 값 | 왜 |
|---|---|---|
| 형식 오류 | `None` | 파싱 실패 |
| **7일 이내 과거** | **+7일 (같은 요일)** | 일요일 회의의 "이번 주 목요일" = 다음 주 목요일. 7 을 더하면 요일이 보존된다 |
| 7일 넘는 과거 | `None` | 요일 이야기로 설명이 안 되는 과거 |
| 365일 넘는 미래 | `None` | 연도 오타 등 |
| 그 외 | 그대로 | |

날짜를 옮겼으면 호출부가 `넘긴 값 != 돌려받은 값` 으로 알아내 마감 상태를 `inferred` 로 낮춘다.

### (6) 상태 판정 + 조립 [코드]

필드마다 3단계 상태를 매긴다. **사용자에겐 정확도 % 대신 이 상태를 보여준다.**

| 상태 | 언제 | PM 이 할 일 |
|---|---|---|
| `certain` | 원문에 명시적 근거가 있음 | 바로 승인 |
| `inferred` | 문맥으로 유추했거나 반복 호출 시 답이 흔들림 | 근거 문장 확인 |
| `missing` | 그 필드가 발화에 없음 | 직접 입력 |

> `certain` 은 "모델이 맞았다"는 보증이 아니라 **"명시적 근거가 있다"**는 뜻이다.

담당자 상태(`_assignee_status`)의 판정 순서:

1. `none` → `missing`
2. 반복 호출에서 흔들렸거나 `ambiguity_flag` → `inferred`
3. `first` / `thirdname` / `all` → `certain`
   - 단 `thirdname` 은 **교차검증**: 정규식(`find_explicit_name`)이 같은 이름을 못 찾으면 `inferred` 로 낮춘다.
     LLM 만 주장하는 이름은 사람이 한 번 보게 한다
4. 나머지(`second` / `thirdpronoun` / `thirdrole`) → `inferred`

`confidence` 는 세 상태의 **최솟값**이다 (`certain=1.0, inferred=0.6, missing=0.3`).
내부 로그·정렬용이고 사용자에게 노출하지 않는다.

---

## 4. 출력 — 어떤 형식으로 나오는가

`shared/schemas.py :: ExtractedTask` 의 리스트.

```python
extract_tasks(transcript, client=..., model=..., today=..., speaker_names=...) -> list[ExtractedTask]
```

### JSON 형식 (실제 출력)

```json
[
  {
    "task": "리프레시 토큰 처리",
    "assignee_member_id": null,
    "due_date": "2026-09-10",
    "confidence": 1.0,
    "assignee_mention": null,
    "source_sentence": "이번 주 목요일까지 리프레시 토큰 처리",
    "method": "llm",
    "speaker_id": "847",
    "source_seq": 1,
    "assignee_type": "first",
    "assignee_resolved": null,
    "due_raw": "이번 주 목요일까지",
    "task_status": "certain",
    "assignee_status": "certain",
    "due_status": "certain"
  },
  {
    "task": "코드 리뷰",
    "assignee_member_id": null,
    "due_date": null,
    "confidence": 0.3,
    "assignee_mention": "하은님",
    "source_sentence": "하은님이 코드 리뷰 부탁드려요",
    "method": "llm",
    "speaker_id": "201",
    "source_seq": 2,
    "assignee_type": "thirdname",
    "assignee_resolved": null,
    "due_raw": null,
    "task_status": "certain",
    "assignee_status": "certain",
    "due_status": "missing"
  }
]
```

필드별 설명:

| 필드 | 무엇 | 주의 |
|---|---|---|
| `task` | 할일 내용 | |
| `assignee_member_id` | **항상 `null`** | 멤버 테이블을 AI 가 안 본다. BE 가 채운다 |
| `due_date` | 검증을 통과한 `YYYY-MM-DD` | 시각은 없다 (BE 의 `datetime` 전환 대기 중) |
| `confidence` | 세 상태의 최솟값 | 내부용 |
| `assignee_mention` | 원문 호칭 | `first`/`all`/`none` 이면 **코드가 지운다** |
| `source_sentence` | LLM 이 인용한 `evidence_span` | **부분 인용일 수 있어 키로 못 쓴다** |
| `speaker_id` | 이 발화를 한 사람의 플랫폼 ID | 표시 이름이 아니다 |
| `source_seq` | 발화 순번 | 근거 점프용 안정 식별자 |
| `assignee_type` | 7종 중 하나 | BE 의 처리 경로를 가른다 |
| `assignee_resolved` | 대명사를 푼 이름 | 못 풀면 `null` |
| `*_status` | `certain` / `inferred` / `missing` | 사용자에게 보여줄 값 |

### 파일로 떨어지는 곳

`capture/recorder.py :: extract_after_transcription()` 가
`transcripts/session_<ts>.tasks.json` 에 위 배열을 그대로 쓴다.

---

## 5. 골든셋 평가 — 어떻게 채점하는가

```bash
cd ai
python -m extract.eval_golden_set                        # 전체 채점
python -m extract.eval_golden_set -v                     # + 틀린 항목을 정답과 나란히
python -m extract.eval_golden_set -k long_meeting        # 특정 케이스만
python -m extract.eval_golden_set -k long_meeting --repeat 3   # 길이 3배로 늘려서
python -m extract.eval_golden_set --model gpt-5.6-terra --base-url $TERRA_BASE_URL   # 모델 비교
python -m extract.eval_golden_set --n-samples 3          # self-consistency
```

### 채점 방식

`golden_set/*.json` 에 **사람이 정답을 달아 둔 회의록**이 있다. 각 케이스마다:

1. `turns` 를 `split_sentences` 로 쪼갠다
2. 그 문장 목록이 `expected` 와 다르면 **즉시 에러** (정답 오타 방지)
3. 추출기를 돌려 예측을 얻는다
4. `match_predictions()` 가 예측을 정답 문장에 붙인다 — **근거 텍스트 포함관계**로 매칭
   (LLM 은 부분 인용을 하므로 양방향 포함을 허용한다). 한 정답 문장은 예측 **하나만** 흡수한다
5. 문장마다 정답(`is_task`)과 예측(붙었는지)을 비교한다

```
정답이 할일 + 예측 붙음  → TP (탐지)
정답이 할일 + 예측 없음  → FN (놓침)
정답이 잡담 + 예측 붙음  → FP (오탐)
정답이 잡담 + 예측 없음  → TN
어느 문장에도 못 붙은 예측 → FP (근거 없음)
```

마지막 줄이 중요하다. 예전에는 **그냥 버려서** 대화록에 없는 문장을 근거로 댄 할일이
precision 을 전혀 깎지 않았다 (멘토 리뷰 R14, 수정됨).

### 지표

| | 계산 | 무슨 질문 |
|---|---|---|
| **P** (Precision) | TP / (TP + FP) | 헛것을 뽑지 않았나 |
| **R** (Recall) | TP / (TP + FN) | 놓치지 않았나 |
| **F1** | P 와 R 의 조화평균 | 둘 다 좋은가 |

- **TN 은 P 에도 R 에도 안 들어간다.** 잡담 문장을 100개 더 넣어도 점수는 그대로다
- 아무것도 안 뽑으면 P=100%, 전부 다 뽑으면 R=100% 다. 그래서 한 숫자로 볼 땐 **조화**평균인 F1 을 본다
- **이 제품에선 R 이 더 중요하다.** P 가 낮으면 PM 이 지우는 수고가 늘지만,
  R 이 낮으면 회의에서 나온 할일이 **조용히 사라져서 아무도 모른다**

`타입 / 담당자 / 마감` 정확도는 **탐지에 성공한 문장에 한해서만** 잰다 —
탐지부터 틀린 문장의 필드 정확도는 의미가 없어 분모에서 뺀다.

### 출력 읽는 법

```
  case                     할일   탐지   놓침   오탐     P     R    F1       타입      담당자      마감
  long_meeting             34   32    2    1   97%   94%   96%  32/32    32/32    31/32

  평가한 케이스 17/17
  할일 83개 중 78개를 맞게 뽑았고(R= 94%), 뽑은 79개 중 78개가 정답이다(P= 99%). F1= 96%
```

비율만 보면 분모가 안 보인다 — 할일 3개짜리의 67% 와 100개짜리의 67% 는 무게가 다르다.
채점 실패 케이스가 있으면 `⚠ 채점 실패 N건` 이 함께 뜬다 (표본이 줄어든 걸 감추지 않기 위함).

### 케이스를 만들 때 지켜야 할 것

- **few-shot 예시와 골든셋 문장은 절대 겹치면 안 된다.** 시험 문제를 미리 보여주는 꼴이라 점수가 부풀려진다
- `expected` 에는 **할일이 아닌 문장까지 전부** 적는다. 그래야 오탐이 잡힌다
- `reference_date` 는 일부러 **고정**돼 있다(재현성). 실제 운영은 진짜 오늘을 쓴다 — 버그가 아니다
- `long_meeting` 은 기존 케이스 4개를 이어 붙인 **파생 케이스**다. 원본 gold 를 고치면 여기도 같이 고쳐야 한다

---

## 6. BE 와의 인계 — `first` 는 어떻게 처리되는가

### 지금 상태: **연결이 끊겨 있다**

`ExtractedTask` → BE 의 `ExtractionItemCreate` 로 바꿔 POST 하는 코드가 **아직 없다.**
`ai/` 에서 HTTP 를 쓰는 곳은 `stt/elice.py` 뿐이다. 양쪽 스키마만 정의돼 있고 사이가 비어 있다.

### `first`("제가 할게요") 의 약속

```
AI 쪽:
  assignee_type = "first"
  assignee_mention = None        ← 코드가 일부러 지운다
  speaker_id = "847"             ← 그 대신 "누가 말했나"를 넘긴다

BE 쪽 (backend/app/api/extractions.py):
  if raw_item.assignee_type == "first" and raw_item.evidence_speaker:
      target_alias = raw_item.evidence_speaker
  else:
      target_alias = raw_item.assignee_raw
  match = resolve_assignee(db, workspace_id, target_alias)
```

AI 가 이름을 비우는 이유: **BE 가 발화자를 이미 알고 있으니 중복 작업을 안 한다.**
그러려면 AI 가 "누가 말했나"를 넘겨야 하는데, 예전에는 그게 출력에 없었다(멘토 리뷰 R02).
지금은 `speaker_id` / `source_seq` 를 넘긴다.

### BE 가 판정을 내리는 방식

`resolve_assignee()` → `MatchResult(member_id, confidence, needs_check, ...)`
→ `decide_gate(confidence, needs_check)`:

| 조건 | 게이트 | 결과 |
|---|---|---|
| `confidence >= 0.8` 이고 `needs_check=False` | `AUTO` | 승인 없이 바로 Task 생성 |
| `confidence >= 0.8` 이고 `needs_check=True` | `REVIEW` | PM 확인 (미검증 별칭·중의성) |
| `confidence >= 0.5` | `REVIEW` | PM 확인 |
| 그 미만 | `HOLD` | 보류 |

### ⚠️ 아직 어긋나 있는 것 (합의 필요)

| | 문제 |
|---|---|
| **`evidence_speaker` 의 타입** | BE 는 이 값을 `MemberAlias.alias_text` 로 조회한다. AI 가 보낼 값은 Discord user ID 라 별칭으로 등록돼 있지 않으면 NOT_FOUND 다. `Member.discord_user_id` 컬럼이 이미 있으니 그쪽 조회 경로가 필요하다 |
| **`assignee_type` 어휘** | BE 스키마 설명은 `first / third / group / none`, AI 는 `first / second / thirdname / thirdpronoun / thirdrole / all / none`. 특히 `group` → `all` 로 바뀌었는데 BE 는 `"first"` 만 분기하므로 **`all` 은 전원으로 펼쳐지지 않고 PM 확인으로 간다** |
| **상태 3종이 계약에 없다** | `ExtractionItemCreate` 에 `task_status`/`assignee_status`/`due_status` 가 없다. `confidence` 실수값만 건너간다 |
| **마감에 시각이 없다** | `due_date` 가 `date` 라 "3시까지"의 시각이 잘린다. BE 의 `DueDateInfo.value` 를 `datetime` 으로 바꾸기로 했고 대기 중이다 |

---

## 7. 파일 지도

| 파일 | 역할 |
|---|---|
| `llm.py` | 파이프라인 본체. `extract_tasks()` 가 진입점 |
| `prompts.py` | LLM 프롬프트 두 개 (관련성 필터 / 구조화 추출) |
| `text.py` | `split_sentences()`, `find_explicit_name()` — 같은 입력이면 같은 결과가 보장돼야 해서 LLM 이 아니라 코드가 맡는다 |
| `dates.py` | `sanity_check_due_date()` — LLM 이 계산한 날짜를 검증·보정 |
| `eval_golden_set.py` | 골든셋 채점기 |
| `golden_set/*.json` | 정답이 달린 회의록 17케이스 |
| `fixtures.py` | 테스트용 `Transcript` 로더 |
| `TASK_CRITERIA.md` | **판단 기준의 원본** |
| `NEXT_STEPS.md` | 세션 인수인계 메모 (gitignore 됨) |

테스트:

```bash
python -m pytest tests/test_extract_llm.py    # 파이프라인 배선 (LLM 호출 없음, 가짜 client)
python -m pytest tests/test_eval_scoring.py   # 채점기 자체 (채점이 틀리면 모든 수치가 틀린다)
```

---

## 8. 알려진 미해결 (멘토 리뷰)

| ID | 심각도 | 내용 |
|---|---|---|
| **R13** | HIGH | `_reconcile()` 이 문장 번호를 할일의 유일 키로 써서 한 문장의 두 할일이 하나로 줄어든다. 골든셋 포맷도 문장당 라벨 1개라 **고쳐도 점수로 확인이 안 된다** |
| **R12** | MED | 추출에 주변 문맥이 없어 청크 경계를 넘는 지시대명사를 못 푼다 |
| **R11** | HIGH | `build_extractor()` 가 `today=` 를 안 넘겨 상대 날짜의 기준이 **회의 날짜가 아니라 실행일**이 된다 (`capture/recorder.py`) |
| R02 잔여 | HIGH | 6장의 계약 불일치 4건 |
