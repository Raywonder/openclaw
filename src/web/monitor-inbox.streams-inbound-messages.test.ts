import { vi } from "vitest";

vi.mock("../media/store.js", () => ({
  saveMediaBuffer: vi.fn().mockResolvedValue({
    id: "mid",
    path: "/tmp/mid",
    size: 1,
    contentType: "image/jpeg",
  }),
}));

const mockLoadConfig = vi.fn().mockReturnValue({
  channels: {
    whatsapp: {
      // Allow all in tests by default
      allowFrom: ["*"],
    },
  },
  messages: {
    messagePrefix: undefined,
    responsePrefix: undefined,
  },
});

const readAllowFromStoreMock = vi.fn().mockResolvedValue([]);
const upsertPairingRequestMock = vi.fn().mockResolvedValue({ code: "PAIRCODE", created: true });
const recordWhatsAppEventMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => mockLoadConfig(),
  };
});

vi.mock("../pairing/pairing-store.js", () => ({
  readChannelAllowFromStore: (...args: unknown[]) => readAllowFromStoreMock(...args),
  upsertChannelPairingRequest: (...args: unknown[]) => upsertPairingRequestMock(...args),
}));

vi.mock("../whatsapp/events.js", () => ({
  recordWhatsAppEvent: (...args: unknown[]) => recordWhatsAppEventMock(...args),
}));

vi.mock("./session.js", () => {
  const { EventEmitter } = require("node:events");
  const ev = new EventEmitter();
  const sock = {
    ev,
    ws: { close: vi.fn() },
    sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    readMessages: vi.fn().mockResolvedValue(undefined),
    updateMediaMessage: vi.fn(),
    logger: {},
    signalRepository: {
      lidMapping: {
        getPNForLID: vi.fn().mockResolvedValue(null),
      },
    },
    user: { id: "123@s.whatsapp.net" },
  };
  return {
    createWaSocket: vi.fn().mockResolvedValue(sock),
    waitForWaConnection: vi.fn().mockResolvedValue(undefined),
    getStatusCode: vi.fn(() => 500),
  };
});

const { createWaSocket } = await import("./session.js");
const _getSock = () => (createWaSocket as unknown as () => Promise<ReturnType<typeof mockSock>>)();

import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetLogger, setLoggerOverride } from "../logging.js";
import { monitorWebInbox, resetWebInboundDedupe } from "./inbound.js";

const ACCOUNT_ID = "default";
let authDir: string;

