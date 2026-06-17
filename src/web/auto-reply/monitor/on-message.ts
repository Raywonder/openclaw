import type { getReplyFromConfig } from "../../../auto-reply/reply.js";
import type { MsgContext } from "../../../auto-reply/templating.js";
import type { loadConfig } from "../../../config/config.js";
import type { MentionConfig } from "../mentions.js";
import type { WebInboundMsg } from "../types.js";
import type { EchoTracker } from "./echo.js";
import type { GroupHistoryEntry } from "./group-gating.js";
import type { ConversationHistoryEntry } from "./process-message.js";
import { appendHistoryEntry } from "../../../auto-reply/reply/history.js";
import { logVerbose } from "../../../globals.js";
import { resolveAgentRoute } from "../../../routing/resolve-route.js";
import { buildGroupHistoryKey } from "../../../routing/session-key.js";
import { normalizeE164 } from "../../../utils.js";
import { maybeBroadcastMessage } from "./broadcast.js";
import { applyGroupGating } from "./group-gating.js";
import { updateLastRouteInBackground } from "./last-route.js";
import { resolvePeerId } from "./peer.js";
import { processMessage } from "./process-message.js";

const DEFAULT_DIRECT_AGENT_HANDLES: Record<string, string> = {
  "@cd": "codex",
  "@codex": "codex",
  "@macmini": "macmini",
};

function normalizeHandleKey(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function resolveDirectAgentHandle(params: {
  body: string;
  configured?: Record<string, string> | undefined;
}): { handle: string; agentId: string } | null {
  const handles = new Map<string, string>();
  for (const [handle, agentId] of Object.entries(DEFAULT_DIRECT_AGENT_HANDLES)) {
    handles.set(handle, agentId);
  }
  for (const [handle, agentId] of Object.entries(params.configured ?? {})) {
    const key = normalizeHandleKey(handle);
    const target = agentId.trim();
    if (key && target) {
      handles.set(key, target);
    }
  }

  const re = /(^|[^\w])@([a-z][a-z0-9_-]{0,63})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(params.body)) !== null) {
    const handle = normalizeHandleKey(match[2] ?? "");
    const agentId = handles.get(handle);
    if (agentId) {
      return { handle, agentId };
    }
  }
  return null;
}

