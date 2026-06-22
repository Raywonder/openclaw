import { describe, expect, it, vi } from "vitest";
import { resolveNotificationBroadcastConfig } from "./config.js";
import { normalizeNotificationEvent } from "./normalize.js";
import { publishNtfyDelivery } from "./ntfy.js";
import { NotificationBroadcastStore } from "./store.js";

describe("notification-broadcast ntfy integration", () => {
  it("keeps ntfy disabled unless configured", () => {
    const config = resolveNotificationBroadcastConfig({});

    expect(config.sources.ntfy.enabled).toBe(false);
    expect(config.integrations.ntfy.enabled).toBe(false);
  });

  it("publishes immediate deliveries to configured ntfy topics", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENCLAW_TEST_NTFY_TOKEN = "tk_testtoken";

    const config = resolveNotificationBroadcastConfig({
      integrations: {
        ntfy: {
          enabled: true,
          baseUrl: "https://ntfy.example.test",
          defaultTopic: "owner-alerts",
          tokenEnv: "OPENCLAW_TEST_NTFY_TOKEN",
        },
      },
      recipients: [
        {
          id: "owner",
          agentId: "main",
          channels: ["private-approved-channel"],
        },
      ],
    });
    const store = new NotificationBroadcastStore();
    const event = normalizeNotificationEvent({
      source: "gateway",
      eventId: "evt-ntfy",
      recipientIds: ["owner"],
      severity: "critical",
      title: "Service down",
      summary: "A monitored service is unavailable.",
    });
    const result = store.submit(event, config);
    const delivery = result.deliveries[0];
    expect(delivery).toBeDefined();

    const status = await publishNtfyDelivery({
      event,
      delivery: delivery!,
      recipient: config.recipients[0]!,
      config,
    });

    expect(status).toBe("sent");
    expect(fetchMock).toHaveBeenCalledWith("https://ntfy.example.test/owner-alerts", {
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer tk_testtoken",
        Priority: "5",
        Tags: "openclaw,critical",
        Title: "Service down",
      }),
      body: delivery!.message,
    });

    delete process.env.OPENCLAW_TEST_NTFY_TOKEN;
    vi.unstubAllGlobals();
  });
});
