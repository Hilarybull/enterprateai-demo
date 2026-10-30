// The owner's mockups, 27 Oct ("exactly like the mockups"): the Assistant tab's conversation and its cards.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

const replies = [];
vi.mock("../../lib/agent", async () => {
  const real = await vi.importActual("../../lib/agent");
  return { ...real, getChat: vi.fn(async () => ({ messages: [] })), saveChat: vi.fn(async () => ({})), submitAgentRequest: vi.fn(async () => replies.shift()),
    approveAction: vi.fn(async () => ({})) };
});
vi.mock("../../api/client", () => ({
  apiRequest: vi.fn(async () => ({ business: { name: "Acme Innovations", stage: "Growth", sector: "B2B Software", location: "London, UK" },
    revenue: { total: 480000, pct: 12, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], currency: "GBP", has_any: true },
    records: [{ key: "profile", label: "Business profile", available: true }, { key: "costs", label: "Operating costs", available: false }],
    activity: [{ kind: "invoice_paid", title: "Invoice paid", detail: "£12,000 from BrightTech Ltd", at: new Date().toISOString() }],
    approvals: { count: 0, items: [] }, research: { state: "none" }, working: false })),
}));
import { approveAction, saveChat, submitAgentRequest } from "../../lib/agent";
import { apiRequest } from "../../api/client";
import CaseAssistant from "./CaseAssistant";

afterEach(() => { cleanup(); replies.length = 0; });

const subject = { id: "c1", title: "Seed round", kind: "funding_case", summary: { score: 40, classification: "not_ready" },
  sections: [{ key: "need", title: "Funding requirement", answered: 0, total: 3 }, { key: "funds", title: "Use of funds", answered: 1, total: 4 },
    { key: "profile", title: "Business profile", answered: 4, total: 4 }] };

it("answers with what it checked and the result, then continues on Help me complete it", async () => {
  replies.push({ kind: "answer", message: "Of course. Let me first check what I already know about your business.", actions: [],
    cards: [{ type: "records", case_id: "c1" }, { type: "result", case_id: "c1" }] },
  { kind: "answer", message: "I'll research the market for your case. Up to 60 credits. Shall I start?", actions: [{ label: "Not now", kind: "explain", prompt: "Not now" }],
    cards: [{ type: "choose", case_id: "c1", price: 60 }] },
  { kind: "answer", message: "Started.", actions: [], cards: [{ type: "progress", case_id: "c1" }] });
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="funding" subject={subject} steps={[]} score={40} onTab={() => {}} /></MemoryRouter>);
  expect(await screen.findByText("Acme Innovations")).toBeTruthy();
  expect(screen.getByText("£480,000")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "How ready am I for funding?" }));
  expect(await screen.findByText(/Let me first check what I already know/)).toBeTruthy();
  expect(document.querySelector('[data-card="records"]')).toBeTruthy();
  const result = document.querySelector('[data-card="result"]');
  expect(result.textContent).toContain("Your funding readiness result");
  expect(result.textContent).toContain("Important gaps identified");
  expect(result.textContent).toMatch(/Funding requirement.*Missing/);
  expect(result.textContent).toMatch(/Use of funds.*Incomplete/);
  expect(result.textContent).not.toContain("Business profileCompleted");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Go ahead. Help me complete it." } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const choose = await waitFor(() => { const c = document.querySelector('[data-card="choose"]'); if (!c) throw new Error("no card"); return c; });
  expect(choose.textContent).toContain("Recommended");
  fireEvent.click(screen.getByRole("button", { name: "Start · up to 60 credits" }));
  await waitFor(() => expect(submitAgentRequest).toHaveBeenLastCalledWith({ businessId: "b1", text: "Yes, start", page: "funding" }));
  expect(await screen.findByText("Funding research in progress")).toBeTruthy();
  const saved = saveChat.mock.calls.at(-1);
  expect(saved[1]).toBe("case-c1");
  expect(saved[2].at(-1).cards).toEqual([{ type: "progress", case_id: "c1" }]);      // kept, so it reopens the same
});

it("never shows a dash in what the owner reads", async () => {
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="launch" subject={{ ...subject, kind: "launch_initiative" }} steps={[]} score={null} onTab={() => {}} /></MemoryRouter>);
  await screen.findByText("Readiness Snapshot");      // a launch's own side cards (idea-06)
  expect(screen.getByText("Why not fully launch yet?")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/[–—]/);
});

