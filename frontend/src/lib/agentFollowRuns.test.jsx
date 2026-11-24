// A long task started from a chat is followed and its result said in that chat (the owner, 1 Nov: "no response").
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

const replies = [];
vi.mock("../api/client", () => ({ apiRequest: vi.fn(async () => replies.shift()), apiRequestCached: vi.fn() }));
import { ranMessage, useFollowRuns } from "./agent";

afterEach(cleanup);

function Chat({ start, onSaid }) {
  const [messages, setMessages] = useState(start);
  useFollowRuns(messages, (fn) => setMessages((prev) => { const next = fn(prev); onSaid(next); return next; }));
  return <div>{messages.length}</div>;
}

it("says the result once when the task ends, with its link, and marks the message done", async () => {
  replies.push({ run: { id: "r1", status: "succeeded", summary: "Your business plan is ready to review.", next_action: "Review it.", outcome: { links: [{ label: "Business plan", to: "/blueprint?review=d1" }] } } });
  const onSaid = vi.fn();
  render(<Chat start={[{ role: "assistant", content: "Started.", follow: { run_id: "r1" } }]} onSaid={onSaid} />);
  await waitFor(() => expect(onSaid).toHaveBeenCalledTimes(1));
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(onSaid).toHaveBeenCalledTimes(1);      // said once
  const said = onSaid.mock.calls[0][0];
  expect(said[0].follow.done).toBe(true);
  expect(said[1].content).toBe("Your business plan is ready to review. Review it.");
  expect(said[1].links).toEqual([{ label: "Business plan", to: "/blueprint?review=d1" }]);
});

it("a message already said is never followed again after a reload", () => {
  const onSaid = vi.fn();
  render(<Chat start={[{ role: "assistant", content: "Started.", follow: { run_id: "r2", done: true } }]} onSaid={onSaid} />);
  expect(onSaid).not.toHaveBeenCalled();
});

it("a failed task says why and offers no link to a result", () => {
  const out = ranMessage({ id: "r3", status: "failed", error: "The model was unavailable. Nothing was charged." });
  expect(out.content).toBe("The model was unavailable. Nothing was charged.");
  expect(out.links).toEqual([]);
});
