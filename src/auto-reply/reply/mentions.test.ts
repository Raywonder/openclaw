import { describe, expect, it } from "vitest";
import { buildMentionRegexes, matchesMentionWithExplicit } from "./mentions.js";

describe("matchesMentionWithExplicit", () => {
  const mentionRegexes = [/\bopenclaw\b/i];

  it("checks mentionPatterns even when explicit mention is available", () => {
    const result = matchesMentionWithExplicit({
      text: "@openclaw hello",
      mentionRegexes,
      explicit: {
        hasAnyMention: true,
        isExplicitlyMentioned: false,
        canResolveExplicit: true,
      },
    });
    expect(result).toBe(true);
  });

  it("returns false when explicit is false and no regex match", () => {
    const result = matchesMentionWithExplicit({
      text: "<@999999> hello",
      mentionRegexes,
      explicit: {
        hasAnyMention: true,
        isExplicitlyMentioned: false,
        canResolveExplicit: true,
      },
    });
    expect(result).toBe(false);
  });

  it("returns true when explicitly mentioned even if regexes do not match", () => {
    const result = matchesMentionWithExplicit({
      text: "<@123456>",
      mentionRegexes: [],
      explicit: {
        hasAnyMention: true,
        isExplicitlyMentioned: true,
        canResolveExplicit: true,
      },
    });
    expect(result).toBe(true);
  });

  it("falls back to regex matching when explicit mention cannot be resolved", () => {
    const result = matchesMentionWithExplicit({
      text: "openclaw please",
      mentionRegexes,
      explicit: {
        hasAnyMention: true,
        isExplicitlyMentioned: false,
        canResolveExplicit: false,
      },
    });
    expect(result).toBe(true);
  });
});

describe("buildMentionRegexes", () => {
  it("derives a case-insensitive @Clawdia mention from the agent identity", () => {
    const regexes = buildMentionRegexes(
      {
        agents: {
          list: [
            {
              id: "clawdia",
              identity: { name: "Clawdia" },
            },
          ],
        },
      },
      "clawdia",
    );

    expect(regexes.some((regex) => regex.test("@Clawdia can you see this?"))).toBe(true);
    expect(regexes.some((regex) => regex.test("@clawdia can you see this?"))).toBe(true);
  });
});
