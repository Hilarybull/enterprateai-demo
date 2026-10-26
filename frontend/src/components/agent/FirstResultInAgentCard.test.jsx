// The first result inside the Agent card: above the four action cards (which always stay), every action a button (no "···"
// menu), an X to dismiss with Undo for 5 seconds, the drawer opened on the page (never inside the card, so nothing clips
// it), and only on the workspace it was worked out for. The same pattern for every result type.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import AgentPanel from "./AgentPanel";
import ResultsList from "./ResultsList";
import FirstResultPanel from "../FirstResultPanel";
import { useFirstResult, rememberFirstValue } from "../FirstValueCard";
import { useWorkspaceStore } from "../../store/workspace";

const summary = { suggestions: [1, 2, 3, 4].map((n) => ({ key: `s${n}`, icon: "doc", text: `Suggestion ${n}`, action: { to: "/validation" } })),
  needs_approval: [], entitlement: { is_paid: true, agent_tasks: true, credits: 40 } };
const RESULTS = {
  pricing: { headline: "Pricing Health", band: "Strong", evidence_coverage: 67, key_numbers: ["₦30,000 price", "60% margin", "₦720,000 a month before fixed costs"],
    gaps: { failed: [], unknown: ["comparable prices", "customer price sensitivity"] }, premium_next_action: { label: "Find my best price" },
    free_next_actions: [{ label: "Save the price in your catalogue", to: "/catalogue" }, { label: "Create a quotation", to: "/operations" }, { label: "Save for later", save: true }],
    strengths: [], blockers: [], metrics: [], criteria: [], assessment_type: "pricing_health_initial" },
  customers: { headline: "Customer Growth Foundation", band: "Fair", evidence_coverage: 67, key_numbers: ["5 of 9 in place", "4 to close"],
    gaps: { failed: ["marketplace visibility"], unknown: ["offer clarity"] }, premium_next_action: { label: "Find customer opportunities" },
    free_next_actions: [{ label: "Set up your Marketplace profile", to: "/marketplace/profile" }, { label: "Save for later", save: true }],
    strengths: [], blockers: [], metrics: [], criteria: [], assessment_type: "customer_growth_foundation" },
};
let firstValue;
beforeEach(() => {
  localStorage.clear();
  useWorkspaceStore.setState({ workspaceId: "ws1" });
  rememberFirstValue("sess-1");
  globalThis.fetch = vi.fn(async (url) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const body = path.endsWith("/first-value") ? firstValue : path.endsWith("/first-results") ? { items: [{ goal_key: "price_offer", headline: "Pricing Health", band: "Strong", at: "2026-10-14T18:00:00Z", result: RESULTS.pricing, adopted: null }] } : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function Dashboard() {
  const firstResult = useFirstResult();
  // As the dashboard lays it out: the Agent card, then the first result in its own card under the Agent row.
  return <><AgentPanel businessId="ws1" summary={summary} onChanged={() => {}} firstResult={firstResult} />
    {firstResult?.result && <div data-first-result-card><FirstResultPanel firstResult={firstResult} /></div>}</>;
}
function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }
const OPEN = { pricing: { label: "Open pricing check", to: "/check/pricing" } };
const mount = async () => { render(<MemoryRouter><Dashboard /><Where /></MemoryRouter>); await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); };

// The customer plan lives on its own page, like the risk check (the owner, 25 Oct): never under the Agent card
it("a customer plan is never shown under the Agent card: it has its own page", async () => {
  firstValue = { business_id: "ws1", result: RESULTS.customers };
  await mount();
  expect(document.querySelector("[data-first-result-panel]")).toBeNull();
  expect(within(screen.getByRole("region", { name: "EnterprateAI Agent" })).getAllByText(/^Suggestion \d$/).length).toBe(4);
});

describe.each(Object.entries(RESULTS).filter(([k]) => k !== "customers"))("the %s result under the Agent card", (_kind, result) => {
  it("is its own card under the Agent row, with every action a button and an X to dismiss", async () => {
    firstValue = { business_id: "ws1", result };
    await mount();
    const card = screen.getByRole("region", { name: "EnterprateAI Agent" });
    const panel = document.querySelector("[data-first-result-panel]");
    expect(panel).toBeTruthy();
    expect(card.contains(panel)).toBe(false);                                                    // never inside the Agent card
    expect(card.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();   // under it
    expect(within(card).getAllByText(/^Suggestion \d$/).length).toBe(4);                     // the action cards stay
    expect(panel.className).toContain("bg-white");
    expect(within(card).queryByRole("button", { name: "More actions" })).toBeNull();
    expect(within(panel).getByRole("button", { name: "Dismiss" })).toBeTruthy();
    // One link only (the owner's brief, 20 Oct): "Open full page". No Save for later (it is saved as it goes), no Edit answers.
    expect(within(panel.querySelector("[data-result-actions]")).queryAllByRole("button")).toEqual([]);
    expect(within(panel).getByRole("link", { name: "Open full page" })).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Save for later" })).toBeNull();
    expect(panel.querySelector("[data-result-numbers]")).toBeNull();      // the score once
  });
});

it("dismissing folds it away with Undo for 5 seconds; Undo brings it back", async () => {
  firstValue = { business_id: "ws1", result: RESULTS.pricing };
  await mount();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dismiss" })); await new Promise((r) => setTimeout(r, 260)); });
  expect(document.querySelector("[data-first-result-panel]")).toBeNull();
  const toast = document.querySelector("[data-undo-toast]");
  expect(toast.textContent).toContain("Agent Centre");
  expect(toast.parentElement).toBe(document.body);                                           // on the page, never clipped by the card
  await act(async () => { fireEvent.click(within(toast).getByRole("button", { name: "Undo" })); });
  expect(document.querySelector("[data-first-result-panel]")).toBeTruthy();
  expect(document.querySelector("[data-undo-toast]")).toBeNull();
});

it.each(Object.keys(OPEN))("the %s result's Open button lands on its own page, and no drawer opens", async (kind) => {
  firstValue = { business_id: "ws1", result: RESULTS[kind] };
  await mount();
  await act(async () => { fireEvent.click(screen.getByRole("link", { name: "Open full page" })); });
  expect(screen.getByTestId("where").textContent).toBe(OPEN[kind].to);
  expect(document.querySelector("[data-result-drawer]")).toBeNull();
});

it("a result worked out for another workspace is never shown here", async () => {
  firstValue = { business_id: "someone-else", result: RESULTS.pricing };
  await mount();
  expect(document.querySelector("[data-first-result-panel]")).toBeNull();
  expect(within(screen.getByRole("region", { name: "EnterprateAI Agent" })).getAllByText(/^Suggestion \d$/).length).toBe(4);
});

it("Agent Centre > Results keeps each result, with the same single Open button", async () => {
  render(<MemoryRouter><ResultsList businessId="ws1" empty="None" /><Where /></MemoryRouter>);
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  const row = document.querySelector("[data-results-list] li");
  expect(row.textContent).toContain("Pricing Health") && expect(row.textContent).toContain("₦30,000 price");
  expect(within(row).queryByRole("button", { name: "View details" })).toBeNull();
  await act(async () => { fireEvent.click(within(row).getByRole("button", { name: "Open pricing check" })); });
  expect(screen.getByTestId("where").textContent).toBe("/check/pricing");
});
