import { describe, expect, it, vi } from "vitest";
import {
  createDiscordMessageHandler,
  buildDebouncedDiscordMessageEvent,
} from "./message-handler.js";

const processDiscordMessage = vi.fn(async () => {});
const preflightDiscordMessage = vi.fn(async (params: { data: unknown }) => params.data);

vi.mock("./message-handler.preflight.js", () => ({
  preflightDiscordMessage: (params: unknown) => preflightDiscordMessage(params),
}));

vi.mock("./message-handler.process.js", () => ({
  processDiscordMessage: (ctx: unknown) => processDiscordMessage(ctx),
}));

function createMessageEvent(overrides: Record<string, unknown> = {}) {
  return {
    guild_id: "g1",
    author: { id: "u1", username: "alice", bot: false },
    message: {
      id: "m1",
      channelId: "c1",
      content: "hello",
      attachments: [],
      mentionedEveryone: false,
      mentionedUsers: [],
      mentionedRoles: [],
      ...overrides,
    },
  } as any;
}

function createHandler() {
  return createDiscordMessageHandler({
    cfg: { messages: { inbound: { debounceMs: 100 } } } as any,
    discordConfig: {} as any,
    accountId: "default",
    token: "token",
    runtime: { error: () => {} } as any,
    botUserId: "bot1",
    guildHistories: new Map(),
    historyLimit: 20,
    mediaMaxBytes: 1024,
    textLimit: 2000,
    replyToMode: "off",
    dmEnabled: true,
    groupDmEnabled: false,
  });
}

describe("discord inbound debounce", () => {
  it("preserves mention metadata across combined messages", () => {
    const synthetic = buildDebouncedDiscordMessageEvent([
      {
        data: createMessageEvent({
          id: "m1",
          content: "<@bot1> can you check this?",
          mentionedUsers: [{ id: "bot1", username: "Clawdia" }],
        }),
      },
      {
        data: createMessageEvent({
          id: "m2",
          content: "extra detail",
          mentionedUsers: [],
        }),
      },
    ]);

    expect(synthetic?.message.content).toBe("<@bot1> can you check this?\nextra detail");
    expect(synthetic?.message.mentionedUsers?.map((user: { id: string }) => user.id)).toEqual([
      "bot1",
    ]);
  });

  it("flushes buffered messages before handling an explicit bot mention", async () => {
    vi.useFakeTimers();
    processDiscordMessage.mockClear();
    preflightDiscordMessage.mockClear();
    const handler = createHandler();
    const client = { rest: {} } as any;

    await handler(createMessageEvent({ id: "m1", content: "background context" }), client);
    expect(processDiscordMessage).not.toHaveBeenCalled();

    await handler(
      createMessageEvent({
        id: "m2",
        content: "<@bot1> now please answer",
        mentionedUsers: [{ id: "bot1", username: "Clawdia" }],
      }),
      client,
    );

    expect(processDiscordMessage).toHaveBeenCalledTimes(2);
    expect((processDiscordMessage.mock.calls[0]?.[0] as any).message.id).toBe("m1");
    expect((processDiscordMessage.mock.calls[1]?.[0] as any).message.id).toBe("m2");

    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
  });
});
