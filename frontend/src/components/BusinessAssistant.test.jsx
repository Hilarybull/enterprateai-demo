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
  render(<BusinessAssistant />);
  await act(async () => { fireEvent.click(screen.getAllByRole("button")[0]); });
}
async function ask(text) {
  fireEvent.change(screen.getByPlaceholderText(/Ask about customers/), { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
}
const sent = (pattern) => calls.filter((c) => c.method === "POST" && pattern.test(c.path));

describe("the chat bubble is the Agent", () => {
  it("uses the business name the rest of the app shows, and says what an answer costs", async () => {
    await open();
    expect(screen.getAllByText(/Alchemy Test/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Apex Consulting/)).toBeNull();
    expect(await screen.findByText(/A written answer uses 2 AI Credits\./)).toBeTruthy();
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
    replies = [{ kind: "blocked", upgrade: true, reason_codes: ["credits_exhausted"], message: "You're out of AI Credits: a written answer needs 2 and you have 0. Nothing was charged. Top up or upgrade and ask again." }];
    await open();
    await ask("How is my revenue?");
    expect(await screen.findByText(/You're out of AI Credits: a written answer needs 2 and you have 0\./)).toBeTruthy();
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
