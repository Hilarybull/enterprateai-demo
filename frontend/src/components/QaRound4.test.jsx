// QA round 4 in the browser: numeric answers are typed into text boxes with a number keypad, so words reach the
// server (U2); plans are shown by their names, never their keys (U4).
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuestionForm } from "./agent/AgentBits";
import { accessLabel, planLabel } from "../lib/plans";
import REGISTRY from "../content/entitlements.json";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("U2 a number question is a text box with a number keypad", () => {
  it("in the Agent card's form, 'standard rate' and '10%' are sent as typed, for the server to read", () => {
    const onSubmit = vi.fn();
    render(<QuestionForm fields={[{ key: "vat_rate", label: "VAT rate (%)", type: "number", required: true, default: "" },
      { key: "discount", label: "Discount", type: "discount" }]} onSubmit={onSubmit} />);
    const vat = screen.getByLabelText("VAT rate (%)");
    expect([vat.getAttribute("type"), vat.getAttribute("inputmode")]).toEqual(["text", "decimal"]);
    const discount = screen.getByLabelText("Discount");
    expect([discount.getAttribute("type"), discount.getAttribute("inputmode")]).toEqual(["text", "decimal"]);
    fireEvent.change(vat, { target: { value: "standard rate" } });
    fireEvent.change(discount, { target: { value: "10%" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSubmit).toHaveBeenCalledWith({ vat_rate: "standard rate", discount: { type: "percent", value: "10%" } });
  });

  it("no answer box in the Agent's forms is type=number", async () => {
    const sources = import.meta.glob(["./agent/TaskFlow.jsx", "./agent/AgentBits.jsx", "./GoalLauncher.jsx", "./QuickCheck.jsx"], { query: "?raw", import: "default", eager: true });
    for (const [file, text] of Object.entries(sources)) {
      // The question boxes only: the line-item quantity and price in the item picker stay number boxes.
      const questionBoxes = text.split("\n").filter((l) => /aria-label=\{(current|f|q)\.label\}/.test(l) || /goal-field-|qc-\$\{q\.key\}/.test(l));
      for (const line of questionBoxes) expect(line, file).not.toMatch(/type=("number"|\{[^}]*\? "number")/);
    }
  });
});

describe("U4 plans by name", () => {
  it("every plan in the registry has a name, and a full-access grant reads as one", () => {
    for (const { key } of REGISTRY.plans) {
      const name = planLabel(key, "active");
      expect(name).not.toBe(key);
      expect(name).not.toMatch(/_/);
    }
    expect(planLabel("strategic_business_os", "active")).toBe("Strategic Business OS");
    expect(accessLabel({ plan_key: "strategic_business_os", status: "active", access_source: "admin full-access grant" })).toBe("Full access (test grant)");
    expect(accessLabel({ plan_key: "decision_engine", status: "active", access_source: "subscription" })).toBe("Decision Engine");
    expect(accessLabel({ plan_key: "starter_insight", status: "active" })).toBe("Starter");
    expect(accessLabel({ plan_key: "explorer", status: "active" })).toBe("Explorer");
    expect(accessLabel({ plan_key: "free_trial", status: "grandfathered" })).toBe("Early Access");
    expect(planLabel("some_new_plan", "active")).toBe("Some new plan");      // never the key, even for one not listed yet
  });
});
