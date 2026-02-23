#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <server_user@host> <ssh_port> [remote_port] [local_ollama_port] [tailscale_ip] [ssh_key_path]"
  echo "Example: $0 dom@64.20.46.178 450 11435 11434 100.64.0.6 ~/.ssh/raywonder"
  exit 1
fi

SERVER_HOST="$1"
SSH_PORT="$2"
REMOTE_PORT="${3:-11435}"
LOCAL_OLLAMA_PORT="${4:-11434}"
TAILSCALE_IP="${5:-}"
SSH_KEY_PATH="${6:-}"

if [[ -n "${TAILSCALE_IP}" ]]; then
  OLLAMA_HOST="${TAILSCALE_IP}:${LOCAL_OLLAMA_PORT}"
else
  OLLAMA_HOST="0.0.0.0:${LOCAL_OLLAMA_PORT}"
fi

SSH_ARGS=()
if [[ -n "${SSH_KEY_PATH}" ]]; then
  SSH_ARGS+=("-i" "${SSH_KEY_PATH}")
fi

echo "Configuring Ollama bind address: ${OLLAMA_HOST}"
launchctl setenv OLLAMA_HOST "${OLLAMA_HOST}"

pkill -f "[o]llama serve" || true
sleep 2
OLLAMA_HOST="${OLLAMA_HOST}" nohup ollama serve >/tmp/ollama-serve.log 2>&1 &
sleep 2

PLIST_PATH="${HOME}/Library/LaunchAgents/devine.openclaw.ollama-reverse-tunnel.plist"
cat >"${PLIST_PATH}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>devine.openclaw.ollama-reverse-tunnel</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/bin/ssh</string>
      <string>-N</string>
      <string>-o</string>
      <string>ExitOnForwardFailure=yes</string>
      <string>-o</string>
      <string>ServerAliveInterval=30</string>
      <string>-o</string>
      <string>ServerAliveCountMax=3</string>
      <string>-p</string>
      <string>${SSH_PORT}</string>
      <string>-R</string>
      <string>${REMOTE_PORT}:127.0.0.1:${LOCAL_OLLAMA_PORT}</string>
$(if [[ -n "${SSH_KEY_PATH}" ]]; then
  printf '      <string>-i</string>\n      <string>%s</string>\n' "${SSH_KEY_PATH}"
fi)
      <string>${SERVER_HOST}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/openclaw-ollama-tunnel.out.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/openclaw-ollama-tunnel.err.log</string>
  </dict>
</plist>
PLIST

launchctl unload "${PLIST_PATH}" >/dev/null 2>&1 || true
launchctl load "${PLIST_PATH}"

echo "Done."
echo "- Ollama listening: ${OLLAMA_HOST}"
echo "- Reverse tunnel: server 127.0.0.1:${REMOTE_PORT} -> local 127.0.0.1:${LOCAL_OLLAMA_PORT}"
echo "- launchd label: devine.openclaw.ollama-reverse-tunnel"
