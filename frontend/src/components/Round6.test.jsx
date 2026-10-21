import { describe, expect, it, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as client from "../api/client";
import ResearchSummary from "./ResearchSummary";
import { PremiumConfirm } from "./FirstValueCard";
import WhatNext from "./WhatNext";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const OPTION = (fits) => ({ id: "o1", kind: "estimated", criterion: "options", value: "A scheme for small businesses.", label: "Scheme",
  sources: [{ url: "https://x.example/1", title: "Scheme", date: "2025-04-07" }], fits });
const RUN = (fits, extra = {}) => ({ id: "rr_1", status: "review", charged: 60, findings: 2, balance: 400, answers: { amount: 5000000, route: "equity" },
  context: { currency: "NGN" }, items: [OPTION(fits)], deliverables: { options: [OPTION(fits)] }, ...extra });

describe("round 6: one count, honest fits", () => {
  it("says the run's own count in the header and the cost line", () => {
    vi.spyOn(client, "apiRequest").mockResolvedValue({});
    render(<ResearchSummary businessId="b1" run={RUN({ fit: "Likely", why: "It is for small businesses like yours", confirmed: null, published: "2025-04-07" })} />);
    expect(document.querySelector("[data-summary-head]").textContent).toMatch(/^2 findings for your /);
    expect(document.querySelector("[data-summary-cost]")).toBeNull();      // no credits line under the summary (the owner, 21 Oct)
  });

  it("says status not confirmed with the published date, and a different route as one", () => {
    vi.spyOn(client, "apiRequest").mockResolvedValue({});
    render(<ResearchSummary businessId="b1" run={RUN({ fit: "Different route", why: "Different route: loan", confirmed: null, published: "2025-04-07" })} />);
    expect(document.querySelector("[data-fits]").textContent).toBe("Different route: loan");
    expect(document.querySelector("[data-option-confirmed]").textContent).toBe("Status not confirmed, published 7 Apr 2025");
  });

  it("says last confirmed open only from an open statement", () => {
    vi.spyOn(client, "apiRequest").mockResolvedValue({});
    render(<ResearchSummary businessId="b1" run={RUN({ fit: "Likely", why: "x", confirmed: "2026-09-01", published: "2026-09-01" })} />);
    expect(document.querySelector("[data-option-confirmed]").textContent).toBe("Last confirmed open: 1 Sept 2026");
  });
});

describe("round 6: the price modal", () => {
  it("opens at once with the price filling in, Start waiting for it", () => {
    render(<PremiumConfirm result={{}} confirm={{ pending: true }} working onStart={() => {}} onClose={() => {}} />);
    expect(document.querySelector("[data-fv-cost]").textContent).toBe("Working out the price…");
    expect(document.querySelector("[data-fv-start]").disabled).toBe(true);
    expect(document.querySelector("[data-fv-start]").textContent).toBe("Start");
  });

  it("keeps a place's capital in what it will look up", () => {
    render(<PremiumConfirm result={{}} confirm={{ max: 60, balance: 400, plan: { research: 2 }, topics: ["Market in Nigeria", "Grants in Nigeria"] }} working={false} onStart={() => {}} onClose={() => {}} />);
    expect(document.querySelector("[data-fv-doing]").textContent).toContain("market in Nigeria, grants in Nigeria");
  });
});

describe("round 6: the free price step", () => {
  it("saves to the catalogue and the case, checks again and says the new score", async () => {
    const calls = [];
    vi.spyOn(client, "apiRequest").mockImplementation(async (path, method, body) => {
      calls.push({ path, method, body });
      if (path.endsWith("/next-actions")) return { items: [{ key: "catalogue", kind: "inline", title: "Set your price and cost per sale", reason: "Funders check each sale makes money", allowed: true, button: "Start", cost: "Free", prefill: { price: 4000, currency: "NGN" } }] };
      return {};
    });
    const changed = vi.fn(async () => ({ score: 64 }));
    render(<MemoryRouter><WhatNext sessionId="s1" businessId="b1" onChanged={changed} /></MemoryRouter>);
    await waitFor(() => expect(document.querySelector("[data-next-action='catalogue']")).toBeTruthy());
    await act(async () => { fireEvent.click(document.querySelector("[data-next-action='catalogue'] [data-next-start]")); });
    fireEvent.change(screen.getByLabelText("What one sale costs you"), { target: { value: "1500" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save and check again" })); });
    await waitFor(() => expect(document.querySelector("[data-next-saved]")?.textContent).toBe("Saved. Your score is now 64/100."));
    expect(calls.find((c) => c.path === "/businesses/b1/assessment/funding/use-figures").body).toEqual({ figures: { price: 4000, cost: 1500 } });
    expect(changed).toHaveBeenCalled();
  });
});

describe("round 6: drafts on the Overview", () => {
  it("shows a new run's drafts in the step cards with Adopt, even when an earlier run was adopted", async () => {
    vi.spyOn(client, "apiRequest").mockResolvedValue({});
    const { default: FirstValueCard } = await import("./FirstValueCard");
    const run = { id: "rr_2", status: "review", items: [
      { id: "f1", criterion: "financial", derive: "forecast", basis: "calculated", label: "12-month forecast", value: "Cash after 12 months: ₦1,200,000" }] };
    const result = { assessment_type: "funding_readiness_initial", _session: "s1", headline: "Funding", score: 40, criteria: [], strengths: [], actions: [],
      research: { state: "adopted", run_id: "rr_1" }, blockers: [{ key: "financial", kind: "unknown", label: "No monthly forecast yet" }] };
    render(<MemoryRouter><FirstValueCard result={result} embedded hideStatus hideOpen run={run} /></MemoryRouter>);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const financial = document.querySelector("[data-next-step='financial']");
    expect(financial.querySelector("[data-step-draft-line]").textContent).toBe("Draft ready: Cash after 12 months: ₦1,200,000");
    expect([...financial.querySelectorAll("button")].map((b) => b.textContent)).toContain("Adopt");
    expect(document.querySelector("[data-what-next]")).toBeNull();      // never both
  });
});
