import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { logVerbose } from "../globals.js";
import { jidToE164, normalizeE164, toWhatsappJid } from "../utils.js";

export type WhatsAppContactObservation = {
  accountId?: string | null;
  jid?: string | null;
  e164?: string | null;
  displayName?: string | null;
  conversationId?: string | null;
  chatType?: "direct" | "group" | null;
  direction?: "inbound" | "outbound";
  timestampMs?: number | null;
  storePath?: string;
};

export type WhatsAppContactRecord = {
  id: string;
  accountId: string;
  e164?: string;
  jid?: string;
  displayName?: string;
  displayNames: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  inboundCount: number;
  outboundCount: number;
  conversationIds: string[];
  possiblePreviousE164s?: string[];
  possiblePreviousJids?: string[];
};

export type WhatsAppContactStore = {
  version: 1;
  contacts: Record<string, WhatsAppContactRecord>;
};

const DEFAULT_ACCOUNT_ID = "default";

export function resolveWhatsAppContactsStorePath(): string {
  return path.join(resolveStateDir(), "whatsapp", "contacts.json");
}

function emptyStore(): WhatsAppContactStore {
  return { version: 1, contacts: {} };
}

export function loadWhatsAppContactStore(storePath = resolveWhatsAppContactsStorePath()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf-8")) as Partial<WhatsAppContactStore>;
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
      return emptyStore();
    }
    return {
      version: 1 as const,
      contacts: parsed.contacts && typeof parsed.contacts === "object" ? parsed.contacts : {},
    };
  } catch {
    return emptyStore();
  }
}

function saveWhatsAppContactStore(store: WhatsAppContactStore, storePath: string): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  fs.renameSync(tempPath, storePath);
}

function normalizeDisplayName(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/\s+/g, " ");
}

function displayKey(value?: string | null): string | undefined {
  const normalized = normalizeDisplayName(value);
  return normalized?.toLocaleLowerCase();
}

function normalizeContactE164(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.includes("@")) {
    return jidToE164(trimmed) ?? undefined;
  }
  const normalized = normalizeE164(trimmed);
  return normalized.length > 1 ? normalized : undefined;
}

function normalizeContactJid(value?: string | null, e164?: string): string | undefined {
  const trimmed = value?.trim();
  if (trimmed) {
    return trimmed;
  }
  return e164 ? toWhatsappJid(e164) : undefined;
}

function contactId(params: { accountId: string; e164?: string; jid?: string }): string {
  return `${params.accountId}:${params.e164 ?? params.jid ?? "unknown"}`;
}

function addUnique(list: string[], value?: string | null, max = 12): string[] {
  const normalized = normalizeDisplayName(value);
  if (!normalized) {
    return list;
  }
  const next = [normalized, ...list.filter((item) => item !== normalized)];
  return next.slice(0, max);
}

function addUniqueRaw(list: string[], value?: string | null, max = 50): string[] {
  const trimmed = value?.trim();
  if (!trimmed) {
    return list;
  }
  const next = [trimmed, ...list.filter((item) => item !== trimmed)];
  return next.slice(0, max);
}

function findSameNamePriorContacts(params: {
  store: WhatsAppContactStore;
  accountId: string;
  displayName?: string;
  e164?: string;
  jid?: string;
}): { e164s: string[]; jids: string[] } {
  const key = displayKey(params.displayName);
  if (!key) {
    return { e164s: [], jids: [] };
  }
  const e164s = new Set<string>();
  const jids = new Set<string>();
  for (const contact of Object.values(params.store.contacts)) {
    if (contact.accountId !== params.accountId) {
      continue;
    }
    if (contact.e164 && params.e164 && contact.e164 === params.e164) {
      continue;
    }
    if (contact.jid && params.jid && contact.jid === params.jid) {
      continue;
    }
    const names = [contact.displayName, ...contact.displayNames].map((name) => displayKey(name));
    if (!names.includes(key)) {
      continue;
    }
    if (contact.e164) {
      e164s.add(contact.e164);
    }
    if (contact.jid) {
      jids.add(contact.jid);
    }
  }
  return { e164s: [...e164s], jids: [...jids] };
}

