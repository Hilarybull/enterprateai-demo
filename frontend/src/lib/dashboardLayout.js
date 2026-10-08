// How the dashboard lays out what the server composed: which three action cards a stage
// shows, which four insight cards fill the row, and how a readiness result is worded on a
// card. Presentation only: nothing here is calculated, and scores are shown as given.

export const READINESS_CHIP = {
  ready: { label: "Ready", tone: "emerald", mark: "✓" },
  conditionally_ready: { label: "Conditionally ready", tone: "amber", mark: "~" },
  not_ready: { label: "Not ready", tone: "rose", mark: "!" },
  insufficient_evidence: { label: "Not enough evidence", tone: "slate", mark: "?" },
};

const CARD = {
  essentials: { title: "Essentials", description: "Create invoices, quotations, receipts and contracts.", cta: "Open Essentials", href: "/operations", icon: "doc" },
  validate: { title: "Validate My Idea", description: "Test assumptions and analyse market risk.", cta: "Open Idea Validation", href: "/validation", icon: "check" },
  business_plan: { title: "Business Plan", description: "Draft and refine a structured plan for your business.", cta: "Open Business Plans", href: "/blueprint?tab=business-plans", icon: "book" },
  scenarios: { title: "Scenarios", description: "Test different market conditions and outcomes.", cta: "Simulate", href: "/simulation", icon: "bars" },
  growth_scenarios: { title: "Scenarios", description: "Test a growth plan against revenue, costs and cash.", cta: "Simulate", href: "/simulation", icon: "bars" },
  registration: { title: "Business Registration", description: "Register the business and cover the legal steps.", cta: "Open Registration", href: "/registration", icon: "shield" },
  funding_readiness: { title: "Funding Readiness", description: "See how prepared you are to approach funders, and what is missing.", cta: "Check Funding Readiness", href: "/funding", icon: "cash", readiness: "funding" },
  launch_readiness: { title: "Launch Readiness", description: "See what must be in place before you launch, and what is blocking you.", cta: "Check Launch Readiness", href: "/launch", icon: "rocket", readiness: "launch" },
};

const STAGE_CARDS = {
  idea: ["validate", "business_plan", "scenarios"],
  pre_launch: ["launch_readiness", "registration", "funding_readiness"],
  operating: ["essentials", "validate", "scenarios"],
  growth: ["funding_readiness", "growth_scenarios", "essentials"],
};
// Used in place of a readiness card when that feature is switched off.
const STAND_IN = ["business_plan", "scenarios", "essentials", "validate"];

const summaryOf = (dashboard, which) => (which === "funding" ? dashboard?.funding_readiness : dashboard?.launch_check) || null;
const pathOf = (which, s) => (which === "funding" ? `/funding/${s.case_id}` : `/launch/${s.initiative_id}`);

/** The three action cards for the business's stage. */
export function actionCardsFor(dashboard) {
  const stage = dashboard?.context?.business_stage;
  const keys = [...(STAGE_CARDS[stage] || STAGE_CARDS.operating)];
  const on = dashboard?.readiness_features || {};
  const used = new Set(keys);
  return keys.map((key) => {
    let k = key;
    if (CARD[k].readiness && !on[CARD[k].readiness]) {
      k = STAND_IN.find((s) => !used.has(s)) || "business_plan";
      used.add(k);
    }
    const card = { key: k, ...CARD[k] };
    if (k === "registration" && dashboard?.registration_status) {
      // The same structure as the launch and funding cards: subject, status badge, progress, one button.
      const r = dashboard.registration_status;
      return {
        ...card,
        status: {
          name: r.registered && r.number ? `${r.subject} · company number ${r.number}` : r.subject,
          chip: r.registered ? { label: "Registered", tone: "emerald", mark: "✓" } : { label: "Not registered", tone: "slate", mark: "?" },
          score: null, progress: r.progress, stale: false,
        },
      };
    }
    const summary = card.readiness ? summaryOf(dashboard, card.readiness) : null;
    if (!summary) return card;
    return {
      ...card, href: pathOf(card.readiness, summary), cta: card.readiness === "funding" ? "Open funding case" : "Open launch plan",
      status: {
        name: summary.title,
        chip: summary.classification ? READINESS_CHIP[summary.classification] : { label: summary.execution_status === "failed" ? "Last check didn't finish" : "Not checked yet", tone: "slate", mark: "?" },
        score: summary.classification && summary.score !== null && summary.score !== undefined ? summary.score : null,
        progress: !summary.classification ? null : summary.blocker_count ? `${summary.blocker_count} blocker${summary.blocker_count === 1 ? "" : "s"}` : null,
        stale: summary.freshness === "stale",
      },
    };
  });
}

