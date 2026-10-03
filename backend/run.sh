#!/usr/bin/env bash
set -e
# .env가 있으면 alembic과 uvicorn이 같은 값을 보도록 환경변수로 올린다(윈도 줄바꿈은 지운다).
if [ -f .env ]; then
  set -a
  . <(tr -d '\r' < .env)
  set +a
fi
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
