import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import StartPage from "./StartPage";
import { markStraightOn } from "../lib/browserData";

// The owner, 2 Nov: "just this one moment, opening agent center and back to this one moment"
const SESSION = { id: "s1", state: "resuming", goal_key: "need_funding", goal_label: "Funding", next: "prepare", currency: "NGN", authenticated: true, business_id: "b1", missing: [], questions: [],
  inputs: { amount: 5000000, use: "stock" }, proposed: {}, summary: [], resolution: { original_goal: "I need funding", resolution_class: "direct" } };
let calls;
function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p>; }
beforeEach(() => {
  calls = [];
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("ea_token", "t");
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    calls.push(path);
    const out = /readiness-question/.test(path) ? { kind: "funding", converse: true } : /first-value/.test(path) ? {} : /\/prepare$/.test(path) ? { ...SESSION, first_value: true, handoff: { to: "/funding/c1?tab=results", subject_id: "c1" } } : /task-sessions/.test(path) ? SESSION : {};
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function open() {
  render(<MemoryRouter initialEntries={["/start/s1"]}><Routes><Route path="/start/:sessionId" element={<StartPage />} /><Route path="/resume/:sessionId" element={<div><StartPage framed /></div>} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
  await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
}

it("answers finished in the chat start the task and open the case, never going back to the chat", async () => {
  markStraightOn("s1");
  await open();
  expect(calls.some((p) => /readiness-question/.test(p))).toBe(false);
  expect(calls.some((p) => /\/prepare$/.test(p))).toBe(true);
  expect(document.querySelector('[data-testid="where"]')?.textContent).toBe("/funding/c1?tab=assistant");
});

function answering(out) {
  globalThis.fetch = vi.fn(async (url) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    calls.push(path);
    const body = out(path);
    return new Response(JSON.stringify(body ?? {}), { status: body === null ? 500 : 200, headers: { "Content-Type": "application/json" } });
  });
}
const where = () => document.querySelector('[data-testid="where"]')?.textContent;

// Every live goal the landing page can start that isn't a case of its own: nothing runs on this page, the chat starts it.
it.each(["more_customers", "business_risks", "create_invoice", "create_quotation", "create_business_plan", "prepare_proposal"])("%s runs in the Agent Centre chat", async (goal_key) => {
  const session = { ...SESSION, goal_key, goal_label: "that", first_value: goal_key === "more_customers", resolution: {}, inputs: {} };
  answering((path) => (/readiness-question/.test(path) ? {} : session));
  await open();
  expect(where()).toBe("/agent");
  expect(calls.some((p) => /\/prepare$/.test(p))).toBe(false);
  expect(JSON.parse(sessionStorage.getItem("ea:chat:review")).sessionId).toBe("s1");
});

it.each(["price_offer", "cash_flow", "grow"])("%s is off the landing page and left as it was", async (goal_key) => {
  answering((path) => (/readiness-question/.test(path) ? {} : { ...SESSION, goal_key, resolution: {}, inputs: {} }));
  await open();
  expect(sessionStorage.getItem("ea:chat:review")).toBeNull();
});

it("a task already started in the chat still goes on in the chat", async () => {
  markStraightOn("s1");
  answering((path) => (/readiness-question/.test(path) ? {} : { ...SESSION, goal_key: "create_invoice", resolution: {}, inputs: {} }));
  await open();
  expect(where()).toBe("/agent");
});

it("a question left to ask is asked first, then it goes to the chat", async () => {
  answering((path) => (/readiness-question/.test(path) ? {} : { ...SESSION, goal_key: "more_customers", missing: ["sell"], questions: [{ key: "sell", label: "What do you sell?", type: "text", required: true }], resolution: {}, inputs: {} }));
  await open();
  expect(sessionStorage.getItem("ea:chat:review")).toBeNull();      // not yet
  expect(calls.some((p) => /\/prepare$/.test(p))).toBe(false);
});

it("a brand-new account names its business, then goes to the chat", async () => {
  const fresh = { ...SESSION, goal_key: "more_customers", first_value: true, business_id: null, resolution: {}, inputs: {} };
  answering((path) => (/readiness-question/.test(path) ? {} : /validation\/me/.test(path) ? null : /\/resume$/.test(path) ? { ...fresh, business_id: "b1" } : fresh));
  await open();
  fireEvent.submit(document.querySelector("form"));
  await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
  expect(where()).toBe("/agent");
  expect(calls.some((p) => /\/prepare$/.test(p))).toBe(false);
});

it("an old link to a finished check opens it in the chat, not this page", async () => {
  answering((path) => (/readiness-question/.test(path) ? {} : { ...SESSION, goal_key: "more_customers", first_value: true, resolution: {}, inputs: {}, handoff: { to: "/check/customers", free: true } }));
  await open();
  expect(where()).toBe("/agent");
  expect(JSON.parse(sessionStorage.getItem("ea:chat:review"))).toEqual({ sessionId: "s1" });
});

it.each(["need_funding", "launch", "test_idea"])("%s goes to the chat even when the look-up can't answer", async (goal_key) => {
  answering((path) => (/readiness-question/.test(path) ? null : { ...SESSION, goal_key, resolution: { original_goal: "Help me" }, inputs: {} }));
  await open();
  expect(where()).toMatch(/^\/agent\?chat=/);
  expect(calls.some((p) => /\/prepare$/.test(p))).toBe(false);
});

it("answers from the landing page still go to the chat, once", async () => {
  await open();
  expect(calls.some((p) => /readiness-question/.test(p))).toBe(true);
  expect(document.querySelector('[data-testid="where"]')?.textContent).toMatch(/^\/agent\?chat=/);
});
