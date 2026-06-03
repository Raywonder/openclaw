# Governance Baseline

This package includes a local governance baseline for user-owned systems.

## Principles
- Safe-by-default behavior for first run.
- User-controlled local guardrails.
- Admin override capability where server policy requires it.
- Preserve user modifications across app upgrades.

## Local ownership
- Local files are provisioned to `~/.clawx/governance`.
- Provisioning is additive: missing files are added, existing files are preserved.
- Users can tune policies for their own machine and workflow.

## Admin and server control
- Server-side required modules and policy controls remain authoritative.
- Local rules should not break required API endpoints or federation sync.
- If policy conflicts occur, apply least-risk behavior and log clearly.

## Included policy sources
- Root AGENTS guidance snapshot.
- Desktop-specific AGENTS guidance snapshot.
- AGENTS template snapshot.
- GitHub rule/config snapshots from `.github`.

## Agent-owned communications and accounts
- Prefer service-owned identities for automation; do not use personal accounts, personal phone numbers, or unrelated email addresses unless explicitly approved.
- Keep platform-owned, client-owned managed, and client-owned transferable resources documented separately.
- Never hardcode provider credentials, webhook secrets, OAuth secrets, SMTP passwords, database passwords, or private keys. Use secure local/server secret storage and provide `.env.example` files with placeholders only.
- Document every external provider dependency, including provider name, account email, purpose, webhook/callback URL, related domain, known costs, verification needs, and required secret names without exposing secret values.
- Use safe defaults for messaging: no passwords or full tokens over chat/SMS, no destructive action without allowlist and confirmation, no client impersonation, no non-opt-in marketing blasts, and documented STOP/UNSUBSCRIBE handling where SMS is used.
- Every created account, bot, webhook, number, gateway, email address, or client automation must have recovery and ownership notes plus a final report covering what changed, where it lives, who owns it, what provider it uses, what secrets remain manual, and what callback/process names are involved.
