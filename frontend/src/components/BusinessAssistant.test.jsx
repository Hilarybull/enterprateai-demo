import { MemoryRouter, useLocation } from "react-router-dom";
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

it("keeps the reply score and loads next steps directly without another AI turn", async () => {
  replies = [{ kind: "answer", conversational: true, message: "Your score is now 46/100.", cards: [
    { type: "score_change", case_id: "funding-1", before: 66, after: 46 },
    { type: "result", case_id: "funding-1" },
  ] }];
  const normalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url, init) => {
    if (String(url).includes("/agent/readiness-items/funding/funding-1")) {
      calls.push({ path: String(url), method: "GET" });
      return new Response(JSON.stringify({ type: "readiness_tasks", case_id: "funding-1", topic: "funding", title: "Your remaining funding items", items: [{ title: "Confirm the funding date", detail: "A date is needed", code: "C1", section: "funding_goal" }], drafts: [] }), { status: 200 });
    }
    return normalFetch(url, init);
  });
  await act(async () => { render(<BusinessAssistant work={[{ id: "funding-1", kind: "funding", title: "Funding readiness", score: 61, detail: "Shoes loan" }]} />); });
  await ask("Update my funding need");
  expect(await screen.findByText("Funding readiness · 46/100")).toBeTruthy();
  expect(screen.queryByText("Funding readiness · 61/100")).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "See next steps" })); });
  expect(await screen.findByText(/Confirm the funding date/)).toBeTruthy();
  expect(sent(/\/agent\/requests$/)).toHaveLength(1);
  expect(calls.some(call => call.path.includes("/agent/readiness-items/funding/funding-1"))).toBe(true);
});

async function open() {
  // The Agent Centre's chat: always open there (the owner, 27 Oct)
  await act(async () => { render(<BusinessAssistant />); });
}
async function ask(text) {
  fireEvent.change(screen.getByPlaceholderText(/Ask EnterprateAI anything/), { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
}
const sent = (pattern) => calls.filter((c) => c.method === "POST" && pattern.test(c.path));

it("retries a temporarily unavailable acknowledgement with the same message identifier", async () => {
  vi.useFakeTimers();
  const normalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    if (String(url).endsWith("/agent/requests")) {
      calls.push({ path: String(url), method: "POST", body: JSON.parse(init.body) });
      attempts += 1;
      if (attempts < 3) return new Response(JSON.stringify({ code: "service_unavailable", detail: "Try shortly" }), { status: 503 });
      return new Response(JSON.stringify({ kind: "answer", message: "Your funding request is ready." }), { status: 200 });
    }
    return normalFetch(url, init);
  });
  try {
    await open();
    await ask("What funding options do I have?");
    await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
    expect(screen.getByText("Your funding request is ready.")).toBeTruthy();
    const requests = sent(/\/agent\/requests$/);
    expect(requests).toHaveLength(3);
    expect(new Set(requests.map(request => request.body.client_request_id)).size).toBe(1);
  } finally { vi.useRealTimers(); }
});

it("automatically reconnects after more than three failed reply checks without resubmitting", async () => {
  vi.useFakeTimers();
  const fetchNormally = globalThis.fetch;
  let checks = 0;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    if (/\/agent\/requests$/.test(String(url))) {
      calls.push({ path: String(url), method: "POST", body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ kind: "pending_reply", job_id: "reconnecting" }), { status: 200 });
    }
    if (/\/agent\/replies\/reconnecting$/.test(String(url))) {
      checks += 1;
      if (checks <= 4) return new Response(JSON.stringify({ detail: "Temporarily unavailable" }), { status: 503 });
      return new Response(JSON.stringify({ state: "complete", result: { kind: "answer", message: "Your earlier deadline is recovered." } }), { status: 200 });
    }
    return fetchNormally(url, init);
  });
  try {
    await open();
    await ask("I already answered");
    await act(async () => { await vi.advanceTimersByTimeAsync(13000); });
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check reply" })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(screen.getByText("Your earlier deadline is recovered.")).toBeTruthy();
    expect(sent(/\/agent\/requests$/)).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});

it("keeps clarification answers relevant and lets the owner type a different answer", async () => {
  replies = [{ kind: "answer", quick: true, message: "Did you mean no revenue, or no funding yet?",
    actions: ["No revenue yet", "No funding yet"].map(label => ({ label, prompt: label, kind: "explain", answers_question: true })) }];
  await open();
  await ask("None yet");
  expect(await screen.findByRole("button", { name: "No revenue yet" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "No funding yet" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "I need funding" })).toBeNull();
  replies = [{ kind: "answer", message: "Thanks, I'll use your explanation." }];
  await ask("I meant that this new project has no customers yet");
  expect(sent(/\/agent\/requests$/).at(-1).body.text).toBe("I meant that this new project has no customers yet");
});

