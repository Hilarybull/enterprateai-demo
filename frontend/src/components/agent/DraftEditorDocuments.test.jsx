// Every document waiting for approval has an editor: quotations and invoices (items, discount,
// totals), contracts (what is agreed, value, terms), and the wording of reminders and receipts.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DraftEditor, { editableApproval } from "./DraftEditor";
import { ApprovalReview } from "./AgentBits";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const text = (root, selector) => root.querySelector(selector).textContent;
const CATALOGUE = [{ id: "p1", name: "Monthly bookkeeping", unit_price: 375 }, { id: "p2", name: "Year-end accounts", unit_price: 600 }];
const quote = (over = {}) => ({ id: "a1", status: "pending", tool_id: "send_quotation", title: "Send quotation QUO-12 to Frank", payload_version: 1, payload: {
  reference: "QUO-12", company: "Apex", customer_name: "Frank", to_email: "frank@frank.test", currency: "GBP", vat_rate: 20, vat_amount: 150, subtotal: 750, total: 900,
  items: [{ description: "Monthly bookkeeping", qty: 2, unit_price: 375 }, { description: "Year-end accounts", qty: 1, unit_price: 600 }], valid_until: "2026-11-05", payment_terms: "Net 14 days", ...over } });

describe("discount, free lines, reordering and the phone layout", () => {
  it("takes a discount off before VAT, as a percentage or an amount, and saves it", () => {
    const onSave = vi.fn();
    const { container } = render(<DraftEditor approval={quote({ items: [{ description: "Monthly bookkeeping", qty: 2, unit_price: 375 }] })} options={{ catalogue: CATALOGUE, customers: [] }} onCancel={() => {}} onSave={onSave} />);
    expect(text(container, "[data-discount]")).toBe("£0.00");
    fireEvent.change(screen.getByLabelText("Discount"), { target: { value: "10" } });
    expect([text(container, "[data-subtotal]"), text(container, "[data-discount]"), text(container, "[data-vat]"), text(container, "[data-total]")])
      .toEqual(["£750.00", "-£75.00", "£135.00", "£810.00"]);
    expect(text(container, "[data-total-change]")).toBe("was £900.00 → now £810.00");
    fireEvent.change(screen.getByLabelText("Discount type"), { target: { value: "amount" } });
    fireEvent.change(screen.getByLabelText("Discount"), { target: { value: "50" } });
    expect([text(container, "[data-discount]"), text(container, "[data-total]")]).toEqual(["-£50.00", "£840.00"]);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith({ discount: { type: "amount", value: 50 } });
    fireEvent.change(screen.getByLabelText("Discount type"), { target: { value: "percent" } });
    fireEvent.change(screen.getByLabelText("Discount"), { target: { value: "140" } });
    expect(screen.getByText(/A discount is between 0 and 100%/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" }).disabled).toBe(true);
  });

  it("allows a free line (price 0), but not a document that comes to nothing", () => {
    render(<DraftEditor approval={quote()} options={{ catalogue: CATALOGUE, customers: [] }} onCancel={() => {}} onSave={() => {}} />);
    const prices = () => screen.getAllByLabelText("Unit price");
    fireEvent.change(prices()[1], { target: { value: "0" } });
    expect(screen.queryByText("Enter a price of 0 or more.")).toBeNull();
    expect(screen.getByRole("button", { name: "Save changes" }).disabled).toBe(false);      // one free line is fine
    fireEvent.change(prices()[0], { target: { value: "0" } });
    expect(screen.getByText("A line can be free, but the quotation must come to more than 0.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" }).disabled).toBe(true);
    fireEvent.change(prices()[0], { target: { value: "-5" } });
    expect(screen.getByText("Enter a price of 0 or more.")).toBeTruthy();
  });

  it("reorders the items by dragging one onto another", () => {
    const onSave = vi.fn();
    const { container } = render(<DraftEditor approval={quote()} options={{ catalogue: CATALOGUE, customers: [] }} onCancel={() => {}} onSave={onSave} />);
    const lines = () => [...container.querySelectorAll("[data-line]")];
    expect(lines().every((l) => l.getAttribute("draggable") === "true")).toBe(true);
    fireEvent.dragStart(lines()[1]);
    fireEvent.dragOver(lines()[0]);
    fireEvent.drop(lines()[0]);
    expect(screen.getAllByLabelText("Item").map((i) => i.value)).toEqual(["Year-end accounts", "Monthly bookkeeping"]);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave.mock.calls[0][0].items.map((i) => i.name)).toEqual(["Year-end accounts", "Monthly bookkeeping"]);      // the order is what is saved
  });

  it("is one set of fields laid out as stacked cards on a phone and as a table from 640px, with Save pinned", () => {
    const { container } = render(<DraftEditor approval={quote()} options={{ catalogue: CATALOGUE, customers: [] }} onCancel={() => {}} onSave={() => {}} />);
    expect(screen.getAllByLabelText("Quantity").length).toBe(2);                    // one field per line, not one per layout
    const header = screen.getAllByRole("row")[0];
    expect(header.className).toContain("hidden");                                   // no column headings on a phone
    expect(header.className).toContain("sm:grid");
    const line = container.querySelector("[data-line]");
    expect(line.className).toContain("grid-cols-[minmax(0,1fr)_auto]");             // stacked: the item, then its figures
    expect(line.className).toContain("sm:grid-cols-[1.5rem_minmax(0,1fr)_5rem_8rem_7rem_2rem]");      // the table's columns
    expect(text(line, "[data-amount]")).toContain("2 × £375.00 =");                 // "Qty × Price = Amount" on the card
    const footer = container.querySelector("[data-editor-footer]");
    expect(footer.className).toContain("sticky bottom-0");
    expect(footer.textContent).toContain("Total £1,620.00");                        // the total stays with the Save bar
  });
});

