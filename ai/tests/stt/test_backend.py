import re
from types import SimpleNamespace

import numpy as np
import pytest
import requests

from stt.backend import SttError, SttResult, Word

SAMPLES = np.zeros(16_000, dtype=np.float32)
URL = "https://mlapi.example/abc"   # 가짜 엔드포인트. 실제 id 는 설정으로만 받는다


def _response(payload):
    """requests.Response 대역. transcribe 는 status_code 와 json() 만 본다."""
    return lambda *a, **k: SimpleNamespace(status_code=200, json=lambda: payload)


def test_result_joins_words_when_text_missing():
    r = SttResult.from_words([Word("안녕", 0.0, 0.4), Word("하세요", 0.4, 0.9)])
    assert r.text == "안녕 하세요"


def test_result_keeps_explicit_text():
    r = SttResult(text="안녕하세요", words=[])
    assert r.text == "안녕하세요"


def test_elice_requires_key(monkeypatch):
    from stt.elice import EliceStt

    monkeypatch.delenv("ELICE_API_KEY", raising=False)
    monkeypatch.setenv("ELICE_STT_BASE_URL", URL)
    monkeypatch.setattr(
        requests, "post", lambda *a, **k: pytest.fail("키가 없으면 요청을 보내면 안 된다")
    )
    with pytest.raises(SttError):
        EliceStt().transcribe(np.zeros(16_000, dtype=np.float32), 16_000)


def test_elice_requires_base_url(monkeypatch):
    """엔드포인트 주소는 설정으로 받는다. .env.example 이 빈 값으로 두니 빈 문자열도 없는 것으로 본다."""
    from stt.elice import EliceStt

    monkeypatch.setenv("ELICE_API_KEY", "test-key")
    monkeypatch.setenv("ELICE_STT_BASE_URL", "")
    monkeypatch.setattr(
        requests, "post", lambda *a, **k: pytest.fail("주소가 없으면 요청을 보내면 안 된다")
    )
    with pytest.raises(SttError) as e:
        EliceStt().transcribe(SAMPLES, 16_000)
    assert "ELICE_STT_BASE_URL" in str(e.value)


def _form_fields(url, kwargs):
    """requests 가 실제로 만드는 multipart 본문에서 파일이 아닌 필드를 (이름, 값) 순서대로 뽑는다."""
    body = requests.Request("POST", url, files=kwargs["files"], data=kwargs["data"]).prepare().body
    return [(n.decode(), v.decode()) for n, v in re.findall(rb'name="([^"]+)"\r\n\r\n(.*?)\r\n', body)]


def _capture_post(monkeypatch, payload):
    seen = {}

    def post(url, **kwargs):
        seen.update(url=url, kwargs=kwargs)
        return SimpleNamespace(status_code=200, json=lambda: payload)

    monkeypatch.setattr(requests, "post", post)
    return seen


def test_elice_posts_verbose_json_with_word_and_segment_granularities(monkeypatch):
    """vLLM 엔드포인트는 OpenAI 형식이다. 끝의 / 는 떼고, granularity 는 폼 필드를 두 번 보낸다."""
    from stt.elice import EliceStt

    monkeypatch.setenv("ELICE_API_KEY", "test-key")
    monkeypatch.setenv("ELICE_STT_BASE_URL", URL + "/")
    seen = _capture_post(monkeypatch, {"text": " 안녕", "segments": [], "words": None})
    EliceStt().transcribe(SAMPLES, 16_000)

    assert seen["url"] == "https://mlapi.example/abc/v1/audio/transcriptions"
    assert seen["kwargs"]["headers"]["Authorization"] == "Bearer test-key"
    assert _form_fields(seen["url"], seen["kwargs"]) == [
        ("model", "openai/whisper-large-v3"),
        ("language", "ko"),
        ("response_format", "verbose_json"),
        ("timestamp_granularities[]", "word"),
        ("timestamp_granularities[]", "segment"),
    ]


def test_elice_without_word_timestamps_asks_only_segments(monkeypatch):
    from stt.elice import EliceStt

    monkeypatch.setenv("ELICE_API_KEY", "test-key")
    monkeypatch.setenv("ELICE_STT_BASE_URL", URL)
    seen = _capture_post(monkeypatch, {"text": " 안녕", "segments": [], "words": None})
    EliceStt(word_timestamps=False).transcribe(SAMPLES, 16_000)

    grans = [v for n, v in _form_fields(seen["url"], seen["kwargs"]) if n == "timestamp_granularities[]"]
    assert grans == ["segment"]


