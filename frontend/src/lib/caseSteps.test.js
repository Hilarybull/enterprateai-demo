import { describe, expect, it } from "vitest";
import { caseSteps, sectionCounts } from "./caseSteps";

// Synthetic: a case mostly filled, as in the owner's brief (21 Oct). Only what is still missing becomes a step.
const months = Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, receipts: "1200000", payments: "490000" }));
const subject = {
  id: "c1",
  data: {
    currency: "NGN", target_amount: "5000000", receipt_date: "2026-12-01", timing_confirmed: true, purpose: "Two more washing bays",
    milestones: [{ id: "m1", outcome: "Washing bays installed and operational", measure: "bays", target: "2" }, { id: "m2", outcome: "More customers", measure: "customers", target: "40" }],
    purpose_milestone_id: null,
    use_of_funds: [{ id: "a1", category: "Equipment", amount: "4880000", purpose: "bays" }, { id: "a2", category: "Operations", amount: "120000", period: "2026-12", purpose: "working capital" }],
    economics: { price: "4000", direct_cost: "1500", fixed_costs_monthly: "40000" },
    market: { target_segment: "office workers", differentiation: "fast", acquisition_approach: "flyers", acquisition_owner: "Ada", acquisition_cost: "20000", acquisition_milestone_id: "m2" },
    team: { responsibilities: [{ id: "r1", area: "Delivery", owner: "Ada" }, { id: "r2", area: "Sales", owner: "" }], no_gaps: true },
    no_known_risks: true,
  },
  forecast: { data: { opening_cash: "300000", months, assumptions: [{ applies_to: "receipts", text: "x", source: "y" }, { applies_to: "payments", text: "x", source: "y" }] } },
  assessment: { result: { criteria: [{ code: "C4", checks: [{ code: "C4.A", state: "passed" }] }] } },
  sections: [{ key: "goal", title: "Funding goal", answered: 6, total: 7 }, { key: "finances", title: "Finances and use of funds", answered: 4, total: 5 }],
};

describe("the case's own next steps", () => {
  it("names only what is missing, from the case's own figures", () => {
    const { steps } = caseSteps(subject);
    expect(steps.map((s) => s.title)).toEqual([
      "Add a month to your ₦4,880,000 Equipment line",
      "Link your use of funds to a milestone: Washing bays installed and operational",
      "Name the owner of Sales",
    ]);
    expect(steps.every((s) => s.to.startsWith("/funding/c1?tab=answers&section="))).toBe(true);
  });

  it("has no step once everything is filled", () => {
    const full = { ...subject, data: { ...subject.data, purpose_milestone_id: "m1",
      use_of_funds: subject.data.use_of_funds.map((a) => ({ ...a, period: "2026-12" })),
      team: { responsibilities: [{ id: "r1", area: "Delivery", owner: "Ada" }], no_gaps: true } } };
    expect(caseSteps(full).steps).toEqual([]);
  });

  it("says each section's count", () => {
    expect(sectionCounts(subject).map((x) => x.text)).toEqual(["Funding goal 6 of 7", "Finances 4 of 5"]);
  });
});

describe("the Agent's forecast", () => {
  it("asks to confirm it once it is complete, and not after", () => {
    const drafted = { ...subject, data: { ...subject.data, purpose_milestone_id: "m1", use_of_funds: subject.data.use_of_funds.map((a) => ({ ...a, period: "2026-12" })),
      team: { responsibilities: [{ id: "r1", area: "Delivery", owner: "Ada" }], no_gaps: true } },
    forecast: { data: { ...subject.forecast.data, drafted_by: "Agent", confirmed_at: null } } };
    expect(caseSteps(drafted).steps.map((s) => s.key)).toEqual(["forecast.confirm"]);
    expect(caseSteps({ ...drafted, forecast: { data: { ...drafted.forecast.data, confirmed_at: "2026-10-21" } } }).steps).toEqual([]);
  });
});

describe("each step opens its own field, and the counts agree", () => {
  it("links to the field and treats a non-answer as blank", () => {
    const s = { ...subject, data: { ...subject.data, market: { ...subject.data.market, acquisition_approach: "No acquisition channels or first steps are described in the available information." } } };
    const steps = caseSteps(s, { max: 50 }).steps;
    expect(steps.find((x) => x.key === "uof.period").to).toBe("/funding/c1?tab=answers&section=finances&field=use_of_funds");
    expect(steps.find((x) => x.key === "market.approach").to).toContain("field=market.acquisition_approach");
    expect(sectionCounts({ ...s, sections: [{ key: "finances", title: "Finances and use of funds", answered: 5, total: 5 }] }, steps))
      .toEqual([{ key: "finances", done: false, text: "Finances: 1 to fix" }]);
  });
});
