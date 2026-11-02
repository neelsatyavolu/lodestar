# Lodestar fares service: fli (Google Flights) + headless Chromium for seller pages.
# Slim Python plus only Chromium's headless shell keeps the image small for push and cold start.
FROM python:3.12-slim-bookworm

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Three separate layers: Cloudflare's registry times out committing one ~900 MB layer.
COPY requirements.txt .
RUN pip install -r requirements.txt
RUN python -m playwright install-deps chromium && rm -rf /var/lib/apt/lists/*
RUN python -m playwright install --only-shell chromium

COPY lodestar_fares ./lodestar_fares

RUN useradd --create-home fares
USER fares

EXPOSE 8080
CMD ["uvicorn", "lodestar_fares.app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