def test_elice_wraps_request_failure(monkeypatch):
    """requests 예외는 OSError 계열이라 감싸지 않으면 호출자의 except SttError 를 지나친다."""
    from stt.elice import EliceStt

    monkeypatch.setenv("ELICE_API_KEY", "test-key")
    monkeypatch.setenv("ELICE_STT_BASE_URL", URL)

    def boom(*a, **k):
        raise requests.ConnectionError("연결 실패")

    monkeypatch.setattr(requests, "post", boom)
    with pytest.raises(SttError) as e:
        EliceStt().transcribe(SAMPLES, 16_000)
    assert "ConnectionError" in str(e.value)


def test_elice_wraps_non_json_body(monkeypatch):
    """200 인데 본문이 JSON 이 아니면 r.json() 이 ValueError 를 던진다."""
    from stt.elice import EliceStt

    monkeypatch.setenv("ELICE_API_KEY", "test-key")
    monkeypatch.setenv("ELICE_STT_BASE_URL", URL)

    def not_json():
        raise ValueError("Expecting value: line 1 column 1 (char 0)")

    monkeypatch.setattr(
        requests, "post", lambda *a, **k: SimpleNamespace(status_code=200, json=not_json)
    )
    with pytest.raises(SttError) as e:
        EliceStt().transcribe(SAMPLES, 16_000)
    assert "JSON" in str(e.value)


def test_elice_caps_error_body_and_keeps_key_out(monkeypatch):
    """200 이 아니면 서버 본문을 200자에서 자른다. 키는 메시지에 싣지 않는다."""
    from stt.elice import EliceStt

    monkeypatch.setenv("ELICE_API_KEY", "test-key")
    monkeypatch.setenv("ELICE_STT_BASE_URL", URL)
    monkeypatch.setattr(
        requests, "post", lambda *a, **k: SimpleNamespace(status_code=401, text="실" * 500)
    )
    with pytest.raises(SttError) as e:
        EliceStt().transcribe(SAMPLES, 16_000)
    assert str(e.value) == "STT 401: " + "실" * 200
    assert "test-key" not in str(e.value)


@pytest.mark.parametrize("body", [
    '{"error": "bad header: Bearer sk-fake-must-not-leak"}',
    "a" * 190 + "sk-fake-must-not-leak",              # 200자 경계에 걸친 키도 앞부분이 남지 않는다
])
def test_elice_masks_the_key_when_the_server_echoes_it(monkeypatch, body):
    """서버가 헤더를 본문에 되돌려 주면 메시지에 키가 실린다. 메시지는 로그와 manifest 의 failed_units 로 간다."""
    from stt.elice import EliceStt

    monkeypatch.setenv("ELICE_API_KEY", "sk-fake-must-not-leak")
    monkeypatch.setenv("ELICE_STT_BASE_URL", URL)
    monkeypatch.setattr(requests, "post", lambda *a, **k: SimpleNamespace(status_code=401, text=body))
    with pytest.raises(SttError) as e:
        EliceStt().transcribe(SAMPLES, 16_000)
    assert "sk-fake" not in str(e.value) and str(e.value).startswith("STT 401: ")


def test_elice_refuses_a_plain_http_address(monkeypatch):
    """http 주소면 Bearer 키가 평문으로 나간다. 보내기 전에 막고, 주소는 메시지에 싣지 않는다."""
    from stt.elice import EliceStt

    monkeypatch.setenv("ELICE_API_KEY", "test-key")
    monkeypatch.setenv("ELICE_STT_BASE_URL", "http://mlapi.example/abc")
    monkeypatch.setattr(requests, "post", lambda *a, **k: pytest.fail("http 주소로 키를 보내면 안 된다"))
    with pytest.raises(SttError) as e:
        EliceStt().transcribe(SAMPLES, 16_000)
    assert "https" in str(e.value) and "mlapi.example" not in str(e.value)


