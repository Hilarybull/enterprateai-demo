// A launch plan's steps against the plan as it is now (the owner's QA, 23 Oct: "some of these fields are filled already"):
// the last check lists its gaps; a gap whose fields are now filled (by the owner or the Agent) is not a step any more. It
// stays "Done, waiting for recheck" until the check runs again. Launch only: the funding case has its own (caseSteps).
const said = (v) => v !== null && v !== undefined && String(v).trim() !== "";
const at = (o, path) => path.split(".").reduce((x, k) => (x && typeof x === "object" ? x[k] : undefined), o);

const DONE = {
  cash: (d, s) => {
    const months = (s.forecast?.data?.months || []).filter((m) => m && m.month);
    return months.length > 0 && months.every((m) => said(m.receipts) && said(m.payments));
  },
  demand: (d, s) => (s.evidence || []).length > 0,
  offer: (d) => said(at(d, "offer.price")) && said(at(d, "economics.price_per_unit")) && said(at(d, "economics.variable_cost_per_unit")),
  delivery: (d) => said(at(d, "planned_volume.amount")) && said(at(d, "delivery.capacity_available")),
  process: (d) => said(at(d, "operations.process")) && said(at(d, "operations.dry_run.date")),
  prerequisites: (d) => (at(d, "prerequisites") || []).length > 0 || Boolean(at(d, "no_prerequisites")),
  route: (d) => said(at(d, "market.channel")),
  control: (d) => said(d.target_date) && (said(at(d, "market.owner")) || (at(d, "control.milestones") || []).some((m) => m && said(m.owner))),
};

/** True when the plan already holds what this step asks for. */
export function launchStepDone(key, subject, data = null) {
  const check = DONE[key];
  return Boolean(check && check(data || subject?.data || {}, subject || {}));
}

/** The steps still open on this launch plan, from the check's list. */
export function openLaunchSteps(steps, subject, data = null) {
  return (steps || []).filter((st) => !launchStepDone(st.key, subject, data));
}

// ── A launch plan's own steps, from its checks (the owner's QA, 23 Oct: "no confirm on these checks, how will you know I
// have confirmed", "you mentioned all these in the funding readiness, now we are having the same issues here"). Each open
// check is one step: what only needs your confirmation is one press (Confirm), the rest opens the very field. Launch only.
const CHECK_STEP = {
  "C1.A": { title: "Attach one dated piece of customer evidence", why: "An enquiry, a pre-order or signed interest.", tab: "evidence", cta: "Add evidence" },
  "C1.B": { title: "Confirm your evidence fits your customers and offer", why: "It counts once you've reviewed what it does and doesn't show.",
            attest: "Confirmed by the owner: the evidence is from our own customers, for this offer, and its limits are understood." },
  "C2.A": { title: "Confirm your offer", why: "What you launch, its price, delivery terms and promise count once confirmed.", confirmOffer: true, section: "economics", field: "offer.launch_scope" },
  "C2.B": { title: "Confirm your price, costs and margin", why: "Your figures are in; they count once you've reviewed the margin.",
            attest: "Confirmed by the owner: price, cost to deliver and fixed costs reviewed, with what the margin means." },
  "C3.A": { title: "Confirm your cash forecast is still right", why: "It counts once you've checked it this month.", confirmForecast: true, section: "cash", field: "forecast" },
  "C3.B": { title: "List your setup and running commitments, or confirm there are none", why: "Rent, equipment, subscriptions: anything the launch commits you to.",
            noCommitments: true, section: "cash", field: "forecast" },
  "C4.A": { title: "Enter your capacity and what is already booked", why: "So orders don't outrun what you can do.", section: "delivery", field: "delivery.capacity_available" },
  "C4.B": { title: "List who and what the launch depends on", why: "Suppliers, people and systems, with a backup where needed.", section: "delivery", field: "delivery.dependencies" },
  "C5.A": { title: "Describe how an order becomes a delivery and a payment", why: "One line each step.", section: "operations", field: "operations.process" },
  "C5.B": { title: "Record one test order, end to end", why: "From order to delivery to payment, once, before launch.", section: "operations", field: "operations.dry_run.date", cta: "Record it" },
  "C6.A": { title: "Confirm which prerequisites apply", why: "Licences, registrations and insurance: reviewed for this launch.",
            attest: "Confirmed by the owner: the launch's obligations and prerequisites were reviewed, and which apply is recorded." },
  "C6.B": { title: "Mark your prerequisites done", why: "Each one that applies, completed before launch.", prereqDone: true, section: "operations", field: "prerequisites",
            more: [{ label: "Open Business Registration", to: "/registration" }] },
  "C7.A": { title: "Name your first channel, its audience and message", why: "A launch needs a way to reach customers.", section: "sales", field: "market.channel" },
  "C7.B": { title: "Give the channel an owner, a budget and a target", why: "Someone runs it, with a number to aim for.", section: "sales", field: "market.budget" },
  "C8.A": { title: "Set the launch date and owners", why: "Every milestone with a date and an owner.", section: "sales", field: "control.milestones" },
  "C8.B": { title: "Record success measures and a review date", why: "How you'll judge the launch, and when you'll look back.", section: "sales", field: "control.success_measures" },
};

