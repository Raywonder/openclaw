import { describe, expect, it } from "vitest";
import { resolveVoiceLinkAudioStatus } from "./voicelink-audio.js";
describe("VoiceLink Audio status", () => { it("is default-routed but never enables capture", () => { const s = resolveVoiceLinkAudioStatus({ config: {}, agentId: "main", channel: "teamtalk" }); expect(s.enabledByDefault).toBe(true); expect(s.microphoneEnabled).toBe(false); expect(s.degraded).toBe(true); }); });
