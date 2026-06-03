import type { Client, User } from "@buape/carbon";
import type { HistoryEntry } from "../../auto-reply/reply/history.js";
import type { ReplyToMode } from "../../config/config.js";
import type { RuntimeEnv } from "../../runtime.js";
import type { DiscordGuildEntryResolved } from "./allow-list.js";
import type { DiscordMessageEvent, DiscordMessageHandler } from "./listeners.js";
import { hasControlCommand } from "../../auto-reply/command-detection.js";
import {
  createInboundDebouncer,
  resolveInboundDebounceMs,
} from "../../auto-reply/inbound-debounce.js";
import { danger } from "../../globals.js";
import { preflightDiscordMessage } from "./message-handler.preflight.js";
import { processDiscordMessage } from "./message-handler.process.js";
import { resolveDiscordMessageText } from "./message-utils.js";

type LoadedConfig = ReturnType<typeof import("../../config/config.js").loadConfig>;
type DiscordConfig = NonNullable<
  import("../../config/config.js").OpenClawConfig["channels"]
>["discord"];

function isExplicitDiscordBotMention(params: {
  event: DiscordMessageEvent;
  botUserId?: string;
}): boolean {
  const { event, botUserId } = params;
  if (!botUserId) {
    return false;
  }
  const message = event.message;
  if (!event.guild_id) {
    return false;
  }
  if (message.referencedMessage?.author?.id === botUserId) {
    return true;
  }
  return Boolean(message.mentionedUsers?.some((user: User) => user.id === botUserId));
}

function mergeMentionUsers(entries: Array<{ data: DiscordMessageEvent }>) {
  const users = new Map<
    string,
    NonNullable<DiscordMessageEvent["message"]["mentionedUsers"]>[number]
  >();
  for (const entry of entries) {
    for (const user of entry.data.message.mentionedUsers ?? []) {
      users.set(user.id, user);
    }
  }
  return Array.from(users.values());
}

function mergeMentionRoles(entries: Array<{ data: DiscordMessageEvent }>) {
  const roles = new Map<
    string,
    NonNullable<DiscordMessageEvent["message"]["mentionedRoles"]>[number]
  >();
  for (const entry of entries) {
    for (const role of entry.data.message.mentionedRoles ?? []) {
      roles.set(role.id, role);
    }
  }
  return Array.from(roles.values());
}

export function buildDebouncedDiscordMessageEvent(
  entries: Array<{ data: DiscordMessageEvent }>,
): DiscordMessageEvent | null {
  const last = entries.at(-1);
  if (!last) {
    return null;
  }
  const combinedBaseText = entries
    .map((entry) => resolveDiscordMessageText(entry.data.message, { includeForwarded: false }))
    .filter(Boolean)
    .join("\n");
  const syntheticMessage = {
    ...last.data.message,
    content: combinedBaseText,
    attachments: [],
    mentionedEveryone: entries.some((entry) => entry.data.message.mentionedEveryone),
    mentionedUsers: mergeMentionUsers(entries),
    mentionedRoles: mergeMentionRoles(entries),
    referencedMessage:
      entries.find((entry) => entry.data.message.referencedMessage)?.data.message
        .referencedMessage ?? last.data.message.referencedMessage,
    message_snapshots: (last.data.message as { message_snapshots?: unknown }).message_snapshots,
    messageSnapshots: (last.data.message as { messageSnapshots?: unknown }).messageSnapshots,
    rawData: {
      ...(last.data.message as { rawData?: Record<string, unknown> }).rawData,
    },
  };
  return {
    ...last.data,
    message: syntheticMessage,
  };
}

export function createDiscordMessageHandler(params: {
  cfg: LoadedConfig;
  discordConfig: DiscordConfig;
  accountId: string;
  token: string;
  runtime: RuntimeEnv;
  botUserId?: string;
  guildHistories: Map<string, HistoryEntry[]>;
  historyLimit: number;
  mediaMaxBytes: number;
  textLimit: number;
  replyToMode: ReplyToMode;
  dmEnabled: boolean;
  groupDmEnabled: boolean;
  groupDmChannels?: Array<string | number>;
  allowFrom?: Array<string | number>;
  guildEntries?: Record<string, DiscordGuildEntryResolved>;
}): DiscordMessageHandler {
  const groupPolicy = params.discordConfig?.groupPolicy ?? "open";
  const ackReactionScope = params.cfg.messages?.ackReactionScope ?? "group-mentions";
  const debounceMs = resolveInboundDebounceMs({ cfg: params.cfg, channel: "discord" });

  const debouncer = createInboundDebouncer<{ data: DiscordMessageEvent; client: Client }>({
    debounceMs,
    buildKey: (entry) => {
      const message = entry.data.message;
      const authorId = entry.data.author?.id;
      if (!message || !authorId) {
        return null;
      }
      const channelId = message.channelId;
      if (!channelId) {
        return null;
      }
      return `discord:${params.accountId}:${channelId}:${authorId}`;
    },
    shouldDebounce: (entry) => {
      const message = entry.data.message;
      if (!message) {
        return false;
      }
      if (message.attachments && message.attachments.length > 0) {
        return false;
      }
      const baseText = resolveDiscordMessageText(message, { includeForwarded: false });
      if (!baseText.trim()) {
        return false;
      }
      if (isExplicitDiscordBotMention({ event: entry.data, botUserId: params.botUserId })) {
        return false;
      }
      return !hasControlCommand(baseText, params.cfg);
    },
    onFlush: async (entries) => {
      const last = entries.at(-1);
      if (!last) {
        return;
      }
      if (entries.length === 1) {
        const ctx = await preflightDiscordMessage({
          ...params,
          ackReactionScope,
          groupPolicy,
          data: last.data,
          client: last.client,
        });
        if (!ctx) {
          return;
        }
        await processDiscordMessage(ctx);
        return;
      }
      const syntheticData = buildDebouncedDiscordMessageEvent(entries);
      if (!syntheticData) {
        return;
      }
      const ctx = await preflightDiscordMessage({
        ...params,
        ackReactionScope,
        groupPolicy,
        data: syntheticData,
        client: last.client,
      });
      if (!ctx) {
        return;
      }
      if (entries.length > 1) {
        const ids = entries.map((entry) => entry.data.message?.id).filter(Boolean) as string[];
        if (ids.length > 0) {
          const ctxBatch = ctx as typeof ctx & {
            MessageSids?: string[];
            MessageSidFirst?: string;
            MessageSidLast?: string;
          };
          ctxBatch.MessageSids = ids;
          ctxBatch.MessageSidFirst = ids[0];
          ctxBatch.MessageSidLast = ids[ids.length - 1];
        }
      }
      await processDiscordMessage(ctx);
    },
    onError: (err) => {
      params.runtime.error?.(danger(`discord debounce flush failed: ${String(err)}`));
    },
  });

  return async (data, client) => {
    try {
      await debouncer.enqueue({ data, client });
    } catch (err) {
      params.runtime.error?.(danger(`handler failed: ${String(err)}`));
    }
  };
}
