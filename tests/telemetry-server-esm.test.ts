import { expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ isEnabled: () => false }));

import { isServerTelemetryEnabled } from "@/lib/telemetry/server";

it("reads the Sentry named exports used by the server bundle", () => {
  expect(isServerTelemetryEnabled()).toBe(false);
});
