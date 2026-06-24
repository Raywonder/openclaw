import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../runtime.js";

const gatewayMocks = vi.hoisted(() => ({
  callGateway: vi.fn(),
}));

vi.mock("../gateway/call.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../gateway/call.js")>();
  return {
    ...actual,
    callGateway: gatewayMocks.callGateway,
  };
});

import { channelsStatusCommand } from "./channels/status.js";

const runtime: RuntimeEnv = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
};

describe("channels status command", () => {
  beforeEach(() => {
    gatewayMocks.callGateway.mockReset();
    runtime.log.mockClear();
    runtime.error.mockClear();
    runtime.exit.mockClear();
  });

  it("requests operator.read scope for gateway channel status", async () => {
    gatewayMocks.callGateway.mockResolvedValue({
      channelAccounts: {},
    });

    await channelsStatusCommand({ json: true }, runtime);

    expect(gatewayMocks.callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "channels.status",
        scopes: ["operator.read"],
      }),
    );
    expect(runtime.error).not.toHaveBeenCalled();
  });
});
