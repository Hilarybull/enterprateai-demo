// A funding case's next steps, worked out from the case itself (the owner's brief, 21 Oct: "most of these next steps are
// already filled, it should be adaptive"). Each step names the exact thing missing, in the case's own words and figures,
// and a step whose data is filled never shows. Ordered by what the check weighs most. Steps only a reviewer can do are
// left out: they are not the owner's to act on.
//
// Every step carries a precise target (F-6, 22 Oct): its section, the field, and for a list the item, resolved by its id,
// never by position, as the form's own element id ("goal-milestones-0-due_date"). Its button says what it does.
import { shortDate } from "./format";
import { getCurrencySymbol } from "./currencies";

// A non-answer ("No acquisition channels are described in the available information") or a placeholder ("Pending
// approval") is blank too.
const NOT_SAID = /\b(?:no|not|none)\b[^.]{0,80}\b(?:described|provided|given|stated|mentioned|available|known|specified|found)\b|^\s*(?:pending(?: approval)?|tbc|tbd|to be confirmed|n\/?a|todo|\?+|-+)\s*\.?\s*$/i;
const blank = (v) => v === null || v === undefined || (typeof v === "string" && (!v.trim() || NOT_SAID.test(v))) || (Array.isArray(v) && !v.length);
const num = (v) => { const n = Number(String(v ?? "").replace(/,/g, "")); return blank(v) || !Number.isFinite(n) ? null : n; };
const get = (o, path) => path.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
const rows = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const monthOk = (v) => /^\d{4}-\d{2}/.test(String(v || ""));

/** The form's element id for a field ("market-market.acquisition_cost") or a list item's field ("finances-use_of_funds-1-amount"). */
export const fieldId = (section, field, index = null, sub = null) => (index === null ? `${section}-${field}` : `${section}-${field}-${index}-${sub}`);

