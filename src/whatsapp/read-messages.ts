import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import fs from "node:fs";
import type { SessionEntry } from "../config/sessions.js";
import {
  loadSessionStore,
  resolveDefaultSessionStorePath,
  resolveSessionFilePath,
} from "../config/sessions.js";
import {
  readWhatsAppEvents,
  resolveWhatsAppEventStorePath,
  type WhatsAppEventRecord,
} from "./events.js";

export type WhatsAppReadMessage = {
  id: string;
  timestamp: string;
  authorTag: string;
  text: string;
  role: "user" | "assistant" | "system";
  kind?: "message" | "event";
  eventType?: string;
  attachments?: Array<{
    type: "media";
    path?: string;
    mimeType?: string;
  }>;
};

type ReadWhatsAppMessagesParams = {
  target: string;
  accountId?: string | null;
  agentId?: string;
  limit?: number | null;
  before?: string | null;
  after?: string | null;
  storePath?: string;
  eventStorePath?: string;
};

function jsonResult(details: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(details) }],
    details,
  };
}

function normalizeDirectTarget(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.endsWith("@g.us")) {
    return trimmed;
  }
  const digits = trimmed.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : trimmed;
}

function entryMatchesTarget(
  entry: SessionEntry,
  target: string,
  accountId?: string | null,
): boolean {
  const normalizedTarget = normalizeDirectTarget(target);
  const candidates = [
    entry.lastTo,
    entry.deliveryContext?.to,
    entry.origin?.to,
    entry.origin?.from,
    entry.groupChannel,
    entry.groupId,
  ]
    .map((value) => (typeof value === "string" ? normalizeDirectTarget(value) : ""))
    .filter(Boolean);
  if (!candidates.includes(normalizedTarget)) {
    return false;
  }

  const normalizedAccount = accountId?.trim();
  if (!normalizedAccount) {
    return true;
  }
  const entryAccount =
    entry.lastAccountId ?? entry.deliveryContext?.accountId ?? entry.origin?.accountId;
  return !entryAccount || entryAccount === normalizedAccount;
}

function eventMatchesTarget(
  event: WhatsAppEventRecord,
  target: string,
  accountId?: string | null,
): boolean {
  const normalizedTarget = normalizeDirectTarget(target);
  const candidates = [event.conversationId, event.chatId]
    .map((value) => (typeof value === "string" ? normalizeDirectTarget(value) : ""))
    .filter(Boolean);
  if (!candidates.includes(normalizedTarget)) {
    return false;
  }
  const normalizedAccount = accountId?.trim();
  return !normalizedAccount || event.accountId === normalizedAccount;
}

function getLineTimestampMs(line: Record<string, unknown>): number {
  const message = line.message;
  if (message && typeof message === "object") {
    const raw = (message as { timestamp?: unknown }).timestamp;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
  }
  const timestamp = typeof line.timestamp === "string" ? Date.parse(line.timestamp) : NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function timestampFilter(value?: string | null): number | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractTextContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (!part || typeof part !== "object") {
        return "";
      }
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function readOptionalString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function extractTranscriptMessage(line: string): WhatsAppReadMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const message = record.message;
  if (!message || typeof message !== "object") {
    return null;
  }
  const msg = message as Record<string, unknown>;
  const role = msg.role;
  if (role !== "user" && role !== "assistant") {
    return null;
  }

  const mediaPath =
    readOptionalString(msg, ["mediaPath", "MediaPath"]) ??
    readOptionalString(record, ["mediaPath", "MediaPath"]);
  const mediaType =
    readOptionalString(msg, ["mediaType", "MediaType", "mimeType", "contentType"]) ??
    readOptionalString(record, ["mediaType", "MediaType", "mimeType", "contentType"]);
  const attachments =
    mediaPath || mediaType
      ? [
          {
            type: "media" as const,
            ...(mediaPath ? { path: mediaPath } : {}),
            ...(mediaType ? { mimeType: mediaType } : {}),
          },
        ]
      : undefined;
  const text =
    extractTextContent(msg.content).trim() ||
    (attachments ? `<media:${mediaType ?? "attachment"}>` : "");
  if (!text) {
    return null;
  }

  const timestampMs = getLineTimestampMs(record);
  const senderName =
    typeof msg.senderName === "string" && msg.senderName.trim()
      ? msg.senderName.trim()
      : typeof msg.senderLabel === "string" && msg.senderLabel.trim()
        ? msg.senderLabel.trim()
        : undefined;
  return {
    id:
      (typeof record.id === "string" && record.id) ||
      (typeof msg.idempotencyKey === "string" && msg.idempotencyKey) ||
      "",
    timestamp: timestampMs ? new Date(timestampMs).toISOString() : "",
    authorTag: role === "user" ? (senderName ?? "user") : "assistant",
    text,
    role,
    kind: "message",
    ...(attachments ? { attachments } : {}),
  };
}

