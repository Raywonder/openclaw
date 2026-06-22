import type {
  NotificationBroadcastConfig,
  NotificationSeverity,
  NotificationSource,
  RecipientConfig,
} from "./types.js";

const SOURCES: NotificationSource[] = [
  "gateway",
  "windows",
  "macos",
  "pushover",
  "ntfy",
  "email",
  "webhook",
  "server-log",
  "service-monitor",
];

const SEVERITIES: NotificationSeverity[] = ["info", "warning", "error", "critical"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asPositiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : fallback;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
}

function asSeverity(value: unknown, fallback: NotificationSeverity): NotificationSeverity {
  const raw = asString(value);
  return raw && SEVERITIES.includes(raw as NotificationSeverity)
    ? (raw as NotificationSeverity)
    : fallback;
}

function parseRecipients(value: unknown): RecipientConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const raw = asRecord(entry);
    const id = asString(raw.id);
    const agentId = asString(raw.agentId);
    if (!id || !agentId) {
      return [];
    }
    return [
      {
        id,
        label: asString(raw.label),
        agentId,
        channels: asStringArray(raw.channels),
        ntfyTopic: asString(raw.ntfyTopic),
        minImmediateSeverity: asSeverity(raw.minImmediateSeverity, "critical"),
        digest: asBoolean(raw.digest, true),
      },
    ];
  });
}

export function severityRank(severity: NotificationSeverity): number {
  return SEVERITIES.indexOf(severity);
}

export function resolveNotificationBroadcastConfig(
  pluginConfig: Record<string, unknown> | undefined,
): NotificationBroadcastConfig {
  const cfg = asRecord(pluginConfig);
  const rawSources = asRecord(cfg.sources);
  const sources = Object.fromEntries(
    SOURCES.map((source) => {
      const sourceCfg = asRecord(rawSources[source]);
      return [source, { enabled: asBoolean(sourceCfg.enabled, source === "gateway") }];
    }),
  ) as NotificationBroadcastConfig["sources"];

  const policies = asRecord(cfg.policies);
  const integrations = asRecord(cfg.integrations);
  const ntfy = asRecord(integrations.ntfy);
  const deliveryRaw = asString(policies.delivery);
  const actionRaw = asString(policies.actionMode);
  const delivery =
    deliveryRaw === "immediate_all" || deliveryRaw === "digest_only"
      ? deliveryRaw
      : "digest_plus_urgent";
  const actionMode =
    actionRaw === "read_only_auto" || actionRaw === "repair_safe_issues"
      ? actionRaw
      : "queue_then_confirm";

  const redaction = asRecord(cfg.redaction);

  return {
    enabled: asBoolean(cfg.enabled, true),
    sources,
    integrations: {
      ntfy: {
        enabled: asBoolean(ntfy.enabled, false),
        baseUrl: asString(ntfy.baseUrl),
        defaultTopic: asString(ntfy.defaultTopic),
        tokenEnv: asString(ntfy.tokenEnv),
      },
    },
    recipients: parseRecipients(cfg.recipients),
    policies: {
      delivery,
      actionMode,
      urgentSeverity: asSeverity(policies.urgentSeverity, "critical"),
      maxDigestItems: asPositiveInt(policies.maxDigestItems, 25),
    },
    redaction: {
      forwardPrivateBodies: asBoolean(redaction.forwardPrivateBodies, false),
      deniedFields: asStringArray(redaction.deniedFields),
    },
  };
}
