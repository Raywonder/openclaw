# Custom Fork Development Policy

## Default target

Development, fixes, and node-facing build guidance for this deployment target the user's
custom `raywonder/openclaw` fork by default. This repository is the source of truth for the
user's OpenClaw nodes and related custom behavior.

## Upstream safety

Do not target, push to, or automatically merge the upstream OpenClaw repository. Upstream
changes may be reviewed for security or compatibility, then selectively incorporated into this
fork only after the user authorizes that review and integration. Preserve the custom fork's
working behavior and accessibility changes over automatic synchronization.

## Release boundary

Source changes must be tested and committed here before any node deployment. A source commit
does not authorize deployment, provider changes, communication-channel changes, or model/prompt
changes; those remain separately governed actions.
