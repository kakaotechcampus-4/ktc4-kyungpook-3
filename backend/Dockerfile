# 운영용 백엔드 이미지. 실행은 docker-compose.prod.yml 참고.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini .
COPY migrations ./migrations
COPY app ./app

RUN useradd --create-home --uid 1000 mm
USER mm

EXPOSE 8000

# 마이그레이션을 먼저 올린 뒤 서버를 띄운다.
# --workers 1: Notion/임베딩 워커가 프로세스마다 하나씩 뜨므로 프로세스는 하나여야 한다(README Notion 연동 참고).
# --proxy-headers: 리버스 프록시가 넘긴 X-Forwarded-* 를 쓴다. 어떤 주소를 믿을지는 FORWARDED_ALLOW_IPS로 정한다.
# 셸 스크립트로 빼지 않은 이유: 윈도에서 CRLF로 체크아웃되면 컨테이너 안에서 실행이 깨진다.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 --proxy-headers"]