const withDrafts = { ...subject, data: { purpose: "a van", agent_drafts: { purpose: { value: "A second van and a driver", source: "from market research" },
  market_note: { value: "UK van hire grows 4% a year", source: "from research" } } },
  profile_definition: { sections: [{ key: "need", title: "Funding requirement", fields: [{ key: "purpose", label: "What it's for" }] },
    { key: "market", title: "Market evidence", fields: [{ key: "market_note", label: "Market opportunity" }] }] } };

it("reviews the drafts like the mockups: areas, sources, edit, Approve all, then the check's result", async () => {
  const onField = vi.fn();
  const view = (props) => <MemoryRouter initialEntries={["/funding/c1?tab=assistant&review=1"]}><CaseAssistant businessId="b1" feature="funding" subject={withDrafts} steps={[]} onTab={() => {}} onField={onField} {...props} /></MemoryRouter>;
  const { rerender } = render(view({ score: 40, checking: false }));
  expect(await screen.findByText("Review enriched information")).toBeTruthy();
  expect(screen.queryAllByRole("tab")).toEqual([]);      // in the conversation: no tabs, no second chat, no way "back"
  expect(screen.queryByText("Back to the conversation")).toBeNull();
  expect(screen.getAllByLabelText("Conversation").length).toBe(1);
  expect(document.querySelector('[aria-label="Conversation"] [data-review-screen]')).toBeTruthy();
  expect(screen.getAllByText("External research").length).toBe(2);      // both drafts at once, each with its source
  fireEvent.change(screen.getByLabelText("What it's for"), { target: { value: "A second van" } });
  expect(screen.getByText("Edited by you")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "✓ Approve all" }));
  expect(onField).toHaveBeenCalledWith("purpose", "A second van");      // the owner's edit, not the draft
  expect(onField).toHaveBeenCalledWith("market_note", "UK van hire grows 4% a year");
  expect(onField).toHaveBeenLastCalledWith("agent_drafts", {});
  expect(await screen.findByText(/Done. I've added 2 drafts to your case/)).toBeTruthy();
  rerender(view({ score: null, checking: true }));
  rerender(view({ score: 64, checking: false }));
  expect(await screen.findByText("I've run your funding readiness check again. You're at 64/100.")).toBeTruthy();
  expect(document.querySelector('[data-card="score_change"]').textContent).toContain("from 40/100 to 64/100");
  expect(document.querySelector('[data-card="next"]')).toBeTruthy();
});

it("edits a list draft in place, never on another tab, and approves the edited rows", async () => {
  const onField = vi.fn();
  const onTab = vi.fn();
  const rows = [{ id: "m1", outcome: "First batch made", due_date: "2026-12-10", owner: "Hilary", status: "open" }];
  const s = { ...withDrafts, data: { ...withDrafts.data, agent_drafts: { "control.milestones": { value: rows, source: "suggested by the Agent", at: "2026-10-30" } } } };
  render(<MemoryRouter initialEntries={["/launch/c1?tab=assistant&review=1"]}><CaseAssistant businessId="b1" feature="funding" subject={s} steps={[]} score={10} onTab={onTab} onField={onField} /></MemoryRouter>);
  await screen.findByText("Review enriched information");
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(onTab).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/1 Outcome$/), { target: { value: "Soap launched" } });
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  expect(onField).toHaveBeenCalledWith("control.milestones", [{ ...rows[0], outcome: "Soap launched" }]);
});

it("shows a spinner while approved drafts save and check, and says plainly when the save fails", async () => {
  const onField = vi.fn();
  const view = (props) => <MemoryRouter initialEntries={["/funding/c1?tab=assistant&review=1"]}><CaseAssistant businessId="b1" feature="funding" subject={withDrafts} steps={[]} onTab={() => {}} onField={onField} score={40} checking={false} {...props} /></MemoryRouter>;
  const { rerender } = render(view({ saveState: { state: "saved" } }));
  await screen.findByText("Review enriched information");
  fireEvent.click(screen.getByRole("button", { name: "✓ Approve all" }));
  expect(await screen.findByText("Saving your answers…", {}, { timeout: 100 }).catch(() => screen.findByText("Running your check…"))).toBeTruthy();
  rerender(view({ saveState: { state: "saving" } }));
  expect(await screen.findByText("Saving your answers…")).toBeTruthy();
  rerender(view({ saveState: { state: "error", message: "Some answers need correcting before they can be saved." } }));
  await waitFor(() => expect(document.body.textContent).toMatch(/I couldn.t save those to your case:\s*Some answers need correcting before they can be saved\. Next step: open Inputs/));
  expect(document.querySelector('[data-card="rechecking"]')).toBeNull();
});

