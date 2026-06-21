import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

export type WhatsAppEventType =
  | "message_edited"
  | "message_deleted"
  | "group_updated"
  | "group_participants_updated";

export type WhatsAppEventRecord = {
  id: string;
  timestamp: string;
  accountId: string;
  chatId: string;
  conversationId?: string;
  chatType: "direct" | "group";
  eventType: WhatsAppEventType;
  text: string;
  messageId?: string;
  actor?: string;
  targets?: string[];
};

export function resolveWhatsAppEventStorePath(
  accountId = "default",
  stateDir = resolveStateDir(),
): string {
  const safeAccount = accountId.replace(/[^A-Za-z0-9_.-]/g, "_") || "default";
  return path.join(stateDir, "whatsapp", "events", `${safeAccount}.jsonl`);
}

export async function recordWhatsAppEvent(
  event: Omit<WhatsAppEventRecord, "id" | "timestamp"> &
    Partial<Pick<WhatsAppEventRecord, "id" | "timestamp">>,
  opts: { storePath?: string } = {},
): Promise<void> {
  const record: WhatsAppEventRecord = {
    ...event,
    id: event.id?.trim() || randomUUID(),
    timestamp: event.timestamp?.trim() || new Date().toISOString(),
  };
  const file = opts.storePath ?? resolveWhatsAppEventStorePath(record.accountId);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.appendFile(file, `${JSON.stringify(record)}\n`, "utf-8");
}

export function readWhatsAppEvents(opts: { storePath: string }): WhatsAppEventRecord[] {
  let raw = "";
  try {
    raw = fs.readFileSync(opts.storePath, "utf-8");
  } catch {
    return [];
  }
  const events: WhatsAppEventRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as WhatsAppEventRecord;
      if (parsed?.id && parsed?.timestamp && parsed?.chatId && parsed?.text) {
        events.push(parsed);
      }
    } catch {
      // Ignore corrupt event lines; readback should be best-effort.
    }
  }
  return events;
}
