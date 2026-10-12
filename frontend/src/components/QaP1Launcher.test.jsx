// QA P1 regressions on the homepage launcher:
// P1-1 the hero never scrolls sideways: it clips its decoration, and nothing calls scrollIntoView on the way to the card.
// P1-2 after each answer the cursor is back in the reply box.
// P1-3 the goals hold still once one is chosen, and do not move at all with reduced motion.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GoalLauncher, { GOALS_EVERY_MS } from "./GoalLauncher";
import LandingPage from "../pages/LandingPage";
import { useWorkspaceStore } from "../store/workspace";

const QUESTIONS = [
  { key: "customer", label: "Who is it for?", type: "text", required: true, default: "", proposed: false },
  { key: "item", label: "What is it for?", type: "text", required: true, default: "", proposed: false }];
const session = (over = {}) => ({ id: "sess-1", state: "collecting_context", entry_mode: "quick_task", goal_key: "create_invoice", goal_label: "Create Invoice", next: "questions",
  questions: QUESTIONS, inputs: {}, proposed: {}, summary: [], missing: ["customer", "item"], authenticated: false, retention_days: 7, preparing_label: "Preparing your invoice",
  resolution: { original_goal: "Create Invoice", resolution_class: "direct_supported", message: "I'll prepare the invoice.", execution_boundary: "", recommended_path: [], credit_implication: "" }, ...over });

let calls;
let answer;
const realMatchMedia = window.matchMedia;
const media = (re) => { window.matchMedia = (q) => ({ matches: re.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }); };
beforeEach(() => {
  calls = [];
  answer = () => ({});
  localStorage.clear();
  sessionStorage.clear();
  useWorkspaceStore.setState({ workspaceId: null });
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method || "GET", body });
    return new Response(JSON.stringify(answer(path, init.method || "GET", body) ?? {}), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); window.matchMedia = realMatchMedia; });
const click = async (el) => { await act(async () => { fireEvent.click(el); }); };

describe("P1-1 the hero does not move sideways", () => {
  it("clips its decoration instead of making a scroll area, and opening a goal never calls scrollIntoView", async () => {
    media(/prefers-reduced-motion/);
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    answer = (path, method) => (method === "POST" && /task-sessions$/.test(path) ? session({ goal_key: "need_funding", goal_label: "I need funding" }) : undefined);
    render(<MemoryRouter><LandingPage /></MemoryRouter>);
    const hero = document.querySelector("#hero");
    expect(hero.className.split(" ")).toContain("overflow-clip");
    expect(hero.className.split(" ")).not.toContain("overflow-hidden");      // overflow-hidden is still a scroll container
    await click(within(hero.querySelector("[data-goal-launcher]")).getByRole("button", { name: "I need funding" }));
    expect(spy).not.toHaveBeenCalled();
    delete Element.prototype.scrollIntoView;
  });
});

describe("P1-2 the reply box keeps the cursor", () => {
  it("is focused for the next question after an answer", async () => {
    media(/prefers-reduced-motion/);
    answer = (path, method) => (method === "POST" && /task-sessions$/.test(path) ? session()
      : /\/inputs$/.test(path) ? session({ inputs: { customer: "Mark" }, missing: ["item"], questions: [{ ...QUESTIONS[0], default: "Mark" }, QUESTIONS[1]] }) : undefined);
    render(<MemoryRouter><GoalLauncher /></MemoryRouter>);
    await click(screen.getByRole("button", { name: "Create Invoice" }));
    const card = () => screen.getByRole("region", { name: "Your task" });
    const first = within(card()).getByLabelText("Who is it for?");
    fireEvent.change(first, { target: { value: "Mark" } });
    await act(async () => { fireEvent.submit(first.closest("form")); });
    await waitFor(() => expect(document.activeElement).toBe(within(card()).getByLabelText("What is it for?")));
  });
});