it("a price said has Start and Not now, and go ahead starts that task with its price confirmed (the owner, 30 Oct)", async () => {
  replies.push({ kind: "needs_confirmation", capability: "idea_validation", params: { idea: "phone repair kiosk" }, price: 25,
    message: "I'll validate your idea. It costs 25 credits, and you have 341." });
  replies.push({ kind: "answer", message: "Your idea validation is under way.", actions: [] });
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="funding" subject={subject} steps={[]} score={40} onTab={() => {}} /></MemoryRouter>);
  await screen.findByText("Acme Innovations");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Test my idea: a phone repair kiosk" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText(/It costs 25 credits/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "go ahead" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("Your idea validation is under way.")).toBeTruthy();
  expect(submitAgentRequest).toHaveBeenLastCalledWith(expect.objectContaining({ capability: "idea_validation", params: { idea: "phone repair kiosk" }, confirmed: true }));
});

it("lists approvals waiting and sends one only on Approve send", async () => {
  apiRequest.mockImplementation(async () => ({ business: { name: "Acme Innovations" }, records: [], activity: [], research: { state: "none" }, working: false,
    approvals: { count: 1, items: [{ approval_id: "a1", run_id: "r1", kind: "payment", title: "Payment follow-up draft", subtitle: "For Northbridge Solutions", age: "2h" }] } }));
  replies.push({ kind: "answer", message: "And one more thing: two reminders are waiting for your approval.", actions: [], cards: [{ type: "approvals", case_id: "c1" }] });
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="funding" subject={subject} steps={[]} score={40} onTab={() => {}} /></MemoryRouter>);
  await screen.findByText("Acme Innovations");
  fireEvent.click(screen.getByRole("button", { name: "What's missing?" }));
  const card = await waitFor(() => { const c = document.querySelector('[data-card="approvals"]'); if (!c) throw new Error("no card"); return c; });
  expect(card.textContent).toContain("Payment follow-up draft");
  expect(approveAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Approve send" }));
  await waitFor(() => expect(approveAction).toHaveBeenCalledWith("r1", "a1"));
  expect(await screen.findByText("Sent")).toBeTruthy();
});

it("sends a message handed over from the landing page once", async () => {
  replies.push({ kind: "answer", message: "Of course. Let me first check what I already know.", actions: [] });
  render(<MemoryRouter initialEntries={["/funding/c1?tab=assistant&message=I%20need%20funding"]}><CaseAssistant businessId="b1" feature="funding" subject={subject} steps={[]} score={40} onTab={() => {}} /></MemoryRouter>);
  expect(await screen.findByText("Of course. Let me first check what I already know.")).toBeTruthy();
  expect(submitAgentRequest).toHaveBeenCalledWith({ businessId: "b1", text: "I need funding", page: "funding" });
  expect(submitAgentRequest.mock.calls.filter((c) => c[0].text === "I need funding").length).toBe(1);
});

