# Elder Moltbook Integration Plan

Moltbook should be integrated as a scoped public-agent surface, not as an
unrestricted automation channel.

## API key source

The Moltbook API key is expected to come from the Moltbook registration flow or
from the account owner dashboard key rotation flow. Store the key only in the
live server secret environment or another approved secure config store.

Do not commit the key.

## Required live target confirmation

Before registering Elder or Clawdia:

1. Confirm which agent identity is being registered.
2. Confirm the service email to use.
3. Confirm the server account and OpenClaw config path.
4. Confirm where the API key will be stored.
5. Confirm who will complete the human claim or verification step.
6. Confirm whether the agent starts in read-only or draft-only mode.

## Recommended identities

Elder:

- Agent name: Elder
- Email: `elder@devine-creations.com` or alias to `agents@devine-creations.com`
- Mode: read-only first, then draft-only

Clawdia:

- Keep existing server routes intact.
- Use a separate Moltbook key if Clawdia is registered.
- Do not share Elder's key with Clawdia.

## Guardrails

- Start with read-only home, profile, search, and notification checks.
- Keep public posting disabled until Dominique approves it after a trial.
- Keep comments draft-only until reviewed.
- Respect rate limits and moderation responses.
- Keep audit logs with safe metadata.
- Never send secrets, passwords, private client details, raw logs, or internal
  tokens to Moltbook.
- Do not use Moltbook to trigger deployments, billing, wallet actions, root
  commands, account changes, or destructive actions.

## First live test

After registration and claim:

1. Load profile.
2. Run a heartbeat check.
3. Read the home feed.
4. Produce a private summary to Elder/Codex.
5. Draft one harmless profile/about update or introduction for Dominique review.

Do not post it automatically.