describe("web monitor inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readAllowFromStoreMock.mockResolvedValue([]);
    recordWhatsAppEventMock.mockClear();
    upsertPairingRequestMock.mockResolvedValue({
      code: "PAIRCODE",
      created: true,
    });
    resetWebInboundDedupe();
    authDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "openclaw-auth-"));
  });

  afterEach(() => {
    resetLogger();
    setLoggerOverride(null);
    vi.useRealTimers();
    fsSync.rmSync(authDir, { recursive: true, force: true });
  });

  it("streams inbound messages", async () => {
    const onMessage = vi.fn(async (msg) => {
      await msg.sendComposing();
      await msg.reply("pong");
    });

    const listener = await monitorWebInbox({
      verbose: false,
      onMessage,
      accountId: ACCOUNT_ID,
      authDir,
    });
    const sock = await createWaSocket();
    expect(sock.sendPresenceUpdate).toHaveBeenCalledWith("available");
    const upsert = {
      type: "notify",
      messages: [
        {
          key: { id: "abc", fromMe: false, remoteJid: "999@s.whatsapp.net" },
          message: { conversation: "ping" },
          messageTimestamp: 1_700_000_000,
          pushName: "Tester",
        },
      ],
    };

    sock.ev.emit("messages.upsert", upsert);
    await new Promise((resolve) => setImmediate(resolve));

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ body: "ping", from: "+999", to: "+123" }),
    );
    expect(sock.readMessages).toHaveBeenCalledWith([
      {
        remoteJid: "999@s.whatsapp.net",
        id: "abc",
        participant: undefined,
        fromMe: false,
      },
    ]);
    expect(sock.sendPresenceUpdate).toHaveBeenCalledWith("available");
    expect(sock.sendPresenceUpdate).toHaveBeenCalledWith("composing", "999@s.whatsapp.net");
    expect(sock.sendMessage).toHaveBeenCalledWith("999@s.whatsapp.net", {
      text: "pong",
    });

    await listener.close();
  });

  it("records WhatsApp edit/delete and group management events without dispatching messages", async () => {
    const onMessage = vi.fn(async () => {
      return;
    });

    const listener = await monitorWebInbox({
      verbose: false,
      onMessage,
      accountId: ACCOUNT_ID,
      authDir,
    });
    const sock = await createWaSocket();

    sock.ev.emit("messages.update", [
      {
        key: { id: "abc", remoteJid: "999@s.whatsapp.net" },
        update: {
          message: {
            protocolMessage: {
              type: 14,
              key: { id: "abc", remoteJid: "999@s.whatsapp.net" },
              editedMessage: { conversation: "edited text" },
            },
          },
        },
      },
    ]);
    sock.ev.emit("groups.update", [{ id: "123@g.us", subject: "New Subject" }]);
    sock.ev.emit("group-participants.update", {
      id: "123@g.us",
      participants: ["111@s.whatsapp.net"],
      action: "add",
      author: "222@s.whatsapp.net",
    });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(onMessage).not.toHaveBeenCalled();
    expect(recordWhatsAppEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        chatId: "999@s.whatsapp.net",
        chatType: "direct",
        eventType: "message_edited",
        text: "Message edited: edited text",
      }),
    );
    expect(recordWhatsAppEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "123@g.us",
        chatType: "group",
        eventType: "group_updated",
        text: 'Group updated: subject changed to "New Subject"',
      }),
    );
    expect(recordWhatsAppEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "123@g.us",
        chatType: "group",
        eventType: "group_participants_updated",
        actor: "+222",
        targets: ["+111"],
        text: "Group participants add: +111",
      }),
    );

    await listener.close();
  });

  it("deduplicates redelivered messages by id", async () => {
    const onMessage = vi.fn(async () => {
      return;
    });

    const listener = await monitorWebInbox({
      verbose: false,
      onMessage,
      accountId: ACCOUNT_ID,
      authDir,
    });
    const sock = await createWaSocket();
    const upsert = {
      type: "notify",
      messages: [
        {
          key: { id: "abc", fromMe: false, remoteJid: "999@s.whatsapp.net" },
          message: { conversation: "ping" },
          messageTimestamp: 1_700_000_000,
          pushName: "Tester",
        },
      ],
    };

    sock.ev.emit("messages.upsert", upsert);
    sock.ev.emit("messages.upsert", upsert);
    await new Promise((resolve) => setImmediate(resolve));

    expect(onMessage).toHaveBeenCalledTimes(1);

    await listener.close();
  });

  it("resolves LID JIDs using Baileys LID mapping store", async () => {
    const onMessage = vi.fn(async () => {
      return;
    });

    const listener = await monitorWebInbox({
      verbose: false,
      onMessage,
      accountId: ACCOUNT_ID,
      authDir,
    });
    const sock = await createWaSocket();
    const getPNForLID = vi.spyOn(sock.signalRepository.lidMapping, "getPNForLID");
    sock.signalRepository.lidMapping.getPNForLID.mockResolvedValueOnce("999:0@s.whatsapp.net");
    const upsert = {
      type: "notify",
      messages: [
        {
          key: { id: "abc", fromMe: false, remoteJid: "999@lid" },
          message: { conversation: "ping" },
          messageTimestamp: 1_700_000_000,
          pushName: "Tester",
        },
      ],
    };

    sock.ev.emit("messages.upsert", upsert);
    await new Promise((resolve) => setImmediate(resolve));

    expect(getPNForLID).toHaveBeenCalledWith("999@lid");
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ body: "ping", from: "+999", to: "+123" }),
    );

    await listener.close();
  });

  it("resolves LID JIDs via authDir mapping files", async () => {
    const onMessage = vi.fn(async () => {
      return;
    });
    fsSync.writeFileSync(
      path.join(authDir, "lid-mapping-555_reverse.json"),
      JSON.stringify("1555"),
    );

    const listener = await monitorWebInbox({
      verbose: false,
      onMessage,
      accountId: ACCOUNT_ID,
      authDir,
    });
    const sock = await createWaSocket();
    const getPNForLID = vi.spyOn(sock.signalRepository.lidMapping, "getPNForLID");
    const upsert = {
      type: "notify",
      messages: [
        {
          key: { id: "abc", fromMe: false, remoteJid: "555@lid" },
          message: { conversation: "ping" },
          messageTimestamp: 1_700_000_000,
          pushName: "Tester",
        },
      ],
    };

    sock.ev.emit("messages.upsert", upsert);
    await new Promise((resolve) => setImmediate(resolve));

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ body: "ping", from: "+1555", to: "+123" }),
    );
    expect(getPNForLID).not.toHaveBeenCalled();

    await listener.close();
  });

  it("resolves group participant LID JIDs via Baileys mapping", async () => {
    const onMessage = vi.fn(async () => {
      return;
    });

    const listener = await monitorWebInbox({
      verbose: false,
      onMessage,
      accountId: ACCOUNT_ID,
      authDir,
    });
    const sock = await createWaSocket();
    const getPNForLID = vi.spyOn(sock.signalRepository.lidMapping, "getPNForLID");
    sock.signalRepository.lidMapping.getPNForLID.mockResolvedValueOnce("444:0@s.whatsapp.net");
    const upsert = {
      type: "notify",
      messages: [
        {
          key: {
            id: "abc",
            fromMe: false,
            remoteJid: "123@g.us",
            participant: "444@lid",
          },
          message: { conversation: "ping" },
          messageTimestamp: 1_700_000_000,
        },
      ],
    };

    sock.ev.emit("messages.upsert", upsert);
    await new Promise((resolve) => setImmediate(resolve));

    expect(getPNForLID).toHaveBeenCalledWith("444@lid");
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "ping",
        from: "123@g.us",
        senderE164: "+444",
        chatType: "group",
      }),
    );

    await listener.close();
  });

  it("does not block follow-up messages when handler is pending", async () => {
    let resolveFirst: (() => void) | null = null;
    const onMessage = vi.fn(async () => {
      if (!resolveFirst) {
        await new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
      }
    });

    const listener = await monitorWebInbox({
      verbose: false,
      onMessage,
      accountId: ACCOUNT_ID,
      authDir,
    });
    const sock = await createWaSocket();
    const upsert = {
      type: "notify",
      messages: [
        {
          key: { id: "abc1", fromMe: false, remoteJid: "999@s.whatsapp.net" },
          message: { conversation: "ping" },
          messageTimestamp: 1_700_000_000,
        },
        {
          key: { id: "abc2", fromMe: false, remoteJid: "999@s.whatsapp.net" },
          message: { conversation: "pong" },
          messageTimestamp: 1_700_000_001,
        },
      ],
    };

    sock.ev.emit("messages.upsert", upsert);
    await new Promise((resolve) => setImmediate(resolve));

    expect(onMessage).toHaveBeenCalledTimes(2);

    resolveFirst?.();
    await listener.close();
  });

  it("captures reply context from quoted messages", async () => {
    const onMessage = vi.fn(async (msg) => {
      await msg.reply("pong");
    });

    const listener = await monitorWebInbox({ verbose: false, onMessage });
    const sock = await createWaSocket();
    const upsert = {
      type: "notify",
      messages: [
        {
          key: { id: "abc", fromMe: false, remoteJid: "999@s.whatsapp.net" },
          message: {
            extendedTextMessage: {
              text: "reply",
              contextInfo: {
                stanzaId: "q1",
                participant: "111@s.whatsapp.net",
                quotedMessage: { conversation: "original" },
              },
            },
          },
          messageTimestamp: 1_700_000_000,
          pushName: "Tester",
        },
      ],
    };

    sock.ev.emit("messages.upsert", upsert);
    await new Promise((resolve) => setImmediate(resolve));

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        replyToId: "q1",
        replyToBody: "original",
        replyToSender: "+111",
      }),
    );
    expect(sock.sendMessage).toHaveBeenCalledWith("999@s.whatsapp.net", {
      text: "pong",
    });

    await listener.close();
  });

  it("captures reply context from wrapped quoted messages", async () => {
    const onMessage = vi.fn(async (msg) => {
      await msg.reply("pong");
    });

    const listener = await monitorWebInbox({ verbose: false, onMessage });
    const sock = await createWaSocket();
    const upsert = {
      type: "notify",
      messages: [
        {
          key: { id: "abc", fromMe: false, remoteJid: "999@s.whatsapp.net" },
          message: {
            extendedTextMessage: {
              text: "reply",
              contextInfo: {
                stanzaId: "q1",
                participant: "111@s.whatsapp.net",
                quotedMessage: {
                  viewOnceMessageV2Extension: {
                    message: { conversation: "original" },
                  },
                },
              },
            },
          },
          messageTimestamp: 1_700_000_000,
          pushName: "Tester",
        },
      ],
    };

    sock.ev.emit("messages.upsert", upsert);
    await new Promise((resolve) => setImmediate(resolve));

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        replyToId: "q1",
        replyToBody: "original",
        replyToSender: "+111",
      }),
    );
    expect(sock.sendMessage).toHaveBeenCalledWith("999@s.whatsapp.net", {
      text: "pong",
    });

    await listener.close();
  });
});