it("tests an idea like the mockups: inputs, viability, launch fit, the risk, and its research from the chat", async () => {
  const { ideaSubject } = await import("./CaseAssistant");
  const idea = { answers: { description: "AI Document Automation", customer: "SME professional services", price: 180, cost: 40 },
    inputs: [{ key: "customer", label: "Customer profile", available: true }, { key: "demand", label: "Current demand evidence", available: false }],
    score_out_of_100: 62, viability: "Fair", strengths: ["Workable margin", "Delivery capacity appears feasible"], weaknesses: ["Demand is largely unproven", "Competitor pricing is unknown"],
    metrics: [{ label: "Margin", value: "78%" }], criteria: [{ key: "idea", state: "met" }, { key: "customer", state: "met" }, { key: "margin", state: "met" },
      { key: "break_even", state: "met" }, { key: "capacity", state: "met" }, { key: "demand", state: "unmet" }, { key: "competitors", state: "unknown" }] };
  apiRequest.mockImplementation(async () => ({ business: { name: "Altmosphere Consulting" }, records: [], activity: [], approvals: { count: 0, items: [] },
    research: { state: "none", max: 60 }, working: false, idea, risk: { customer: "Livont Limited", share: 66, others: 22, tail: 12, tail_count: 8, level: "High" } }));
  replies.push({ kind: "answer", message: "Let me check what I already know about your business first.", actions: [], cards: [{ type: "idea_inputs", case_id: "idea" }, { type: "viability", case_id: "idea" }] },
    { kind: "answer", message: "Your offer is strong, but test it first.", actions: [], cards: [{ type: "launch_fit", case_id: "idea" }, { type: "risk", case_id: "idea" }] },
    { kind: "answer", message: "I can research it for you.", actions: [], cards: [{ type: "choose", case_id: "idea" }] });
  const onResearch = vi.fn(async () => ({ completed: true, run: "r1", message: "Done. I found 3 things for your idea (60 credits)." }));
  const subject = ideaSubject(idea);
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="idea" subject={subject} score={62} onTab={() => {}} onResearch={onResearch} /></MemoryRouter>);
  expect(await screen.findByText("Viability Snapshot")).toBeTruthy();
  expect(screen.getByText("Idea Context")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Is my idea worth launching?" }));
  await screen.findByText(/Let me check what I already know/);
  expect(document.querySelector('[data-card="records"]').textContent).toMatch(/service idea inputs/);
  const viability = document.querySelector('[data-card="viability"]');
  expect(viability.textContent).toContain("Fair Viability");
  expect(viability.textContent).toContain("Demand is largely unproven");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "So, am I ready to launch?" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const fit = await waitFor(() => { const c = document.querySelector('[data-card="launch_fit"]'); if (!c) throw new Error("no card"); return c; });
  expect(fit.textContent).toContain("Test before full launch");
  expect(fit.textContent).toMatch(/Real-world traction\s*Insufficient/);
  expect(document.querySelector('[data-card="risk"]').textContent).toContain("Livont Limited");
  fireEvent.click(screen.getByRole("button", { name: "Run market research" }));
  await waitFor(() => expect(document.querySelector('[data-card="choose"]')).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Start · up to 60 credits" }));
  await waitFor(() => expect(onResearch).toHaveBeenCalledTimes(1));
  // One line and where to go on this page, never Agent tasks (QA, 30 Oct)
  expect(await screen.findByText("Done. I found 3 things for your idea (60 credits).")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Review findings" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "See your result" })).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/Agent tasks/);
  expect(document.body.textContent).not.toMatch(/[–—]/);
});

it("reads the page again after every reply, so what the Agent saved shows without a reload (5)", async () => {
  const { ideaSubject } = await import("./CaseAssistant");
  apiRequest.mockImplementation(async () => ({ business: { name: "Acme Innovations" }, records: [], activity: [], approvals: { count: 0, items: [] }, research: { state: "none" }, working: false,
    idea: { answers: {}, inputs: [], criteria: [], strengths: [], weaknesses: [], partial_score: 57, viability: null } }));
  replies.push({ kind: "answer", message: "Got it: ₦25,000 a car, 40 cars a month.", actions: [], cards: [{ type: "viability", case_id: "idea" }] });
  const onChanged = vi.fn();
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="idea" subject={ideaSubject({ partial_score: 57 })} score={57} onTab={() => {}} onChanged={onChanged} /></MemoryRouter>);
  await screen.findByText("Acme Innovations");
  const before = apiRequest.mock.calls.length;
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Price ₦25,000 per car, expect 40 cars a month" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText(/Got it/);
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(apiRequest.mock.calls.length).toBeGreaterThan(before);      // the side column and cards read again
  expect(document.querySelector('[data-card="viability"]').textContent).not.toContain("Tell me your price");      // a score: no "tell me" line
});

it("shows drafted spending lines in the currency, once each, and flags lines that don't add up to the ask (8)", async () => {
  const lines = { ...subject, data: { currency: "NGN", target_amount: "25000000", agent_drafts: { use_of_funds: { source: "from research", value: [
    { id: "a", category: "Equipment", amount: "9880000", purpose: "Buy car wash equipment" },
    { id: "b", category: "Reserve", amount: "120000", purpose: "Reserve: one month of fixed costs" }] } } },
    profile_definition: { sections: [{ key: "funds", title: "Use of funds", fields: [{ key: "use_of_funds", label: "Use of funds" }] }] } };
  render(<MemoryRouter initialEntries={["/funding/c1?tab=assistant&review=1"]}><CaseAssistant businessId="b1" feature="funding" subject={lines} steps={[]} score={40} onTab={() => {}} onField={vi.fn()} /></MemoryRouter>);
  const card = await waitFor(() => { const c = document.querySelector('[data-draft-review="use_of_funds"]'); if (!c) throw new Error("no card"); return c; });
  expect(card.textContent).toContain("₦9,880,000");
  expect(card.textContent).not.toContain("NGN");
  expect(card.textContent.match(/Reserve: one month of fixed costs/g).length).toBe(1);
  expect(card.querySelector("[data-lines-gap]").textContent).toContain("₦15,000,000 less than the ₦25,000,000");
});

it("shows a change with Apply and Cancel, never links to the case it is on, and a message can be removed", async () => {
  replies.push({ kind: "answer", message: "Here's the change I'd make to your case. Apply it?",
    actions: [{ label: "Open your funding case", to: "/funding/c1?tab=overview" }, { label: "Apply", kind: "explain", prompt: "Apply" }, { label: "Cancel", kind: "explain", prompt: "Cancel" }],
    cards: [{ type: "change", case_id: "c1", rows: [{ label: "Amount", before: "₦25,000,000", after: "₦30,000,000" }] }] },
  { kind: "answer", message: "Done. I've updated your funding case.", actions: [], changed: ["updated", "checked"] });
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="funding" subject={subject} steps={[]} score={40} onTab={() => {}} /></MemoryRouter>);
  await screen.findByText("Acme Innovations");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "make it 30m" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const card = await waitFor(() => { const c = document.querySelector('[data-card="change"]'); if (!c) throw new Error("no card"); return c; });
  expect(card.textContent).toContain("₦30,000,000");
  expect(screen.queryByRole("button", { name: "Open your funding case" })).toBeNull();      // already in it
  expect(screen.getAllByRole("button", { name: "Apply" }).length).toBe(1);      // on the card only, never twice
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(submitAgentRequest).toHaveBeenLastCalledWith({ businessId: "b1", text: "Apply", page: "funding" }));
  expect(await screen.findByText("Done. I've updated your funding case.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();      // done: the card's buttons go
  fireEvent.click(document.querySelector("[data-remove-message]"));
  await waitFor(() => expect(screen.queryByText("make it 30m")).toBeNull());
  expect(screen.queryByText("Here's the change I'd make to your case. Apply it?")).toBeNull();      // with its reply
});


it("a message for another module is taken to its page and never kept in this thread (the owner, 27 Oct)", async () => {
  replies.push({ kind: "answer", message: "That's for your funding case. I'll carry on there.", actions: [], conversational: true, elsewhere: "/funding/f9?tab=assistant" });
  const { Routes, Route, useLocation } = await import("react-router-dom");
  let at = "";
  const Where = () => { const l = useLocation(); at = `${l.pathname}${l.search}`; return null; };
  const { ideaSubject } = await import("./CaseAssistant");
  render(<MemoryRouter initialEntries={["/check/idea?tab=assistant"]}><Routes>
    <Route path="/check/idea" element={<CaseAssistant businessId="b1" feature="idea" subject={ideaSubject({})} score={null} onTab={() => {}} />} />
    <Route path="*" element={<Where />} /></Routes></MemoryRouter>);
  await screen.findByText("Acme Innovations");
  const saves = saveChat.mock.calls.length;
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "I need funding for this" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(at).toBe("/funding/f9?tab=assistant&message=I%20need%20funding%20for%20this"));
  expect(submitAgentRequest).toHaveBeenLastCalledWith({ businessId: "b1", text: "I need funding for this", page: "idea" });
  // Nothing kept in the idea's thread: what was said is saved at once (QA F4, 30 Oct), then taken out when it goes elsewhere
  const own = saveChat.mock.calls.slice(saves).filter(([, id]) => id === "idea-check");
  expect(own.at(-1)?.[2] || []).not.toContainEqual(expect.objectContaining({ content: "I need funding for this" }));
});

