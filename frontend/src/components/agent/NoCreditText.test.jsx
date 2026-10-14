// The Agent never says what anything cost (the owner's rule, 14 Oct 2026): not in a chat reply, a task's reply or its
// page, a task card or tile, an approval, a question or a notice. The sidebar balance, the Credits page (each charge,
// with its task) and the prices in Agent settings say it. The one sentence the Agent says about credits is when there
// aren't enough: "This needs 40 credits; you have 31. Top up."
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AgentPanel, { blockedReply } from "./AgentPanel";
import { replyText } from "../../lib/agent";

afterEach(cleanup);

// Where the Agent speaks: every string a person can read in these files.
const AGENT_FILES = ["components/agent/AgentPanel.jsx", "components/agent/AgentBits.jsx", "components/agent/TaskFlow.jsx",
  "components/agent/DraftEditor.jsx", "components/agent/AgentShell.jsx", "lib/agent.js", "pages/AgentRunPage.jsx",
  "pages/AgentCentrePage.jsx", "components/BusinessAssistant.jsx", "components/dashboard/AdaptiveInsights.jsx", "pages/StartPage.jsx",
  "pages/DashboardPage.jsx"];
// Not a price: codes, keys, event names and routes ("credits_exhausted", "ea:credits:refresh", "/credits").
const CODE = /^[\w:/.\-${}?=&]*$/;
// Not the price of the Agent's work: credit notes and what an invoice is credited with.
const ACCOUNTING = /credit(?:[ _]?notes?|ed\b|_amount)|amount to credit|the credit\b|more than the credit|credits the invoice/i;
// The one sentence about credits: there aren't enough.
const SHORT_OF = /^(?:This needs \d+ credits?; you have \d+\. Top up\.|You have no credits left\..*|No credits left(?: · Top up)?|.*\(no credits left\))$/;
// Agent settings: its price list and its monthly budget for automatic work.
const SETTINGS = new Set(["AI Credits", "Monthly budget for automatic work (AI Credits)", " Cost: ${e.credits}.",
  " Paused: automatic work that costs credits waits until you raise this or the month ends.",
  " When it is used up, automatic work that costs credits pauses; free work carries on."]);

function readable(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  const found = [];
  for (const m of code.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) found.push(m[2]);
  for (const m of code.matchAll(/>([^<>{}]+)</g)) found.push(m[1].trim());
  return found.filter((t) => /credit/i.test(t));
}

describe("no Agent string speaks of credits", () => {
  it("in any file where the Agent speaks, except the not-enough sentence, accounting words and Agent settings", () => {
    const said = AGENT_FILES.flatMap((file) => readable(readFileSync(resolve(__dirname, "../..", file), "utf8")).map((t) => `${file}: ${t}`));
    const left = said.filter((line) => {
      const t = line.slice(line.indexOf(": ") + 2);
      return !CODE.test(t) && !ACCOUNTING.test(t) && !SHORT_OF.test(t) && !SETTINGS.has(t);
    });
    expect(left).toEqual([]);
  });
});

describe("snapshots: what the owner reads", () => {
  it("a completed task", () => {
    const run = { id: "r1", status: "succeeded", workflow_key: "new_invoice", summary: "Invoice INV-7 was sent to dana@novalabs.test.",
      next_action: "I'll remind them if it isn't paid by 28 Oct.", credits_used: 4, credits: [{ what: "Preparing the invoice", credits: 2 }] };
    expect(replyText({ kind: "workflow", run, runs: [run], credits_used: 4, credits_left: 40 }))
      .toBe("Invoice INV-7 was sent to dana@novalabs.test. I'll remind them if it isn't paid by 28 Oct.");
  });

  it("a refused task", () => {
    expect(blockedReply({ kind: "blocked", reason: "credits", reason_codes: ["credits_exhausted"], message: "This needs 40 credits; you have 31. Top up.",
      actions: [{ label: "Top up", to: "/pricing", upgrade: true }] }))
      .toEqual({ tone: "amber", card: "credits", text: "This needs 40 credits; you have 31. Top up.", detail: "Nothing was started.",
        actions: [{ label: "Top up", to: "/pricing", upgrade: true }] });
  });

  describe("a chat reply", () => {
    let reply;
    beforeEach(() => {
      reply = { kind: "answer", message: "Your best month was August, at £4,200.", conversational: true, credits_used: 2, credits_left: 38 };
      globalThis.fetch = vi.fn(async (url, init) => new Response(JSON.stringify(init?.method === "POST" ? reply : {}), { status: 200, headers: { "Content-Type": "application/json" } }));
    });

    it("is only the answer, on the card and anywhere on the page", async () => {
      const summary = { suggestions: [], needs_approval: [], entitlement: { is_paid: true, agent_tasks: true, monthly_runs: 50, monthly_runs_used: 3, credits: 38 } };
      render(<MemoryRouter><AgentPanel businessId="ws1" summary={summary} onChanged={() => {}} /></MemoryRouter>);
      fireEvent.change(screen.getByLabelText("Ask the EnterprateAI Agent"), { target: { value: "what was my best month?" } });
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
      await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Your best month was August, at £4,200."));
      expect(document.body.textContent).not.toMatch(/credit/i);
      expect(document.querySelector("[data-credits-used]")).toBeNull();
    });
  });
});

describe("the Credits page lists each Agent charge", () => {
  it("with the task's name, what it paid for, and a link to the task", async () => {
    const { AgentCharges } = await import("../../pages/CreditsPage");
    const charges = [{ run_id: "r9", task: "New Invoice", what: "Preparing the invoice", credits: 2, at: "2026-10-14T09:00:00+00:00", link: "/agent/runs/r9" }];
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ charges }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<MemoryRouter><AgentCharges businessId="ws1" /></MemoryRouter>);
    const link = await screen.findByRole("link", { name: "New Invoice" });
    expect(link.getAttribute("href")).toBe("/agent/runs/r9");
    expect(document.querySelector("[data-agent-charges]").textContent).toContain("Preparing the invoice");
    expect(String(globalThis.fetch.mock.calls[0][0])).toContain("/businesses/ws1/agent/charges");
  });
});

describe("F3: written answers and refunds are on the Credits page too", () => {
  it("lists a written answer by its question, a refund as given back, and the total", async () => {
    const { AgentCharges } = await import("../../pages/CreditsPage");
    const charges = [
      { run_id: null, task: "Written answer", what: "what was my best month?", credits: 2, at: "2026-10-13T10:00:00+00:00", link: null },
      { run_id: "r9", task: "Business Plan Draft", what: "Refunded: it didn't finish", credits: -40, at: "2026-10-13T23:30:00+00:00", link: "/agent/runs/r9" },
      { run_id: "r9", task: "Business Plan Draft", what: "Agent work", credits: 40, at: "2026-10-13T22:59:00+00:00", link: "/agent/runs/r9" }];
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ charges, total: 2 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<MemoryRouter><AgentCharges businessId="ws1" /></MemoryRouter>);
    expect(await screen.findByText("Written answer")).toBeTruthy();
    expect(screen.getByText(/what was my best month\?/)).toBeTruthy();
    expect(screen.getByText("+40")).toBeTruthy();
    expect(document.querySelector("[data-agent-charges-total]").textContent).toBe("2");
  });
});
