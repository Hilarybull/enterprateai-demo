// Adaptive Dashboard (PRD-AD-001): priority cards and their states, the context row,
// and the Tool Library's entitlement-aware discovery.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import AdaptiveInsights, { DashboardContext, LaunchReadiness, ValueTile } from "./AdaptiveInsights";
import AgentPanel, { NeedsApprovalLine, NeedsApprovalPanel, PAUSED_TIP } from "../agent/AgentPanel";
import ToolLibraryPage from "../../pages/ToolLibraryPage";
import { TOOLS, searchTools, toolAccess } from "../../lib/tools";
import { buildKpiTrends } from "../../lib/dashboardTrends";
import { useAuthStore } from "../../store/auth";
import { useWorkspaceStore } from "../../store/workspace";

const card = (over = {}) => ({
  key: "risk", widget_id: "risk", title: "Fragility / Risk Alert", tone: "rose", state: "available", severity: "high", priority_class: 1,
  text: "2 customers make up 68% of your revenue. Consider diversifying your customer base.",
  cta: { label: "View risk details", capability: "risk_concentration" }, more: { capability: "risk_concentration" }, items: [],
  why: { summary: "Revenue from your largest customers is above the level you set as a risk.", source: "Paid and delivered invoices",
    evidence: [{ label: "Whale Ltd", value: "48% of revenue (£9,000.00)" }, { label: "Your alert threshold", value: "40%" }], missing: [], as_of: "2026-10-03T10:00:00Z" },
  ...over,
});
const dash = (insights, over = {}) => ({ insights, preferences: { hidden_widget_ids: [] }, entitlement: { credits_exhausted: false }, ...over });
const handlers = () => ({ onRetry: vi.fn(), onAction: vi.fn(), onWhy: vi.fn(), onHide: vi.fn(), onShowHidden: vi.fn() });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Adaptive insights", () => {
  it("shows the cards in the order composed for it, and never more than it was given", () => {
    const cards = [card(), card({ key: "next_step", title: "Recommended Next Step", priority_class: 2, tone: "brand" }),
      card({ key: "cash", title: "Cash Position", priority_class: 5, tone: "emerald", severity: "low" })];
    render(<AdaptiveInsights dashboard={dash(cards)} {...handlers()} />);
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label")))
      .toEqual(["Fragility / Risk Alert", "Recommended Next Step", "Cash Position"]);
    expect(screen.getByText("Needs attention")).toBeTruthy();                 // class 1
    expect(screen.getByText("Time-sensitive")).toBeTruthy();                  // class 2
  });

  it("answers 'Why am I seeing this?' with the evidence, its source and date", () => {
    const h = handlers();
    render(<AdaptiveInsights dashboard={dash([card()])} {...h} />);
    expect(screen.queryByText("Whale Ltd")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Why am I seeing/ }));
    expect(h.onWhy).toHaveBeenCalledTimes(1);
    // The customer's name is shown with its figure (it used to be squeezed out).
    const rows = [...document.querySelectorAll("dl > div")].map((d) => [d.querySelector("dt").textContent, d.querySelector("dd").textContent]);
    expect(rows).toEqual([["Whale Ltd", "48% of revenue (£9,000.00)"], ["Your alert threshold", "40%"]]);
    expect(document.querySelector("dt").className).not.toMatch(/truncate/);
    expect(screen.getByText(/Source: Paid and delivered invoices · records as of 3 Oct 2026/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hide this card" })).toBeNull();   // a critical card can't be hidden
  });

  it("says which input is missing instead of showing a number", () => {
    const c = card({ key: "cash", title: "Cash Position", state: "insufficient_data", severity: null, priority_class: 5,
      text: "No income or costs are recorded yet, so there is no cash position to show.",
      cta: { label: "Record income or costs", to: "/operations" },
      why: { summary: "Neither is recorded yet.", source: "Invoices and expenses", evidence: [], missing: ["A paid invoice", "A paid expense"] } });
    render(<AdaptiveInsights dashboard={dash([c])} {...handlers()} />);
    expect(screen.getByText("Needs data")).toBeTruthy();
    expect(screen.getByRole("article").textContent).not.toMatch(/£|\d/);
    fireEvent.click(screen.getByRole("button", { name: /Why am I seeing/ }));
    expect(screen.getByText("Still needed: A paid invoice, A paid expense.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide this card" })).toBeTruthy();
  });

  it("marks out-of-date figures with the reason and a way to refresh them", () => {
    const h = handlers();
    const refresh = { label: "Update records", to: "/operations" };
    const c = card({ key: "cash", title: "Cash Position", state: "stale", priority_class: 5,
      stale: { reason: "Nothing has been recorded since 1 Sep 2026, so this may be out of date.", refresh } });
    render(<AdaptiveInsights dashboard={dash([c])} {...h} />);
    expect(screen.getByText("May be out of date")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update records" }));
    expect(h.onAction).toHaveBeenCalledWith(c, refresh);
  });

  it("keeps a failure to the insight area, with a retry", () => {
    const h = handlers();
    render(<><p>KPI row still here</p><AdaptiveInsights dashboard={null} failed {...h} /></>);
    expect(screen.getByText("KPI row still here")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/Insights couldn't be loaded.*rest of your dashboard is unaffected/);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(h.onRetry).toHaveBeenCalled();
  });

  it("holds its space while loading, and says so when there is nothing to show", () => {
    const { rerender } = render(<AdaptiveInsights dashboard={null} loading {...handlers()} />);
    expect(screen.getByRole("status", { name: "Loading insights" }).children).toHaveLength(4);
    rerender(<AdaptiveInsights dashboard={dash([])} {...handlers()} />);
    expect(screen.getByText("Nothing needs your attention right now.")).toBeTruthy();
  });

  it("explains exhausted credits without hiding the insights", () => {
    const h = handlers();
    render(<AdaptiveInsights dashboard={dash([card()], { entitlement: { credits_exhausted: true } })} {...h} />);
    expect(screen.getByText(/Agent actions are paused. Your records and these insights are unaffected/)).toBeTruthy();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "See plans and credits" }));
    expect(h.onAction.mock.calls[0][1]).toEqual({ to: "/pricing", upgrade: true });
  });

  it("offers to bring hidden cards back", () => {
    const h = handlers();
    render(<AdaptiveInsights dashboard={dash([card()], { preferences: { hidden_widget_ids: ["scenario", "cash"] } })} {...h} />);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 hidden cards" }));
    expect(h.onShowHidden).toHaveBeenCalled();
  });
});

