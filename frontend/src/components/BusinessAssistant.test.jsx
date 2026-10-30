// The chat bubble is the Agent: one entry point, the conversation sent with every message,
// what an answer costs, and what it remembers.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import BusinessAssistant from "./BusinessAssistant";
import { clearConversation, getConversation, replyText } from "../lib/agent";
import { useWorkspaceStore } from "../store/workspace";
import { useAuthStore } from "../store/auth";

let calls;
let replies;      // what the Agent says to each typed message, in order (the last one repeats)

beforeEach(() => {
  calls = [];
  replies = [{ kind: "answer", message: "Your revenue is steady.", conversational: true }];
  localStorage.setItem("ea_token", "test");
  sessionStorage.clear();
  useAuthStore.setState({ email: "ada@example.test" });
  useWorkspaceStore.setState({ workspaceId: "ws-2", workspaceName: "Apex Consulting Ltd", workspaceCompanyName: "Alchemy Test" });
  clearConversation("ws-2");
  clearConversation("ws-9");
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method || "GET", body });
    let out = {};
    if (/\/credits\/features/.test(path)) out = { features: [{ feature_code: "chat_message", credit_cost: 2, enabled: true }] };
    else if (/\/agent\/requests$/.test(path)) out = replies.length > 1 ? replies.shift() : replies[0];
    else if (/\/agent\/memory$/.test(path)) out = { fact: { id: "f1", text: body?.text } };
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function open() {
  // The Agent Centre's chat: always open there (the owner, 27 Oct)
  await act(async () => { render(<BusinessAssistant />); });
}
async function ask(text) {
  fireEvent.change(screen.getByPlaceholderText(/Ask EnterprateAI anything/), { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
}
const sent = (pattern) => calls.filter((c) => c.method === "POST" && pattern.test(c.path));

describe("the chat bubble is the Agent", () => {
  it("uses the business name the rest of the app shows, and never says what an answer costs", async () => {
    await open();
    expect(screen.getAllByText(/Alchemy Test/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Apex Consulting/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/credit/i);
  });

  it("sends every message to the Agent, for the business on screen, and never to a second chat", async () => {
    await open();
    const refreshed = vi.fn();
    window.addEventListener("ea:credits:refresh", refreshed);
    await ask("How is my revenue?");
    expect(await screen.findByText("Your revenue is steady.")).toBeTruthy();
    expect(sent(/\/agent\/requests$/)[0].body).toMatchObject({ business_id: "ws-2", text: "How is my revenue?", history: [] });
    expect(calls.some((c) => /business-assistant/.test(c.path))).toBe(false);
    expect(refreshed).toHaveBeenCalled();
    window.removeEventListener("ea:credits:refresh", refreshed);
  });

  it("sends the conversation so far with each message, so turn three still has turn one", async () => {
    replies = [{ kind: "answer", message: "Noted: Bluebell." }, { kind: "answer", message: "You're welcome." }, { kind: "answer", message: "Bluebell." }];
    await open();
    await ask("My van is called Bluebell.");
    await screen.findByText("Noted: Bluebell.");
    await ask("Thanks");
    await screen.findByText("You're welcome.");
    await ask("And the name of my van was?");
    await waitFor(() => expect(sent(/\/agent\/requests$/).length).toBe(3));
    expect(sent(/\/agent\/requests$/)[2].body.history).toEqual([
      { role: "user", content: "My van is called Bluebell." }, { role: "assistant", content: "Noted: Bluebell." },
      { role: "user", content: "Thanks" }, { role: "assistant", content: "You're welcome." }]);
  });

  it("keeps the conversation per business, and a new conversation starts clean", async () => {
    await open();
    await ask("How is my revenue?");
    await screen.findByText("Your revenue is steady.");
    expect(getConversation("ws-2").length).toBe(2);
    expect(getConversation("ws-9")).toEqual([]);                          // another business sees none of it
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "New conversation" })); });
    expect(getConversation("ws-2")).toEqual([]);
    expect(screen.queryByText("Your revenue is steady.")).toBeNull();
    await ask("Anything new?");
    await waitFor(() => expect(sent(/\/agent\/requests$/).length).toBe(2));
    expect(sent(/\/agent\/requests$/)[1].body.history).toEqual([]);
  });

  it("says exactly what is blocking it: credits, or the plan, with the way to upgrade", async () => {
    replies = [{ kind: "blocked", upgrade: true, reason_codes: ["credits_exhausted"], message: "This needs 2 credits; you have 0. Top up." }];
    await open();
    await ask("How is my revenue?");
    expect(await screen.findByText("This needs 2 credits; you have 0. Top up.")).toBeTruthy();
    expect(screen.getByText("See plans").getAttribute("href")).toBe("/pricing");
    cleanup();
    replies = [{ kind: "blocked", upgrade: true, reason_codes: ["plan_capability"], message: "Upgrade to use the Agent for this. Enquiry to Quote is included from the Starter plan." }];
    await open();
    await ask("Prepare a quotation for BrightTech");
    expect(await screen.findByText(/Upgrade to use the Agent for this\./)).toBeTruthy();
  });

  it("shows a finished task as a result with links to what it made, and several tasks as several replies", async () => {
    replies = [{ kind: "multi", results: [
      { kind: "workflow", run: { id: "run-1", status: "succeeded", summary: "If you lost QA Round Six, monthly revenue would fall by 66.7%.", next_action: "I'll keep watching.",
                                 outcome: { links: [{ label: "Full scenario in Simulation", to: "/simulation" }] } } },
      { kind: "workflow", run: { id: "run-2", status: "awaiting_approval", summary: "Prepared a reminder for INV-7." } }] }];
    await open();
    await ask("What if I lose QA Round Six and then chase INV-7");
    expect(await screen.findByText(/monthly revenue would fall by 66\.7%\. I'll keep watching\./)).toBeTruthy();
    expect(screen.getByText("Full scenario in Simulation").getAttribute("href")).toBe("/simulation");
    expect(screen.getByText(/Prepared a reminder for INV-7\. It's in Needs Approval: nothing is sent until you approve it\./)).toBeTruthy();
    expect(screen.queryByText(/Open Simulation/)).toBeNull();
  });

  it("remembers a fact only after the owner presses Save", async () => {
    replies = [{ kind: "remember", fact: "we close at 5pm", can_save: true, message: "Shall I remember this for this business? “we close at 5pm”" }];
    await open();
    await ask("remember that we close at 5pm");
    expect(await screen.findByText(/Shall I remember this/)).toBeTruthy();
    expect(sent(/agent\/memory$/).length).toBe(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    await waitFor(() => expect(sent(/businesses\/ws-2\/agent\/memory$/)[0].body).toEqual({ text: "we close at 5pm" }));
    expect(await screen.findByText(/Saved\. I'll remember/)).toBeTruthy();
  });

  it("puts any reply into words", () => {
    expect(replyText({ kind: "workflow", runs: [{}, {}], run: {} })).toMatch(/I've started 2 tasks/);
    expect(replyText({ kind: "answer", message: "A", evidence: [{ label: "L", value: "V" }], source: "S" })).toBe("A\n\n• L: V\n\nS");
    expect(replyText(null)).toBe("");
  });
});

describe("a task's questions", () => {
  it("are asked in the chat with their options as buttons, never in a dialog", async () => {
    replies = [{ kind: "needs_input", capability: "business_plan_draft", params: { existing_plan: "new", plan_for: "new", idea: "yam farming" },
      message: "Happy to draft your business plan. One quick question so it fits.",
      fields: [{ key: "purpose", label: "Who will read it?", type: "choice", options: [{ value: "investors", label: "Investors, to raise funding" }, { value: "planning", label: "Me and my team, to plan" }] }] },
    { kind: "answer", message: "Drafting it now.", conversational: true }];
    await open();
    await ask("new one...yam farming");
    expect(await screen.findByText(/One quick question so it fits\. Who will read it\?/)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Me and my team, to plan" })); });
    await waitFor(() => expect(sent(/\/agent\/requests$/).at(-1).body).toMatchObject({ capability: "business_plan_draft",
      params: { existing_plan: "new", plan_for: "new", idea: "yam farming", purpose: "planning" } }));
  });
});

describe("asking again", () => {
  it("gets its answer again; only a questioned answer is not repeated", async () => {
    replies = [{ kind: "answer", message: "You have 5 business plans. Open one, or create a new one?", conversational: true }];
    await open();
    await ask("I need a business plan");
    await ask("I need business plan");
    await waitFor(() => expect(screen.getAllByText("You have 5 business plans. Open one, or create a new one?").length).toBe(2));
    expect(screen.queryByText(/I've said that already/)).toBeNull();
    await ask("but you said I only have 3");
    expect(await screen.findByText(/I've said that already/)).toBeTruthy();
  });
});

describe("a priced task", () => {
  it("says its price with Start in the chat, and go ahead starts it, confirmed", async () => {
    replies = [{ kind: "needs_confirmation", reason_codes: ["price_confirmation_required"], capability: "business_plan_draft", price: 40, balance: 254,
      params: { existing_plan: "new", purpose: "investors" }, message: "I'll write your business plan, for investors. It costs 40 credits, and you have 254." },
    { kind: "answer", message: "Drafting it now.", conversational: true }];
    await open();
    await ask("business plan for investors");
    expect(await screen.findByRole("button", { name: "Start" })).toBeTruthy();
    await ask("go ahead");
    await waitFor(() => expect(sent(/\/agent\/requests$/).at(-1).body).toMatchObject({ capability: "business_plan_draft", confirmed: true,
      params: { existing_plan: "new", purpose: "investors" } }));
    expect(screen.queryByRole("button", { name: "Not now" })).toBeNull();      // its buttons go once it is answered
  });
});

describe("a draft made by a task", () => {
  it("is shown in the chat to approve, edit or reject, with its full page a link away", async () => {
    replies = [{ kind: "workflow", run: { id: "run1", status: "succeeded", title: "Business Plan Draft",
      outcome: { plan: { title: "yam farming" }, links: [{ label: "draft business plan", to: "/blueprint?tab=business-plans&review=d1" }] } },
      message: "Your business plan is ready to review." }];
    await open();
    await ask("business plan for yam farming");
    expect(await screen.findByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Open full page/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /See details/ })).toBeNull();
  });
});

describe("a task's questions in the chat", () => {
  it("never says Working on it while asking, and a typed new customer's name is not asked again", async () => {
    const q = { question: "Which customer is it for?", fields: [
      { key: "customer_id", label: "Customer", type: "customer", required: true, new_label: "+ New customer", options: [{ value: "c1", label: "Malachy" }] },
      { key: "customer_name", label: "Customer name", type: "text", required: true, default: "", show_if: { customer_id: "new" } },
      { key: "customer_email", label: "Customer email", type: "email", required: false, default: "", show_if: { customer_id: "new" } }] };
    replies = [{ kind: "needs_input", capability: "new_invoice", params: {}, message: "Which customer is it for?", fields: q.fields }];
    await open();
    await ask("I need an invoice");
    await ask("carl");
    expect(await screen.findByText(/customer's email address/i)).toBeTruthy();
    expect(screen.queryByText(/customer's name/i)).toBeNull();      // "carl" is the name already
    expect(screen.queryByText("Working on it…")).toBeNull();
    expect(screen.getByRole("button", { name: "Skip" })).toBeTruthy();      // optional: a chip to skip it
  });
});
