import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatQuestionThread } from "./TaskFlow";

afterEach(cleanup);

describe("E3 From what you said", () => {
  it("lists every field read, each on its own line with its own Edit, including those not on the form", () => {
    const said = [{ key: "price", label: "Price", text: "£320.00/month × 6 = £1,920.00" }, { key: "customer_name", label: "Customer", text: "Delta Offices Ltd" },
      { key: "description", label: "Scope", text: "weekly office clean" }, { key: "term", label: "Term", text: "6 months" }];
    render(<ChatQuestionThread fields={[{ key: "customer_email", label: "Email address for Delta Offices Ltd", type: "email", required: true }]} said={said}
      onSubmit={() => {}} onCancel={() => {}} />);
    const lines = [...document.querySelectorAll("[data-said-lines] li")].map((li) => li.textContent.replace("Edit", "").trim());
    expect(lines).toEqual(["Price·£320.00/month × 6 = £1,920.00", "Customer·Delta Offices Ltd", "Scope·weekly office clean", "Term·6 months"]);
    expect(screen.getAllByRole("button", { name: "Edit" }).length).toBe(4);
  });
});
