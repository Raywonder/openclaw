import type {
  DeliveryRecord,
  NotificationBroadcastConfig,
  NotificationEvent,
  NotificationStatus,
  RecipientConfig,
} from "./types.js";
import { severityRank } from "./config.js";

export type NotificationBroadcastSnapshot = {
  event: NotificationEvent;
  deliveries: DeliveryRecord[];
  duplicate: boolean;
};

function shouldDeliverImmediate(
  event: NotificationEvent,
  recipient: RecipientConfig,
  config: NotificationBroadcastConfig,
): boolean {
  if (config.policies.delivery === "immediate_all") {
    return true;
  }
  if (config.policies.delivery === "digest_only") {
    return false;
  }
  const urgentRank = severityRank(config.policies.urgentSeverity);
  return (
    severityRank(event.severity) >= urgentRank ||
    severityRank(event.severity) >= severityRank(recipient.minImmediateSeverity)
  );
}

function actionState(event: NotificationEvent, config: NotificationBroadcastConfig): DeliveryRecord["actionState"] {
  if (event.actionHints.length === 0) {
    return "none";
  }
  if (config.policies.actionMode === "read_only_auto") {
    return "read_only";
  }
  return "queued_confirmation";
}

function formatMessage(event: NotificationEvent, recipient: RecipientConfig): string {
  const lines = [
    `${event.title}`,
    event.summary,
    `Severity: ${event.severity}. Source: ${event.source}.`,
  ];
  if (event.details) {
    lines.push(event.details);
  }
  if (event.actionHints.length > 0) {
    lines.push(
      `Possible action: ${event.actionHints
        .map((hint) => hint.label)
        .slice(0, 3)
        .join(", ")}. Confirmation is required before risky changes.`,
    );
  }
  if (recipient.label) {
    lines.push(`For: ${recipient.label}.`);
  }
  return lines.filter(Boolean).join("\n");
}

export class NotificationBroadcastStore {
  private readonly events = new Map<string, NotificationEvent>();
  private readonly deliveries: DeliveryRecord[] = [];
  private lastEventAt: string | undefined;
  private lastBroadcastAt: string | undefined;

  submit(event: NotificationEvent, config: NotificationBroadcastConfig): NotificationBroadcastSnapshot {
    const duplicate = this.events.has(event.dedupeKey);
    if (duplicate) {
      return { event: this.events.get(event.dedupeKey) ?? event, deliveries: [], duplicate: true };
    }

    const recipients = config.recipients.filter(
      (recipient) => event.recipientIds.length === 0 || event.recipientIds.includes(recipient.id),
    );
    const deliveries = recipients.map((recipient) => {
      const immediate = shouldDeliverImmediate(event, recipient, config);
      return {
        deliveryId: `${event.eventId}:${recipient.id}`,
        eventId: event.eventId,
        recipientId: recipient.id,
        agentId: recipient.agentId,
        channels: recipient.channels,
        mode: immediate ? "immediate" : "digest",
        status: immediate ? "broadcast" : "queued",
        ntfyStatus: immediate && config.integrations.ntfy.enabled ? "not_configured" : undefined,
        message: formatMessage(event, recipient),
        actionState: actionState(event, config),
        createdAt: new Date().toISOString(),
      } satisfies DeliveryRecord;
    });

    this.events.set(event.dedupeKey, event);
    this.deliveries.push(...deliveries);
    this.lastEventAt = event.createdAt;
    if (deliveries.some((delivery) => delivery.status === "broadcast")) {
      this.lastBroadcastAt = new Date().toISOString();
    }
    return { event, deliveries, duplicate: false };
  }

  status(config: NotificationBroadcastConfig): NotificationStatus {
    return {
      enabled: config.enabled,
      sources: Object.fromEntries(
        Object.entries(config.sources).map(([source, sourceConfig]) => [source, sourceConfig.enabled]),
      ),
      recipients: config.recipients.map((recipient) => ({
        id: recipient.id,
        agentId: recipient.agentId,
        channels: recipient.channels,
      })),
      events: this.events.size,
      deliveries: this.deliveries.length,
      digestQueue: this.deliveries.filter((delivery) => delivery.mode === "digest").length,
      lastEventAt: this.lastEventAt,
      lastBroadcastAt: this.lastBroadcastAt,
    };
  }

  listDigest(recipientId?: string): DeliveryRecord[] {
    return this.deliveries
      .filter((delivery) => delivery.mode === "digest")
      .filter((delivery) => !recipientId || delivery.recipientId === recipientId);
  }
}
