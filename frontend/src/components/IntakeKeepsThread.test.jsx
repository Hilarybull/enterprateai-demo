// The homepage intake never loses the conversation: six answers in a row, signed in and signed out, every one sent; a
// sign-in check in the middle (the app asks /auth/me again after any 401) keeps the thread; a re-mount resumes it from
// the address. Replies recorded from the real backend for "Help me price my cupcake boxes".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import LandingPage from "../pages/LandingPage";
import { useAuthStore } from "../store/auth";
import replies from "./__fixtures__/cupcake_signed_in.json";

vi.mock("./GoogleSignInButton", () => ({ default: () => null }));
const PROMPT = "What do you want EnterprateAI to do for your business?";
let calls, step;
beforeEach(() => {
  calls = []; step = 0; localStorage.clear(); sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    calls.push({ path, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
    let out = {};
    if (init.method === "POST" && /\/task-sessions$/.test(path)) out = replies[0];
    else if (init.method === "POST" && /\/inputs$/.test(path)) out = replies[Math.min(++step, replies.length - 1)];
    else if (/\/task-sessions\/[^/?]+$/.test(path)) out = replies[step];
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); useAuthStore.setState({ token: null, email: null }); });

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}</p>; }
const page = () => render(<MemoryRouter initialEntries={["/"]}><Routes><Route path="/" element={<><LandingPage /><Where /></>} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
const wait = (ms = 700) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const replyBox = () => {
  const card = [...document.querySelectorAll("[data-task-card]")].find((c) => c.querySelector("[data-composer] input"));
  return card?.querySelector("[data-composer] input");
};
async function say(box, text) {
  await act(async () => { fireEvent.change(box, { target: { value: text } }); });
  await act(async () => { fireEvent.submit(box.closest("form")); });
  await wait();
}

describe.each([["signed in", true], ["signed out", false]])("the intake, %s", (_name, signedIn) => {
  it("takes six answers in a row without a reload or a lost answer", async () => {
    if (signedIn) { useAuthStore.setState({ token: "t", email: "owner@example.test" }); localStorage.setItem("ea_email", "owner@example.test"); }
    page();
    await say(screen.getByLabelText(PROMPT), "Help me price my cupcake boxes");
    const sent = [];
    for (const [n, a] of ["Cupcake boxes", "Office managers in Leeds", "30", "12", "40"].entries()) {
      const box = replyBox();
      expect(box, `the reply box for answer ${n + 1}`).toBeTruthy();
      if (signedIn && n === 2) {
        // The app checks the sign-in again (as after any 401): the thread is not wiped.
        await act(async () => { useAuthStore.setState({ token: null }); });
        await act(async () => { useAuthStore.setState({ token: "t" }); });
      }
      await say(box, a);
      sent.push(a);
    }
    const inputs = calls.filter((c) => c.method === "POST" && /\/inputs$/.test(c.path));
    expect(inputs.length).toBe(5);
    expect(screen.getAllByTestId("where")[0].textContent).toBe("/");
    expect(new URLSearchParams(window.location.search).get("task")).toBe(replies[0].id);
    // The goal is kept exactly as typed.
    expect(calls.find((c) => c.method === "POST" && /\/task-sessions$/.test(c.path)).body.text).toBe("Help me price my cupcake boxes");
  });
});

it("a re-mount resumes the same thread from the address", async () => {
  useAuthStore.setState({ token: "t", email: "owner@example.test" });
  step = 2;
  window.history.replaceState(null, "", `/?task=${replies[0].id}`);
  page();
  await wait();
  expect(calls.some((c) => c.method === "GET" && c.path.endsWith(`/task-sessions/${replies[0].id}`))).toBe(true);
  expect(replyBox()).toBeTruthy();
});

it("while the first question is on its way: the card's own shell, in the preview's box, with the Agent typing", async () => {
  let release;
  globalThis.fetch = vi.fn((url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    if (init.method === "POST" && /\/task-sessions$/.test(path)) {
      return new Promise((done) => { release = () => done(new Response(JSON.stringify(replies[0]), { status: 200, headers: { "Content-Type": "application/json" } })); });
    }
    return Promise.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
  });
  page();
  const box = screen.getByLabelText(PROMPT);
  await act(async () => { fireEvent.change(box, { target: { value: "Help me price my cupcake boxes" } }); });
  await act(async () => { fireEvent.submit(box.closest("form")); });
  const shell = document.querySelector("[data-hero-stage] [data-task-shell]");
  expect(shell).toBeTruthy();
  expect(shell.textContent).toContain("Help me price my cupcake boxes");
  expect(shell.querySelector("[data-typing]")).toBeTruthy();
  expect(document.querySelector("[data-agent-steps]")).toBeNull();      // no empty "EnterprateAI" bar
  expect(document.querySelector("[data-hero-preview]").className).toContain("lg:opacity-0");
  await act(async () => { release(); await new Promise((r) => setTimeout(r, 50)); });
  expect(document.querySelector("[data-task-shell]")).toBeNull();
  expect(document.querySelector("[data-hero-stage] [data-task-card]")).toBeTruthy();
});
