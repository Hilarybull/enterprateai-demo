// The free checks as a chat on their own page (the owner, 30 Oct: "they should be in a chat"): it opens on the result and
// every reply ends with its next step and button.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const sent = [];
const api = { result: null, posted: [] };
vi.mock("../api/client", () => ({
  apiRequest: vi.fn(async (path, method, body) => {
    if (!api.result) throw new Error("offline");
    if (method === "POST") { api.posted.push(body); return { result: api.after || api.result }; }
    return { last: { result: api.result, answers: { goal: "20" }, at: api.at } };
  }),
}));
vi.mock("../lib/agent", () => ({
  DOES_IT: /^(?:do all for me|start)$/i,
  useFollowRuns: () => {},
  NEW_REQUEST: /^\s*(?:research|find|draft|create)\b/i,
  questionOf: (fields) => { const f = (fields || [])[0]; return f ? { field: f, label: f.label, options: [], prompts: [] } : null; },
  doesItFirst: (list) => list,
  getChat: vi.fn(async () => ({ messages: [] })),
  getConversation: vi.fn(() => []),
  continueConversation: vi.fn(),
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

beforeEach(() => { sent.length = 0; api.result = null; api.after = null; api.posted = []; api.at = undefined; });
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

it("talks the check through: where it stands, each missing detail asked in turn and saved, then the next step (the owner, 1 Nov)", async () => {
  api.result = { headline: "Customer Growth Foundation", assessment_type: "customer_growth_foundation", focus: { text: "Now: no paying customers on record yet." },
    fine: ["Customers find you through ads"], not_on_record: [{ key: "ideal", label: "Who is your best customer?", ask: "ideal_customer", ask_type: "text" }],
    blockers: [{ key: "marketplace", gap: "Not listed on the Marketplace", why: "Customers searching there can't find you yet.", to: "/marketplace/profile", cta: "List on the Marketplace" }] };
  api.after = { ...api.result, not_on_record: [] };
  render(<MemoryRouter initialEntries={["/check/customers"]}><Routes><Route path="*" element={<CheckAssistant businessId="b1" topic="customers" />} /></Routes></MemoryRouter>);
  const card = await waitFor(() => { const c = document.querySelector('[data-card="check_card"]'); if (!c) throw new Error("no card"); return c; });
  expect(card.textContent).toContain("1 thing to fix to win more customers.");
  expect(card.textContent).toContain("Now: no paying customers on record yet.");
  expect(card.textContent).toContain("Not listed on the Marketplace");
  expect(card.textContent).toContain("Customers find you through ads");
  expect(screen.getByText(/One thing is holding you back/)).toBeTruthy();
  expect(screen.getByText("Who is your best customer?")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "office managers in Abuja" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText(/Saved\. Next step: list on the Marketplace, because customers searching there can't find you yet\./)).toBeTruthy();
  expect(api.posted[0]).toEqual({ answers: { goal: "20", ideal_customer: "office managers in Abuja" } });
  expect(sent).toHaveLength(0);      // answered by the check itself: no paid chat reply
  expect(screen.getAllByRole("button", { name: "List on the Marketplace" }).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Do all for me" })).toBeTruthy();
});

it("answers given since (the landing page, then View plan) start the chat again from them, never the old conversation (the owner, 1 Nov)", async () => {
  const { getChat } = await import("../lib/agent");
  getChat.mockImplementationOnce(async () => ({ messages: [{ role: "assistant", content: "Old next step", at: "2026-11-01T01:00:00Z" }, { role: "user", content: "Skip", at: "2026-11-01T01:01:00Z" }] }));
  api.result = { assessment_type: "customer_growth_foundation", blockers: [{ key: "marketplace", gap: "Not listed on the Marketplace", why: "Customers searching there can't find you yet." }] };
  api.at = "2026-11-01T03:20:00Z";
  render(<MemoryRouter><Routes><Route path="*" element={<CheckAssistant businessId="b1" topic="customers" />} /></Routes></MemoryRouter>);
  await waitFor(() => expect(document.querySelector('[data-card="check_card"]')).toBeTruthy());
  expect(screen.queryByText("Old next step")).toBeNull();
});

it("shows a task's question, and a new request is answered, never taken as its answer (the owner, 1 Nov)", async () => {
  const { submitAgentRequest } = await import("../lib/agent");
  submitAgentRequest.mockImplementationOnce(async () => ({ kind: "needs_input", capability: "business_plan_draft", params: { idea: "scarfs" }, message: "One quick question so it fits.",
    fields: [{ key: "audience", label: "Who will read it?", required: true }] }));
  render(<MemoryRouter><Routes><Route path="*" element={<CheckAssistant businessId="b1" topic="customers" />} /></Routes></MemoryRouter>);
  await screen.findByText(/help with winning more customers/i);
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "new one for designer scarfs" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("One quick question so it fits. Who will read it?")).toBeTruthy();
  submitAgentRequest.mockClear();
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Research funding options for my case" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(submitAgentRequest).toHaveBeenCalled());
  expect(submitAgentRequest.mock.calls[0][0]).toMatchObject({ text: "Research funding options for my case", page: "customers" });
  expect(submitAgentRequest.mock.calls[0][0].capability).toBeUndefined();
});
