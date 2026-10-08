// The dashboard never shows one stage's content while another stage's composition is loading:
// until the payload arrives there is a skeleton and nothing to click.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DashboardPage from "./DashboardPage";
import { DashboardSkeleton } from "../components/dashboard/AdaptiveInsights";
import { recallDashboard, rememberDashboard } from "../lib/dashboard";
import { useAuthStore } from "../store/auth";
import { useWorkspaceStore } from "../store/workspace";

const OPERATING_DEFAULTS = [/Paste a customer enquiry/, /Enquiry to Quote/, /Quote to Invoice/, /Payment Follow-up/, /Receipt Sending/, /Risk & Concentration/,
  /Essentials/, /Validate My Idea/, /Business Health Report/, /Total Revenue/];

const preLaunch = {
  enabled: true, business_id: "ws1", max_priority_cards: 4, composition_key: "k", insights: [], kpis: [], kpis_empty: "Add your plan's costs and funding to see runway and planned spending.",
  context: { pathway: "startup", business_stage: "pre_launch", stage_label: "Pre-launch", stage_source: "records", stages: [], goals: [], headline: { label: "Launch readiness", value: "3 of 7", state: "available" } },
  action_cards: [], financial_summary: {}, launch_readiness: { items: [], done: 0, total: 0, percent: 0 }, needs_approval: [], preferences: { hidden_widget_ids: [] },
  freshness: { generated_at: "2026-10-04T18:00:00Z" }, entitlement: {}, readiness_features: { funding: true, launch: true },
  report: { key: "launch_readiness_report", title: "Setup checklist", description: "The basics.", cta: "View setup checklist", action: { panel: "launch_readiness" } },
  agent: { suggestions: [{ key: "stage_register", icon: "doc", text: "Register the business.", action: { to: "/registration" } }], needs_approval: [], needs_approval_count: 0,
    shortcuts: [{ key: "registration", label: "Registration", icon: "doc", action: { to: "/registration" } }], placeholder: "Ask EnterprateAI to help with your launch, funding or registration…",
    entitlement: { is_paid: false, monthly_runs: 5, monthly_runs_used: 0, credits: 100 } },
};

let release;
function mockApi({ fail = false } = {}) {
  globalThis.fetch = vi.fn((url) => {
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (/\/businesses\/ws1\/dashboard(\?|$)/.test(String(url))) {
      if (fail) return Promise.resolve(json({ detail: "boom" }, 500));
      return new Promise((resolve) => { release = () => resolve(json(preLaunch)); });      // held until the test lets it through
    }
    return Promise.resolve(json({}));
  });
}
const mount = () => render(<MemoryRouter initialEntries={["/dashboard"]}><DashboardPage /></MemoryRouter>);

