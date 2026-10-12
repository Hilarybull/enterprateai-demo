// QA P0-5: "A few details" asks for items with the line picker (never a plain text box that
// loops), takes them typed as words too, and sends lines the server can use.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChatQuestionThread, useTaskFlow } from "./TaskFlow";
import { linesFromText } from "./AgentBits";

const CATALOGUE = [{ id: "p1", name: "Office deep clean", unit_price: 120 }, { id: "p2", name: "Window clean", unit_price: 40 }];
const ITEMS = { key: "items", label: "Items to quote", type: "line_items", required: true, catalogue: CATALOGUE, suggested: [] };

afterEach(cleanup);

describe("linesFromText", () => {
  it("reads quantity, item and price", () => {
    expect(linesFromText("3 x office deep clean at £150 each", CATALOGUE)).toEqual([{ product_id: "p1", name: "", quantity: 3, unit_price: 150, other: false }]);
    expect(linesFromText("2 window clean, carpet shampoo at 60", CATALOGUE)).toEqual([
      { product_id: "p2", name: "", quantity: 2, unit_price: 40, other: false },
      { product_id: null, name: "carpet shampoo", quantity: 1, unit_price: 60, other: true }]);
    expect(linesFromText("logo design", [])).toEqual([{ product_id: null, name: "logo design", quantity: 1, unit_price: "", other: true }]);
  });
});

describe("A few details: items", () => {
  it("shows the line picker, not a text box, and sends lines", () => {
    const onSubmit = vi.fn();
    render(<ChatQuestionThread fields={[ITEMS]} onSubmit={onSubmit} onCancel={() => {}} />);
    expect(document.querySelector("[data-line-picker]")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Or type the items"), { target: { value: "3 x office deep clean at £150 each" } });
    fireEvent.click(document.querySelector("[data-read-items]"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledWith({ items: [{ product_id: "p1", name: "", quantity: 3, unit_price: 150 }] }, expect.anything());
  });

  it("says what is wrong instead of sending an unusable answer", () => {
    const onSubmit = vi.fn();
    render(<ChatQuestionThread fields={[{ ...ITEMS, catalogue: [] }]} onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Or type the items"), { target: { value: "logo design" } });
    fireEvent.click(document.querySelector("[data-read-items]"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Other items need a description and a price.")).toBeTruthy();
  });

  it("chooses the catalogue's only priced offering already", () => {
    const onSubmit = vi.fn();
    render(<ChatQuestionThread fields={[{ ...ITEMS, catalogue: [CATALOGUE[0]] }]} onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledWith({ items: [{ product_id: "p1", name: "", quantity: 1, unit_price: 120 }] }, expect.anything());
  });

  it("asks for the customer with the picker", () => {
    const onSubmit = vi.fn();
    render(<ChatQuestionThread fields={[{ key: "customer_id", label: "Customer", type: "customer", required: true, options: [{ value: "c6", label: "QA Round Six Ltd" }] }]} onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.click(screen.getByLabelText("QA Round Six Ltd"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledWith({ customer_id: "c6" }, expect.anything());
  });

  it("counts the questions it asks, moving with each answer (QA P2-1)", () => {
    const fields = [{ key: "a", label: "First", type: "text", required: true }, { key: "b", label: "Second", type: "text", required: true }];
    render(<ChatQuestionThread fields={fields} step={{ index: 2, total: 5 }} onSubmit={() => {}} onCancel={() => {}} />);
    expect(document.querySelector("[data-step]").textContent).toBe("Question 1 of 2");      // never the workflow's own step
    fireEvent.change(screen.getByLabelText("First"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(document.querySelector("[data-step]").textContent).toBe("Question 2 of 2");
  });

  it("asks each question once, in its own words, with its hint once (QA P2-9)", () => {
    const fields = [{ key: "customer_email", label: "Customer email", type: "email", required: true },
      { key: "vat_rate", label: "VAT rate (%)", type: "number", required: true, hint: "Enter 0 if you don't charge VAT." }];
    render(<ChatQuestionThread question="Who is this quotation for?" fields={fields} onSubmit={() => {}} onCancel={() => {}} />);
    expect(document.querySelector("[data-asks]").textContent).toBe("What is the customer's email address?");
    expect(screen.queryByText("What should I use?")).toBeNull();
    expect(screen.getAllByText(/email address/i).length).toBe(1);      // asked once, not label plus question
    fireEvent.change(screen.getByLabelText("Customer email"), { target: { value: "a@b.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getAllByText("Enter 0 if you don't charge VAT.").length).toBe(1);
    expect(document.querySelector("[data-form-footer]").className).toContain("sticky");
  });

  it("keeps the % / Amount switch inside the dialog (QA P2-9)", () => {
    render(<ChatQuestionThread fields={[{ key: "discount", label: "Discount", type: "discount" }]} onSubmit={() => {}} onCancel={() => {}} />);
    expect(document.querySelector("[data-discount-kind]").className).toContain("shrink-0");
    expect(screen.getByLabelText("Discount").className).toContain("min-w-0");
  });

  it("asks shared fields in their own words, keeps acronyms, and lets optional ones be skipped (QA R6)", () => {
    const onSubmit = vi.fn();
    const fields = [{ key: "notes", label: "Notes to the customer", type: "textarea" },
      { key: "vat_rate", label: "VAT rate (%)", type: "number", required: true },
      { key: "po", label: "PO number", type: "text", required: true }];
    render(<ChatQuestionThread fields={fields} onSubmit={onSubmit} onCancel={() => {}} />);
    expect(document.querySelector("[data-asks]").textContent).toBe("Anything you'd like to say to the customer on it?(optional)");
    expect(screen.queryByText(/What is the notes/)).toBeNull();
    fireEvent.click(document.querySelector("[data-skip]"));                  // optional: passed over
    expect(document.querySelector("[data-asks]").textContent).toBe("What VAT rate do you charge?");
    expect(document.querySelector("[data-skip]")).toBeNull();                // required: no Skip
    fireEvent.change(screen.getByLabelText("VAT rate (%)"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(document.querySelector("[data-asks]").textContent).toBe("What is the PO number?");      // the acronym keeps its capitals
    fireEvent.change(screen.getByLabelText("PO number"), { target: { value: "PO-7" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledWith({ vat_rate: "20", po: "PO-7" }, expect.anything());
  });

  it("shows a date answer as dd/mm/yyyy, never ISO (QA R7)", () => {
    const fields = [{ key: "valid_until", label: "Valid until", type: "date", default: "2026-11-10" }, { key: "b", label: "Second", type: "text", required: true }];
    render(<ChatQuestionThread fields={fields} onSubmit={() => {}} onCancel={() => {}} />);
    expect(screen.getByLabelText("Valid until").value).toBe("10/11/2026");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const bubble = document.querySelector("[data-answer='valid_until']");
    expect(bubble.textContent).toContain("10/11/2026");
    expect(bubble.textContent).not.toContain("2026-11-10");
  });
});

describe("QA R8: the credits balance after a run", () => {
  it("is read again whenever a followed task moves on, so a background charge shows at once", async () => {
    const heard = vi.fn();
    window.addEventListener("ea:credits:refresh", heard);
    let flow;
    function Host() { flow = useTaskFlow({ say: () => {}, onChanged: () => {}, onDetails: () => {} }); return flow.element; }
    render(<Host />);
    await act(async () => { await flow.follow({ id: "r1", status: "succeeded", summary: "Quotation drafted." }); });
    expect(heard).toHaveBeenCalled();
    window.removeEventListener("ea:credits:refresh", heard);
  });
});