describe("Card actions (QA round 1)", () => {
  const withAgent = card({ cta: { label: "View risk details", explain: true }, agent_action: { label: "Ask Agent to help", capability: "risk_concentration" } });

  it("opens the explanation from the main button and the arrow, without starting anything", () => {
    const h = handlers();
    render(<AdaptiveInsights dashboard={dash([withAgent])} {...h} />);
    fireEvent.click(screen.getByRole("button", { name: "View risk details" }));
    expect(screen.getByText("Whale Ltd")).toBeTruthy();
    expect(h.onAction).not.toHaveBeenCalled();                               // no Agent run, no credits
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Whale Ltd")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Why am I seeing/ }));
    expect(screen.getByText("Whale Ltd")).toBeTruthy();
    expect(h.onAction).not.toHaveBeenCalled();
  });

  it("shows the explanation as a popover outside the card: one at a time, Esc and outside click close it, focus returns", () => {
    const h = handlers();
    const second = { ...withAgent, key: "cash", widget_id: "cash", title: "Cash Position", cta: { label: "View cash forecast", to: "/operations" }, agent_action: null,
      why: { summary: "Overdue since 2026-09-26T10:00:00Z.", source: "Invoices", evidence: [{ label: "INV-1", value: "£50.00 due 2026-09-26 (Aftred)" }], missing: [] } };
    render(<AdaptiveInsights dashboard={dash([withAgent, second])} {...h} />);
    const [risk, cash] = screen.getAllByRole("article");
    const link = screen.getByRole("button", { name: "Why am I seeing Cash Position?" });
    expect(link.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(link);
    const pop = screen.getByRole("dialog");
    expect(cash.contains(pop)).toBe(false);                                   // not inside the card: the card's height can't change
    expect(link.getAttribute("aria-expanded")).toBe("true");
    expect(link.getAttribute("aria-controls")).toBe(pop.id);
    expect(pop.textContent).toContain("£50.00 due 26 Sep 2026 (Aftred)");      // dates are written out, not ISO
    expect(pop.textContent).toContain("Overdue since 26 Sep 2026.");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: /Why am I seeing Fragility/ }));      // opening another closes the first
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog").textContent).toContain("Whale Ltd");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Why am I seeing Fragility/ }));
    fireEvent.click(link);
    fireEvent.mouseDown(risk);                                                // a click anywhere else closes it
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.onWhy).toHaveBeenCalledTimes(3);
    const before = window.innerWidth;
    window.innerWidth = 390;                                                  // under 640px it is a bottom sheet
    fireEvent.click(link);
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    window.innerWidth = before;
  });

  it("a locked scenario says so on its button, not in extra text, and unlocks for accounts with wider Simulation access", () => {
    const h = handlers();
    const locked = { ...withAgent, key: "next_step", widget_id: "next_step", title: "Recommended Next Step", detail: "2 overdue · £199.00", agent_action: null,
      note: "This scenario is on paid plans. Your plan includes the Baseline Continuity projection in Simulation.",
      cta: { label: "Run scenario · Pro", to: "/pricing", upgrade: true, locked: true, note: "x", unlocked_to: "/simulation?template=tmpl_payment_delay&pending=a,b" } };
    const { rerender } = render(<AdaptiveInsights dashboard={dash([locked])} {...h} />);
    expect(screen.getByText("2 overdue · £199.00").textContent).toBe("2 overdue · £199.00");      // the note is not run on from the detail
    expect(screen.queryByText(/This scenario is on paid plans/)).toBeNull();      // no extra line of text on the card
    const pro = screen.getByRole("button", { name: "Run scenario · Pro" });      // "· Pro" once, on the button
    expect(pro.getAttribute("title")).toMatch(/This scenario is on paid plans/);      // the full note is its tooltip
    expect(document.querySelector("[data-insight-text]").className).toContain("line-clamp-3");      // three lines of body text at most
    fireEvent.click(pro);
    expect(h.onAction.mock.calls[0][1]).toMatchObject({ to: "/pricing", upgrade: true });
    rerender(<AdaptiveInsights dashboard={dash([locked])} {...h} fullSimulation />);              // grandfathered plan, or Simulation granted by an administrator
    expect(screen.queryByText(/This scenario is on paid plans/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "See the scenario" }));
    expect(h.onAction.mock.calls[1][1]).toEqual({ label: "See the scenario", to: "/simulation?template=tmpl_payment_delay&pending=a,b" });
  });

  it("starts an Agent task only from the separate, labelled action", () => {
    const h = handlers();
    render(<AdaptiveInsights dashboard={dash([withAgent])} {...h} />);
    const ask = screen.getByRole("button", { name: /Ask Agent to help/ });
    expect(ask.textContent).toMatch(/uses AI Credits/);
    fireEvent.click(ask);
    expect(h.onAction).toHaveBeenCalledTimes(1);
    expect(h.onAction.mock.calls[0][1]).toMatchObject({ capability: "risk_concentration", agent: true });
  });

  it("shows no Agent action on a card that has none", () => {
    render(<AdaptiveInsights dashboard={dash([card({ agent_action: null })])} {...handlers()} />);
    expect(screen.queryByRole("button", { name: /Ask Agent/ })).toBeNull();
  });
});

