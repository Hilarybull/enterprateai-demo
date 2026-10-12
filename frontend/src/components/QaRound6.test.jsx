// QA round 6 in the browser: the plan is checked before any cost is shown (PF1), the cost shown is the server's (PF2),
// refusals are words never codes, and the simulation says what it can't work out (PF4).
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import CreditConfirmModal from "./CreditConfirmModal";
import { refusalMessage } from "../lib/entitlement";
import { CLIENT_SCENARIOS, atRisk, ratioText } from "../pages/SimulationPage";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function serverSays(check) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ path: String(url), body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(check), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("PF1 the plan before the cost", () => {
  it("a full-access test grant is entitled: the server's price is shown, never the page's own", async () => {
    const calls = serverSays({ entitled: true, cost_shown: 40, available_credits: 236, feature_name: "Complete Business Plan", credit_controlled: true });
    render(<CreditConfirmModal featureName="Business Plan" featureCode="business_plan_full" creditCost={99} onConfirm={() => {}} onCancel={() => {}} />);
    await settle();
    expect(calls[0].body).toEqual({ feature_code: "business_plan_full" });
    expect(document.querySelector("[data-credit-cost]").textContent).toBe("40 credits");
    expect(document.querySelector("[data-credit-after]").textContent).toBe("196 credits");
  });

  it("not on the plan: says which plan includes it, shows no cost, and nothing is charged", async () => {
    serverSays({ entitled: false, cost_shown: 25, refusal: { error: "FEATURE_NOT_ENTITLED", minimum_plan_label: "Starter",
      message: "Complete Business Proposal is included from the Starter plan. You're on Explorer." } });
    const onConfirm = vi.fn();
    render(<CreditConfirmModal featureName="Business Proposal" featureCode="proposal_full" onConfirm={onConfirm} onCancel={() => {}} />);
    await settle();
    expect(document.querySelector("[data-plan-refusal]").textContent).toBe("Complete Business Proposal is included from the Starter plan. You're on Explorer. Nothing was charged.");
    expect(document.querySelector("[data-credit-cost]")).toBeNull();
    expect(screen.getByRole("button", { name: "See Starter plan" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/FEATURE|NOT FOUND/);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("free (a deterministic scenario run): it runs at once, with no confirmation and no '10 credits'", async () => {
    serverSays({ entitled: true, cost_shown: 0, credit_controlled: false, feature_name: "Scenario Simulation" });
    const onConfirm = vi.fn();
    render(<CreditConfirmModal featureName="Scenario Simulation" featureCode="scenario_simulation" onConfirm={onConfirm} onCancel={() => {}} />);
    await settle();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toMatch(/credit/i);
  });
});

describe("refusals in words", () => {
  const err = (status, detail) => Object.assign(new Error(`HTTP ${status}: ${JSON.stringify({ detail })}`), { status, data: { detail } });
  it("never shows a code", () => {
    expect(refusalMessage(err(402, { error: "FEATURE_NOT_FOUND", feature_code: "business_plan_full" }), "Fallback.")).toBe("Fallback.");
    expect(refusalMessage(err(403, { error: "FEATURE_NOT_ENTITLED", message: "Live Business Plan Intelligence is included from the Decision Engine plan. You're on Starter." })))
      .toBe("Live Business Plan Intelligence is included from the Decision Engine plan. You're on Starter.");
    expect(refusalMessage(err(402, { error: "INSUFFICIENT_CREDITS", required: 40, available: 12 }))).toBe("This needs 40 AI Credits and you have 12. Nothing was charged.");
    expect(refusalMessage(new Error("HTTP 402: FEATURE_DISABLED"), "Fallback.")).toBe("Fallback.");
  });
});

describe("PF4 what the simulation can't work out", () => {
  it("ratios with no number are said in words, at-risk months are read from the projection, and the client scenario is known", () => {
    expect(ratioText(null, "unavailable")).toBe("Not available");
    expect(ratioText(null, "unbounded")).toBe("No cash to cover it");
    expect(ratioText(1.234, "ok")).toBe("1.23");
    expect(atRisk([{ month_index: 1, state_label: "stable" }, { month_index: 2, state_label: "at_risk" }, { month_index: 3, state_label: "critical" }])).toEqual([2, 3]);
    expect(CLIENT_SCENARIOS).toEqual(["tmpl_client_loss"]);
  });
});
