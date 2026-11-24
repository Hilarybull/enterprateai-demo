// QA, 17 Oct ("all the results" editable, updatable and adoptable): every result has Edit, calculated ones too; a
// calculation is worked out again live as its inputs change.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ResearchReview from "./ResearchReview";

afterEach(cleanup);
const run = { id: "rr_1", status: "review", counts: { researched: 0, estimated: 0, reused: 1, calculated: 1, asked: 0, sources: 1 },
  items: [{ id: "y1", kind: "reused", field: "traction", source_note: "your answer", label: "Demand evidence", value: "No traction yet" },
    { id: "u1", kind: "reused", field: "monthly_sales", label: "Sales a month", value: "40", used_for: "12-month forecast" },
    { id: "f1", kind: "researched", topic: "loans", label: "Loans for new and small businesses (Nigeria)", value: "The BOI RAPID programme...", sources: [], used_for: "Materials and risks" },
    { id: "e1", kind: "estimated", basis: "benchmark", field: "fixed_costs", label: "Monthly fixed costs", value: "₦35,000", number: 35000, sources: [], used_for: "Break-even" },
    { id: "c1", kind: "estimated", basis: "calculated", derive: "forecast_12m", label: "12-month forecast", value: "Cash after 12 months: ₦8,220,000", used_for: "12-month forecast" }] };

describe("every result in the research review", () => {
  it("can be accepted, edited or rejected; a calculated one follows its figures, with no Edit (QA, 17 Oct)", () => {
    render(<ResearchReview businessId="ws1" run={run} onAdopted={() => {}} />);
    const open = screen.queryByRole("button", { name: "Check or review inputs" });
    if (open && !screen.queryByRole("group", { name: "Your decision: 12-month forecast" })) fireEvent.click(open);
    expect(within(screen.getByRole("group", { name: "Your decision: 12-month forecast" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Accept", "Reject"]);
    for (const name of ["Sales a month", "Loans for new and small businesses (Nigeria)", "Monthly fixed costs"]) {
      expect(within(screen.getByRole("group", { name: `Your decision: ${name}` })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Accept", "Edit", "Reject"]);
    }
    expect(document.querySelector("[data-research-item='forecast_12m'] [data-calculated-note]").textContent)
      .toBe("Worked out from the figures above, and updated as you change them.");
  });
});

describe("the owner's own answers in the research review", () => {
  it("are used as given and not shown to review again; the form above is where they change", () => {
    render(<ResearchReview businessId="ws1" run={run} onAdopted={() => {}} />);
    const open = screen.queryByRole("button", { name: "Check or review inputs" });
    if (open && !screen.queryByRole("group", { name: "Your decision: Sales a month" })) fireEvent.click(open);
    expect(screen.queryByRole("group", { name: "Your decision: Demand evidence" })).toBeNull();
    expect(document.querySelector("[data-your-answers-note]").textContent).toBe("Your own answers (Demand evidence) are used as you gave them. To change one, edit it in Your answers above.");
  });
});
