# Governance Bundle

This directory is bundled into the desktop app and copied to each user profile on first launch.

Target path:
- `~/.clawx/governance`

Behavior:
- Missing files are copied in.
- Existing files are preserved.
- Provision metadata is written to `.provisioned-manifest.json`.

Included:
- `START-HERE.md` for no-training onboarding.
- `GOVERNANCE.md` baseline policy.
- `agents/` snapshots.
- `github/` snapshots of project automation/config rules.