/** The open checks of the plan's last check, as steps: { steps, total }, in the funding case's step shape. */
export function launchCaseSteps(subject, { max = 50 } = {}) {
  if (!subject?.id) return null;
  const base = `/launch/${subject.id}`;
  const all = (subject.assessment?.result?.criteria || []).flatMap((c) => (c.checks || []).map((ch) => ({ ...ch, criterion: c.code || c.key })));
  const state = Object.fromEntries(all.map((ch) => [ch.code, ch.state]));
  // A confirmation only when there is something to confirm (the owner's QA, 23 Oct): the evidence review after evidence, the
  // margin review once its figures are in, the forecast's confirmation once it is complete. Until then, the missing field.
  const open = all.filter((ch) => ch.state !== "passed" && CHECK_STEP[ch.code])
    .filter((ch) => !(ch.code === "C1.B" && state["C1.A"] !== "passed"))
    .filter((ch) => !(ch.code === "C6.A" && !(subject.data?.prerequisites || []).length));
  const steps = open.map((ch) => {
    let def = CHECK_STEP[ch.code];
    const reason = String(ch.reason || "");
    if (ch.code === "C2.B" && /^Enter /.test(reason)) {
      const missing = ["economics.price_per_unit", "economics.variable_cost_per_unit", "economics.fixed_costs_monthly"].find((f) => !said(at(subject.data || {}, f)));
      def = { title: "Add your price, cost and fixed costs", why: "Each sale has to leave a margin.", section: "economics", field: missing || "economics.fixed_costs_monthly" };
    }
    if (ch.code === "C4.A" && said(at(subject.data || {}, "delivery.capacity_available")) && said(at(subject.data || {}, "delivery.capacity_committed"))) {
      // The figures are in (the Agent's or yours): they count once you confirm them (the owner's QA, 23 Oct)
      def = { title: "Confirm your capacity", why: `${at(subject.data, "delivery.capacity_available")} ${at(subject.data, "delivery.capacity_unit") || "hours"} a month available, `
        + `${at(subject.data, "delivery.capacity_committed")} already booked. Change them first if they're not right.`, confirmCapacity: true, section: "delivery", field: "delivery.capacity_available" };
    }
    if (ch.code === "C3.A" && !/confirm/i.test(reason)) {
      def = { title: "Complete your cash forecast", why: "Every month it must cover, money in and money out.", section: "cash", field: "forecast" };
    }
    const link = (section, field) => `${base}?tab=answers&section=${section}${field ? `&field=${encodeURIComponent(field)}` : ""}`;
    const to = def.tab ? `${base}?tab=${def.tab}&add=evidence` : def.section ? link(def.section, def.field) : `${base}?tab=evidence`;
    const one = Boolean(def.attest || def.confirmOffer || def.confirmForecast || def.noCommitments || def.prereqDone || def.confirmCapacity);
    return { key: `check.${ch.code}`, code: ch.code, kind: ch.state === "failed" ? "failed" : "unknown", badge: ch.state === "failed" ? "Must fix" : one ? "Confirm" : "To do",
      title: def.title, why: ch.reason || def.why, field: true, cta: def.cta || (one ? "Check it" : "Fill it in"), to,
      more: (def.more || []).map((m) => ({ ...m })),
      ...(def.attest ? { attest: { code: ch.code, rationale: def.attest } } : {}),
      ...(def.confirmOffer ? { confirmOffer: true } : {}), ...(def.confirmForecast ? { confirmForecast: true } : {}),
      ...(def.noCommitments ? { noCommitments: true } : {}), ...(def.prereqDone ? { prereqDone: true } : {}), ...(def.confirmCapacity ? { confirmCapacity: true } : {}) };
  });
  // A step whose fields the plan now holds is "done, waiting for recheck", not shown (see openLaunchSteps)
  const kept = steps.filter((st) => !(LAUNCH_FILLED[st.code] && LAUNCH_FILLED[st.code](subject.data || {}, subject)));
  return { steps: kept.slice(0, max), total: kept.length };
}

// The checks a filled field answers before the next check runs
const LAUNCH_FILLED = {
  "C1.A": (d, s) => (s.evidence || []).length > 0,
  "C2.A": (d) => Boolean(at(d, "offer.confirmed")),
  "C5.B": (d) => said(at(d, "operations.dry_run.date")),
  "C7.A": (d) => said(at(d, "market.channel")) && said(at(d, "market.message")),
  "C7.B": (d) => said(at(d, "market.owner")) && said(at(d, "market.budget")) && said(at(d, "market.target")),
};