def test_elice_turns_string_word_times_into_floats(monkeypatch):
    """문자열 시각을 그대로 두면 batch 가 transcribe 밖에서 더하다 TypeError 로 회의 전체가 멈춘다."""
    from stt.elice import EliceStt

    monkeypatch.setenv("ELICE_API_KEY", "test-key")
    monkeypatch.setenv("ELICE_STT_BASE_URL", URL)
    monkeypatch.setattr(requests, "post", _response({"text": " 안녕", "words": [{"word": " 안녕", "start": "0.0",
                                                                                "end": "0.4"}]}))
    r = EliceStt().transcribe(SAMPLES, 16_000)
    assert [(w.start_s, w.end_s) for w in r.words] == [(0.0, 0.4)]
    assert all(type(t) is float for w in r.words for t in (w.start_s, w.end_s))


@pytest.mark.parametrize("word", [
    {"word": " 안녕", "start": "x", "end": 0.4},
    {"word": " 안녕", "end": 0.4},
    {"word": " 안녕", "start": None, "end": 0.4},
])
def test_elice_fails_the_call_when_word_times_are_unreadable(monkeypatch, word):
    """못 읽는 시각은 SttError 다. 호출 하나의 실패로만 남고 회의는 계속 간다."""
    from stt.elice import EliceStt

    monkeypatch.setenv("ELICE_API_KEY", "test-key")
    monkeypatch.setenv("ELICE_STT_BASE_URL", URL)
    monkeypatch.setattr(requests, "post", _response({"text": " 안녕", "words": [word]}))
    with pytest.raises(SttError):
        EliceStt().transcribe(SAMPLES, 16_000)


def test_elice_rejects_json_without_text(monkeypatch):
    """200 에 JSON 이지만 text 가 없으면 빈 줄로 넘기지 않고 실패로 올린다."""
    from stt.elice import EliceStt

    monkeypatch.setenv("ELICE_API_KEY", "test-key")
    monkeypatch.setenv("ELICE_STT_BASE_URL", URL)
    monkeypatch.setattr(requests, "post", _response({"error": {"message": "x" * 500}}))
    with pytest.raises(SttError) as e:
        EliceStt().transcribe(SAMPLES, 16_000)
    assert len(str(e.value)) <= 200


def test_elice_parses_verbose_json_without_words(monkeypatch):
    """실측 응답 모양. words 는 null 이고 segments 는 입력 전체를 덮는 하나라 단어 시각으로 쓰지 않는다."""
    from stt.elice import EliceStt

    monkeypatch.setenv("ELICE_API_KEY", "test-key")
    monkeypatch.setenv("ELICE_STT_BASE_URL", URL)
    monkeypatch.setattr(
        requests,
        "post",
        _response(
            {
                "duration": "6.0",
                "language": "ko",
                "text": " 안녕하세요. 반갑습니다.",
                "segments": [
                    {"id": 0, "start": 0.0, "end": 6.0, "text": " 안녕하세요. 반갑습니다.", "no_speech_prob": None}
                ],
                "words": None,
            }
        ),
    )
    r = EliceStt().transcribe(SAMPLES, 16_000)
    assert r.text == "안녕하세요. 반갑습니다."
    assert r.words == []


def test_elice_parses_words_when_present(monkeypatch):
    """words 가 오면 담는다. OpenAI 는 word, 다른 구현은 text 를 쓴다."""
    from stt.elice import EliceStt

    monkeypatch.setenv("ELICE_API_KEY", "test-key")
    monkeypatch.setenv("ELICE_STT_BASE_URL", URL)
    monkeypatch.setattr(
        requests,
        "post",
        _response(
            {
                "text": " 안녕 하세요",
                "words": [
                    {"word": " 안녕", "start": 0.0, "end": 0.4},
                    {"text": " 하세요", "start": 0.4, "end": 0.9},
                ],
            }
        ),
    )
    r = EliceStt().transcribe(SAMPLES, 16_000)
    assert r.text == "안녕 하세요"
    assert [(w.text, w.start_s, w.end_s) for w in r.words] == [("안녕", 0.0, 0.4), ("하세요", 0.4, 0.9)]


def test_local_transcribe_collects_words(monkeypatch):
    """세그먼트 텍스트를 잇고 단어를 공백 없이 모은다. words 가 없는 세그먼트도 그냥 지나간다."""
    from stt.local import LocalStt

    seg = SimpleNamespace(
        text=" 안녕하세요",
        words=[
            SimpleNamespace(word=" 안녕", start=0.0, end=0.5),
            SimpleNamespace(word="하세요", start=0.5, end=0.9),
        ],
    )
    silent = SimpleNamespace(text="  ", words=None)
    fake_model = SimpleNamespace(transcribe=lambda *a, **k: (iter([seg, silent]), None))
    monkeypatch.setattr(LocalStt, "_load", lambda self: fake_model)

    r = LocalStt().transcribe(SAMPLES, 16_000)
    assert r.text == "안녕하세요"
    assert [(w.text, w.start_s, w.end_s) for w in r.words] == [
        ("안녕", 0.0, 0.5),
        ("하세요", 0.5, 0.9),
    ]


