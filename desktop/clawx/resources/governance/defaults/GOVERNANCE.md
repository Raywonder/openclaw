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