it("keeps each page's chat to its own topic: a launch exchange and a launch score are left out of the idea's", async () => {
  const { ownTopic } = await import("./CaseAssistant");
  const said = [{ role: "user", content: "Is my idea viable?" }, { role: "assistant", content: "Mostly. Show some demand. Your launch score is now 0/100 so far, with 16 things to do." },
    { role: "user", content: "Am I ready to launch?" }, { role: "assistant", content: "Your launch plan is at 0/100." }, { role: "user", content: "What about the price?" }];
  expect(ownTopic(said, "idea").map((m) => m.content)).toEqual(["Is my idea viable?", "Mostly. Show some demand.", "What about the price?"]);
  expect(ownTopic(said, "launch").map((m) => m.content)).toEqual(["Am I ready to launch?", "Your launch plan is at 0/100.", "What about the price?"]);      // and the idea's left out there
});

it("opens the business profile beside the chat, with Edit profile the only way to the full page", async () => {
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="funding" subject={subject} steps={[]} score={40} onTab={() => {}} /></MemoryRouter>);
  fireEvent.click((await screen.findAllByRole("button", { name: "View profile →" }))[0]);
  const sheet = await screen.findByRole("dialog", { name: "Business profile" });
  expect(sheet.textContent).toContain("Acme Innovations");
  expect(screen.getByRole("button", { name: "Edit profile" })).toBeTruthy();
  expect(screen.getByLabelText("Conversation")).toBeTruthy();      // the chat still there under it
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog", { name: "Business profile" })).toBeNull();
});

