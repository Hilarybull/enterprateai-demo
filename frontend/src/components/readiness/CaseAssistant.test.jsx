// The owner's mockups, 27 Oct ("exactly like the mockups"): the Assistant tab's conversation and its cards.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  expect(await screen.findByText(/I've added 2 drafts to your case\. Running/)).toBeTruthy();
  rerender(view({ score: null, checking: true }));
  rerender(view({ score: 64, checking: false }));
  expect(await screen.findByText(/^I've run your funding readiness check again\. You're at 64\/100\. Should I help you become more funding ready\?/)).toBeTruthy();
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
  // The card runs the Idea Validation itself (the owner, 31 Oct: "start should just run the idea validation")
  fireEvent.click(within(document.querySelector('[data-card="choose"]')).getByRole("button", { name: "Run the idea validation" }));
  await waitFor(() => expect(submitAgentRequest).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Run the idea validation", page: "idea" })));
  expect(onResearch).not.toHaveBeenCalled();
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

it("shows a case's cut-short title whole, from what the case is for", async () => {
  const { fullTitle } = await import("./CaseAssistant");
  expect(fullTitle("$400 loan to buy an opening stock of shoes and set up the…", "To buy an opening stock of shoes and set up the online shop.")).toBe("$400 loan to buy an opening stock of shoes and set up the online shop");
  expect(fullTitle("$400 loan for stock", "stock")).toBe("$400 loan for stock");
  expect(fullTitle("$400 loan to buy…", "something else entirely")).toBe("$400 loan to buy…");
});

it("fills what's left in the chat: a typed answer, a month on each line and a forecast, without leaving (the owner, 1 Nov)", async () => {
  apiRequest.mockImplementation(async () => ({ business: { name: "Acme Innovations" }, records: [], activity: [], research: { state: "adopted" }, working: false, approvals: { count: 0, items: [] } }));
  const onField = vi.fn();
  const data = { ...subject.data, currency: "USD", use_of_funds: [{ id: "u1", purpose: "Stock", amount: "400" }] };
  const steps = [{ key: "market.diff", title: "Say what sets you apart", to: "/funding/c1?tab=answers&field=market.differentiation", cta: "Add" },
    { key: "uof.period", title: "Add a month to your line", to: "/funding/c1?tab=answers&field=use_of_funds", cta: "Add month" },
    { key: "forecast", title: "Make your forecast", to: "/funding/c1?tab=answers&field=forecast", cta: "Open forecast" }];
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="funding" subject={{ ...subject, data }} steps={steps} score={40} onTab={() => {}} onField={onField} /></MemoryRouter>);
  await screen.findByText("Acme Innovations");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "What's left?" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const card = await waitFor(() => { const c = document.querySelector('[data-card="pending"]'); if (!c) throw new Error("no card"); return c; });
  expect(card.querySelector('[aria-label="Say what sets you apart"]')).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open forecast" })).toBeNull();      // done here, never another page
  fireEvent.change(card.querySelector('[aria-label="Month for Stock"]'), { target: { value: "2026-12" } });
  fireEvent.click(within(card.querySelector('[data-pending="uof.period"]')).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onField).toHaveBeenCalledWith("use_of_funds", [{ id: "u1", purpose: "Stock", amount: "400", period: "2026-12" }]));
  expect(card.querySelector('[aria-label="Cash you have now"]')).toBeTruthy();
});

it("what's left offers drafting only for what the Agent can write, and filling it in by hand beside it", async () => {
  apiRequest.mockImplementation(async () => ({ business: { name: "Acme Innovations" }, records: [], activity: [], research: { state: "adopted" }, working: false, approvals: { count: 0, items: [] }, draft_fields: ["market.differentiation"] }));
  const onTab = vi.fn();
  const steps = [{ key: "market.diff", title: "Say what sets you apart", to: `/funding/${subject.id}?tab=answers&field=market.differentiation`, cta: "Add" }];
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="funding" subject={subject} steps={steps} score={40} onTab={onTab} onField={vi.fn()} /></MemoryRouter>);
  await screen.findByText("Acme Innovations");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "What's left?" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  fireEvent.click(await screen.findByRole("button", { name: "Fill it in myself" }));
  expect(onTab).not.toHaveBeenCalled();      // stays in the chat (the owner, 1 Nov)
  expect(document.querySelector("[data-pending-myself]")).toBeTruthy();
});

