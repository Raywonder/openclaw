import "./test-helpers.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../agents/pi-embedded.js", () => ({
  abortEmbeddedPiRun: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunActive: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunStreaming: vi.fn().mockReturnValue(false),
  runEmbeddedPiAgent: vi.fn(),
  queueEmbeddedPiMessage: vi.fn().mockReturnValue(false),
  resolveEmbeddedSessionLane: (key: string) => `session:${key.trim() || "main"}`,
}));

import { resetInboundDedupe } from "../auto-reply/reply/inbound-dedupe.js";
import { resetLogger, setLoggerOverride } from "../logging.js";
import { monitorWebChannel } from "./auto-reply.js";
import { resetBaileysMocks, resetLoadConfigMock, setLoadConfigMock } from "./test-helpers.js";

let previousHome: string | undefined;
let tempHome: string | undefined;

const rmDirWithRetries = async (dir: string): Promise<void> => {
  // Some tests can leave async session-store writes in-flight; recursive deletion can race and throw ENOTEMPTY.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code)
          : null;
      if (code === "ENOTEMPTY" || code === "EBUSY" || code === "EPERM") {
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }
      throw err;
    }
  }

  await fs.rm(dir, { recursive: true, force: true });
};

beforeEach(async () => {
  resetInboundDedupe();
  previousHome = process.env.HOME;
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-web-home-"));
  process.env.HOME = tempHome;
});

afterEach(async () => {
  process.env.HOME = previousHome;
  if (tempHome) {
    await rmDirWithRetries(tempHome);
    tempHome = undefined;
  }
});

const _makeSessionStore = async (
  entries: Record<string, unknown> = {},
): Promise<{ storePath: string; cleanup: () => Promise<void> }> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-session-"));
  const storePath = path.join(dir, "sessions.json");
  await fs.writeFile(storePath, JSON.stringify(entries));
  const cleanup = async () => {
    // Session store writes can be in-flight when the test finishes (e.g. updateLastRoute
    // after a message flush). `fs.rm({ recursive })` can race and throw ENOTEMPTY.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
        return;
      } catch (err) {
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code?: unknown }).code)
            : null;
        if (code === "ENOTEMPTY" || code === "EBUSY" || code === "EPERM") {
          await new Promise((resolve) => setTimeout(resolve, 25));
          continue;
        }
        throw err;
      }
    }

    await fs.rm(dir, { recursive: true, force: true });
  };
  return {
    storePath,
    cleanup,
  };
};

