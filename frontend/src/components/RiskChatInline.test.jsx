// R-7 (the owner's brief, 24 Oct): in the Agent card (the dashboard, and the Agent Centre, which hands its message to it),
// [Check my risks] shows the result right there, never a jump to another page, and starts no paid task.
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = [];
const q = (key, label, options, value) => ({ key, label, type: "choice", options: options.map(([v, l]) => ({ value: v, label: l })), default: value, noun: key, required: true });
const session = {
  id: "S1", goal_key: "business_risks", goal_label: "Help me understand my business risks", next: "questions", authenticated: true, signed_in: true,
  value_line: "I'll check your biggest customer, cash, late payments and how much the business depends on you. This uses your records; it isn't financial advice.",
  questions: [q("top_share", "Biggest customer?", [["over_50", "More than half"]], "over_50"), q("paid_on_time", "On time?", [["on_time", "Almost always"]], "on_time"),
    q("key_person", "Away for a month?", [["slows", "It would slow down"]], "slows")],
  inputs: { top_share: "over_50", paid_on_time: "on_time", key_person: "slows" }, proposed: {}, missing: [], first_value: true,
  summary: [{ key: "top_share", value: "x", from_records: true }], turns: [{ role: "user", content: "business risk" }, { role: "assistant", content: "Here's what I'll use:", next: null }], resolution: { resolution_class: "direct_supported" },
};
const result = { assessment_type: "business_risk_initial", headline: "Business Risk Check", score: null,
  blockers: [{ key: "concentration", label: "Delta Offices Ltd is 100% of your paid income", kind: "failed" }], not_on_record: [], fine: [], free_next_actions: [] };
vi.mock("../api/client", () => ({
  apiRequest: vi.fn(async (path, method, body) => {
    calls.push({ path, method, body });
    if (path === "/task-sessions" && method === "POST") return session;
    if (path.endsWith("/risk-check")) return { result, session_id: "S1", session: { ...session, state: "handed_off", handoff: { to: "/check/risks", free: true } } };
    if (path.endsWith("/first-value")) return { result, session_id: "S1" };
    if (path.endsWith("/prepare")) return { ...session, state: "handed_off", handoff: { to: "/check/risks", free: true } };
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

describe("the risk check in the Agent card", () => {
  it("[Check my risks] ends the chat on one line and a button to the risk check's own page (25 Oct)", async () => {
    render(<MemoryRouter initialEntries={["/dashboard"]}><Routes><Route path="*" element={<><AgentGoalChat text="business risk" /><Where /></>} /></Routes></MemoryRouter>);
    const go = await waitFor(() => { const b = document.querySelector("[data-check-my-risks]"); if (!b) throw new Error("no button"); return b; });
    expect(document.querySelector("[data-summary]")).toBeNull();      // no list to confirm
    expect(window.location.search).not.toContain("task=");      // never read by the dashboard as an Agent task (25 Oct)
    expect(document.body.textContent).not.toContain("Here's what I'll use");      // never a line with nothing under it (25 Oct)
    fireEvent.click(go);
    await waitFor(() => expect(document.querySelector("[data-result-line]")?.textContent).toContain("1 risk to act on."));
    expect(document.querySelector("[data-where]").textContent).toBe("/dashboard");      // nothing moves by itself
    expect(document.querySelector("[data-step-title]")).toBeNull();      // the full result is never in the chat
    // One request (the owner's brief, 25 Oct: under 5 seconds), never resume, prepare and first-value one after another
    expect(calls.map((c) => c.path).filter((p) => /resume|prepare|first-value|risk-check/.test(p))).toEqual(["/task-sessions/S1/risk-check"]);
    fireEvent.click(document.querySelector("[data-view-result]"));
    expect(document.querySelector("[data-view-result]")?.textContent ?? "View your risk check").toBe("View your risk check");
    await waitFor(() => expect(document.querySelector("[data-where]").textContent).toBe("/check/risks"));
  });
});
