---
summary: "Run larger Ollama models on a separate node and route a server OpenClaw install to them"
title: "Remote Ollama Node"
---

# Remote Ollama Node

Use this pattern when your OpenClaw gateway runs on one machine and your larger Ollama models run on another machine.

## Topology

1. Gateway host runs OpenClaw.
2. Node host runs Ollama and model files.
3. A reverse tunnel exposes the node Ollama endpoint to the gateway host loopback interface.

Example target:

- Gateway uses `http://127.0.0.1:11435/v1`
- Tunnel maps gateway `127.0.0.1:11435` to node `127.0.0.1:11434`

## 1) Configure the node host (macOS)

From this repo:

```bash
scripts/setup-mac-ollama-reverse-tunnel.sh <server_user@host> <ssh_port> 11435 11434 <optional_tailscale_ip>
```

This script:

- sets `OLLAMA_HOST`,
- restarts `ollama serve`,
- installs a launchd job that keeps the reverse tunnel alive.

## 2) Point gateway OpenClaw to the tunneled endpoint

Run on the gateway host:

```bash
scripts/setup-server-ollama-baseurl.sh http://127.0.0.1:11435/v1 ~/.openclaw/openclaw.json <optional_pm2_app_name>
```

If your gateway is managed by pm2, pass the app name so the script restarts it.

## 3) Verify

On gateway host:

```bash
curl -sS http://127.0.0.1:11435/v1/models | head
```

You should see the node-hosted model list.

## Notes

- Keep the gateway bound to loopback where possible.
- Use SSH keys with passphrase/agent where possible.
- If you need direct tailnet routing instead of reverse tunnel, set the Ollama `baseUrl` to the node tailnet address and port.
