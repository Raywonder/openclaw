import { sanitizeUserFacingText } from "../../agents/pi-embedded-helpers.js";

export type UserFacingOutputGateResult = {
  text: string;
  blocked: boolean;
  reason?: string;
};

const INTERNAL_TOOL_KEYS = [
  "tool_call",
  "tool_describe",
  "tool_result",
  "function_call",
  "openclaw",
];

const INTERNAL_MARKER_RE =
  /(?:\btool_(?:call|describe|result)\b|\bfunction_call\b|\[\s*Tool Call:|<invoke\b|<\/minimax:tool_call>|<think\b|<\/think>)/i;

const JSON_TOOL_PAYLOAD_RE =
  /^\s*(?:```(?:json)?\s*)?\{[\s\S]*(?:"type"\s*:\s*"function"|"name"\s*:\s*"tool_call"|"name"\s*:\s*"tool_describe"|"id"\s*:\s*"openclaw"|whatsapp:\d+:direct)[\s\S]*\}\s*(?:```)?\s*$/i;

const RAW_PROVIDER_NOISE_RE =
  /\b(?:Provider .* cooldown|subscription usage limit|tool ID .* not recognized|live model reply|could not get a live model reply|I couldn't reach the model right now)\b/i;

function stripToolCallXml(text: string): string {
  return text
    .replace(/<invoke\b[\s\S]*?<\/invoke>/gi, "")
    .replace(/<\/?minimax:tool_call[^>]*>/gi, "");
}

function stripThinkingTags(text: string): string {
  return text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "");
}

function stripDowngradedToolMarkers(text: string): string {
  return text
    .replace(/\[\s*Tool Call:[^\]]*\]/gi, "")
    .replace(/\[\s*Tool Result:[^\]]*\]/gi, "");
}

function normalizedJsonText(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
}

function isLikelyJsonObject(text: string): boolean {
  const trimmed = normalizedJsonText(text);
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function containsInternalToolKey(text: string): boolean {
  const lower = text.toLowerCase();
  return INTERNAL_TOOL_KEYS.some((key) => lower.includes(key));
}

export function gateUserFacingOutput(text: string): UserFacingOutputGateResult {
  if (!text) {
    return { text, blocked: false };
  }
  const original = String(text);
  const trimmedOriginal = original.trim();
  if (!trimmedOriginal) {
    return { text: original, blocked: false };
  }

  if (JSON_TOOL_PAYLOAD_RE.test(trimmedOriginal)) {
    return { text: "", blocked: true, reason: "json-tool-payload" };
  }

  if (isLikelyJsonObject(trimmedOriginal) && containsInternalToolKey(trimmedOriginal)) {
    return { text: "", blocked: true, reason: "json-internal-payload" };
  }

  if (RAW_PROVIDER_NOISE_RE.test(trimmedOriginal)) {
    return { text: "", blocked: true, reason: "provider-or-tool-noise" };
  }

  const stripped = stripThinkingTags(stripDowngradedToolMarkers(stripToolCallXml(original)));
  const sanitized = sanitizeUserFacingText(stripped);
  if (!sanitized.trim() && INTERNAL_MARKER_RE.test(original)) {
    return { text: "", blocked: true, reason: "internal-marker-only" };
  }

  if (isLikelyJsonObject(sanitized) && containsInternalToolKey(sanitized)) {
    return { text: "", blocked: true, reason: "sanitized-json-internal-payload" };
  }

  return { text: sanitized, blocked: false };
}

export function sanitizeUserFacingOutput(text: string): string {
  const result = gateUserFacingOutput(text);
  return result.blocked ? "" : result.text;
}
