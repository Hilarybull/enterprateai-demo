// Round 7 (the owner's live QA, 21 Oct): one draft adopted at a time keeps the others, an older answer against today's
// is asked with one press each, a slow check says so and fetches the score, and the case and catalogue disagreeing is asked.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import { NextSteps, SavedNotice, announceSaved } from "./ResultSummary";
import WhatNext from "./WhatNext";

// Toasts said by the one toast system (22 Oct), collected for the checks below
const toasts = [];
window.addEventListener("ea:toast", (e) => toasts.push(e.detail));
const lastToast = () => toasts[toasts.length - 1] || {};


afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

const RUN = { id: "rr_1", status: "review", context: { currency: "NGN" }, drafts: { total: 3, adopted: 1, open: 2 }, items: [
  { id: "f1", criterion: "financial", derive: "forecast", basis: "calculated", label: "12-month forecast", value: "x", decision: null,
    table: [{ month: 1, revenue: 1200000, costs: 490000, profit: 710000, cash: 710000 }] },
  { id: "c1", criterion: "demand", kind: "question", field: "contracts", label: "Paying customers", conflict: true,
    question: "Earlier you said 40 paying customers; today you said No traction yet. Which is right?", options: ["40 paying customers", "No traction yet"] }] };
const RESULT = { assessment_type: "funding_readiness_initial", score: 22, criteria: [], strengths: [], premium_next_action: { label: "x" },
  blockers: [{ key: "financial", kind: "unknown", label: "No forecast" }, { key: "demand", kind: "unknown", label: "No paying customers" }] };

describe("one draft at a time", () => {
  it("says how many are adopted, keeps the rest adoptable, and can dismiss one", async () => {
    const calls = [];
    vi.spyOn(client, "apiRequest").mockImplementation(async (path, method, body) => { calls.push({ path, body }); return { research: RUN, result: { score: 30 } }; });
    render(<MemoryRouter><NextSteps result={RESULT} run={RUN} businessId="b1" onApplied={async () => ({ score: 30, blockers: [] })} /></MemoryRouter>);
    expect(document.querySelector("[data-drafts-tally]").textContent).toBe("You adopted 1 of 3 drafts. 1 draft left: Forecast.");
    const card = document.querySelector("[data-next-step='financial']");
    expect(card.querySelector("[data-step-adopt]").textContent).toBe("Adopt");
    await act(async () => { fireEvent.click(card.querySelector("[data-step-dismiss]")); });
    await wait(600);
    expect(calls.find((c) => c.path.endsWith("/review")).body.decisions).toEqual({ f1: { decision: "reject" } });
    expect(card.querySelector("[data-step-badge]").textContent).toBe("Dismissed");
  });

  it("answers an older answer against today's with one press", async () => {
    const calls = [];
    vi.spyOn(client, "apiRequest").mockImplementation(async (path, method, body) => { calls.push({ path, body }); return { research: RUN, result: { score: 30 } }; });
    render(<MemoryRouter><NextSteps result={RESULT} run={RUN} businessId="b1" onApplied={async () => ({ score: 30, blockers: [] })} /></MemoryRouter>);
    const q = document.querySelector("[data-next-step='demand'] [data-step-question]");
    expect(q.querySelector("label").textContent).toBe("Earlier you said 40 paying customers; today you said No traction yet. Which is right?");
    const buttons = [...q.querySelectorAll("[data-step-choices] button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["40 paying customers", "No traction yet"]);
    await act(async () => { fireEvent.click(buttons[1]); });
    await wait(600);
    expect(calls.find((c) => c.path.endsWith("/review")).body.decisions).toEqual({ c1: { decision: "answer", value: "No traction yet" } });
  });

  it("says it is still checking, then the new score, from up to before", async () => {
    vi.spyOn(client, "apiRequest").mockResolvedValue({ research: RUN, checking: true, result: { score: 22 } });
    let n = 0;
    const applied = vi.fn(async () => { n += 1; return n === 1 ? { score: 22, blockers: [] } : { score: 32, blockers: [] }; });
    render(<MemoryRouter><NextSteps result={RESULT} run={RUN} businessId="b1" onApplied={applied} /></MemoryRouter>);
    await act(async () => { fireEvent.click(document.querySelector("[data-next-step='financial'] [data-step-adopt]")); });
    await wait(600);
    expect(lastToast()).toMatchObject({ kind: "pending", title: "Saved. Checking your score…" });
    await wait(3100);
    expect(lastToast().kind).toBe("success");
    expect(lastToast().message).toContain("Score 22 → 32");      // the same toast, updated in place
    expect(toasts.filter((t) => t.id === lastToast().id).length).toBeGreaterThan(1);
  }, 10000);
});

it("says a save in a toast, never a line in the page", async () => {
  announceSaved("Saved. Your score is now 32/100, up from 22.");
  expect(lastToast()).toMatchObject({ kind: "success", title: "Saved. Your score is now 32/100, up from 22." });
  render(<SavedNotice />);
  expect(document.querySelector("[data-saved-notice]")).toBeNull();
});

it("asks which price and cost are right when the case and the catalogue disagree", async () => {
  const calls = [];
  const item = { key: "catalogue", kind: "inline", title: "Check your price and cost per sale", cost: "Free", allowed: true, button: "Start",
    reason: "Your catalogue says ₦4,000 a sale and ₦1,500 cost; your case says ₦1,000 and ₦60. Which is right?",
    prefill: { conflict: true, currency: "NGN", name: "Car wash", catalogue: { price: 4000, cost: 1500 }, case: { price: 1000, cost: 60 } } };
  vi.spyOn(client, "apiRequest").mockImplementation(async (path, method, body) => { calls.push({ path, body }); return /next-actions$/.test(path) ? { items: [item] } : {}; });
  render(<MemoryRouter><WhatNext sessionId="s1" businessId="b1" onChanged={async () => ({ score: 32 })} /></MemoryRouter>);
  await wait(0);
  expect(screen.getByText(item.reason)).toBeTruthy();
  await act(async () => { fireEvent.click(document.querySelector("[data-next-action='catalogue'] [data-next-start]")); });
  expect(document.querySelector("[data-use-catalogue]").textContent).toBe("Use the catalogue: ₦4,000 and ₦1,500 cost");
  expect(document.querySelector("[data-use-case]").textContent).toBe("Use my case: ₦1,000 and ₦60 cost");
  await act(async () => { fireEvent.click(document.querySelector("[data-use-catalogue]")); });
  expect(calls.find((c) => c.path === "/businesses/b1/assessment/funding/use-figures").body).toEqual({ figures: { price: 4000, cost: 1500 } });
  expect(lastToast()).toMatchObject({ kind: "success", title: "Your figures are saved.", message: "Your score is now 32/100." });
  expect(document.body.textContent).not.toMatch(/[–—]/);
});