it("every step is done in the chat: evidence, risks, a link to a milestone, never another tab (the owner, 1 Nov)", async () => {
  apiRequest.mockImplementation(async () => ({ business: { name: "Acme Innovations" }, records: [], activity: [], research: { state: "adopted" }, working: false, approvals: { count: 0, items: [] } }));
  const onTab = vi.fn();
  const onField = vi.fn();
  const base = `/funding/${subject.id}`;
  const data = { ...subject.data, milestones: [{ id: "m1", outcome: "Stock bought" }] };
  const steps = [{ key: "evidence", title: "Attach one dated piece of customer evidence", to: `${base}?tab=evidence&add=evidence`, cta: "Add evidence" },
    { key: "risks", title: "List your known risks", to: `${base}?tab=answers&field=no_known_risks`, cta: "Add risks" },
    { key: "goal.link", title: "Link your funding purpose", to: `${base}?tab=answers&field=purpose_milestone_id`, cta: "Choose milestone" }];
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="funding" subject={{ ...subject, data }} steps={steps} score={40} onTab={onTab} onField={onField} /></MemoryRouter>);
  await screen.findByText("Acme Innovations");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "What's left?" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const card = await waitFor(() => { const c = document.querySelector('[data-card="pending"]'); if (!c) throw new Error("no card"); return c; });
  expect(card.querySelector('[data-pending="evidence"] form')).toBeTruthy();      // the evidence form itself
  expect(within(card).getByRole("button", { name: "Add evidence" }).getAttribute("type")).toBe("submit");      // saves here, never a link away
  fireEvent.click(within(card.querySelector('[data-pending="risks"]')).getByRole("button", { name: "There are none" }));
  await waitFor(() => expect(onField).toHaveBeenCalledWith("no_known_risks", true));
  fireEvent.click(within(card.querySelector('[data-pending="goal.link"]')).getByRole("button", { name: "Stock bought" }));
  await waitFor(() => expect(onField).toHaveBeenCalledWith("purpose_milestone_id", "m1"));
  expect(onTab).not.toHaveBeenCalled();
});

it("next steps come after the words, live from the case, saying what's been done and approved (the owner, 1 Nov)", async () => {
  apiRequest.mockImplementation(async () => ({ business: { name: "Acme Innovations" }, records: [], activity: [], research: { state: "adopted" }, working: false, approvals: { count: 0, items: [] } }));
  replies.push({ kind: "answer", message: "I've added 2 new drafts.", actions: [], cards: [{ type: "steps", case_id: subject.id }] });
  const data = { ...subject.data, provenance: { "market.location": { source: "The Agent's draft, accepted by you" } } };
  const steps = [{ key: "market.diff", title: "Say what sets you apart", to: `/funding/${subject.id}?tab=answers&field=market.differentiation`, cta: "Add" }];
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="funding" subject={{ ...subject, data, sections: [{ key: "goal", answered: 7, total: 8 }, { key: "team", answered: 3, total: 3 }] }} steps={steps} score={40} onTab={() => {}} onField={vi.fn()} /></MemoryRouter>);
  await screen.findByText("Acme Innovations");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Tell me more" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const words = await screen.findByText("I've added 2 new drafts.");
  const card = document.querySelector('[data-card="pending"]');
  expect(card.querySelector("[data-pending-done]").textContent.trim()).toBe("Done so far: 10 of 11 answers on your case. 1 from drafts you approved.");
  const box = card.closest(".flex-col-reverse");
  expect(box.firstElementChild.contains(card)).toBe(true);      // first in a reversed column: drawn after the words
  expect(box.contains(words)).toBe(true);
});

it("when the score moves with no reply, the chat says so, once, and the side card's previous is what the chat last gave (the owner, 1 Nov)", async () => {
  const { getChat, saveChat } = await import("../../lib/agent");
  apiRequest.mockImplementation(async () => ({ business: { name: "Acme Innovations" }, records: [], activity: [], research: { state: "adopted" }, working: false, approvals: { count: 0, items: [] } }));
  getChat.mockImplementationOnce(async () => ({ messages: [{ role: "assistant", content: "I've run your check again.", at: "2026-11-01T15:49:00Z", cards: [{ type: "score_change", case_id: subject.id, before: 41, after: 48 }] }] }));
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="funding" subject={subject} steps={[]} score={55} onTab={() => {}} /></MemoryRouter>);
  expect(await screen.findByText("Your score is now 55/100, up from 48.")).toBeTruthy();
  const cards = document.querySelectorAll('[data-card="score_change"]');
  expect(cards.length).toBe(2);
  expect(cards[0].textContent).toContain("from 41/100 to 48/100");
  expect(cards[0].querySelector("[data-score-why]")).toBeNull();
  expect(cards[1].textContent).toContain("from 48/100 to 55/100");
  expect(document.querySelector("[data-score-before-after]").textContent).toContain("48/100");
  expect(screen.getAllByText("Your score is now 55/100, up from 48.").length).toBe(1);
  expect(saveChat).toHaveBeenCalled();
});

