// Winning more customers (the owner's brief, 25 Oct), the risk check's way in the Agent card: one press, one line, its own page.
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = [];
const q = (key, label, options, value) => ({ key, label, type: "choice", options: options.map(([v, l]) => ({ value: v, label: l })), default: value, noun: key, required: true });
const session = {
  id: "S1", goal_key: "more_customers", goal_label: "I need more customers", next: "questions", authenticated: true, signed_in: true,
  value_line: "I'll look at who buys from you now, how new customers find you, and the first things to do. This uses your records; it doesn't promise customers.",
  questions: [q("channel", "How do new customers find you today?", [["word_of_mouth", "Word of mouth and referrals"]], "word_of_mouth"),
    q("goal", "How many new customers?", [["10", "10 new customers"]], "10")],
  inputs: { channel: "word_of_mouth", goal: "10" }, proposed: {}, missing: [], first_value: true,
  summary: [{ key: "top_share", value: "x", from_records: true }], turns: [{ role: "user", content: "I need more customers" }, { role: "assistant", content: "Here's what I'll use:", next: null }], resolution: { resolution_class: "direct_supported" },
};
const result = { assessment_type: "customer_growth_foundation", headline: "Customer growth", score: null,
  blockers: [{ key: "marketplace", label: "Not listed on the Marketplace", kind: "failed" }, { key: "channel", label: "New customers only come by word of mouth", kind: "partial" }],
  not_on_record: [], fine: [], free_next_actions: [] };
vi.mock("../api/client", () => ({
  apiRequest: vi.fn(async (path, method, body) => {
    calls.push({ path, method, body });
    if (path === "/task-sessions" && method === "POST") return session;
    if (path.endsWith("/risk-check")) return { result, session_id: "S1", session: { ...session, state: "handed_off", handoff: { to: "/check/customers", free: true } } };
    if (path.endsWith("/first-value")) return { result, session_id: "S1" };
    if (path.endsWith("/prepare")) return { ...session, state: "handed_off", handoff: { to: "/check/customers", free: true } };
    return session;
  }),
}));
vi.mock("../store/workspace", () => {
  const st = { workspaceId: "W1", setWorkspaceId: () => {} };
  const hook = (pick) => (pick ? pick(st) : st);
  hook.getState = () => st;
  return { useWorkspaceStore: hook };
});

import { AgentGoalChat } from "./GoalLauncher";

afterEach(() => { cleanup(); calls.length = 0; });
function Where() { return <p data-where>{useLocation().pathname}</p>; }

describe("winning more customers in the Agent card", () => {
  it("[See my customer plan] ends the chat on one line and a button to its own page", async () => {
    render(<MemoryRouter initialEntries={["/dashboard"]}><Routes><Route path="*" element={<><AgentGoalChat text="I need more customers" /><Where /></>} /></Routes></MemoryRouter>);
    const go = await waitFor(() => { const b = document.querySelector("[data-check-my-risks]"); if (!b) throw new Error("no button"); return b; });
    expect(document.querySelector("[data-summary]")).toBeNull();      // no list to confirm
    expect(window.location.search).not.toContain("task=");      // never read by the dashboard as an Agent task (25 Oct)
    expect(document.body.textContent).not.toContain("Here's what I'll use");      // never a line with nothing under it (25 Oct)
    fireEvent.click(go);
    await waitFor(() => expect(document.querySelector("[data-result-line]")?.textContent).toContain("2 things to fix to win more customers."));
    expect(document.querySelector("[data-where]").textContent).toBe("/dashboard");      // nothing moves by itself
    expect(document.querySelector("[data-step-title]")).toBeNull();      // the full result is never in the chat
    // One request (the owner's brief, 25 Oct: under 5 seconds), never resume, prepare and first-value one after another
    expect(calls.map((c) => c.path).filter((p) => /resume|prepare|first-value|risk-check/.test(p))).toEqual(["/task-sessions/S1/risk-check"]);
    fireEvent.click(document.querySelector("[data-view-result]"));
    expect(document.querySelector("[data-view-result]")?.textContent ?? "View your risk check").toBe("View your customer plan");
    await waitFor(() => expect(document.querySelector("[data-where]").textContent).toBe("/check/customers"));
  });
});
