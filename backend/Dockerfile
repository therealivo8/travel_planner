FROM python:3.12-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Copy dependency files first for layer caching
COPY pyproject.toml uv.lock* ./

# Install production dependencies only
RUN uv sync --frozen --no-dev

# Copy application code
COPY . .

# Railway injects $PORT; fall back to 8000 for local docker builds
ENV PORT=8000

# Run migrations then start the server (railway.toml overrides this for Railway)
CMD uv run alembic upgrade head && \
    uv run uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