describe("Receivables KPI (D-1)", () => {
  const now = new Date("2026-10-04T08:00:00Z").getTime();
  const inv = (id, total, status, over = {}) => ({ id, total_amount: total, status, issued_at: "2026-09-16", created_at: "2026-09-16T09:00:00Z",
    due_date: "2026-09-20", payments: [], ...over });
  const value = (invoices, rangeKey = "3m") => buildKpiTrends({ invoices, expenses: [], toWs: (n) => n, rangeKey, now }).receivables.value;

  it("counts issued, unpaid invoices and leaves out drafts and invoices on hold", () => {
    const invoices = [
      inv("a", 189, "sent"),                                                  // INV-1160926: sent, unpaid, overdue
      inv("b", 10, "delivered", { issued_at: "2026-10-04", created_at: "2026-10-04T07:00:00Z" }),
      inv("c", 40, "disputed"),
      inv("d", 70, "draft"),
      inv("e", 55, "voided"), inv("f", 60, "cancelled"), inv("g", 65, "credited"), inv("h", 30, "sent", { disputed: true }),
      inv("i", 288, "paid", { payments: [{ id: "p", amount: 288, paid_at: "2026-09-20" }] }),
    ];
    expect(value(invoices)).toBe(199);
    expect(value(invoices, "30d")).toBe(199);                                 // still owed, whatever the period
  });

  it("counts only the unpaid part of a part-paid invoice", () => {
    expect(value([inv("a", 288, "paid", { payment_type: "partial", payments: [{ id: "p", amount: 100, paid_at: "2026-09-20" }] })])).toBe(188);
  });
});