export function recordWhatsAppContactObservation(input: WhatsAppContactObservation): void {
  const accountId = input.accountId?.trim() || DEFAULT_ACCOUNT_ID;
  const e164 = normalizeContactE164(input.e164 ?? input.jid);
  const jid = normalizeContactJid(input.jid, e164);
  const displayName = normalizeDisplayName(input.displayName);
  if (!e164 && !jid && !displayName) {
    return;
  }
  const storePath = input.storePath ?? resolveWhatsAppContactsStorePath();
  const store = loadWhatsAppContactStore(storePath);
  const id = contactId({ accountId, e164, jid });
  const now = new Date(input.timestampMs && input.timestampMs > 0 ? input.timestampMs : Date.now());
  const existing = store.contacts[id];
  const sameName = findSameNamePriorContacts({ store, accountId, displayName, e164, jid });
  const direction = input.direction ?? "inbound";
  const record: WhatsAppContactRecord = existing ?? {
    id,
    accountId,
    ...(e164 ? { e164 } : {}),
    ...(jid ? { jid } : {}),
    ...(displayName ? { displayName } : {}),
    displayNames: displayName ? [displayName] : [],
    firstSeenAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    inboundCount: 0,
    outboundCount: 0,
    conversationIds: [],
  };
  record.lastSeenAt = now.toISOString();
  record.e164 = record.e164 ?? e164;
  record.jid = record.jid ?? jid;
  if (displayName) {
    record.displayName = displayName;
    record.displayNames = addUnique(record.displayNames, displayName);
  }
  record.conversationIds = addUniqueRaw(record.conversationIds, input.conversationId, 30);
  if (direction === "outbound") {
    record.outboundCount += 1;
  } else {
    record.inboundCount += 1;
  }
  record.possiblePreviousE164s = sameName.e164s.length
    ? sameName.e164s
    : record.possiblePreviousE164s;
  record.possiblePreviousJids = sameName.jids.length ? sameName.jids : record.possiblePreviousJids;
  store.contacts[id] = record;
  try {
    saveWhatsAppContactStore(store, storePath);
  } catch (err) {
    logVerbose(`Failed to save WhatsApp contact observation: ${String(err)}`);
  }
}

export function findWhatsAppContactByTarget(params: {
  target: string;
  accountId?: string | null;
  storePath?: string;
}): WhatsAppContactRecord | undefined {
  const accountId = params.accountId?.trim() || DEFAULT_ACCOUNT_ID;
  const e164 = normalizeContactE164(params.target);
  const jid = normalizeContactJid(params.target, e164);
  const store = loadWhatsAppContactStore(params.storePath);
  return Object.values(store.contacts).find(
    (contact) =>
      contact.accountId === accountId &&
      ((e164 && contact.e164 === e164) || (jid && contact.jid === jid)),
  );
}

export function resolveWhatsAppContactByName(params: {
  query: string;
  accountId?: string | null;
  storePath?: string;
}):
  | { kind: "none" }
  | { kind: "single"; contact: WhatsAppContactRecord }
  | {
      kind: "ambiguous";
      contacts: WhatsAppContactRecord[];
    } {
  const accountId = params.accountId?.trim() || DEFAULT_ACCOUNT_ID;
  const key = displayKey(params.query);
  if (!key) {
    return { kind: "none" };
  }
  const store = loadWhatsAppContactStore(params.storePath);
  const matches = Object.values(store.contacts).filter((contact) => {
    if (contact.accountId !== accountId) {
      return false;
    }
    const names = [contact.displayName, ...contact.displayNames].map((name) => displayKey(name));
    return names.includes(key);
  });
  if (matches.length === 0) {
    return { kind: "none" };
  }
  if (matches.length === 1) {
    return { kind: "single", contact: matches[0] };
  }
  return { kind: "ambiguous", contacts: matches };
}
