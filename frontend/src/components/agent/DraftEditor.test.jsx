// Editing a quotation that is waiting for approval: in place on the task page, in a drawer from
// the dashboard's Needs Approval list. Totals follow the fields, a catalogue item brings its
// price, saving asks for approval again on a new version, and Cancel discards.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import DraftEditor from "./DraftEditor";
import { NeedsApprovalPanel } from "./AgentPanel";
import AgentRunPage from "../../pages/AgentRunPage";

const payload = (over = {}) => ({ quote_id: "q1", reference: "QUO-12", company: "Apex", customer_name: "Frank", to_email: "frank@frank.test", currency: "GBP",
  items: [{ description: "Monthly bookkeeping", qty: 2, unit_price: 375, price_source: "catalogue" }], subtotal: 750, vat_rate: 20, vat_amount: 150, total: 900,
  valid_until: "2026-11-05", payment_terms: "Net 14 days", notes: "", ...over });
const approval = (over = {}, version = 1) => ({ id: `a${version}`, status: "pending", tool_id: "send_quotation", title: "Send quotation QUO-12 to Frank", payload_version: version, payload: payload(over) });
const OPTIONS = { catalogue: [{ id: "p1", name: "Monthly bookkeeping", unit_price: 375 }, { id: "p2", name: "Year-end accounts", unit_price: 600 }],
  customers: [{ id: "c1", name: "QA Round Six Ltd", email: "qa@six.test" }, { id: "c2", name: "Frank", email: "frank@frank.test" }], edited_by_you: false };
const run = (over = {}) => ({ id: "run-1", family: "Sell & Revenue", title: "Enquiry to Quote", goal: "Quote Frank", status: "awaiting_approval", workflow_key: "enquiry_to_quote",
  summary: "Prepared draft quotation QUO-12.", steps_planned: [], current_step: "send", refs: { quote_reference: "QUO-12" }, credits_used: 1, credits: [], ...over });
const page = (a, r = run(), options = OPTIONS) => ({ run: r, draft_options: options, steps: [], step_attempts: [], approvals: [a], history: [],
  can: { approve: true, answer: true, retry: true, cancel: true, edit_draft: true } });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const text = (root, selector) => root.querySelector(selector).textContent;

