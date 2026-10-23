// The Overview redesign (22 Oct): route-matched options with no non-findings, an honest pack line, the ring's colour,
// three recommendations at most, and the one toast system.
import { cleanup, render, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { FundingOptions, PackStrip, RelatedCards, ResearchFindings, ScoreRing, fundingOptions, researchFindings } from "./CaseOverview";
import { ToastContainer } from "../Toast";
import { scoreChange, toast } from "../../lib/toast";

afterEach(cleanup);
const run = { items: [
  { id: "g1", topic: "route_grant", label: "Ad:Venture grants", value: "Grants of £1,500 to £10,000 for new businesses in West Yorkshire.", sources: [{ publisher: "Invest Leeds", date: "2025-03-27" }] },
  { id: "l1", topic: "route_loan", label: "Start Up Loans", value: "Loans up to £25,000.", sources: [{ publisher: "GOV.UK", date: "undated" }] },
  { id: "e1", topic: "route_equity", label: "Equity", value: "No equity scheme was found for this business.", sources: [] }] };

it("shows only options for the case's route, never a non-finding, with the amount and no 'undated'", () => {
  const opts = fundingOptions({ route: "grant", saved: [], run });
  expect(opts.map((o) => o.id)).toEqual(["g1"]);
  expect(fundingOptions({ route: "unsure", run }).map((o) => o.id)).toEqual(["g1", "l1"]);      // no equity non-finding
  render(<MemoryRouter><FundingOptions route="grant" options={opts} /></MemoryRouter>);
  expect(document.querySelector("h2").textContent).toBe("Grants that may fit you");
  expect(document.querySelector("[data-option-amount]").textContent).toBe("£1,500 to £10,000");
  render(<MemoryRouter><FundingOptions route="loan" options={fundingOptions({ route: "loan", run })} /></MemoryRouter>);
  expect(document.body.textContent).not.toMatch(/undated/i);
});

it("says when nothing was found for the route, shows the other routes' options and what else was found", () => {
  const loanOnly = { items: [
    { id: "l1", kind: "researched", topic: "route_loan", decision: "accepted", label: "Loans", value: "Loans up to ₦100 million.", sources: [{ publisher: "Access Bank" }] },
    { id: "m1", kind: "researched", topic: "market", decision: null, label: "Market size", value: "The car wash market grows to 2032.", sources: [{ publisher: "A report" }] }],
    deliverables: { options: [{ id: "l1:0", item_id: "l1", route: "loan", title: "Term Finance", text: "Loans up to ₦100 million.", source: { publisher: "Access Bank" } }] } };
  const options = fundingOptions({ route: "grant", run: loanOnly });
  const others = fundingOptions({ route: "any", run: loanOnly });
  expect(options).toEqual([]);
  expect(others.map((o) => [o.title, o.saved])).toEqual([["Term Finance", true]]);      // an accepted one stays, marked saved
  render(<MemoryRouter><FundingOptions route="grant" options={options} others={others} searched /></MemoryRouter>);
  expect(document.querySelector("[data-options-none]").textContent).toBe("No grants were found that could be checked for this need. The research found these other options instead.");
  expect(document.querySelector("[data-option-route]").textContent).toBe("Loan");
  expect(document.body.textContent).toContain("Saved to your case");
  render(<MemoryRouter><ResearchFindings items={researchFindings(loanOnly)} onSave={() => {}} onHide={() => {}} /></MemoryRouter>);
  expect([...document.querySelectorAll("[data-found-row]")].map((r) => r.textContent)).toEqual([expect.stringContaining("Market size")]);
});

it("never says the pack is ready while the case isn't", () => {
  render(<MemoryRouter><PackStrip pack={{ ready: 2, total: 2 }} caseReady={false} to="/x" /></MemoryRouter>);
  expect(document.querySelector("[data-pack-strip]").textContent).toContain("Your pack is drafted (2 of 2).");
});

it("colours the ring by score and shows at most three recommendations", () => {
  render(<ScoreRing score={38} />);
  expect(document.querySelector("[data-score-ring] circle:nth-child(2)").getAttribute("class")).toContain("stroke-rose-500");
  cleanup();
  const items = ["plan", "launch", "invoice", "catalogue", "scenario"].map((k) => ({ key: k, title: k, why: "w", to: "/" }));
  render(<MemoryRouter><RelatedCards items={items} /></MemoryRouter>);
  expect(document.querySelectorAll("[data-related-item]").length).toBe(3);
});

it("a pending toast turns into its result in place, with the score change", async () => {
  expect(scoreChange(80, 86)).toBe("Score 80 → 86");
  expect(scoreChange(null, 38)).toBe("");
  const seen = [];
  window.addEventListener("ea:toast", (e) => seen.push(e.detail));
  const id = toast({ kind: "pending", title: "Saved. Checking your score…" });
  toast({ id, kind: "success", title: "Evidence confirmed.", detail: "Demand evidence now counts. Score 80 → 86" });
  expect(seen.map((t) => t.id)).toEqual([id, id]);
  render(<ToastContainer toasts={[{ id, kind: "success", title: "Evidence confirmed.", message: "Score 80 → 86", actions: [{ label: "Undo" }] }]} onClose={() => {}} />);
  expect(document.querySelector("[data-toast='success']").getAttribute("role")).toBe("status");
  expect(document.querySelector("[data-toast-action='Undo']")).toBeTruthy();
});
