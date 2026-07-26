import { resolveEffectiveSettings, type EffectiveSettings } from "./effective-settings.js";

export type VoiceLinkAudioStatus = {
  version: 1;
  enabledByDefault: true;
  microphoneEnabled: false;
  passiveListeningEnabled: false;
  endpointConfigured: boolean;
  stt: "ready" | "unconfigured";
  tts: "ready" | "unconfigured";
  degraded: boolean;
  effectiveSettings: EffectiveSettings;
};

/** Platform-neutral, non-secret VoiceLink Audio capability view. */
export function resolveVoiceLinkAudioStatus(input: {
  config: Record<string, unknown>;
  agentId: string;
  channel: string;
}): VoiceLinkAudioStatus {
  const audio = (input.config.voiceLinkAudio ?? {}) as Record<string, unknown>;
  const endpointConfigured = typeof audio.endpoint === "string" && audio.endpoint.length > 0;
  const stt = endpointConfigured && audio.sttEnabled === true ? "ready" : "unconfigured";
  const tts = endpointConfigured && audio.ttsEnabled === true ? "ready" : "unconfigured";
  return { version: 1, enabledByDefault: true, microphoneEnabled: false, passiveListeningEnabled: false, endpointConfigured, stt, tts, degraded: stt !== "ready" || tts !== "ready", effectiveSettings: resolveEffectiveSettings(input) };
}
