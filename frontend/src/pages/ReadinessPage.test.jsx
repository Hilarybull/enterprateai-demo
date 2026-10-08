// Funding and Launch Readiness screens: list, guided setup with auto-save, results in words
// (not colour), conflicts kept on the page, and the dashboard strip.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ReadinessPage from "./ReadinessPage";
import ReadinessStrip from "../components/readiness/DashboardStrip";
import { actionCardsFor, arrangeInsights } from "../lib/dashboardLayout";
import { useWorkspaceStore } from "../store/workspace";

const profile = {
  key: "launch.commercial_service.uk@0.1", title: "Commercial service launch", version: "0.1", status_note: "Pilot checklist.",
  criteria: [{ code: "C1", title: "Customer and demand", weight: 15, section: "customers", checks: [{ code: "C1.A", label: "Demand evidence documented", kind: "computed" }, { code: "C1.B", label: "Evidence reviewed", kind: "attested" }] }],
  sections: [
    { key: "customers", title: "Customers and offer", fields: [{ key: "customers.target_segment", label: "Who is this launch for?", type: "textarea" }], evidence: ["C1.A"], attest: ["C1.B"] },
    { key: "sales", title: "Sales and launch plan", fields: [{ key: "market.channel", label: "First acquisition channel", type: "text" }] },
  ],
};
const result = {
  classification: "not_ready", headline: "Not prepared yet for the defined launch scope.", disclaimer: "It does not guarantee demand.", score: null, score_display: null,
  coverage: 80, gate_completeness: 80, blocker_count: 1, profile_title: "Commercial service launch", ruleset_version: "0.1", status_note: "Pilot checklist.",
  confidence: { level: "low", reasons: ["Some required evidence is missing."], note: "Forecasts remain assumptions." }, data_basis: { label: null },
  gates: [{ code: "B3", label: "Every required permission is completed", state: "failed", reason: "Required and not completed: Insurance.", remedy: "Complete the prerequisite and attach its evidence." },
    { code: "B1", label: "No cash shortfall", state: "unknown", reason: "The cash projection is not complete." }],
  criteria: [{ code: "C1", title: "Customer and demand", weight: 15, score: 50, state: "partially_met", section: "customers", tool: { label: "Customers and offer" },
    checks: [{ code: "C1.A", label: "Demand evidence documented", state: "passed", reason: "1 dated item." }, { code: "C1.B", label: "Evidence reviewed", state: "unknown", reason: "No reviewer has confirmed this yet." }] }],
  risks: [{ code: "pre_revenue", severity: "info", text: "A first launch: there is no trading history." }], metrics: { forecast: { state: "missing" } },
};
const subject = (over = {}) => ({
  id: "s1", business_id: "ws1", type: "launch_initiative", status: "preparing", revision: 3, title: "Bookkeeping launch",
  data: { name: "Bookkeeping launch", scope: "commercial", target_date: "2026-12-01", customers: { target_segment: "Small practices" }, provenance: {} },
  can: { "launch.read": true, "launch.edit": true, "launch.assess": true, "launch.review": true, "launch.export": true, "launch.decide": true },
  profile_definition: profile, sections: [{ key: "customers", title: "Customers and offer", answered: 1, total: 1 }, { key: "sales", title: "Sales and launch plan", answered: 0, total: 1 }],
  forecast: null, evidence: [], actions: [{ id: "a1", code: "B3", status: "open", title: "Complete the prerequisite and attach its evidence.", why: "Required and not completed: Insurance.", priority_reason: "A confirmed blocker.", evidence_required: "Evidence", section: "operations" }],
  assessment: { id: "as1", as_of: "2026-10-04", execution_status: "succeeded", result, freshness: { status: "current" } },
  summary: { classification: "not_ready", score: null, evidence_coverage: 80, blocker_count: 1, freshness: "current", open_actions: 1 }, decisions: [], scenarios_available: true, ...over,
});