it("shows the funding score beside the chat from the start", async () => {
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="funding" subject={subject} steps={[]} score={40} onTab={() => {}} /></MemoryRouter>);
  await screen.findByText("Acme Innovations");
  expect(document.querySelector('[data-side="score"]')).toBeTruthy();
  expect(document.querySelector('[data-side="download"]')).toBeTruthy();
});

it("approves or rejects one draft on its own, folds it with Undo, and counts down", async () => {
  const onField = vi.fn();
  render(<MemoryRouter initialEntries={["/funding/c1?tab=assistant&review=1"]}><CaseAssistant businessId="b1" feature="funding" subject={withDrafts} steps={[]} score={40} onTab={() => {}} onField={onField} /></MemoryRouter>);
  expect(await screen.findByText("2 drafts waiting")).toBeTruthy();
  const box = document.querySelector('[data-draft-review="purpose"]');
  fireEvent.click(box.querySelector("[data-draft-approve]"));
  expect(onField).toHaveBeenCalledWith("purpose", "A second van and a driver");
  expect(onField).toHaveBeenCalledWith("agent_drafts", { market_note: withDrafts.data.agent_drafts.market_note });      // only that one
  expect(onField).not.toHaveBeenCalledWith("market_note", expect.anything());
  expect(document.querySelector('[data-draft-decided="approved"]').textContent).toContain("Approved");
  fireEvent.click(document.querySelector("[data-draft-undo]"));
  expect(onField).toHaveBeenCalledWith("purpose", "a van");      // put back as it was
  fireEvent.click(document.querySelector('[data-draft-review="market_note"] [data-draft-reject]'));
  expect(onField).toHaveBeenCalledWith("rejected_drafts", ["market_note"]);
  expect(document.querySelector('[data-draft-decided="rejected"]').textContent).toContain("Rejected");
});

it("says why the score changed on its card", async () => {
  replies.push({ kind: "answer", message: "Updated.", actions: [], cards: [{ type: "score_change", case_id: "c1", before: 80, after: 73 }] });
  const why = { ...subject, score_why: { met: [], lost: ["Monthly fixed costs are given"], checklist: false } };
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="funding" subject={why} steps={[]} score={73} onTab={() => {}} /></MemoryRouter>);
  await screen.findByText("Acme Innovations");
  fireEvent.click(screen.getByRole("button", { name: "How ready am I for funding?" }));
  const card = await waitFor(() => { const c = document.querySelector("[data-score-why]"); if (!c) throw new Error("no reason"); return c; });
  expect(card.textContent).toContain("No longer met: Monthly fixed costs are given");
});

