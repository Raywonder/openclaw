import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readWhatsAppMessagesFromTranscripts } from "./read-messages.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-whatsapp-read-"));
  tempDirs.push(dir);
  return dir;
}

function writeJsonl(file: string, lines: unknown[]) {
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");
}

describe("readWhatsAppMessagesFromTranscripts", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns recent transcript messages for a WhatsApp direct target", async () => {
    const dir = makeTempDir();
    const sessionFile = path.join(dir, "session.jsonl");
    const storePath = path.join(dir, "sessions.json");
    writeJsonl(sessionFile, [
      {
        type: "session",
        id: "session-1",
        timestamp: "2026-06-21T12:00:00.000Z",
      },
      {
        type: "message",
        id: "m1",
        timestamp: "2026-06-21T12:00:01.000Z",
        message: {
          role: "user",
          senderName: "Dom",
          content: "first",
          timestamp: Date.parse("2026-06-21T12:00:01.000Z"),
        },
      },
      {
        type: "message",
        id: "m2",
        timestamp: "2026-06-21T12:00:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "second" }],
          timestamp: Date.parse("2026-06-21T12:00:02.000Z"),
        },
      },
    ]);
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        "agent:main:main": {
          sessionId: "session-1",
          sessionFile,
          updatedAt: Date.now(),
          lastChannel: "whatsapp",
          lastTo: "+5551234567",
          lastAccountId: "acct",
        },
      }),
      "utf-8",
    );

    const result = await readWhatsAppMessagesFromTranscripts({
      target: "(555) 123-4567",
      accountId: "acct",
      storePath,
      limit: 1,
    });

    expect(result.details).toMatchObject({
      ok: true,
      source: "openclaw-session-transcripts",
      target: "+5551234567",
      messages: [{ id: "m2", authorTag: "assistant", text: "second" }],
    });
  });

  it("honors account scoping", async () => {
    const dir = makeTempDir();
    const sessionFile = path.join(dir, "session.jsonl");
    const storePath = path.join(dir, "sessions.json");
    writeJsonl(sessionFile, [
      {
        type: "message",
        id: "m1",
        timestamp: "2026-06-21T12:00:01.000Z",
        message: { role: "user", content: "hidden" },
      },
    ]);
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        "agent:main:main": {
          sessionId: "session-1",
          sessionFile,
          updatedAt: Date.now(),
          lastChannel: "whatsapp",
          lastTo: "+15551234567",
          lastAccountId: "other",
        },
      }),
      "utf-8",
    );

    const result = await readWhatsAppMessagesFromTranscripts({
      target: "+15551234567",
      accountId: "acct",
      storePath,
    });

    expect(result.details).toMatchObject({ ok: true, messages: [] });
  });
});
