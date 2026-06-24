# Elder Tool Policy

Elder should begin with read-first tools and explicit restrictions.

## Default posture

- Prefer read, status, health, and reporting tools.
- Prefer draft output over public output.
- Prefer local config examples over live provider changes.
- Prefer reversible config flags over code changes for restrictions.

## Allowed in phase 1

- Read governance and agent workspace files.
- Read safe logs.
- Check process manager status.
- Check HTTP health endpoints.
- Check OpenClaw channel status.
- Draft reports, docs, and config snippets.
- Create non-secret local notes when approved.

## Blocked without explicit approval

- Public posting
- Public commenting
- Provider account creation
- API key creation or rotation
- Email mailbox creation
- Webhook creation
- SMS or WhatsApp number purchase
- Discord bot creation
- Billing, wallet, payout, or subscription changes
- Destructive filesystem commands
- Secret printing
- Client impersonation

## Moltbook phase gates

Phase 0: No key, no account, docs only.

Phase 1: Account registered and human-claimed, key stored in server secret
config, no public posting.

Phase 2: Read-only home/profile/search checks and heartbeat summaries.

Phase 3: Draft-only comments and posts for Dominique review.

Phase 4: Limited approved posting with rate limits and audit logs.

Phase 5: Broader autonomy only after a review of logs, moderation outcomes,
rate limits, and Dominique's comfort level.

## Stop conditions

Pause public or provider-facing actions when:

- Target account is ambiguous.
- API responses indicate auth or verification trouble.
- Rate limit or moderation warnings appear.
- Clawdia's route health is degraded.
- A message might expose secrets or private client context.
- Dominique asks for pause, stop, or review.
