// What the owner already said in their message is shown back under "From what you said" for a
// yes, and only what is missing is asked. The same form serves every document the Agent prepares.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QuestionForm } from "./AgentBits";

afterEach(() => { cleanup(); });

// "I want an Invoice for Mark, $300", as the server hands it over.
const invoiceForMark = () => [
  { key: "customer_id", label: "Customer", type: "customer", required: true, new_label: "+ New customer", default: "new", said: true, said_text: "Mark (new)",
    options: [{ value: "c6", label: "QA Round Six Ltd", email: "qa@six.test" }] },
  { key: "customer_name", label: "Customer name", type: "text", required: true, default: "Mark", said: true, said_text: null, show_if: { customer_id: "new" } },
  { key: "customer_email", label: "Customer email", type: "email", required: true, show_if: { customer_id: "new" } },
  { key: "items", label: "Items", type: "line_items", required: true, vat_rate: 0, suggested: [{ product_id: null, name: "", quantity: 1, unit_price: 300 }], said_note: "$300.00", said_label: "Amount",
    catalogue: [{ id: "p4", name: "Bookkeeping", unit_price: 300 }] },
  { key: "discount", label: "Discount", type: "discount" },
  { key: "due_date", label: "Due date", type: "date", default: "2026-10-21" },
  { key: "notes", label: "Notes on the invoice", type: "textarea" },
  { key: "currency", label: "Currency", type: "choice", required: true, default: "USD", toggle: true, said_note: "USD", hint: "In USD (your default is GBP).",
    options: [{ value: "USD", label: "USD (as you wrote it)" }, { value: "GBP", label: "GBP (your default)" }] },
];