function readTranscriptMessages(params: {
  sessionFile: string;
  beforeMs: number | null;
  afterMs: number | null;
}): WhatsAppReadMessage[] {
  let raw = "";
  try {
    raw = fs.readFileSync(params.sessionFile, "utf-8");
  } catch {
    return [];
  }

  const messages: WhatsAppReadMessage[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const msg = extractTranscriptMessage(line);
    if (!msg) {
      continue;
    }
    const timestampMs = Date.parse(msg.timestamp);
    if (
      params.beforeMs !== null &&
      Number.isFinite(timestampMs) &&
      timestampMs >= params.beforeMs
    ) {
      continue;
    }
    if (params.afterMs !== null && Number.isFinite(timestampMs) && timestampMs <= params.afterMs) {
      continue;
    }
    messages.push(msg);
  }
  return messages;
}

function readEventMessages(params: {
  eventStorePath: string;
  target: string;
  accountId?: string | null;
  beforeMs: number | null;
  afterMs: number | null;
}): WhatsAppReadMessage[] {
  return readWhatsAppEvents({ storePath: params.eventStorePath })
    .filter((event) => eventMatchesTarget(event, params.target, params.accountId))
    .filter((event) => {
      const timestampMs = Date.parse(event.timestamp);
      if (
        params.beforeMs !== null &&
        Number.isFinite(timestampMs) &&
        timestampMs >= params.beforeMs
      ) {
        return false;
      }
      if (
        params.afterMs !== null &&
        Number.isFinite(timestampMs) &&
        timestampMs <= params.afterMs
      ) {
        return false;
      }
      return true;
    })
    .map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      authorTag: "whatsapp",
      text: event.text,
      role: "system" as const,
      kind: "event" as const,
      eventType: event.eventType,
    }));
}

export async function readWhatsAppMessagesFromTranscripts(
  params: ReadWhatsAppMessagesParams,
): Promise<AgentToolResult<unknown>> {
  const storePath = params.storePath ?? resolveDefaultSessionStorePath(params.agentId);
  const store = loadSessionStore(storePath, { skipCache: true });
  const entries = Object.values(store)
    .filter((entry) => entryMatchesTarget(entry, params.target, params.accountId))
    .toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const beforeMs = timestampFilter(params.before);
  const afterMs = timestampFilter(params.after);
  const eventStorePath =
    params.eventStorePath ?? resolveWhatsAppEventStorePath(params.accountId ?? "default");
  const limit =
    typeof params.limit === "number" && Number.isFinite(params.limit) && params.limit > 0
      ? Math.min(Math.floor(params.limit), 100)
      : 25;

  const messages: WhatsAppReadMessage[] = [];
  for (const entry of entries) {
    const sessionFile = resolveSessionFilePath(entry.sessionId, entry, { agentId: params.agentId });
    messages.push(...readTranscriptMessages({ sessionFile, beforeMs, afterMs }));
    if (messages.length >= limit * 2) {
      break;
    }
  }
  messages.push(
    ...readEventMessages({
      eventStorePath,
      target: params.target,
      accountId: params.accountId,
      beforeMs,
      afterMs,
    }),
  );

  const latest = messages
    .toSorted((a, b) => Date.parse(a.timestamp || "0") - Date.parse(b.timestamp || "0"))
    .slice(-limit);

  return jsonResult({
    ok: true,
    source: "openclaw-session-transcripts",
    target: normalizeDirectTarget(params.target),
    messages: latest,
  });
}
