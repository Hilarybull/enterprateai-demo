// The landing page hands a message to the dashboard's Agent card (/dashboard?ask=…). While the dashboard shows its saved
// copy the card is paused: the message waits and is sent once it can be (the owner's QA, 23 Oct: it was dropped, and the
// landing page "just entered the dashboard"), so the card asks its usual questions and carries on.
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AgentPanel from "./AgentPanel";
import { useAuthStore } from "../../store/auth";
import { useWorkspaceStore } from "../../store/workspace";

const SUMMARY = { suggestions: [], needs_approval: [], entitlement: { is_paid: true, agent_tasks: true, monthly_runs: 50, monthly_runs_used: 0, credits: 40 } };
let calls;
beforeEach(() => {
  calls = [];
  localStorage.setItem("ea_token", "test");
  useAuthStore.setState({ email: "ada@example.test" });
  useWorkspaceStore.setState({ workspaceId: "ws1", workspaceName: "Apex", workspaceCompanyName: "Apex" });
  window.history.replaceState(null, "", "/dashboard?ask=I%20need%20funding");
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ path: String(url), body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ status: "needs_input", question: "How much do you need?", fields: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

it("waits while the card is paused, then sends the landing page's message once", async () => {
  const sent = () => calls.filter((c) => /\/agent\/requests$/.test(c.path));
  const { rerender } = render(<MemoryRouter><AgentPanel businessId="ws1" summary={SUMMARY} onChanged={() => {}} paused /></MemoryRouter>);
  await new Promise((r) => setTimeout(r, 50));
  expect(sent()).toHaveLength(0);
  expect(window.location.search).toBe("?ask=I%20need%20funding");      // kept until it is sent
  rerender(<MemoryRouter><AgentPanel businessId="ws1" summary={SUMMARY} onChanged={() => {}} paused={false} /></MemoryRouter>);
  await waitFor(() => expect(sent()).toHaveLength(1));
  expect(sent()[0].body.text).toBe("I need funding");
  expect(window.location.search).toBe("");
  rerender(<MemoryRouter><AgentPanel businessId="ws1" summary={SUMMARY} onChanged={() => {}} paused={false} /></MemoryRouter>);
  await new Promise((r) => setTimeout(r, 50));
  expect(sent()).toHaveLength(1);      // once
});
