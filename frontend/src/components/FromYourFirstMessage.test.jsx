// QA P5-1: what was read from the owner's first message is shown once, as one compact line, "From what you said:
// dog walking · Bristol · March · 3 mates who said they'd pay (Edit)". Never as reply bubbles, never asked again; only
// the questions still open are asked. The homepage chat, the Agent modal and the quick checks alike.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GoalLauncher from "./GoalLauncher";
import QuickCheck from "./QuickCheck";
import { ChatQuestionThread } from "./agent/TaskFlow";

vi.mock("./GoogleSignInButton", () => ({ default: () => null }));

const SAID = "thinking of opening a dog walking biz in Bristol around March, already got 3 mates who said they'd pay";
const Q = (key, label, def = "", proposed = false, extra = {}) => ({ key, label, type: "text", required: true, default: def, proposed, ...extra });
const LAUNCH_QUESTIONS = (proposedNow) => [
  Q("kind", "What are you launching?", "service", proposedNow, { type: "choice", options: [{ value: "service", label: "A service" }, { value: "product", label: "A product" }] }),
  Q("sell", "Briefly describe it.", "dog walking", proposedNow),
  Q("stage", "What stage is it at?", "", false, { type: "choice", options: [{ value: "idea", label: "Just an idea" }, { value: "testing", label: "Testing it" }] }),
  Q("customer", "Who is it for?"),
  Q("where", "Where do you want to launch?", "Bristol", proposedNow),
  Q("target_date", "When do you want to launch?", "March", proposedNow),
  Q("evidence", "What customer testing or demand evidence do you already have?", "3 mates who said they'd pay", proposedNow)];
const ROWS = (proposedNow) => [["kind", "What are you launching?", "A service"], ["sell", "Briefly describe it.", "dog walking"], ["where", "Where do you want to launch?", "Bristol"],
  ["target_date", "When do you want to launch?", "March"], ["evidence", "What customer testing or demand evidence do you already have?", "3 mates who said they'd pay"]]
  .map(([key, label, value]) => ({ key, label, value, proposed: proposedNow, from_message: true }));
const launch = (over) => ({ id: "sess-1", state: "collecting_context", entry_mode: "free_text", goal_key: "launch", goal_label: "Launch a product or service", next: "questions",
  resolution: { original_goal: SAID, resolution_class: "composite_goal", message: "I'll check what looks ready and show the gaps.", recommended_path: ["Launch Readiness"] },
  authenticated: false, retention_days: 7, ...over });

let calls;
let reply;
beforeEach(() => {
  calls = [];
  localStorage.clear();
  sessionStorage.clear();
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method || "GET", body });
    return new Response(JSON.stringify(reply(path, init.method || "GET", body) ?? {}), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the homepage chat", () => {
  it("shows what the first message said once, asks only what is left, and never turns it into reply bubbles", async () => {
    const first = launch({ questions: LAUNCH_QUESTIONS(true), inputs: {}, proposed: { kind: "service", sell: "dog walking", where: "Bristol", target_date: "March", evidence: "3 mates who said they'd pay" },
      summary: ROWS(true), missing: ["stage", "customer"] });
    // After the first answer, what was read is confirmed (it is in the inputs now): still the line, never bubbles.
    const second = launch({ questions: LAUNCH_QUESTIONS(false), inputs: { kind: "service", sell: "dog walking", where: "Bristol", target_date: "March", evidence: "3 mates who said they'd pay", stage: "idea" },
      proposed: {}, summary: [...ROWS(false), { key: "stage", label: "What stage is it at?", value: "Just an idea", proposed: false, from_message: false }], missing: ["customer"] });
    reply = (path, method) => (method === "POST" && /task-sessions$/.test(path) ? first : method === "POST" && /\/inputs$/.test(path) ? second : undefined);
    render(<MemoryRouter><GoalLauncher /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("What do you want EnterprateAI to do for your business?"), { target: { value: SAID } });
    await act(async () => { fireEvent.click(document.querySelector("[data-goal-launcher] form button[type='submit']")); });
    const card = screen.getByRole("region", { name: "Your task" });
    const line = () => card.querySelector("[data-said-line]");
    expect(line().textContent).toBe("From what you said: A service · dog walking · Bristol · March · 3 mates who said they'd pay (Edit)");
    expect(card.querySelectorAll("[data-said]").length).toBe(1);                 // shown once
    expect(card.querySelector("[data-question-turn]").textContent).toContain("What stage is it at?");      // only what is left is asked
    expect(card.textContent).not.toContain("Briefly describe it.");
    expect(card.querySelector("[data-thread]")).toBeNull();                      // no reply bubbles for what they said
    await act(async () => { fireEvent.click(within(card).getByRole("button", { name: "Just an idea" })); });
    // The next turn: the line again, the stage they just gave as their reply, and nothing from the message as a bubble.
    expect(line().textContent).toBe("From what you said: A service · dog walking · Bristol · March · 3 mates who said they'd pay (Edit)");
    expect([...card.querySelectorAll("[data-answer]")].map((b) => b.getAttribute("data-answer"))).toEqual(["stage"]);
    expect(card.textContent).not.toContain("Briefly describe it.");
    expect(card.querySelector("[data-question-turn]").textContent).toContain("Who is it for?");
    // Edit lists each one, to pick the one to change; that one is then asked.
    await act(async () => { fireEvent.click(within(card).getByRole("button", { name: "(Edit)" })); });
    await act(async () => { fireEvent.click(card.querySelector('[data-said-change="where"]')); });
    expect(card.querySelector("[data-question-turn]").textContent).toContain("Where do you want to launch?");
  });
});

