# Portable image — works on Fly.io, Koyeb, Railway, a VPS, or Render's Docker
# runtime. Render's native Python runtime does not need this file; render.yaml
# covers that path.
#
#   docker build -t shopkit .
#   docker run -p 8000:8000 -e SECRET_KEY=... -e DATABASE_URL=... shopkit

# --- stage 1: build the React storefront -----------------------------------
# The repo already carries a built copy of frontend/store, but building here
# means a container image can never ship assets older than the source.
FROM node:22-slim AS storefront
WORKDIR /build
COPY storefront/package.json storefront/package-lock.json* storefront/
RUN cd storefront && npm ci --no-audit --no-fund
COPY storefront/ storefront/
COPY frontend/assets/css/ frontend/assets/css/
RUN cd storefront && npm run build


# --- stage 2: the app ------------------------------------------------------
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Requirements first, so a code change does not reinstall every dependency.
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# The app serves the frontend itself, so both folders go in.
COPY backend/ backend/
COPY frontend/ frontend/
# The freshly built storefront replaces whatever was committed.
COPY --from=storefront /build/frontend/store/ frontend/store/

# Run as a non-root user. The media folder has to be writable by it.
RUN useradd --create-home --uid 1000 shopkit \
    && mkdir -p backend/media \
    && chown -R shopkit:shopkit /app
USER shopkit

WORKDIR /app/backend
EXPOSE 8000

# Most hosts inject $PORT; fall back to 8000 when nothing is set.
CMD ["sh", "-c", "gunicorn app.main:app \
  --worker-class uvicorn.workers.UvicornWorker \
  --workers 2 --bind 0.0.0.0:${PORT:-8000} --timeout 60"]
