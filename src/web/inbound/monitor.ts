import type { AnyMessageContent, proto, WAMessage } from "@whiskeysockets/baileys";
import { DisconnectReason, isJidGroup } from "@whiskeysockets/baileys";
import type { WebInboundMessage, WebListenerCloseReason } from "./types.js";
import { createInboundDebouncer } from "../../auto-reply/inbound-debounce.js";
import { formatLocationText } from "../../channels/location.js";
import { logVerbose, shouldLogVerbose } from "../../globals.js";
import { recordChannelActivity } from "../../infra/channel-activity.js";
import { getChildLogger } from "../../logging/logger.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { saveMediaBuffer } from "../../media/store.js";
import { jidToE164, resolveJidToE164 } from "../../utils.js";
import { recordWhatsAppContactObservation } from "../../whatsapp/contacts.js";
import { recordWhatsAppEvent, type WhatsAppEventType } from "../../whatsapp/events.js";
import { createWaSocket, getStatusCode, waitForWaConnection } from "../session.js";
import { checkInboundAccessControl } from "./access-control.js";
import { isRecentInboundMessage } from "./dedupe.js";
import {
  describeReplyContext,
  extractLocationData,
  extractMediaPlaceholder,
  extractMentionedJids,
  extractText,
} from "./extract.js";
import { downloadInboundMedia } from "./media.js";
import { createWebSendApi } from "./send-api.js";

