import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DOES_IT, NEW_REQUEST, questionOf, useFollowRuns, agentErrorMessage, doesItFirst, getChat, replyText, saveChat, submitAgentRequest } from "../lib/agent";
import { apiRequest } from "../api/client";
import { premiumFlow } from "./ResearchReview";
import { creditCopy } from "../lib/creditCopy";
import { STEPS } from "./ResultSummary";

// A free check as a conversation on its own page (the owner, 30 Oct: the landing page's shortcuts "should be in a chat",
// as the idea, launch and funding ones are): its result in the chat, and every reply ending on its next step and button.
const BOX = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
const YES = /^\s*(?:start|yes|yeah|yep|ok(?:ay)?|sure|go ahead|go on|do it|proceed|please do|confirm)\b/i;
const GOAL = { customers: "more_customers", risks: "business_risks", pricing: "price_offer" };
const OPENING = { customers: "How do I get more customers?", risks: "What are the risks in my business?", pricing: "Help me price my product or service" };

const now = () => new Date().toISOString();
const KIND = { customer_growth_foundation: "customers", business_risk_initial: "risks", pricing_health_initial: "pricing" };
const lower = (x) => (x ? x[0].toLowerCase() + x.slice(1) : x);
const plain = (x) => String(x || "").trim().replace(/\.$/, "");
const WHAT = { customers: "how to win more customers", risks: "the risks in your business", pricing: "your pricing" };
const KEY_PERSON = [["runs", "It would carry on"], ["slows", "It would slow down"], ["stops", "It would stop"]];
const ASK_WORDS = {
  // a rough idea is enough; not knowing is fine (the owner, 1 Nov: "if I know, will I be running the flow?")
  customer: "Who would you most like to sell to? A rough idea is enough, for example brides, office workers or students. Not sure? That's fine, I can research it for you.",
  key_person: "If you were away for a month, what would happen to the business?", cash_in_bank: "What's in the bank today?",
  monthly_costs: "What do all your regular costs come to in a usual month?" };
const NUMBER = new Set(["cash_in_bank", "monthly_costs"]);

// The check said as a conversation (the owner, 1 Nov: "it should be conversational"): where it stands, then each detail the
// records don't show asked one at a time, then the one next step with its button and Do all for me. Worked out by the check
// itself, so these answers cost nothing.
function headOf(r) {
  const n = (r.blockers || []).length;
  const goal = { customer_growth_foundation: "to win more customers", business_risk_initial: "to make your business safer", pricing_health_initial: "in your pricing" }[r.assessment_type] || "";
  return n ? `${n} thing${n === 1 ? "" : "s"} to fix ${goal}`.trim() + "." : goal ? "Nothing to fix right now." : r.headline || "Your result";
}
// The result as a card in the chat, with what it means and the next steps (the owner, 1 Nov: "there should be a result card in
// the chat with explanation... next steps too"); only what the card needs is kept with the conversation
function whereItStands(r) {
  const n = (r.blockers || []).length;
  const card = { head: headOf(r), focus: r.focus?.text || "", fine: r.fine || [], note: r.note || "",
    fix: (r.blockers || []).map((b) => { const st = (STEPS[KIND[r.assessment_type]] || {})[b.key] || {};
      return { gap: plain(b.gap || b.label), why: plain(b.why), to: (b.to && !String(b.to).startsWith("#") ? b.to : null) || st.to || null, cta: b.cta || st.cta || "" }; }),
    next: (r.free_next_actions || []).filter((x) => x.to && !x.save).map((x) => ({ label: x.label, why: x.why || "", to: x.to })) };
  return { role: "assistant", at: now(), cards: [{ type: "check_card", card }],
    content: n ? `Here's where you stand, from your answers and records. ${n === 1 ? "One thing is" : `${n} things are`} holding you back, and the rest is already working.`
      : "Here's where you stand, from your answers and records. Nothing is holding you back right now." };
}

