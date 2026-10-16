// QA, 15 Oct ("why make it editable if it isn't"): a calculated figure is worked out again from the inputs, so it has no
// Edit of its own; an input it uses (a figure on record) keeps Edit.
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

describe("calculated figures in the research review", () => {
  it("have Accept and Reject only, with where to change them; inputs keep Edit", () => {
    render(<ResearchReview businessId="ws1" run={run} onAdopted={() => {}} />);
    const open = screen.queryByRole("button", { name: "Check or review inputs" });
    if (open && !screen.queryByRole("group", { name: "Your decision: 12-month forecast" })) fireEvent.click(open);
    const calc = within(screen.getByRole("group", { name: "Your decision: 12-month forecast" })).getAllByRole("button").map((b) => b.textContent);
    expect(calc).toEqual(["Accept", "Reject"]);
    expect(document.querySelector("[data-research-item='forecast_12m'] [data-calculated-note]").textContent).toBe("Worked out from the figures above. To change it, edit those and check again.");
    const input = within(screen.getByRole("group", { name: "Your decision: Sales a month" })).getAllByRole("button").map((b) => b.textContent);
    expect(input).toEqual(["Accept", "Edit", "Reject"]);
    const found = within(screen.getByRole("group", { name: "Your decision: Loans for new and small businesses (Nigeria)" })).getAllByRole("button").map((b) => b.textContent);
    expect(found).toEqual(["Accept", "Reject"]);      // a researched finding is its source's words: never rewritten
    expect(within(screen.getByRole("group", { name: "Your decision: Monthly fixed costs" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Accept", "Edit", "Reject"]);
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
