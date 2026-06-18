import { describe, expect, it, vi } from "vitest";
import { createTtsTool } from "./tts-tool.js";

const mocks = vi.hoisted(() => ({
  textToSpeech: vi.fn(),
}));

vi.mock("../../tts/tts.js", () => ({
  textToSpeech: mocks.textToSpeech,
}));

describe("tts tool user-facing gate", () => {
  it("does not synthesize raw function tool JSON", async () => {
    const tool = createTtsTool({ config: {} as never });

    const result = await tool.execute("1", {
      text: '{"type":"function","function":{"name":"tool_call","parameters":{"id":"openclaw"}}}',
    });

    expect(mocks.textToSpeech).not.toHaveBeenCalled();
    expect(result.details).toEqual(expect.objectContaining({ blocked: true }));
    expect(result.content?.[0]).toEqual(
      expect.objectContaining({ text: expect.stringContaining("TTS skipped") }),
    );
  });

  it("sanitizes normal speech before synthesis", async () => {
    mocks.textToSpeech.mockResolvedValue({
      success: true,
      audioPath: "/tmp/reply.wav",
      provider: "test",
    });
    const tool = createTtsTool({ config: {} as never });

    const result = await tool.execute("1", { text: "Hello <think>secret</think>there." });

    expect(mocks.textToSpeech).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Hello there." }),
    );
    expect(result.content?.[0]).toEqual(expect.objectContaining({ text: "MEDIA:/tmp/reply.wav" }));
  });
});
