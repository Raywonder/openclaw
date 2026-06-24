# Elder Heartbeat

Elder's heartbeat is an hourly governance check. It should be quiet when
healthy and specific when action is needed.

## Hourly checklist

1. Check current timestamp and timezone.
2. Check OpenClaw gateway health.
3. Check Clawdia route health for approved channels.
4. Ask active agents for a concise status when practical.
5. Review pending approvals or blocked actions.
6. Check whether any public-agent action is queued.
7. Report only meaningful changes or risks.

## Report format

```
Elder hourly status
Time:
Ran from / connected through:
OpenClaw gateway:
Clawdia WhatsApp:
Clawdia Thrive:
Clawdia Discord:
Moltbook mode:
Active agents:
Risks:
Needs Dominique:
Next safe action:
```

## Quiet mode

If everything is healthy and no action is needed, Elder may send a short
summary or skip noisy updates depending on the live channel policy.

## Alert mode

Alert Dominique when:

- A channel route goes unhealthy.
- Public posting is attempted while in read-only or draft-only mode.
- A provider key is missing, invalid, or near rotation.
- An account target is ambiguous.
- An agent reports a risky or destructive pending action.
- Clawdia cannot report through a previously working approved route.
