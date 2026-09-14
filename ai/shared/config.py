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
    gemini_api_key: str = env("GEMINI_API_KEY")
    gemini_model: str = env("GEMINI_MODEL", "gemini-2.5-flash-lite")
    # 팀에서 Google 키를 직접 안 쓰고 Elice MLAPI 같은 OpenAI 호환 프록시로 Gemini 를 쓰는 경우 채움.
    # 비어 있으면(기본) openai 클라이언트가 OpenAI 공식 엔드포인트를 그대로 쓰게 되므로, 이 프록시를
    # 쓸 거면 반드시 채워야 함.
    gemini_base_url: str = env("GEMINI_BASE_URL")
    notion_api_key: str = env("NOTION_API_KEY")
    notion_database_id: str = env("NOTION_DATABASE_ID")
    llm_mode: str = env("PM_AGENT_LLM")  # "" | off | gemini


def settings() -> Settings:
    return Settings()
