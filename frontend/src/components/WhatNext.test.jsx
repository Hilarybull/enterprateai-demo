// "What to do next" (the owner's brief, 21 Oct): three rows with one button each; the free price and cost is done in place
// and re-checks; a paid one goes to the price modal first; a locked one says its plan and offers Upgrade.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import WhatNext from "./WhatNext";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const click = async (el) => { await act(async () => { fireEvent.click(el); }); };
const ITEMS = [
  { key: "catalogue", title: "Set your price and cost per sale", reason: "Funders check each sale makes money", kind: "inline", cost: "Free", allowed: true, button: "Start", prefill: { name: "Car wash", price: 4000, currency: "NGN" } },
  { key: "scenario", title: "See if the ₦5m loan pays back", reason: "Funders need a forecast; yours is missing", kind: "task", capability: "expansion_scenario", cost: "4 credits", allowed: true, button: "Start", prefill: { amount: 5000000 } },
  { key: "plan", title: "Draft your business plan", reason: "Funders ask for one; you have none", kind: "task", capability: "business_plan_draft", cost: "Starter plan", allowed: false, upgrade: { to: "/pricing" }, button: "Start", prefill: {} },
];

it("shows three rows with one button each, saves the price in place and checks again", async () => {
  const calls = [];
  vi.spyOn(client, "apiRequest").mockImplementation(async (path, method, body) => { calls.push({ path, method, body }); return /next-actions$/.test(path) ? { items: ITEMS } : {}; });
  const act_ = vi.fn();
  const changed = vi.fn();
  render(<MemoryRouter><WhatNext sessionId="s1" businessId="b1" act={act_} onChanged={changed} /></MemoryRouter>);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const rows = [...document.querySelectorAll("[data-next-action]")];
  expect(rows.map((r) => r.querySelector("[data-next-title]").textContent)).toEqual([
    "Set your price and cost per sale · Free", "See if the ₦5m loan pays back · 4 credits", "Draft your business plan · Starter plan"]);
  expect(rows.map((r) => r.querySelectorAll("button").length)).toEqual([1, 1, 1]);
  expect(within(rows[2]).getByRole("button").textContent).toBe("Upgrade");
  await click(within(rows[1]).getByRole("button", { name: "Start" }));
  expect(act_).toHaveBeenCalledWith({ capability: "expansion_scenario", label: "See if the ₦5m loan pays back", params: { amount: 5000000 } });
  await click(within(rows[0]).getByRole("button", { name: "Start" }));
  expect(screen.getByLabelText("Price per sale").value).toBe("4,000");      // worked out from the chat
  fireEvent.change(screen.getByLabelText("What one sale costs you"), { target: { value: "6000" } });
  await click(screen.getByRole("button", { name: "Save and check again" }));
  expect(calls.find((c) => /catalogue\/from-check$/.test(c.path)).body).toEqual({ name: "Car wash", base_price: 4000, cost_of_sales: 6000, currency: "NGN" });
  expect(changed).toHaveBeenCalled();
  expect(document.body.textContent).not.toMatch(/[–—]/);
});

it("shows the steps until the research is adopted, then What to do next instead: never both", async () => {
  vi.spyOn(client, "apiRequest").mockImplementation(async (path) => (/next-actions$/.test(path) ? { items: ITEMS } : {}));
  const { default: FirstValueCard } = await import("./FirstValueCard");
  const base = { assessment_type: "funding_readiness_initial", headline: "Funding readiness", score: 38, evidence_coverage: 50, band: "Not ready yet", currency_sign: "₦",
    gaps: { failed: [], early: [], unknown: [] }, strengths: [], metrics: [], criteria: [], free_next_actions: [], premium_gate: { allowed: true }, _session: "s1",
    premium_next_action: { label: "Help me become funding-ready", explains: "" }, blockers: [{ key: "financial", kind: "unknown", label: "No forecast" }] };
  const { unmount } = render(<MemoryRouter><FirstValueCard result={{ ...base, research: { state: "review", run_id: "rr_1" } }} /></MemoryRouter>);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(document.querySelector("[data-next-steps]")).toBeTruthy();
  expect(document.querySelector("[data-what-next]")).toBeNull();
  unmount();
  render(<MemoryRouter><FirstValueCard result={{ ...base, research: { state: "adopted", run_id: "rr_1" } }} /></MemoryRouter>);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(document.querySelector("[data-what-next]")).toBeTruthy();
  expect(document.querySelector("[data-next-steps]")).toBeNull();
});
