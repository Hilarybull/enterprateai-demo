// QA P1-7: in the app, Launch Readiness starts with a short conversation, filled in from the business,
// and ends in the free provisional result with "Resolve my N launch blockers" as the premium next step.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import QuickCheck from "./QuickCheck";

const QUESTIONS = [
  { key: "kind", label: "What are you launching?", type: "choice", required: true, options: [{ value: "service", label: "A service" }, { value: "product", label: "A product" }] },
  { key: "where", label: "Where do you want to launch?", type: "text", required: true, default: "Leeds, United Kingdom", prefilled: true, source: "From your business profile", unsure: "Not sure" },
  { key: "evidence", label: "What customer testing or demand evidence do you already have?", type: "textarea", required: true, unsure: "None yet", unsure_value: "None yet" }];
const RESULT = { assessment_type: "launch_readiness_initial", headline: "Initial Launch Readiness", provisional: true, score: 38, score_label: "out of 100", evidence_coverage: 45,
  criteria: [], strengths: ["Launch market selected"], blockers: [{ key: "demand", label: "Demand not validated", kind: "unknown" }, { key: "cash", label: "Cash needed for the launch is not worked out", kind: "unknown" }],
  metrics: [], premium_next_action: { label: "Resolve my 2 launch blockers", explains: "I can now research the missing evidence." },
  free_next_actions: [{ label: "Add it to your catalogue", to: "/catalogue" }, { label: "Save for later", save: true }],
  premium_gate: { allowed: false, reason: "plan", message: "", primary: { label: "Upgrade to continue", to: "/pricing" }, secondary: [] } };

let calls;
beforeEach(() => {
  calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method || "GET", body });
    const out = (init.method || "GET") === "GET" ? { goal_key: "launch", headline: "Initial Launch Readiness", questions: QUESTIONS } : { goal_key: "launch", result: RESULT };
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const click = async (el) => { await act(async () => { fireEvent.click(el); }); };

describe("the in-app quick check", () => {
  it("asks one question at a time, keeps what the business already holds, and shows the provisional result", async () => {
    render(<MemoryRouter><QuickCheck businessId="ws1" goalKey="launch" /></MemoryRouter>);
    await click(screen.getByRole("button", { name: "Start the quick check" }));
    expect(await screen.findByText("Question 1 of 3")).toBeTruthy();
    await click(screen.getByRole("button", { name: "A service" }));
    // Filled in from the business, and said so: the city from onboarding is not asked again from blank.
    expect(screen.getByLabelText("Where do you want to launch?").value).toBe("Leeds, United Kingdom");
    expect(document.querySelector("[data-prefilled]").textContent).toContain("From your business profile");
    await click(screen.getByRole("button", { name: "Next" }));
    await click(screen.getByRole("button", { name: "None yet" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ path: expect.stringMatching(/\/businesses\/ws1\/quick-check\/launch$/),
      body: { answers: { kind: "service", where: "Leeds, United Kingdom", evidence: "None yet" } } });
    const card = await screen.findByRole("region", { name: "Initial Launch Readiness" });
    expect(within(card).getByText(/Resolve my 2 launch blockers/)).toBeTruthy();
  });

  it("a required answer left blank is said, not skipped", async () => {
    render(<MemoryRouter><QuickCheck businessId="ws1" goalKey="launch" open /></MemoryRouter>);
    await click(await screen.findByRole("button", { name: "A service" }));
    fireEvent.change(screen.getByLabelText("Where do you want to launch?"), { target: { value: " " } });
    await click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("alert").textContent).toBe("Please answer, or choose Not sure.");
  });
});

describe("QA R1: an earlier answer is not the profile", () => {
  it("is labelled as an earlier answer, and goes on the profile only when the owner saves it", async () => {
    const qs = [{ key: "customer", label: "Who are you selling it to?", type: "text", required: true, default: "Busy pet owners in Manchester", prefilled: true,
      source: "From an earlier answer, not saved to your profile", proposal_id: "pp1" }];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      calls.push({ path: String(url), method: init.method || "GET" });
      const out = (init.method || "GET") === "GET" ? { goal_key: "price_offer", headline: "Pricing Health", questions: qs } : { proposal: { status: "confirmed" } };
      return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    render(<MemoryRouter><QuickCheck businessId="ws1" goalKey="price_offer" open /></MemoryRouter>);
    const note = await screen.findByText(/From an earlier answer, not saved to your profile/);
    expect(note.textContent).not.toContain("From your business profile");
    expect(calls.some((c) => /profile-proposals/.test(c.path))).toBe(false);      // nothing saved unasked
    await click(screen.getByRole("button", { name: "Save it to my profile" }));
    expect(calls.find((c) => /profile-proposals\/pp1$/.test(c.path)).method).toBe("POST");
    expect(await screen.findByText("Saved to your profile.")).toBeTruthy();
  });
});
