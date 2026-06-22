import { randomUUID } from "node:crypto";
import type {
  NotificationActionHint,
  NotificationEvent,
  NotificationSensitivity,
  NotificationSeverity,
  NotificationSource,
} from "./types.js";
import { redactText, safeTitle } from "./redaction.js";

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
const SENSITIVITIES: NotificationSensitivity[] = ["public", "internal", "private", "secret"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const raw = asString(value);
  return raw && allowed.includes(raw as T) ? (raw as T) : fallback;
}

function normalizeActionHints(value: unknown): NotificationActionHint[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const raw = asRecord(entry);
    const label = redactText(raw.label, 80);
    const action = redactText(raw.action, 120);
    if (!label || !action) {
      return [];
    }
    return [
      {
        label,
        action,
        requiresConfirmation:
          typeof raw.requiresConfirmation === "boolean" ? raw.requiresConfirmation : true,
      },
    ];
  });
}

export function normalizeNotificationEvent(input: unknown): NotificationEvent {
  const raw = asRecord(input);
  const source = asEnum(raw.source, SOURCES, "gateway");
  const eventId = redactText(asString(raw.eventId) ?? randomUUID(), 120);
  const ownerId = redactText(raw.ownerId, 120) || undefined;
  const recipientIds = asStringArray(raw.recipientIds).map((recipient) => redactText(recipient, 120));
  const severity = asEnum(raw.severity, SEVERITIES, "info");
  const title = safeTitle(raw.title);
  const summary = redactText(raw.summary, 700) || title;
  const sensitivity = asEnum(raw.sensitivity, SENSITIVITIES, "internal");
  const details =
    sensitivity === "secret" || sensitivity === "private"
      ? undefined
      : redactText(raw.details, 1200) || undefined;
  const dedupeKey = redactText(asString(raw.dedupeKey) ?? `${source}:${eventId}`, 200);
  const createdAt =
    asString(raw.createdAt) && !Number.isNaN(Date.parse(String(raw.createdAt)))
      ? String(raw.createdAt)
      : new Date().toISOString();

  return {
    source,
    eventId,
    ownerId,
    recipientIds,
    severity,
    title,
    summary,
    details,
    sensitivity,
    dedupeKey,
    actionHints: normalizeActionHints(raw.actionHints),
    createdAt,
  };
}
