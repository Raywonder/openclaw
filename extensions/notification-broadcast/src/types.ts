import type { GatewayRequestContext } from "openclaw/plugin-sdk";

export type NotificationSeverity = "info" | "warning" | "error" | "critical";
export type NotificationSensitivity = "public" | "internal" | "private" | "secret";
export type NotificationSource =
  | "gateway"
  | "windows"
  | "macos"
  | "pushover"
  | "ntfy"
  | "email"
  | "webhook"
  | "server-log"
  | "service-monitor";

export type NotificationActionHint = {
  label: string;
  action: string;
  requiresConfirmation: boolean;
};

export type NotificationEvent = {
  source: NotificationSource;
  eventId: string;
  ownerId?: string;
  recipientIds: string[];
  severity: NotificationSeverity;
  title: string;
  summary: string;
  details?: string;
  sensitivity: NotificationSensitivity;
  dedupeKey: string;
  actionHints: NotificationActionHint[];
  createdAt: string;
};

export type RecipientConfig = {
  id: string;
  label?: string;
  agentId: string;
  channels: string[];
  ntfyTopic?: string;
  minImmediateSeverity: NotificationSeverity;
  digest: boolean;
};

export type SourceConfig = {
  enabled: boolean;
};

export type NotificationBroadcastConfig = {
  enabled: boolean;
  sources: Record<NotificationSource, SourceConfig>;
  integrations: {
    ntfy: {
      enabled: boolean;
      baseUrl?: string;
      defaultTopic?: string;
      tokenEnv?: string;
    };
  };
  recipients: RecipientConfig[];
  policies: {
    delivery: "digest_plus_urgent" | "immediate_all" | "digest_only";
    actionMode: "queue_then_confirm" | "read_only_auto" | "repair_safe_issues";
    urgentSeverity: NotificationSeverity;
    maxDigestItems: number;
  };
  redaction: {
    forwardPrivateBodies: boolean;
    deniedFields: string[];
  };
};

export type DeliveryRecord = {
  deliveryId: string;
  eventId: string;
  recipientId: string;
  agentId: string;
  channels: string[];
  mode: "immediate" | "digest";
  status: "queued" | "broadcast";
  ntfyStatus?: "not_configured" | "sent" | "failed";
  message: string;
  actionState: "none" | "queued_confirmation" | "read_only";
  createdAt: string;
};

export type NotificationStatus = {
  enabled: boolean;
  sources: Record<string, boolean>;
  recipients: Array<{ id: string; agentId: string; channels: string[] }>;
  events: number;
  deliveries: number;
  digestQueue: number;
  lastEventAt?: string;
  lastBroadcastAt?: string;
};

export type SubmitOptions = {
  trusted: boolean;
  context?: GatewayRequestContext;
};
