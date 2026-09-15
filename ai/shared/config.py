"""환경변수 로딩 + 실행 설정. python-dotenv 없이 .env 를 직접 읽습니다."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path

AI_ROOT = Path(__file__).resolve().parent.parent  # ai/ 자체 (독립 프로젝트 루트). 진짜 모노레포 루트는 그 부모.
RECORDINGS_DIR = AI_ROOT / "recordings"
TRANSCRIPTS_DIR = AI_ROOT / "transcripts"
FIXTURES_DIR = AI_ROOT / "fixtures"
DATA_DIR = AI_ROOT / "data"
RUNS_DIR = AI_ROOT / "runs"


def load_env(path: Path | None = None) -> None:
    """`.env` 를 os.environ 에 넣습니다 (이미 있는 키는 유지)."""
    path = path or AI_ROOT / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_env()


def env(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()


def today() -> date:
    """상대 날짜 해석 기준일. PM_AGENT_TODAY(YYYY-MM-DD) 가 있으면 그 날로 고정."""
    raw = env("PM_AGENT_TODAY")
    if raw:
        return date.fromisoformat(raw)
    return date.today()


@dataclass(frozen=True)
class Settings:
    discord_bot_token: str = env("DISCORD_BOT_TOKEN")
    discord_channel_id: str = env("DISCORD_CHANNEL_ID")
    discord_guild_id: str = env("DISCORD_GUILD_ID")
    # LLM 접속 정보. 공급자를 갈아끼울 수 있게 이름을 중립적으로 둔다 — 실제로 Gemini(무료 티어)에서
    # Claude Sonnet 5 로 한 번 갈아탔고, 둘 다 Elice MLAPI(OpenAI 호환 게이트웨이)를 통해 쓴다.
    # 구 변수명(GEMINI_*)도 계속 읽는다 — 팀원 .env 를 한꺼번에 바꾸게 만들지 않기 위함.
    llm_api_key: str = env("LLM_API_KEY") or env("GEMINI_API_KEY")
    llm_model: str = env("LLM_MODEL") or env("GEMINI_MODEL", "claude-sonnet-5")
    llm_base_url: str = env("LLM_BASE_URL") or env("GEMINI_BASE_URL")
    notion_api_key: str = env("NOTION_API_KEY")
    notion_database_id: str = env("NOTION_DATABASE_ID")
    llm_mode: str = env("PM_AGENT_LLM")  # "" | off | on


def settings() -> Settings:
    return Settings()