it("opens the idea's details in the chat, filled in, and saves only what changed with Undo", async () => {
  apiRequest.mockImplementation(async (url, method) => (method === "POST" ? { result: {} } : { business: { name: "Acme Innovations" }, records: [], activity: [], research: { state: "none" }, working: false,
    approvals: { count: 0, items: [] }, idea: { answers: { description: "Mobile valeting", customer: "Busy professionals", price: 5000, cost: 1500, monthly_sales: 30, capacity: 40, demand: "enquiries" } } }));
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="idea" subject={{ ...subject, id: "idea", kind: "idea" }} steps={[]} score={60} onTab={() => {}} /></MemoryRouter>);
  fireEvent.click((await screen.findAllByRole("button", { name: "Add idea details" }))[0]);
  const card = await waitFor(() => { const c = document.querySelector('[data-card="idea_form"]'); if (!c) throw new Error("no form"); return c; });
  const price = [...card.querySelectorAll("label")].find((l) => l.textContent.startsWith("Price")).querySelector("input");
  expect(price.value).toBe("5000");      // what is known, filled in
  fireEvent.change(price, { target: { value: "6000" } });
  fireEvent.click(card.querySelector("[data-idea-save]"));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/businesses/b1/quick-check/test_idea", "POST", { answers: expect.objectContaining({ price: 6000, cost: 1500 }) }));
  expect(await screen.findAllByText(/Updated Price: .*5,000 → .*6,000\./)).toBeTruthy();
  expect(document.querySelector("[data-idea-undo]")).toBeTruthy();
});

it("typed \"Find new customer segments\" shows the research offer, as its button does", async () => {
  submitAgentRequest.mockClear();
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="funding" subject={subject} steps={[]} score={40} onTab={() => {}} /></MemoryRouter>);
  await screen.findByText("Acme Innovations");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Find new customer segments" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("I can research new customer segments for you.");
  expect(document.querySelector("[data-card=\"segments\"]")).toBeTruthy();
  expect(submitAgentRequest).not.toHaveBeenCalled();
});

it("shows a money draft as money and says where it came from in plain words", async () => {
  const money = { ...subject, data: { currency: "NGN", agent_drafts: { "economics.price": { value: "4000.0", source: "suggested by the Agent" } } },
    profile_definition: { sections: [{ key: "economics", title: "Economics", fields: [{ key: "economics.price", label: "Price per sale", type: "money" }] }] } };
  render(<MemoryRouter initialEntries={["/funding/c1?tab=assistant&review=1"]}><CaseAssistant businessId="b1" feature="funding" subject={money} steps={[]} score={40} onTab={() => {}} onField={() => {}} /></MemoryRouter>);
  const box = await screen.findByLabelText("Price per sale");
  expect(box.value).toMatch(/^₦4,000$/);
  expect(screen.getByText("Suggested by the Agent.")).toBeTruthy();
  expect(screen.queryByText(/Drafted suggested/)).toBeNull();
});

it("hides the drafts-waiting bar until the drafts change", async () => {
  try { localStorage.clear(); } catch { /* none */ }
  const view = (s) => <MemoryRouter><CaseAssistant businessId="b1" feature="funding" subject={s} steps={[]} score={40} onTab={() => {}} onField={() => {}} /></MemoryRouter>;
  const { rerender } = render(view(withDrafts));
  await screen.findByText(/2 drafts are waiting for your review/);
  fireEvent.click(document.querySelector("[data-drafts-hide]"));
  expect(document.querySelector("[data-drafts-waiting]")).toBeNull();
  const more = { ...withDrafts, data: { ...withDrafts.data, agent_drafts: { ...withDrafts.data.agent_drafts, extra: { value: "New", source: "suggested by the Agent" } } } };
  rerender(view(more));
  expect(await screen.findByText(/3 drafts are waiting for your review/)).toBeTruthy();      // a new draft brings it back
});

it("never ends finished launch research without a step: See your next steps lists them in the chat", async () => {
  apiRequest.mockImplementation(async () => ({ business: { name: "Acme Innovations" }, records: [], activity: [], approvals: { count: 0, items: [] }, working: false,
    research: { state: "adopted", run_id: "r1", findings: 2 } }));
  replies.push({ kind: "answer", message: "Here's where it stands.", actions: [], cards: [{ type: "progress", case_id: "p1" }] });
  const plan = { ...subject, id: "p1", kind: "launch_initiative", assessment: { id: "a1" },
    actions: [{ id: "x1", code: "C1.B", criterion: "C1", status: "open", title: "Confirm you have reviewed the evidence", why: "No reviewer has confirmed this yet." }] };
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="launch" subject={plan} steps={[]} score={38} onTab={() => {}} /></MemoryRouter>);
  await screen.findByText("Readiness Snapshot");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "how did the research go?" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const next = await waitFor(() => { const b = document.querySelector("[data-see-next]"); if (!b) throw new Error("no button"); return b; });
  fireEvent.click(next);
  expect(await screen.findByText(/Here's what's left on your plan/)).toBeTruthy();
  expect(document.querySelector('[data-card="steps"]').textContent).toContain("Confirm you have reviewed the evidence");
});

