// A funding case's next steps, worked out from the case itself (the owner's brief, 21 Oct: "most of these next steps are
// already filled, it should be adaptive"). Each step names the exact thing missing, in the case's own words and figures,
// and a step whose data is filled never shows. Ordered by what the check weighs most. Steps only a reviewer can do are
// left out: they are not the owner's to act on.
import { getCurrencySymbol } from "./currencies";

// A non-answer ("No acquisition channels are described in the available information") is blank too.
const NOT_SAID = /\b(?:no|not|none)\b[^.]{0,80}\b(?:described|provided|given|stated|mentioned|available|known|specified|found)\b/i;
const blank = (v) => v === null || v === undefined || (typeof v === "string" && (!v.trim() || NOT_SAID.test(v))) || (Array.isArray(v) && !v.length);
// The field each step is about, so "Fill it in" opens on it.
const FIELD = [["uof", "use_of_funds"], ["goal.amount", "target_amount"], ["goal.date", "receipt_date"], ["goal.confirm", "receipt_date"],
  ["goal.purpose", "purpose"], ["goal.milestone", "milestones"], ["goal.link", "purpose_milestone_id"], ["market.segment", "market.target_segment"],
  ["market.diff", "market.differentiation"], ["market.approach", "market.acquisition_approach"], ["market.owner", "market.acquisition_owner"],
  ["market.cost", "market.acquisition_cost"], ["market.milestone", "market.acquisition_milestone_id"], ["economics", "economics.price"],
  ["team.gap", "team.gaps"], ["team", "team.responsibilities"], ["risk", "risks"], ["forecast", "forecast"]];
const fieldOf = (key) => (FIELD.find(([k]) => key === k || key.startsWith(`${k}.`) || key.startsWith(k)) || [])[1];
const num = (v) => { const n = Number(String(v ?? "").replace(/,/g, "")); return blank(v) || !Number.isFinite(n) ? null : n; };
const get = (o, path) => path.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
const rows = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const monthOk = (v) => /^\d{4}-\d{2}/.test(String(v || ""));

