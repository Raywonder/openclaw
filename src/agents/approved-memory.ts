export type ApprovedMemoryUpdate = { summary: string; source: "approved-thread-fallback" | "approved-journal"; provenance: string; createdAt: number };
export type ApprovedMemoryStatus = { enabled: boolean; backendConfigured: boolean; reviewRequired: boolean; reason?: string };
/**
 * Canonical memory-writer boundary. It never chooses a storage target itself.
 * A configured owner-approved backend must implement persistence separately.
 */
export function prepareApprovedMemoryUpdate(input: { summary: string; source: ApprovedMemoryUpdate["source"]; provenance: string; now?: number; maxChars?: number }): ApprovedMemoryUpdate | null {
  const maxChars = input.maxChars ?? 600;
  const summary = input.summary.trim().replace(/\s+/g, " ");
  if (!summary || summary.length > maxChars) return null;
  if (/api[_ -]?key|password|bearer\s+[\w.-]+/i.test(summary)) return null;
  return { summary, source: input.source, provenance: input.provenance, createdAt: input.now ?? Date.now() };
}
export function approvedMemoryStatus(backendConfigured: boolean): ApprovedMemoryStatus {
  return backendConfigured ? { enabled: false, backendConfigured: true, reviewRequired: true, reason: "owner review required" } : { enabled: false, backendConfigured: false, reviewRequired: true, reason: "approved memory backend not configured" };
}
