// "See details" goes to the task's own result when it has one (the owner, 26 Oct: "see details should be going to the
// validation result not agent centre"), else to its task page.
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import { detailsOf } from "./agent";

afterEach(() => vi.restoreAllMocks());

it("an idea validation's See details opens its results", async () => {
  vi.spyOn(client, "apiRequest").mockResolvedValue({ run: { outcome: { links: [
    { label: "the validation results", to: "/validation?history_id=agent-1&history_type=v4_validation&view=results", primary: true },
    { label: "the Idea Validation form", to: "/validation?history_id=agent-1&history_type=v4_validation" }] } } });
  expect(await detailsOf("r1")).toBe("/validation?history_id=agent-1&history_type=v4_validation&view=results");
});

it("a task without a result of its own opens its page", async () => {
  vi.spyOn(client, "apiRequest").mockResolvedValue({ run: { outcome: {} } });
  expect(await detailsOf("r2")).toBe("/agent/runs/r2");
});

it("waits for an idea validation just started to reach its results", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(client, "apiRequest")
    .mockResolvedValueOnce({ run: { status: "running", outcome: {} } })
    .mockResolvedValueOnce({ run: { status: "succeeded", outcome: { links: [{ to: "/validation?history_id=agent-1&history_type=v4_validation&view=results", primary: true }] } } });
  const going = detailsOf("r3", { wait: 20 });
  await vi.advanceTimersByTimeAsync(1100);
  expect(await going).toBe("/validation?history_id=agent-1&history_type=v4_validation&view=results");
  expect(spy).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
