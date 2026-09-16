#!/usr/bin/env bash
# Gera JWT_SECRET e APP_ENCRYPTION_KEY no .env caso ainda estejam com o valor padrão.
set -euo pipefail
ENV_FILE="${1:-.env}"
[ -f "$ENV_FILE" ] || { echo "Arquivo $ENV_FILE não encontrado. Rode: cp .env.example .env"; exit 1; }

replace() { # chave valor
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    python3 - "$ENV_FILE" "$key" "$value" <<'PY'
import sys
path, key, value = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(path).read().splitlines(True)
out = []
for line in lines:
    out.append(f"{key}={value}\n" if line.startswith(key + "=") else line)
open(path, "w").writelines(out)
PY
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

if grep -q '^JWT_SECRET=troque' "$ENV_FILE"; then
  replace JWT_SECRET "$(openssl rand -hex 48)"
  echo "JWT_SECRET gerado."
fi
if grep -q '^APP_ENCRYPTION_KEY=Y2hhbmdl' "$ENV_FILE"; then
  replace APP_ENCRYPTION_KEY "$(openssl rand -base64 32)"
  echo "APP_ENCRYPTION_KEY gerado."
fi
if grep -q '^POSTGRES_PASSWORD=troque' "$ENV_FILE"; then
  PW="$(openssl rand -hex 16)"
  replace POSTGRES_PASSWORD "$PW"
  USER_NAME="$(grep '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2)"
  DB_NAME="$(grep '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2)"
  replace DATABASE_URL "postgres://${USER_NAME}:${PW}@postgres:5432/${DB_NAME}"
  echo "POSTGRES_PASSWORD e DATABASE_URL gerados."
fi
echo "Segredos prontos em $ENV_FILE"
