import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalReview, CustomerPicker, partyNoun } from "./AgentBits";
import { questionsLeft } from "./TaskFlow";

afterEach(cleanup);

describe("E4 wording and counting", () => {
  it("calls the other party a supplier on a purchase order or a supplier bill", () => {
    expect(partyNoun({ key: "vendor_id", label: "Supplier" })).toBe("supplier");
    expect(partyNoun({ key: "supplier_name", label: "Who is the bill from?" })).toBe("supplier");
    expect(partyNoun({ key: "customer_id", label: "Customer" })).toBe("customer");
    render(<CustomerPicker field={{ key: "vendor_id", label: "Supplier", options: [] }} value="" onChange={() => {}} />);
    expect(document.body.textContent).toMatch(/supplier/i);
    expect(document.body.textContent).not.toMatch(/customer/i);
  });

  it("counts only the questions it will ask: not what was said, a companion, or a question the answers rule out", () => {
    const fields = [
      { key: "customer_name", said: true, default: "Delta Offices Ltd" },
      { key: "vat_rate", default: 20 },
      { key: "vat_default", companion_of: "vat_rate" },
      { key: "deposit", default: "no" },
      { key: "deposit_amount", show_if: { deposit: "yes" } },
      { key: "due_date" },
    ];
    expect(questionsLeft(fields, { vat_rate: 20, deposit: "no" }, new Set())).toBe(3);
    expect(questionsLeft(fields, { vat_rate: 20, deposit: "yes" }, new Set())).toBe(4);
  });

  it("shows a recurring price as it was agreed on the approval card", () => {
    render(<ApprovalReview approval={{ title: "Send contract", payload_version: 1, tool_id: "send_contract",
      payload: { currency: "GBP", customer_name: "Delta Offices Ltd", total: 1920, price_text: "£320.00/month × 6 = £1,920.00" } }} />);
    expect(screen.getByText("£320.00/month × 6 = £1,920.00")).toBeTruthy();
  });
});
