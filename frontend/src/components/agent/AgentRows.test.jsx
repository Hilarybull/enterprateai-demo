// The Agent Centre lists (QA, 15 Oct): one compact row, no forms in the list, approvals reviewed (never answered here),
// duplicates grouped, stale requests cleared in one go with Undo before anything is cancelled.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AgentRows from "./AgentRows";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const old = new Date(Date.now() - 9 * 86400000).toISOString();
const now = new Date().toISOString();
const ask = (id, at, title = "Invoice for Mark · $300") => ({ id, workflow_key: "new_invoice", title, question_title: title, status: "running", created_at: at,
  pending_question: { question: "What VAT rate?", fields: [{ key: "vat_rate", label: "VAT rate", type: "number", required: true }] } });
const approval = { id: "a1", workflow_key: "payment_followup", title: "Payment follow-up", status: "awaiting_approval", bucket: "needs_approval", created_at: now };

describe("Agent Centre rows", () => {
  it("has no form in the list and opens the right thing for each row", () => {
    const onReview = vi.fn();
    render(<AgentRows runs={[ask("q1", now, "Quotation for Investors · Add their email"), approval]} empty="Nothing needs you right now." onOpen={vi.fn()} onReview={onReview} />);
    const list = document.querySelector("[data-agent-rows] ul");
    expect(list.querySelector("form, input, select, textarea")).toBeNull();
    const row = [...list.querySelectorAll("[data-agent-row]")].find((r) => r.textContent.includes("Payment follow-up"));
    expect(within(row).getByRole("button", { name: "Review" })).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Review" }));
    expect(onReview).toHaveBeenCalled();
  });

  it("groups duplicates of the same task into one row with N similar", () => {
    render(<AgentRows runs={[ask("q1", now), ask("q2", old)]} empty="" onOpen={vi.fn()} onReview={vi.fn()} />);
    expect(document.querySelectorAll("[data-agent-row]").length).toBe(1);
    expect(document.querySelector("[data-similar]").textContent).toBe("2 similar");
  });

  it("clears stale requests with Undo, and cancels them only when Undo has passed", async () => {
    vi.useFakeTimers();
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => { calls.push({ url: String(url), method: init.method }); return new Response("{}", { status: 200 }); });
    render(<AgentRows runs={[ask("s1", old, "Price check · What does it cost you to deliver?")]} empty="" onOpen={vi.fn()} onReview={vi.fn()} />);
    expect(document.querySelector("[data-stale]").textContent).toBe("Stale");
    fireEvent.click(screen.getByRole("button", { name: "Clear 1 old request" }));
    expect(document.querySelectorAll("[data-agent-row]").length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(document.querySelectorAll("[data-agent-row]").length).toBe(1);
    expect(calls.filter((c) => c.url.includes("/cancel")).length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Clear 1 old request" }));
    await act(async () => { vi.advanceTimersByTime(5100); });
    expect(calls.filter((c) => c.url.includes("/workflow-runs/s1/cancel")).length).toBe(1);
  });
});
