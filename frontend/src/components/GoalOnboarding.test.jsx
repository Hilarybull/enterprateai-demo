// Goal-driven onboarding (PRD-GO-001) on the front end: the homepage launcher (goals first, tasks
// second, free text always), the focused goal card (clarifying chips, values read from the
// visitor's sentence, numbered path, the limit as a note, the save checkpoint), the resume page
// after sign-in, the funnel events, and the Agent Centre's Documents list.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import GoalLauncher, { GOALS_EVERY_MS, goalSets } from "./GoalLauncher";
import { QuestionForm } from "./agent/AgentBits";
import DraftEditor, { editableApproval } from "./agent/DraftEditor";
import StartPage from "../pages/StartPage";
import LandingPage, { greetingAt } from "../pages/LandingPage";
import { DocumentList } from "../pages/AgentCentrePage";
import { useWorkspaceStore } from "../store/workspace";
import { useAuthStore } from "../store/auth";

vi.mock("./GoogleSignInButton", () => ({ default: ({ onCredential }) => <button type="button" onClick={() => onCredential("google-credential")}>Continue with Google</button> }));

const PROMPT = "What do you want EnterprateAI to do for your business?";
const INVOICE_QUESTIONS = [{ key: "customer", label: "Who is it for?", type: "text", required: true, default: "", proposed: false },
  { key: "item", label: "What is it for?", type: "text", required: true, default: "", proposed: false },
  { key: "amount", label: "How much?", type: "number", required: true, prefix: "£", default: "", proposed: false }];
const session = (over = {}) => ({ id: "sess-1", state: "collecting_context", entry_mode: "quick_task", goal_key: "create_invoice", goal_label: "Create Invoice", next: "questions",
  questions: INVOICE_QUESTIONS, inputs: {}, proposed: {}, summary: [], missing: ["customer", "item", "amount"], authenticated: false, retention_days: 7, preparing_label: "Preparing your invoice",
  resolution: { original_goal: "Create Invoice", resolution_class: "direct_supported", message: "I'll prepare the invoice and have it ready for you to approve. Nothing is sent until you say so.",
    execution_boundary: "", recommended_path: ["New Invoice"], credit_implication: "Your first one on a new account is free: no AI Credits to prepare or send it." }, ...over });
const FUNDING_QUESTIONS = [
  { key: "amount", label: "How much funding are you looking for?", type: "number", required: true, prefix: "£", default: "", proposed: false,
    chips: [{ value: 10000, label: "£10,000" }, { value: 25000, label: "£25,000" }, { value: 50000, label: "£50,000" }] },
  { key: "stage", label: "Where is the business now?", type: "choice", required: true, default: "", proposed: false,
    options: [{ value: "pre_revenue", label: "Not trading yet" }, { value: "trading", label: "Trading" }] }];
const funding = (over = {}) => session({ goal_key: "need_funding", goal_label: "I need funding", entry_mode: "business_goal", questions: FUNDING_QUESTIONS, missing: ["amount", "stage"],
  preparing_label: "Checking your funding readiness",
  resolution: { original_goal: "I need funding", resolution_class: "partial_support", message: "I can help you become more funding-ready: assess where you stand, show the gaps, organise your evidence and prepare the materials.",
    execution_boundary: "I can't guarantee funding, or a yes from any investor or lender.", recommended_path: ["Funding Readiness", "Funding Pack Draft", "Business Plan Draft"],
    credit_implication: "Free to start: working this out with you uses no AI Credits." }, ...over });

