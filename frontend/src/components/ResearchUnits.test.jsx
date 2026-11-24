import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ResearchReview, { withUnit } from "./ResearchReview";

describe("figures in the research review carry their units", () => {
  it("says what each number is: money with its currency, a count with what it counts", () => {
    expect(withUnit("monthly_sales", 37000, "GBP")).toBe("37,000 sales a month");
    expect(withUnit("price", "50000", "GBP")).toBe("£50,000 a sale");
    expect(withUnit("fixed_costs", 5000, "GBP")).toBe("£5,000 a month");
    expect(withUnit("cash_in_bank", 2000, "NGN")).toMatch(/2,000$/);
    expect(withUnit("team_size", 3)).toBe("3 people");
    expect(withUnit(undefined, "Some finding")).toBe("Some finding");
  });

  it("shows the unit beside the box while a figure is edited", () => {
    const run = { id: "rr_1", status: "review", context: { currency: "GBP" },
      items: [{ id: "a", kind: "reused", field: "monthly_sales", label: "Sales a month", value: 37000, source_note: "From your funding review" }] };
    render(<ResearchReview businessId="W" run={run} />);
    expect(screen.getByText("37,000 sales a month")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(document.querySelector("[data-unit-after]").textContent).toBe("sales a month");
  });
});