it("lets idea findings be accepted all at once and opens the validation results", async () => {
  const onTab = vi.fn();
  apiRequest.mockImplementation(async (url, method) => {
    if (/\/research\/r1$/.test(url)) return { research: { id: "r1", items: [{ id: "a", kind: "researched" }, { id: "b", kind: "estimated" }, { id: "q", kind: "question" }] } };
    if (/\/review$/.test(url)) return {};
    return { business: { name: "Acme Innovations" }, records: [], activity: [], approvals: { count: 0, items: [] }, working: false,
      research: { state: "review", run_id: "r1", findings: 2 }, idea: { answers: { description: "Mat washing" } } };
  });
  replies.push({ kind: "answer", message: "Here's where it stands.", actions: [], cards: [{ type: "progress", case_id: "idea" }] });
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="idea" subject={{ ...subject, id: "idea", kind: "idea" }} steps={[]} score={57} onTab={onTab} /></MemoryRouter>);
  await screen.findByText("Acme Innovations");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "how did the research go?" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const accept = await waitFor(() => { const b = document.querySelector("[data-accept-all]"); if (!b) throw new Error("no button"); return b; });
  fireEvent.click(accept);
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/businesses/b1/research/r1/review", "POST", { decisions: { a: { decision: "accept" }, b: { decision: "accept" } } }));
  fireEvent.click(document.querySelector("[data-see-results]"));      // the real Idea Validation, never the quick check tab (29 Oct)
  await waitFor(() => expect(submitAgentRequest).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Run the idea validation and fill the form", page: "idea" })));
  expect(onTab).not.toHaveBeenCalledWith("assessment");
});

it("Enter information myself opens the idea's details in the chat, never another tab", async () => {
  const onTab = vi.fn();
  apiRequest.mockImplementation(async () => ({ business: { name: "Acme Innovations" }, records: [], activity: [], approvals: { count: 0, items: [] }, working: false,
    research: { state: "none", max: 25 }, idea: { answers: { description: "Mat washing", price: 3000 } } }));
  replies.push({ kind: "answer", message: "Here's how to continue.", actions: [], cards: [{ type: "choose", case_id: "idea", price: 25 }] });
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="idea" subject={{ ...subject, id: "idea", kind: "idea" }} steps={[]} score={50} onTab={onTab} /></MemoryRouter>);
  await screen.findByText("Acme Innovations");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "research it" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  fireEvent.click(await screen.findByRole("button", { name: "Enter it myself" }));
  await waitFor(() => expect(document.querySelector('[data-card="idea_form"]')).toBeTruthy());
  expect(onTab).not.toHaveBeenCalledWith("assessment");
});

it("no greeting beside a message being answered, and what's typed meanwhile is sent after, never dropped (the owner, 30 Oct)", async () => {
  const { ideaSubject } = await import("./CaseAssistant");
  apiRequest.mockImplementation(async () => ({ business: { name: "Acme" }, records: [], activity: [], approvals: { count: 0, items: [] }, research: { state: "none" }, working: false,
    idea: { answers: {}, inputs: [], criteria: [], strengths: [], weaknesses: [], partial_score: 14, viability: null } }));
  let release;
  submitAgentRequest.mockImplementationOnce(() => new Promise((r) => { release = r; }));
  replies.push({ kind: "answer", message: "Reply two", actions: [] });
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="idea" subject={ideaSubject({ partial_score: 14 })} score={14} onTab={() => {}} /></MemoryRouter>);
  await screen.findByText("Acme");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "i want to validate an idea" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Thinking…");
  expect(screen.queryByText(/Tell me what you need/)).toBeNull();
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "it's for offices" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("Sending after my reply…")).toBeTruthy();
  await act(async () => { release({ kind: "answer", message: "Reply one", actions: [] }); });
  expect(await screen.findByText("Reply two")).toBeTruthy();
  expect(submitAgentRequest).toHaveBeenLastCalledWith(expect.objectContaining({ text: "it's for offices" }));
});
