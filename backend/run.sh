#!/usr/bin/env bash
set -e
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
