// Where a goal started on the homepage lands after sign-in (PRD-GO-001): the dashboard opens with
// that task already in the Agent box.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import DashboardPage from "./DashboardPage";
import { AGENT_FOLLOW_EVENT } from "../components/agent/AgentPanel";
import { useAuthStore } from "../store/auth";
import { useWorkspaceStore } from "../store/workspace";

const dashboard = {
  enabled: true, business_id: "ws1", max_priority_cards: 4, composition_key: "k", insights: [], kpis: [], kpis_empty: "",
  context: { pathway: "startup", business_stage: "pre_launch", stage_label: "Pre-launch", stage_source: "records", stages: [], goals: [], headline: { label: "Launch readiness", value: "0 of 7", state: "available" } },
  action_cards: [], financial_summary: {}, launch_readiness: { items: [], done: 0, total: 0, percent: 0 }, needs_approval: [], preferences: { hidden_widget_ids: [] },
  freshness: { generated_at: "2026-10-07T09:00:00Z" }, entitlement: {}, readiness_features: { funding: true, launch: true },
  report: { key: "launch_readiness_report", title: "Setup checklist", description: "The basics.", cta: "View setup checklist", action: { panel: "launch_readiness" } },
  agent: { suggestions: [], needs_approval: [], needs_approval_count: 0, shortcuts: [], placeholder: "Ask EnterprateAI…", entitlement: { is_paid: false, agent_tasks: true, monthly_runs: 5, monthly_runs_used: 0, credits: 50 } },
};
// The invoice task as it waits on the dashboard: what was said before sign-up is filled in; only what is missing is asked.
const task = { id: "run-7", status: "running", substatus: "waiting_for_information", workflow_key: "new_invoice", title: "New Invoice", step: { index: 1, total: 4, title: "Who and what" },
  pending_question: { question: "Who is this invoice for, and what is it for?", fields: [
    { key: "customer_name", label: "Customer name", type: "text", required: true, default: "ABC Consulting Ltd" },
    { key: "customer_email", label: "Customer email", type: "email", required: true, default: "" }] } };

let calls;
function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname + l.search}</p>; }

beforeEach(() => {
  calls = [];
  sessionStorage.clear();
  localStorage.setItem("ea_token", "t");
  useAuthStore.setState({ token: "t", email: "ada@example.test", hydrated: true });
  useWorkspaceStore.setState({ workspaceId: "ws1", workspaceName: "Newcomer Studio", currency: "GBP", workspaceChecks: 0, workspaceCheckedOnce: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("the dashboard, arriving with a task from the homepage", () => {
  it("opens that task in the Agent box with what was already said filled in, and clears the address", async () => {
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const path = String(url);
      calls.push({ path, method: init.method || "GET" });
      const out = /\/businesses\/ws1\/dashboard(\?|$)/.test(path) ? dashboard : /\/workflow-runs\/run-7$/.test(path) ? { run: task, approvals: [] } : {};
      return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const followed = [];
    const listen = (e) => followed.push(e.detail);
    window.addEventListener(AGENT_FOLLOW_EVENT, listen);
    try {
      render(<MemoryRouter initialEntries={["/dashboard?task=run-7"]}><Routes><Route path="/dashboard" element={<><DashboardPage /><Where /></>} /></Routes></MemoryRouter>);
      await waitFor(() => expect(followed).toEqual([{ runId: "run-7" }]), { timeout: 4000 });      // the task is handed to the Agent box, once
      await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/dashboard"));      // a refresh won't open it again
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("Who is this invoice for, and what is it for?")).toBeTruthy();
      expect(within(dialog).getByLabelText("Customer name").value).toBe("ABC Consulting Ltd");      // not asked again
      expect(within(dialog).getByLabelText("Customer email").value).toBe("");
      expect(calls.some((c) => /\/workflow-runs\/run-7$/.test(c.path))).toBe(true);
      expect(screen.queryByRole("status", { name: "Loading your dashboard" })).toBeNull();
      await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
      expect(followed.length).toBe(1);
    } finally {
      window.removeEventListener(AGENT_FOLLOW_EVENT, listen);
    }
  });

  it("still opens the task when the dashboard refreshes its own data straight after loading (as it does for a returning owner)", async () => {
    // From the browser: the dashboard showed, with ?task= still in the address and no dialog. Its second load of data
    // (a remembered copy first, then the fresh one) cancelled the hand-off after it had been marked as done.
    const { rememberDashboard } = await import("../lib/dashboard");
    rememberDashboard("ws1", dashboard);                                     // shown at once from memory; the fresh copy follows
    let n = 0;
    globalThis.fetch = vi.fn(async (url) => {
      const path = String(url);
      const out = /\/businesses\/ws1\/dashboard(\?|$)/.test(path) ? { ...dashboard, freshness: { generated_at: `2026-10-07T09:00:0${n += 1}Z` }, agent: { ...dashboard.agent, suggestions: [{ key: `s${n}`, icon: "doc", text: "One task needs attention.", action: { run_id: "run-7" } }] } }
        : /\/agent\/summary$/.test(path) ? { ...dashboard.agent, needs_approval_count: 0, refreshed: (n += 1) }
        : /\/workflow-runs\/run-7$/.test(path) ? { run: task, approvals: [] } : {};
      return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    render(<MemoryRouter initialEntries={["/dashboard?task=run-7"]}><Routes><Route path="/dashboard" element={<><DashboardPage /><Where /></>} /></Routes></MemoryRouter>);
    const dialog = await screen.findByRole("dialog", {}, { timeout: 4000 });
    expect(within(dialog).getByLabelText("Customer name").value).toBe("ABC Consulting Ltd");
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/dashboard"));
  });

  it("without a task in the address, nothing is opened", async () => {
    globalThis.fetch = vi.fn(async (url) => new Response(JSON.stringify(/\/businesses\/ws1\/dashboard(\?|$)/.test(String(url)) ? dashboard : {}), { status: 200, headers: { "Content-Type": "application/json" } }));
    const followed = [];
    const listen = (e) => followed.push(e.detail);
    window.addEventListener(AGENT_FOLLOW_EVENT, listen);
    try {
      render(<MemoryRouter initialEntries={["/dashboard"]}><Routes><Route path="/dashboard" element={<DashboardPage />} /></Routes></MemoryRouter>);
      await screen.findByText("Pre-launch stage");
      await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
      expect(followed).toEqual([]);
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      window.removeEventListener(AGENT_FOLLOW_EVENT, listen);
    }
  });
});
