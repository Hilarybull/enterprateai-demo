// The customer's quotation panel: the signature is typed, the question thread survives a
// decision, the validity date appears once, and sending shows progress.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuoteResponsePanel, QuoteStatusBanner, QuoteSummaryBar } from "./QuoteResponse";

const info = (over = {}) => ({
  state: "open", reference: "QUO-3031026", version: 2, total: 288, currency: "GBP", valid_until: "2026-11-02", days_left: 30,
  seller: { name: "Alchemy Test" }, customer: { name: "QA Test Ltd", contact_name: "Sam Lee" }, questions: [], ...over,
});

let release;
beforeEach(() => {
  globalThis.fetch = vi.fn(() => new Promise((resolve) => {
    release = () => resolve(new Response(JSON.stringify({ action: "question", questions: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } }));
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("accepting", () => {
  it("starts with an empty name even when the contact is known, and needs it typed", () => {
    render(<QuoteResponsePanel token="tok" info={info()} />);
    fireEvent.click(screen.getByRole("button", { name: /accept quotation/i }));
    const name = screen.getByLabelText("Your full name");
    expect(name.value).toBe("");
    expect(name.getAttribute("autocomplete")).toBe("off");
    const submit = screen.getAllByRole("button", { name: /accept quotation/i }).at(-1);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(submit.disabled).toBe(true);                     // terms ticked, but no name yet
    fireEvent.change(name, { target: { value: "Sam Lee" } });
    expect(submit.disabled).toBe(false);
  });

  it("shows the validity date once: in the summary bar, not in the dialog", () => {
    render(<><QuoteSummaryBar info={info()} /><QuoteResponsePanel token="tok" info={info()} /></>);
    fireEvent.click(screen.getByRole("button", { name: /accept quotation/i }));
    expect(screen.getAllByText(/valid until/i)).toHaveLength(1);
    expect(screen.getByText("2 November 2026")).toBeTruthy();
  });
});

describe("questions", () => {
  const asked = [{ message: "Is delivery included?", asked_at: "2026-10-03T10:00:00Z" }];

  it.each(["accepted", "declined", "expired"])("stay visible once the quotation is %s", (state) => {
    const closed = info({ state, questions: asked, acceptance: { name: "Sam Lee", accepted_at: "2026-10-03T11:00:00Z" } });
    render(<><QuoteStatusBanner info={closed} /><QuoteResponsePanel token="tok" info={closed} /></>);
    expect(screen.getByText("Your questions")).toBeTruthy();
    expect(screen.getByText("Is delivery included?")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /accept quotation/i })).toBeNull();     // no actions on a closed quotation
    expect(screen.queryByRole("button", { name: /ask a question/i })).toBeNull();
  });

  it("show nothing extra on a closed quotation with no questions", () => {
    const { container } = render(<QuoteResponsePanel token="tok" info={info({ state: "accepted" })} />);
    expect(container.innerHTML).toBe("");
  });

  it("say 'Sending…' while the question is on its way", async () => {
    render(<QuoteResponsePanel token="tok" info={info()} />);
    fireEvent.click(screen.getByRole("button", { name: /ask a question/i }));
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Can we start next month?" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /send question/i })); });
    const sending = screen.getByRole("button", { name: /sending/i });
    expect(sending.disabled).toBe(true);
    await act(async () => { release(); await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByText(/your question has been sent to Alchemy Test/i)).toBeTruthy();
  });
});