it("hides old general suggestions when the reply asks a clarification", async () => {
  replies = [{ kind: "answer", quick: true, message: "What do you mean by none yet?",
    actions: [{ label: "Restart the loan", prompt: "Restart the loan", kind: "explain" }] }];
  await open();
  await ask("None yet");
  expect(await screen.findByText("What do you mean by none yet?")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Restart the loan" })).toBeNull();
  expect(screen.queryByRole("group", { name: "Suggested actions" })).toBeNull();
});

it("keeps thinking after handover while a background reply is pending, then displays it once", async () => {
  vi.useFakeTimers();
  const fetchNormally = globalThis.fetch;
  let checks = 0;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    if (/\/agent\/requests$/.test(String(url))) {
      calls.push({ path: String(url), method: "POST", body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ kind: "pending_reply", job_id: "funding-reply" }), { status: 200 });
    }
    if (/\/agent\/replies\/funding-reply$/.test(String(url))) return new Response(JSON.stringify(++checks === 1
      ? { state: "pending" } : { state: "complete", result: { kind: "answer", message: "I have your NGN 1m food loan details." } }), { status: 200 });
    return fetchNormally(url, init);
  });
  const words = "I need funding: NGN 1m for food, a loan, March next year. The business is trading.";
  window.history.replaceState(null, "", `/agent?chat=${encodeURIComponent(words)}`);
  try {
    await open();
    expect(screen.getByText("Thinking…")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(sent(/\/agent\/requests$/)[0].body.text).toBe(words);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByText("I have your NGN 1m food loan details.")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(sent(/\/agent\/requests$/)).toHaveLength(1);
  } finally { vi.useRealTimers(); window.history.replaceState(null, "", "/"); }
});

it("resumes a saved pending reply after refresh without submitting the funding request again", async () => {
  sessionStorage.setItem("ea:agent:pending-reply:ws-2:ada@example.test", JSON.stringify({ job_id: "saved-reply" }));
  const fetchNormally = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url, init) => /\/agent\/replies\/saved-reply$/.test(String(url))
    ? new Response(JSON.stringify({ state: "complete", user_message: "My food loan request", chat_id: "original-chat",
      result: { kind: "answer", message: "Your saved funding reply is ready." } }), { status: 200 }) : fetchNormally(url, init));
  await open();
  expect(await screen.findByText("Your saved funding reply is ready.")).toBeTruthy();
  expect(screen.getByText("My food loan request")).toBeTruthy();
  expect(sent(/\/agent\/requests$/)).toHaveLength(0);
});

it("shows thinking with progress until a delayed answer arrives", async () => {
  const fetchNormally = globalThis.fetch;
  let finish;
  globalThis.fetch = vi.fn((url, init) => /\/agent\/requests$/.test(String(url))
    ? new Promise(resolve => { finish = resolve; }) : fetchNormally(url, init));
  await open();
  await ask("What funding options do I have?");
  expect(screen.getByText("Thinking…")).toBeTruthy();
  expect(screen.getByRole("progressbar")).toBeTruthy();
  await act(async () => { finish(new Response(JSON.stringify({ kind: "answer", message: "Here are your funding options.", conversational: true }),
    { status: 200, headers: { "Content-Type": "application/json" } })); });
  expect(await screen.findByText("Here are your funding options.")).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
});

it("the upload quick action opens the chat picker and follows the selected business", async () => {
  await open();
  const picker = document.querySelector("[data-chat-file]");
  const click = vi.spyOn(picker, "click");
  act(() => { window.dispatchEvent(new CustomEvent("ea:chat-upload")); });
  expect(click).toHaveBeenCalledTimes(1);
  act(() => { useWorkspaceStore.setState({ workspaceId: "ws-9" }); });
  const file = new File(["Revenue,300"], "figures.csv", { type: "text/csv" });
  await act(async () => { fireEvent.change(picker, { target: { files: [file] } }); });
  expect(sent(/\/agent\/chat\/attach$/).at(-1).path).toContain("/businesses/ws-9/");
  expect(screen.getByText("Attached figures.csv")).toBeTruthy();
});

function ChatLocation() { return <p data-testid="chat-location">{useLocation().pathname}</p>; }

