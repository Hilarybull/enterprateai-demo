import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { BillingToggle } from "./PricingPage";
import { BILLING, PLANS } from "../lib/plans";

afterEach(cleanup);

it("switches between monthly and annual, with the plans' biggest annual saving", () => {
  const onChange = vi.fn();
  render(<BillingToggle billing={BILLING.monthly} onChange={onChange} />);
  const [monthly, annual] = document.querySelectorAll("[data-billing-toggle] button");
  expect(monthly.getAttribute("aria-pressed")).toBe("true");
  expect(annual.textContent).toBe(`AnnualSave up to £${Math.max(...PLANS.map((p) => p.annualSaving || 0))}`);
  fireEvent.click(annual);
  expect(onChange).toHaveBeenCalledWith(BILLING.annual);
});