describe("Dashboard context", () => {
  const context = { pathway: "small_business", business_stage: "operating", stage_label: "Operating", stage_source: "records",
    detected_stage: "operating", stage_signals: ["4 invoices issued", "4 payments received"], can_change_stage: true, current_goal: "cash",
    headline: { key: "health", label: "Business health", value: "Healthy", state: "available", tone: "emerald" },
    stages: [{ key: "idea", label: "Idea" }, { key: "pre_launch", label: "Pre-launch" }, { key: "operating", label: "Operating" }, { key: "growth", label: "Growth" }],
    goals: [{ key: "launch", label: "Launch the business" }, { key: "cash", label: "Improve cash flow" }] };

  it("shows the stage with its headline metric and the current goal, and reports a goal change", () => {
    const onGoal = vi.fn();
    render(<DashboardContext context={context} onGoal={onGoal} />);
    expect(screen.getByText("Operating stage")).toBeTruthy();
    expect(screen.getByText("Business health: Healthy")).toBeTruthy();
    const select = screen.getByLabelText("Current goal");
    expect(select.value).toBe("cash");
    fireEvent.change(select, { target: { value: "launch" } });
    fireEvent.change(select, { target: { value: "" } });
    expect(onGoal.mock.calls).toEqual([["launch"], [null]]);
  });

  it("lets the user correct the stage, or hand it back to detection", () => {
    const onStage = vi.fn();
    const { rerender } = render(<DashboardContext context={context} onGoal={() => {}} onStage={onStage} />);
    fireEvent.click(screen.getByRole("button", { name: "Not right? Change it" }));
    const select = screen.getByLabelText("Business stage");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Detect from my records (Operating)", "Idea", "Pre-launch", "Operating", "Growth"]);
    fireEvent.change(select, { target: { value: "growth" } });
    expect(onStage).toHaveBeenLastCalledWith("growth");
    rerender(<DashboardContext context={{ ...context, business_stage: "growth", stage_label: "Growth", stage_source: "manual" }} onGoal={() => {}} onStage={onStage} />);
    fireEvent.click(screen.getByRole("button", { name: "Set by you. Change it" }));
    fireEvent.change(screen.getByLabelText("Business stage"), { target: { value: "" } });
    expect(onStage).toHaveBeenLastCalledWith(null);                          // back to the stage read from the records
  });

  it("offers no stage change to someone who can't make it, or in a preview", () => {
    const { rerender } = render(<DashboardContext context={{ ...context, can_change_stage: false }} onGoal={() => {}} onStage={() => {}} />);
    expect(screen.queryByRole("button", { name: /Change it/ })).toBeNull();
    rerender(<DashboardContext context={{ ...context, preview: true }} onGoal={() => {}} onStage={() => {}} />);
    expect(screen.queryByRole("button", { name: /Change it/ })).toBeNull();
  });

  it("shows the transition banner after the first payment, and a neutral headline when there is no data", () => {
    const transition = { from: "pre_launch", message: "You've taken your first payment. Your launch items stay here until 2 Nov 2026, then the dashboard moves fully to running the business." };
    const { rerender } = render(<DashboardContext context={{ ...context, transition }} onGoal={() => {}} />);
    expect(screen.getByRole("status").textContent).toMatch(/first payment.*2 Nov 2026/);
    rerender(<DashboardContext context={{ ...context, business_stage: "idea", stage_label: "Idea",
      headline: { key: "validation_score", label: "Validation", value: "Not run yet", state: "insufficient_data", tone: null } }} onGoal={() => {}} />);
    expect(screen.getByText("Idea stage")).toBeTruthy();
    expect(screen.getByText("Validation: Not run yet").className).toMatch(/text-slate-500/);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows when it was updated, refreshes on request, and marks a preview", () => {
    const onRefresh = vi.fn();
    const at = new Date(2026, 9, 4, 7, 41).toISOString();
    const { rerender } = render(<DashboardContext context={{ ...context, preview: true }} onGoal={() => {}} freshness={{ generated_at: at }} onRefresh={onRefresh} />);
    expect(screen.getByText(/Updated 07:41/)).toBeTruthy();
    expect(screen.getByText("Preview")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalled();
    rerender(<DashboardContext context={context} onGoal={() => {}} freshness={{ generated_at: at }} onRefresh={onRefresh} refreshing />);
    expect(screen.getByText(/Updating…/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" }).disabled).toBe(true);
    expect(screen.queryByText("Preview")).toBeNull();
  });
});

describe("Stage surfaces", () => {
  it("shows a KPI's value, or names what is missing with a way to add it", () => {
    const onOpen = vi.fn();
    const { rerender } = render(<ValueTile kpi={{ key: "launch_readiness", label: "Launch Readiness", value: "60%", hint: "3 of 5 in place", state: "available", tone: "amber" }} onOpen={onOpen} />);
    expect(screen.getByText("60%").className).toMatch(/text-amber-700/);
    expect(screen.getByText("3 of 5 in place")).toBeTruthy();
    const kpi = { key: "startup_costs", label: "Startup Costs", value: null, hint: "Add startup costs to your plan", state: "insufficient_data", to: "/simulation" };
    rerender(<ValueTile kpi={kpi} onOpen={onOpen} />);
    expect(screen.getByLabelText("No value yet").textContent).toBe("—");     // never a made-up figure
    expect(screen.getByText(/Add startup costs to your plan/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add it" }));
    expect(onOpen).toHaveBeenCalledWith(kpi);
  });

  it("lists the launch checklist with what is done and what to add", () => {
    const onOpen = vi.fn();
    const readiness = { done: 1, total: 2, percent: 50, items: [{ key: "a", label: "Business name", done: true, to: "/account" },
      { key: "b", label: "A validated business idea", done: false, to: "/validation" }] };
    render(<LaunchReadiness readiness={readiness} onOpen={onOpen} check={{ label: "Open the launch readiness check", to: "/launch/s1" }} />);
    expect(screen.getByText("Setup checklist: 1 of 2 in place")).toBeTruthy();      // a count, no percentage: it is not the Launch Readiness result
    expect(screen.queryByText(/%/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open the launch readiness check" }));      // its last row opens the check itself
    expect(onOpen).toHaveBeenLastCalledWith({ to: "/launch/s1" });
    expect(screen.getAllByRole("listitem").map((l) => l.textContent)).toEqual(["✓Business nameDone", "!A validated business ideaAdd",
      "→Launch Readiness looks at evidence, cash and blockers for the launch itself.Open the launch readiness check"]);
    fireEvent.click(screen.getByRole("button", { name: "Add: A validated business idea" }));
    expect(onOpen).toHaveBeenCalledWith(readiness.items[1]);
  });

  it("collapses an empty Needs Approval panel to one line", () => {
    render(<MemoryRouter><NeedsApprovalLine /></MemoryRouter>);
    const line = screen.getByLabelText("Needs approval");
    expect(line.textContent).toMatch(/Needs Approval0Nothing is waiting for you/);
    expect(line.querySelector("h2")).toBeNull();                              // a line, not a panel
  });

  it("shows the stage's prompt in the Agent's field, and no shortcut chips under it", () => {
    const base = { suggestions: [], needs_approval: [], entitlement: { is_paid: true, monthly_runs: 50, monthly_runs_used: 0 } };
    function Where() { return <p data-testid="where">{useLocation().pathname + useLocation().search}</p>; }
    const idea = { ...base, placeholder: "Ask EnterprateAI about your idea, plan or market…", shortcuts: [
      { key: "validate_idea", label: "Validate Idea", icon: "bulb", action: { to: "/validation" } },
      { key: "business_plan", label: "Business Plan", icon: "doc", action: { to: "/blueprint?tab=business-plans" } },
      { key: "market_sizing", label: "Market Sizing", icon: "bars", action: { to: "/validation" } },
      { key: "scenario_help", label: "Scenario Help", icon: "bars", action: { capability: "scenario_help" } }] };
    render(<MemoryRouter initialEntries={["/dashboard"]}><Routes>
      <Route path="/dashboard" element={<AgentPanel businessId="ws1" summary={idea} onChanged={() => {}} />} />
      <Route path="*" element={<Where />} /></Routes></MemoryRouter>);
    expect(screen.getByLabelText("Ask the EnterprateAI Agent").getAttribute("placeholder")).toBe("Ask EnterprateAI about your idea, plan or market…");
    // No shortcut chips under the field, at any stage: the field is the way in, and it is marked out in the brand colour.
    for (const label of ["Validate Idea", "Business Plan", "Market Sizing", "Scenario Help", "Enquiry to Quote", "Payment Follow-up", "Receipt Sending"]) {
      expect(screen.queryByRole("button", { name: new RegExp(`^${label}`) })).toBeNull();
    }
    expect(document.querySelector("[data-agent-field]").className.split(" ")).toContain("bg-white");      // the white field on the Agent's dark panel
    cleanup();
    render(<MemoryRouter><AgentPanel businessId="ws1" summary={base} onChanged={() => {}} /></MemoryRouter>);
    expect(screen.getByLabelText("Ask the EnterprateAI Agent").getAttribute("placeholder")).toMatch(/quotes, payments, risks or scenarios/);
    for (const label of ["Enquiry to Quote", "Quote to Invoice", "Payment Follow-up", "Receipt Sending", "Risk & Concentration", "Scenario Help"]) {
      expect(screen.queryByRole("button", { name: new RegExp(`^${label}`) })).toBeNull();
    }
  });

  it("shows a question as one tile; its input opens in a small dialog and the answer goes to that task", async () => {
    const calls = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init = {}) => {
      calls.push({ path: String(url), method: init.method || "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : null });
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const onChanged = vi.fn();
    const question = { run_id: "run-7", question: "What problem does your business solve? (1 to 2 sentences)",
      fields: [{ key: "problem", label: "The problem you solve", type: "textarea", required: true }] };
    const summary = { suggestions: [{ key: "question:run-7", icon: "chat", tone: "amber", mood: "needs_you", text: question.question, question, action: { run_id: "run-7" } }],
      needs_approval: [], entitlement: { is_paid: true, agent_tasks: true, monthly_runs: 50, monthly_runs_used: 0 } };
    render(<MemoryRouter><AgentPanel businessId="ws1" summary={summary} onChanged={onChanged} /></MemoryRouter>);
    // Once, as a tile; no form inside the card until the tile is opened.
    expect(screen.getAllByText(question.question).length).toBe(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("textarea")).toBeNull();
    const tile = screen.getByText(question.question).closest("button");
    expect(tile.getAttribute("data-mood")).toBe("needs_you");
    expect(tile.querySelector("span").className).toContain("amber");      // needs you: amber, not red
    fireEvent.click(tile);
    const dialog = screen.getByRole("dialog", { name: "The Agent needs one thing from you" });
    expect(dialog.className).toContain("max-h-[80vh]");                  // sized to its content, never taller than 80% of the screen
    const footer = dialog.querySelector("[data-form-footer]");
    expect(footer.className).toContain("sticky bottom-0");                // Continue and Cancel stay in view
    expect(within(footer).getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(within(footer).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(dialog.querySelector(".max-h-\\[200px\\]")).toBeNull();          // no inner box that scrolls the buttons away
    fireEvent.change(dialog.querySelector("textarea, input"), { target: { value: "Owners lose evenings to paperwork" } });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Continue" })); });
    const sent = calls.find((c) => c.method === "POST" && /\/workflow-runs\/run-7\/input$/.test(c.path));
    expect(sent.body).toEqual({ answers: { problem: "Owners lose evenings to paperwork" }, background: true });
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks 'Is this right?' with Confirm when the Agent only needs a check", () => {
    const question = { run_id: "run-8", question: "Is this right? “Offers Monthly bookkeeping”",
      fields: [{ key: "description", label: "What the business does", type: "textarea", required: true, default: "Offers Monthly bookkeeping", confirm: true }] };
    const summary = { suggestions: [{ key: "question:run-8", icon: "chat", tone: "amber", mood: "needs_you", text: "Is this right?", question, action: { run_id: "run-8" } }],
      needs_approval: [], entitlement: { is_paid: true, agent_tasks: true, monthly_runs: 50, monthly_runs_used: 0 } };
    render(<MemoryRouter><AgentPanel businessId="ws1" summary={summary} onChanged={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByText("Is this right?").closest("button"));
    const dialog = screen.getByRole("dialog", { name: "Is this right?" });
    expect(dialog.querySelector("textarea, input").value).toBe("Offers Monthly bookkeeping");      // there to edit
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toBeTruthy();
  });

  it("puts the insight card's button bottom left and the chevron bottom right, with 'Why am I seeing this?' in the chevron", () => {
    const h = handlers();
    render(<AdaptiveInsights dashboard={dash([card({ key: "next_step", title: "Recommended Next Step", priority_class: 2, tone: "brand", cta: { label: "Review in Needs Approval", to: "/agent" } })])} {...h} />);
    const article = screen.getByRole("article", { name: "Recommended Next Step" });
    const why = within(article).getByRole("button", { name: "Why am I seeing Recommended Next Step?" });
    expect(why.getAttribute("title")).toBe("Why am I seeing this?");
    expect(why.className).toContain("ml-auto");                           // bottom right
    expect(why.textContent).toBe("");                                     // a chevron, not a line of text
    expect(within(article).queryByText("Why am I seeing this?")).toBeNull();
    const row = why.parentElement;
    expect(row.firstElementChild.textContent).toBe("Review in Needs Approval");      // bottom left
    fireEvent.click(why);
    expect(why.getAttribute("aria-expanded")).toBe("true");
    expect(h.onWhy).toHaveBeenCalledTimes(1);
  });

  it("keeps the card to four tiles with '+N more', and colours each tile by what it means", () => {
    const tile = (key, tone, mood, text) => ({ key, icon: "doc", tone, mood, text, action: { to: "/agent" } });
    const summary = { needs_approval: [], entitlement: { is_paid: true, agent_tasks: true, monthly_runs: 50, monthly_runs_used: 0 }, suggestions: [
      tile("a", "emerald", "good", "Your launch is ready against its checklist. I'm watching for changes."), tile("b", "indigo", "working", "I'm drafting your funding pack."),
      tile("c", "amber", "needs_you", "I need a funding case before the funding pack can be drafted."), tile("d", "rose", "problem", "1 task needs attention."),
      tile("e", "slate", "idle", "The price test is switched off in Agent settings."), tile("f", "indigo", "working", "I'm checking your capacity.")] };
    render(<MemoryRouter><AgentPanel businessId="ws1" summary={summary} onChanged={() => {}} /></MemoryRouter>);
    const look = (text) => screen.getByText(text).closest("button").querySelector("span").className;
    expect(look("Your launch is ready against its checklist. I'm watching for changes.")).toContain("emerald");      // good news is never red
    expect(look("Your launch is ready against its checklist. I'm watching for changes.")).not.toContain("rose");
    expect(look("I'm drafting your funding pack.")).toContain("indigo");
    expect(look("I need a funding case before the funding pack can be drafted.")).toContain("amber");
    expect(look("1 task needs attention.")).toContain("rose");
    expect(screen.queryByText("The price test is switched off in Agent settings.")).toBeNull();      // beyond the 2×2
    expect(screen.getByRole("button", { name: "+2 more" })).toBeTruthy();
  });

  it("lets Needs Approval scroll inside its own box and shows an empty state when there is nothing", () => {
    const item = (n) => ({ approval_id: `a${n}`, run_id: `r${n}`, title: `Send quotation QUO-${n}`, subtitle: "BrightTech Ltd", age: "2h", kind: "quote", payload: { total: 100, currency: "GBP" } });
    const many = { needs_approval: [1, 2, 3, 4, 5, 6, 7].map(item), needs_approval_count: 7 };
    const { unmount } = render(<MemoryRouter><NeedsApprovalPanel businessId="ws1" summary={many} onChanged={() => {}} /></MemoryRouter>);
    const list = screen.getByTestId("needs-approval-list");
    expect(list.className).toContain("overflow-y-auto");
    expect(list.className).toContain("min-h-0");
    expect(screen.getByRole("region", { name: "Needs approval" }).className).toContain("xl:h-0 xl:min-h-full");      // takes the Agent card's height
    expect(list.querySelectorAll("[data-approval-row]").length).toBe(7);  // all of them, scrolled, not cut at four
    unmount();
    render(<MemoryRouter><NeedsApprovalPanel businessId="ws1" summary={{ needs_approval: [], needs_approval_count: 0 }} onChanged={() => {}} /></MemoryRouter>);
    expect(screen.getByText("Nothing needs your approval.")).toBeTruthy();
  });

  it("leaves out Agent shortcuts that make no sense at the stage", () => {
    const summary = { suggestions: [], needs_approval: [], entitlement: { is_paid: true, monthly_runs: 50, monthly_runs_used: 0 } };
    const { rerender } = render(<MemoryRouter><AgentPanel businessId="ws1" summary={summary} onChanged={() => {}} /></MemoryRouter>);
    expect(screen.queryByText("See what a 10% cost increase would do to your margins.")).toBeNull();      // no "run this" fillers
    expect(screen.queryByText("Would you like me to prepare a payment follow-up?")).toBeNull();      // findings come from the records
    rerender(<MemoryRouter><AgentPanel businessId="ws1" onChanged={() => {}}
      summary={{ ...summary, hidden_capabilities: ["payment_followup", "receipt_send", "risk_concentration", "quote_to_cash", "scenario_help"] }} /></MemoryRouter>);
    expect(screen.queryByText("See what a 10% cost increase would do to your margins.")).toBeNull();
    expect(screen.queryByText("Check your customer concentration risk.")).toBeNull();
    expect(screen.getByText("Paste a customer enquiry and I'll draft the quotation.")).toBeTruthy();
  });
});

describe("Tool Library", () => {
  function Where() { return <p data-testid="where">{useLocation().pathname + useLocation().search}</p>; }
  const mount = () => render(
    <MemoryRouter initialEntries={["/tools"]}>
      <Routes><Route path="/tools" element={<ToolLibraryPage />} /><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>);

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 202, headers: { "Content-Type": "application/json" } }));
    useWorkspaceStore.setState({ workspaceId: "ws1", isMemberMode: false, memberPermissionType: null, memberPermissions: null });
    useAuthStore.setState({ subscription: { plan_key: "explorer", status: "active" }, platformGrants: [], platformRestrictions: [] });
  });

  it("lists tools in groups with plain descriptions", () => {
    mount();
    for (const group of ["Plan", "Operate", "Sell", "Intelligence", "Agents"]) expect(screen.getByRole("heading", { name: group })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Idea Validation" })).toBeTruthy();
    expect(screen.getByText("Raise invoices, record payments and send receipts.")).toBeTruthy();
  });

  it("finds a tool by what it does, not by its module name", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Search tools"), { target: { value: "what if" } });
    expect(screen.getByRole("button", { name: "Open Scenarios & Simulation" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Catalogue" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Search tools"), { target: { value: "zzzz" } });
    expect(screen.getByRole("status").textContent).toMatch(/No tool matches/);
  });

  it("finds tools by the words people use: fragility, risk, runway, cash flow", () => {
    const names = (q) => searchTools(TOOLS, q).map((t) => t.name);
    expect(names("fragility")).toEqual(expect.arrayContaining(["Scenarios & Simulation", "Adaptive Dashboard"]));
    expect(names("risk")).toEqual(expect.arrayContaining(["Scenarios & Simulation", "Agent Centre"]));
    expect(names("runway")).toEqual(expect.arrayContaining(["Financial Reports", "Scenarios & Simulation"]));
    expect(names("cash flow")).toEqual(expect.arrayContaining(["Financial Reports", "Invoices & Receipts", "Expenses & Transactions"]));
    for (const q of ["fragility", "risk", "runway", "cash flow"]) expect(names(q).length).toBeGreaterThan(0);
  });

  it("starts with a search carried over from the dashboard", () => {
    render(<MemoryRouter initialEntries={["/tools?q=runway"]}><Routes><Route path="/tools" element={<ToolLibraryPage />} /></Routes></MemoryRouter>);
    expect(screen.getByLabelText("Search tools").value).toBe("runway");
    expect(screen.getByRole("button", { name: "Open Financial Reports" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Catalogue" })).toBeNull();
  });

  it("opens a tool in the current business, on its existing page", async () => {
    mount();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open Invoices & Receipts" })); });
    expect(screen.getByTestId("where").textContent).toBe("/operations?tab=Sales&sub=Invoices");
    const sent = globalThis.fetch.mock.calls.find(([u]) => /\/businesses\/ws1\/dashboard\/events$/.test(String(u)));
    expect(JSON.parse(sent[1].body)).toMatchObject({ type: "tool_opened", widget_id: "invoices" });
  });

  it("labels tools on a higher plan and sends them to plans, not into the tool", async () => {
    mount();
    const locked = screen.getByRole("button", { name: /Integrations: available on .* See plans/ });
    expect(within(locked).getByText("Upgrade to unlock")).toBeTruthy();
    await act(async () => { fireEvent.click(locked); });
    expect(screen.getByTestId("where").textContent).toBe("/pricing");
  });

  it("hides tools the user's role or an administrator has switched off", () => {
    const who = { subscription: { plan_key: "decision_engine", status: "active" }, platformGrants: [], platformRestrictions: [] };
    const tool = TOOLS.find((t) => t.id === "integrations");
    expect(toolAccess(tool, who).state).toBe("available");
    expect(toolAccess(tool, { ...who, isMemberMode: true, memberPermissionType: "module", memberPermissions: { modules: ["operations"] } }).state).toBe("hidden");
    expect(toolAccess(TOOLS.find((t) => t.id === "team"), { ...who, isMemberMode: true, memberPermissionType: "module", memberPermissions: { modules: [] } }).state).toBe("available");
  });

  it("every tool points at an existing page and has a description", () => {
    const routes = ["/validation", "/blueprint", "/business-plan", "/registration", "/operations", "/catalogue", "/integrations", "/team",
      "/marketplace", "/referrals", "/simulation", "/dashboard", "/launch", "/funding", "/marketplace/profile", "/agent", "/credits"];
    for (const t of TOOLS) {
      expect(routes).toContain(t.to.split("?")[0]);
      expect(t.description.length).toBeGreaterThan(20);
    }
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
    expect(searchTools(TOOLS, "").length).toBe(TOOLS.length);
  });
});