it("old checklist links list the items in chat and each item continues there", async () => {
  replies = [{ kind: "answer", message: "Nine things remain.", actions: [{ label: "See all 9", to: "/funding/case?tab=overview" }] },
    { kind: "answer", message: "Here are the remaining items.", cards: [{ type: "readiness_tasks", case_id: "case", topic: "funding", title: "Your remaining funding items", items: [{ title: "Confirm your target amount" }] }] },
    { kind: "answer", message: "What amount would you like to confirm?" }];
  render(<MemoryRouter initialEntries={["/agent"]}><BusinessAssistant waiting={{ count: 0, items: [] }} /><ChatLocation /></MemoryRouter>);
  await ask("Update my case");
  await act(async () => { fireEvent.click(await screen.findByRole("link", { name: "See all 9" })); });
  expect(await screen.findByText("1. Confirm your target amount")).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Work on this" })); });
  expect(screen.getByRole("button", { name: "I’ll answer" })).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Let the agent draft it" })); });
  expect(await screen.findByText("What amount would you like to confirm?")).toBeTruthy();
  expect(sent(/\/agent\/requests$/).at(-1).body.text).toContain("Confirm your target amount");
  expect(screen.getByTestId("chat-location").textContent).toBe("/agent");
});

it("sidebar navigation remembers the current conversation for the return action", async () => {
  window.history.replaceState(null, "", "/agent");
  render(<MemoryRouter initialEntries={["/agent"]}><BusinessAssistant waiting={{ count: 0, items: [] }} /><ChatLocation /></MemoryRouter>);
  await act(async () => {
    window.dispatchEvent(new CustomEvent("ea:chat-navigate", { detail: { to: "/integrations" } }));
  });
  expect(screen.getByTestId("chat-location").textContent).toBe("/integrations");
  const back = JSON.parse(sessionStorage.getItem("ea_came_from"));
  expect(back).toMatchObject({ to: "/agent", opens: "/integrations", name: "Agent Centre" });
  expect(typeof back.chat).toBe("string");
  expect(back.chat.length).toBeGreaterThan(0);
  window.history.replaceState(null, "", "/");
});

it.each([["more_customers", "customers"], ["business_risks", "risks"], ["price_offer", "pricing"]])("%s check is delegated without adding a second chat composer", async (goal_key, page) => {
  replies = [{ kind: "check", goal_key, said: "Help me with this check" },
    { kind: "answer", conversational: true, message: "I checked your records. What would you like to improve first?", actions: [] }];
  render(<MemoryRouter initialEntries={["/agent"]}><BusinessAssistant waiting={{ count: 0, items: [] }} /><ChatLocation /></MemoryRouter>);
  await ask("Help me with this check");
  expect(await screen.findByText("I checked your records. What would you like to improve first?")).toBeTruthy();
  expect(sent(/\/agent\/requests$/).at(-1).body).toMatchObject({ page, text: "Help me with this check" });
  expect(document.querySelector("[data-panel-chat]")).toBeNull();
  expect(screen.getAllByPlaceholderText(/Ask EnterprateAI anything/)).toHaveLength(1);
  expect(screen.getByTestId("chat-location").textContent).toBe("/agent");
});

it.each([
  ["funding", "I need funding", "/funding/f1?tab=assistant"],
  ["launch", "Help me launch my product", "/launch/l1?tab=assistant"],
  ["idea", "Help me explore my idea", "/check/idea?tab=assistant"],
])("%s specialist replies and follow-ups remain in the main conversation", async (kind, request, handover) => {
  replies = [
    { kind: "answer", conversational: true, case_id: "case-1", handover, message: `Here is your ${kind} result.`,
      actions: [{ label: "Explain the next step", kind: "explain", prompt: "What does that mean?" }] },
    { kind: "answer", conversational: true, message: "Here is what that step means." },
    { kind: "answer", conversational: true, message: "Let's prepare the quotation. Who is it for?" },
  ];
  render(<MemoryRouter initialEntries={["/agent"]}><BusinessAssistant waiting={{ count: 0, items: [] }} /><ChatLocation /></MemoryRouter>);
  await ask(request);
  expect(await screen.findByText(`Here is your ${kind} result.`)).toBeTruthy();
  expect(screen.getByTestId("chat-location").textContent).toBe("/agent");
  expect(calls.some(call => /readiness-question|\/chats\/case-/.test(call.path))).toBe(false);
  await ask("What does that mean?");
  expect(await screen.findByText("Here is what that step means.")).toBeTruthy();
  expect(sent(/\/agent\/requests$/).at(-1).body.history).toEqual(expect.arrayContaining([
    { role: "user", content: request }, { role: "assistant", content: `Here is your ${kind} result.` },
  ]));
  await ask("Draft a quotation instead");
  expect(await screen.findByText("Let's prepare the quotation. Who is it for?")).toBeTruthy();
  expect(screen.getByTestId("chat-location").textContent).toBe("/agent");
});

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
    expect(sent(/\/agent\/requests$/)[0].body).toMatchObject({ business_id: "ws-2", text: "How is my revenue?", history: [{ role: "assistant", content: expect.any(String) }] });
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
      { role: "assistant", content: expect.any(String) },
      { role: "user", content: "My van is called Bluebell." }, { role: "assistant", content: "Noted: Bluebell." },
      { role: "user", content: "Thanks" }, { role: "assistant", content: "You're welcome." }]);
  });

  it("keeps the conversation per business, and a new conversation starts clean", async () => {
    await open();
    await ask("How is my revenue?");
    await screen.findByText("Your revenue is steady.");
    expect(getConversation("ws-2").length).toBe(3);
    expect(getConversation("ws-9")).toEqual([]);                          // another business sees none of it
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "New conversation" })); });
    expect(getConversation("ws-2")).toEqual([]);
    expect(screen.queryByText("Your revenue is steady.")).toBeNull();
    await ask("Anything new?");
    await waitFor(() => expect(sent(/\/agent\/requests$/).length).toBe(2));
    expect(sent(/\/agent\/requests$/)[1].body.history).toEqual([{ role: "assistant", content: expect.any(String) }]);
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

