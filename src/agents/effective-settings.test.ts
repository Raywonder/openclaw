import { describe, expect, it } from "vitest";
import { resolveEffectiveSettings } from "./effective-settings.js";
describe("resolveEffectiveSettings", () => { it("does not expose credential values", () => { const result = resolveEffectiveSettings({ config: { agents: { defaults: { model: { provider: "openrouter", model: "openai/gpt-4.1-mini" } } }, auth: { token: "secret" }, providers: { key: "secret" } }, agentId: "main", channel: "teamtalk" }); expect(result.model.configured).toBe(true); expect(JSON.stringify(result)).not.toContain("secret"); }); });
