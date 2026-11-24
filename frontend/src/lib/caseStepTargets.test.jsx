// F-6 (22 Oct): every step's button targets the exact field, by the form's own element id, for every kind of step the
// funding case can make. The form is rendered from the profile's own field types; each target must exist and be that field.
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Field } from "../components/readiness/Fields";
import { caseSteps, fieldId } from "./caseSteps";

afterEach(cleanup);

const f = (key, type = "text", extra = {}) => ({ key, label: key, type, ...extra });
// As the funding profile lays the sections out (backend rules.py)
const SECTIONS = {
  goal: [f("title"), f("target_amount", "money"), f("receipt_date", "date"), f("purpose", "textarea"),
    f("milestones", "list", { item: "milestone", fields: [f("outcome"), f("measure"), f("baseline"), f("target"), f("due_date", "date"), f("owner")] }),
    f("purpose_milestone_id", "ref", { of: "milestones", show: "outcome" })],
  market: [f("market.target_segment", "textarea"), f("market.differentiation", "textarea"), f("market.acquisition_approach", "textarea"),
    f("market.acquisition_owner"), f("market.acquisition_cost"), f("market.acquisition_milestone_id", "ref", { of: "milestones", show: "outcome" })],
  finances: [f("economics.price", "money"), f("economics.direct_cost", "money"), f("economics.fixed_costs_monthly", "money"),
    f("use_of_funds", "list", { item: "allocation", fields: [f("category"), f("amount", "money"), f("period", "month"), f("purpose"), f("rationale"), f("milestone_id", "ref", { of: "milestones", show: "outcome" })] })],
  team: [f("team.responsibilities", "list", { item: "responsibility", fields: [f("area"), f("owner")] }),
    f("team.gaps", "list", { item: "gap", fields: [f("gap"), f("action")] }), f("team.no_gaps", "boolean")],
  documents: [f("risks", "list", { item: "risk", fields: [f("risk"), f("action")] }), f("no_known_risks", "boolean")],
};

// A case where every kind of step appears at once
const data = {
  title: "£250k grant for hiring", target_amount: "100000", currency: "GBP", receipt_date: "2027-04-30", timing_confirmed: true, purpose: "",
  milestones: [{ id: "m1", outcome: "Hire two cleaners", measure: "hires", target: "2", due_date: "2027-06-01" },
    { id: "m9", outcome: "Convert waiting list into paying customers", measure: "customers" }],
  use_of_funds: [{ id: "a1", category: "Other", amount: "600", period: "2027-04", purpose: "Kit" },
    { id: "a2", category: "Reserve", amount: "249400", period: "", purpose: "", rationale: "Pending approval", milestone_id: "m9" }],
  market: { target_segment: "Families", differentiation: "", acquisition_approach: "", acquisition_owner: "", acquisition_cost: "" },
  economics: { price: "", direct_cost: "20", fixed_costs_monthly: "" },
  team: { responsibilities: [{ id: "r1", area: "Delivery", owner: "" }], gaps: [{ id: "g1", gap: "One van", action: "" }] },
  risks: [{ id: "k1", risk: "Staff churn", action: "" }],
};
const subject = { id: "c1", data, forecast: { data: { opening_cash: "", months: [] } } };

it("every step targets a real field, by id, and says what it does", () => {
  const { steps } = caseSteps(subject, { max: 100 });
  render(<MemoryRouter><form>{Object.entries(SECTIONS).flatMap(([section, fields]) =>
    fields.map((field) => <Field key={`${section}-${field.key}`} field={field} data={data} onChange={() => {}} idBase={section} />))}</form></MemoryRouter>);
  const targeted = steps.filter((s) => s.focus);
  expect(targeted.length).toBeGreaterThan(15);
  for (const s of targeted) {
    const el = document.getElementById(s.focus);
    expect(el, `${s.key} → ${s.focus}`).toBeTruthy();
    expect(["INPUT", "TEXTAREA", "SELECT"]).toContain(el.tagName);
    expect(s.cta, s.key).not.toBe("Fill it in");
    for (const m of s.more || []) expect(document.getElementById(m.focus), `${s.key} / ${m.label}`).toBeTruthy();
  }
  const by = Object.fromEntries(steps.map((s) => [s.key, s]));
  // by item id, never by position: the over-allocation focuses the £249,400 line's amount and offers the target
  expect(by["uof.total"]).toMatchObject({ focus: fieldId("finances", "use_of_funds", 1, "amount"), cta: "Fix allocations" });
  expect(by["uof.total"].why).toBe("£250,000 of £100,000 allocated. The lines must add up to the amount you are raising.");
  expect(by["uof.total"].more[0]).toMatchObject({ label: "Change the target", focus: "goal-target_amount" });
  // the milestone the line names (m9, the second), its first missing part
  expect(by["goal.milestone.measure"]).toMatchObject({ focus: fieldId("goal", "milestones", 1, "target"), cta: "Complete milestone" });
  expect(by["goal.title"]).toMatchObject({ focus: "goal-title", cta: "Edit title" });
  expect(by["goal.title"].more[0]).toMatchObject({ label: "Edit target", focus: "goal-target_amount" });
  expect(by["uof.purpose"]).toMatchObject({ focus: fieldId("finances", "use_of_funds", 1, "rationale") });      // "Pending approval" is not a rationale
  expect(by["team.owner.r1"]).toMatchObject({ focus: "team-team.responsibilities-0-owner", cta: "Add owner" });
});

it("evidence opens the evidence form, ready to fill", () => {
  const s = caseSteps({ ...subject, assessment: { result: { criteria: [{ checks: [{ code: "C4.A", state: "unknown" }] }] } } }, { max: 100 }).steps.find((x) => x.key === "evidence");
  expect(s).toMatchObject({ to: "/funding/c1?tab=evidence&add=evidence", cta: "Add evidence" });
});
