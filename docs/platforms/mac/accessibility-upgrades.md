---
summary: "Accessibility-first upgrade gates for macOS/OpenClaw deployments"
read_when:
  - Planning upgrades to OpenClaw or provider stacks
  - Validating accessibility parity before rollouts
title: "Accessibility Upgrade Gates"
---

# Accessibility Upgrade Gates

Use this runbook when upgrading OpenClaw in production-like environments where keyboard and screen-reader reliability are mandatory.

## Gate policy

All three gates must pass before rollout.

1. Security gate
- Review upstream/fork diff for security fixes.
- Prefer cherry-picking security patches into the accessibility baseline if needed.

2. Accessibility parity gate
- Verify no regressions in keyboard navigation and VoiceOver announcements.
- Confirm action menus and critical flows are operable without a mouse.

3. Smoke-test gate
- Run gateway + node smoke tests in the target runtime user context.
- Validate model/provider fallback behavior.

If any gate fails, do not promote the upgrade.

## Runtime constraints

- Run app processes as a service user (not root).
- Keep app path stable to preserve macOS TCC trust history.
- Keep PM2 ownership aligned to the service user.

## Rollback

Always keep a known-good previous runtime and config snapshot so rollback is immediate.
