// The Agent runs what the plan includes and charges credits for it. What the plan doesn't include
// is shown locked and never starts; a refusal for the plan is a card, not an error; and after a
// task the card says what it used and what is left.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import AgentPanel, { blockedReply } from "./AgentPanel";

const Where = () => <span data-testid="where">{useLocation().pathname}</span>;
const summary = (over = {}) => ({
  suggestions: [
    { key: "scenario", icon: "doc", label: "Scenario Help", text: "See what happens if your largest customer pays late.", action: { capability: "scenario_help" } },
    { key: "invoice", icon: "doc", label: "New Invoice", text: "Create an invoice for a customer.", action: { capability: "new_invoice" } },
  ],
  needs_approval: [], hidden_capabilities: ["enquiry_to_quote", "quote_to_cash", "payment_followup", "receipt_send", "risk_concentration"],
  entitlement: { is_paid: false, agent_tasks: true, allowance_counts: false, monthly_runs: 5, monthly_runs_used: 0, credits: 44,
    locked: { scenario_help: "Starter" }, prices: { new_invoice: 2, scenario_help: 2 }, ...over },
});
let reply;
const mount = (s = summary()) => render(
  <MemoryRouter initialEntries={["/dashboard"]}><Routes>
    <Route path="/dashboard" element={<AgentPanel businessId="ws1" summary={s} onChanged={() => {}} />} /><Route path="*" element={<Where />} />
  </Routes></MemoryRouter>);

