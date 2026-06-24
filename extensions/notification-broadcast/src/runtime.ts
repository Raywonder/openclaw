import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveNotificationBroadcastConfig } from "./config.js";
import { sendJson, readJsonBody } from "./http.js";
import { normalizeNotificationEvent } from "./normalize.js";
import { publishNtfyDelivery } from "./ntfy.js";
import { NotificationBroadcastStore } from "./store.js";
import type { NotificationStatus, SubmitOptions } from "./types.js";

function authorizeHttp(req: IncomingMessage, pluginSecret: unknown, trusted: boolean): boolean {
  if (trusted) {
    return true;
  }
  if (typeof pluginSecret !== "string" || !pluginSecret.trim()) {
    return false;
  }
  const raw = req.headers.authorization;
  return raw === `Bearer ${pluginSecret}`;
}

export function createNotificationBroadcastRuntime(api: OpenClawPluginApi) {
  const config = resolveNotificationBroadcastConfig(api.pluginConfig);
  const store = new NotificationBroadcastStore();
  const pluginSecret = api.pluginConfig?.secret;

  async function submit(input: unknown, opts: SubmitOptions) {
    if (!config.enabled) {
      return { accepted: false, reason: "notification-broadcast disabled" };
    }
    const event = normalizeNotificationEvent(input);
    if (!config.sources[event.source]?.enabled) {
      return { accepted: false, reason: `source disabled: ${event.source}` };
    }
    if (!opts.trusted && event.source !== "gateway") {
      return { accepted: false, reason: "untrusted source" };
    }

    const snapshot = store.submit(event, config);
    if (!snapshot.duplicate && opts.context) {
      for (const delivery of snapshot.deliveries.filter((item) => item.mode === "immediate")) {
        opts.context.broadcast(
          "notification-broadcast.delivery",
          {
            deliveryId: delivery.deliveryId,
            eventId: delivery.eventId,
            recipientId: delivery.recipientId,
            agentId: delivery.agentId,
            channels: delivery.channels,
            message: delivery.message,
            actionState: delivery.actionState,
          },
          { dropIfSlow: true },
        );
      }
    }
    if (!snapshot.duplicate && config.integrations.ntfy.enabled) {
      for (const delivery of snapshot.deliveries.filter((item) => item.mode === "immediate")) {
        const recipient = config.recipients.find((item) => item.id === delivery.recipientId);
        if (!recipient) {
          continue;
        }
        delivery.ntfyStatus = await publishNtfyDelivery({ event, delivery, recipient, config });
      }
    }
    return {
      accepted: true,
      duplicate: snapshot.duplicate,
      eventId: snapshot.event.eventId,
      deliveries: snapshot.deliveries.map((delivery) => ({
        deliveryId: delivery.deliveryId,
        recipientId: delivery.recipientId,
        agentId: delivery.agentId,
        mode: delivery.mode,
        actionState: delivery.actionState,
        ntfyStatus: delivery.ntfyStatus,
      })),
    };
  }

  function status(): NotificationStatus {
    return store.status(config);
  }

  return {
    submit,
    status,
    listDigest: (recipientId?: string) => store.listDigest(recipientId),

    async handleEventRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "method not allowed" });
          return;
        }
        if (!authorizeHttp(req, pluginSecret, false)) {
          sendJson(res, 401, { error: "unauthorized" });
          return;
        }
        const body = await readJsonBody(req);
        sendJson(res, 202, await submit(body, { trusted: false }));
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
    },

    handleStatusRoute(_req: IncomingMessage, res: ServerResponse): void {
      sendJson(res, 200, status());
    },
  };
}

export type NotificationBroadcastRuntime = ReturnType<typeof createNotificationBroadcastRuntime>;
