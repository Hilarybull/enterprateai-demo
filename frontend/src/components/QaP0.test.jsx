// QA P0 regressions on the front end:
// P0-1 a number written with words around it is read; one that can't be used is said, never dropped.
// P0-2 on a phone (375px) the task card is a sheet over the page, outside the hero, and the page behind it can't scroll.
// P0-3 Finish on onboarding checks for a matching Marketplace profile and creates nothing until it is answered.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GoalLauncher, { numberIn } from "./GoalLauncher";
import LandingPage from "../pages/LandingPage";
import OnboardingPage from "../pages/OnboardingPage";
import { useWorkspaceStore } from "../store/workspace";

const QUESTIONS = [{ key: "amount", label: "How much funding are you looking for?", type: "number", required: true, prefix: "£", default: "", proposed: false }];
const funding = (over = {}) => ({ id: "sess-1", state: "collecting_context", entry_mode: "business_goal", goal_key: "need_funding", goal_label: "I need funding", next: "questions",
  questions: QUESTIONS, inputs: {}, proposed: {}, summary: [], missing: ["amount"], authenticated: false, retention_days: 7, preparing_label: "Checking your funding readiness",
  resolution: { original_goal: "I need funding", resolution_class: "partial_support", message: "I can help you become more funding-ready.", execution_boundary: "", recommended_path: ["Funding Readiness"],
    credit_implication: "Free to start.", credit_badge: "Free" }, ...over });

let calls;
let answer;
const realMatchMedia = window.matchMedia;
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
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.matchMedia = realMatchMedia; document.body.style.overflow = ""; });
const click = async (el) => { await act(async () => { fireEvent.click(el); }); };
const posts = (re) => calls.filter((c) => c.method === "POST" && re.test(c.path));

describe("P0-1 numbers in answers", () => {
  it("reads the number out of the words", () => {
    expect(numberIn("£45 per groom")).toBe(45);
    expect(numberIn("about 20 a month")).toBe(20);
    expect(numberIn("£2.5k")).toBe(2500);
    expect(numberIn("50,000")).toBe(50000);
    expect(numberIn("not sure yet")).toBeNull();
  });

  it("an answer the server could not use is said on the question, every time", async () => {
    const rejected = { amount: "Please enter a number, for example 45." };
    answer = (path, method) => (method === "POST" && /task-sessions$/.test(path) ? funding() : /\/inputs$/.test(path) ? funding({ rejected }) : undefined);
    render(<MemoryRouter><GoalLauncher /></MemoryRouter>);
    await click(screen.getByRole("button", { name: "I need funding" }));
    const card = () => screen.getByRole("region", { name: "Your task" });
    const send = () => within(card()).getAllByRole("button").find((b) => /^(Continue|Send|Next)$/.test(b.textContent.trim()) || b.getAttribute("type") === "submit");
    const field = within(card()).getByLabelText("How much funding are you looking for?");
    // Words the browser can't read as digits go to the server, which reads them ("about sixty") or says why not (QA H).
    fireEvent.change(field, { target: { value: "lots" } });
    await click(send());
    expect(posts(/\/inputs$/)[0].body.answers).toEqual({ amount: "lots" });
    await waitFor(() => expect(within(card()).getByRole("alert").textContent).toBe("How much funding are you looking for? Please enter a number, for example 45."));
    // A number with words around it is sent as the number; the server's own refusal is said too.
    fireEvent.change(within(card()).getByLabelText("How much funding are you looking for?"), { target: { value: "£45 per groom" } });      // the box is drawn again after a reply
    await click(send());
    expect(posts(/\/inputs$/)[1].body.answers).toEqual({ amount: 45 });
    await waitFor(() => expect(within(card()).getByRole("alert").textContent).toBe("How much funding are you looking for? Please enter a number, for example 45."));
  });
});

describe("P0-2 the task card on a phone", () => {
  it("is a sheet outside the hero, and the page behind it does not scroll", async () => {
    window.matchMedia = (q) => ({ matches: /max-width: 767px|prefers-reduced-motion/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    answer = (path, method) => (method === "POST" && /task-sessions$/.test(path) ? funding() : undefined);
    render(<MemoryRouter><LandingPage /></MemoryRouter>);
    await click(within(document.querySelector("#hero [data-goal-launcher]")).getByRole("button", { name: "I need funding" }));
    const sheet = document.querySelector("[data-task-card][data-placement='column']");
    expect(sheet).not.toBeNull();
    expect(document.querySelector("#hero").contains(sheet)).toBe(false);      // never inside the hero, so nothing in it shifts sideways
    expect(sheet.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe("hidden");
  });
});

describe("P0-3 onboarding Finish with a matching profile", () => {
  it("asks first and creates the business only once it is answered", async () => {
    const found = { id: "biz-9", slug: "apex-consulting", name: "Apex Consulting Ltd", trust_state: "unclaimed" };
    answer = (path) => (/claimable-businesses/.test(path) ? { items: [found] } : /onboarding$/.test(path) ? { workspace_id: "ws-1", workspace_name: "Apex" } : undefined);
    render(<MemoryRouter><OnboardingPage /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText("e.g. Apex Consulting Ltd"), { target: { value: "Apex Consulting Ltd" } });
    await click(screen.getByRole("button", { name: "Continue" }));
    await click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByPlaceholderText("https://"), { target: { value: "https://apex.test" } });
    await click(screen.getByRole("button", { name: "Continue" }));
    await click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(document.querySelector("[data-finish-match]")).not.toBeNull());
    expect(posts(/\/workspace\/profile\/onboarding$/)).toHaveLength(0);      // nothing created yet
    fireEvent.click(within(document.querySelector("[data-finish-match]")).getByLabelText("This isn't my business"));
    await click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(posts(/\/workspace\/profile\/onboarding$/)).toHaveLength(1));
  });
});

describe("P2-8 onboarding checks what it is given", () => {
  it("needs a business name to continue, and a website that looks like one", async () => {
    const { looksLikeWebsite } = await import("../pages/OnboardingPage");
    expect(["example.co.uk", "www.example.com", "https://example.com/about"].every(looksLikeWebsite)).toBe(true);
    expect(["not a url", "example", "http://"].some(looksLikeWebsite)).toBe(false);
    render(<MemoryRouter><OnboardingPage /></MemoryRouter>);
    await click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Please enter your business name, or press Skip.")).toBeTruthy();
    expect(screen.getByText("What's your business called?")).toBeTruthy();      // still on step 1
    fireEvent.change(screen.getByPlaceholderText("e.g. Apex Consulting Ltd"), { target: { value: "Apex" } });
    await click(screen.getByRole("button", { name: "Continue" }));
    await click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByPlaceholderText("https://"), { target: { value: "not a url" } });
    await click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText(/That website doesn't look right/)).toBeTruthy();
    expect(screen.getByText("Where are you based?")).toBeTruthy();
  });
});