describe("P1-3 the goals hold still", () => {
  it("stops turning once a goal is chosen", async () => {
    media(/prefers-reduced-motion/);
    answer = (path, method) => (method === "POST" && /task-sessions$/.test(path) ? { __never: true } : undefined);
    // Reduced motion: never turns at all.
    vi.useFakeTimers();
    render(<MemoryRouter><GoalLauncher /></MemoryRouter>);
    const group = screen.getByRole("group", { name: "Popular business goals" });
    const first = () => within(group).getAllByRole("button")[0].textContent;
    act(() => { vi.advanceTimersByTime(GOALS_EVERY_MS * 3); });
    expect(first()).toBe("I need funding");
  });

  it("with motion on, a chosen goal stays: the goals do not move on after the pick", async () => {
    media(/^$/);      // no reduced motion
    vi.useFakeTimers();
    answer = () => undefined;
    render(<MemoryRouter><GoalLauncher /></MemoryRouter>);
    const group = screen.getByRole("group", { name: "Popular business goals" });
    const showing = () => within(group).getAllByRole("button").map((b) => b.textContent);
    act(() => { vi.advanceTimersByTime(GOALS_EVERY_MS); });
    const before = showing();
    fireEvent.click(within(group).getByRole("button", { name: before[0] }));
    fireEvent.mouseLeave(group);
    act(() => { vi.advanceTimersByTime(GOALS_EVERY_MS * 3); });
    expect(showing()).toEqual(before);
  });
});

describe("P2-3 a default is a suggestion, not a reply", () => {
  it("asks who it is for first, and shows the quantity's default in the reply box, not as an answer given", async () => {
    media(/prefers-reduced-motion/);
    const qs = [{ key: "customer", label: "Who is it for?", type: "text", required: true, default: "" },
      { key: "quantity", label: "How many?", type: "number", default: 1 }];
    answer = (path, method) => (method === "POST" && /task-sessions$/.test(path) ? session({ questions: qs, missing: ["customer"] })
      : /\/inputs$/.test(path) ? session({ questions: [{ ...qs[0], default: "Mark" }, qs[1]], inputs: { customer: "Mark" }, missing: [] }) : undefined);
    render(<MemoryRouter><GoalLauncher /></MemoryRouter>);
    await click(screen.getByRole("button", { name: "Create Invoice" }));
    const card = () => screen.getByRole("region", { name: "Your task" });
    expect(within(card()).getByLabelText("Who is it for?")).toBeTruthy();
    expect(card().querySelector("[data-answer='quantity']")).toBeNull();      // never a bubble the person didn't send
    const field = within(card()).getByLabelText("Who is it for?");
    fireEvent.change(field, { target: { value: "Mark" } });
    await act(async () => { fireEvent.submit(field.closest("form")); });
    expect(calls.filter((c) => /\/inputs$/.test(c.path))[0].body.answers).toEqual({ customer: "Mark" });      // the default is not sent as an answer
    await waitFor(() => expect(within(card()).getByLabelText("How many?").value).toBe("1"));      // asked, with 1 suggested
    expect(card().querySelector("[data-answer='quantity']")).toBeNull();
  });
});

describe("P3 one Working… at a time", () => {
  it("the hero Send does not say Working… while the task card is sending its answer", async () => {
    media(/prefers-reduced-motion/);
    let hold;
    globalThis.fetch = vi.fn((url, init = {}) => {
      const path = String(url);
      if (/\/inputs$/.test(path)) return new Promise((r) => { hold = r; });      // the card's answer is still on its way
      const out = (init.method || "GET") === "POST" && /task-sessions$/.test(path) ? session() : {};
      return Promise.resolve(new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } }));
    });
    render(<MemoryRouter><GoalLauncher /></MemoryRouter>);
    await click(screen.getByRole("button", { name: "Create Invoice" }));
    const card = () => screen.getByRole("region", { name: "Your task" });
    const field = within(card()).getByLabelText("Who is it for?");
    fireEvent.change(field, { target: { value: "Mark" } });
    await act(async () => { fireEvent.submit(field.closest("form")); });
    const heroSend = document.querySelector("[data-goal-launcher] button[type='submit']");
    expect(heroSend.textContent).toContain("Send");
    expect(heroSend.textContent).not.toContain("Working");
    hold?.(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
  });
});
