import { describe, expect, it } from "vitest";
import { normalizeNotificationEvent } from "./normalize.js";

describe("notification-broadcast redaction", () => {
  it("redacts codes, links, tokens, and private details", () => {
    const event = normalizeNotificationEvent({
      source: "gateway",
      eventId: "evt-secret",
      recipientIds: ["owner"],
      title: "Code 123456",
      summary: "Use token abcdefghijklmnopqrstuvwxyz123 at https://example.test/path",
      details: "private detail should not forward",
      sensitivity: "private",
    });

    expect(event.title).toContain("[code]");
    expect(event.summary).toContain("[secret]");
    expect(event.summary).toContain("[link]");
    expect(event.details).toBeUndefined();
  });
});
