// The thread shows what happened: the owner's message exactly as typed, one bubble; then one Agent bubble acknowledging
// everything captured and asking the next question. Progress counts filled slots (5 of 6 while positioning is open). On
// reload the card's shell shows until the saved task is back, never another task's thread. Replies recorded from the backend.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import LandingPage from "../pages/LandingPage";
import replies from "./__fixtures__/cupcake_thread.json";

vi.mock("./GoogleSignInButton", () => ({ default: () => null }));
const MSG = "HR teams in Abuja. I charge 30000 naira a box, it costs me 12000, about 40 boxes a month";
let sent;
beforeEach(() => {
  sent = []; localStorage.clear(); sessionStorage.clear(); window.history.replaceState(null, "", "/");
});
afterEach(cleanup);
const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const page = () => render(<MemoryRouter initialEntries={["/"]}><Routes><Route path="/" element={<LandingPage />} /></Routes></MemoryRouter>);
const column = () => document.querySelector("[data-hero-stage] [data-task-card]");

it("shows the owner's message once, one acknowledgement, and 5 of 6", async () => {
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    if (init.method === "POST" && /\/task-sessions$/.test(path)) return reply(replies[0]);
    if (init.method === "POST" && /\/inputs$/.test(path)) { sent.push(JSON.parse(init.body)); return reply(replies[1]); }
    return reply({});
  });
  page();
  const box = screen.getByLabelText("What do you want EnterprateAI to do for your business?");
  await act(async () => { fireEvent.change(box, { target: { value: "Help me price my cupcake boxes" } }); });
  await act(async () => { fireEvent.submit(box.closest("form")); });
  await act(async () => { await new Promise((r) => setTimeout(r, 700)); });
  const input = column().querySelector("[data-question-turn] input");
  await act(async () => { fireEvent.change(input, { target: { value: MSG } }); });
  await act(async () => { fireEvent.submit(input.closest("form")); });
  await act(async () => { await new Promise((r) => setTimeout(r, 700)); });
  expect(sent[0]).toMatchObject({ message: MSG, asked: "customer" });
  const mine = [...column().querySelectorAll("[data-user-says]")].map((b) => b.textContent);
  expect(mine).toEqual(["Help me price my cupcake boxes", MSG]);                 // as typed, one bubble each
  expect(column().querySelector("[data-agent-line]").textContent).toBe(
    "HR teams in Abuja, got it: ₦30,000 a box, ₦12,000 to make, about 40 a month. How do you want to position it?");
  expect(column().querySelectorAll("[data-answer]").length).toBe(0);              // no Q and A pairs for slots never asked
  expect(column().querySelector("[data-progress]").textContent).toBe("5 of 6");
  expect(column().querySelector("[data-currency-note]")).toBeNull();               // the currency is said once, in "From what you said"
});

it("on reload, the card's shell shows until the saved task is back, never an earlier thread", async () => {
  let release;
  window.history.replaceState(null, "", `/?task=${replies[1].id}`);
  globalThis.fetch = vi.fn((url) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    if (path.endsWith(`/task-sessions/${replies[1].id}`)) return new Promise((done) => { release = () => done(reply(replies[1])); });
    return Promise.resolve(reply({}));
  });
  page();
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  expect(document.querySelector("[data-hero-stage] [data-task-shell] [data-typing]")).toBeTruthy();
  expect(document.querySelector("[data-task-card]")).toBeNull();
  await act(async () => { release(); await new Promise((r) => setTimeout(r, 50)); });
  expect(document.querySelector("[data-task-shell]")).toBeNull();
  expect(column().querySelectorAll("[data-user-says]").length).toBe(2);
});

it("opening the card, answering and closing it never scrolls the page", async () => {
  const scrolls = [];
  const spyBy = vi.spyOn(window, "scrollBy").mockImplementation((...a) => scrolls.push(["scrollBy", a]));
  const spyTo = vi.spyOn(window, "scrollTo").mockImplementation((...a) => scrolls.push(["scrollTo", a]));
  const into = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (...a) { scrolls.push(["scrollIntoView", a]); };
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    if (init.method === "POST" && /\/task-sessions$/.test(path)) return reply(replies[0]);
    if (init.method === "POST" && /\/inputs$/.test(path)) return reply(replies[1]);
    return reply({});
  });
  try {
    page();
    const before = window.scrollY;
    const box = screen.getByLabelText("What do you want EnterprateAI to do for your business?");
    await act(async () => { fireEvent.change(box, { target: { value: "Help me price my cupcake boxes" } }); });
    await act(async () => { fireEvent.submit(box.closest("form")); });
    await act(async () => { await new Promise((r) => setTimeout(r, 700)); });
    const input = column().querySelector("[data-question-turn] input");
    await act(async () => { fireEvent.change(input, { target: { value: MSG } }); });
    await act(async () => { fireEvent.submit(input.closest("form")); });
    await act(async () => { await new Promise((r) => setTimeout(r, 700)); });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Change goal|Start again/ })[0]); });
    expect(scrolls).toEqual([]);
    expect(window.scrollY).toBe(before);
  } finally {
    spyBy.mockRestore(); spyTo.mockRestore(); Element.prototype.scrollIntoView = into;
  }
});
