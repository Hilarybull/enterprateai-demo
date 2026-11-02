import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
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
    const out = /readiness-question/.test(path) ? { kind: "funding", converse: true } : /first-value/.test(path) ? {} : /\/prepare$/.test(path) ? { ...SESSION, handoff: { to: "/funding/c1?tab=assistant", subject_id: "c1" } } : /task-sessions/.test(path) ? SESSION : {};
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

it("answers from the landing page still go to the chat, once", async () => {
  await open();
  expect(calls.some((p) => /readiness-question/.test(p))).toBe(true);
  expect(document.querySelector('[data-testid="where"]')?.textContent).toMatch(/^\/agent\?chat=/);
});
