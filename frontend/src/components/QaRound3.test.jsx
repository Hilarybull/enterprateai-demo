// QA round 3 on the front end: E3 the premium step starts its task in place (or offers a launch plan first),
// E6 the item picker's headings sit over their boxes, E8 one entitlement (plan + grants) for every lock.
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import QuickCheck from "./QuickCheck";
import { LineItems } from "./agent/AgentBits";
import { effectiveSubscription } from "../store/auth";
import { toolAccess, TOOLS } from "../lib/tools";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const click = async (el) => { await act(async () => { fireEvent.click(el); }); };
const Where = () => <span data-testid="where">{useLocation().pathname}</span>;

const QUESTIONS = [{ key: "kind", label: "What are you launching?", type: "choice", required: true, options: [{ value: "service", label: "A service" }] }];
const RESULT = { assessment_type: "launch_readiness_initial", headline: "Initial Launch Readiness", score: 38, score_label: "out of 100", evidence_coverage: 45, criteria: [],
  strengths: [], metrics: [], blockers: [{ key: "route", label: "Launch channel not defined", kind: "unknown" }],
  premium_next_action: { label: "Resolve my 1 launch blocker", explains: "I can now research the missing evidence." },
  free_next_actions: [{ label: "Save for later", save: true }], premium_gate: { allowed: true } };

// QA PF3 (replacing E3's "start a task"): the premium step is research reviewed in place. Each answer is the server's.
const RESEARCH = { id: "rr_1", goal: "launch", status: "review", before: { score: 38, score_label: "out of 100", evidence_coverage: 45, blockers: 1 }, blockers: RESULT.blockers,
  items: [
    { id: "i1", topic: "channels", criterion: "route", label: "Launch channels used by similar businesses", value: "Local Facebook groups and Nextdoor", state: "researched", confidence: 0.7,
      sources: [{ title: "How cleaners find clients", url: "https://example.org/cleaners", date: "Mar 2026" }] },
    { id: "i2", topic: "comparable_prices", criterion: "offer", label: "Comparable prices", value: "About £15 to £20 an hour", state: "estimated", confidence: 0.4, sources: [] }] };
const ADOPTED = { ...RESEARCH, status: "adopted", dataset_version: 1, after: { score: 43, score_label: "out of 100", evidence_coverage: 55, blockers: 1 } };