it("no Draft the rest when nothing listed can be drafted (the owner, 1 Nov: \"remove draft it for me if you can't draft\")", async () => {
  const { canDraftAny } = await import("./CaseAssistant");
  const fields = ["market.differentiation", "risks"];
  const forecast = { key: "forecast", to: "/funding/c1?tab=answers&section=finances&field=forecast" };
  const evidence = { key: "evidence", to: "/funding/c1?tab=evidence&add=evidence" };
  expect(canDraftAny([forecast, evidence], fields)).toBe(false);
  expect(canDraftAny([{ key: "market.diff", to: "/funding/c1?tab=answers&field=market.differentiation" }], fields)).toBe(true);
  expect(canDraftAny([{ key: "market.diff", drafted: true, to: "/funding/c1?tab=answers&field=market.differentiation" }], fields)).toBe(false);
  expect(canDraftAny([{ key: "risks", to: "/funding/c1?tab=answers&field=no_known_risks" }], fields)).toBe(true);
});

it("never says Done from a reading taken before the run started (the owner, 1 Nov)", async () => {
  const { getChat } = await import("../../lib/agent");
  apiRequest.mockImplementation(async () => ({ business: { name: "Acme Innovations" }, records: [], activity: [], research: { state: "none" }, working: true, approvals: { count: 0, items: [] } }));
  const data = { ...subject.data, agent_drafts: { purpose: { value: "Stock", source: "suggested by the Agent" } } };
  getChat.mockImplementationOnce(async () => ({ messages: [{ role: "assistant", content: "Started.", at: new Date(Date.now() - 1000).toISOString(), cards: [{ type: "progress", case_id: subject.id }] }] }));
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="funding" subject={{ ...subject, data }} steps={[]} score={40} onTab={() => {}} /></MemoryRouter>);
  await screen.findByText("Started.");
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  expect(screen.queryByText(/^Done\. I've drafted/)).toBeNull();      // still working: no Done, whatever drafts already wait
});

it("while drafts wait, the only thing offered is approving them: no list, no Draft the rest (the owner, 1 Nov)", async () => {
  apiRequest.mockImplementation(async () => ({ business: { name: "Acme Innovations" }, records: [], activity: [], research: { state: "adopted" }, working: false, approvals: { count: 0, items: [] }, draft_fields: [] }));
  const data = { ...subject.data, agent_drafts: { purpose: { value: "Stock", source: "an estimate by the Agent" } } };
  const steps = [{ key: "market.diff", title: "Say what sets you apart", to: `/funding/${subject.id}?tab=answers&field=market.differentiation`, cta: "Add" }];
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="funding" subject={{ ...subject, data }} steps={steps} score={40} onTab={() => {}} onField={vi.fn()} /></MemoryRouter>);
  await screen.findByText("Acme Innovations");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "What's left?" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const card = await waitFor(() => { const c = document.querySelector("[data-pending-review]"); if (!c) throw new Error("no card"); return c; });
  expect(within(card).getByRole("button", { name: "Review drafts (1)" })).toBeTruthy();
  expect(card.querySelector('[data-pending="market.diff"]')).toBeNull();
  expect(screen.queryByRole("button", { name: /Draft the rest/ })).toBeNull();
});

it("a confirmation shows what it confirms, and there is none without it (the owner, 1 Nov: \"how can you confirm what you can't view\")", async () => {
  apiRequest.mockImplementation(async () => ({ business: { name: "Acme Innovations" }, records: [], activity: [], research: { state: "adopted" }, working: false, approvals: { count: 0, items: [] }, draft_fields: [] }));
  const steps = [{ key: "check.C4.B", title: "Confirm your evidence", attest: { code: "C4.B", rationale: "From our own customers." }, to: "/funding/c1?tab=evidence" },
    { key: "confirm.C5.B", title: "Confirm your price and costs", attest: { code: "C5.B", rationale: "Reviewed." }, to: "/funding/c1?tab=answers" },
    { key: "forecast.confirm", title: "Check the forecast", to: "/funding/c1?tab=answers&field=forecast" }];
  const data = { ...subject.data, currency: "GBP", economics: { price: "60", direct_cost: "10", fixed_costs_monthly: "500" } };
  const evidence = [{ id: "e1", title: "Market report", type: "research", claim: "Demand is growing.", effective_date: "2026-10-01", source: { reference: "https://example.test/r" }, links: [{ check: "C4.A" }] }];
  const forecast = { data: { drafted_by: "Agent", opening_cash: "500", currency: "GBP", months: [{ month: "2026-11", receipts: "900", payments: "500" }, { month: "2026-12", receipts: "900", payments: "500" }] }, revision: 1 };
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="funding" subject={{ ...subject, data, evidence, forecast }} steps={steps} score={40} onTab={() => {}} onField={vi.fn()} /></MemoryRouter>);
  await screen.findByText("Acme Innovations");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "What's left?" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const card = await waitFor(() => { const c = document.querySelector('[data-card="pending"]'); if (!c) throw new Error("no card"); return c; });
  const ev = card.querySelector('[data-pending="check.C4.B"]');
  expect(ev.textContent).toContain("Demand is growing.");
  expect(ev.textContent).toContain("not proof from your own customers");
  expect(within(ev).getByRole("link", { name: "Read the source" }).getAttribute("href")).toBe("https://example.test/r");
  const econ = card.querySelector('[data-pending="confirm.C5.B"]').textContent;
  expect(econ).toContain("break even at about 10 sales a month");
  const fc = card.querySelector('[data-pending="forecast.confirm"]').textContent;
  expect(fc).toContain("Cash at the start");
  expect(fc).toContain("in,");
});

