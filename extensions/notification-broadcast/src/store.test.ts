import { describe, expect, it } from "vitest";
import { resolveNotificationBroadcastConfig } from "./config.js";
import { normalizeNotificationEvent } from "./normalize.js";
import { NotificationBroadcastStore } from "./store.js";

const config = resolveNotificationBroadcastConfig({
  recipients: [
    {
      id: "owner",
      agentId: "clawdia",
      channels: ["private-chat"],
      minImmediateSeverity: "critical",
    },
  ],
});

describe("notification-broadcast store", () => {
  it("queues non-urgent gateway notifications for digest", () => {
    const store = new NotificationBroadcastStore();
    const result = store.submit(
      normalizeNotificationEvent({
        source: "gateway",
        eventId: "evt-1",
        recipientIds: ["owner"],
        severity: "info",
        title: "Build finished",
        summary: "A background build finished.",
      }),
      config,
    );

    expect(result.duplicate).toBe(false);
    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0]?.mode).toBe("digest");
    expect(store.status(config).digestQueue).toBe(1);
  });

  it("broadcasts urgent notifications immediately", () => {
    const store = new NotificationBroadcastStore();
    const result = store.submit(
      normalizeNotificationEvent({
        source: "gateway",
        eventId: "evt-2",
        recipientIds: ["owner"],
        severity: "critical",
        title: "Disk pressure",
        summary: "Disk space crossed the emergency threshold.",
      }),
      config,
    );

    expect(result.deliveries[0]?.mode).toBe("immediate");
    expect(result.deliveries[0]?.status).toBe("broadcast");
  });

  it("deduplicates events by dedupeKey", () => {
    const store = new NotificationBroadcastStore();
    const event = normalizeNotificationEvent({
      source: "gateway",
      eventId: "evt-3",
      dedupeKey: "same",
      recipientIds: ["owner"],
      title: "One",
      summary: "First",
    });
    store.submit(event, config);
    const duplicate = store.submit({ ...event, eventId: "evt-4" }, config);

    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.deliveries).toHaveLength(0);
  });
});
