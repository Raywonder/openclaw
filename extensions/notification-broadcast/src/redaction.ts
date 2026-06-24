const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b\d{5,8}\b/g, "[code]"],
  [/https?:\/\/\S+/gi, "[link]"],
  [/\b[A-Za-z0-9_-]{24,}\b/g, "[token]"],
  [/\b(?:password|passcode|api key|secret|token)\b\s*[:=]?\s*\S+/gi, "[secret]"],
];

export function compactText(value: unknown, maxLength = 700): string {
  const text = typeof value === "string" ? value : "";
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function redactText(value: unknown, maxLength = 700): string {
  let out = compactText(value, maxLength);
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out.slice(0, maxLength);
}

export function safeTitle(value: unknown): string {
  return redactText(value, 160) || "Notification";
}