function CheckCard({ card }) {
  const navigate = useNavigate();
  const c = card || {};
  return (
    <div className={`${BOX} p-5`} data-card="check_card">
      <p className="text-[17px] font-bold text-slate-900 dark:text-slate-50">{c.head}</p>
      {c.focus && <p className="mt-2 rounded-xl border border-brand-100 bg-brand-50/60 px-3 py-2 text-[14px] text-slate-800 dark:border-brand-900 dark:bg-brand-950/30 dark:text-slate-100">{c.focus}</p>}
      {(c.fix || []).length > 0 && (
        <div className="mt-4">
          <p className="text-[13px] font-bold text-rose-700">What to fix</p>
          <ul className="mt-1 space-y-2">{c.fix.map((f) => (
            <li key={f.gap} className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
              <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-50">{f.gap}</p>
              {f.why && <p className="text-[13px] text-slate-600 dark:text-slate-300">{f.why}.</p>}
              {f.to && <button type="button" onClick={() => navigate(f.to)} className="mt-2 rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-700">{f.cta || "Do it now"}</button>}
            </li>))}</ul>
        </div>
      )}
      {(c.fine || []).length > 0 && (
        <div className="mt-4">
          <p className="text-[13px] font-bold text-emerald-700">What's working</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[13.5px] text-slate-700 dark:text-slate-200">{c.fine.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
      {(c.next || []).length > 0 && (
        <div className="mt-4">
          <p className="text-[13px] font-bold text-slate-900 dark:text-slate-50">Next steps</p>
          <ul className="mt-1 space-y-2">{c.next.map((x) => (
            <li key={x.label} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
              <span className="min-w-0"><span className="block text-[14px] font-semibold text-slate-900 dark:text-slate-50">{x.label}</span>
                {x.why && <span className="block text-[13px] text-slate-600 dark:text-slate-300">{x.why}</span>}</span>
              <button type="button" onClick={() => navigate(x.to)} className="shrink-0 text-[13px] font-semibold text-brand-700 hover:underline">Start →</button>
            </li>))}</ul>
        </div>
      )}
      {c.note && <p className="mt-3 text-[12px] text-slate-500">{c.note}</p>}
    </div>
  );
}
function nextOf(r, answers, skipped = [], lead = "") {
  const gap = (r.not_on_record || []).find((g) => g.ask && !skipped.includes(g.ask));
  if (gap) {
    const opts = gap.ask === "key_person" ? KEY_PERSON : Array.isArray(gap.ask_options) ? gap.ask_options.map((o) => (Array.isArray(o) ? o : [o.value, o.label]))
      : gap.ask === "monthly_costs" ? [[0, "No other regular costs"]] : [];
    return { role: "assistant", at: now(), content: `${lead}${ASK_WORDS[gap.ask] || gap.label}`, asks: { key: gap.ask, answers, skipped },
      prompts: [...opts.map(([value, label]) => ({ label, prompt: label, value })), gap.ask === "customer" ? { label: "Not sure", prompt: "Not sure", value: "unknown" } : { label: "Skip", prompt: "Skip" }] };
  }
  const b = (r.blockers || [])[0];
  const card = (r.free_next_actions || []).find((x) => x.to && !x.save);
  // One action, said as an action with its own button (the owner, 1 Nov: "Next step: Not listed on the Marketplace... Or I can
  // do it all for you... which one exactly"); Do all for me stays beside it as the other way, never a second "or" in the words
  const step = b ? { ...(STEPS[KIND[r.assessment_type]] || {})[b.key], ...(b.to && !String(b.to).startsWith("#") ? { to: b.to } : {}), ...(b.cta ? { cta: b.cta } : {}) } : {};
  const go = b && step.to && step.cta ? { label: step.cta, to: step.to } : !b && card ? { label: card.label, to: card.to } : null;
  const why = b?.why ? `, because ${lower(plain(b.why))}` : "";
  return { role: "assistant", at: now(), answers,
    content: b ? (go ? `${lead}Next step: ${lower(go.label)}${why}.` : `${lead}The one thing to sort out next: ${lower(plain(b.gap || b.label))}${why}.`)
      : `${lead}You're in good shape here.${card ? ` Next step: ${lower(plain(card.label))}. ${card.why || ""}` : ""}`.trim(),
    links: go ? [go] : [], prompts: b ? [{ label: "Do all for me", prompt: "Do all for me" }] : [] };
}
function askIntake(qs, at, answers) {
  const q = qs[at];
  return { role: "assistant", at: now(), content: q.label, asks: { intake: qs, at, answers },
    prompts: [...(q.options || []).map((o) => ({ label: o.label, prompt: o.label, value: o.value })), ...(q.required ? [] : [{ label: "Skip", prompt: "Skip" }])] };
}

function ResultCard({ result }) {
  const r = result || {};
  const score = typeof r.score === "number" ? `${Math.round(r.score)}/100` : r.score_label || r.score;
  return (
    <div className={`${BOX} p-5`} data-card="check_result">
      <p className="text-[16px] font-bold text-slate-900 dark:text-slate-50">{r.headline || "Your result"}</p>
      {score && <p className="mt-1 text-[14px] font-semibold text-brand-700 dark:text-brand-300">{String(score)}{r.classification ? ` · ${r.classification}` : ""}</p>}
      {(r.metrics || []).length > 0 && (
        <dl className="mt-3 grid gap-2 sm:grid-cols-3">{r.metrics.slice(0, 6).map((m) => (
          <div key={m.label} className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60"><dt className="text-[12px] text-slate-500">{m.label}</dt><dd className="text-[14px] font-semibold text-slate-900 dark:text-slate-50">{m.value}</dd></div>
        ))}</dl>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(r.strengths || []).length > 0 && <div><p className="text-[13px] font-bold text-emerald-700">What's working</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[13.5px] text-slate-700 dark:text-slate-200">{r.strengths.map((s) => <li key={s}>{s}</li>)}</ul></div>}
        {(r.missing || []).length > 0 && <div><p className="text-[13px] font-bold text-rose-700">What's missing</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[13.5px] text-slate-700 dark:text-slate-200">{r.missing.map((s) => <li key={s}>{s}</li>)}</ul></div>}
      </div>
    </div>
  );
}

export default function CheckAssistant({ businessId, topic, said: handed = "" }) {
  const chatId = `check-${topic}`;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [messages, setMessages] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  const confirming = useRef(null);      // a task whose price was just said, waiting for Start or Not now
  const asked = useRef(null);      // a task's question just asked: the next message answers it
  const researching = useRef(null);      // Do all for me: its price said, waiting for Start or Not now
  const found = useRef({});      // what Do all for me found, to review here, by the message it follows
  const base = `/businesses/${businessId}/quick-check/${GOAL[topic] || topic}`;
  const keep = (next) => { setMessages(next); saveChat(businessId, chatId, next).catch(() => {}); };
  useFollowRuns(messages, (fn) => setMessages((prev) => { const next = fn(prev || []); saveChat(businessId, chatId, next).catch(() => {}); return next; }));
  useEffect(() => {
    let live = true;
    getChat(businessId, chatId).then((c) => { if (live) setMessages(c?.messages || []); }).catch(() => { if (live) setMessages([]); });
    return () => { live = false; };
  }, [businessId, chatId]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [messages?.length, busy]);

  const send = async (said, before = messages) => {
    const t = String(said || "").trim();
    if (!t || busy) return;
    const list = [...(before || []), { role: "user", content: t, at: new Date().toISOString() }];
    keep(list);      // saved at once: a slow reply or a refresh never loses what was said (QA F4, 30 Oct)
    setText("");
    const last = (before || [])[(before || []).length - 1];
    const freshAsk = !YES.test(t) && NEW_REQUEST.test(t);      // a new request leaves what was waiting and is answered itself
    if (freshAsk) researching.current = null;
    if (researching.current) return research(t, list);
    if (last?.role === "assistant" && last.asks && !freshAsk) return answerHere(t, last, list);
    if (/^do (?:it )?all for me$/i.test(t)) {
      const step = [...(before || [])].reverse().find((m) => m.answers);
      if (step) return doAll(list, step.answers);
    }
    setBusy(true);
    try {
      // A price just said: Start, "go ahead" or "yes" starts it; anything else leaves it, nothing charged
      const priced = freshAsk ? null : confirming.current || last?.confirm || null;      // kept on its message: a reload never loses it
      confirming.current = null;
      const task = !priced && !freshAsk ? asked.current || last?.task || null : null;
      asked.current = null;
      const q = task ? questionOf(task.fields, task.params) : null;
      if (priced && !YES.test(t)) {
        keep([...list, { role: "assistant", content: "No problem, nothing was started or charged.", at: new Date().toISOString() }]);
        return;
      }
      const res = priced
        ? await submitAgentRequest({ businessId, capability: priced.capability, params: priced.params || {}, sourceChannel: "ui_action", background: true, confirmed: true })
        : q ? await submitAgentRequest({ businessId, capability: task.capability, params: { ...(task.params || {}), [q.field.key]: q.options.find((o) => o.label === t)?.value ?? t }, sourceChannel: "ui_action", background: true })
        : await submitAgentRequest({ businessId, text: t, page: topic });
      if (res?.elsewhere) { navigate(`${res.elsewhere}${res.elsewhere.includes("?") ? "&" : "?"}message=${encodeURIComponent(t)}`); return; }
      const acts = res?.actions || [];
      const ask = res?.kind === "needs_confirmation" && res.capability;
      if (ask) confirming.current = res;
      const next = res?.kind === "needs_input" && res.capability ? questionOf(res.fields, res.params) : null;
      if (next) asked.current = { capability: res.capability, params: res.params || {}, fields: res.fields };
      const offers = res?.offers || [];
      const follow = res?.kind === "workflow" && res.run?.id && !res.run.pending_question && ["queued", "running"].includes(res.run.status);
      keep([...list, { role: "assistant", content: follow ? "Started. I'll tell you here as soon as it's ready." : [replyText(res) || "Done.", next?.label].filter(Boolean).join(" "), at: new Date().toISOString(), cards: res?.cards || [],
        ...(follow ? { follow: { run_id: res.run.id } } : {}), ...(ask ? { confirm: { capability: res.capability, params: res.params || {} } } : {}),
        ...(next ? { task: { capability: res.capability, params: res.params || {}, fields: res.fields } } : {}),
        links: [...acts.filter((a) => a.to).map((a) => ({ label: a.label, to: a.to })), ...offers.filter((o) => o.to).map((o) => ({ label: o.label, to: o.to }))],
        prompts: ask ? [{ label: "Start", prompt: "Start" }, { label: "Not now", prompt: "Not now" }] : next ? next.prompts
          : [...acts.filter((a) => a.prompt).map((a) => ({ label: a.label, prompt: a.prompt })), ...offers.filter((o) => !o.to).map((o) => ({ label: o.label, prompt: o.label }))] }]);
    } catch (e) {
      keep([...list, { role: "assistant", content: agentErrorMessage(e, "That didn't go through. Nothing was changed; please try again."), at: new Date().toISOString() }]);
    } finally { setBusy(false); }
  };

  const say = (list, m) => keep([...list, { role: "assistant", at: now(), ...m }]);
  async function answerHere(t, m, list) {
    const a = m.asks;
    const pick = (m.prompts || []).find((p) => p.label.toLowerCase() === t.toLowerCase());
    const unsure = /^(?:not sure|i'?m not sure|i don'?t know|no idea)$/i.test(t);      // an answer: saved, never asked again
    const skip = /^skip$/i.test(t) || (unsure && !a.key);
    setBusy(true);
    try {
      if (a.intake) {
        const q = a.intake[a.at];
        const value = pick && pick.value !== undefined ? pick.value : ["number", "money"].includes(q.type) ? Number(t.replace(/[^0-9.]/g, "")) : t;
        const answers = skip ? a.answers : { ...a.answers, [q.key]: value };
        if (a.at + 1 < a.intake.length) { keep([...list, askIntake(a.intake, a.at + 1, answers)]); return; }
        const res = await apiRequest(base, "POST", { answers });
        keep([...list, whereItStands(res.result || {}), nextOf(res.result || {}, answers)]);
        return;
      }
      if (skip) {
        const r = await apiRequest(base, "GET");
        keep([...list, nextOf(r?.last?.result || {}, a.answers, [...(a.skipped || []), a.key])]);
        return;
      }
      const value = unsure ? "unknown" : pick && pick.value !== undefined ? pick.value : NUMBER.has(a.key) ? Number(t.replace(/[^0-9.]/g, "")) : t;
      if (NUMBER.has(a.key) && !unsure && (t.replace(/[^0-9.]/g, "") === "" || Number.isNaN(value))) {
        keep([...list, { ...m, at: now(), content: `Just the amount, please, for example 2500. ${m.content}` }]);
        return;
      }
      const answers = { ...a.answers, [a.key]: value };
      const res = await apiRequest(base, "POST", { answers });
      keep([...list, nextOf(res.result || {}, answers, a.skipped, "Saved. ")]);
    } catch {
      say(list, { content: "That didn't save just now. Please try again." });
    } finally { setBusy(false); }
  }
  // Do all for me: the plan first, then its price with Start or Not now, then what it found to review here
  async function doAll(list, answers) {
    setBusy(true);
    try {
      const out = await premiumFlow({ base: `${base}/premium`, body: { answers }, businessId, onError: (msg) => say(list, { content: msg }) })();
      if (!out) return;
      if (out.gate) { say(list, { content: out.gate.message || "That isn't on your plan yet.", links: [{ label: out.gate.primary?.label || "See plans", to: out.gate.primary?.to || "/pricing" }] }); return; }
      if (out.render) { found.current[list.length] = out.render; say(list, { content: "Here's what I found. Accept what's right and I'll add it to your plan." }); return; }
      if (out.confirm) {
        researching.current = out;
        const c = out.confirm;
        const price = c.variable === false ? creditCopy.confirmFixed({ action: c.action || "Research your gaps", cost: c.max ?? c.cost, balance: c.balance })
          : creditCopy.confirmVariable({ action: c.action || "Research your gaps", max: c.max ?? c.cost, balance: c.balance });
        say(list, { content: price, prompts: [{ label: "Start", prompt: "Start" }, { label: "Not now", prompt: "Not now" }] });
      }
    } finally { setBusy(false); }
  }
  async function research(t, list) {
    const out = researching.current;
    researching.current = null;
    if (!YES.test(t)) { say(list, { content: "No problem, nothing was started or charged." }); return; }
    setBusy(true);
    try {
      const got = await out.start();
      if (got?.gate) say(list, { content: got.gate.message || "That couldn't start.", links: [{ label: got.gate.primary?.label || "See plans", to: got.gate.primary?.to || "/pricing" }] });
      else if (got?.render) { found.current[list.length] = got.render; say(list, { content: "Done. Here's what I found. Accept what's right and I'll add it to your plan." }); }
    } finally { setBusy(false); }
  }

  // Handed over from the landing page or a shortcut: that message starts the chat here, once; an empty chat opens on its
  // result, never a blank page
  const started = useRef(false);
  useEffect(() => {
    if (messages === null || started.current) return;
    started.current = true;
    const said = params.get("message");
    if (said) {
      const p = new URLSearchParams(params);
      p.delete("message");
      setParams(p, { replace: true });
      send(said, []);
    } else {
      const fresh = !messages.some((m) => m.role === "user") && !messages.some((m) => (m.cards || []).some((c) => c.type === "check_card"));      // nothing said yet and no result card
      // Answers newer than this chat (given on the landing page since, then "View plan"): the chat starts again from them, never
      // the old conversation (the owner, 1 Nov: "you can't be showing me this when I come from the landing page")
      const newest = Math.max(0, ...messages.map((m) => Date.parse(m.at || "") || 0));
      const hello = { role: "assistant", content: `I'm here to help with ${topic === "customers" ? "winning more customers" : topic === "risks" ? "your business risks" : "pricing"}. What would you like to know?`, at: new Date().toISOString() };
      // Answered already (on the landing page, or on the Result tab): the chat opens on that result and its next step, never a
      // blank "what would you like to know" (the owner, 1 Nov: "came from the landing page to this... after all the questions I answered")
      apiRequest(`${base}${handed ? `?said=${encodeURIComponent(handed)}` : ""}`, "GET").then((r) => {
        const result = r?.last?.result;
        const newer = result && newest && (Date.parse(r.last.at || "") || 0) > newest + 60000;
        if (!fresh && !newer) return;
        if (result) { keep([whereItStands(result), nextOf(result, r.last.answers || {})]); return; }
        // Nothing answered yet: the check's own questions, one at a time, what their records or words give already skipped
        const qs = (r?.questions || []).filter((q) => !q.said).map((q) => ({ key: q.key, label: q.label, type: q.type, required: q.required,
          options: q.type === "choice" ? q.options || [] : [...(q.chips || []), ...(q.unsure ? [{ value: q.unsure_value ?? "unknown", label: q.unsure }] : [])] }));
        const given = Object.fromEntries((r?.questions || []).filter((q) => q.default != null && q.default !== "").map((q) => [q.key, q.default]));
        const intro = { ...hello, content: `Let's work out ${WHAT[topic] || "this"} together. I'll ask a few quick things your records don't show.` };
        keep(qs.length ? [intro, askIntake(qs, 0, given)] : [hello]);
      }, () => { if (fresh) keep([hello]); });
    }
  }, [messages]);      // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section aria-label="Conversation" className={`${BOX} flex h-full min-h-[28rem] flex-col`} data-check-assistant={topic}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {messages === null && <p className="text-[13px] text-slate-500" role="status">Loading your conversation…</p>}
        {(messages || []).map((m, i) => (m.role === "user" ? (
          <div key={i} className="flex justify-end"><p className="max-w-[80%] rounded-2xl bg-brand-50 px-4 py-3 text-[15px] text-slate-800 dark:bg-brand-950/40 dark:text-slate-100">{m.content}</p></div>
        ) : (
          <div key={i} className="space-y-3">
            {/* its cards first, then its words, as in the case chats (the owner, 1 Nov) */}
            {(m.cards || []).filter((c) => c.type === "check_result").map((c, j) => <ResultCard key={j} result={c.result} />)}
            {(m.cards || []).filter((c) => c.type === "check_card").map((c, j) => <CheckCard key={`k${j}`} card={c.card} />)}
            <p className="max-w-[90%] whitespace-pre-line rounded-2xl bg-slate-100 px-4 py-3 text-[15px] text-slate-800 dark:bg-slate-800 dark:text-slate-100">{m.content}</p>
            {m.follow && !m.follow.done && <p className="text-[12.5px] font-medium text-brand-700" role="status" data-run-following>Working on it…</p>}
            {found.current[i] && <div data-card="research">{found.current[i]}</div>}
            {((m.links || []).length > 0 || (m.prompts || []).length > 0) && (
              <div className="flex flex-wrap gap-2">
                {(m.links || []).map((l) => <button key={l.label + l.to} type="button" onClick={() => navigate(l.to)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-700">{l.label}</button>)}
                {(i === messages.length - 1 ? doesItFirst(m.prompts || []) : []).map((p) => <button key={p.label} type="button" disabled={busy} onClick={() => send(p.prompt)}
                  className={DOES_IT.test(p.label) && !(m.links || []).length ? "rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
                    : "rounded-lg border border-brand-600 px-3 py-1.5 text-[13px] font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-60"}>{p.label}</button>)}
              </div>
            )}
          </div>
        )))}
        {busy && <p className="flex items-center gap-2 text-[13px] text-slate-500" role="status"><span aria-hidden="true" className="h-4 w-4 rounded-full border-2 border-brand-500 border-r-transparent motion-safe:animate-spin" />Thinking…</p>}
        <div ref={end} />
      </div>
      <form className="border-t border-slate-200 p-3 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 dark:border-slate-700">
          <input aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask EnterprateAI anything…" className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
          <button type="submit" aria-label="Send" disabled={busy || !text.trim()} className="rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">Send</button>
        </div>
      </form>
    </section>
  );
}
