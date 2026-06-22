import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createNotificationBroadcastTool } from "./src/tool.js";
import { createNotificationBroadcastRuntime } from "./src/runtime.js";

const plugin = {
  id: "notification-broadcast",
  name: "Notification Broadcast",
  description: "Route gateway notifications to configured recipients through their agents.",
  register(api: OpenClawPluginApi) {
    const runtime = createNotificationBroadcastRuntime(api);

    api.registerHttpRoute({
      path: "/plugins/notification-broadcast/events",
      handler: runtime.handleEventRoute,
    });
    api.registerHttpRoute({
      path: "/plugins/notification-broadcast/status",
      handler: runtime.handleStatusRoute,
    });

    api.registerGatewayMethod("notificationBroadcast.submit", async ({ params, respond, context }) => {
      try {
        const result = await runtime.submit(params ?? {}, { trusted: true, context });
        respond(true, result);
      } catch (err) {
        respond(false, { error: err instanceof Error ? err.message : String(err) });
      }
    });

    api.registerGatewayMethod("notificationBroadcast.status", async ({ respond }) => {
      respond(true, runtime.status());
    });

    api.registerTool(createNotificationBroadcastTool(runtime), { optional: true });
  },
};

export default plugin;