beforeEach(() => {
  reply = () => ({});
  globalThis.fetch = vi.fn(async (url, init = {}) => new Response(JSON.stringify(reply(String(url), init.method || "GET") ?? {}), { status: 200, headers: { "Content-Type": "application/json" } }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the Agent card and the plan", () => {
  it("a suggestion outside the plan shows a lock and the plan's name, starts nothing, and opens the plan card", async () => {
    mount();
    const locked = screen.getByText("See what happens if your largest customer pays late.").closest("button");
    expect(locked.getAttribute("data-locked")).toBe("Starter");
    expect(locked.querySelector("[data-tile-plan]").textContent).toBe("Starter plan");
    const included = screen.getByText("Create an invoice for a customer.").closest("button");
    expect(included.getAttribute("data-locked")).toBeNull();
    expect(included.querySelector("[data-tile-price]").textContent).toBe("2 credits");      // the price, before anything is pressed
    await act(async () => { fireEvent.click(locked); });
    const card = screen.getByRole("status");
    expect(card.textContent).toContain("Scenario Help is on the Starter plan.");
    expect(card.querySelector("[data-blocked-detail]").textContent).toBe("It is included from the Starter plan. Nothing was started and no credits were used.");
    expect(card.className).toContain("bg-brand-50");                        // a card in the brand colour, not an error
    expect(card.className).not.toMatch(/rose|amber/);
    expect(globalThis.fetch.mock.calls.filter(([u, i]) => /agent\/requests/.test(String(u)) && i?.method === "POST").length).toBe(0);      // no request was made
    fireEvent.click(within(card).getByRole("button", { name: "Upgrade" }));
    expect(screen.getByTestId("where").textContent).toBe("/pricing");
  });

  it("the plan card offers what the plan does include, and a refusal for credits says the balance and the price", () => {
    const plan = blockedReply({ reason: "plan", message: "Enquiry to Quote is on the Starter plan.", plan_required_label: "Starter",
      actions: [{ label: "Upgrade", to: "/pricing", upgrade: true }, { label: "Create an invoice instead", capability: "new_invoice" }] });
    expect(plan).toMatchObject({ tone: "plan", card: "plan", text: "Enquiry to Quote is on the Starter plan." });
    expect(plan.actions.map((a) => a.label)).toEqual(["Upgrade", "Create an invoice instead"]);
    const credits = blockedReply({ reason: "credits", message: "You're out of AI Credits.", balance: 0, cost: "2 credits", actions: [{ label: "Top up", to: "/pricing", upgrade: true }] });
    expect(credits.detail).toBe("You have 0 credits. This costs 2 credits. Nothing was started.");
    expect(credits.actions[0].label).toBe("Top up");
    expect(blockedReply({ message: "Your role can't start this kind of work." })).toEqual({ tone: "amber", text: "Your role can't start this kind of work.", upgrade: undefined });
    for (const text of [plan.detail, credits.detail]) expect(text).not.toMatch(/[–—]/);
  });

  it("after a task the card says what it used and what is left", async () => {
    reply = (url, method) => (method === "POST" && /agent\/requests/.test(url)
      ? { kind: "workflow", capability: "new_invoice", credits_used: 2, credits_left: 42, run: { id: "r1", status: "succeeded", summary: "The invoice is drafted.", workflow_key: "new_invoice", state: {} }, runs: [{ id: "r1" }] }
      : {});
    mount();
    fireEvent.change(screen.getByLabelText("Ask the EnterprateAI Agent"), { target: { value: "invoice Mark $50" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    await waitFor(() => expect(document.querySelector("[data-credits-used]")?.textContent).toBe("Used 2 credits · 42 left"));
  });

  it("a question tile says what it is about, with what is being confirmed on a second line", () => {
    const s = summary();
    s.suggestions = [{ key: "question:r1", icon: "chat", tone: "amber", mood: "needs_you", text: "Proposal for ABC Ltd. Add a price?", detail: "Website maintenance",
      question: { run_id: "r1", question: "Is this right?", fields: [] }, action: { run_id: "r1" } }];
    mount(s);
    const tile = screen.getByText("Proposal for ABC Ltd. Add a price?").closest("button");
    expect(tile.querySelector("[data-tile-detail]").textContent).toBe("Website maintenance");
    for (const cls of ["truncate", "text-white/60"]) expect(tile.querySelector("[data-tile-detail]").className.split(" ")).toContain(cls);
    expect(screen.queryByText("Is this right?")).toBeNull();                 // that wording is only inside the opened form
  });

  it("a task held for its plan offers Upgrade or Cancel; Cancel closes it and starts nothing", async () => {
    const s = summary();
    s.suggestions = [{ key: "held:r9", icon: "lock", tone: "amber", mood: "needs_you", text: "Proposal for ABC Ltd. On the Starter plan. Upgrade or cancel",
      held: { run_id: "r9", plan_required_label: "Starter", task: "New Proposal" }, action: { to: "/pricing" } }];
    mount(s);
    const tile = screen.getByText("Proposal for ABC Ltd. On the Starter plan. Upgrade or cancel").closest("button");
    expect(tile.getAttribute("data-locked")).toBe("Starter");
    await act(async () => { fireEvent.click(tile); });
    const card = screen.getByRole("status");
    expect(card.textContent).toContain("Proposal for ABC Ltd. On the Starter plan.");
    expect(within(card).getByRole("button", { name: "Upgrade" })).toBeTruthy();
    await act(async () => { fireEvent.click(within(card).getByRole("button", { name: "Cancel this task" })); });
    const calls = globalThis.fetch.mock.calls.filter(([, i]) => i?.method === "POST").map(([u]) => String(u).replace(/^https?:\/\/[^/]+/, "").replace(/^.*(\/workflow-runs|\/agent)/, "$1"));
    expect(calls).toEqual(["/workflow-runs/r9/cancel"]);                     // cancelled, and no task was started
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("That task is cancelled. Nothing was sent and no credits were used."));
  });

  it("asks what to call them once, only after a first result, and never again after Skip", async () => {
    const { useAuthStore } = await import("../../store/auth");
    useAuthStore.setState({ token: "t", email: "new@example.test", name: null, hydrated: true });
    localStorage.clear();
    reply = (url, method) => (method === "POST" && /agent\/requests/.test(url)
      ? { kind: "workflow", capability: "new_invoice", credits_used: 2, credits_left: 42, run: { id: "r1", status: "succeeded", summary: "The invoice is drafted.", workflow_key: "new_invoice", state: {} }, runs: [{ id: "r1" }] }
      : {});
    const first = mount();
    expect(document.querySelector("[data-ask-name]")).toBeNull();            // never before a result: it does not stand in the way of the task
    fireEvent.change(screen.getByLabelText("Ask the EnterprateAI Agent"), { target: { value: "invoice Mark $50" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    await waitFor(() => expect(screen.getByLabelText("By the way, what should I call you?")).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Skip" })); });
    expect(document.querySelector("[data-ask-name]")).toBeNull();
    first.unmount();
    mount();                                                                // back on the dashboard later: not asked again
    fireEvent.change(screen.getByLabelText("Ask the EnterprateAI Agent"), { target: { value: "invoice Mark $50" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    await waitFor(() => expect(document.querySelector("[data-credits-used]")).toBeTruthy());
    expect(document.querySelector("[data-ask-name]")).toBeNull();
    // Someone whose name is known is never asked.
    cleanup();
    localStorage.clear();
    useAuthStore.setState({ name: "Munah Okoro" });
    mount();
    fireEvent.change(screen.getByLabelText("Ask the EnterprateAI Agent"), { target: { value: "invoice Mark $50" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    await waitFor(() => expect(document.querySelector("[data-credits-used]")).toBeTruthy());
    expect(document.querySelector("[data-ask-name]")).toBeNull();
  });
});