describe("web auto-reply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBaileysMocks();
    resetLoadConfigMock();
  });

  afterEach(() => {
    resetLogger();
    setLoggerOverride(null);
    vi.useRealTimers();
  });

  it("requires mention in group chats and injects history when replying", async () => {
    const sendMedia = vi.fn();
    const reply = vi.fn().mockResolvedValue(undefined);
    const sendComposing = vi.fn();
    const resolver = vi.fn().mockResolvedValue({ text: "ok" });

    let capturedOnMessage:
      | ((msg: import("./inbound.js").WebInboundMessage) => Promise<void>)
      | undefined;
    const listenerFactory = async (opts: {
      onMessage: (msg: import("./inbound.js").WebInboundMessage) => Promise<void>;
    }) => {
      capturedOnMessage = opts.onMessage;
      return { close: vi.fn() };
    };

    await monitorWebChannel(false, listenerFactory, false, resolver);
    expect(capturedOnMessage).toBeDefined();

    await capturedOnMessage?.({
      body: "hello group",
      from: "123@g.us",
      conversationId: "123@g.us",
      chatId: "123@g.us",
      chatType: "group",
      to: "+2",
      id: "g1",
      senderE164: "+111",
      senderName: "Alice",
      selfE164: "+999",
      sendComposing,
      reply,
      sendMedia,
    });

    expect(resolver).not.toHaveBeenCalled();

    await capturedOnMessage?.({
      body: "@bot ping",
      from: "123@g.us",
      conversationId: "123@g.us",
      chatId: "123@g.us",
      chatType: "group",
      to: "+2",
      id: "g2",
      senderE164: "+222",
      senderName: "Bob",
      mentionedJids: ["999@s.whatsapp.net"],
      selfE164: "+999",
      selfJid: "999@s.whatsapp.net",
      sendComposing,
      reply,
      sendMedia,
    });

    expect(resolver).toHaveBeenCalledTimes(1);
    const payload = resolver.mock.calls[0][0];
    expect(payload.Body).toContain("Chat messages since your last reply");
    expect(payload.Body).toContain("Alice (+111): hello group");
    expect(payload.Body).toContain("[message_id: g1]");
    expect(payload.Body).toContain("@bot ping");
    expect(payload.SenderName).toBe("Bob");
    expect(payload.SenderE164).toBe("+222");
    expect(payload.SenderId).toBe("+222");
  });

  it("bypasses mention gating for owner /new in group chats", async () => {
    const sendMedia = vi.fn();
    const reply = vi.fn().mockResolvedValue(undefined);
    const sendComposing = vi.fn();
    const resolver = vi.fn().mockResolvedValue({ text: "ok" });

    let capturedOnMessage:
      | ((msg: import("./inbound.js").WebInboundMessage) => Promise<void>)
      | undefined;
    const listenerFactory = async (opts: {
      onMessage: (msg: import("./inbound.js").WebInboundMessage) => Promise<void>;
    }) => {
      capturedOnMessage = opts.onMessage;
      return { close: vi.fn() };
    };

    setLoadConfigMock(() => ({
      channels: {
        whatsapp: {
          allowFrom: ["+111"],
        },
      },
    }));

    await monitorWebChannel(false, listenerFactory, false, resolver);
    expect(capturedOnMessage).toBeDefined();

    await capturedOnMessage?.({
      body: "/new",
      from: "123@g.us",
      conversationId: "123@g.us",
      chatId: "123@g.us",
      chatType: "group",
      to: "+2",
      id: "g-new",
      senderE164: "+111",
      senderName: "Owner",
      selfE164: "+999",
      sendComposing,
      reply,
      sendMedia,
    });

    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("does not bypass mention gating for non-owner /new in group chats", async () => {
    const sendMedia = vi.fn();
    const reply = vi.fn().mockResolvedValue(undefined);
    const sendComposing = vi.fn();
    const resolver = vi.fn().mockResolvedValue({ text: "ok" });

    let capturedOnMessage:
      | ((msg: import("./inbound.js").WebInboundMessage) => Promise<void>)
      | undefined;
    const listenerFactory = async (opts: {
      onMessage: (msg: import("./inbound.js").WebInboundMessage) => Promise<void>;
    }) => {
      capturedOnMessage = opts.onMessage;
      return { close: vi.fn() };
    };

    setLoadConfigMock(() => ({
      channels: {
        whatsapp: {
          allowFrom: ["+999"],
        },
      },
    }));

    await monitorWebChannel(false, listenerFactory, false, resolver);
    expect(capturedOnMessage).toBeDefined();

    await capturedOnMessage?.({
      body: "/new",
      from: "123@g.us",
      conversationId: "123@g.us",
      chatId: "123@g.us",
      chatType: "group",
      to: "+2",
      id: "g-new-unauth",
      senderE164: "+111",
      senderName: "NotOwner",
      selfE164: "+999",
      sendComposing,
      reply,
      sendMedia,
    });

    expect(resolver).not.toHaveBeenCalled();
  });

  it("bypasses mention gating for owner /status in group chats", async () => {
    const sendMedia = vi.fn();
    const reply = vi.fn().mockResolvedValue(undefined);
    const sendComposing = vi.fn();
    const resolver = vi.fn().mockResolvedValue({ text: "ok" });

    let capturedOnMessage:
      | ((msg: import("./inbound.js").WebInboundMessage) => Promise<void>)
      | undefined;
    const listenerFactory = async (opts: {
      onMessage: (msg: import("./inbound.js").WebInboundMessage) => Promise<void>;
    }) => {
      capturedOnMessage = opts.onMessage;
      return { close: vi.fn() };
    };

    setLoadConfigMock(() => ({
      channels: {
        whatsapp: {
          allowFrom: ["+111"],
        },
      },
    }));

    await monitorWebChannel(false, listenerFactory, false, resolver);
    expect(capturedOnMessage).toBeDefined();

    await capturedOnMessage?.({
      body: "/status",
      from: "123@g.us",
      conversationId: "123@g.us",
      chatId: "123@g.us",
      chatType: "group",
      to: "+2",
      id: "g-status",
      senderE164: "+111",
      senderName: "Owner",
      selfE164: "+999",
      sendComposing,
      reply,
      sendMedia,
    });

    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("passes conversation id through as From for group replies", async () => {
    const sendMedia = vi.fn();
    const reply = vi.fn().mockResolvedValue(undefined);
    const sendComposing = vi.fn();
    const resolver = vi.fn().mockResolvedValue({ text: "ok" });

    let capturedOnMessage:
      | ((msg: import("./inbound.js").WebInboundMessage) => Promise<void>)
      | undefined;
    const listenerFactory = async (opts: {
      onMessage: (msg: import("./inbound.js").WebInboundMessage) => Promise<void>;
    }) => {
      capturedOnMessage = opts.onMessage;
      return { close: vi.fn() };
    };

    await monitorWebChannel(false, listenerFactory, false, resolver);
    expect(capturedOnMessage).toBeDefined();

    await capturedOnMessage?.({
      body: "@bot ping",
      from: "123@g.us",
      conversationId: "123@g.us",
      chatId: "123@g.us",
      chatType: "group",
      to: "+2",
      id: "g1",
      senderE164: "+222",
      senderName: "Bob",
      mentionedJids: ["999@s.whatsapp.net"],
      selfE164: "+999",
      selfJid: "999@s.whatsapp.net",
      sendComposing,
      reply,
      sendMedia,
    });

    const payload = resolver.mock.calls[0]?.[0] as { From?: string; To?: string };
    expect(payload.From).toBe("123@g.us");
    expect(payload.To).toBe("+2");
  });
  it("detects LID mentions using authDir mapping", async () => {
    const sendMedia = vi.fn();
    const reply = vi.fn().mockResolvedValue(undefined);
    const sendComposing = vi.fn();
    const resolver = vi.fn().mockResolvedValue({ text: "ok" });

    let capturedOnMessage:
      | ((msg: import("./inbound.js").WebInboundMessage) => Promise<void>)
      | undefined;
    const listenerFactory = async (opts: {
      onMessage: (msg: import("./inbound.js").WebInboundMessage) => Promise<void>;
    }) => {
      capturedOnMessage = opts.onMessage;
      return { close: vi.fn() };
    };

    const authDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-wa-auth-"));

    try {
      await fs.writeFile(
        path.join(authDir, "lid-mapping-555_reverse.json"),
        JSON.stringify("15551234"),
      );

      setLoadConfigMock(() => ({
        channels: {
          whatsapp: {
            allowFrom: ["*"],
            accounts: {
              default: { authDir },
            },
          },
        },
      }));

      await monitorWebChannel(false, listenerFactory, false, resolver);
      expect(capturedOnMessage).toBeDefined();

      await capturedOnMessage?.({
        body: "hello group",
        from: "123@g.us",
        conversationId: "123@g.us",
        chatId: "123@g.us",
        chatType: "group",
        to: "+2",
        id: "g1",
        senderE164: "+111",
        senderName: "Alice",
        selfE164: "+15551234",
        sendComposing,
        reply,
        sendMedia,
      });

      await capturedOnMessage?.({
        body: "@bot ping",
        from: "123@g.us",
        conversationId: "123@g.us",
        chatId: "123@g.us",
        chatType: "group",
        to: "+2",
        id: "g2",
        senderE164: "+222",
        senderName: "Bob",
        mentionedJids: ["555@lid"],
        selfE164: "+15551234",
        selfJid: "15551234@s.whatsapp.net",
        sendComposing,
        reply,
        sendMedia,
      });

      expect(resolver).toHaveBeenCalledTimes(1);
    } finally {
      resetLoadConfigMock();
      await rmDirWithRetries(authDir);
    }
  });
  it("derives self E.164 from LID selfJid for mention gating", async () => {
    const sendMedia = vi.fn();
    const reply = vi.fn().mockResolvedValue(undefined);
    const sendComposing = vi.fn();
    const resolver = vi.fn().mockResolvedValue({ text: "ok" });

    let capturedOnMessage:
      | ((msg: import("./inbound.js").WebInboundMessage) => Promise<void>)
      | undefined;
    const listenerFactory = async (opts: {
      onMessage: (msg: import("./inbound.js").WebInboundMessage) => Promise<void>;
    }) => {
      capturedOnMessage = opts.onMessage;
      return { close: vi.fn() };
    };

    const authDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-wa-auth-"));

    try {
      await fs.writeFile(
        path.join(authDir, "lid-mapping-777_reverse.json"),
        JSON.stringify("15550077"),
      );

      setLoadConfigMock(() => ({
        channels: {
          whatsapp: {
            allowFrom: ["*"],
            accounts: {
              default: { authDir },
            },
          },
        },
      }));

      await monitorWebChannel(false, listenerFactory, false, resolver);
      expect(capturedOnMessage).toBeDefined();

      await capturedOnMessage?.({
        body: "@bot ping",
        from: "123@g.us",
        conversationId: "123@g.us",
        chatId: "123@g.us",
        chatType: "group",
        to: "+2",
        id: "g3",
        senderE164: "+333",
        senderName: "Cara",
        mentionedJids: ["777@lid"],
        selfJid: "777@lid",
        sendComposing,
        reply,
        sendMedia,
      });

      expect(resolver).toHaveBeenCalledTimes(1);
    } finally {
      resetLoadConfigMock();
      await rmDirWithRetries(authDir);
    }
  });
  it("sets OriginatingTo to the sender for queued routing", async () => {
    const sendMedia = vi.fn();
    const reply = vi.fn().mockResolvedValue(undefined);
    const sendComposing = vi.fn();
    const resolver = vi.fn().mockResolvedValue({ text: "ok" });

    let capturedOnMessage:
      | ((msg: import("./inbound.js").WebInboundMessage) => Promise<void>)
      | undefined;
    const listenerFactory = async (opts: {
      onMessage: (msg: import("./inbound.js").WebInboundMessage) => Promise<void>;
    }) => {
      capturedOnMessage = opts.onMessage;
      return { close: vi.fn() };
    };

    await monitorWebChannel(false, listenerFactory, false, resolver);
    expect(capturedOnMessage).toBeDefined();

    await capturedOnMessage?.({
      body: "hello",
      from: "+15551234567",
      to: "+19998887777",
      id: "m-originating",
      sendComposing,
      reply,
      sendMedia,
    });

    expect(resolver).toHaveBeenCalledTimes(1);
    const payload = resolver.mock.calls[0][0];
    expect(payload.OriginatingChannel).toBe("whatsapp");
    expect(payload.OriginatingTo).toBe("+15551234567");
    expect(payload.To).toBe("+19998887777");
    expect(payload.OriginatingTo).not.toBe(payload.To);
  });

  it("routes direct WhatsApp handle messages to the requested agent", async () => {
    const sendMedia = vi.fn();
    const reply = vi.fn().mockResolvedValue(undefined);
    const sendComposing = vi.fn();
    const resolver = vi.fn().mockResolvedValue({ text: "ok" });

    let capturedOnMessage:
      | ((msg: import("./inbound.js").WebInboundMessage) => Promise<void>)
      | undefined;
    const listenerFactory = async (opts: {
      onMessage: (msg: import("./inbound.js").WebInboundMessage) => Promise<void>;
    }) => {
      capturedOnMessage = opts.onMessage;
      return { close: vi.fn() };
    };

    setLoadConfigMock(() => ({
      agents: {
        list: [{ id: "main", default: true }, { id: "codex" }],
      },
      channels: {
        whatsapp: {
          allowFrom: ["*"],
        },
      },
    }));

    await monitorWebChannel(false, listenerFactory, false, resolver);
    expect(capturedOnMessage).toBeDefined();

    await capturedOnMessage?.({
      body: "@Codex status",
      from: "+15551234567",
      conversationId: "+15551234567",
      chatId: "direct:+15551234567",
      chatType: "direct",
      to: "+19998887777",
      id: "codex-direct",
      senderE164: "+15551234567",
      senderName: "Dominique",
      selfE164: "+19998887777",
      sendComposing,
      reply,
      sendMedia,
    });

    expect(resolver).toHaveBeenCalledTimes(1);
    const payload = resolver.mock.calls[0][0];
    expect(payload.SessionKey).toBe("agent:codex:main");
    expect(payload.DirectAgentHandle).toBe("@codex");
    expect(payload.DirectAgentTarget).toBe("codex");
  });

  it("keeps ordinary direct WhatsApp messages on the normal agent route", async () => {
    const sendMedia = vi.fn();
    const reply = vi.fn().mockResolvedValue(undefined);
    const sendComposing = vi.fn();
    const resolver = vi.fn().mockResolvedValue({ text: "ok" });

    let capturedOnMessage:
      | ((msg: import("./inbound.js").WebInboundMessage) => Promise<void>)
      | undefined;
    const listenerFactory = async (opts: {
      onMessage: (msg: import("./inbound.js").WebInboundMessage) => Promise<void>;
    }) => {
      capturedOnMessage = opts.onMessage;
      return { close: vi.fn() };
    };

    setLoadConfigMock(() => ({
      agents: {
        list: [{ id: "main", default: true }, { id: "codex" }],
      },
      channels: {
        whatsapp: {
          allowFrom: ["*"],
        },
      },
    }));

    await monitorWebChannel(false, listenerFactory, false, resolver);
    expect(capturedOnMessage).toBeDefined();

    await capturedOnMessage?.({
      body: "hello Clawdia",
      from: "+15551234567",
      conversationId: "+15551234567",
      chatId: "direct:+15551234567",
      chatType: "direct",
      to: "+19998887777",
      id: "normal-direct",
      senderE164: "+15551234567",
      senderName: "Dominique",
      selfE164: "+19998887777",
      sendComposing,
      reply,
      sendMedia,
    });

    expect(resolver).toHaveBeenCalledTimes(1);
    const payload = resolver.mock.calls[0][0];
    expect(payload.SessionKey).toBe("agent:main:main");
    expect(payload.DirectAgentHandle).toBeUndefined();
    expect(payload.DirectAgentTarget).toBeUndefined();
  });

  it("injects rolling direct-chat context including Clawdia replies", async () => {
    const sendMedia = vi.fn();
    const reply = vi.fn().mockResolvedValue(undefined);
    const sendComposing = vi.fn();
    const resolver = vi
      .fn()
      .mockResolvedValueOnce({ text: "I can help with that." })
      .mockResolvedValueOnce({ text: "Still with you." });

    let capturedOnMessage:
      | ((msg: import("./inbound.js").WebInboundMessage) => Promise<void>)
      | undefined;
    const listenerFactory = async (opts: {
      onMessage: (msg: import("./inbound.js").WebInboundMessage) => Promise<void>;
    }) => {
      capturedOnMessage = opts.onMessage;
      return { close: vi.fn() };
    };

    await monitorWebChannel(false, listenerFactory, false, resolver);
    expect(capturedOnMessage).toBeDefined();

    await capturedOnMessage?.({
      body: "Clawdia, help me with the server",
      from: "+13364626141",
      to: "+13364626141",
      id: "dm1",
      timestamp: 1_770_000_000_000,
      senderE164: "+13364626141",
      senderName: "Dominique",
      selfE164: "+13364626141",
      sendComposing,
      reply,
      sendMedia,
    });

    await capturedOnMessage?.({
      body: "what did I just ask you?",
      from: "+13364626141",
      to: "+13364626141",
      id: "dm2",
      timestamp: 1_770_000_060_000,
      senderE164: "+13364626141",
      senderName: "Dominique",
      selfE164: "+13364626141",
      sendComposing,
      reply,
      sendMedia,
    });

    expect(resolver).toHaveBeenCalledTimes(2);
    const secondPayload = resolver.mock.calls[1][0];
    expect(secondPayload.Body).toContain("Chat messages since your last reply");
    expect(secondPayload.Body).toContain("Clawdia, help me with the server");
    expect(secondPayload.Body).toContain("I can help with that.");
    expect(secondPayload.Body).toContain("what did I just ask you?");
  });

  it("suppresses repeated transient model failure notices in one chat", async () => {
    const sendMedia = vi.fn();
    const reply = vi.fn().mockResolvedValue(undefined);
    const sendComposing = vi.fn();
    const resolver = vi.fn().mockResolvedValue({
      text: "I’m having trouble reaching my chat model right now. I saved the thread context and will pick back up from here once the model connection is healthy.",
    });

    let capturedOnMessage:
      | ((msg: import("./inbound.js").WebInboundMessage) => Promise<void>)
      | undefined;
    const listenerFactory = async (opts: {
      onMessage: (msg: import("./inbound.js").WebInboundMessage) => Promise<void>;
    }) => {
      capturedOnMessage = opts.onMessage;
      return { close: vi.fn() };
    };

    await monitorWebChannel(false, listenerFactory, false, resolver);
    expect(capturedOnMessage).toBeDefined();

    const baseMessage = {
      from: "+15550000001",
      to: "+13364626141",
      timestamp: 1_770_000_000_000,
      senderE164: "+15550000001",
      senderName: "Dominique",
      selfE164: "+13364626141",
      sendComposing,
      reply,
      sendMedia,
    };

    await capturedOnMessage?.({
      ...baseMessage,
      body: "hello",
      id: "failure-1",
    });
    await capturedOnMessage?.({
      ...baseMessage,
      body: "hello again",
      id: "failure-2",
      timestamp: 1_770_000_060_000,
    });

    expect(resolver).toHaveBeenCalledTimes(2);
    expect(reply).toHaveBeenCalledTimes(1);
  });
});