function mockApi({ quote, start = () => ({ started: true, research: RESEARCH }), review = () => ({ research: ADOPTED, result: RESULT }) } = {}) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method || "GET", body });
    if (/\/premium\/quote$/.test(path)) await new Promise((r) => setTimeout(r, 5));
    const out = /\/premium\/quote$/.test(path) ? quote() : /\/premium$/.test(path) ? start() : /\/review$/.test(path) ? review(body)
      : /\/attach$/.test(path) ? { initiative_id: "l1", created: true, title: "Home cleaning", to: "/launch/l1" }
      : (init.method || "GET") === "GET" ? { goal_key: "launch", questions: QUESTIONS } : { result: RESULT };
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}
async function toResult() {
  render(<MemoryRouter initialEntries={["/launch"]}><Routes><Route path="/launch" element={<QuickCheck businessId="ws1" goalKey="launch" open />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
  await click(await screen.findByRole("button", { name: "A service" }));
  await screen.findByRole("region", { name: "Initial Launch Readiness" });
}
const ALLOWED = () => ({ allowed: true, cost: 4, per_field: 2, fields_max: 2, balance: 20, after: 16, topics: ["Launch channels used by similar businesses", "Comparable prices"], blockers: 1 });

describe("PF3 the premium research, walked through in the browser", () => {
  it("cost first, one press only, then each finding reviewed and the check run again: before and after", async () => {
    const calls = mockApi({ quote: ALLOWED });
    await toResult();
    const cta = document.querySelector("[data-do-all]")      /* the one research button, under the steps (the owner, 20 Oct) */;
    await act(async () => { fireEvent.click(cta); fireEvent.click(cta); });      // a double click: one quote, never two
    expect(calls.filter((c) => /\/premium\/quote$/.test(c.path)).length).toBe(1);
    const confirm = await screen.findByRole("dialog", { name: "Before I start" });      // a modal on the page (F-2, F-3)
    expect(confirm.querySelector("[data-fv-cost]").textContent).toBe("Research your gaps. Up to 4 credits, and you only pay for what I find. You have 20.");
    expect(confirm.querySelector("[data-fv-plan]")).toBeNull();      // no "I'll answer each gap first" line, and no balance
    expect(calls.some((c) => /\/premium$/.test(c.path))).toBe(false);          // nothing has started yet
    await click(within(confirm).getByRole("button", { name: "Start" }));
    expect(calls.filter((c) => /\/premium$/.test(c.path)).length).toBe(1);
    // The drafts in the step cards (the owner's QA, 21 Oct: one result block); the full review folded under them, one press away.
    expect(document.querySelector("[data-next-steps]")).toBeTruthy();
    if (document.querySelector("[data-research-detail-toggle]")) await click(document.querySelector("[data-research-detail-toggle]"));
    if (document.querySelector("[data-see-everything]")) await click(document.querySelector("[data-see-everything]"));
    const review = screen.getByRole("region", { name: "Review the research" });
    const items = review.querySelectorAll("[data-research-item]");
    expect([...items].map((i) => i.querySelector("[data-research-state]").textContent)).toEqual(["Found online", "My estimate"]);
    expect(items[0].querySelector("[data-research-sources]").textContent).toBe("How cleaners find clientsDated Mar 2026");
    expect(items[0].querySelector("a").getAttribute("rel")).toContain("noopener");
    expect(items[1].querySelector("[data-research-sources]")).toBeNull();      // an estimate with no source shows none
    // Every result is the owner's to edit (QA, 17 Oct), a researched finding too.
    expect(within(items[0]).getByRole("button", { name: "Edit" })).toBeTruthy();
    await click(within(items[0]).getByRole("button", { name: "Accept" }));
    await click(within(items[1]).getByRole("button", { name: "Reject" }));
    await click(within(review).getByRole("button", { name: "Use what I adopted and check again" }));
    expect(calls.find((c) => /\/review$/.test(c.path)).body).toEqual({ decisions: { i1: { decision: "accept", pressed: true }, i2: { decision: "reject" } } });
    const done = document.querySelector("[data-research-adopted]");
    expect(done.querySelector("[data-score-change]").textContent).toBe("38 → 43 out of 100");
    expect(done.querySelector("[data-coverage-change]").textContent).toBe("45% → 55%");
    expect(screen.queryByTestId("where")).toBeNull();                             // still on the page
  });

  it("shows the plan gate before any cost, and nothing starts", async () => {
    const calls = mockApi({ quote: () => ({ allowed: false, gate: { allowed: false, reason: "plan", message: "This is available on an eligible plan.", primary: { label: "Upgrade to continue", to: "/pricing" }, secondary: [] } }) });
    await toResult();
    await click(document.querySelector("[data-do-all]")      /* the one research button, under the steps (the owner, 20 Oct) */);
    await waitFor(() => expect(document.querySelector("[data-fv-gate]").textContent).toContain("eligible plan"));
    expect(document.querySelector("[data-fv-cost]")).toBeNull();
    expect(calls.some((c) => /\/premium$/.test(c.path))).toBe(false);
  });

  it("R7: a question is answered or skipped, never left; then the check again, criterion by criterion", async () => {
    const withQuestions = { ...RESEARCH, research: "not_connected", counts: { researched: 0, estimated: 0, reused: 0, calculated: 1, asked: 2, sources: 0 },
      items: [
        { id: "q1", kind: "question", criterion: "control", field: "launch_owner", label: "Launch control", question: "Who owns the launch? (a name or a role)", type: "text" },
        { id: "q2", kind: "question", criterion: "process", field: "dry_run", label: "Operational process", question: "Have you taken one order from start to payment yet? What happened?", type: "text" },
        { id: "e1", kind: "estimated", basis: "calculated", criterion: "cash", derive: "cash_needed", label: "Cash needed to launch", value: "£3,500", used_for: "Cash needed to launch", working: ["Three months of fixed costs: 3 × £900 = £2,700"] }],
      deliverables: { use_of_funds: [{ line: "Working capital: three months of fixed costs", amount: 2700, how: "3 × £900" }], forecast: null,
        routes: [{ route: "loan", name: "Loan", what_it_is: "Borrowed and repaid with interest.", local: "Start Up Loans: £500 to £25,000", sources: [{ title: "Start Up Loans", url: "https://www.startuploans.co.uk/", date: "2026" }], preferred: true }],
        evidence_gaps: [{ criterion: "team", gap: "Who will deliver the plan is not recorded", how_to_close: "Name who will deliver the plan." }],
        executive_summary: "Home cleaning, for busy households. This is a draft from your own answers and figures. It makes no claim about the chance of being funded." } };
    const adopted = { ...withQuestions, status: "adopted", dataset_version: 1, after: { score: 52, score_label: "out of 100", evidence_coverage: 70 },
      changes: [{ criterion: "control", label: "Launch control", before: "unknown", after: "met" }, { criterion: "process", label: "Operational process", before: "unknown", after: "unknown" },
        { criterion: "cash", label: "Cash preparation", before: "unknown", after: "partially_met" }] };
    const calls = mockApi({ quote: () => ({ ...ALLOWED(), cost: 0, not_connected: "Research isn't connected yet. What can be worked out from your figures, and asked, still is; nothing is charged." }),
      start: () => ({ started: true, research: withQuestions }), review: () => ({ research: adopted, result: RESULT }) });
    await toResult();
    await click(document.querySelector("[data-do-all]")      /* the one research button, under the steps (the owner, 20 Oct) */);
    const confirm = await screen.findByRole("dialog", { name: "Before I start" });      // a modal on the page (F-2, F-3)
    expect(confirm.querySelector("[data-not-connected]").textContent).toMatch(/^Research isn't connected yet/);
    expect(confirm.querySelector("[data-fv-cost]").textContent).toBe("Research your gaps. Free.");
    await click(within(confirm).getByRole("button", { name: "Start" }));
    // The drafts in the step cards (the owner's QA, 21 Oct: one result block); the full review folded under them, one press away.
    expect(document.querySelector("[data-next-steps]")).toBeTruthy();
    if (document.querySelector("[data-research-detail-toggle]")) await click(document.querySelector("[data-research-detail-toggle]"));
    if (document.querySelector("[data-see-everything]")) await click(document.querySelector("[data-see-everything]"));
    const review = screen.getByRole("region", { name: "Review the research" });
    expect(review.querySelector("[data-research-error]").textContent).toContain("Research isn't available right now. Nothing was charged.");
    expect(review.querySelector("[data-research-counts]").textContent).toBe("0 found online · 0 my estimates · 0 already on record · 1 worked out · 2 to answer · 0 sources");
    // The draft first, on its own; the inputs open with "Check or review inputs".
    expect(review.querySelector("[data-funding-drafts] [data-route='loan']").textContent).toContain("Start Up LoansDated 2026");
    expect(review.querySelector("[data-research-item]")).toBeNull();
    expect(review.querySelector("[data-review-prompt]").textContent).toBe("1 input to adopt or edit and 2 questions for you. The gaps above update once you adopt them: until then nothing counts.");
    // With questions open, the one-press button opens the inputs to answer them first.
    expect(within(review).getByRole("button", { name: "Answer 2 questions and check again" })).toBeTruthy();
    await click(within(review).getByRole("button", { name: "Check or review inputs" }));
    expect(review.querySelector("[data-funding-drafts]")).toBeNull();
    expect(review.querySelector('[data-research-item="cash_needed"] [data-working]').textContent).toBe("Three months of fixed costs: 3 × £900 = £2,700");
    const adopt = within(review).getByRole("button", { name: "Use what I adopted and check again" });
    expect(adopt.disabled).toBe(false);                                      // pressable: it says what is left (QA, 17 Oct)
    expect(review.querySelector("[data-questions-left]").textContent).toBe("2 questions left: answer or skip each.");
    // Never blocked by a question left open (the owner's QA, 21 Oct); the count follows each press at once.
    fireEvent.change(within(review).getByLabelText("Who owns the launch? (a name or a role)"), { target: { value: "Hilary" } });
    expect(review.querySelector("[data-questions-left]").textContent).toBe("1 question left: answer or skip each.");
    await click(within(review.querySelector('[data-research-item="dry_run"]')).getByRole("button", { name: "Skip" }));
    expect(review.querySelector("[data-questions-left]")).toBeNull();
    expect(adopt.disabled).toBe(false);
    expect(review.querySelector("[data-undecided]").textContent).toBe("1 not adopted yet: they won't count unless you adopt them.");
    await click(within(review).getByRole("button", { name: "Adopt all (1)" }));
    await click(adopt);
    expect(calls.find((c) => /\/review$/.test(c.path)).body).toEqual({ decisions: { q1: { decision: "answer", value: "Hilary" }, q2: { decision: "skip", value: "" }, e1: { decision: "accept" } } });
    expect(document.querySelector("[data-research-adopted] [data-funding-drafts]")).toBeTruthy();      // after adopting: the draft again
    await click(within(document.querySelector("[data-research-adopted]")).getByRole("button", { name: "Check or review inputs" }));
    const rows = [...document.querySelectorAll("[data-criteria-changes] tbody tr")].map((r) => r.textContent);
    expect(rows).toEqual(["Launch controlNeed from youMet", "Operational processNeed from youNeed from you", "Cash preparationNeed from youPartly met"]);
  });
});

describe("E6 the item picker", () => {
  it("uses one grid for the headings and every row, so each label sits over its box", () => {
    function Host() { const [v, setV] = useState([{ product_id: null, name: "Gutter clean", quantity: 1, unit_price: 80, other: true }]); return <LineItems field={{ catalogue: [{ id: "p1", name: "Home cleaning", unit_price: 45 }] }} value={v} onChange={setV} />; }
    render(<Host />);
    const head = document.querySelector("[data-line-headings]");
    const row = document.querySelector("[data-line-row]");
    const grid = (el) => el.className.split(" ").find((c) => c.startsWith("grid-cols-"));
    expect(grid(head)).toBe(grid(row));
    expect(head.children.length).toBe(4);
    expect(row.children.length).toBe(4);                                    // item (choice + description stacked), qty, price, remove: never a second row
  });
});

describe("E8 one entitlement", () => {
  it("an admin full-access grant is the plan every lock reads; the subscribed plan stays for billing", () => {
    const sub = effectiveSubscription({ plan_key: "explorer", status: "active", effective_plan_key: "strategic_business_os", access_source: "admin full-access grant" });
    expect([sub.plan_key, sub.status, sub.subscribed_plan_key]).toEqual(["strategic_business_os", "active", "explorer"]);
    const livePlan = TOOLS.find((t) => t.id === "live_plan");
    expect(toolAccess(livePlan, { subscription: sub, platformGrants: [] }).state).toBe("available");      // no "Decision Engine plan · Upgrade"
    expect(toolAccess(livePlan, { subscription: effectiveSubscription({ plan_key: "explorer", status: "active" }), platformGrants: [] }).state).toBe("upgrade");
  });
});

describe("F-4 research that finds nothing", () => {
  it("says so in one line, shows no empty route sections, and nothing is charged", async () => {
    const empty = { ...RESEARCH, goal: "need_funding", charged: 0, items: [
      { id: "q1", kind: "question", criterion: "route", field: "route_grant", label: "Grants", question: "I looked, and found nothing I could point to. Do you know? (grants)", type: "text" }],
      counts: { researched: 0, estimated: 0, calculated: 0, reused: 0, asked: 1, sources: 0 },
      deliverables: { use_of_funds: null, forecast: null, evidence_gaps: [], executive_summary: "",
        routes: ["equity", "loan", "grant"].map((r) => ({ route: r, name: r, what_it_is: "", local: null, sources: [], preferred: false })) } };
    mockApi({ quote: ALLOWED, start: () => ({ started: true, research: empty }) });
    await toResult();
    await click(document.querySelector("[data-do-all]")      /* the one research button, under the steps (the owner, 20 Oct) */);
    await click(within(await screen.findByRole("dialog", { name: "Before I start" })).getByRole("button", { name: "Start" }));
    // The drafts in the step cards (the owner's QA, 21 Oct: one result block); the full review folded under them, one press away.
    expect(document.querySelector("[data-next-steps]")).toBeTruthy();
    if (document.querySelector("[data-research-detail-toggle]")) await click(document.querySelector("[data-research-detail-toggle]"));
    if (document.querySelector("[data-see-everything]")) await click(document.querySelector("[data-see-everything]"));
    const review = screen.getByRole("region", { name: "Review the research" });
    expect(review.querySelector("[data-research-empty]").textContent).toBe("I couldn't find anything useful this time, so nothing was charged.");
    expect(review.querySelector("[data-routes]")).toBeNull();
    expect(review.textContent).not.toContain("Nothing specific found with a source yet");
  });
});