export function createWebOnMessageHandler(params: {
  cfg: ReturnType<typeof loadConfig>;
  verbose: boolean;
  connectionId: string;
  maxMediaBytes: number;
  groupHistoryLimit: number;
  groupHistories: Map<string, GroupHistoryEntry[]>;
  conversationHistories: Map<string, ConversationHistoryEntry[]>;
  groupMemberNames: Map<string, Map<string, string>>;
  echoTracker: EchoTracker;
  backgroundTasks: Set<Promise<unknown>>;
  replyResolver: typeof getReplyFromConfig;
  replyLogger: ReturnType<(typeof import("../../../logging.js"))["getChildLogger"]>;
  baseMentionConfig: MentionConfig;
  account: { authDir?: string; accountId?: string };
}) {
  const processForRoute = async (
    msg: WebInboundMsg,
    route: ReturnType<typeof resolveAgentRoute>,
    groupHistoryKey: string,
    opts?: {
      groupHistory?: GroupHistoryEntry[];
      conversationHistory?: ConversationHistoryEntry[];
      suppressGroupHistoryClear?: boolean;
    },
  ) =>
    processMessage({
      cfg: params.cfg,
      msg,
      route,
      groupHistoryKey,
      groupHistories: params.groupHistories,
      groupMemberNames: params.groupMemberNames,
      connectionId: params.connectionId,
      verbose: params.verbose,
      maxMediaBytes: params.maxMediaBytes,
      replyResolver: params.replyResolver,
      replyLogger: params.replyLogger,
      backgroundTasks: params.backgroundTasks,
      rememberSentText: params.echoTracker.rememberText,
      echoHas: params.echoTracker.has,
      echoForget: params.echoTracker.forget,
      buildCombinedEchoKey: params.echoTracker.buildCombinedKey,
      groupHistory: opts?.groupHistory,
      conversationHistory: opts?.conversationHistory,
      suppressGroupHistoryClear: opts?.suppressGroupHistoryClear,
    });

  return async (msg: WebInboundMsg) => {
    const conversationId = msg.conversationId ?? msg.from;
    const peerId = resolvePeerId(msg);
    const directAgent =
      msg.chatType === "direct"
        ? resolveDirectAgentHandle({
            body: msg.body,
            configured: params.cfg.channels?.whatsapp?.directAgentHandles,
          })
        : null;
    if (directAgent) {
      msg.directAgentHandle = directAgent.handle;
      msg.directAgentTarget = directAgent.agentId;
    }
    const route = resolveAgentRoute({
      cfg: params.cfg,
      channel: "whatsapp",
      accountId: msg.accountId,
      agentId: directAgent?.agentId,
      peer: {
        kind: msg.chatType === "group" ? "group" : "dm",
        id: peerId,
      },
    });
    const groupHistoryKey =
      msg.chatType === "group"
        ? buildGroupHistoryKey({
            channel: "whatsapp",
            accountId: route.accountId,
            peerKind: "group",
            peerId,
          })
        : route.sessionKey;
    const sender =
      msg.chatType === "group"
        ? msg.senderName && msg.senderE164
          ? `${msg.senderName} (${msg.senderE164})`
          : (msg.senderName ?? msg.senderE164 ?? "Unknown")
        : (msg.senderName ?? msg.senderE164 ?? msg.from);

    // Same-phone mode logging retained
    if (msg.from === msg.to) {
      logVerbose(`📱 Same-phone mode detected (from === to: ${msg.from})`);
    }

    // Skip if this is a message we just sent (echo detection)
    if (params.echoTracker.has(msg.body)) {
      logVerbose("Skipping auto-reply: detected echo (message matches recently sent text)");
      params.echoTracker.forget(msg.body);
      return;
    }

    const conversationHistory = appendHistoryEntry({
      historyMap: params.conversationHistories,
      historyKey: groupHistoryKey,
      limit: params.groupHistoryLimit,
      entry: {
        sender,
        body: msg.body,
        timestamp: msg.timestamp,
        id: msg.id,
        senderJid: msg.senderJid,
        role: "user",
      },
    });

    if (msg.chatType === "group") {
      const metaCtx = {
        From: msg.from,
        To: msg.to,
        SessionKey: route.sessionKey,
        AccountId: route.accountId,
        ChatType: msg.chatType,
        ConversationLabel: conversationId,
        GroupSubject: msg.groupSubject,
        SenderName: msg.senderName,
        SenderId: msg.senderJid?.trim() || msg.senderE164,
        SenderE164: msg.senderE164,
        Provider: "whatsapp",
        Surface: "whatsapp",
        OriginatingChannel: "whatsapp",
        OriginatingTo: conversationId,
      } satisfies MsgContext;
      updateLastRouteInBackground({
        cfg: params.cfg,
        backgroundTasks: params.backgroundTasks,
        storeAgentId: route.agentId,
        sessionKey: route.sessionKey,
        channel: "whatsapp",
        to: conversationId,
        accountId: route.accountId,
        ctx: metaCtx,
        warn: params.replyLogger.warn.bind(params.replyLogger),
      });

      const gating = applyGroupGating({
        cfg: params.cfg,
        msg,
        conversationId,
        groupHistoryKey,
        agentId: route.agentId,
        sessionKey: route.sessionKey,
        baseMentionConfig: params.baseMentionConfig,
        authDir: params.account.authDir,
        groupHistories: params.groupHistories,
        groupHistoryLimit: params.groupHistoryLimit,
        groupMemberNames: params.groupMemberNames,
        logVerbose,
        replyLogger: params.replyLogger,
      });
      if (!gating.shouldProcess) {
        return;
      }
    } else {
      // Ensure `peerId` for DMs is stable and stored as E.164 when possible.
      if (!msg.senderE164 && peerId && peerId.startsWith("+")) {
        msg.senderE164 = normalizeE164(peerId) ?? msg.senderE164;
      }
    }

    // Broadcast groups: when we'd reply anyway, run multiple agents.
    // Does not bypass group mention/activation gating above.
    if (
      await maybeBroadcastMessage({
        cfg: params.cfg,
        msg,
        peerId,
        route,
        groupHistoryKey,
        groupHistories: params.groupHistories,
        conversationHistory: [...conversationHistory],
        processMessage: processForRoute,
      })
    ) {
      return;
    }

    await processForRoute(msg, route, groupHistoryKey, { conversationHistory });
  };
}
