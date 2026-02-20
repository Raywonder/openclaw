import { html, nothing } from "lit";
import type { AppViewState } from "../app-view-state";

export function renderGatewayUrlConfirmation(state: AppViewState) {
  const { pendingGatewayUrl } = state;
  if (!pendingGatewayUrl) return nothing;
  const titleId = "gateway-url-confirm-title";
  const descriptionId = "gateway-url-confirm-description";

  return html`
    <div
      class="exec-approval-overlay"
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      aria-labelledby=${titleId}
      aria-describedby=${descriptionId}
    >
      <div class="exec-approval-card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title" id=${titleId}>Change Gateway URL</div>
            <div class="exec-approval-sub" id=${descriptionId}>
              This will reconnect to a different gateway server
            </div>
          </div>
        </div>
        <div class="exec-approval-command mono">${pendingGatewayUrl}</div>
        <div class="callout danger" style="margin-top: 12px;">
          Only confirm if you trust this URL. Malicious URLs can compromise your system.
        </div>
        <div class="exec-approval-actions">
          <button
            class="btn primary"
            @click=${() => state.handleGatewayUrlConfirm()}
          >
            Confirm
          </button>
          <button
            class="btn"
            @click=${() => state.handleGatewayUrlCancel()}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  `;
}