def test_elice_timeout_grows_with_audio_length():
    """고정 30초로는 트랙 통째 호출이 전부 잘렸다. 길이에 비례해 기다린다."""
    from stt.elice import EliceStt

    be = EliceStt()
    assert be.timeout_for(1.0) == 30.6
    assert be.timeout_for(28.0) == 30 + 0.6 * 28
    assert be.timeout_for(147.0) > 100


# ── 이름 힌트(#195). 회의마다 팀 멤버 이름을 프롬프트로 싣는다 ─────────────────────────────

def test_elice_sends_the_prompt_when_given(monkeypatch):
    from stt.elice import EliceStt

    monkeypatch.setenv("ELICE_API_KEY", "test-key")
    monkeypatch.setenv("ELICE_STT_BASE_URL", URL)
    seen = _capture_post(monkeypatch, {"text": " 안녕", "segments": [], "words": None})
    EliceStt().transcribe(SAMPLES, 16_000, prompt="동우님, 재환님.")
    assert ("prompt", "동우님, 재환님.") in _form_fields(seen["url"], seen["kwargs"])


def test_prompted_backend_passes_the_prompt_and_keeps_the_inner_attributes():
    from stt.backend import Prompted

    class Inner:
        name = "elice/whisper-large-v3"
        reclip_unmapped = False

        def __init__(self):
            self.prompts = []

        def transcribe(self, samples, sample_rate, prompt=None):
            self.prompts.append(prompt)
            return SttResult(text="안녕", words=[])

    inner = Inner()
    b = Prompted(inner, "동우님.")
    assert b.transcribe(SAMPLES, 16_000).text == "안녕" and inner.prompts == ["동우님."]
    assert b.name == "elice/whisper-large-v3" and b.reclip_unmapped is False


def test_name_prompt_dedupes_skips_blanks_and_caps_the_list():
    from stt.backend import NAME_PROMPT_MAX, name_prompt

    assert name_prompt(["동우", " 재환 ", "동우", "", "  "]) == "동우님, 재환님."
    assert name_prompt([]) is None
    many = [f"사람{i}" for i in range(NAME_PROMPT_MAX + 5)]
    assert name_prompt(many).count("님") == NAME_PROMPT_MAX


def test_name_forms_put_the_called_name_with_and_without_nim_and_the_full_name():
    """존칭 없이 부르는 회의도 있어 세 꼴을 다 넣는다. 9/29·10/2 이름 자리가 "동우님" 꼴 4/6, 세 꼴 5/6 이었다(#195).

    성을 붙인 꼴만 넣으면 9/29 이름 자리가 1/4 라 부르는 이름이 꼭 들어가야 한다.
    """
    from stt.backend import name_forms
    assert name_forms("유재환") == ["재환님", "재환", "유재환"]
    assert name_forms(" 김동우 ") == ["동우님", "동우", "김동우"]
    assert name_forms("김환") == ["김환님", "김환"]           # 두 글자는 성인지 이름인지 알 수 없어 떼지 않는다
    assert name_forms("남궁민수") == ["남궁민수님", "남궁민수"]
    assert name_forms("geocangdongu5251") == []              # 아이디 꼴은 들리는 소리와 달라 힌트가 되지 않는다
    assert name_forms("동우🔥") == []
    assert name_forms("") == []


def test_hint_prompt_groups_forms_per_person_dedupes_and_caps_people():
    from stt.backend import HINT_PEOPLE_MAX, hint_prompt
    assert hint_prompt(["유재환", "geocangdongu5251", "김환", "유재환"]) == "재환님, 재환, 유재환, 김환님, 김환."
    assert hint_prompt(["geocangdongu5251"]) is None
    assert hint_prompt([]) is None
    people = [f"김{chr(0xAC00 + i)}{chr(0xAC00 + i)}" for i in range(HINT_PEOPLE_MAX + 3)]
    assert hint_prompt(people).count("님") == HINT_PEOPLE_MAX
