#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <ollama_base_url> [config_path] [pm2_app_name]"
  echo "Example: $0 http://127.0.0.1:11435/v1 ~/.openclaw/openclaw.json clawdbot"
  exit 1
fi

OLLAMA_BASE_URL="$1"
CONFIG_PATH="${2:-$HOME/.openclaw/openclaw.json}"
PM2_APP_NAME="${3:-}"

if [[ ! -f "${CONFIG_PATH}" ]]; then
  echo "Config not found: ${CONFIG_PATH}" >&2
  exit 1
fi

BACKUP_PATH="${CONFIG_PATH}.bak.$(date +%Y%m%d%H%M%S)"
cp "${CONFIG_PATH}" "${BACKUP_PATH}"
echo "Backup created: ${BACKUP_PATH}"

python3 - "${CONFIG_PATH}" "${OLLAMA_BASE_URL}" <<'PY'
import json
import sys

config_path = sys.argv[1]
base_url = sys.argv[2]

with open(config_path) as f:
    obj = json.load(f)

obj.setdefault("models", {}).setdefault("providers", {}).setdefault("ollama", {})["baseUrl"] = base_url

with open(config_path, "w") as f:
    json.dump(obj, f, indent=2)
    f.write("\n")

print(f"Updated {config_path} -> models.providers.ollama.baseUrl={base_url}")
PY

if [[ -n "${PM2_APP_NAME}" ]]; then
  pm2 restart "${PM2_APP_NAME}"
  pm2 save
  echo "Restarted pm2 app: ${PM2_APP_NAME}"
fi