describe("a form filled from the owner's message", () => {
  it("shows what was said, asks only for what is missing, and keeps the currency that was written", () => {
    const onSubmit = vi.fn();
    const { container } = render(<QuestionForm question="What should this invoice include?" fields={invoiceForMark()} onSubmit={onSubmit} />);
    const said = container.querySelector("[data-said]");
    expect(within(said).getByText("From what you said")).toBeTruthy();
    // Everything taken from the message, not just the customer: Customer Mark (new) · $300 · USD.
    expect([...said.querySelectorAll("dl > div")].map((d) => d.textContent)).toEqual(["Customer:Mark (new)", "Amount:$300.00", "Currency:USD"]);
    // Asked: Mark's email and what the line is for. Not asked: who it is for, or the optional extras.
    expect(screen.getByLabelText("Customer email")).toBeTruthy();
    expect(screen.getByLabelText("Item description").value).toBe("");
    expect(screen.getByLabelText("Unit price").value).toBe("300");
    expect(screen.queryByLabelText("Customer name")).toBeNull();
    expect(screen.queryByLabelText("Due date")).toBeNull();
    expect(screen.queryByLabelText("Notes on the invoice")).toBeNull();
    expect(container.querySelector("[data-more-options]").textContent).toBe("Add discount, due date or notes on the invoice");
    // In dollars, said plainly, with the way to switch; the totals follow it.
    expect(screen.getByText("In USD (your default is GBP).")).toBeTruthy();
    expect(screen.getByLabelText("USD (as you wrote it)").checked).toBe(true);
    expect(container.querySelector("[data-total]").textContent).toBe("$300.00");
    fireEvent.click(screen.getByLabelText("GBP (your default)"));
    expect(container.querySelector("[data-total]").textContent).toBe("£300.00");      // the same figure: switched, never converted
    fireEvent.click(screen.getByLabelText("USD (as you wrote it)"));
    // Nothing goes through with a gap in it.
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Customer email"), { target: { value: "mark@example.test" } });
    fireEvent.change(screen.getByLabelText("Item description"), { target: { value: "Consulting" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSubmit).toHaveBeenCalledWith({ customer_id: "new", customer_name: "Mark", customer_email: "mark@example.test",
      items: [{ product_id: null, name: "Consulting", quantity: 1, unit_price: 300 }], due_date: "2026-10-21", currency: "USD" });
  });

  it("'Change' opens everything that was read, to correct it; the extras open on request", () => {
    const { container } = render(<QuestionForm fields={invoiceForMark()} onSubmit={() => {}} />);
    fireEvent.click(container.querySelector("[data-more-options]"));
    expect(screen.getByLabelText("Due date").value).toBe("2026-10-21");
    expect(screen.getByLabelText("Notes on the invoice")).toBeTruthy();
    fireEvent.click(within(container.querySelector("[data-said]")).getByRole("button", { name: "Change" }));
    expect(container.querySelector("[data-said]")).toBeNull();
    expect(screen.getByLabelText("Customer name").value).toBe("Mark");
    fireEvent.change(screen.getByLabelText("Customer name"), { target: { value: "Marc Ltd" } });
    expect(screen.getByLabelText("Customer name").value).toBe("Marc Ltd");
  });

  it("when everything was said, it is one yes: 'That's right, continue'", () => {
    // "contract with QA Test Ltd for monthly bookkeeping, £300/month, 12 months from 1 Nov"
    const onSubmit = vi.fn();
    const fields = [
      { key: "description", label: "What is agreed (scope)", type: "textarea", required: true, default: "Monthly bookkeeping", said: true, said_text: "monthly bookkeeping" },
      { key: "total", label: "Price", type: "number", required: true, default: 300, said: true, said_text: "£300.00" },
      { key: "term", label: "Term", type: "text", default: "12 months", said: true, said_text: "12 months" },
      { key: "start_date", label: "Start date", type: "date", default: "2026-11-01", said: true, said_text: "1 Nov 2026" }];
    const { container } = render(<QuestionForm fields={fields} onSubmit={onSubmit} />);
    expect([...container.querySelectorAll("[data-said] dd")].map((d) => d.textContent)).toEqual(["monthly bookkeeping", "£300.00", "12 months", "1 Nov 2026"]);
    expect(screen.queryAllByRole("textbox")).toEqual([]);
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "That's right, continue" }));
    expect(onSubmit).toHaveBeenCalledWith({ description: "Monthly bookkeeping", total: 300, term: "12 months", start_date: "2026-11-01" });
  });

  it("VAT, asked because there is no default, comes with 'Save as my default'", () => {
    const onSubmit = vi.fn();
    render(<QuestionForm fields={[{ key: "vat_rate", label: "VAT rate (%)", type: "number", required: true, default: 0 },
      { key: "save_vat_default", label: "Save as my default VAT rate", type: "checkbox", default: false, hint: "You won't be asked again. Change it any time in Agent settings." }]} onSubmit={onSubmit} />);
    const tick = screen.getByRole("checkbox", { name: "Save as my default VAT rate" });
    expect(tick.checked).toBe(false);                                       // never ticked for them
    expect(screen.getByText("You won't be asked again. Change it any time in Agent settings.")).toBeTruthy();
    expect(screen.queryByText("(optional)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSubmit).toHaveBeenLastCalledWith({ vat_rate: 0 });             // not ticked: not sent
    fireEvent.change(screen.getByLabelText("VAT rate (%)"), { target: { value: "20" } });
    fireEvent.click(tick);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSubmit).toHaveBeenLastCalledWith({ vat_rate: "20", save_vat_default: true });
  });

  it("a form with nothing read from a message is exactly as it was", () => {
    const fields = invoiceForMark().filter((f) => f.key !== "currency").map(({ said, said_text, said_note, said_label, ...f }) => ({ ...f, default: f.key === "customer_id" ? "" : f.key === "customer_name" ? "" : f.default }));
    const { container } = render(<QuestionForm fields={fields} onSubmit={() => {}} />);
    expect(container.querySelector("[data-said]")).toBeNull();
    expect(container.querySelector("[data-more-options]")).toBeNull();
    expect(screen.getByLabelText("Due date")).toBeTruthy();                 // the optional fields are all there, as before
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(container.querySelector("[data-total]").textContent).toBe("£300.00");
  });
});
