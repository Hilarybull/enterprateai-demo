// F-1: the Agent card's panel and its drawer show the same snapshot (the latest full check, labelled, the first result
// as "Earlier"). F-2/F-3: the primary opens the premium step's price and Start straight away, in a modal on the page.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import FirstResultPanel from "./FirstResultPanel";

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
    expect(panel.querySelector("[data-result-numbers]").textContent).toBe("Latest check: 55/100 · 15 Oct");
    expect(panel.querySelector("[data-result-gaps]").textContent).toBe("Earlier: 30/100 (first result) · 1 blocker in the full check");
    expect(panel.querySelector("[data-result-coverage]").getAttribute("title")).toBe("Evidence coverage 70%");
    expect(panel.querySelector("[data-result-band]").textContent).toBe("Not ready");
    const labels = [...panel.querySelectorAll("[data-result-actions] button")].map((b) => b.textContent);
    expect(labels).not.toContain("View details");
    expect(labels.filter((l) => /^Open /.test(l))).toEqual(["Open funding case"]);
    await click(screen.getByRole("button", { name: "Open funding case" }));
    expect(screen.getByTestId("where").textContent).toBe("/funding/fc1?tab=results");
  });
});

describe("F-2 the primary opens the premium step directly", () => {
  it("shows its price and Start in a modal, nothing started yet", async () => {
    const premium = mount();
    await click(screen.getByRole("button", { name: "Help me become funding-ready" }));
    expect(premium).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole("dialog", { name: "Before I start" });
    expect(dialog.querySelector("[data-fv-cost]").textContent).toBe("Research your gaps. Up to 60 credits, and you only pay for what I find.");
    expect(within(dialog).getByRole("button", { name: "Start" })).toBeTruthy();
    expect(document.querySelector("[data-result-drawer]")).toBeNull();
    await click(within(dialog).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog", { name: "Before I start" })).toBeNull();
  });
});

describe("the funding-ready button follows the research", () => {
  const withState = (research, extra = {}) => ({ ...RESULT, research, free_next_actions: [{ label: "Prepare my funding pack", to: "/funding?tab=documents" }, { label: "Open funding case", to: "/funding?tab=results" }], ...extra });
  const shown = () => [...document.querySelectorAll("[data-result-actions] button")].map((b) => b.textContent);
  const put = (result) => render(<MemoryRouter><FirstResultPanel firstResult={{ result, premium: vi.fn(), dismiss: vi.fn(), saveForLater: vi.fn() }} /><Where /></MemoryRouter>);

  it("findings waiting: Review findings (5), never a second paid run", () => {
    put(withState({ state: "review", run_id: "rr_1", findings: 5, max: 60 }));
    expect(shown()[0]).toBe("Review findings (5)");
    expect(shown()).not.toContain("Help me become funding-ready");
  });

  it("adopted: the pack is the main button and Help me become funding-ready is gone", () => {
    put(withState({ state: "adopted", run_id: "rr_1", findings: 5, max: 60 }, { assessment: { ...RESULT.assessment, pack: { ready: 2, total: 4 } } }));
    expect(shown()[0]).toBe("View funding pack (2 of 4 ready)");
    expect(shown()).not.toContain("Help me become funding-ready");
  });

  it("answers changed: the pack stays first, with Refresh research at its price", () => {
    put(withState({ state: "stale", run_id: "rr_1", findings: 5, max: 60, adopted: true }));
    expect(shown()[0]).toBe("Prepare my funding pack");
    expect(shown()).toContain("Refresh research · up to 60 credits");
  });
});
