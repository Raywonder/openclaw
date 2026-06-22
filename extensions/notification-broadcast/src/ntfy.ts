import type { DeliveryRecord, NotificationBroadcastConfig, NotificationEvent, RecipientConfig } from "./types.js";

const PRIORITY_BY_SEVERITY: Record<string, string> = {
  info: "2",
  warning: "3",
  error: "4",
  critical: "5",
};

function normalizeBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }
    return trimmed.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function normalizeTopic(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes(" ")) {
    return undefined;
  }
  return trimmed;
}

export async function publishNtfyDelivery(params: {
  event: NotificationEvent;
  delivery: DeliveryRecord;
  recipient: RecipientConfig;
  config: NotificationBroadcastConfig;
}): Promise<"not_configured" | "sent" | "failed"> {
  const ntfy = params.config.integrations.ntfy;
  if (!ntfy.enabled) {
    return "not_configured";
  }

  const baseUrl = normalizeBaseUrl(ntfy.baseUrl);
  const topic = normalizeTopic(params.recipient.ntfyTopic ?? ntfy.defaultTopic);
  if (!baseUrl || !topic) {
    return "not_configured";
  }

  const headers: Record<string, string> = {
    "content-type": "text/plain; charset=utf-8",
    Title: params.event.title,
    Priority: PRIORITY_BY_SEVERITY[params.event.severity] ?? "3",
    Tags: `openclaw,${params.event.severity}`,
  };
  const token =
    ntfy.tokenEnv && process.env[ntfy.tokenEnv] ? process.env[ntfy.tokenEnv]?.trim() : undefined;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${baseUrl}/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers,
      body: params.delivery.message,
    });
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