let calls;
let answer;      // (path, method, body) => response body, or { __status, __body }
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
    const out = answer(path, init.method || "GET", body) ?? {};
    const status = out && out.__status ? out.__status : 200;
    return new Response(JSON.stringify(out.__body ?? out), { status, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); useAuthStore.setState({ token: null, email: null }); });

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname + l.search}</p>; }
const posts = (pattern) => calls.filter((c) => c.method === "POST" && pattern.test(c.path));
const events = () => posts(/\/goal-events$/).map((c) => c.body);
const starts = (first) => (path, method) => (method === "POST" && /task-sessions$/.test(path) ? first : undefined);
const mountLauncher = () => render(<MemoryRouter initialEntries={["/"]}><Routes><Route path="/" element={<GoalLauncher />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
const card = () => screen.getByRole("region", { name: "Your task" });
const click = async (el) => { await act(async () => { fireEvent.click(el); }); };

describe("the homepage launcher", () => {
  it("asks what you want done, shows business goals first and quick tasks second, and keeps free text", async () => {
    const { container } = mountLauncher();
    expect(screen.getByLabelText(PROMPT).tagName).toBe("INPUT");
    const goalGroup = screen.getByRole("group", { name: "Popular business goals" });
    const goals = within(goalGroup).getAllByRole("button");
    expect(goals.map((b) => b.textContent)).toEqual(["I need funding", "I need more customers", "Help me price my product/service"]);      // three at a time
    // All eight are there in sets of three (the last filled from the start); the sets not showing are out of reach.
    const sets = [...goalGroup.querySelectorAll("[data-goal-set]")];
    expect(sets.map((set) => [...set.querySelectorAll("button")].map((b) => b.textContent))).toEqual([
      ["I need funding", "I need more customers", "Help me price my product/service"],
      ["I want to launch a product/service", "Improve my cash flow", "Help me grow my business"],
      ["Test a business idea", "Help me understand my business risks", "I need funding"]]);
    expect(sets.map((set) => set.getAttribute("aria-hidden"))).toEqual([null, "true", "true"]);
    expect([...sets[1].querySelectorAll("button")].every((b) => b.disabled && b.tabIndex === -1)).toBe(true);
    expect(sets.every((set) => set.className.includes("col-start-1") && set.className.includes("row-start-1"))).toBe(true);      // one cell: the card never changes height
    expect(goalGroup.querySelectorAll("[data-goal-dots] > span").length).toBe(3);
    const tasks = within(screen.getByRole("group", { name: "Or start a task" })).getAllByRole("button");
    expect(tasks.map((b) => b.textContent)).toEqual(["Create Invoice", "Create Quotation", "Create Business Plan", "Prepare Proposal"]);
    expect(goals[0].className).toContain("text-sm");                      // goals are the prominent chips
    expect(goals[0].className).toContain("font-semibold");
    expect(tasks[0].className).toContain("text-[12px]");                   // tasks are visibly secondary
    // One white card; on a phone each set of chips is a single row that scrolls sideways, and from 768px they wrap.
    const launcher = container.querySelector("[data-goal-launcher]");
    // The Agent's card: a gradient border around a deep indigo body, so it is the first thing seen.
    for (const cls of ["m-agent-card", "rounded-2xl", "p-[2px]", "overflow-hidden", "text-left", "shadow-[0_20px_60px_rgba(108,92,231,0.25)]"]) expect(launcher.className.split(" ")).toContain(cls);
    for (const cls of ["mt-6", "md:mt-7", "lg:mt-8"]) expect(document.querySelector("#hero [data-goal-launcher]") ? document.querySelector("#hero [data-goal-launcher]").className.split(" ") : [cls]).toContain(cls);
    expect(launcher.querySelector(".m-agent-border").getAttribute("aria-hidden")).toBe("true");
    expect(launcher.hasAttribute("data-agent-shell")).toBe(true);           // the shared shell, the same one the dashboard's Agent card uses
    for (const cls of ["sm:p-6", "from-[#1e1b4b]"]) expect(launcher.querySelector("[data-agent-panel]").className.split(" ")).toContain(cls);      // 24px padding
    // Who it is: avatar, name, "Online" in words, and what it does.
    const who = launcher.querySelector("[data-agent-identity]");
    expect(who.querySelector("[data-agent-avatar]").style.width).toBe("32px");
    expect(who.textContent).toBe("EnterprateAI AgentOnlineTell it the job. It does the work and asks only for what it needs.");
    expect(screen.getByText(PROMPT).className).toContain("text-white");
    const promptField = container.querySelector("[data-prompt-field]");
    for (const cls of ["bg-white", "h-14"]) expect(promptField.className.split(" ")).toContain(cls);      // 56px tall, white on the card
    expect(screen.getByLabelText(PROMPT).className).toContain("text-base");      // 16px
    expect(screen.getByLabelText(PROMPT).getAttribute("placeholder")).toBe("For example: create an invoice for ABC Consulting, or I need more customers");      // no typing with reduced motion
    // Start is never greyed out: with nothing typed it points at the field instead.
    const start = screen.getByRole("button", { name: "Start" });
    expect(start.disabled).toBe(false);
    for (const cls of ["bg-brand-600", "text-white"]) expect(start.className.split(" ")).toContain(cls);
    expect(start.querySelector("svg")).toBeTruthy();
    await click(start);
    expect(document.activeElement).toBe(screen.getByLabelText(PROMPT));
    expect(promptField.className).toContain("m-shake");
    expect(posts(/task-sessions$/).length).toBe(0);
    // The trust row, inside the card under the chips.
    expect(launcher.querySelector("[data-trust-row]").textContent).toBe("No sign up to start·Nothing is sent without your approval");
    const rows = [...container.querySelectorAll("[data-chip-row]")];
    expect([...new Set(rows.map((r) => r.closest("[role='group']").getAttribute("aria-label")))]).toEqual(["Popular business goals", "Or start a task"]);      // goals, then tasks
    for (const set of sets) expect(set.className).toContain("flex-wrap");      // three goals wrap at any width; nothing to swipe
    expect(rows[rows.length - 1].className).toContain("flex-wrap");      // the tasks wrap too
    expect(container.querySelector("[data-more-hint]")).toBeNull();
    expect([...goals, ...tasks].every((chip) => chip.className.includes("shrink-0") && chip.className.includes("whitespace-nowrap"))).toBe(true);
    expect(screen.queryByText(/Free essential business tools/)).toBeNull();      // no line under the suggestions
    expect(screen.queryByText(/get funding|get customers|guarantee/i)).toBeNull();      // no promise in the copy
    await waitFor(() => expect(events()).toEqual([{ name: "homepage_goal_prompt_viewed" }]));
  });

  it("the goals change every few seconds, wait while the pointer is on them, and stay on the chosen goal", async () => {
    vi.useFakeTimers();
    try {
      answer = starts(session({ goal_key: "cash_flow", goal_label: "Improve my cash flow" }));
      mountLauncher();
      const group = screen.getByRole("group", { name: "Popular business goals" });
      const showing = () => within(group).getAllByRole("button").map((b) => b.textContent);
      expect(showing()[0]).toBe("I need funding");
      act(() => { vi.advanceTimersByTime(GOALS_EVERY_MS); });
      expect(showing()).toEqual(["I want to launch a product/service", "Improve my cash flow", "Help me grow my business"]);
      fireEvent.mouseEnter(group);                                          // reading them: they hold still
      act(() => { vi.advanceTimersByTime(GOALS_EVERY_MS * 3); });
      expect(showing()[0]).toBe("I want to launch a product/service");
      fireEvent.mouseLeave(group);
      act(() => { vi.advanceTimersByTime(GOALS_EVERY_MS); });
      expect(showing()[0]).toBe("Test a business idea");
      act(() => { vi.advanceTimersByTime(GOALS_EVERY_MS); });
      expect(showing()[0]).toBe("I need funding");                          // and round again
    } finally { vi.useRealTimers(); }
    expect(goalSets([{ key: "a" }, { key: "b" }])).toEqual([[{ key: "a" }, { key: "b" }]]);      // three or fewer: one set, nothing to change
  });

  it("shows only the suggestions the server says have a real path behind them", async () => {
    answer = (path) => (/goal-suggestions/.test(path) ? { prompt: PROMPT, reassurance: "Free essential business tools. 50 AI Credits to get started.",
      goals: [{ key: "more_customers", label: "I need more customers" }], tasks: [{ key: "create_invoice", label: "Create Invoice" }], retention_days: 7 } : {});
    mountLauncher();
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Popular business goals" })).getAllByRole("button").length).toBe(1));
    expect(screen.queryByRole("button", { name: "I need funding" })).toBeNull();      // not offered when nothing registered supports it
  });

  it("a goal chip, a task chip and free text all start the same session, each with its entry mode, and report it", async () => {
    answer = starts(session());
    mountLauncher();
    await click(screen.getByRole("button", { name: "I need funding" }));
    await click(screen.getByRole("button", { name: "Change goal" }));
    await click(screen.getByRole("button", { name: "Create Invoice" }));
    await click(screen.getByRole("button", { name: "Change goal" }));
    fireEvent.change(screen.getByLabelText(PROMPT), { target: { value: "I need more customers" } });
    await click(screen.getByRole("button", { name: "Start" }));
    expect(posts(/\/task-sessions$/).map((c) => c.body)).toEqual([
      { key: "need_funding", entry_mode: "business_goal" }, { key: "create_invoice", entry_mode: "quick_task" }, { text: "I need more customers", entry_mode: "free_text" }]);
    // The funnel is told which way in was used and which suggestion, never the words that were typed.
    expect(events().filter((e) => e.name === "entry_mode_selected")).toEqual([
      { name: "entry_mode_selected", entry_mode: "business_goal", key: "need_funding" }, { name: "entry_mode_selected", entry_mode: "quick_task", key: "create_invoice" },
      { name: "entry_mode_selected", entry_mode: "free_text" }]);
    expect(JSON.stringify(events())).not.toContain("more customers");
  });

});

describe("the task card", () => {
  it("opens beside the launcher, which stays in view: the goal, 'Change goal', one line of promise, a credits badge, the limit and the numbered path", async () => {
    answer = starts(funding({ resolution: { ...funding().resolution, credit_badge: "Free" } }));
    mountLauncher();
    await click(screen.getByRole("button", { name: "I need funding" }));
    const panel = card();
    expect(panel.getAttribute("data-placement")).toBe("inline");
    expect(panel.querySelector("[data-chosen]").textContent).toBe("I need funding");
    // The launcher is still there, so another goal is one tap away, and the one in hand is marked.
    expect(screen.getByLabelText(PROMPT)).toBeTruthy();
    expect(screen.getByRole("button", { name: "I need funding" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "I need more customers" }).getAttribute("aria-pressed")).toBe("false");
    expect(panel.querySelector("[data-says]").textContent).toMatch(/^I can help you become more funding-ready/);
    expect(panel.querySelector("[data-credit-badge]").textContent).toBe("Free");
    const limit = within(panel).getByRole("note");
    expect(limit.textContent).toBe("I can't guarantee funding, or a yes from any investor or lender.");
    expect(limit.querySelector("svg")).toBeTruthy();                       // a note with an icon, not a line of body text
    expect([...panel.querySelectorAll("[data-path] ol > li")].map((li) => li.textContent)).toEqual(["1Funding Readiness", "2Funding Pack Draft", "3Business Plan Draft"]);      // numbered, in order
    expect(panel.querySelector("[data-checkpoint]")).toBeNull();           // no email asked for before there is something to save
    // The body scrolls inside the card; the footer (Continue, Start again) stays put.
    expect(panel.querySelector("[data-task-body]").className).toContain("overflow-y-auto");
    const footer = panel.querySelector("[data-task-footer]");
    expect(footer.className).toContain("shrink-0");
    expect(footer.className).toContain("safe-area-inset-bottom");          // clear of a phone's home bar
    expect(within(footer).getByRole("button", { name: "Continue" }).className).toContain("bg-[#1F5BFF]");
    expect(within(footer).getByRole("button", { name: "Start again" }).className).not.toContain("bg-");
    const change = within(panel).getByRole("button", { name: "Change goal" });
    expect(change.className).toContain("text-[12px]");                     // a small text link, not a button competing with Continue
    await click(change);
    expect(screen.queryByRole("region", { name: "Your task" })).toBeNull();
    expect(localStorage.getItem("ea_task_session:anon")).toBeNull();
  });

  it("asks with a £ sign, quick amounts and nothing preselected, then shows what was given and asks for an email to continue", async () => {
    const given = [{ key: "amount", label: "How much funding are you looking for?", value: "£50,000", proposed: false }, { key: "stage", label: "Where is the business now?", value: "Trading", proposed: false }];
    answer = (path, method) => (method === "POST" && /task-sessions$/.test(path) ? funding()
      : /\/inputs$/.test(path) ? funding({ state: "awaiting_identity", next: "identity", missing: [], inputs: { amount: 50000, stage: "trading" }, summary: given }) : undefined);
    mountLauncher();
    await click(screen.getByRole("button", { name: "I need funding" }));
    const amount = within(card()).getByLabelText("How much funding are you looking for?");
    expect(amount.parentElement.querySelector("[data-currency]").textContent).toBe("£");
    expect(amount.className).toMatch(/\btext-base\b.*\bmd:text-sm\b/);
    expect(card().querySelector("[data-fields]").className).toContain("sm:grid-cols-2");
    expect(within(card()).getAllByRole("radio").every((r) => !r.checked)).toBe(true);
    await click(within(card()).getByRole("button", { name: "Continue" }));
    expect(within(card()).getByRole("alert").textContent).toBe("How much funding are you looking for? is required.");
    await click(within(card()).getByRole("button", { name: "£50,000" }));
    expect(amount.value).toBe("50000");
    await click(within(card()).getByRole("button", { name: "Continue" }));
    expect(within(card()).getByRole("alert").textContent).toBe("Where is the business now? is required.");
    fireEvent.click(within(card()).getByLabelText("Trading"));
    await click(within(card()).getByRole("button", { name: "Continue" }));
    expect(posts(/\/task-sessions\/sess-1\/inputs$/)[0].body).toEqual({ answers: { amount: 50000, stage: "trading" } });
    expect(card().querySelector("[data-chosen]").textContent).toBe("I need funding");
    expect(within(card()).getByText("What you told me")).toBeTruthy();
    expect([...card().querySelectorAll("[data-said-chip]")].map((c) => c.textContent)).toEqual(["£50,000", "Trading"]);
    const checkpoint = card().querySelector("[data-checkpoint]");
    expect(checkpoint.textContent).toContain("To continue, verify your email.");
    expect(checkpoint.querySelector("[data-saved]")).toBeNull();
    expect(checkpoint.querySelector("[data-retention]").textContent).toBe("Kept for 7 days, and picked up as soon as you're in.");
    expect(localStorage.getItem("ea_task_session:anon")).toBe("sess-1");
    const email = within(checkpoint).getByLabelText("Your email address");
    expect(email.className).toContain("w-full");
    expect(within(checkpoint).getByText("We'll email you a 6-digit code. No password needed.")).toBeTruthy();
    const name = within(checkpoint).getByLabelText("Your name");
    expect(name.getAttribute("autocomplete")).toBe("name");
    expect(name.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await click(within(card()).getByRole("button", { name: "Continue" }));
    expect(within(card()).getByRole("alert").textContent).toBe("Enter your name.");
    fireEvent.change(name, { target: { value: "Hilary O" } });
    await click(within(card()).getByRole("button", { name: "Continue" }));
    expect(within(card()).getByRole("alert").textContent).toBe("Enter your email address to continue.");
    expect(posts(/\/email$/)).toEqual([]);
    expect(screen.queryByTestId("where")).toBeNull();
  });

  describe("verifying the email in place", () => {
    const given = [{ key: "customer", label: "Who is it for?", value: "Mark", proposed: false }, { key: "amount", label: "How much?", value: "$300", proposed: false }, { key: "currency", label: "Currency", value: "USD", proposed: false }];
    const atCheckpoint = (over = {}) => session({ state: "awaiting_identity", next: "identity", missing: [], summary: given, currency: "USD", saving: "Create Invoice for Mark · $300 · USD", verification: null, ...over });
    const codeOut = (masked = "h•••@gmail.com", google = false) => atCheckpoint({ verification: { sent: true, masked, expires_at: "2099-01-01T00:00:00Z", google } });
    const everyUrl = () => [...calls.map((c) => c.path), screen.queryByTestId("where")?.textContent || "", window.location.href].join(" ");

    it("sends a code, asks for it in the same card, and carries on signed in: no login page, and the address never in a link", async () => {
      let state = atCheckpoint();
      answer = (path, method, body) => (method === "POST" && /task-sessions$/.test(path) ? state
        : /\/email$/.test(path) ? (state = codeOut("h•••@example.test"))
        : /\/verify$/.test(path) ? (body.code === "482913" ? { access_token: "tok-1", email: "hilary@example.test", new_account: true, session: atCheckpoint({ authenticated: true }) } : { __status: 400, __body: { detail: "That code isn't right. Check the email and try again." } })
        : undefined);
      mountLauncher();
      await click(screen.getByRole("button", { name: "Create Invoice" }));
      fireEvent.change(within(card()).getByLabelText("Your name"), { target: { value: "  Hilary  O " } });
      fireEvent.change(within(card()).getByLabelText("Your email address"), { target: { value: "Hilary@Example.test" } });
      await click(within(card()).getByRole("button", { name: "Continue" }));
      expect(posts(/\/task-sessions\/sess-1\/email$/)[0].body).toEqual({ email: "Hilary@Example.test", name: "Hilary O", marketing_consent: false });
      expect(screen.queryByTestId("where")).toBeNull();
      const checkpoint = card().querySelector("[data-checkpoint]");
      expect(checkpoint.textContent).toContain("We sent a code to h•••@example.test.");
      expect(within(checkpoint).queryByLabelText("Your email address")).toBeNull();
      const code = within(checkpoint).getByLabelText("6-digit code");
      expect(code.getAttribute("inputmode")).toBe("numeric");
      expect(code.getAttribute("autocomplete")).toBe("one-time-code");
      expect(card().querySelector("[data-chosen]").textContent).toBe("Create Invoice");
      expect([...card().querySelectorAll("[data-said-chip]")].map((c) => c.textContent)).toEqual(["Mark", "$300", "USD"]);
      await click(within(card()).getByRole("button", { name: "Continue" }));
      expect(within(card()).getByRole("alert").textContent).toBe("Enter the 6-digit code from the email.");
      fireEvent.change(code, { target: { value: "000000" } });
      await click(within(card()).getByRole("button", { name: "Continue" }));
      expect(within(card()).getByRole("alert").textContent).toBe("That code isn't right. Check the email and try again.");
      expect(card().querySelector("[data-chosen]").textContent).toBe("Create Invoice");
      expect(localStorage.getItem("ea_token")).toBeNull();
      await click(within(card()).getByRole("button", { name: "Resend code" }));
      expect(posts(/\/email$/)[1].body).toEqual({});
      expect(within(card()).getByRole("status").textContent).toBe("A new code is on its way. The last one no longer works.");
      fireEvent.change(within(card()).getByLabelText("6-digit code"), { target: { value: "482 913" } });
      await click(within(card()).getByRole("button", { name: "Continue" }));
      expect(posts(/\/verify$/).pop().body.code).toBe("482913");
      await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/start/sess-1"));
      expect(localStorage.getItem("ea_token")).toBe("tok-1");
      expect(useAuthStore.getState().token).toBe("tok-1");
      expect(everyUrl().toLowerCase()).not.toMatch(/hilary|example\.test|%40|email=/);
      expect(everyUrl()).not.toContain("/login");
    });

    it("keeps the verification step after a refresh in the middle, and picks up the next email", async () => {
      localStorage.setItem("ea_task_session:anon", "sess-1");
      answer = (path, method) => (method === "GET" && /task-sessions\/sess-1$/.test(path) ? codeOut() : /\/email$/.test(path) ? codeOut("o•••@example.test") : undefined);
      mountLauncher();
      const panel = await screen.findByRole("region", { name: "Your task" });
      expect(panel.querySelector("[data-checkpoint]").textContent).toContain("We sent a code to h•••@gmail.com.");
      expect(within(panel).getByLabelText("6-digit code")).toBeTruthy();
      expect([...panel.querySelectorAll("[data-said-chip]")].map((c) => c.textContent)).toEqual(["Mark", "$300", "USD"]);
      await click(within(panel).getByRole("button", { name: "Change email" }));
      expect(within(card()).queryByLabelText("6-digit code")).toBeNull();
      fireEvent.change(within(card()).getByLabelText("Your name"), { target: { value: "Other Person" } });
      fireEvent.change(within(card()).getByLabelText("Your email address"), { target: { value: "other@example.test" } });
      await click(within(card()).getByRole("button", { name: "Continue" }));
      expect(posts(/\/email$/)[0].body).toEqual({ email: "other@example.test", name: "Other Person", marketing_consent: false });
      expect(card().querySelector("[data-checkpoint]").textContent).toContain("We sent a code to o•••@example.test.");
    });

    it("a Google address is offered Continue with Google first, and it lands on the task too", async () => {
      vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "client-id");
      let state = atCheckpoint();
      answer = (path, method) => (method === "POST" && /task-sessions$/.test(path) ? state : /\/email$/.test(path) ? (state = codeOut("h•••@gmail.com", true))
        : /\/auth\/google$/.test(path) ? { access_token: "tok-google" } : /\/auth\/me$/.test(path) ? { email: "hilary@gmail.com" } : undefined);
      mountLauncher();
      await click(screen.getByRole("button", { name: "Create Invoice" }));
      expect(card().querySelector("[data-google]")).toBeTruthy();
      fireEvent.change(within(card()).getByLabelText("Your name"), { target: { value: "Hilary O" } });
      fireEvent.change(within(card()).getByLabelText("Your email address"), { target: { value: "hilary@gmail.com" } });
      await click(within(card()).getByRole("button", { name: "Continue" }));
      const first = card().querySelector("[data-google-first]");
      expect(first.compareDocumentPosition(within(card()).getByLabelText("6-digit code")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(first.textContent).toContain("or enter the code we emailed you");
      await click(within(first).getByRole("button", { name: "Continue with Google" }));
      expect(posts(/\/auth\/google$/)[0].body.credential).toBe("google-credential");
      await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/start/sess-1"));
      expect(localStorage.getItem("ea_token")).toBe("tok-google");
    });

    it("someone who prefers their password goes to the sign-in page with only where to come back to", async () => {
      answer = starts(atCheckpoint());
      mountLauncher();
      await click(screen.getByRole("button", { name: "Create Invoice" }));
      fireEvent.change(within(card()).getByLabelText("Your email address"), { target: { value: "hilary@example.test" } });
      await click(within(card()).getByRole("button", { name: "Sign in with a password" }));
      expect(screen.getByTestId("where").textContent).toBe("/login?next=%2Fstart%2Fsess-1");
    });
  });

  it("a vague ask gets one question answered with a tap, and 'Something else' is not a dead end", async () => {
    const unsure = session({ goal_key: null, goal_label: "help me with money", entry_mode: "free_text", next: "clarify", questions: [], missing: [],
      resolution: { original_goal: "help me with money", resolution_class: "clarify", message: "I can help with that in more than one way. Which is closest to what you need?", execution_boundary: "", recommended_path: [], credit_implication: "" },
      clarify: { key: "goal_key", label: "Which is closest?", type: "choice", required: true,
        options: [{ value: "cash_flow", label: "Improve cash flow" }, { value: "need_funding", label: "Get funding-ready" }, { value: "price_offer", label: "Price my product" }, { value: "other", label: "Something else" }] } });
    let picked = funding({ resolution: { ...funding().resolution, original_goal: "help me with money" } });
    answer = (path, method) => (method === "POST" && /task-sessions$/.test(path) ? unsure : /\/inputs$/.test(path) ? picked : undefined);
    mountLauncher();
    fireEvent.change(screen.getByLabelText(PROMPT), { target: { value: "help me with money" } });
    await click(screen.getByRole("button", { name: "Start" }));
    expect(card().querySelector("[data-chosen]").textContent).toBe("help me with money");
    const chips = within(within(card()).getByRole("group", { name: "Which is closest?" })).getAllByRole("button");
    expect(chips.map((b) => b.textContent)).toEqual(["Improve cash flow", "Get funding-ready", "Price my product", "Something else"]);
    expect(within(card()).queryAllByRole("radio")).toEqual([]);
    expect(card().querySelector("[data-checkpoint]")).toBeNull();
    expect(within(card().querySelector("[data-task-footer]")).queryByRole("button", { name: "Continue" })).toBeNull();
    await click(chips[1]);
    expect(posts(/\/inputs$/)[0].body).toEqual({ answers: { goal_key: "need_funding" } });
    expect(card().querySelector("[data-chosen]").textContent).toBe("I need funding");
    expect(within(card()).getByText("You asked: help me with money")).toBeTruthy();
    await click(within(card()).getByRole("button", { name: "Start again" }));
    picked = session({ state: "blocked", next: "none", questions: [], goal_key: null, goal_label: null,
      resolution: { original_goal: "help me with money", resolution_class: "no_match", message: "No problem. Tell me in a few words what you want done, or pick one of the suggestions.", execution_boundary: "", recommended_path: [] } });
    fireEvent.change(screen.getByLabelText(PROMPT), { target: { value: "help me with money" } });
    await click(screen.getByRole("button", { name: "Start" }));
    await click(within(card()).getByRole("button", { name: "Something else" }));
    expect(within(card()).getByText(/^No problem\./)).toBeTruthy();
    expect(card().querySelector("[data-checkpoint]")).toBeNull();
    await click(within(card()).getAllByRole("button", { name: "Ask for something else" })[0]);
    expect(screen.queryByRole("region", { name: "Your task" })).toBeNull();
    expect(screen.getByLabelText(PROMPT)).toBeTruthy();
  });


  it("a no-match says so without asking for an account", async () => {
    answer = starts(session({ state: "blocked", next: "none", questions: [], goal_key: null, goal_label: null, entry_mode: "free_text",
      resolution: { original_goal: "book me a flight", resolution_class: "no_match", message: "EnterprateAI doesn't do that at the moment, so I won't pretend it can.", execution_boundary: "", recommended_path: [] } }));
    mountLauncher();
    fireEvent.change(screen.getByLabelText(PROMPT), { target: { value: "book me a flight" } });
    await click(screen.getByRole("button", { name: "Start" }));
    expect(within(card()).getByText(/doesn't do that at the moment/)).toBeTruthy();
    expect(card().querySelector("[data-checkpoint]")).toBeNull();           // no sign-up forced for something it can't do
    expect(card().querySelector("[data-clarify]")).toBeNull();
    expect(within(card()).queryByRole("button", { name: /continue/i })).toBeNull();
    expect(within(card()).getAllByRole("button", { name: "Ask for something else" }).length).toBeGreaterThan(0);
  });
});

describe("the hero", () => {
  const hero = () => document.querySelector("#hero");

  it("is two columns from 1024px: the copy, launcher card, buttons and ticks on the left, the product preview on the right", () => {
    render(<MemoryRouter><LandingPage /></MemoryRouter>);
    const grid = hero().querySelector("[data-hero-grid]");
    for (const cls of ["lg:grid-cols-[minmax(0,60fr)_minmax(0,40fr)]", "xl:grid-cols-[minmax(0,55fr)_minmax(0,45fr)]", "items-start"]) expect(grid.className).toContain(cls);      // one column below 1024px
    expect([...grid.children].map((c) => (c.hasAttribute("data-hero-copy") ? "copy" : c.hasAttribute("data-hero-right") ? "right" : "?"))).toEqual(["copy", "right"]);
    const copy = grid.querySelector("[data-hero-copy]");
    expect(copy.className).toContain("lg:text-left");
    // Left column, in order: eyebrow, headline, supporting line, launcher card, buttons, ticks.
    const order = [within(copy).getByText("AI-Native Business Decision Intelligence"), within(copy).getByRole("heading", { level: 1 }),
      within(copy).getByText("Plan, operate, sell and grow from one intelligent business workspace."), copy.querySelector("[data-goal-launcher]")];
    for (let i = 1; i < order.length; i += 1) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const h1 = within(copy).getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Build a More ResilientBusiness with Intelligence.");
    expect(h1.className).toMatch(/\btext-3xl\b/);                           // 30px on a phone (never above 32px below 768px)
    expect(h1.className).not.toMatch(/\bsm:text-4xl\b/);
    expect(within(copy).getByText("Intelligence.").className).toContain("bg-gradient-to-r");
    expect(within(copy).queryByText(/EnterprateAI gives startups and small businesses/)).toBeNull();      // the long description is out of the hero, so the launcher sits high
    const launcher = copy.querySelector("[data-goal-launcher]");
    expect(launcher.className).toContain("w-full");
    expect(within(launcher).getByLabelText(PROMPT).className).toContain("text-base");      // 16px at every width
    expect(within(launcher).getByRole("group", { name: "Popular business goals" })).toBeTruthy();
    expect(within(launcher).getByRole("group", { name: "Or start a task" })).toBeTruthy();
    // No separate link or button under the launcher: "Watch it work" is in the card's bottom row, beside the trust line.
    expect(copy.querySelector("[data-hero-buttons]")).toBeNull();
    expect(within(copy).queryByRole("link", { name: "See How It Works" })).toBeNull();
    expect(within(copy).queryByText(/first business insight/)).toBeNull();
    const foot = launcher.querySelector("[data-launcher-foot]");
    expect(foot.className).toMatch(/\bflex-col\b.*\bsm:flex-row\b/);      // stacked on a phone
    const watch = within(foot).getByRole("button", { name: "Watch a 30 second demo of the Agent" });
    expect(watch.textContent).toBe("Watch it work · 30s");
    for (const cls of ["h-9", "w-full", "sm:w-auto", "text-brand-700"]) expect(watch.className.split(" ")).toContain(cls);      // 36px tall; full width on a phone
    expect(watch.querySelector(".m-pulse-ring svg")).toBeTruthy();
    for (const tick of ["No credit card required", "Start in minutes", "Private & secure"]) expect(within(copy).queryByText(tick)).toBeNull();
    // Right column: the mock with its handwriting; below the copy at 80% on a tablet; not on a phone.
    const preview = grid.querySelector("[data-hero-right] [data-hero-preview]");
    for (const cls of ["hidden", "md:flex", "w-4/5", "lg:w-full", "isolate"]) expect(preview.className).toContain(cls);
    expect(preview.className).not.toContain("lg:invisible");
    expect(preview.querySelector("[data-mock-greeting]").textContent).toMatch(/^Good (morning|afternoon|evening)$/);      // the time of day, and no name
    expect(preview.textContent).toContain("Here's what your Agent did today.");
    expect(preview.textContent).not.toMatch(/Jordan/);
    expect([greetingAt(4), greetingAt(5), greetingAt(11), greetingAt(12), greetingAt(16), greetingAt(17), greetingAt(23)]).toEqual(
      ["Good evening", "Good morning", "Good morning", "Good afternoon", "Good afternoon", "Good evening", "Good evening"]);
    expect(preview.textContent).toContain("Smarter");
    expect(preview.querySelector("[data-hero-dots]").className).toContain("lg:hidden");      // on a tablet the dot grid travels with the image
    expect(preview.querySelector("[data-hero-dots]").nextElementSibling.className).toContain("lg:rotate-1");
    expect(hero().querySelector("[data-task-card]")).toBeNull();
    // The menu button sits at the far right of the bar when the links are folded into it (below 1280px).
    const right = document.querySelector("[data-nav-right]");
    for (const cls of ["ml-auto", "xl:ml-6"]) expect(right.className.split(" ")).toContain(cls);
    expect(within(right).getByRole("button", { name: "Menu" }).className).toContain("xl:hidden");
  });

  it("a goal opens in the right column in the preview's place (a sheet on a phone, under the launcher on a tablet), and nothing on the left moves", async () => {
    answer = starts(funding({ resolution: { ...funding().resolution, credit_badge: "Free" } }));
    render(<MemoryRouter><LandingPage /></MemoryRouter>);
    const copy = hero().querySelector("[data-hero-copy]");
    const launcher = copy.querySelector("[data-goal-launcher]");
    const preview = hero().querySelector("[data-hero-preview]");
    await click(within(launcher).getByRole("button", { name: "I need funding" }));
    const cards = [...hero().querySelectorAll("[data-task-card]")];
    expect(cards.map((c) => c.getAttribute("data-placement"))).toEqual(["below", "column"]);
    const [below, column] = cards;
    // From 1024px: in the right column, laid over the preview's space, never taller than it, scrolling inside.
    expect(hero().querySelector("[data-hero-right]").contains(column)).toBe(true);
    expect(launcher.contains(column)).toBe(false);
    for (const cls of ["lg:absolute", "lg:flex", "lg:top-10", "lg:max-h-[calc(100%-2.5rem)]", "lg:rounded-2xl", "lg:shadow-2xl"]) expect(column.className).toContain(cls);
    expect(column.className).not.toMatch(/rotate/);                         // no tilt on the card
    expect(preview.className).toContain("lg:invisible");                    // the preview keeps its space, so the hero's height does not change
    expect(hero().querySelector("[data-hero-right]").className).toContain("lg:self-stretch");
    // Under 768px: a full-screen sheet that slides up (unless reduced motion is asked for), with a close button.
    for (const cls of ["max-md:fixed", "max-md:inset-0", "max-md:flex", "max-md:motion-safe:animate-[ea-sheet-up_.22s_ease-out]", "md:hidden"]) expect(column.className).toContain(cls);
    // 768 to 1023px: directly under the launcher card, full width.
    for (const cls of ["hidden", "md:flex", "lg:hidden", "scroll-mt-20"]) expect(below.className).toContain(cls);
    expect(launcher.compareDocumentPosition(below) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The left column is as it was: the same launcher, with its suggestions, and the same buttons.
    expect(copy.querySelector("[data-goal-launcher]")).toBe(launcher);
    expect(within(launcher).getByLabelText(PROMPT)).toBeTruthy();
    expect(within(launcher).getAllByRole("button", { name: /./ }).length).toBe(9);      // Start, three goals, four tasks, Watch it work
    expect(within(launcher).getByRole("button", { name: "I need funding" }).getAttribute("aria-pressed")).toBe("true");
    expect(launcher.querySelector("[data-task-card]")).toBeNull();
    expect(copy.querySelector("[data-hero-buttons]")).toBeNull();      // no separate row of buttons under the launcher
    // The two cards never share an input id.
    expect(within(column).getByLabelText("How much funding are you looking for?").id).toBe("goal-field-column-amount");
    expect(within(below).getByLabelText("How much funding are you looking for?").id).toBe("goal-field-below-amount");
    // Closing the sheet keeps the task: the launcher offers the way back to it.
    const close = within(column).getByRole("button", { name: "Close (your task is kept)" });
    expect(close.className).toMatch(/\bh-11\b.*\bw-11\b/);                  // a 44px target
    expect(close.className).toContain("md:hidden");
    expect(within(below).queryByRole("button", { name: "Close (your task is kept)" })).toBeNull();
    await click(close);
    expect(column.className).toContain("max-md:hidden");
    expect(localStorage.getItem("ea_task_session:anon")).toBe("sess-1");
    const resume = launcher.querySelector("[data-resume]");
    expect(resume.textContent).toBe("Carry on: I need fundingOpen");
    await click(resume);
    expect(column.className).toContain("max-md:flex");
    expect(launcher.querySelector("[data-resume]")).toBeNull();
    // Another goal is one tap away without closing anything.
    await click(within(launcher).getByRole("button", { name: "Create Invoice" }));
    expect(posts(/\/task-sessions$/).map((c) => c.body.key)).toEqual(["need_funding", "create_invoice"]);
  });
});

describe("questions", () => {
  it("an amount carries its currency sign, and a common amount is one tap", () => {
    const onSubmit = vi.fn();
    render(<QuestionForm fields={[FUNDING_QUESTIONS[0], { key: "use", label: "What will the money be used for?", type: "text", required: false, default: "" }]} onSubmit={onSubmit} />);
    const amount = screen.getByLabelText("How much funding are you looking for?");
    expect(amount.parentElement.querySelector("[data-currency]").textContent).toBe("£");
    expect(amount.className).toContain("pl-7");                             // the figure starts after the sign
    expect(screen.getByLabelText("What will the money be used for?").parentElement.querySelector("[data-currency]")).toBeNull();
    const chip = screen.getByRole("button", { name: "£25,000" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(amount.value).toBe("25000");
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSubmit).toHaveBeenCalledWith({ amount: 25000 });
  });
});

describe("carrying on after sign-in", () => {
  // /start is the app's outline (a new account has no workspace to show); /resume is the same page inside the real app, stood in for here by a marked frame.
  const mount = (path = "/start/sess-1") => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/start/:sessionId" element={<StartPage />} />
    <Route path="/resume/:sessionId" element={<div data-real-app><StartPage framed /></div>} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
  const states = (c) => Object.fromEntries([...c.querySelectorAll("[data-progress] [data-step]")].map((li) => [li.getAttribute("data-step"), li.getAttribute("data-state")]));
describe("carrying on after sign-in", () => {
  // /start is the app's outline (a new account has no workspace to show); /resume is the same page inside the real app, stood in for here by a marked frame.
  const mount = (path = "/start/sess-1") => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/start/:sessionId" element={<StartPage />} />
    <Route path="/resume/:sessionId" element={<div data-real-app><StartPage framed /></div>} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
  const states = (c) => Object.fromEntries([...c.querySelectorAll("[data-progress] [data-step]")].map((li) => [li.getAttribute("data-step"), li.getAttribute("data-state")]));

  it("a new account is asked only what the business is called, inside the app's frame with its progress, then lands on the dashboard with the task on it", async () => {
    answer = (path, method) => (/attach-user$/.test(path) ? session({ authenticated: true, state: "resuming", next: "prepare", missing: [] })
      : /validation/me/.test(path) ? { __status: 404, __body: { detail: "none" } }
      : //resume$/.test(path) ? session({ authenticated: true, state: "ready_to_prepare", next: "prepare", missing: [], business_id: "biz-9" })
      : //prepare$/.test(path) ? session({ authenticated: true, state: "awaiting_review", next: "handoff", missing: [], business_id: "biz-9", handoff: { to: "/dashboard?task=run-7", run_id: "run-7" } })
      : method === "GET" ? {} : undefined);
    const { container } = mount();
    expect(container.querySelector("[data-shell-skeleton] aside")).toBeTruthy();
    expect(await screen.findByText("You're in. One thing before I carry on.")).toBeTruthy();
    expect(container.querySelector("[data-goal-kept]").textContent).toBe("Create Invoice");
    expect([...container.querySelectorAll("[data-progress] [data-step]")].map((li) => li.textContent.replace(/(.*)$/, "").replace(/^d/, "")))
      .toEqual(["Email confirmed", "Getting your business ready", "Preparing your invoice"]);
    expect(states(container)).toEqual({ saved: "done", workspace: "active", prepare: "todo" });
    expect(container.querySelector("[data-step='workspace']").getAttribute("aria-current")).toBe("step");
    fireEvent.change(screen.getByLabelText(/What is your business called?/), { target: { value: "Newcomer Studio" } });
    await click(screen.getByRole("button", { name: "Continue" }));
    expect(posts(//resume$/)[0].body).toEqual({ business_name: "Newcomer Studio" });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/dashboard?task=run-7"));
    expect(useWorkspaceStore.getState().workspaceId).toBe("biz-9");
    expect(localStorage.getItem("ea_task_session:anon")).toBeNull();
    expect(events()).toEqual([{ name: "dashboard_handoff_completed", session_id: "sess-1" }]);
  });

  it("someone with a workspace carries on inside the real app, and the last step is named for the work being done", async () => {
    let letPrepare;
    answer = (path) => (/attach-user$/.test(path) ? funding({ authenticated: true, next: "prepare", missing: [], business_id: "biz-1" })
      : //resume$/.test(path) ? funding({ authenticated: true, next: "prepare", missing: [], business_id: "biz-1" }) : {});
    const real = globalThis.fetch;
    globalThis.fetch = vi.fn((url, init) => (/prepare$/.test(String(url)) ? new Promise((resolve) => { letPrepare = () => resolve(new Response(JSON.stringify(
      funding({ authenticated: true, next: "handoff", missing: [], business_id: "biz-1", handoff: { to: "/funding/f1?tab=results", message: "I set up your funding case." } })), { status: 200 })); }) : real(url, init)));
    const { container } = mount();
    await waitFor(() => expect(states(container)).toEqual({ saved: "done", workspace: "done", prepare: "active" }));
    expect(container.querySelector("[data-real-app]")).toBeTruthy();
    expect(container.querySelector("[data-shell-skeleton]")).toBeNull();
    expect(useWorkspaceStore.getState().workspaceId).toBe("biz-1");
    expect(container.querySelector("[data-step='workspace']").textContent).toContain("Business ready");
    expect(container.querySelector("[data-step='prepare']").textContent).toContain("Checking your funding readiness…");
    expect(container.querySelector("[data-step='prepare']").textContent).not.toContain("I need funding");
    expect(screen.getByText("Your dashboard opens as soon as there is something to show you.")).toBeTruthy();
    await act(async () => { letPrepare(); });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/funding/f1?tab=results"));
  });
  it("a funding case already on record: asks whether to update it or start a new one, and creates nothing until told", async () => {
    const choose = { key: "subject_choice", label: "You already have a funding case. Update it or start a new one?", type: "choice", required: true,
      options: [{ value: "f1", label: "Update QA Seed round (amount £120,000 → £50,000)" }, { value: "new", label: "Start a new case" }] };
    let chosen = false;
    answer = (path) => (/attach-user$/.test(path) ? funding({ authenticated: true, next: "prepare", missing: [], business_id: "biz-1" })
      : //resume$/.test(path) ? funding({ authenticated: true, next: "prepare", missing: [], business_id: "biz-1" })
      : //inputs$/.test(path) ? ((chosen = true), funding({ authenticated: true, next: "prepare", missing: [], business_id: "biz-1" }))
      : //prepare$/.test(path) ? (chosen ? funding({ authenticated: true, state: "handed_off", next: "handoff", missing: [], business_id: "biz-1", handoff: { to: "/funding/f1?tab=results", message: "I updated "QA Seed round"." } })
        : funding({ authenticated: true, state: "collecting_required_data", next: "choose", missing: [], business_id: "biz-1", choose })) : {});
    const { container } = mount("/start/sess-1?workspace=biz-1");
    const group = await screen.findByRole("group", { name: choose.label });
    expect(posts(//resume$/)[0].body).toEqual({ business_id: "biz-1" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["Update QA Seed round (amount £120,000 → £50,000)", "Start a new case"]);
    expect(states(container).prepare).toBe("active");
    expect(screen.queryByTestId("where")).toBeNull();
    await click(within(group).getByRole("button", { name: /^Update QA Seed round/ }));
    expect(posts(//inputs$/)[0].body).toEqual({ answers: { subject_choice: "f1" } });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/funding/f1?tab=results"));
  });

  it("a task the plan does not include is said plainly, with the way to plans: never a bare dashboard", async () => {
    const refusal = { to: "/dashboard", capability: "new_proposal", blocked: true, upgrade: true, message: "Upgrade to use the Agent for this. New Proposal is included from the Starter plan." };
    answer = (path) => (/attach-user$/.test(path) ? session({ authenticated: true, next: "prepare", missing: [], business_id: "biz-1" })
      : //resume$/.test(path) ? session({ authenticated: true, next: "prepare", missing: [], business_id: "biz-1" })
      : //prepare$/.test(path) ? session({ authenticated: true, state: "blocked", next: "handoff", missing: [], business_id: "biz-1", handoff: refusal }) : {});
    mount();
    const said = await screen.findByRole("alert");
    expect(said.textContent).toContain("I couldn't prepare that for you.");
    expect(said.textContent).toContain("Upgrade to use the Agent for this. New Proposal is included from the Starter plan.");
    expect(said.textContent).toContain("What you told me is saved. Nothing was created or sent, and no AI Credits were used.");
    expect(screen.queryByTestId("where")).toBeNull();
    expect(within(said).getByRole("button", { name: "Go to the dashboard" })).toBeTruthy();
    await click(within(said).getByRole("button", { name: "See plans" }));
    expect(screen.getByTestId("where").textContent).toBe("/pricing");
  });

  it("a task that was refused before is tried again when the page is opened again", async () => {
    const refusal = { to: "/dashboard", blocked: true, upgrade: true, message: "Upgrade to use the Agent for this." };
    answer = (path) => (/attach-user$/.test(path) ? session({ authenticated: true, state: "blocked", next: "handoff", missing: [], business_id: "biz-1", handoff: refusal })
      : //resume$/.test(path) ? session({ authenticated: true, next: "prepare", missing: [], business_id: "biz-1" })
      : //prepare$/.test(path) ? session({ authenticated: true, next: "handoff", missing: [], business_id: "biz-1", handoff: { to: "/dashboard?task=run-7", run_id: "run-7" } }) : {});
    mount();
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/dashboard?task=run-7"));
    expect(posts(//prepare$/).length).toBe(1);
  });

  it("a failure keeps the task and offers another go; an expired task says so", async () => {
    let fail = true;
    answer = (path) => (/attach-user$/.test(path) ? session({ authenticated: true, next: "prepare", missing: [], business_id: "biz-1" })
      : /validation/me/.test(path) ? { id: "biz-1" } : //resume$/.test(path) ? session({ authenticated: true, next: "prepare", missing: [], business_id: "biz-1" })
      : //prepare$/.test(path) ? (fail ? session({ authenticated: true, state: "ready_to_prepare", next: "prepare", missing: [], business_id: "biz-1", problem: "That couldn't be prepared just now. Nothing was lost; try again." })
        : session({ authenticated: true, next: "handoff", missing: [], business_id: "biz-1", handoff: { to: "/dashboard?task=run-7" } })) : {});
    const view = mount();
    expect((await screen.findByRole("alert")).textContent).toContain("Nothing was lost");
    fail = false;
    await click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/dashboard?task=run-7"));
    view.unmount();
    answer = (path) => (/attach-user$/.test(path) ? { __status: 404, __body: { detail: "expired" } } : {});
    mount();
    expect(await screen.findByText("That task has expired.")).toBeTruthy();
  });
});
      : /\/resume$/.test(path) ? funding({ authenticated: true, next: "prepare", missing: [], business_id: "biz-1" })
      : /\/inputs$/.test(path) ? ((chosen = true), funding({ authenticated: true, next: "prepare", missing: [], business_id: "biz-1" }))
      : /\/prepare$/.test(path) ? (chosen ? funding({ authenticated: true, state: "handed_off", next: "handoff", missing: [], business_id: "biz-1", handoff: { to: "/funding/f1?tab=results", message: "I updated \"QA Seed round\"." } })
        : funding({ authenticated: true, state: "collecting_required_data", next: "choose", missing: [], business_id: "biz-1", choose })) : {});
    const { container } = mount("/start/sess-1?workspace=biz-1");
    const group = await screen.findByRole("group", { name: choose.label });
    expect(posts(/\/resume$/)[0].body).toEqual({ business_id: "biz-1" });   // the workspace picked on the homepage
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["Update QA Seed round (amount £120,000 → £50,000)", "Start a new case"]);
    expect(states(container).prepare).toBe("active");
    expect(screen.queryByTestId("where")).toBeNull();                       // nothing happens until they choose
    await click(within(group).getByRole("button", { name: /^Update QA Seed round/ }));
    expect(posts(/\/inputs$/)[0].body).toEqual({ answers: { subject_choice: "f1" } });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/funding/f1?tab=results"));
  });

  it("a task the plan does not include is said plainly, with the way to plans: never a bare dashboard", async () => {
    const refusal = { to: "/dashboard", capability: "new_proposal", blocked: true, upgrade: true, message: "Upgrade to use the Agent for this. New Proposal is included from the Starter plan." };
    answer = (path) => (/attach-user$/.test(path) ? session({ authenticated: true, next: "prepare", missing: [], business_id: "biz-1" })
      : /\/resume$/.test(path) ? session({ authenticated: true, next: "prepare", missing: [], business_id: "biz-1" })
      : /\/prepare$/.test(path) ? session({ authenticated: true, state: "blocked", next: "handoff", missing: [], business_id: "biz-1", handoff: refusal }) : {});
    mount();
    const said = await screen.findByRole("alert");
    expect(said.textContent).toContain("I couldn't prepare that for you.");
    expect(said.textContent).toContain("Upgrade to use the Agent for this. New Proposal is included from the Starter plan.");
    expect(said.textContent).toContain("What you told me is saved. Nothing was created or sent, and no AI Credits were used.");
    expect(screen.queryByTestId("where")).toBeNull();                       // not dropped on the dashboard without a word
    expect(within(said).getByRole("button", { name: "Go to the dashboard" })).toBeTruthy();
    await click(within(said).getByRole("button", { name: "See plans" }));
    expect(screen.getByTestId("where").textContent).toBe("/pricing");
  });

  it("a task that was refused before is tried again when the page is opened again", async () => {
    const refusal = { to: "/dashboard", blocked: true, upgrade: true, message: "Upgrade to use the Agent for this." };
    answer = (path) => (/attach-user$/.test(path) ? session({ authenticated: true, state: "blocked", next: "handoff", missing: [], business_id: "biz-1", handoff: refusal })
      : /\/resume$/.test(path) ? session({ authenticated: true, next: "prepare", missing: [], business_id: "biz-1" })
      : /\/prepare$/.test(path) ? session({ authenticated: true, next: "handoff", missing: [], business_id: "biz-1", handoff: { to: "/dashboard?task=run-7", run_id: "run-7" } }) : {});
    mount();
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/dashboard?task=run-7"));
    expect(posts(/\/prepare$/).length).toBe(1);
  });

  it("a failure keeps the task and offers another go; an expired task says so", async () => {
    let fail = true;
    answer = (path) => (/attach-user$/.test(path) ? session({ authenticated: true, next: "prepare", missing: [], business_id: "biz-1" })
      : /validation\/me/.test(path) ? { id: "biz-1" } : /\/resume$/.test(path) ? session({ authenticated: true, next: "prepare", missing: [], business_id: "biz-1" })
      : /\/prepare$/.test(path) ? (fail ? session({ authenticated: true, state: "ready_to_prepare", next: "prepare", missing: [], business_id: "biz-1", problem: "That couldn't be prepared just now. Nothing was lost; try again." })
        : session({ authenticated: true, next: "handoff", missing: [], business_id: "biz-1", handoff: { to: "/dashboard?task=run-7" } })) : {});
    const view = mount();
    expect((await screen.findByRole("alert")).textContent).toContain("Nothing was lost");
    fail = false;
    await click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/dashboard?task=run-7"));
    view.unmount();
    answer = (path) => (/attach-user$/.test(path) ? { __status: 404, __body: { detail: "expired" } } : {});
    mount();
    expect(await screen.findByText("That task has expired.")).toBeTruthy();
  });
});

describe("the Agent Centre's Documents list", () => {
  const documents = { total: 4, counts: { quotation: 1, invoice: 1, proposal: 1, receipt: 1 },
    kinds: [{ key: "quotation", label: "Quotation" }, { key: "invoice", label: "Invoice" }, { key: "contract", label: "Contract" }, { key: "proposal", label: "Proposal" },
      { key: "purchase_order", label: "Purchase order" }, { key: "credit_note", label: "Credit note" }, { key: "receipt", label: "Receipt" }],
    items: [
      { kind: "proposal", kind_label: "Proposal", id: "p1", reference: "PRO-1", party: "QA Round Six Ltd", total: 4500, currency: "GBP", status: "awaiting_approval", status_label: "Waiting for your approval", date: "2026-09-01", run_id: "run-p", can_edit: true, from_agent: true },
      { kind: "quotation", kind_label: "Quotation", id: "q1", reference: "QUO-7B420DF3", party: "Frank", total: 900, currency: "GBP", status: "accepted", status_label: "Accepted", date: "2026-10-05", run_id: "run-q", can_edit: false, from_agent: true },
      { kind: "receipt", kind_label: "Receipt", id: "i2:p1", reference: "REC-1031026", party: "Frank", total: 300, currency: "GBP", status: "sent", status_label: "Sent", date: "2026-10-01", run_id: "run-r", can_edit: false, from_agent: true, duplicate_number: true },
      { kind: "invoice", kind_label: "Invoice", id: "i1", reference: "INV-1160926", party: "Aftred", total: 149, currency: "GBP", status: "overdue", status_label: "Overdue", date: "2026-09-20", run_id: null, can_edit: false, from_agent: false }] };
  const order = (c) => [...c.querySelectorAll("[data-document]")].map((r) => r.getAttribute("data-document"));

  it("lists every document with its number, who it is for, its amount and status, and Edit draft only while it waits", () => {
    const onOpen = vi.fn();
    const onEdit = vi.fn();
    const { container } = render(<DocumentList documents={documents} kind="" onKind={() => {}} onOpen={onOpen} onEdit={onEdit} />);
    const rows = [...container.querySelectorAll("[data-document]")];
    expect(order(container)).toEqual(["proposal", "quotation", "receipt", "invoice"]);      // waiting first (whatever its date), then newest first
    expect(rows[0].textContent).toContain("Proposal PRO-1");
    expect(rows[0].textContent).toContain("Waiting for your approval");
    expect(rows[0].textContent).toContain("QA Round Six Ltd · £4,500.00");
    expect(rows[3].textContent).toContain("Invoice INV-1160926");          // the number the dashboard shows, never a record id
    expect(within(rows[3]).getByText("Overdue").className).toContain("rose");      // the same pill colours as the rest of the Agent Centre
    expect(within(rows[1]).getByText("Accepted").className).toContain("emerald");
    expect(screen.getAllByRole("button", { name: /^Edit draft/ }).length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Edit draft Proposal PRO-1" }));
    expect(onEdit).toHaveBeenCalledWith(documents.items[0]);
    fireEvent.click(within(rows[1]).getAllByRole("button")[0]);
    expect(onOpen).toHaveBeenCalledWith(documents.items[1]);
    // Made by hand: tagged as such, and with no task to open.
    expect(within(rows[3]).getByText("Made by hand")).toBeTruthy();
    expect(within(rows[3]).getAllByRole("button")[0].disabled).toBe(true);
    expect(container.querySelectorAll("[data-by-hand]").length).toBe(1);
    expect(within(rows[2]).getByText("Number used twice")).toBeTruthy();    // a shared number is flagged where it shows
    expect(screen.getByRole("option", { name: "All documents (4)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Proposals (1)" })).toBeTruthy();
  });

  it("searches by number, customer or status, orders by date either way, and filters by type", () => {
    const { container, rerender } = render(<DocumentList documents={documents} kind="" onKind={() => {}} onOpen={() => {}} onEdit={() => {}} />);
    fireEvent.change(screen.getByLabelText("Order by date"), { target: { value: "oldest" } });
    expect(order(container)).toEqual(["proposal", "invoice", "receipt", "quotation"]);      // what waits for you still leads
    fireEvent.change(screen.getByLabelText("Order by date"), { target: { value: "newest" } });
    fireEvent.change(screen.getByLabelText("Search documents"), { target: { value: "frank" } });
    expect(order(container)).toEqual(["quotation", "receipt"]);
    fireEvent.change(screen.getByLabelText("Search documents"), { target: { value: "INV-116" } });
    expect(order(container)).toEqual(["invoice"]);
    fireEvent.change(screen.getByLabelText("Search documents"), { target: { value: "overdue aftred" } });
    expect(order(container)).toEqual(["invoice"]);
    fireEvent.change(screen.getByLabelText("Search documents"), { target: { value: "nothing like this" } });
    expect(screen.getByText("No documents match.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search documents"), { target: { value: "" } });
    rerender(<DocumentList documents={documents} kind="invoice" onKind={() => {}} onOpen={() => {}} onEdit={() => {}} />);
    expect(order(container)).toEqual(["invoice"]);
    rerender(<DocumentList documents={documents} kind="contract" onKind={() => {}} onOpen={() => {}} onEdit={() => {}} />);
    expect(screen.getByText("No documents match.")).toBeTruthy();
    rerender(<DocumentList documents={{ ...documents, items: [], total: 0 }} kind="" onKind={() => {}} onOpen={() => {}} onEdit={() => {}} />);
    expect(screen.getByText(/No documents yet\./)).toBeTruthy();
  });
});

describe("Edit draft for proposals, purchase orders and credit notes", () => {
  const approval = (tool, payload) => ({ id: "a1", status: "pending", tool_id: tool, title: "Send it", payload_version: 1, payload: { currency: "GBP", customer_name: "QA Round Six Ltd", to_email: "qa@six.test", ...payload } });

  it("every document the Agent prepares can be edited", () => {
    for (const tool of ["send_proposal", "send_purchase_order", "send_credit_note"]) expect(editableApproval({ tool_id: tool })).toBe(true);
  });

  it("a proposal: what it says, its price, timeline and valid-until date", () => {
    const onSave = vi.fn();
    render(<DraftEditor approval={approval("send_proposal", { reference: "PRO-1", problem: "Month-end takes a week.", solution: "We take over bookkeeping.", total: 4500, timeline: "", valid_until: "2026-10-31" })}
      options={{ document: "proposal" }} onCancel={() => {}} onSave={onSave} />);
    expect(screen.getByLabelText("Price").parentElement.querySelector("[data-currency]").textContent).toBe("£");
    fireEvent.change(screen.getByLabelText("What you propose"), { target: { value: "We take over bookkeeping and month-end." } });
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText("Timeline"), { target: { value: "Live in 3 weeks" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith({ solution: "We take over bookkeeping and month-end.", total: 5000, timeline: "Live in 3 weeks" });
    fireEvent.change(screen.getByLabelText("What you propose"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Save changes" }).disabled).toBe(true);
  });

  it("a purchase order: its lines, deliver-by date and notes to the supplier, with no discount or payment terms", () => {
    const onSave = vi.fn();
    const { container } = render(<DraftEditor approval={approval("send_purchase_order", { reference: "PO-1", customer_name: "Fasthosts", items: [{ description: "Server", qty: 2, unit_price: 80 }],
      subtotal: 160, vat_rate: 0, vat_amount: 0, total: 160, delivery_date: "2026-10-20" })} options={{ document: "purchase_order", catalogue: [], customers: [] }} onCancel={() => {}} onSave={onSave} />);
    expect(screen.getByLabelText("Deliver by").value).toBe("2026-10-20");
    expect(screen.getByLabelText("Notes to the supplier")).toBeTruthy();
    expect(screen.queryByLabelText("Valid until")).toBeNull();
    expect(screen.getByLabelText("Discount").closest("div").className).toContain("hidden");
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "3" } });
    expect(container.querySelector("[data-total]").textContent).toBe("£240.00");
    fireEvent.change(screen.getByLabelText("Deliver by"), { target: { value: "2026-10-25" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith({ items: [{ product_id: null, name: "Server", quantity: 3, unit_price: 80 }], delivery_date: "2026-10-25" });
  });

  it("a credit note: the amount (never above the invoice), the reason and any refund", () => {
    const onSave = vi.fn();
    render(<DraftEditor approval={approval("send_credit_note", { reference: "CN-1", invoice_reference: "INV-7", invoice_total: 600, total: 100, reason: "Late delivery", refund_amount: 0 })}
      options={{ document: "credit_note" }} onCancel={() => {}} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Amount to credit"), { target: { value: "900" } });
    expect(screen.getByText("Enter an amount above 0, up to £600.00.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Amount to credit"), { target: { value: "150" } });
    fireEvent.change(screen.getByLabelText("Amount to refund"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Late delivery of two items" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith({ total: 150, reason: "Late delivery of two items", refund_amount: 50 });
  });
});

describe("Watch it work", () => {
  const openDemo = async () => {
    render(<MemoryRouter><LandingPage /></MemoryRouter>);
    await click(screen.getByRole("button", { name: "Watch a 30 second demo of the Agent" }));
  };

  it("plays only when asked, inside the preview's own box on a wide screen, and reports that it was opened", async () => {
    window.matchMedia = (q) => ({ matches: /min-width: 1024px/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    try {
      render(<MemoryRouter><LandingPage /></MemoryRouter>);
      expect(document.querySelector("[data-agent-demo]")).toBeNull();          // never by itself
      await click(screen.getByRole("button", { name: "Watch a 30 second demo of the Agent" }));
      const demo = document.querySelector("[data-agent-demo]");
      expect(demo.closest("[data-hero-mock]")).toBeTruthy();                   // in the mock's frame: nothing around it moves
      expect(demo.className).toContain("absolute");
      expect(demo.nextElementSibling.className).toContain("opacity-0");        // the preview fades out underneath
      expect(document.querySelector("[data-demo-sheet]")).toBeNull();
      await waitFor(() => expect(events().map((e) => e.name)).toContain("demo_opened"));
      expect(demo.querySelector("[data-demo-title]").textContent).toBe("Tell it the job");
      expect(demo.querySelector("[data-demo-dots]").children.length).toBe(3);
      expect(demo.querySelector("[aria-live=polite]")).toBeTruthy();
      // Touching the launcher stops it; so does Esc.
      fireEvent.pointerDown(screen.getByLabelText(PROMPT));
      expect(document.querySelector("[data-agent-demo]")).toBeNull();
      await click(screen.getByRole("button", { name: "Watch a 30 second demo of the Agent" }));
      fireEvent.keyDown(document, { key: "Escape" });
      expect(document.querySelector("[data-agent-demo]")).toBeNull();
    } finally { delete window.matchMedia; }
  });

  it("on a small screen it opens in a sheet; with reduced motion the scenes are still frames with Back and Next; Try it yourself fills the field", async () => {
    await openDemo();                                                         // no matchMedia here: a small screen, and reduced motion
    const sheet = document.querySelector("[data-demo-sheet]");
    expect(sheet.getAttribute("role")).toBe("dialog");
    expect(sheet.className).toContain("h-[90vh]");
    const demo = within(sheet);
    expect(demo.queryByRole("button", { name: "Pause" })).toBeNull();        // nothing plays
    expect(demo.getByRole("button", { name: "Back" }).disabled).toBe(true);
    expect(sheet.querySelector("[data-demo-typed]").textContent).toBe("Invoice for Mark, $300");
    await click(demo.getByRole("button", { name: "Next" }));
    expect(sheet.querySelector("[data-demo-title]").textContent).toBe("It does the work");
    expect([...sheet.querySelectorAll("[data-demo-step]")].map((li) => li.textContent)).toEqual(["Reading your request", "Found Mark in your customers", "Drafting invoice INV-1001"]);
    await click(demo.getByRole("button", { name: "Next" }));
    expect(sheet.querySelector("[data-demo-card]").textContent).toContain("Invoice INV-1001");
    expect(sheet.querySelector("[data-demo-card]").textContent).toContain("$300.00");
    await waitFor(() => expect(events().map((e) => e.name)).toContain("demo_completed"));      // the last scene was reached
    await click(demo.getByRole("button", { name: "Try it yourself" }));
    expect(document.querySelector("[data-demo-sheet]")).toBeNull();
    expect(screen.getByLabelText(PROMPT).value).toBe("Invoice for Mark, $300");      // ready to send; nothing was sent
    expect(document.activeElement).toBe(screen.getByLabelText(PROMPT));
    expect(posts(/task-sessions$/).length).toBe(0);
    await waitFor(() => expect(events().map((e) => e.name)).toContain("demo_try_it_clicked"));
  });

  it("the How it works section uses the demo's three scene titles", () => {
    render(<MemoryRouter><LandingPage /></MemoryRouter>);
    const section = document.getElementById("how-it-works");
    expect([...section.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["Tell it the job", "It does the work", "You approve"]);
    expect(section.textContent).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("the checkpoint knows a name already given, and asks before sending marketing", () => {
  const ready = (over = {}) => session({ next: "identity", questions: [], missing: [], first_name: null, ...over });

  it("with the name said in their message it shows Continue as, not a name field; Not you brings the field back", async () => {
    answer = starts(ready({ first_name: "Munah" }));
    mountLauncher();
    await click(screen.getByRole("button", { name: "I need funding" }));
    expect(within(card()).queryByLabelText("Your name")).toBeNull();
    expect(card().querySelector("[data-continue-as]").textContent).toBe("Continue as MunahNot you? Change");
    fireEvent.change(within(card()).getByLabelText("Your email address"), { target: { value: "munah@example.test" } });
    await click(within(card()).getByRole("button", { name: "Continue" }));
    expect(posts(/\/email$/)[0].body).toEqual({ email: "munah@example.test", marketing_consent: false });      // the name is already with the task
    await click(within(card()).getByRole("button", { name: "Not you? Change" }));
    expect(within(card()).getByLabelText("Your name")).toBeTruthy();
  });

  it("the marketing box is unticked by default, and the choice is sent when chosen", async () => {
    answer = starts(ready());
    mountLauncher();
    await click(screen.getByRole("button", { name: "I need funding" }));
    const box = within(card().querySelector("[data-marketing]")).getByRole("checkbox");
    expect(box.checked).toBe(false);
    expect(card().querySelector("[data-marketing]").textContent).toBe("Send me tips, product updates and the EnterprateAI newsletter. Unsubscribe any time.");
    expect(card().querySelector("[data-privacy]")).toBeNull();
    fireEvent.change(within(card()).getByLabelText("Your name"), { target: { value: "http://spam.example" } });
    fireEvent.change(within(card()).getByLabelText("Your email address"), { target: { value: "a@example.test" } });
    await click(within(card()).getByRole("button", { name: "Continue" }));
    expect(within(card()).getByRole("alert").textContent).toMatch(/letters only/);      // a web address is not a name
    fireEvent.change(within(card()).getByLabelText("Your name"), { target: { value: "Ada Obi" } });
    fireEvent.click(box);
    await click(within(card()).getByRole("button", { name: "Continue" }));
    expect(posts(/\/email$/)[0].body).toEqual({ email: "a@example.test", name: "Ada Obi", marketing_consent: true });
  });
});