describe("the draft editor", () => {
  it("has the document's layout with fields in place, and updates amounts and totals as you type", () => {
    const { container } = render(<DraftEditor approval={approval()} options={OPTIONS} onCancel={() => {}} onSave={() => {}} />);
    const form = screen.getByRole("form", { name: "Edit draft" });
    for (const label of ["Recipient", "Sent to", "Item", "Quantity", "Unit price", "VAT rate", "Valid until", "Payment terms", "Notes to the customer"]) {
      expect(within(form).getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent).filter(Boolean)).toEqual(["Item", "Qty", "Unit price", "Amount"]);
    expect(text(container, "[data-price-source]")).toBe("Catalogue price");
    expect([text(container, "[data-subtotal]"), text(container, "[data-vat]"), text(container, "[data-total]")]).toEqual(["£750.00", "£150.00", "£900.00"]);
    expect(container.querySelector("[data-total-change]")).toBeNull();
    expect(screen.getByRole("button", { name: "Save changes" }).disabled).toBe(true);      // nothing changed yet
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "3" } });
    expect(text(container, "[data-amount]")).toContain("£1,125.00");
    expect(text(container, "[data-total]")).toBe("£1,350.00");
    expect(text(container, "[data-total-change]")).toBe("was £900.00 → now £1,350.00");
    fireEvent.change(screen.getByLabelText("Unit price"), { target: { value: "400" } });
    expect(text(container, "[data-price-source]")).toBe("Edited");           // no longer the catalogue price
    expect([text(container, "[data-subtotal]"), text(container, "[data-vat]"), text(container, "[data-total]")]).toEqual(["£1,200.00", "£240.00", "£1,440.00"]);
    fireEvent.change(screen.getByLabelText("VAT rate"), { target: { value: "0" } });
    expect(text(container, "[data-total]")).toBe("£1,200.00");
    expect(screen.getByRole("button", { name: "Save changes" }).disabled).toBe(false);
    expect(container.querySelector("[data-editor-footer]").className).toContain("sticky bottom-0");      // Save stays in reach on a phone
  });

  it("fills the price when an item is swapped for one from the catalogue, and keeps a typed item as the owner's own", () => {
    const { container } = render(<DraftEditor approval={approval()} options={OPTIONS} onCancel={() => {}} onSave={() => {}} />);
    fireEvent.change(screen.getByLabelText("Item"), { target: { value: "Year-end accounts" } });
    expect(screen.getByLabelText("Unit price").value).toBe("600");
    expect(text(container, "[data-price-source]")).toBe("Catalogue price");
    expect(text(container, "[data-total]")).toBe("£1,440.00");               // 2 × 600 + 20%
    fireEvent.change(screen.getByLabelText("Item"), { target: { value: "Site visit" } });
    expect(text(container, "[data-price-source]")).toBe("Your price");
  });

  it("checks the fields inline and keeps Save off until they are right", () => {
    render(<DraftEditor approval={approval()} options={OPTIONS} onCancel={() => {}} onSave={() => {}} />);
    const save = () => screen.getByRole("button", { name: "Save changes" });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "0" } });
    expect(screen.getByText("Quantity must be 1 or more.")).toBeTruthy();
    expect(save().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Sent to"), { target: { value: "frank@" } });
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(save().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Sent to"), { target: { value: "accounts@frank.test" } });
    expect(save().disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Remove Monthly bookkeeping" }));
    expect(screen.getByText("Add at least one item.")).toBeTruthy();
    expect(save().disabled).toBe(true);
  });

  it("changing the customer changes who it is sent to, items can be added and reordered, and only what changed is saved", () => {
    const onSave = vi.fn();
    render(<DraftEditor approval={approval()} options={OPTIONS} onCancel={() => {}} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Recipient"), { target: { value: "c1" } });
    expect(screen.getByLabelText("Sent to").value).toBe("qa@six.test");
    fireEvent.click(screen.getByRole("button", { name: "+ Add item" }));
    fireEvent.change(screen.getAllByLabelText("Item")[1], { target: { value: "Year-end accounts" } });
    fireEvent.click(screen.getByRole("button", { name: "Move Year-end accounts up" }));
    expect(screen.getAllByLabelText("Item").map((i) => i.value)).toEqual(["Year-end accounts", "Monthly bookkeeping"]);
    fireEvent.change(screen.getByLabelText("Payment terms"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith({ customer_id: "c1", customer_email: "qa@six.test", payment_terms_days: 30,
      items: [{ product_id: "p2", name: "Year-end accounts", quantity: 1, unit_price: 600 }, { product_id: "p1", name: "Monthly bookkeeping", quantity: 2, unit_price: 375 }] });
  });
});

describe("editing on the task page", () => {
  let calls;
  let current;
  beforeEach(() => {
    calls = [];
    current = page(approval());
    localStorage.setItem("ea_token", "test");
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const path = String(url);
      calls.push({ path, method: init.method || "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : null });
      if (/\/draft$/.test(path)) {
        current = page(approval({ items: [{ description: "Monthly bookkeeping", qty: 3, unit_price: 350, price_source: "user_edited" }], subtotal: 1050, vat_amount: 210, total: 1260 }, 2),
          run({ last_edit: { version: 2, by: "me", changes: "Qty 2 → 3 on Monthly bookkeeping; total £900.00 → £1,260.00" } }), { ...OPTIONS, edited_by_you: true });
        return new Response(JSON.stringify({ run: current.run }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(current), { status: 200, headers: { "Content-Type": "application/json" } });
    });
  });
  const mount = () => render(<MemoryRouter initialEntries={["/agent/runs/run-1"]}><Routes><Route path="/agent/runs/:runId" element={<AgentRunPage />} /></Routes></MemoryRouter>);

  it("offers Edit at the top beside Approve and Decline; editing replaces the document and hides Approve and Decline", async () => {
    mount();
    const top = (await screen.findByRole("region", { name: "Approval required" })).querySelector("[data-top-actions]");
    expect([...top.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Edit", "Decline", "Approve"]);
    fireEvent.click(within(top).getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("form", { name: "Edit draft" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();                       // in place, not in a small dialog
    expect(screen.queryByRole("button", { name: "Approve and send" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    // Cancel discards what was typed.
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Edit draft" })).toBeNull();
    expect(calls.some((c) => /\/draft$/.test(c.path))).toBe(false);
    expect(screen.getByRole("button", { name: "Approve and send" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
    expect(screen.getByLabelText("Quantity").value).toBe("2");             // back to what the document says
  });

  it("saving shows the new version, who edited it and what changed, and asks for approval again", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Unit price"), { target: { value: "350" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); });
    const sent = calls.find((c) => c.method === "POST" && /\/workflow-runs\/run-1\/draft$/.test(c.path));
    expect(sent.body).toEqual({ items: [{ product_id: "p1", name: "Monthly bookkeeping", quantity: 3, unit_price: 350 }] });
    const card = await screen.findByRole("region", { name: "Approval required" });
    expect(card.querySelector("[data-version]").textContent.trim()).toBe("Version 2 · edited by you");
    expect(card.querySelector("[data-what-changed]").textContent).toBe("What changed: Qty 2 → 3 on Monthly bookkeeping; total £900.00 → £1,260.00");
    expect(screen.queryByRole("form", { name: "Edit draft" })).toBeNull();
    expect(screen.getByRole("button", { name: "Approve and send" })).toBeTruthy();      // approval is asked again
  });
});
