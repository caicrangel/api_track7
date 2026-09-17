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
  replace POSTGRES_PASSWORD "$(openssl rand -hex 16)"
  echo "POSTGRES_PASSWORD gerado."
fi

# A senha do banco vive em duas variáveis: POSTGRES_PASSWORD (usada pelo Postgres)
# e dentro de DATABASE_URL (usada pela API). Divergir entre as duas produz um
# "password authentication failed" que não se parece em nada com a causa.
# Enquanto DATABASE_URL apontar para o serviço do compose, ela é derivada daqui.
PW="$(grep '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
USER_NAME="$(grep '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2-)"
DB_NAME="$(grep '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2-)"
CURRENT_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"

# Uma senha base64 traz "/", "+" e "=", que numa URL significam outra coisa —
# o "/" encerra o userinfo e o resto vira caminho. Precisa ir percent-encodada.
PW_ENC="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$PW")"
EXPECTED_URL="postgres://${USER_NAME}:${PW_ENC}@postgres:5432/${DB_NAME}"

case "$CURRENT_URL" in
  *@postgres:5432/*)
    if [ "$CURRENT_URL" != "$EXPECTED_URL" ]; then
      replace DATABASE_URL "$EXPECTED_URL"
      echo "DATABASE_URL ressincronizada com POSTGRES_PASSWORD."
    fi
    ;;
  *)
    echo "DATABASE_URL aponta para um banco externo — mantida como está."
    ;;
esac
echo "Segredos prontos em $ENV_FILE"