describe("invoices, contracts, reminders and receipts", () => {
  it("edits an invoice's items, due date and discount, without the quotation-only fields", () => {
    const onSave = vi.fn();
    const invoice = { id: "a2", status: "pending", tool_id: "send_invoice", title: "Send invoice INV-7 to Frank", payload_version: 1, payload: {
      reference: "INV-7", company: "Apex", customer_name: "Frank", to_email: "frank@frank.test", currency: "GBP", vat_rate: 20, subtotal: 750, vat_amount: 150, total: 900,
      items: [{ description: "Monthly bookkeeping", qty: 2, unit_price: 375 }], due_date: "2026-11-05", payment_terms: "Net 14 days" } };
    const { container } = render(<DraftEditor approval={invoice} options={{ document: "invoice", catalogue: CATALOGUE, customers: [{ id: "c2", name: "Frank" }] }} onCancel={() => {}} onSave={onSave} />);
    expect(screen.getByLabelText("Due date").value).toBe("2026-11-05");
    for (const label of ["Valid until", "Notes to the customer", "Recipient"]) expect(screen.queryByLabelText(label)).toBeNull();
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-11-20" } });
    expect(text(container, "[data-total]")).toBe("£1,350.00");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith({ due_date: "2026-11-20", items: [{ product_id: "p1", name: "Monthly bookkeeping", quantity: 3, unit_price: 375 }] });
  });

  it("edits what a contract says, its value and its terms", () => {
    const onSave = vi.fn();
    const contract = { id: "a3", status: "pending", tool_id: "send_contract", title: "Send contract CON-1 to Frank", payload_version: 1, payload: {
      reference: "CON-1", customer_name: "Frank", to_email: "frank@frank.test", currency: "GBP", description: "Two workshops", total: 3600, payment_terms: "Net 14 days" } };
    const { container } = render(<DraftEditor approval={contract} options={{ document: "contract" }} onCancel={() => {}} onSave={onSave} />);
    expect(screen.queryByLabelText("Item")).toBeNull();
    fireEvent.change(screen.getByLabelText("What is agreed"), { target: { value: "Two workshops, on site in November." } });
    fireEvent.change(screen.getByLabelText("Contract value"), { target: { value: "3900" } });
    expect(text(container, "[data-total-change]")).toBe("was £3,600.00 → now £3,900.00");
    fireEvent.change(screen.getByLabelText("Payment terms (days)"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith({ description: "Two workshops, on site in November.", total: 3900, payment_terms_days: 7 });
    fireEvent.change(screen.getByLabelText("Contract value"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Save changes" }).disabled).toBe(true);
  });

  it("edits a reminder's wording and the amount asked for, never above what is owed", () => {
    const onSave = vi.fn();
    const reminder = { id: "a4", status: "pending", tool_id: "send_payment_reminder", title: "Send payment reminder for invoice INV-7 to Aftred", payload_version: 1, payload: {
      reference: "INV-7", customer_name: "Aftred", to_email: "pay@aftred.test", currency: "GBP", total: 149, outstanding: 149, due_date: "2026-09-23", days_overdue: 8, stage: 1 } };
    render(<DraftEditor approval={reminder} options={{ document: "reminder", wording: {} }} onCancel={() => {}} onSave={onSave} />);
    expect(screen.getByLabelText("Amount to ask for now").value).toBe("149");
    expect(screen.getByRole("button", { name: "Save changes" }).disabled).toBe(true);      // nothing changed yet
    fireEvent.change(screen.getByLabelText("Your message"), { target: { value: "Could you pay half this week?" } });
    fireEvent.change(screen.getByLabelText("Amount to ask for now"), { target: { value: "500" } });
    expect(screen.getByText("Enter an amount above 0, up to £149.00.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Amount to ask for now"), { target: { value: "74.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith({ message: "Could you pay half this week?", amount_requested: 74.5 });
  });

  it("edits a receipt's note and address; what was received is shown, not editable", () => {
    const onSave = vi.fn();
    const receipt = { id: "a5", status: "pending", tool_id: "send_receipt", title: "Send receipt REC-1 to Frank", payload_version: 1, payload: {
      receipt_number: "REC-1", invoice_reference: "INV-7", customer_name: "Frank", to_email: "frank@frank.test", currency: "GBP", amount: 300, paid_at: "2026-10-01" } };
    render(<DraftEditor approval={receipt} options={{ document: "receipt", wording: {} }} onCancel={() => {}} onSave={onSave} />);
    expect(screen.getByText(/£300\.00/)).toBeTruthy();
    expect(screen.queryByLabelText("Amount to ask for now")).toBeNull();
    expect(screen.queryByLabelText("Unit price")).toBeNull();
    fireEvent.change(screen.getByLabelText("Your message"), { target: { value: "Thank you for paying so promptly." } });
    fireEvent.change(screen.getByLabelText("Sent to"), { target: { value: "accounts@frank.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith({ customer_email: "accounts@frank.test", message: "Thank you for paying so promptly." });
  });

  it("offers Edit for every document the Agent prepares, and the document shows the discount and the owner's wording", () => {
    for (const tool of ["send_quotation", "send_invoice", "send_contract", "send_payment_reminder", "send_receipt"]) expect(editableApproval({ tool_id: tool })).toBe(true);
    expect(editableApproval({ tool_id: "something_else" })).toBe(false);
    render(<ApprovalReview approval={quote({ discount_amount: 75, discount_label: "Discount (10%)", total: 810 })} />);
    expect(screen.getByText("Discount (10%)").parentElement.textContent).toContain("-£75.00");
    cleanup();
    render(<ApprovalReview approval={{ id: "a4", tool_id: "send_payment_reminder", title: "Reminder", payload_version: 2, payload: {
      customer_name: "Aftred", to_email: "pay@aftred.test", currency: "GBP", outstanding: 149, amount_requested: 74.5, message: "Could you pay half this week?" } }} />);
    expect(screen.getByText("Amount asked for now").parentElement.textContent).toContain("£74.50");
    expect(screen.getByText("Could you pay half this week?")).toBeTruthy();
  });
});
