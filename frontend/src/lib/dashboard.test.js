import { afterEach, expect, it, vi } from "vitest";
import { getDashboard } from "./dashboard";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("accepts a slow successful dashboard response beyond the generic 30 second timeout", async () => {
  vi.useFakeTimers();
  let finish;
  let signal;
  globalThis.fetch = vi.fn((_url, options) => {
    signal = options.signal;
    return new Promise((resolve) => { finish = resolve; });
  });
  const pending = getDashboard("slow-dashboard-test");
  await vi.advanceTimersByTimeAsync(51000);
  expect(signal.aborted).toBe(false);
  finish(new Response(JSON.stringify({ enabled: true, business_id: "slow-dashboard-test" }), { status: 200 }));
  expect(await pending).toEqual({ enabled: true, business_id: "slow-dashboard-test" });
});
