// QA E1/E2: the dashboard's Agent card never scrolls sideways when a task card is clicked (it clips its
// turning border instead of scrolling, and nothing scrolls it into view), and the whole task card opens it.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import AgentPanel from "./AgentPanel";

const Where = () => <span data-testid="where">{useLocation().pathname}</span>;
const summary = { suggestions: [
  { key: "a", icon: "doc", text: "Score my idea", action: { to: "/validation" } },
  { key: "b", icon: "doc", text: "Draft my business plan", action: { to: "/business-plan" } }],
  needs_approval: [], entitlement: { is_paid: true, agent_tasks: true, credits: 40 } };

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete Element.prototype.scrollIntoView; });

describe("the Agent card", () => {
  it("clips instead of scrolling, and clicking a task card never scrolls anything into view", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    render(<MemoryRouter initialEntries={["/dashboard"]}><Routes><Route path="/dashboard" element={<AgentPanel businessId="ws1" summary={summary} onChanged={() => {}} />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
    const card = screen.getByRole("region", { name: "EnterprateAI Agent" });
    expect(card.className.split(" ")).toContain("overflow-clip");
    expect(card.className.split(" ")).not.toContain("overflow-hidden");      // overflow-hidden is a scroll container: it moved sideways
    expect(card.scrollLeft).toBe(0);
    await act(async () => { fireEvent.click(screen.getByText("Score my idea")); });
    expect(scrolled).not.toHaveBeenCalled();
    expect(focus.mock.calls.every(([opts]) => opts?.preventScroll === true)).toBe(true);
  });

  it("opens the task from anywhere on its card, not only the arrow", async () => {
    render(<MemoryRouter initialEntries={["/dashboard"]}><Routes><Route path="/dashboard" element={<AgentPanel businessId="ws1" summary={summary} onChanged={() => {}} />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
    const tile = screen.getByText("Draft my business plan").closest("button");
    expect(tile.querySelectorAll("button, a").length).toBe(0);              // one control: nothing inside competes with it
    await act(async () => { fireEvent.click(screen.getByText("Draft my business plan")); });      // the text, not the arrow
    expect(screen.getByTestId("where").textContent).toBe("/business-plan");
  });
});
