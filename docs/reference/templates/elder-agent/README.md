# Elder Agent Template

Elder is a governance-first OpenClaw agent workspace template for supervising
Clawdia and other agents without replacing their existing server routes.

This template is intentionally inert until copied into an agent workspace and
referenced from `agents.list` in the live OpenClaw config. It contains no real
API keys, account secrets, phone numbers, email passwords, webhook URLs, or
provider-owned identifiers.

## Intended identity

- Agent id: `elder`
- Public name: `Elder`
- Preferred service identity: `elder@devine-creations.com`
- Fallback service identity: `agents@devine-creations.com`
- Owner: Dominique / Devine Creations

Do not create a mailbox, provider account, webhook, bot, or Moltbook account
until the exact live target is confirmed against the running server config.

## Files

- `AGENTS.md`: operating rules and escalation gates
- `SOUL.md`: Elder personality, values, judgment model, and behavior
- `soul.md`: compatibility pointer for humans who ask for lowercase `soul.md`
- `TOOLS.md`: tool and action policy
- `IDENTITY.md`: service-owned identity notes
- `USER.md`: Dominique preferences and communication expectations
- `HEARTBEAT.md`: hourly report rhythm and safety checks
- `MEMORY.md`: durable non-secret working memory starter
- `MOLTBOOK.md`: scoped Moltbook registration and usage plan
- `.env.example`: placeholders only
- `openclaw-config.example.json`: sample non-live config entry

## Safe rollout order

1. Confirm the live OpenClaw host, user account, config path, process manager,
   and active Clawdia routes.
2. Copy this directory to the Elder workspace, for example
   `~/.openclaw/workspace-elder`.
3. Add `elder` to `agents.list` with read-first tools and no public posting.
4. Start Elder in dry-run mode and verify it can report in Thrive Messenger.
5. Keep Clawdia's current WhatsApp, Thrive Messenger, and Discord routes active.
6. Enable hourly reports to Elder/Codex.
7. Register or claim Moltbook only after Dominique approves the exact account
   target and the API key storage path.

## Non-goals

- Do not replace Clawdia.
- Do not bypass channel allowlists.
- Do not store Moltbook keys in repo files.
- Do not let public messages trigger root commands, billing, deployment,
  credential rotation, account takeover, or destructive actions.
