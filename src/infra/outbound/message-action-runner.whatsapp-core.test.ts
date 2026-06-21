import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { setActivePluginRegistry } from "../../plugins/runtime.js";
import { createTestRegistry } from "../../test-utils/channel-plugins.js";
import { setActiveWebListener } from "../../web/active-listener.js";
import { runMessageAction } from "./message-action-runner.js";

describe("runMessageAction WhatsApp core actions", () => {
  const sendComposingTo = vi.fn(async () => {});
  const sendMessage = vi.fn(async () => ({ messageId: "attachment-1" }));
  const sendPoll = vi.fn(async () => ({ messageId: "poll-1" }));
  const sendReaction = vi.fn(async () => {});
  const cfg = {
    channels: {
      whatsapp: {
        allowFrom: ["*"],
        actions: {
          reactions: true,
        },
      },
    },
  } as OpenClawConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePluginRegistry(createTestRegistry([]));
    setActiveWebListener({
      sendComposingTo,
      sendMessage,
      sendPoll,
      sendReaction,
    });
  });

  afterEach(() => {
    setActivePluginRegistry(createTestRegistry([]));
    setActiveWebListener(null);
  });

  it("routes WhatsApp reactions through the active web listener without an extension plugin", async () => {
    const result = await runMessageAction({
      cfg,
      action: "react",
      params: {
        channel: "whatsapp",
        target: "12345@g.us",
        messageId: "msg-1",
        emoji: "✅",
      },
    });

    expect(result.kind).toBe("action");
    expect(result.handledBy).toBe("core");
    expect(result.payload).toMatchObject({ ok: true, added: "✅" });
    expect(sendReaction).toHaveBeenCalledWith("12345@g.us", "msg-1", "✅", false, undefined);
  });

  it("routes WhatsApp attachment buffers through the active web listener without an extension plugin", async () => {
    const buf = Buffer.from("pdf");
    const result = await runMessageAction({
      cfg,
      action: "sendAttachment",
      params: {
        channel: "whatsapp",
        target: "+15551234567",
        buffer: buf.toString("base64"),
        contentType: "application/pdf",
        filename: "file.pdf",
        caption: "doc",
      },
    });

    expect(result.kind).toBe("action");
    expect(result.handledBy).toBe("core");
    expect(result.payload).toMatchObject({
      ok: true,
      messageId: "attachment-1",
      toJid: "15551234567@s.whatsapp.net",
    });
    expect(sendComposingTo).toHaveBeenCalledWith("+15551234567");
    expect(sendMessage).toHaveBeenCalledWith("+15551234567", "doc", buf, "application/pdf", {
      fileName: "file.pdf",
    });
  });
});