it("a launch's lists are answered line by line in the chat, never one box (the owner, 1 Nov)", async () => {
  apiRequest.mockImplementation(async () => ({ business: { name: "Acme Innovations" }, records: [], activity: [], research: { state: "adopted" }, working: false, approvals: { count: 0, items: [] }, draft_fields: [] }));
  const onField = vi.fn();
  const data = { name: "Food cart", delivery: { dependencies: [{ id: "d1", name: "Cart builder" }] }, operations: {}, prerequisites: [{ id: "p1", name: "Trading permit", applicable: "yes", critical: true, status: "not_completed" }] };
  const steps = [{ key: "check.C4.B", title: "List who and what the launch depends on", to: "/launch/c1?tab=answers&field=delivery.dependencies" },
    { key: "check.C5.B", title: "Record one test order, end to end", to: "/launch/c1?tab=answers&field=operations.dry_run.date" },
    { key: "check.C6.B", title: "Complete what must be in place", to: "/launch/c1?tab=answers&field=prerequisites" }];
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="launch" subject={{ ...subject, kind: "launch_initiative", data }} steps={steps} score={40} onTab={() => {}} onField={onField} /></MemoryRouter>);
  await screen.findAllByText("Food cart");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "What's left?" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const card = await waitFor(() => { const c = document.querySelector('[data-card="pending"]'); if (!c) throw new Error("no card"); return c; });
  fireEvent.change(card.querySelector('[aria-label="Will Cart builder be available by launch?"]'), { target: { value: "yes" } });
  fireEvent.change(card.querySelector('[aria-label="Backup for Cart builder"]'), { target: { value: "A second builder" } });
  fireEvent.click(within(card.querySelector('[data-pending="check.C4.B"]')).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onField).toHaveBeenCalledWith("delivery", { dependencies: [{ id: "d1", name: "Cart builder", available: "yes", contingency: "A second builder" }] }));
  expect(card.querySelector('[aria-label="How did it go?"]')).toBeTruthy();
  fireEvent.click(within(card).getByRole("button", { name: "I have this" }));
  expect(onField).toHaveBeenCalledWith("prerequisites", [{ id: "p1", name: "Trading permit", applicable: "yes", critical: true, status: "completed" }]);
});

it("setup and running commitments are answered in the chat, never by leaving it (the owner, 2 Nov: \"they are taking me away\")", async () => {
  const sent = [];
  apiRequest.mockImplementation(async (path, method, body) => { if (method === "PUT" || method === "POST") sent.push({ path, body }); return { business: { name: "Acme Innovations" }, records: [], activity: [], research: { state: "adopted" }, working: false, approvals: { count: 0, items: [] }, draft_fields: [] }; });
  const onField = vi.fn();
  const forecast = { data: { start_month: "2026-12", currency: "NGN", months: [{ month: "2026-12", receipts: "900", payments: "500" }] }, revision: 3 };
  const steps = [{ key: "check.C3.B", title: "List your setup and running commitments, or confirm there are none", to: "/launch/c1?tab=answers" }];
  render(<MemoryRouter><CaseAssistant businessId="b1" feature="launch" subject={{ ...subject, kind: "launch_initiative", data: { name: "Food cart" }, forecast }} steps={steps} score={40} onTab={() => {}} onField={onField} /></MemoryRouter>);
  await screen.findByLabelText("Message");
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "What's left?" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const card = await waitFor(() => { const c = document.querySelector('[data-card="pending"]'); if (!c) throw new Error("no card"); return c; });
  expect(within(card).queryByRole("button", { name: "Check it" })).toBeNull();
  fireEvent.change(within(card).getByLabelText("What it's for"), { target: { value: "Rent" } });
  fireEvent.change(card.querySelector('[aria-label="Amount"]'), { target: { value: "50,000" } });
  fireEvent.click(within(card).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(sent.some((c) => /forecast/.test(c.path))).toBe(true));
  const saved = sent.find((c) => /forecast/.test(c.path));
  expect(JSON.stringify(saved)).toContain("Rent");
  expect(JSON.stringify(saved)).toContain("50000");
  expect(JSON.stringify(saved)).toContain("assumption");
  expect(JSON.stringify(saved)).toContain("2026-12");
});