let calls;
let routes;
function mockApi() {
  calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "").replace(/^.*?(\/businesses|\/readiness)/, "$1");
    const method = init.method || "GET";
    calls.push({ method, path, body: init.body ? JSON.parse(init.body) : null });
    const hit = routes.find((r) => r.method === method && r.match.test(path));
    const out = hit ? hit.reply(calls[calls.length - 1]) : { status: 404, body: { detail: "Not found." } };
    return new Response(JSON.stringify(out.body), { status: out.status || 200, headers: { "Content-Type": "application/json" } });
  });
}
const mount = (path, feature = "launch") => render(
  <MemoryRouter initialEntries={[path]}><Routes>
    <Route path={`/${feature}`} element={<ReadinessPage feature={feature} />} />
    <Route path={`/${feature}/:subjectId`} element={<ReadinessPage feature={feature} />} />
  </Routes></MemoryRouter>);

beforeEach(() => { useWorkspaceStore.setState({ workspaceId: "ws1" }); mockApi(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("readiness list", () => {
  it("explains the check when there is nothing yet, and says which options are not available", async () => {
    routes = [{ method: "GET", match: /funding-cases$/, reply: () => ({ body: { enabled: true, items: [], can: { "funding.edit": true },
      profiles: { current: { title: "Equity preparation", version: "0.1", status_note: "Pilot checklist." }, unavailable: [{ id: "funding.debt", route: "debt", title: "Loans and debt", reason: "Lender criteria have not been defined yet." }] } } }) }];
    mount("/funding", "funding");
    await screen.findByText(/It is not the likelihood of securing investment/);
    fireEvent.click(screen.getByRole("button", { name: "New funding case" }));
    expect(screen.getByRole("option", { name: "Loans and debt (not available yet)" }).disabled).toBe(true);
    expect(screen.getByText("Lender criteria have not been defined yet.")).toBeTruthy();
    expect(screen.getByPlaceholderText("Leave blank if you don't know yet")).toBeTruthy();
  });

  it("shows each launch with its result in words, and a switched-off feature says so", async () => {
    routes = [{ method: "GET", match: /launch-initiatives$/, reply: () => ({ body: { enabled: true, can: {}, profiles: {}, items: [
      { id: "s1", title: "Bookkeeping launch", status: "preparing", target_date: "2026-12-01", launch_type: "initial_business", summary: { classification: "not_ready", score: null, evidence_coverage: 80, blocker_count: 1, freshness: "stale", next_action: { title: "Complete the prerequisite" } } },
      { id: "s2", title: "Payroll launch", status: "draft", summary: { classification: null } }] } }) }];
    mount("/launch");
    const first = (await screen.findByText("Bookkeeping launch")).closest("button");
    expect(first.textContent).toContain("Not ready");
    expect(first.textContent).toContain("No overall score yet");
    expect(first.textContent).toContain("1 blocker");
    expect(first.textContent).toContain("Out of date");
    expect(screen.getByText("Payroll launch").closest("button").textContent).toContain("Not checked yet");      // never a zero score
    cleanup();
    routes = [{ method: "GET", match: /launch-initiatives$/, reply: () => ({ body: { enabled: false, items: [] } }) }];
    mount("/launch");
    await screen.findByText("Launch Readiness isn't switched on for this account yet.");
  });
});

describe("readiness detail", () => {
  it("shows the result, blockers and unknowns in words", async () => {
    routes = [{ method: "GET", match: /launch-initiatives\/s1$/, reply: () => ({ body: subject() }) }];
    mount("/launch/s1?tab=results");
    await screen.findByText("Not prepared yet for the defined launch scope.");
    expect(screen.getByText("No overall score until every item is known")).toBeTruthy();
    expect(screen.getByText("Blocking")).toBeTruthy();
    expect(screen.getByText("Required and not completed: Insurance.")).toBeTruthy();
    expect(screen.getAllByText("Not known yet").length).toBeGreaterThan(0);
    expect(screen.getByRole("progressbar", { name: "Evidence coverage" }).getAttribute("aria-valuenow")).toBe("80");
    expect(screen.getByText(/A first launch: there is no trading history/)).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Decision" })).toBeTruthy();
  });

  it("saves edits automatically and keeps them on the page when someone else saved first", async () => {
    let attempt = 0;
    routes = [
      { method: "GET", match: /launch-initiatives\/s1$/, reply: () => ({ body: subject() }) },
      { method: "GET", match: /forecasts$/, reply: () => ({ body: { items: [] } }) },
      { method: "PATCH", match: /launch-initiatives\/s1$/, reply: ({ body }) => {
        attempt += 1;
        if (attempt === 1) return { status: 409, body: { detail: { code: "stale_revision", message: "Someone else changed this while you were editing.", current: { revision: 4 } } } };
        return { body: subject({ revision: body.revision + 1, data: { ...subject().data, customers: body.changes.customers } }) };
      } },
    ];
    mount("/launch/s1");
    const box = await screen.findByLabelText("Who is this launch for?");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(box, { target: { value: "Practice owners" } });
    expect(screen.getByText("Saving shortly…")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    vi.useRealTimers();
    await screen.findByText("Apply my changes to the latest version");
    expect(screen.getByLabelText("Who is this launch for?").value).toBe("Practice owners");      // the edit was not lost
    const first = calls.find((c) => c.method === "PATCH");
    expect(first.body).toEqual({ revision: 3, changes: { customers: { target_segment: "Practice owners" } }, confirm: [] });
    fireEvent.click(screen.getByRole("button", { name: "Apply my changes to the latest version" }));
    await waitFor(() => expect(screen.getByText("All changes saved")).toBeTruthy());
    expect(calls.filter((c) => c.method === "PATCH")[1].body.revision).toBe(4);
  });

  it("shows field errors from the server beside the field, and a missing record as not found", async () => {
    routes = [
      { method: "GET", match: /launch-initiatives\/s1$/, reply: () => ({ body: subject() }) },
      { method: "PATCH", match: /launch-initiatives\/s1$/, reply: () => ({ status: 422, body: { detail: { code: "invalid", message: "Enter a valid date.", errors: { "customers.target_segment": "This answer isn't valid." } } } }) },
    ];
    mount("/launch/s1");
    const box = await screen.findByLabelText("Who is this launch for?");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(box, { target: { value: "x" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    vi.useRealTimers();
    expect((await screen.findByText("This answer isn't valid.")).getAttribute("role")).toBe("alert");
    expect(screen.getByText("Some answers need correcting before they can be saved.")).toBeTruthy();
    cleanup();
    routes = [];
    mount("/launch/other-business-record");
    await screen.findByText(/can't be found/);
  });

  it("read-only roles and archived records can't be edited", async () => {
    routes = [{ method: "GET", match: /launch-initiatives\/s1$/, reply: () => ({ body: subject({ status: "archived", can: { "launch.read": true, "launch.edit": true } }) }) }];
    mount("/launch/s1");
    expect((await screen.findByLabelText("Who is this launch for?")).disabled).toBe(true);
    expect(screen.getByText(/is archived. It can be read and exported/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reactivate" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Run the check/ })).toBeNull();
  });
});

describe("dashboard readiness bar", () => {
  const launch = { initiative_id: "s1", title: "Bookkeeping launch", classification: "not_ready", score: null, evidence_coverage: 80, blocker_count: 1, freshness: "stale", target_date: "2026-12-01",
    blockers: [{ code: "B3", label: "Permissions", reason: "Required and not completed: Insurance." }], next_action: { title: "Complete the prerequisite" } };
  const funding = { case_id: "c1", title: "Seed round", classification: null, score: null, coverage: null, execution_status: null, blockers: [] };

  it("has a half for each record, shows a pending check as pending, and hides when there is nothing", () => {
    const open = vi.fn();
    render(<ReadinessStrip onOpen={open} dashboard={{ launch_check: launch, funding_readiness: funding }} />);
    expect(screen.getByRole("region", { name: "Readiness" })).toBeTruthy();
    const half = screen.getByRole("button", { name: "Launch: Bookkeeping launch" });
    expect(half.textContent).toContain("Not ready");
    expect(half.textContent).toContain("Out of date");
    expect(half.textContent).toContain("Target 1 Dec 2026 · 1 blocker");
    const other = screen.getByRole("button", { name: "Funding: Seed round" });
    expect(other.textContent).toContain("Not checked yet");
    expect(other.textContent).not.toContain("Score");                       // never a zero score
    fireEvent.click(other);
    expect(open).toHaveBeenCalledWith("/funding/c1");
    cleanup();
    render(<ReadinessStrip onOpen={open} dashboard={{ launch_check: null, funding_readiness: { ...funding, classification: "not_ready", score: 52.5, next_action: { title: "Allocate the whole amount" } } }} />);
    expect(screen.queryByRole("button", { name: /^Launch:/ })).toBeNull();   // only the half that has data
    expect(screen.getByRole("button", { name: "Funding: Seed round" }).textContent).toContain("Score 52.5 · Next: Allocate the whole amount");
    cleanup();
    const { container } = render(<ReadinessStrip dashboard={{ launch_check: null, funding_readiness: null }} onOpen={open} />);
    expect(container.textContent).toBe("");
  });

  it("gives each stage its three action cards, with a readiness status once a record exists", () => {
    const keys = (stage, extra = {}) => actionCardsFor({ context: { business_stage: stage }, readiness_features: { funding: true, launch: true }, ...extra }).map((c) => c.key);
    expect(keys("idea")).toEqual(["validate", "business_plan", "scenarios"]);
    expect(keys("pre_launch")).toEqual(["launch_readiness", "registration", "funding_readiness"]);
    expect(keys("operating")).toEqual(["essentials", "validate", "scenarios"]);
    expect(keys("growth")).toEqual(["funding_readiness", "growth_scenarios", "essentials"]);
    expect(actionCardsFor(null).map((c) => c.key)).toEqual(["essentials", "validate", "scenarios"]);
    expect(keys("pre_launch", { readiness_features: { funding: false, launch: false } })).toEqual(["business_plan", "registration", "scenarios"]);
    const [l, , f] = actionCardsFor({ context: { business_stage: "pre_launch" }, readiness_features: { funding: true, launch: true }, launch_check: launch, funding_readiness: { ...funding, classification: "conditionally_ready", score: 72.5, freshness: "current" } });
    expect([l.cta, l.href, l.status.chip.label, l.status.score, l.status.stale]).toEqual(["Open launch plan", "/launch/s1", "Not ready", null, true]);
    expect([f.cta, f.href, f.status.chip.label, f.status.score, f.status.stale]).toEqual(["Open funding case", "/funding/c1", "Conditionally ready", 72.5, false]);
    const none = actionCardsFor({ context: { business_stage: "pre_launch" }, readiness_features: { funding: true, launch: true } });
    expect([none[0].cta, none[2].cta, none[0].status]).toEqual(["Check Launch Readiness", "Check Funding Readiness", undefined]);
  });

  it("shows at most four insight cards, with a blocker in the red risk slot and no separate blocker card", () => {
    const card = (key, cls, title) => ({ key, widget_id: key, title, tone: "indigo", state: "available", priority_class: cls, text: `${key} text`, cta: { label: "Go", to: "/x" }, why: {} });
    const base = [card("blocker", 1, "Launch / Funding Blocker"), card("risk", 1, "Fragility / Risk Alert"), card("next_step", 2, "Recommended Next Step"), card("scenario", 4, "Suggested Scenario"), card("cash", 5, "Cash Position")];
    const row = arrangeInsights({ insights: base, max_priority_cards: 4, launch_check: launch });
    expect(row.map((c) => c.title)).toEqual(["Launch blocker", "Recommended Next Step", "Suggested Scenario", "Cash Position"]);
    expect([row[0].tone, row[0].text, row[0].cta]).toEqual(["rose", "Required and not completed: Insurance.", { label: "View blocker", to: "/launch/s1?tab=results" }]);
    const gap = arrangeInsights({ insights: base.slice(1), max_priority_cards: 4, funding_readiness: { ...funding, blockers: [{ label: "G2", reason: "Allocations total 90,000 against 100,000." }] } });
    expect([gap[0].title, gap[0].cta.to, gap.length]).toEqual(["Funding gap", "/funding/c1?tab=results", 4]);
    expect(arrangeInsights({ insights: base.slice(1), max_priority_cards: 4 }).map((c) => c.key)).toEqual(["risk", "next_step", "scenario", "cash"]);      // nothing blocking: unchanged
    const step = arrangeInsights({ insights: [card("risk", 1, "Fragility / Risk Alert"), card("scenario", 4, "Suggested Scenario"), card("cash", 5, "Cash Position")], max_priority_cards: 4,
      launch_check: { ...launch, blockers: [] } });
    expect(step.map((c) => c.key)).toEqual(["risk", "next_step", "scenario", "cash"]);
    expect([step[1].text, step[1].cta.to]).toEqual(["Complete the prerequisite", "/launch/s1?tab=actions"]);
    expect(arrangeInsights({ insights: base, max_priority_cards: 4 })[0].title).toBe("Launch blocker");       // records say something is missing: same slot
    expect(arrangeInsights({ insights: base, max_priority_cards: 4 }).some((c) => c.key === "risk")).toBe(false);
  });
});

describe("Simulation pending receivables", () => {
  it("lists only invoices that can still be collected", async () => {
    const { isCollectable } = await import("./SimulationPage");
    const keep = (inv) => isCollectable(inv);
    expect([{ status: "pending" }, { status: "sent" }, { status: "overdue" }].every(keep)).toBe(true);
    expect([{ status: "paid" }, { status: "disputed" }, { status: "voided" }, { status: "cancelled" }, { status: "credited" },
      { status: "sent", disputed: true }, { status: "pending", dispute_status: "open" }].some(keep)).toBe(false);
  });
});

describe("shared formatting", () => {
  it("writes dates the same way everywhere and names an unnumbered invoice as Business Operations does", async () => {
    const { shortDate, invoiceNumbers } = await import("../lib/format");
    expect([shortDate("2026-09-26"), shortDate("2026-09-26T10:00:00Z"), shortDate(""), shortDate("soon")]).toEqual(["26 Sep 2026", "26 Sep 2026", "", "soon"]);
    const map = invoiceNumbers([
      { id: "b", created_at: "2026-09-16T15:00:00", reference: "c9e1f0f8-0000-4000-8000-000000000001" },      // an id where the number should be
      { id: "a", created_at: "2026-09-16T10:00:00" },
      { id: "k", created_at: "2026-09-16T12:00:00", invoice_number: "INV-77" },
      { id: "n", created_at: "2026-09-16T13:00:00", number_auto: true }]);
    expect([map.get("a"), map.get("b"), map.get("k"), map.has("n")]).toEqual(["INV-1160926", "INV-2160926", "INV-77", false]);
  });
});

describe("arriving from a goal started on the homepage", () => {
  const NOTE = "I set up your launch plan from what you told me: Bookkeeping launch. Not prepared yet for the defined launch scope. 1 thing to do next.";

  it("says once what was set up and where things stand, survives a reload, and goes when dismissed", async () => {
    routes = [{ method: "GET", match: /launch-initiatives\/s1$/, reply: () => ({ body: subject() }) }];
    sessionStorage.setItem("ea_goal_handoff", JSON.stringify({ to: "/launch/s1", message: NOTE }));
    const view = mount("/launch/s1?tab=results");
    const note = await screen.findByText(NOTE);
    expect(note.closest("[data-goal-handoff]").getAttribute("role")).toBe("status");
    expect(screen.getByText("Not prepared yet for the defined launch scope.")).toBeTruthy();      // the result of the check is on the page with it
    view.unmount();
    mount("/launch/s1?tab=results");                                        // a reload, or the page mounting twice: still there
    expect(await screen.findByText(NOTE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(sessionStorage.getItem("ea_goal_handoff")).toBeNull();
  });

  it("is shown only on the record it is about", async () => {
    routes = [{ method: "GET", match: /launch-initiatives\/s2$/, reply: () => ({ body: subject({ id: "s2" }) }) }];
    sessionStorage.setItem("ea_goal_handoff", JSON.stringify({ to: "/launch/s1", message: NOTE }));
    mount("/launch/s2?tab=results");
    await screen.findByText("Not prepared yet for the defined launch scope.");
    expect(document.querySelector("[data-goal-handoff]")).toBeNull();
    sessionStorage.removeItem("ea_goal_handoff");
  });
});
