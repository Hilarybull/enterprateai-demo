// F-1: the Agent card's panel and its drawer show the same snapshot (the latest full check, labelled, the first result
// as "Earlier"). F-2/F-3: the primary opens the premium step's price and Start straight away, in a modal on the page.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import FirstResultPanel from "./FirstResultPanel";
import { useAuthStore } from "../store/auth";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname + l.search}</p>; }
const click = async (el) => { await act(async () => { fireEvent.click(el); }); };

const RESULT = { assessment_type: "funding_readiness_initial", headline: "Funding readiness", score: 30, evidence_coverage: 25, band: "Not ready yet", currency_sign: "£",
  key_numbers: ["£25,000 sought"], gaps: { failed: ["Use of funds"], early: [], unknown: ["Team"] }, strengths: [], blockers: [], metrics: [], criteria: [],
  premium_next_action: { label: "Help me become funding-ready", explains: "I can research what is missing and help close the gaps." },
  free_next_actions: [], premium_gate: { allowed: true },
  assessment: { assessment_id: "as1", kind: "funding", case_id: "fc1", title: "QA Seed round", classification: "not_ready", score: 55, evidence_coverage: 70,
    as_of: "2026-10-15T09:00:00Z", blocker_count: 1 } };

function mount(premium = vi.fn(async () => ({ confirm: { cost: 60, looking_at: ["grant schemes for small transport businesses in the UK"] }, start: vi.fn(async () => null) }))) {
  render(<MemoryRouter><FirstResultPanel firstResult={{ result: RESULT, premium, dismiss: vi.fn(), saveForLater: vi.fn() }} /><Where /></MemoryRouter>);
  return premium;
}

describe("F-1 one result, one set of numbers", () => {
  it("the panel shows the latest check, labelled, with the first result as earlier, and one Open to the case", async () => {
    mount();
    const panel = document.querySelector("[data-first-result-panel]");
    // One score (the latest check) and one coverage figure; no "Earlier", band or second bar (the owner's brief, 17 Oct).
    expect(panel.querySelector("[data-fv-score]").textContent).toBe("55/100");
    expect(panel.querySelector("[data-fv-coverage]")).toBeNull();      // coverage only under Advanced (22 Oct)
    expect(panel.querySelector("[data-result-gaps]")).toBeNull();
    expect(panel.querySelector("[data-result-band]")).toBeNull();
    const labels = [...panel.querySelectorAll("[data-result-actions] button")].map((b) => b.textContent);
    expect(labels).not.toContain("View details");
    await click(within(panel).getByRole("link", { name: "Open full page" }));
    expect(screen.getByTestId("where").textContent).toBe("/funding/fc1?tab=results");
  });
});

// The dashboard card (the owner's brief, 20 Oct): one button per step with its cost, one "Do all for me" link, one pack
// button, and "Open full page" as the only link. No "Help me become funding-ready", "Refresh research", "Save for later"
// or "Edit answers" on the card.
const STEPPED = { ...RESULT, blockers: [{ key: "financial", kind: "unknown", label: "Financial plan" }, { key: "team", kind: "unknown", label: "Team" }] };

describe("F-2 every paid button opens the spending modal first", () => {
  it("Do all for me shows its price and Start in a modal, focus on Not now, nothing started yet", async () => {
    const premium = vi.fn(async () => ({ confirm: { cost: 60, looking_at: ["grant schemes"], topics: ["Funding routes", "Market size"],
      plan: { research: 2, estimate: 0, worked_out: 1, asked: 1 } }, start: vi.fn(async () => null) }));
    render(<MemoryRouter><FirstResultPanel firstResult={{ result: STEPPED, premium, dismiss: vi.fn(), saveForLater: vi.fn() }} /><Where /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: /Help me become funding-ready/ })).toBeNull();
    await click(document.querySelector("[data-do-all]"));
    expect(premium).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole("dialog", { name: "Before I start" });
    expect(dialog.querySelector("[data-fv-cost]").textContent).toBe("Research your gaps. Up to 60 credits, and you only pay for what I find.");
    expect(document.activeElement.textContent).toBe("Not now");
    // Said plainly (the owner, 20 Oct): what it does for which steps, then the price, then Not now and Start.
    expect(dialog.querySelector("[data-fv-confirm-title]").textContent).toBe("Do all 2 steps for you");
    expect([...dialog.querySelectorAll("[data-fv-doing] li")].map((li) => li.textContent)).toEqual([
      "Look up 2 things funders ask about: funding routes, market size", "Work out 1 figure from what you told me", "Ask you 1 question only you can answer"]);
    expect([...dialog.querySelectorAll("button[data-not-now], button[data-fv-start]")].map((b) => b.textContent)).toEqual(["Not now", "Start"]);
    await click(within(dialog).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog", { name: "Before I start" })).toBeNull();
  });
});

describe("the card has one research button, one pack button and one link", () => {
  const withState = (research, extra = {}) => ({ ...STEPPED, research, free_next_actions: [{ label: "Prepare my funding pack", to: "/funding?tab=documents" }, { label: "Save for later", save: true }], ...extra });
  const put = (result) => render(<MemoryRouter><FirstResultPanel firstResult={{ result, premium: vi.fn(), dismiss: vi.fn(), saveForLater: vi.fn() }} /><Where /></MemoryRouter>);
  const onPlan = (plan_key) => useAuthStore.setState({ subscription: { plan_key, status: "active", billing_period: "monthly" }, platformGrants: [] });
  afterEach(() => onPlan("explorer"));

  it("the steps have no buttons of their own, the links row has only Open full page", () => {
    put(withState({ state: "none" }));
    const steps = [...document.querySelectorAll("[data-next-step]")];
    // No button on a card (the owner, 20 Oct): "I'll do it" at its bottom, and one "Do all for me" for every step.
    expect(steps.map((li) => li.querySelectorAll("button").length)).toEqual([0, 0]);
    expect(steps.every((li) => li.querySelector("[data-step-actions] [data-step-mine]"))).toBe(true);
    expect(document.querySelectorAll("[data-do-all]").length).toBe(1);
    expect([...document.querySelectorAll("[data-result-actions] a, [data-result-actions] button")].map((x) => x.textContent)).toEqual(["Open full page"]);
    for (const gone of [/Refresh research/, /Save for later/, /Edit answers/]) expect(screen.queryByRole("button", { name: gone })).toBeNull();
    expect(document.querySelector("[data-result-numbers]")).toBeNull();      // the score once, never "38 out of 100 · 2 of 8 in place"
  });

  it("below Decision Engine: the one pack button names the plan", () => {
    onPlan("starter_insight");
    put(withState({ state: "stale", run_id: "rr_1", findings: 5, max: 60, adopted: true }));
    expect(document.querySelector("[data-pack-create]").textContent).toBe("Funding pack (Decision Engine plan)");
  });

  it("no pack yet: Prepare my funding pack; once it exists: View funding pack. Never Create what is missing", () => {
    onPlan("decision_engine");
    put(withState({ state: "adopted", run_id: "rr_1", findings: 5, max: 60 }));
    expect(document.querySelector("[data-pack-create]").textContent).toMatch(/^Prepare my funding pack/);
    cleanup();
    put(withState({ state: "adopted", run_id: "rr_1", findings: 5, max: 60 }, { assessment: { ...RESULT.assessment, pack: { ready: 2, total: 4 } } }));
    expect(document.querySelector("[data-pack-create]").textContent).toBe("View funding pack");
    expect(screen.queryByText(/Create what is missing/)).toBeNull();
  });
});