export async function monitorWebInbox(options: {
  verbose: boolean;
  accountId: string;
  authDir: string;
  onMessage: (msg: WebInboundMessage) => Promise<void>;
  mediaMaxMb?: number;
  /** Send read receipts for incoming messages (default true). */
  sendReadReceipts?: boolean;
  /** Debounce window (ms) for batching rapid consecutive messages from the same sender (0 to disable). */
  debounceMs?: number;
  /** Optional debounce gating predicate. */
  shouldDebounce?: (msg: WebInboundMessage) => boolean;
}) {
  const inboundLogger = getChildLogger({ module: "web-inbound" });
  const inboundConsoleLog = createSubsystemLogger("gateway/channels/whatsapp").child("inbound");
  const sock = await createWaSocket(false, options.verbose, {
    authDir: options.authDir,
  });
  await waitForWaConnection(sock);
  const connectedAtMs = Date.now();

  let onCloseResolve: ((reason: WebListenerCloseReason) => void) | null = null;
  const onClose = new Promise<WebListenerCloseReason>((resolve) => {
    onCloseResolve = resolve;
  });
  const resolveClose = (reason: WebListenerCloseReason) => {
    if (!onCloseResolve) {
      return;
    }
    const resolver = onCloseResolve;
    onCloseResolve = null;
    resolver(reason);
  };

  try {
    await sock.sendPresenceUpdate("available");
    if (shouldLogVerbose()) {
      logVerbose("Sent global 'available' presence on connect");
    }
  } catch (err) {
    logVerbose(`Failed to send 'available' presence on connect: ${String(err)}`);
  }

  const selfJid = sock.user?.id;
  const selfE164 = selfJid ? jidToE164(selfJid) : null;
  const debouncer = createInboundDebouncer<WebInboundMessage>({
    debounceMs: options.debounceMs ?? 0,
    buildKey: (msg) => {
      const senderKey =
        msg.chatType === "group"
          ? (msg.senderJid ?? msg.senderE164 ?? msg.senderName ?? msg.from)
          : msg.from;
      if (!senderKey) {
        return null;
      }
      const conversationKey = msg.chatType === "group" ? msg.chatId : msg.from;
      return `${msg.accountId}:${conversationKey}:${senderKey}`;
    },
    shouldDebounce: options.shouldDebounce,
    onFlush: async (entries) => {
      const last = entries.at(-1);
      if (!last) {
        return;
      }
      if (entries.length === 1) {
        await options.onMessage(last);
        return;
      }
      const mentioned = new Set<string>();
      for (const entry of entries) {
        for (const jid of entry.mentionedJids ?? []) {
          mentioned.add(jid);
        }
      }
      const combinedBody = entries
        .map((entry) => entry.body)
        .filter(Boolean)
        .join("\n");
      const combinedMessage: WebInboundMessage = {
        ...last,
        body: combinedBody,
        mentionedJids: mentioned.size > 0 ? Array.from(mentioned) : undefined,
      };
      await options.onMessage(combinedMessage);
    },
    onError: (err) => {
      inboundLogger.error({ error: String(err) }, "failed handling inbound web message");
      inboundConsoleLog.error(`Failed handling inbound web message: ${String(err)}`);
    },
  });
  const groupMetaCache = new Map<
    string,
    { subject?: string; participants?: string[]; expires: number }
  >();
  const GROUP_META_TTL_MS = 5 * 60 * 1000; // 5 minutes
  const lidLookup = sock.signalRepository?.lidMapping;

  const resolveInboundJid = async (jid: string | null | undefined): Promise<string | null> =>
    resolveJidToE164(jid, { authDir: options.authDir, lidLookup });

  const recordEvent = async (event: {
    chatId: string;
    chatType: "direct" | "group";
    eventType: WhatsAppEventType;
    text: string;
    conversationId?: string;
    messageId?: string;
    actor?: string;
    targets?: string[];
  }) => {
    recordChannelActivity({
      channel: "whatsapp",
      accountId: options.accountId,
      direction: "inbound",
    });
    try {
      await recordWhatsAppEvent({
        accountId: options.accountId,
        ...event,
      });
    } catch (err) {
      logVerbose(`Failed to record WhatsApp event: ${String(err)}`);
    }
  };

  const getGroupMeta = async (jid: string) => {
    const cached = groupMetaCache.get(jid);
    if (cached && cached.expires > Date.now()) {
      return cached;
    }
    try {
      const meta = await sock.groupMetadata(jid);
      const participants =
        (
          await Promise.all(
            meta.participants?.map(async (p) => {
              const mapped = await resolveInboundJid(p.id);
              return mapped ?? p.id;
            }) ?? [],
          )
        ).filter(Boolean) ?? [];
      const entry = {
        subject: meta.subject,
        participants,
        expires: Date.now() + GROUP_META_TTL_MS,
      };
      groupMetaCache.set(jid, entry);
      return entry;
    } catch (err) {
      logVerbose(`Failed to fetch group metadata for ${jid}: ${String(err)}`);
      return { expires: Date.now() + GROUP_META_TTL_MS };
    }
  };

  const handleMessagesUpsert = async (upsert: { type?: string; messages?: Array<WAMessage> }) => {
    if (upsert.type !== "notify" && upsert.type !== "append") {
      return;
    }
    for (const msg of upsert.messages ?? []) {
      recordChannelActivity({
        channel: "whatsapp",
        accountId: options.accountId,
        direction: "inbound",
      });
      const id = msg.key?.id ?? undefined;
      const remoteJid = msg.key?.remoteJid;
      if (!remoteJid) {
        continue;
      }
      if (remoteJid.endsWith("@status") || remoteJid.endsWith("@broadcast")) {
        continue;
      }

      const group = isJidGroup(remoteJid) === true;
      if (id) {
        const dedupeKey = `${options.accountId}:${remoteJid}:${id}`;
        if (isRecentInboundMessage(dedupeKey)) {
          continue;
        }
      }
      const participantJid = msg.key?.participant ?? undefined;
      const from = group ? remoteJid : await resolveInboundJid(remoteJid);
      if (!from) {
        continue;
      }
      const senderE164 = group
        ? participantJid
          ? await resolveInboundJid(participantJid)
          : null
        : from;

      let groupSubject: string | undefined;
      let groupParticipants: string[] | undefined;
      if (group) {
        const meta = await getGroupMeta(remoteJid);
        groupSubject = meta.subject;
        groupParticipants = meta.participants;
      }
      const messageTimestampMs = msg.messageTimestamp
        ? Number(msg.messageTimestamp) * 1000
        : undefined;

      const access = await checkInboundAccessControl({
        accountId: options.accountId,
        from,
        selfE164,
        senderE164,
        group,
        pushName: msg.pushName ?? undefined,
        isFromMe: Boolean(msg.key?.fromMe),
        messageTimestampMs,
        connectedAtMs,
        sock: { sendMessage: (jid, content) => sock.sendMessage(jid, content) },
        remoteJid,
      });
      if (!access.allowed) {
        continue;
      }

      if (id && !access.isSelfChat && options.sendReadReceipts !== false) {
        const participant = msg.key?.participant;
        try {
          await sock.readMessages([{ remoteJid, id, participant, fromMe: false }]);
          if (shouldLogVerbose()) {
            const suffix = participant ? ` (participant ${participant})` : "";
            logVerbose(`Marked message ${id} as read for ${remoteJid}${suffix}`);
          }
        } catch (err) {
          logVerbose(`Failed to mark message ${id} read: ${String(err)}`);
        }
      } else if (id && access.isSelfChat && shouldLogVerbose()) {
        // Self-chat mode: never auto-send read receipts (blue ticks) on behalf of the owner.
        logVerbose(`Self-chat mode: skipping read receipt for ${id}`);
      }

      // If this is history/offline catch-up, mark read above but skip auto-reply.
      if (upsert.type === "append") {
        continue;
      }

      const location = extractLocationData(msg.message ?? undefined);
      const locationText = location ? formatLocationText(location) : undefined;
      let body = extractText(msg.message ?? undefined);
      if (locationText) {
        body = [body, locationText].filter(Boolean).join("\n").trim();
      }
      if (!body) {
        body = extractMediaPlaceholder(msg.message ?? undefined);
        if (!body) {
          continue;
        }
      }
      const replyContext = describeReplyContext(msg.message as proto.IMessage | undefined);

      let mediaPath: string | undefined;
      let mediaType: string | undefined;
      try {
        const inboundMedia = await downloadInboundMedia(msg as proto.IWebMessageInfo, sock);
        if (inboundMedia) {
          const maxMb =
            typeof options.mediaMaxMb === "number" && options.mediaMaxMb > 0
              ? options.mediaMaxMb
              : 50;
          const maxBytes = maxMb * 1024 * 1024;
          const saved = await saveMediaBuffer(
            inboundMedia.buffer,
            inboundMedia.mimetype,
            "inbound",
            maxBytes,
            inboundMedia.fileName,
          );
          mediaPath = saved.path;
          mediaType = inboundMedia.mimetype;
        }
      } catch (err) {
        logVerbose(`Inbound media download failed: ${String(err)}`);
      }

      const chatJid = remoteJid;
      const sendComposing = async () => {
        try {
          await sock.sendPresenceUpdate("composing", chatJid);
        } catch (err) {
          logVerbose(`Presence update failed: ${String(err)}`);
        }
      };
      const reply = async (text: string) => {
        await sock.sendMessage(chatJid, { text });
      };
      const sendMedia = async (payload: AnyMessageContent) => {
        await sock.sendMessage(chatJid, payload);
      };
      const timestamp = messageTimestampMs;
      const mentionedJids = extractMentionedJids(msg.message as proto.IMessage | undefined);
      const senderName = msg.pushName ?? undefined;
      recordWhatsAppContactObservation({
        accountId: access.resolvedAccountId,
        jid: participantJid ?? remoteJid,
        e164: senderE164 ?? (group ? undefined : from),
        displayName: senderName,
        conversationId: from,
        chatType: group ? "group" : "direct",
        direction: "inbound",
        timestampMs: timestamp,
      });

      inboundLogger.info(
        { from, to: selfE164 ?? "me", body, mediaPath, mediaType, timestamp },
        "inbound message",
      );
      const inboundMessage: WebInboundMessage = {
        id,
        from,
        conversationId: from,
        to: selfE164 ?? "me",
        accountId: access.resolvedAccountId,
        body,
        pushName: senderName,
        timestamp,
        chatType: group ? "group" : "direct",
        chatId: remoteJid,
        senderJid: participantJid,
        senderE164: senderE164 ?? undefined,
        senderName,
        replyToId: replyContext?.id,
        replyToBody: replyContext?.body,
        replyToSender: replyContext?.sender,
        replyToSenderJid: replyContext?.senderJid,
        replyToSenderE164: replyContext?.senderE164,
        groupSubject,
        groupParticipants,
        mentionedJids: mentionedJids ?? undefined,
        selfJid,
        selfE164,
        location: location ?? undefined,
        sendComposing,
        reply,
        sendMedia,
        mediaPath,
        mediaType,
      };
      try {
        const task = Promise.resolve(debouncer.enqueue(inboundMessage));
        void task.catch((err) => {
          inboundLogger.error({ error: String(err) }, "failed handling inbound web message");
          inboundConsoleLog.error(`Failed handling inbound web message: ${String(err)}`);
        });
      } catch (err) {
        inboundLogger.error({ error: String(err) }, "failed handling inbound web message");
        inboundConsoleLog.error(`Failed handling inbound web message: ${String(err)}`);
      }
    }
  };
  sock.ev.on("messages.upsert", handleMessagesUpsert);

  const handleMessagesUpdate = async (
    updates: Array<{
      key?: { remoteJid?: string | null; id?: string | null; participant?: string | null };
      update?: { message?: proto.IMessage | null };
    }>,
  ) => {
    for (const item of updates ?? []) {
      const remoteJid = item.key?.remoteJid ?? undefined;
      if (!remoteJid || remoteJid.endsWith("@status") || remoteJid.endsWith("@broadcast")) {
        continue;
      }
      const message = item.update?.message as (proto.IMessage & Record<string, unknown>) | null;
      if (!message) {
        continue;
      }
      const protocol = message.protocolMessage as
        | (proto.Message.IProtocolMessage & Record<string, unknown>)
        | null
        | undefined;
      const editedMessage = protocol?.editedMessage as proto.IMessage | null | undefined;
      const protocolType = String(protocol?.type ?? "").toLowerCase();
      const isEdited =
        Boolean(editedMessage) ||
        protocolType === "14" ||
        protocolType.includes("message_edit") ||
        protocolType.includes("edit");
      const isDeleted =
        protocolType === "0" || protocolType.includes("revoke") || protocolType.includes("delete");
      if (!isEdited && !isDeleted) {
        continue;
      }

      const group = isJidGroup(remoteJid) === true;
      const conversationId = group
        ? remoteJid
        : ((await resolveInboundJid(remoteJid)) ?? remoteJid);
      const actor = item.key?.participant
        ? ((await resolveInboundJid(item.key.participant)) ?? item.key.participant)
        : undefined;
      const editedText = editedMessage
        ? (extractText(editedMessage) ?? "").trim() || extractMediaPlaceholder(editedMessage) || ""
        : "";
      await recordEvent({
        chatId: remoteJid,
        conversationId,
        chatType: group ? "group" : "direct",
        eventType: isEdited ? "message_edited" : "message_deleted",
        messageId: protocol?.key?.id || item.key?.id || undefined,
        actor,
        text: isEdited ? `Message edited${editedText ? `: ${editedText}` : ""}` : "Message deleted",
      });
    }
  };
  sock.ev.on("messages.update", handleMessagesUpdate);

  const handleGroupsUpdate = async (
    updates: Array<{
      id?: string;
      subject?: string | null;
      desc?: string | null;
      announce?: boolean;
      restrict?: boolean;
    }>,
  ) => {
    for (const update of updates ?? []) {
      const chatId = update.id;
      if (!chatId) continue;
      groupMetaCache.delete(chatId);
      const parts: string[] = [];
      if (typeof update.subject === "string") {
        parts.push(`subject changed to "${update.subject}"`);
      }
      if (typeof update.desc === "string") {
        parts.push(update.desc ? "description changed" : "description cleared");
      }
      if (typeof update.announce === "boolean") {
        parts.push(
          update.announce ? "only admins can send messages" : "all participants can send messages",
        );
      }
      if (typeof update.restrict === "boolean") {
        parts.push(
          update.restrict
            ? "only admins can edit group info"
            : "all participants can edit group info",
        );
      }
      if (!parts.length) continue;
      await recordEvent({
        chatId,
        conversationId: chatId,
        chatType: "group",
        eventType: "group_updated",
        text: `Group updated: ${parts.join("; ")}`,
      });
    }
  };
  sock.ev.on("groups.update", handleGroupsUpdate);

  const handleGroupParticipantsUpdate = async (update: {
    id?: string;
    participants?: Array<string | { id?: string; jid?: string }>;
    action?: string;
    author?: string;
  }) => {
    const chatId = update.id;
    if (!chatId) return;
    groupMetaCache.delete(chatId);
    const targets = (
      await Promise.all(
        (update.participants ?? []).map(async (participant) => {
          const jid =
            typeof participant === "string" ? participant : (participant.id ?? participant.jid);
          if (!jid) return "";
          return (await resolveInboundJid(jid)) ?? jid;
        }),
      )
    ).filter(Boolean);
    const actor = update.author
      ? ((await resolveInboundJid(update.author)) ?? update.author)
      : undefined;
    const action = String(update.action || "changed");
    await recordEvent({
      chatId,
      conversationId: chatId,
      chatType: "group",
      eventType: "group_participants_updated",
      actor,
      targets,
      text: `Group participants ${action}${targets.length ? `: ${targets.join(", ")}` : ""}`,
    });
  };
  sock.ev.on("group-participants.update", handleGroupParticipantsUpdate);

  const handleConnectionUpdate = (
    update: Partial<import("@whiskeysockets/baileys").ConnectionState>,
  ) => {
    try {
      if (update.connection === "close") {
        const status = getStatusCode(update.lastDisconnect?.error);
        resolveClose({
          status,
          isLoggedOut: status === DisconnectReason.loggedOut,
          error: update.lastDisconnect?.error,
        });
      }
    } catch (err) {
      inboundLogger.error({ error: String(err) }, "connection.update handler error");
      resolveClose({ status: undefined, isLoggedOut: false, error: err });
    }
  };
  sock.ev.on("connection.update", handleConnectionUpdate);

  const sendApi = createWebSendApi({
    sock: {
      sendMessage: (jid: string, content: AnyMessageContent) => sock.sendMessage(jid, content),
      sendPresenceUpdate: (presence, jid?: string) => sock.sendPresenceUpdate(presence, jid),
    },
    defaultAccountId: options.accountId,
  });

  return {
    close: async () => {
      try {
        const ev = sock.ev as unknown as {
          off?: (event: string, listener: (...args: unknown[]) => void) => void;
          removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
        };
        const messagesUpsertHandler = handleMessagesUpsert as unknown as (
          ...args: unknown[]
        ) => void;
        const connectionUpdateHandler = handleConnectionUpdate as unknown as (
          ...args: unknown[]
        ) => void;
        if (typeof ev.off === "function") {
          ev.off("messages.upsert", messagesUpsertHandler);
          ev.off(
            "messages.update",
            handleMessagesUpdate as unknown as (...args: unknown[]) => void,
          );
          ev.off("groups.update", handleGroupsUpdate as unknown as (...args: unknown[]) => void);
          ev.off(
            "group-participants.update",
            handleGroupParticipantsUpdate as unknown as (...args: unknown[]) => void,
          );
          ev.off("connection.update", connectionUpdateHandler);
        } else if (typeof ev.removeListener === "function") {
          ev.removeListener("messages.upsert", messagesUpsertHandler);
          ev.removeListener(
            "messages.update",
            handleMessagesUpdate as unknown as (...args: unknown[]) => void,
          );
          ev.removeListener(
            "groups.update",
            handleGroupsUpdate as unknown as (...args: unknown[]) => void,
          );
          ev.removeListener(
            "group-participants.update",
            handleGroupParticipantsUpdate as unknown as (...args: unknown[]) => void,
          );
          ev.removeListener("connection.update", connectionUpdateHandler);
        }
        sock.ws?.close();
      } catch (err) {
        logVerbose(`Socket close failed: ${String(err)}`);
      }
    },
    onClose,
    signalClose: (reason?: WebListenerCloseReason) => {
      resolveClose(reason ?? { status: undefined, isLoggedOut: false, error: "closed" });
    },
    // IPC surface (sendMessage/sendPoll/sendReaction/sendComposingTo)
    ...sendApi,
  } as const;
}