export function caseSteps(subject, { max = 3, currency = null } = {}) {
  const s = subject?.data;
  if (!s || subject?.subject_type === "launch" || subject?.kind === "launch") return null;
  const sign = getCurrencySymbol(s.currency || currency || "") || "";
  const money = (n) => `${sign}${Number(n).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
  const base = subject.id ? `/funding/${subject.id}` : "/funding";
  const at = (section, key) => `${base}?tab=answers&section=${section}${fieldOf(key) ? `&field=${encodeURIComponent(fieldOf(key))}` : ""}`;
  const checks = {};
  for (const c of subject.assessment?.result?.criteria || []) for (const ch of c.checks || []) checks[ch.code] = ch.state;
  const passed = (code) => checks[code] === "passed";
  const out = [];
  const add = (key, title, why, section, to = null) => out.push({ key, section, kind: "unknown", badge: "To do", title, why, to: to || at(section, key), field: true });

  const milestones = rows(s.milestones);
  const measurable = (id) => milestones.some((m) => m.id === id && !blank(m.measure) && !blank(m.target));
  const firstGood = milestones.find((m) => !blank(m.outcome) && !blank(m.measure) && !blank(m.target)) || milestones.find((m) => !blank(m.outcome));
  const target = num(s.target_amount);

  // C3: the forecast (20)
  const f = subject.forecast?.data || subject.forecast || null;
  const months = rows(f?.months);
  if (!subject.forecast) add("forecast", "Make your 12-month cash forecast", "It shows the money lasts until the plan pays back.", "finances");
  else {
    const empty = months.filter((m) => blank(m.receipts) || blank(m.payments));
    if (blank(f.opening_cash)) add("forecast.opening", "Add the cash you start your forecast with", "Every month of the forecast builds on it.", "finances");
    if (empty.length) add("forecast.months", `Fill ${empty.length} ${empty.length === 1 ? "month" : "months"} of your cash forecast`, "Each month needs its money in and out.", "finances");
    else if (!blank(f.opening_cash) && f.drafted_by === "Agent" && !f.confirmed_at) {
      // The Agent's forecast counts once the owner has checked it (the owner's QA, 21 Oct: the pack waited on it unsaid).
      add("forecast.confirm", "Check and confirm the forecast I drafted", "It counts once you confirm it. Change any month first if you need to.", "finances");
      out[out.length - 1].confirmForecast = true;
    }
    else if (!blank(f.opening_cash) && !passed("C3.B")) {
      const said = new Set(rows(f.assumptions).filter((a) => !blank(a.text) && !blank(a.source)).map((a) => a.applies_to));
      const lacking = ["receipts", "payments"].filter((l) => !said.has(l));
      if (lacking.length) add("forecast.assumptions", `Say where your forecast ${lacking.join(" and ")} come from`, "One line each: the assumption and its source.", "finances");
    }
  }
  // C2: use of funds (15)
  const alloc = rows(s.use_of_funds);
  if (!alloc.length) add("uof", target ? `Split your ${money(target)} into what it pays for` : "Split the amount into what it pays for", "A funder wants each line of spending.", "finances");
  else {
    const total = alloc.reduce((t, a) => t + (num(a.amount) || 0), 0);
    if (target && Math.round(total) !== Math.round(target)) {
      const gap = target - total;
      add("uof.total", gap > 0 ? `Allocate the other ${money(gap)} of your ${money(target)}` : `Your allocations are ${money(-gap)} over your ${money(target)}`,
        "The lines must add up to the amount you are raising.", "finances");
    }
    const lineOf = (a) => `${num(a.amount) ? `${money(num(a.amount))} ` : ""}${a.category || "spending"}`;
    const named = (a) => `${a.category || "Spending"}${num(a.amount) ? ` ${money(num(a.amount))}` : ""}`;
    const noMonth = alloc.filter((a) => !monthOk(a.period));
    if (noMonth.length === 1) add("uof.period", `Add a month to your ${lineOf(noMonth[0])} line`, "When the money is spent.", "finances");
    else if (noMonth.length) add("uof.period", `Add a month to ${noMonth.length} spending lines`, `${noMonth.map(named).join(", ")}: when each is spent.`, "finances");
    const noUse = alloc.filter((a) => blank(a.purpose) && blank(a.rationale));
    if (noUse.length === 1) add("uof.purpose", `Say what your ${lineOf(noUse[0])} line pays for`, "What the money changes.", "finances");
    else if (noUse.length) add("uof.purpose", `Say what ${noUse.length} spending lines pay for`, `${noUse.map(named).join(", ")}.`, "finances");
  }
  // C1: the funding goal (10)
  if (target === null) add("goal.amount", "Say how much you want to raise", "Funders start with the amount.", "goal");
  if (blank(s.receipt_date)) add("goal.date", `Add when you expect to receive the ${target ? money(target) : "money"}`, "The timing sets the forecast.", "goal");
  else if (target !== null && !s.timing_confirmed && !passed("C1.A")) add("goal.confirm", "Save your amount and date as final", "Then the check counts them.", "goal");
  if (blank(s.purpose)) add("goal.purpose", `Say what the ${target ? money(target) : "funding"} is for`, "Funders want to know what it pays for.", "goal");
  if (!milestones.length) add("goal.milestone", "Add a milestone the funding pays for", "With a measure and a target.", "goal");
  else if (!measurable(s.purpose_milestone_id)) {
    const linked = milestones.find((m) => m.id === s.purpose_milestone_id);
    if (linked) add("goal.milestone.measure", `Add a ${blank(linked.measure) ? "measure" : "target"} to your milestone: ${linked.outcome || "untitled"}`, "So progress can be measured.", "goal");
    else add("goal.link", `Link your use of funds to a milestone${firstGood?.outcome ? `: ${firstGood.outcome}` : ""}`, "It shows what the money achieves.", "goal");
  }
  // C6: market (10)
  if (blank(get(s, "market.target_segment"))) add("market.segment", "Say who your target customer is", "It shows there is a market you can win.", "market");
  if (blank(get(s, "market.differentiation"))) add("market.diff", "Say what sets you apart", "Why customers pick you.", "market");
  if (blank(get(s, "market.acquisition_approach"))) add("market.approach", "Say how you will win customers", "The plan for reaching them.", "market");
  if (blank(get(s, "market.acquisition_owner"))) add("market.owner", "Name who owns winning customers", "One person is responsible.", "market");
  if (blank(get(s, "market.acquisition_cost"))) add("market.cost", "Add what winning customers costs you", "A monthly budget or a cost per customer.", "market");
  if (!measurable(get(s, "market.acquisition_milestone_id")) && milestones.length) add("market.milestone", `Link winning customers to a milestone${firstGood?.outcome ? `: ${firstGood.outcome}` : ""}`, "How you will measure it.", "market");
  // C5: economics (10)
  const econ = [["price", "your price per sale"], ["direct_cost", "your direct cost per sale"], ["fixed_costs_monthly", "your fixed costs each month"]]
    .filter(([k]) => blank(get(s, `economics.${k}`))).map(([, w]) => w);
  if (econ.length) add("economics", `Add ${econ.join(" and ")}`, "Your margin shows each sale pays its way.", "finances");
  // C4: demand evidence (15), when the check says none is attached
  if (checks["C4.A"] && !passed("C4.A")) add("evidence", "Attach one dated piece of customer evidence", "An invoice, an order or signed interest.", "traction", `${base}?tab=advanced&fold=evidence`);
  // C7: team (10)
  const people = rows(get(s, "team.responsibilities"));
  if (!people.length) add("team.who", "Name who delivers the plan and who wins customers", "Funders back the people.", "team");
  for (const p of people) if (blank(p.owner)) add(`team.owner.${p.id || p.area}`, `Name the owner of ${p.area || "this area"}`, "Each key area has a named person.", "team");
  const gaps = rows(get(s, "team.gaps"));
  if (!gaps.length && !get(s, "team.no_gaps")) add("team.gaps", "List your team's capacity gaps, or confirm there are none", "What could slow delivery, and the fix.", "team");
  for (const g of gaps) if (blank(g.action)) add(`team.gap.${g.id || g.gap}`, `Add an action for the gap: ${g.gap || "untitled"}`, "What you will do about it.", "team");
  // C8: risks (10)
  const risks = rows(s.risks);
  if (!risks.length && !s.no_known_risks) add("risks", "List your known risks, or confirm there are none", "Each with what you will do about it.", "documents");
  for (const r of risks) if (blank(r.action)) add(`risk.${r.id || r.risk}`, `Add an action for the risk: ${r.risk || "untitled"}`, "What you will do about it.", "documents");

  return { steps: out.slice(0, max), total: out.length };
}

/** "Funding goal 6 of 7 · Finances 4 of 5 …": each section's answered count, from the case. */
export function sectionCounts(subject, steps = []) {
  // Never a tick beside a section that still has a step (the owner's QA, 21 Oct: "Finances 5 of 5" with three months missing).
  return (subject?.sections || []).map((x) => {
    const open = steps.filter((s) => s.section === x.key).length;
    const name = String(x.title).replace(/ and .*$/, "");
    return { key: x.key, done: x.answered >= x.total && !open,
      text: x.answered >= x.total && open ? `${name}: ${open} to fix` : `${name} ${x.answered} of ${x.total}` };
  });
}