export function caseSteps(subject, { max = 3, currency = null } = {}) {
  const s = subject?.data;
  // A launch plan is never a funding case (the owner's QA, 23 Oct: its steps linked to /funding/<launch id>, "can't be found");
  // the server names it "launch_initiative".
  if (!s || [subject?.type, subject?.subject_type, subject?.kind].some((k) => k === "launch" || k === "launch_initiative")) return null;
  const sign = getCurrencySymbol(s.currency || currency || "") || "";
  const money = (n) => `${sign}${Number(n).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
  const base = subject.id ? `/funding/${subject.id}` : "/funding";
  const at = (section, field, focus) => `${base}?tab=answers&section=${section}${field ? `&field=${encodeURIComponent(field)}` : ""}${focus ? `&focus=${encodeURIComponent(focus)}` : ""}`;
  const checks = {};
  for (const c of subject.assessment?.result?.criteria || []) for (const ch of c.checks || []) checks[ch.code] = ch.state;
  const passed = (code) => checks[code] === "passed";
  const out = [];
  // target: { section, field, focus? (element id), to? (another page) }; cta: the button; more: other buttons
  const add = (key, title, why, target, cta, more = []) => out.push({
    key, section: target.section, kind: "unknown", badge: "To do", title, why, field: true, cta,
    focus: target.focus || null, to: target.to || at(target.section, target.field, target.focus),
    more: more.map((m) => ({ label: m.label, focus: m.focus || null, to: m.to || at(m.section || target.section, m.field, m.focus) })),
  });

  const milestones = rows(s.milestones);
  const indexOf = (list, id) => list.findIndex((x) => x.id === id);
  const measurable = (id) => milestones.some((m) => m.id === id && !blank(m.measure) && !blank(m.target));
  const firstGood = milestones.find((m) => !blank(m.outcome) && !blank(m.measure) && !blank(m.target)) || milestones.find((m) => !blank(m.outcome));
  const target = num(s.target_amount);
  // A non-answer in the field is said as that, so the step never looks like it is about a filled field (the owner's QA, 21 Oct).
  const said = (path, why) => (NOT_SAID.test(String(get(s, path) || "")) ? "What's there now says none are given, so it doesn't count yet." : why);
  const F = (field, focusField = field) => ({ section: SECTION_OF[field.split(".")[0]] || "goal", field, focus: fieldId(SECTION_OF[field.split(".")[0]] || "goal", focusField) });

  // C3: the forecast (20)
  const f = subject.forecast?.data || subject.forecast || null;
  const months = rows(f?.months);
  const forecast = { section: "finances", field: "forecast" };
  // A check that passed is never a step (the owner, 23 Oct: "100/100" beside "Make your 12-month cash forecast")
  if (!subject.forecast && !passed("C3.A")) add("forecast", "Make your 12-month cash forecast", "It shows the money lasts until the plan pays back.", forecast, "Open forecast");
  else {
    const empty = months.filter((m) => blank(m.receipts) || blank(m.payments));
    if (blank(f.opening_cash)) add("forecast.opening", "Add the cash you start your forecast with", "Every month of the forecast builds on it.", forecast, "Add opening cash");
    // Months the check needs that the forecast doesn't have yet (said by the check itself)
    const short = (subject.assessment?.result?.criteria || []).flatMap((c) => c.checks || []).find((c) => c.code === "C3.A" && c.state !== "passed" && /forecast is missing/i.test(c.reason || ""));
    if (short && !empty.length) add("forecast.short", "Add the missing months to your cash forecast", String(short.reason).replace(/^The forecast is missing: /, "Missing: "), forecast, "Fill months");
    if (empty.length) add("forecast.months", `Fill ${empty.length} ${empty.length === 1 ? "month" : "months"} of your cash forecast`, "Each month needs its money in and out.", forecast, "Fill months");
    else if (!blank(f.opening_cash) && f.drafted_by === "Agent" && !f.confirmed_at) {
      // The Agent's forecast counts once the owner has checked it (the owner's QA, 21 Oct: the pack waited on it unsaid).
      add("forecast.confirm", "Check and confirm the forecast I drafted", "It counts once you confirm it. Change any month first if you need to.", forecast, "Review draft");
      out[out.length - 1].confirmForecast = true;
    } else if (!blank(f.opening_cash) && !passed("C3.B")) {
      const told = new Set(rows(f.assumptions).filter((a) => !blank(a.text) && !blank(a.source)).map((a) => a.applies_to));
      const lacking = ["receipts", "payments"].filter((l) => !told.has(l));
      if (lacking.length) add("forecast.assumptions", `Say where your forecast ${lacking.join(" and ")} come from`, "One line each: the assumption and its source.", forecast, "Add assumptions");
    }
  }
  // C2: use of funds (15)
  const alloc = rows(s.use_of_funds);
  const line = (a, sub) => ({ section: "finances", field: "use_of_funds", focus: fieldId("finances", "use_of_funds", indexOf(alloc, a.id) >= 0 ? indexOf(alloc, a.id) : alloc.indexOf(a), sub) });
  if (!alloc.length) add("uof", target ? `Split your ${money(target)} into what it pays for` : "Split the amount into what it pays for", "A funder wants each line of spending.", { section: "finances", field: "use_of_funds" }, "Add spending lines");
  else {
    const total = alloc.reduce((t, a) => t + (num(a.amount) || 0), 0);
    if (target && Math.round(total) !== Math.round(target)) {
      const gap = target - total;
      // The line causing the excess: the largest (F-6). Both ways out offered; neither is changed for you.
      const biggest = [...alloc].sort((a, b) => (num(b.amount) || 0) - (num(a.amount) || 0))[0];
      add("uof.total", gap > 0 ? `Allocate the other ${money(gap)} of your ${money(target)}` : `Your allocations are ${money(-gap)} over your ${money(target)}`,
        `${money(total)} of ${money(target)} allocated. The lines must add up to the amount you are raising.`,
        gap > 0 ? { section: "finances", field: "use_of_funds" } : line(biggest, "amount"), "Fix allocations",
        [{ label: "Change the target", section: "goal", field: "target_amount", focus: fieldId("goal", "target_amount") }]);
    }
    const lineOf = (a) => `${num(a.amount) ? `${money(num(a.amount))} ` : ""}${a.category || "spending"}`;
    const named = (a) => `${a.category || "Spending"}${num(a.amount) ? ` ${money(num(a.amount))}` : ""}`;
    const noMonth = alloc.filter((a) => !monthOk(a.period));
    if (noMonth.length === 1) add("uof.period", `Add a month to your ${lineOf(noMonth[0])} line`, "When the money is spent.", line(noMonth[0], "period"), "Add month");
    else if (noMonth.length) add("uof.period", `Add a month to ${noMonth.length} spending lines`, `${noMonth.map(named).join(", ")}: when each is spent.`, line(noMonth[0], "period"), "Add months");
    const noUse = alloc.filter((a) => blank(a.purpose) && blank(a.rationale));
    const subOf = (a) => (String(a.category || "").toLowerCase() === "reserve" ? "rationale" : "purpose");
    if (noUse.length === 1) add("uof.purpose", `Say what your ${lineOf(noUse[0])} line pays for`, "What the money changes.", line(noUse[0], subOf(noUse[0])), "Add purpose");
    else if (noUse.length) add("uof.purpose", `Say what ${noUse.length} spending lines pay for`, `${noUse.map(named).join(", ")}.`, line(noUse[0], subOf(noUse[0])), "Add purposes");
  }
  // C1: the funding goal (10)
  if (target === null) add("goal.amount", "Say how much you want to raise", "Funders start with the amount.", F("target_amount"), "Add amount");
  if (blank(s.receipt_date)) add("goal.date", `Add when you expect to receive the ${target ? money(target) : "money"}`, "The timing sets the forecast.", F("receipt_date"), "Add date");
  else if (target !== null && !s.timing_confirmed && !passed("C1.A")) {
    // One press (the owner's QA, 22 Oct: "Confirm date" opened the form, which has nothing to confirm, and the step stayed)
    add("goal.confirm", "Save your amount and date as final", `${money(target)}, needed by ${shortDate(s.receipt_date) || s.receipt_date}. Then the check counts them.`, F("receipt_date"), "Change");
    out[out.length - 1].confirmGoal = true;
  }
  if (blank(s.purpose)) add("goal.purpose", `Say what the ${target ? money(target) : "funding"} is for`, "Funders want to know what it pays for.", F("purpose"), "Add purpose");
  if (!milestones.length) add("goal.milestone", "Add a milestone the funding pays for", "With a measure and a target.", { section: "goal", field: "milestones" }, "Add milestone");
  else {
    // The milestone the money is linked to: the purpose's, else the one a spending line already names (F-3, 22 Oct), by id.
    const lineLinked = alloc.map((a) => a.milestone_id).find(Boolean);
    const linked = milestones.find((m) => m.id === (s.purpose_milestone_id || lineLinked));
    if (linked) {
      const lacks = [["measure", "a measure"], ["target", "a target"], ["due_date", "a due date"]].filter(([k]) => blank(linked[k]));
      if (lacks.length) {
        const words = lacks.map(([, w]) => w);
        const cta = lacks.length === 1 ? { measure: "Add measure", target: "Add target", due_date: "Add due date" }[lacks[0][0]] : "Complete milestone";
        add("goal.milestone.measure", `Add ${words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words[0]} to '${linked.outcome || "your milestone"}'`,
          "So progress can be measured.", { section: "goal", field: "milestones", focus: fieldId("goal", "milestones", indexOf(milestones, linked.id), lacks[0][0]) }, cta);
      }
      if (!s.purpose_milestone_id) add("goal.link", `Link your funding purpose to '${linked.outcome || "your milestone"}'`, "It is the milestone your spending line already names.", F("purpose_milestone_id"), "Choose milestone");
    } else add("goal.link", `Link your use of funds to a milestone${firstGood?.outcome ? `: ${firstGood.outcome}` : ""}`, "It shows what the money achieves.", F("purpose_milestone_id"), "Choose milestone");
  }
  // F-4: the amount in the case's title against its target: flagged, both editable, never rewritten for you
  const titled = String(s.title || "").match(/([£$€₦]|NGN|GBP|USD)\s?(\d+(?:[.,]\d+)?)\s?([km])?\b/i);
  if (titled && target) {
    const inTitle = Number(titled[2].replace(",", "")) * (/k/i.test(titled[3] || "") ? 1000 : /m/i.test(titled[3] || "") ? 1e6 : 1);
    if (inTitle && Math.abs(inTitle - target) > 1) {
      add("goal.title", `Your title says ${money(inTitle)} but your target is ${money(target)}`, "Change whichever is wrong. Nothing is changed for you.", F("title"), "Edit title",
        [{ label: "Edit target", section: "goal", field: "target_amount", focus: fieldId("goal", "target_amount") }]);
    }
  }
  // C6: market (10)
  if (blank(get(s, "market.target_segment"))) add("market.segment", "Say who your target customer is", said("market.target_segment", "It shows there is a market you can win."), F("market.target_segment"), "Add customer");
  if (blank(get(s, "market.differentiation"))) add("market.diff", "Say what sets you apart", said("market.differentiation", "Why customers pick you."), F("market.differentiation"), "Add what sets you apart");
  if (blank(get(s, "market.acquisition_approach"))) add("market.approach", "Say how you will win customers", said("market.acquisition_approach", "The plan for reaching them."), F("market.acquisition_approach"), "Add how you win customers");
  if (blank(get(s, "market.acquisition_owner"))) add("market.owner", "Name who owns winning customers", "One person is responsible.", F("market.acquisition_owner"), "Add owner");
  if (blank(get(s, "market.acquisition_cost"))) add("market.cost", "Add what winning customers costs you", "A monthly budget or a cost per customer.", F("market.acquisition_cost"), "Add cost");
  if (!measurable(get(s, "market.acquisition_milestone_id")) && milestones.length) add("market.milestone", `Link winning customers to a milestone${firstGood?.outcome ? `: ${firstGood.outcome}` : ""}`, "How you will measure it.", F("market.acquisition_milestone_id"), "Choose milestone");
  // C5: economics (10)
  const econ = [["price", "your price per sale"], ["direct_cost", "your direct cost per sale"], ["fixed_costs_monthly", "your fixed costs each month"]]
    .filter(([k]) => blank(get(s, `economics.${k}`)));
  if (econ.length) add("economics", `Add ${econ.map(([, w]) => w).join(" and ")}`, "Your margin shows each sale pays its way.", F(`economics.${econ[0][0]}`), econ.length === 1 ? "Add figure" : "Add figures");
  // C4: demand evidence (15), when the check says none is attached: the evidence form, open, first field focused
  if (checks["C4.A"] && !passed("C4.A")) add("evidence", "Attach one dated piece of customer evidence", "An invoice, an order or signed interest.", { section: "traction", to: `${base}?tab=evidence&add=evidence` }, "Add evidence");
  // What the score waits on that only needs your confirmation: each a step with one press (the owner's QA, 22 Oct: "why
  // only 50?"). Your own confirmation is recorded as yours (self-attested), as the checklist allows.
  if (checks["C4.A"] === "passed" && checks["C4.B"] && !passed("C4.B")) {
    add("confirm.C4.B", "Confirm your demand evidence fits your customers and offer", "The evidence is attached; the check counts it once you confirm it.", { section: "traction", to: `${base}?tab=evidence` }, "Confirm");
    out[out.length - 1].attest = { code: "C4.B", rationale: "Confirmed by the owner: the attached evidence is from our own customers, for the offer in this case." };
  }
  if (checks["C5.A"] === "passed" && checks["C5.B"] && !passed("C5.B")) {
    add("confirm.C5.B", "Confirm your price, costs and break-even", "Your figures are in; the check counts them once you confirm them.", { section: "finances", field: "economics.price" }, "Confirm");
    out[out.length - 1].attest = { code: "C5.B", rationale: "Confirmed by the owner: price, costs and break-even reviewed, with their limits." };
  }
  const docsCheck = (subject.assessment?.result?.criteria || []).flatMap((c) => c.checks || []).find((c) => c.code === "C8.A");
  const notReviewed = String(docsCheck?.reason || "").match(/Not reviewed: (.+?)\.?$/);
  // the documents the check names, by their labels, less those reviewed since (the owner's QA, 23 Oct: marked reviewed
  // in the form, the card still asked until the next check)
  const packItems = (subject.summary?.pack?.items || []).filter((i) => notReviewed && notReviewed[1].includes(i.label));
  const toReview = (packItems.length ? packItems : [{ key: "use_of_funds_schedule" }, { key: "forecast" }]).filter((i) => !(s.documents || {})[i.key]?.reviewed);
  if (docsCheck && docsCheck.state !== "passed" && notReviewed && toReview.length) {
    const names = packItems.length ? toReview.map((i) => i.label).join(", ") : notReviewed[1];
    add("confirm.docs", `Mark as reviewed: ${names}`, "You've checked them; the check counts them once they're marked.", { section: "documents", field: "required-documents" }, "Mark reviewed");
    out[out.length - 1].review = toReview.map((i) => i.key);
  }
  // C7: team (10)
  const people = rows(get(s, "team.responsibilities"));
  if (!people.length) add("team.who", "Name who delivers the plan and who wins customers", "Funders back the people.", { section: "team", field: "team.responsibilities" }, "Add people");
  people.forEach((p, i) => { if (blank(p.owner)) add(`team.owner.${p.id || i}`, `Name the owner of ${p.area || "this area"}`, "Each key area has a named person.", { section: "team", field: "team.responsibilities", focus: fieldId("team", "team.responsibilities", i, "owner") }, "Add owner"); });
  const gaps = rows(get(s, "team.gaps"));
  if (!gaps.length && !get(s, "team.no_gaps")) add("team.gaps", "List your team's capacity gaps, or confirm there are none", "What could slow delivery, and the fix.", F("team.no_gaps"), "Add gaps or confirm none");
  gaps.forEach((g, i) => { if (blank(g.action)) add(`team.gap.${g.id || i}`, `Add an action for the gap: ${g.gap || "untitled"}`, "What you will do about it.", { section: "team", field: "team.gaps", focus: fieldId("team", "team.gaps", i, "action") }, "Add action"); });
  // C8: risks (10)
  const risks = rows(s.risks);
  if (!risks.length && !s.no_known_risks) add("risks", "List your known risks, or confirm there are none", "Each with what you will do about it.", F("no_known_risks"), "Add risks or confirm none");
  risks.forEach((r, i) => { if (blank(r.action)) add(`risk.${r.id || i}`, `Add an action for the risk: ${r.risk || "untitled"}`, "What you will do about it.", { section: "documents", field: "risks", focus: fieldId("documents", "risks", i, "action") }, "Add action"); });

  return { steps: out.slice(0, max), total: out.length };
}

// Each top-level field's section, as the funding profile lays them out.
const SECTION_OF = {
  title: "goal", target_amount: "goal", currency: "goal", receipt_date: "goal", purpose: "goal", route_preference: "goal", milestones: "goal",
  purpose_milestone_id: "goal", business_model: "market", stage: "market", market: "market", traction: "traction", economics: "finances",
  use_of_funds: "finances", team: "team", risks: "documents", no_known_risks: "documents",
};

/** "Funding goal 6 of 7 · Finances 4 of 5 …": each section's answered count, from the case. */
export function sectionCounts(subject, steps = []) {
  // Never a tick beside a section that still has a step (the owner's QA, 21 Oct: "Finances 5 of 5" with three months missing).
  return (subject?.sections || []).map((x) => {
    const open = steps.filter((s) => s.section === x.key).length;
    const name = String(x.title).replace(/ and .*$/, "");
    return { key: x.key, answered: x.answered, total: x.total, done: x.answered >= x.total && !open,
      text: x.answered >= x.total && open ? `${name}: ${open} to fix` : `${name} ${x.answered} of ${x.total}` };
  });
}