beforeEach(() => {
  sessionStorage.clear();
  useAuthStore.setState({ token: "t", email: "a@b.test", hydrated: true });
  release = undefined;
  useWorkspaceStore.setState({ workspaceId: "ws1", workspaceName: "Alchemy Test", currency: "GBP", workspaceChecks: 0, workspaceCheckedOnce: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("dashboard before its composition arrives", () => {
  it("shows a skeleton with nothing clickable and no stage's defaults, then the real stage", async () => {
    mockApi();
    mount();
    expect(screen.getByRole("status", { name: "Loading your dashboard" })).toBeTruthy();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("link")).toEqual([]);
    expect(screen.queryByRole("textbox")).toBeNull();                       // not even the Agent prompt box
    for (const text of OPERATING_DEFAULTS) expect(screen.queryByText(text)).toBeNull();
    await waitFor(() => expect(release).toBeTypeOf("function"));
    expect(screen.queryAllByRole("button")).toEqual([]);                     // still nothing while the request is in flight
    await act(async () => { release(); });
    await screen.findByText("Pre-launch stage");
    expect(screen.queryByRole("status", { name: "Loading your dashboard" })).toBeNull();
    expect(screen.getByLabelText("Ask the EnterprateAI Agent")).toBeTruthy();      // the Agent's field is there
    expect(screen.queryByRole("button", { name: "Registration" })).toBeNull();     // with no shortcut chips under it
    for (const text of [/Enquiry to Quote/, /Payment Follow-up/, /Total Revenue/]) expect(screen.queryByText(text)).toBeNull();
    // One banner closes the page at every stage; before launch it opens the setup checklist. There is no separate readiness strip.
    expect(screen.getByText("Business Health Report")).toBeTruthy();
    expect(screen.getByRole("button", { name: /View Business Health Report/ })).toBeTruthy();
    expect(screen.getByText(/^Updated \d{1,2} \w{3} \d{4}/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Readiness" })).toBeNull();
    expect(screen.queryByText("View setup checklist")).toBeNull();
    expect(recallDashboard("ws1")?.context.business_stage).toBe("pre_launch");      // remembered for the next visit in this tab
  });

  it("shows the last composition for this business at once, marked as updating, never another stage's", async () => {
    rememberDashboard("ws1", preLaunch);
    rememberDashboard("other", { ...preLaunch, business_id: "other" });
    const remembered = { ...preLaunch,
      insights: [{ key: "next_step", widget_id: "next_step", title: "Recommended Next Step", tone: "brand", state: "available", priority_class: 2, text: "Follow up.",
        cta: { label: "Open Registration", to: "/registration" }, agent_action: { label: "Ask Agent to prepare a follow-up", capability: "payment_followup" }, why: {} }],
      agent: { ...preLaunch.agent, needs_approval: [{ approval_id: "ap1", run_id: "r1", title: "Quote #QUO-1", subtitle: "Ready to send" }], needs_approval_count: 1,
        suggestions: [...preLaunch.agent.suggestions, { key: "followup", icon: "chat", text: "Would you like me to prepare a payment follow-up?", action: { capability: "payment_followup" } }],
        shortcuts: [...preLaunch.agent.shortcuts, { key: "quote_to_cash", label: "Quote to Invoice", icon: "doc", action: { capability: "quote_to_cash" } }] } };
    rememberDashboard("ws1", remembered);
    mockApi();
    mount();
    expect(screen.getByText("Pre-launch stage")).toBeTruthy();               // no skeleton, no Operating defaults
    expect(screen.getByText(/Updating…/)).toBeTruthy();
    expect(screen.queryByText(/Enquiry to Quote/)).toBeNull();
    // While the remembered copy shows: approvals, send and anything that starts a task wait; page links stay live.
    const off = (el) => el.disabled === true;
    expect(off(screen.getByRole("button", { name: "Send" }))).toBe(true);
    expect(off(screen.getByText("Quote #QUO-1").closest("button"))).toBe(true);
    expect(off(screen.getByRole("button", { name: /Ask Agent to prepare a follow-up/ }))).toBe(true);
    expect(off(screen.getByText("Would you like me to prepare a payment follow-up?").closest("button"))).toBe(true);
    expect(screen.getAllByRole("button", { name: "Open Registration" }).some(off)).toBe(false);
    expect(off(screen.getByText("Register the business.").closest("button"))).toBe(false);
    await waitFor(() => expect(release).toBeTypeOf("function"));
    await act(async () => { release(); });
    await waitFor(() => expect(screen.queryByText(/Updating…/)).toBeNull());
    expect(off(screen.getByRole("button", { name: "Send" }))).toBe(false);   // the fresh payload has landed
    expect(recallDashboard("someone-else")).toBeNull();
    rememberDashboard("ws1", { ...preLaunch, context: { ...preLaunch.context, preview: true, business_stage: "growth" } });
    expect(recallDashboard("ws1").context.business_stage).toBe("pre_launch"); // a QA preview is never remembered
  });

  it("says so when the composition can't be loaded, without falling back to a default stage", async () => {
    mockApi({ fail: true });
    mount();
    expect((await screen.findByRole("alert")).textContent).toContain("Your dashboard couldn't be loaded.");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Try again"]);
    for (const text of OPERATING_DEFAULTS) expect(screen.queryByText(text)).toBeNull();
  });

  it("renders only the skeleton while there is no business id yet, or the workspace is still being checked", async () => {
    mockApi();
    const body = () => document.querySelectorAll("button, a, input, select, textarea, [role=button], [role=link]");
    for (const state of [{ workspaceId: null, workspaceCheckedOnce: false, workspaceChecks: 0 },       // first paint: nothing confirmed yet
      { workspaceId: null, workspaceCheckedOnce: true, workspaceChecks: 1 },                            // a check is in flight (the session is being re-validated)
      { workspaceId: undefined, workspaceCheckedOnce: false, workspaceChecks: 2 }]) {
      useWorkspaceStore.setState(state);
      mount();
      expect(screen.getByRole("status", { name: "Loading your dashboard" })).toBeTruthy();
      expect(body().length).toBe(0);
      for (const text of OPERATING_DEFAULTS) expect(screen.queryByText(text)).toBeNull();
      expect(globalThis.fetch.mock.calls.filter(([u]) => /dashboard/.test(String(u)))).toEqual([]);      // nothing is requested for "no business"
      cleanup();
    }
    // The check finishes with a business: the page moves on to that business's composition, never through a default.
    useWorkspaceStore.setState({ workspaceId: null, workspaceCheckedOnce: false, workspaceChecks: 1 });
    mount();
    await act(async () => { useWorkspaceStore.setState({ workspaceId: "ws1", workspaceChecks: 0, workspaceCheckedOnce: true }); });
    expect(screen.getByRole("status", { name: "Loading your dashboard" })).toBeTruthy();
    expect(body().length).toBe(0);
    await waitFor(() => expect(release).toBeTypeOf("function"));
    await act(async () => { release(); });
    await screen.findByText("Pre-launch stage");
    for (const text of [/Enquiry to Quote/, /Receipt Sending/, /Essentials/]) expect(screen.queryByText(text)).toBeNull();
  });

  it("shows an empty state, not a default stage, once it is certain there is no business", () => {
    mockApi();
    useWorkspaceStore.setState({ workspaceId: null, workspaceCheckedOnce: true, workspaceChecks: 0 });
    mount();
    expect(screen.getByRole("status", { name: "No business yet" }).textContent).toContain("Set up your business to see your dashboard");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Set up your business"]);
    for (const text of OPERATING_DEFAULTS) expect(screen.queryByText(text)).toBeNull();
  });

  it("keeps the same user's business through a session re-check, and never reuses another user's", () => {
    const s = () => useWorkspaceStore.getState();
    useWorkspaceStore.setState({ workspaceId: "ws1", workspaceName: "Alchemy Test", workspaceOwnerEmail: "a@b.test" });
    s().resetForUser("a@b.test");
    expect([s().workspaceId, s().workspaceName]).toEqual(["ws1", "Alchemy Test"]);
    s().resetForUser("someone@else.test");
    expect([s().workspaceId, s().workspaceName, s().workspaceOwnerEmail]).toEqual([null, null, "someone@else.test"]);
    useWorkspaceStore.setState({ workspaceId: "ws1", workspaceOwnerEmail: "a@b.test" });
    s().resetForUser(null);                                                 // signed out
    expect(s().workspaceId).toBeNull();
  });

  it("the skeleton itself holds no controls or links", () => {
    const { container } = render(<DashboardSkeleton />);
    expect(container.querySelectorAll("button, a, input, select, [tabindex], [role=button], [role=link]").length).toBe(0);
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  });
});