/**
 * The insight row: at most `max_priority_cards` (4) cards, with no separate blocker card.
 * A launch blocker or a failed funding gate takes the red Fragility / Risk Alert slot. A
 * readiness next action fills Recommended Next Step only when nothing else already has.
 */
export function arrangeInsights(dashboard) {
  const max = dashboard?.max_priority_cards || 4;
  const all = dashboard?.insights || [];
  const launch = dashboard?.launch_check;
  const funding = dashboard?.funding_readiness;
  const blockerCard = all.find((c) => c.key === "blocker");
  const gapsCard = all.find((c) => c.key === "funding_gaps");
  const riskCard = all.find((c) => c.key === "risk");

  let red = null;
  let usedGaps = false;
  if (launch?.blockers?.length) {
    const to = `/launch/${launch.initiative_id}?tab=results`;
    red = { ...(blockerCard || riskCard || {}), key: blockerCard ? "blocker" : "launch_blocker", widget_id: "blocker", title: "Launch blocker", tone: "rose", state: launch.freshness === "stale" ? "stale" : "available",
      severity: "high", priority_class: 1, text: launch.blockers[0].reason + (launch.blockers.length > 1 ? ` (and ${launch.blockers.length - 1} more)` : ""),
      detail: launch.title, cta: { label: "View blocker", to }, more: { to }, agent_action: null, items: [],
      why: blockerCard?.why || { summary: `From the launch readiness check for “${launch.title}”.`, evidence: launch.blockers.map((b) => ({ label: b.label, value: b.reason })), source: "Launch Readiness Check", missing: [] } };
  } else if (funding?.blockers?.length) {
    const to = `/funding/${funding.case_id}?tab=results`;
    usedGaps = true;
    red = { ...(gapsCard || riskCard || {}), key: gapsCard ? "funding_gaps" : "funding_gap", widget_id: "funding_gaps", title: "Funding gap", tone: "rose", state: funding.freshness === "stale" ? "stale" : "available",
      severity: "high", priority_class: 1, text: funding.blockers[0].reason + (funding.blockers.length > 1 ? ` (and ${funding.blockers.length - 1} more)` : ""),
      detail: funding.title, cta: { label: "View blocker", to }, more: { to }, agent_action: null, items: [],
      why: gapsCard?.why || { summary: `From the funding readiness check for “${funding.title}”.`, evidence: funding.blockers.map((b) => ({ label: b.label, value: b.reason })), source: "Funding Readiness Check", missing: [] } };
  } else if (blockerCard?.positive) {
    // The launch is ready with nothing blocking it: good news in the same slot, so the row keeps its cards.
    red = { ...blockerCard, tone: "emerald", severity: null, priority_class: 4 };
  } else if (blockerCard) {
    // No check has found a blocker, but something is still missing before launch: same slot, same look.
    red = { ...blockerCard, title: "Launch blocker", tone: "rose" };
  }

  const rest = all.filter((c) => c.key !== "blocker" && !(usedGaps && c.key === "funding_gaps") && !(red && c.key === "risk"));
  const cards = red ? [red, ...rest] : [...rest];

  if (!cards.some((c) => c.key === "next_step")) {
    const source = [launch && { s: launch, which: "launch" }, funding && { s: funding, which: "funding" }].find((x) => x?.s?.next_action);
    if (source) {
      const to = `${pathOf(source.which, source.s)}?tab=actions`;
      const step = { key: "next_step", widget_id: "next_step", title: "Recommended Next Step", tone: "brand", state: "available", priority_class: 2,
        text: source.s.next_action.title, detail: source.s.title, cta: { label: "Open next action", to }, more: { to }, agent_action: null, items: [],
        why: { summary: `The highest-priority open action from the ${source.which} readiness check for “${source.s.title}”.`, evidence: [], source: source.which === "launch" ? "Launch Readiness Check" : "Funding Readiness Check", missing: [] } };
      const at = cards.findIndex((c) => (c.priority_class || 9) > 2);
      cards.splice(at === -1 ? cards.length : at, 0, step);
    }
  }
  return cards.slice(0, max);
}
