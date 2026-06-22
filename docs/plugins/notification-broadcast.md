---
summary: "Route gateway notifications to configured recipients through their agents"
title: "Notification Broadcast"
---

# Notification Broadcast

`notification-broadcast` accepts gateway notification events, redacts sensitive
content, deduplicates repeated events, and prepares recipient-scoped delivery
records for configured agents and channels.

The plugin is generic. Do not put personal phone numbers, private account names,
or client secrets in the package. Keep owner-specific routing in local
`plugins.entries.notification-broadcast.config` or a private deployment overlay.

## Enable

```json5
{
  plugins: {
    allow: ["notification-broadcast"],
    entries: {
      "notification-broadcast": {
        enabled: true,
        config: {
          sources: {
            gateway: { enabled: true },
            windows: { enabled: false },
            macos: { enabled: false },
            pushover: { enabled: false },
            ntfy: { enabled: false },
            email: { enabled: false },
            webhook: { enabled: false },
            "server-log": { enabled: false },
            "service-monitor": { enabled: false },
          },
          integrations: {
            ntfy: {
              enabled: false,
              baseUrl: "https://ntfy.example.com",
              defaultTopic: "openclaw-alerts",
              tokenEnv: "OPENCLAW_NTFY_TOKEN",
            },
          },
          recipients: [
            {
              id: "owner",
              label: "Primary owner",
              agentId: "main",
              channels: ["private-approved-channel"],
              ntfyTopic: "owner-alerts",
              minImmediateSeverity: "critical",
              digest: true,
            },
          ],
          policies: {
            delivery: "digest_plus_urgent",
            actionMode: "queue_then_confirm",
            urgentSeverity: "critical",
            maxDigestItems: 25,
          },
          redaction: {
            forwardPrivateBodies: false,
            deniedFields: ["raw", "secret", "token", "authorization"],
          },
        },
      },
    },
  },
}
```

Gateway events are enabled by default. Other source adapters, including ntfy,
are intentionally disabled until an admin or approved agent enables them.

## ntfy support

The plugin can use ntfy in two ways:

- as an optional incoming source with `sources.ntfy.enabled`;
- as an optional urgent-notification delivery adapter with
  `integrations.ntfy.enabled`.

For self-hosted ntfy, set `integrations.ntfy.baseUrl` to the hosted ntfy server
URL and keep the publish token in an environment variable named by
`integrations.ntfy.tokenEnv`. Do not place the token itself in OpenClaw config or
docs. Recipients may override the default topic with `ntfyTopic`.

Urgent ntfy deliveries use `POST` to the configured topic with `Title`,
`Priority`, and `Tags` headers. Critical notifications map to priority `5`;
errors map to `4`; warnings map to `3`; info maps to `2`.

## Event shape

Submit events through the gateway method `notificationBroadcast.submit` or the
HTTP route `POST /plugins/notification-broadcast/events`.

```json
{
  "source": "gateway",
  "eventId": "example-001",
  "ownerId": "owner",
  "recipientIds": ["owner"],
  "severity": "critical",
  "title": "Disk pressure",
  "summary": "The gateway host crossed the emergency disk threshold.",
  "details": "A repair task was queued and needs confirmation.",
  "sensitivity": "internal",
  "dedupeKey": "gateway:disk-pressure:host",
  "actionHints": [
    {
      "label": "Review repair queue",
      "action": "openclaw.queue.review",
      "requiresConfirmation": true
    }
  ],
  "createdAt": "2026-06-22T00:00:00Z"
}
```

## Delivery and action policy

Default delivery is digest plus urgent immediate. Non-urgent events are queued
for digest; urgent events are broadcast internally for the configured recipient
agent/channel path.

Default action handling is queue then confirm. Agents may prepare and summarize
next steps, but risky external changes require confirmation unless a deployment
policy explicitly allows a narrow safe repair.

## Status

Use `GET /plugins/notification-broadcast/status` or the
`notification-broadcast` tool with `action: "status"` to see enabled sources,
recipient routes, event count, delivery count, and digest queue size.
