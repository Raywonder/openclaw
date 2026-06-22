import { Type } from "@sinclair/typebox";
import type { NotificationBroadcastRuntime } from "./runtime.js";

export function createNotificationBroadcastTool(runtime: NotificationBroadcastRuntime) {
  return {
    name: "notification-broadcast",
    description:
      "Submit gateway notifications or inspect notification broadcast status and digest queues.",
    parameters: Type.Object({
      action: Type.Unsafe<"submit" | "status" | "digest">({
        type: "string",
        enum: ["submit", "status", "digest"],
      }),
      eventJson: Type.Optional(
        Type.String({ description: "JSON notification event for action=submit." }),
      ),
      recipientId: Type.Optional(
        Type.String({ description: "Optional recipient id for action=digest." }),
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const action = typeof params.action === "string" ? params.action.trim() : "";
      if (action === "status") {
        const payload = runtime.status();
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          details: payload,
        };
      }
      if (action === "digest") {
        const payload = runtime.listDigest(
          typeof params.recipientId === "string" ? params.recipientId.trim() : undefined,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          details: payload,
        };
      }
      if (action === "submit") {
        const raw = typeof params.eventJson === "string" ? params.eventJson.trim() : "";
        if (!raw) {
          throw new Error("eventJson required");
        }
        const payload = await runtime.submit(JSON.parse(raw), { trusted: true });
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          details: payload,
        };
      }
      throw new Error("action must be submit, status, or digest");
    },
  };
}
