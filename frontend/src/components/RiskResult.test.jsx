// The Business Risk Check's result, pressed as the owner would (the owner's brief, 24 Oct, R-2 to R-6): no score, only real
// risks as cards with short titles and a working button each, what isn't on record answered in place and the result updated,
// the engines under "How this was worked out", and the shared line.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = [];
const answered = { assessment_type: "business_risk_initial", headline: "Business Risk Check", score: null, currency_sign: "£",
  blockers: [{ key: "concentration", label: "Delta Offices Ltd is 100% of your paid income", kind: "failed", why: "Losing them would take that share of your income with it." },
    { key: "key_person", label: "The business slows down without you", kind: "partial", why: "A month away would slow the work and the income." }],
  not_on_record: [], fine: ["About 16.7 months of cash at your recorded spending (£381.50 in the bank)", "No invoices overdue"],
  engines: { survival: 85, stability: 44, fragility: 47 }, free_next_actions: [], strengths: [], metrics: [], premium_next_action: null };
vi.mock("../api/client", () => ({
  apiRequest: vi.fn(async (path, method, body) => {
    calls.push({ path, method, body });
    if (path.endsWith("/answers")) return { result: answered, session_id: "S1" };
    return {};
  }),
}));
vi.mock("../store/workspace", () => ({ useWorkspaceStore: (pick) => pick({ workspaceId: "W1" }) }));

import FirstValueCard from "./FirstValueCard";

afterEach(() => { cleanup(); calls.length = 0; });
const open = { ...answered, _session: "S1", blockers: [answered.blockers[0]], engines: null,
  not_on_record: [{ key: "key_person", label: "What happens when you're away isn't known yet", ask: "key_person" }] };

function Where() { return <p data-where>{useLocation().pathname + useLocation().search}</p>; }
const page = (result) => render(<MemoryRouter initialEntries={["/check/risks"]}><Routes><Route path="*" element={<><FirstValueCard result={result} /><Where /></>} /></Routes></MemoryRouter>);

describe("the risk result", () => {
  it("says risks, with no score, and only real risks as cards", () => {
    page(open);
    expect(document.querySelector("[data-fv-score]")).toBeNull();
    expect(document.querySelector("[data-status-sentence]").textContent).toBe("1 risk to act on.");
    expect([...document.querySelectorAll("[data-step-title]")].map((x) => x.textContent)).toEqual(["Relying on one customer"]);
    expect(document.body.textContent).toContain("Delta Offices Ltd is 100% of your paid income.");
    expect(document.querySelector("[data-ai-can-err]").textContent).toContain("can make mistakes");
  });

  it("answers the away question on the result, and shows the updated result", async () => {
    page(open);
    fireEvent.click(document.querySelector('[data-gap-answer="slows"]'));
    await waitFor(() => expect(calls.some((c) => c.path === "/task-sessions/S1/answers" && c.body.answers.key_person === "slows")).toBe(true));
    await waitFor(() => expect([...document.querySelectorAll("[data-step-title]")].map((x) => x.textContent)).toEqual(["Relying on one customer", "Cover if you're away for a month"]));
    expect(document.body.textContent).toContain("A month away would slow the work and the income.");
    expect(document.body.textContent).not.toContain("could stop");
    expect(document.querySelector("[data-fv-engines]").textContent).toContain("Survival engine: 85/100");
  });

  it("each card's button goes to its exact place", () => {
    page(open);
    fireEvent.click(screen.getByText("Run a what-if: lose them"));
    expect(document.querySelector("[data-where]").textContent).toBe("/simulation?template=tmpl_client_loss");
  });

  it("a missing record's button opens the form to record it", () => {
    page({ ...open, not_on_record: [{ key: "runway", label: "I can't tell how long your cash would last because no expenses are recorded. Add last month's expenses and I'll show you." }] });
    fireEvent.click(document.querySelector('[data-gap-go="runway"]'));
    expect(document.querySelector("[data-where]").textContent).toBe("/operations?tab=Transactions&sub=Expenses&new=expense");
  });
});
