import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findWhatsAppContactByTarget,
  loadWhatsAppContactStore,
  recordWhatsAppContactObservation,
  resolveWhatsAppContactByName,
} from "./contacts.js";

const tempDirs: string[] = [];

function makeStorePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-whatsapp-contacts-"));
  tempDirs.push(dir);
  return path.join(dir, "contacts.json");
}

describe("WhatsApp contact observations", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records inbound and outbound contact activity", () => {
    const storePath = makeStorePath();
    recordWhatsAppContactObservation({
      accountId: "acct",
      e164: "+15551234567",
      jid: "15551234567@s.whatsapp.net",
      displayName: "Dom",
      conversationId: "+15551234567",
      direction: "inbound",
      storePath,
    });
    recordWhatsAppContactObservation({
      accountId: "acct",
      e164: "+15551234567",
      displayName: "Dominique",
      conversationId: "+15551234567",
      direction: "outbound",
      storePath,
    });

    const contact = findWhatsAppContactByTarget({
      accountId: "acct",
      target: "+1 (555) 123-4567",
      storePath,
    });
    expect(contact).toMatchObject({
      e164: "+15551234567",
      jid: "15551234567@s.whatsapp.net",
      displayName: "Dominique",
      displayNames: ["Dominique", "Dom"],
      inboundCount: 1,
      outboundCount: 1,
      conversationIds: ["+15551234567"],
    });
  });

  it("resolves unique display names and flags possible number changes", () => {
    const storePath = makeStorePath();
    recordWhatsAppContactObservation({
      accountId: "acct",
      e164: "+15550000001",
      displayName: "Matt Turner",
      storePath,
    });
    recordWhatsAppContactObservation({
      accountId: "acct",
      e164: "+15550000002",
      displayName: "Matt Turner",
      storePath,
    });

    const store = loadWhatsAppContactStore(storePath);
    expect(Object.values(store.contacts)).toHaveLength(2);
    expect(Object.values(store.contacts)[1]).toMatchObject({
      possiblePreviousE164s: ["+15550000001"],
    });
    expect(
      resolveWhatsAppContactByName({ accountId: "acct", query: "Matt Turner", storePath }),
    ).toMatchObject({ kind: "ambiguous" });
  });
});
