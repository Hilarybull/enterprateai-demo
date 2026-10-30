// The free checks as a chat on their own page (the owner, 30 Oct: "they should be in a chat"): it opens on the result and
// every reply ends with its next step and button.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const sent = [];
vi.mock("../lib/agent", () => ({
  getChat: vi.fn(async () => ({ messages: [] })),
  saveChat: vi.fn(async () => ({})),
  agentErrorMessage: (_e, fallback) => fallback,
  replyText: (r) => r?.message || "",
  submitAgentRequest: vi.fn(async ({ text, page }) => {
    sent.push({ text, page });
    return { kind: "answer", message: "Your best channel is referrals. Next step: create a quotation.",
      actions: [{ label: "Create a quotation", to: "/operations?tab=Sales" }, { label: "What else?", kind: "explain", prompt: "What else can I do?" }],
      cards: [{ type: "check_result", result: { headline: "Your customer plan", strengths: ["Repeat customers"], missing: ["No marketing channel"] } }] };
  }),
}));
import CheckAssistant from "./CheckAssistant";

beforeEach(() => { sent.length = 0; });
afterEach(cleanup);
const Where = () => <span data-where>{useLocation().pathname}</span>;

it("doesn't auto-send a question on an empty result page; a clicked result button opens its destination", async () => {
  render(<MemoryRouter initialEntries={["/check/customers"]}><Routes><Route path="*" element={<><CheckAssistant businessId="b1" topic="customers" /><Where /></>} /></Routes></MemoryRouter>);
  expect(await screen.findByText(/help with winning more customers/i)).toBeTruthy();
  expect(sent).toHaveLength(0);      // opening a result page doesn't silently start a request
  expect(document.querySelector('[data-card="check_result"]')).toBeNull();
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "How do I get more customers?" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText(/Next step: create a quotation/)).toBeTruthy();
  expect(sent[0]).toEqual({ text: "How do I get more customers?", page: "customers" });
  expect(document.querySelector('[data-card="check_result"]').textContent).toContain("No marketing channel");
  fireEvent.click(screen.getByRole("button", { name: "Create a quotation" }));
  await waitFor(() => expect(document.querySelector("[data-where]").textContent).toBe("/operations"));
});

it("a price said has Start and Not now, and go ahead starts it (the owner, 30 Oct)", async () => {
  const { submitAgentRequest } = await import("../lib/agent");
  submitAgentRequest.mockImplementationOnce(async () => ({ kind: "needs_confirmation", capability: "idea_validation", params: { idea: "kiosk" }, price: 25,
    message: "I'll validate your idea. It costs 25 credits, and you have 341." }));
  submitAgentRequest.mockImplementationOnce(async (req) => { sent.push(req); return { kind: "answer", message: "Started. Next step: see your results." }; });
  render(<MemoryRouter><Routes><Route path="*" element={<CheckAssistant businessId="b1" topic="pricing" />} /></Routes></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Validate my idea" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText(/It costs 25 credits/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "go ahead" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText(/Started\. Next step/)).toBeTruthy();
  expect(sent.at(-1)).toMatchObject({ capability: "idea_validation", params: { idea: "kiosk" }, confirmed: true });
});

it("carries on a message handed over from the landing page", async () => {
  render(<MemoryRouter initialEntries={["/check/risks?message=What%20worries%20me%20is%20late%20payment"]}><Routes><Route path="*" element={<CheckAssistant businessId="b1" topic="risks" />} /></Routes></MemoryRouter>);
  await screen.findByText(/Next step/);
  expect(sent[0]).toEqual({ text: "What worries me is late payment", page: "risks" });
});
