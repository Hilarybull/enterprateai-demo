import { expect, it } from "vitest";
import { launchStepDone, openLaunchSteps } from "./launchSteps";

// Synthetic launch plan: some parts filled by the owner or the Agent, some not
const subject = {
  data: { target_date: "2026-12-01", offer: { price: "65" }, economics: { price_per_unit: "65", variable_cost_per_unit: "20" },
    prerequisites: [{ id: "p1", name: "Public liability insurance" }], market: { channel: "Local Facebook groups", owner: "Ada (owner)" } },
  forecast: { data: { months: [{ month: "2026-12", receipts: "1300", payments: "" }] } },
  evidence: [],
};

it("drops a launch step once the plan holds what it asks for", () => {
  const steps = ["cash", "demand", "offer", "delivery", "process", "prerequisites", "route", "control"].map((key) => ({ key }));
  expect(openLaunchSteps(steps, subject).map((s) => s.key)).toEqual(["cash", "demand", "delivery", "process"]);
  expect(launchStepDone("cash", { ...subject, forecast: { data: { months: [{ month: "2026-12", receipts: "1300", payments: "400" }] } } })).toBe(true);
  expect(launchStepDone("control", { data: { target_date: "2026-12-01" } })).toBe(false);      // a date but nobody owns it
});

it("turns a launch plan's open checks into steps, with Confirm only where there is something to confirm", async () => {
  const { launchCaseSteps } = await import("./launchSteps");
  const check = (code, state, reason) => ({ code, state, reason });
  const plan = (data, checks) => ({ id: "l1", data, evidence: [], assessment: { result: { criteria: [{ code: "C", checks }] } } });
  const { steps } = launchCaseSteps(plan({ prerequisites: [{ id: "p", name: "CAC registration" }] }, [
    check("C1.A", "unknown", "No dated demand evidence is attached yet."), check("C1.B", "unknown", "There is no evidence to review yet."),
    check("C2.A", "unknown", "The offer is filled in but not confirmed yet."),
    check("C2.B", "unknown", "Enter the price per unit, the cost to deliver one unit and monthly fixed costs."),
    check("C3.A", "unknown", "The forecast was last confirmed more than 30 days ago. Confirm it is still right."),
    check("C6.A", "unknown", "No reviewer has confirmed this yet."), check("C6.B", "failed", "Not completed: CAC registration.")]));
  const by = Object.fromEntries(steps.map((s) => [s.code, s]));
  expect(by["C1.B"]).toBeUndefined();      // no evidence yet: nothing to review
  expect(by["C1.A"].to).toBe("/launch/l1?tab=evidence&add=evidence");
  expect(by["C2.A"].confirmOffer).toBe(true);
  expect(by["C2.B"]).toMatchObject({ title: "Add your price, cost and fixed costs" });
  expect(by["C2.B"].attest).toBeUndefined();      // its figures first
  expect(by["C3.A"].confirmForecast).toBe(true);
  expect(by["C6.A"].attest.code).toBe("C6.A");
  expect(by["C6.B"]).toMatchObject({ prereqDone: true, badge: "Must fix" });
  expect(launchCaseSteps(plan({ offer: { confirmed: true } }, [check("C2.A", "unknown", "x")])).steps).toEqual([]);      // confirmed since: waiting for the check
});