it("a free check from the landing page runs here and shows its result in the chat", async () => {
  sessionStorage.setItem("ea:chat:review", JSON.stringify({ sessionId: "s1", message: "Working on getting more customers now. One moment." }));
  const earlier = globalThis.fetch;
  const asked = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    asked.push(path);
    const json = (out) => new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
    if (/\/task-sessions\/s1\/prepare$/.test(path)) return json({ first_value: true, goal_key: "more_customers", handoff: { to: "/dashboard" } });
    if (/\/task-sessions\/s1\/first-value$/.test(path)) return json({ result: { assessment_type: "customers_initial", headline: "Getting more customers", score: 30, evidence_coverage: 25, band: "Not ready yet", currency_sign: "£", key_numbers: [], gaps: { failed: [], early: [], unknown: [] }, strengths: [], blockers: [], metrics: [], criteria: [], free_next_actions: [], premium_gate: { allowed: true } } });
    return earlier(url, init);
  });
  await act(async () => { render(<MemoryRouter><BusinessAssistant /></MemoryRouter>); });
  await waitFor(() => expect(document.querySelector("[data-chat-first-value]")).toBeTruthy());
  expect(asked.some((p) => /\/prepare$/.test(p))).toBe(true);
  expect(screen.getByText("Working on getting more customers now. One moment.")).toBeTruthy();
  expect(screen.getByText(/saved under Results/)).toBeTruthy();
  expect(screen.queryByText(/couldn't be started/)).toBeNull();
});

it("a landing page task that turns into a running task is followed here, and a slow result still gives a way to it", async () => {
  sessionStorage.setItem("ea:chat:review", JSON.stringify({ sessionId: "s2" }));
  const earlier = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url, init) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const json = (out) => new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
    if (/\/task-sessions\/s2\/prepare$/.test(path)) return json({ first_value: true, goal_key: "more_customers", handoff: { to: "/check/customers", free: true } });
    if (/\/task-sessions\/s2\/first-value$/.test(path)) return json({});
    return earlier(url, init);
  });
  await act(async () => { render(<MemoryRouter><BusinessAssistant /></MemoryRouter>); });
  expect(await screen.findByText(/It's ready\. Next step: open it\./)).toBeTruthy();
  expect(screen.queryByText(/couldn't be started/)).toBeNull();
});

describe("a reply reads like a good chat reply (the owner, 12 Nov: \"some nice response like this\")", () => {
  it("shows bold where the Agent put it, copy and read aloud, and its contextual actions next to the composer, once", async () => {
    replies = [{ kind: "answer", conversational: true, quick: true,
      message: "The domain service is no longer active, so this would be a **new registration rather than a renewal**. Next step: register it.",
      actions: [{ label: "Register piclehdest.org for me", kind: "explain", prompt: "Register piclehdest.org for me" },
                { label: "Show me the registration price", kind: "explain", prompt: "Show me the registration price" }] }];
    await open();
    await ask("Can I renew my domain?");
    const strong = await screen.findByText("new registration rather than a renewal");
    expect(strong.tagName).toBe("STRONG");
    expect(document.body.textContent).not.toContain("**");
    expect(screen.getAllByRole("button", { name: "Copy reply" }).length).toBeGreaterThan(1);      // every reply, the greeting too
    expect(screen.getByRole("group", { name: "Suggested actions" }).contains(screen.getByRole("button", { name: "Register piclehdest.org for me" }))).toBe(true);
    expect(screen.getAllByRole("button", { name: "Register piclehdest.org for me" }).length).toBe(1);      // never twice
    replies = [{ kind: "answer", message: "It's £12 a year.", conversational: true }];
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Show me the registration price" })); });
    expect(sent(/\/agent\/requests$/).at(-1).body.text).toBe("Show me the registration price");
    expect(await screen.findByText("It's £12 a year.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Register piclehdest.org for me" })).toBeNull();      // only the latest reply’s actions
  });
});
