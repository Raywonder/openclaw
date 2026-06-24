# OpenClaw Notification Broadcast

`notification-broadcast` accepts gateway notification events, redacts sensitive
content, deduplicates repeated events, and prepares recipient-scoped delivery
records for each configured agent/channel.

Gateway events are enabled by default. Other source adapters can be enabled by
configuration later, such as Windows notifications, macOS notifications,
Pushover, ntfy, email, webhooks, server logs, and service monitors.

The plugin can also publish urgent notifications to a configured ntfy server.
Store ntfy tokens in environment variables and reference the variable name from
plugin config; do not store tokens in source or docs.

The reusable package does not contain personal account data. Keep private
overlays in local OpenClaw config, private agent folders, or deployment-specific
config files outside the package.

## HTTP routes

- `POST /plugins/notification-broadcast/events`
- `GET /plugins/notification-broadcast/status`

## Gateway methods

- `notificationBroadcast.submit`
- `notificationBroadcast.status`

## Default policy

- Delivery cadence: digest plus urgent immediate.
- Action handling: queue then confirm.
- Redaction: codes, URLs, token-like strings, and secret-looking phrases are
  removed before delivery records are created.
