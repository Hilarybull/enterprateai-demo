// In-app dialogs replace the browser's confirm() and alert(); out-of-credits states explain
// themselves where the user is instead of starting (or silently failing to start) an Agent task.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import fs from "node:fs";
import path from "node:path";
import DialogHost from "./DialogHost";
import AgentPanel from "./agent/AgentPanel";
import AdaptiveInsights from "./dashboard/AdaptiveInsights";
import { alertDialog, confirmDialog } from "../lib/dialog";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("in-app dialogs", () => {
  it("confirms with the app's own dialog and resolves true or false", async () => {
    render(<DialogHost />);
    let answer;
    await act(async () => { confirmDialog("Remove this member from the workspace?", { title: "Remove member", confirmLabel: "Remove member", danger: true }).then((v) => { answer = v; }); });
    const dialog = screen.getByRole("dialog", { name: "Remove member" });
    expect(dialog.textContent).toContain("Remove this member from the workspace?");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove member" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remove member" })); });
    expect(answer).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => { confirmDialog("Stop?").then((v) => { answer = v; }); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancel" })); });
    expect(answer).toBe(false);
    await act(async () => { confirmDialog("Stop?").then((v) => { answer = v; }); });
    await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });      // Escape cancels
    expect(answer).toBe(false);
  });

  it("shows a message with one button, and queues a second request behind the first", async () => {
    render(<DialogHost />);
    let done = 0;
    await act(async () => {
      alertDialog("Unable to generate PDF. Please try again.").then(() => { done += 1; });
      alertDialog("Second message", { title: "Note", tone: "info" }).then(() => { done += 1; });
    });
    expect(screen.getByRole("alertdialog", { name: "Something went wrong" }).textContent).toContain("Unable to generate PDF");
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "OK" })); });
    expect(screen.getByRole("alertdialog", { name: "Note" }).textContent).toContain("Second message");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "OK" })); });
    expect(done).toBe(2);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("no page calls the browser's confirm, alert or prompt any more", () => {
    const offenders = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (/\.(jsx|js)$/.test(name) && !/\.test\./.test(name)) {
          fs.readFileSync(full, "utf8").split("\n").forEach((line, i) => {
            if (/(^|[^\w.])(window\.)?(confirm|alert|prompt)\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)) offenders.push(`${name}:${i + 1}`);
          });
        }
      }
    };
    walk(path.resolve(__dirname, ".."));
    expect(offenders).toEqual([]);
  });
});

describe("out of AI Credits", () => {
  const card = { key: "next_step", widget_id: "next_step", title: "Recommended Next Step", tone: "brand", state: "available", priority_class: 2,
    text: "Your receivables are slipping past terms.", cta: { label: "Run scenario", to: "/simulation" }, items: [],
    agent_action: { label: "Ask Agent to prepare a follow-up", capability: "payment_followup" },
    why: { summary: "Invoices are overdue.", source: "Invoices", evidence: [], missing: [] } };
  const dash = (exhausted) => ({ insights: [card], preferences: { hidden_widget_ids: [] }, entitlement: { credits_exhausted: exhausted } });

  it("locks the card's Agent action and explains on the card, with a way to plans and a way out", () => {
    const onAction = vi.fn();
    render(<AdaptiveInsights dashboard={dash(true)} onAction={onAction} onWhy={() => {}} onHide={() => {}} onRetry={() => {}} onShowHidden={() => {}} />);
    const locked = screen.getByRole("button", { name: "Ask Agent to prepare a follow-up (out of AI Credits)" });
    expect(locked.getAttribute("title")).toBe("Out of AI Credits · Upgrade");
    fireEvent.click(locked);
    expect(onAction).not.toHaveBeenCalled();                                 // nothing started, no navigation
    const article = screen.getByRole("article");
    expect(article.textContent).toContain("You're out of AI Credits. Your records are safe. Top up or upgrade to let the Agent do this.");
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(article.textContent).not.toContain("Your records are safe");
    fireEvent.click(locked);
    fireEvent.click(article.querySelector("button.bg-amber-600"));           // "See plans and credits" on the card
    expect(onAction).toHaveBeenCalledWith(card, { to: "/pricing", upgrade: true });
    fireEvent.click(screen.getByRole("button", { name: "Run scenario" }));   // the ordinary button still works
    expect(onAction).toHaveBeenLastCalledWith(card, card.cta);
  });

  it("leaves the Agent action as it was when there are credits", () => {
    const onAction = vi.fn();
    render(<AdaptiveInsights dashboard={dash(false)} onAction={onAction} onWhy={() => {}} onHide={() => {}} onRetry={() => {}} onShowHidden={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Ask Agent to prepare a follow-up/ }));
    expect(onAction.mock.calls[0][1]).toMatchObject({ capability: "payment_followup", agent: true });
  });

  describe("Agent panel", () => {
    function Where() { return <p data-testid="where">{useLocation().pathname + useLocation().search}</p>; }
    const shortcuts = [
      { key: "validate_idea", label: "Validate Idea", icon: "bulb", action: { to: "/validation" } },
      { key: "opportunities", label: "Opportunities", icon: "doc", action: { to: "/marketplace" } },
      { key: "scenario_help", label: "Scenario Help", icon: "bars", action: { capability: "scenario_help" } },
      { key: "quote_to_cash", label: "Quote to Invoice", icon: "doc", action: { capability: "quote_to_cash" } }];
    const summary = (credits) => ({ suggestions: [{ key: "followup", icon: "chat", text: "Would you like me to prepare a payment follow-up?", action: { capability: "payment_followup" } }],
      needs_approval: [], shortcuts, entitlement: { is_paid: false, monthly_runs: 5, monthly_runs_used: 1, credits } });
    const mount = (credits) => render(<MemoryRouter initialEntries={["/dashboard"]}><Routes>
      <Route path="/dashboard" element={<AgentPanel businessId="ws1" summary={summary(credits)} onChanged={() => {}} />} />
      <Route path="*" element={<Where />} /></Routes></MemoryRouter>);

    beforeEach(() => { globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })); });

    it("a suggestion that starts a task says so when there are no credits", () => {
      mount(0);
      expect(screen.queryByRole("button", { name: /Scenario Help|Quote to Invoice|Validate Idea/ })).toBeNull();      // no shortcut chips under the field
      fireEvent.click(screen.getByText("Would you like me to prepare a payment follow-up?"));      // a suggestion that starts a task
      expect(screen.getByRole("status").textContent).toContain("out of AI Credits");
      expect(globalThis.fetch.mock.calls.filter(([, init]) => init?.method === "POST").length).toBe(0);      // nothing was started (the card only reads its briefing)
    });

    it("locks nothing when there are credits", () => {
      mount(12);
      expect(screen.queryByRole("button", { name: /out of AI Credits/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Scenario Help" })).toBeNull();      // no shortcut chips
    });
  });
});