describe("the Agent modal", () => {
  const fields = [
    { key: "customer_name", label: "Customer name", type: "text", required: true, default: "Brightway Ltd", said: true, said_text: "Brightway Ltd" },
    { key: "customer_email", label: "Customer email", type: "email", required: true, default: "" },
    { key: "valid_until", label: "Valid until", type: "date", default: "2026-11-11", said: true, said_text: "11/11/2026" },
  ];

  it("shows the line, asks only what is missing, and sends what was said with the answers", () => {
    const onSubmit = vi.fn();
    const { container } = render(<ChatQuestionThread question="Where should the quotation go?" fields={fields} onSubmit={onSubmit} onCancel={() => {}} />);
    expect(container.querySelector("[data-said-line]").textContent).toBe("From what you said: Brightway Ltd · 11/11/2026 (Edit)");
    // The one question left, asked once in the server's words (QA U3), not the name or the date again.
    expect([...container.querySelectorAll("[data-asks]")].map((a) => a.textContent)).toEqual(["Where should the quotation go?"]);
    expect(container.querySelector("[data-step]")).toBeNull();                 // one question left: no "of 3"
    expect(container.querySelector("[data-answer]")).toBeNull();               // nothing said is a reply bubble
    fireEvent.change(screen.getByLabelText("Customer email"), { target: { value: "ops@brightway.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit.mock.calls[0][0]).toEqual({ customer_name: "Brightway Ltd", customer_email: "ops@brightway.test", valid_until: "2026-11-11" });
  });

  it("Edit asks what was said like the rest", () => {
    const { container } = render(<ChatQuestionThread question="A few details" fields={fields} onSubmit={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "(Edit)" }));
    expect(container.querySelector("[data-step]").textContent).toBe("Question 1 of 3");
    expect(screen.getByLabelText("Customer name").value).toBe("Brightway Ltd");
  });
});

describe("the quick checks", () => {
  it("started from the owner's sentence: the line, then only the questions left, and the said answers go with the result", async () => {
    const questions = [
      { key: "sell", label: "Briefly describe it.", type: "text", required: true, default: "dog walking", said: true, said_text: "dog walking" },
      { key: "where", label: "Where do you want to launch?", type: "text", required: true, default: "Bristol", said: true, said_text: "Bristol" },
      { key: "customer", label: "Who is it for?", type: "text", required: true, default: "" },
    ];
    reply = (path, method) => (method === "GET" && /quick-check\/launch/.test(path) ? { questions } : method === "POST" ? { result: null } : undefined);
    const { container } = render(<QuickCheck businessId="ws1" goalKey="launch" open said="dog walking in Bristol" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(calls[0].path).toContain("?said=dog%20walking%20in%20Bristol");
    expect(container.querySelector("[data-said-line]").textContent).toBe("From what you said: dog walking · Bristol (Edit)");
    expect(container.querySelector("[data-progress]").textContent).toBe("Question 1 of 1");
    expect(screen.queryByLabelText("Briefly describe it.")).toBeNull();
    fireEvent.change(screen.getByLabelText("Who is it for?"), { target: { value: "Busy professionals" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "See my result" })); });
    expect(calls.find((c) => c.method === "POST").body).toEqual({ answers: { sell: "dog walking", where: "Bristol", customer: "Busy professionals" } });
  });
});
