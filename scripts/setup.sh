#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
#  RecallOS — One-shot local dev setup
#  Usage:  curl -fsSL <gist-url>/setup.sh | bash
#    or:   bash scripts/setup.sh            (from repo root)
# ──────────────────────────────────────────────────────────────

REPO_URL="https://github.com/Aadit032/RecallOS.git"
REPO_NAME="RecallOS"

BOLD="\033[1m"
DIM="\033[2m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
CYAN="\033[36m"
RESET="\033[0m"

ok()   { printf "${GREEN}✓${RESET} %s\n" "$*"; }
warn() { printf "${YELLOW}⚠${RESET} %s\n" "$*"; }
fail() { printf "${RED}✗${RESET} %s\n" "$*"; exit 1; }
step() { printf "\n${CYAN}▸${RESET} ${BOLD}%s${RESET}\n" "$*"; }

# ── Docker container names & ports ───────────────────────────
PG_NAME="recallos-postgres"
REDIS_NAME="recallos-redis"
MINIO_NAME="recallos-minio"
QDRANT_NAME="recallos-qdrant"

PG_PORT=5432
REDIS_PORT=6379
MINIO_API=9000
MINIO_CONSOLE=9001
QDRANT_HTTP=6333
QDRANT_GRPC=6334

# ── Pre-flight: Docker ──────────────────────────────────────
step "Checking Docker"
command -v docker >/dev/null 2>&1 || fail "Docker is not installed. https://docs.docker.com/get-docker/"

# ── Helper: start a container if not already running ─────────
ensure_container() {
  local name="$1"; shift
  if docker ps --format '{{.Names}}' | grep -q "^${name}$"; then
    ok "${name} is already running"
  elif docker ps -a --format '{{.Names}}' | grep -q "^${name}$"; then
    docker start "$name" >/dev/null
    ok "Started existing container ${name}"
  else
    docker run -d "$@" >/dev/null
    ok "Created and started ${name}"
  fi
}

# ── 1. Postgres ─────────────────────────────────────────────
step "Starting PostgreSQL 16"
ensure_container "$PG_NAME" \
  -p "${PG_PORT}:5432" \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=recallOs \
  --restart unless-stopped \
  postgres:16-alpine

# ── 2. Redis ────────────────────────────────────────────────
step "Starting Redis 7"
ensure_container "$REDIS_NAME" \
  -p "${REDIS_PORT}:6379" \
  --restart unless-stopped \
  redis:7-alpine

# ── 3. MinIO ────────────────────────────────────────────────
step "Starting MinIO"
ensure_container "$MINIO_NAME" \
  -p "${MINIO_API}:9000" \
  -p "${MINIO_CONSOLE}:9001" \
  -e MINIO_ROOT_USER=admin \
  -e MINIO_ROOT_PASSWORD=password123 \
  --restart unless-stopped \
  minio/minio server /data --console-address ":9001"
ok "MinIO console → http://localhost:${MINIO_CONSOLE}  (admin / password123)"

# ── 4. Qdrant ───────────────────────────────────────────────
step "Starting Qdrant"
ensure_container "$QDRANT_NAME" \
  -p "${QDRANT_HTTP}:6333" \
  -p "${QDRANT_GRPC}:6334" \
  --restart unless-stopped \
  qdrant/qdrant

# ── 5. Bun ──────────────────────────────────────────────────
step "Checking Bun"
if command -v bun >/dev/null 2>&1; then
  ok "Bun $(bun --version) found"
else
  warn "Bun not found — installing..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${HOME}/.bun"
  export PATH="${BUN_INSTALL}/bin:${PATH}"
  ok "Bun $(bun --version) installed"
fi

# ── 6. ffmpeg (optional — needed for video/scene workers) ───
step "Checking ffmpeg"
if command -v ffmpeg >/dev/null 2>&1; then
  ok "ffmpeg found"
else
  warn "ffmpeg not found — video & scene workers will be disabled"
  warn "Install with:  sudo apt install ffmpeg  |  brew install ffmpeg"
fi

# ── 7. Clone or detect repo ─────────────────────────────────
step "Locating RecallOS source"
REPO_ROOT=""

# If run from repo root (bash scripts/setup.sh), detect it
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/../packages/db/prisma/schema.prisma" ]; then
  REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
  ok "Found existing repo at ${REPO_ROOT}"
else
  # Running via curl — clone into ~/RecallOS
  REPO_ROOT="${HOME}/${REPO_NAME}"
  if [ -d "${REPO_ROOT}/.git" ]; then
    ok "Repo already cloned at ${REPO_ROOT} — pulling latest"
    git -C "$REPO_ROOT" pull --ff-only 2>/dev/null || true
  else
    step "Cloning RecallOS"
    git clone "$REPO_URL" "$REPO_ROOT"
    ok "Cloned to ${REPO_ROOT}"
  fi
fi
cd "$REPO_ROOT"

# ── 8. Environment file ─────────────────────────────────────
step "Setting up .env"
if [ -f .env ]; then
  ok ".env already exists — skipping"
else
  cp .env.example .env
  ok "Copied .env.example → .env"
  warn "Edit .env and add your API keys:  LLAMA_CLOUD_API_KEY, OPENROUTER_API_KEY, EXA_API_KEY"
fi

# ── 9. Install dependencies ─────────────────────────────────
step "Installing dependencies"
bun install --frozen-lockfile 2>/dev/null || bun install
ok "Dependencies installed"

# ── 10. Prisma migrate ─────────────────────────────────────
step "Running Prisma migrations"
cd packages/db
bunx prisma generate
bunx prisma migrate dev --name init 2>/dev/null || bunx prisma db push
ok "Database schema applied"
cd "$REPO_ROOT"

# ── Done ─────────────────────────────────────────────────────
printf "\n"
printf "${GREEN}${BOLD}══════════════════════════════════════════════════${RESET}\n"
printf "${GREEN}${BOLD}  RecallOS is ready!${RESET}\n"
printf "${GREEN}${BOLD}══════════════════════════════════════════════════${RESET}\n"
printf "\n"
printf "  ${BOLD}Services running:${RESET}\n"
printf "    Postgres   →  localhost:${PG_PORT}   (postgres / password)\n"
printf "    Redis      →  localhost:${REDIS_PORT}\n"
printf "    MinIO API  →  http://localhost:${MINIO_API}\n"
printf "    MinIO      →  http://localhost:${MINIO_CONSOLE}  (admin / password123)\n"
printf "    Qdrant     →  http://localhost:${QDRANT_HTTP}\n"
printf "\n"
printf "  ${BOLD}Next steps:${RESET}\n"
printf "    1. ${DIM}Edit .env${RESET} and fill in your API keys\n"
printf "    2. ${DIM}bun run dev${RESET}          — start web + backend + workers\n"
printf "\n"
printf "  ${DIM}Web → http://localhost:3001${RESET}\n"
printf "  ${DIM}API → http://localhost:3000/api/v1${RESET}\n"
printf "\n"
