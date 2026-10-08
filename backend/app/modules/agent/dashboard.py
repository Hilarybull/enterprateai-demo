"""Adaptive Dashboard composition (PRD-AD-001).

The page has a fixed skeleton (context row, Agent + approvals, four action cards, a KPI
row, up to five priority insights, one report entry). What fills each surface is chosen
here, from data:

  * `WIDGETS`        every widget that can appear, and the stages/pathways it is eligible for
  * `STAGE_LAYOUT`   for each business stage, which widgets fill which surface, in order

Nothing about a stage is written into the page. To change what a stage shows, change the
tables. They are checked against each other when the module loads.

The dashboard stores no scores of its own (s11) and never changes an engine's result
(AC-15): every figure comes from `business.py` or the business's own records, and each
insight carries the evidence it was built from (s10.3).

Priority order for insights (s10.1), at most five:
    1 critical risks or blockers · 2 time-sensitive approvals or actions
    3 the user's current goal    · 4 the recommended next action · 5 supporting insight
Within a class the order is fixed, so the page only rearranges on a material change (s10.2).
The current goal reorders cards within the stage; it never brings in another stage's cards.
"""
from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from typing import Any

from app.modules.agent import business as bz
from app.modules.agent.documents import fmt_money

logger = logging.getLogger(__name__)

SCENARIO_PROMPT = "What happens if my costs rise by 10%?"
MAX_PRIORITY_CARDS = 4      # cards shown in the insights row
CANDIDATE_CARDS = 5         # cards composed, in priority order; the page shows the first four after merging a blocker into the risk slot
STALE_AFTER_DAYS = 30
APPROVAL_SOON_HOURS = 24
TRANSITION_DAYS = 30            # launch items stay this long after the first paid invoice
GROWTH_MIN_PAID_INVOICES = 5
GROWTH_MIN_PCT = 20.0           # revenue up by at least this much, quarter on quarter

STAGES = ("idea", "pre_launch", "operating", "growth")      # multi_entity comes later (s17)
STAGE_ALIASES = {"startup": "pre_launch"}
STAGE_LABEL = {"idea": "Idea", "pre_launch": "Pre-launch", "operating": "Operating", "growth": "Growth"}
PATHWAYS = ("startup", "small_business")
PATHWAY_OF = {"idea": "startup", "pre_launch": "startup", "operating": "small_business", "growth": "small_business"}

GOALS = {
    "launch": "Launch the business",
    "funding": "Prepare for funding",
    "cash": "Improve cash flow",
    "growth": "Grow revenue",
    "risk_reduction": "Reduce risk",
}
# A goal raises the related insights to class 3, among those the stage already shows.
_GOAL_FAMILIES = {
    "launch": {"blocker", "next_step", "idea_weakness"},
    "funding": {"blocker", "funding_gaps"},
    "cash": {"cash", "next_step"},
    "growth": {"scenario", "opportunities"},
    "risk_reduction": {"risk", "idea_weakness"},
}


# ══ Configuration ═════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class WidgetDefinition:
    """What can appear on the dashboard, and for whom (s11.1)."""
    widget_id: str
    version: int
    widget_type: str                     # insight | action_card | kpi | report | panel
    title: str
    supported_pathways: tuple[str, ...]
    eligible_business_stages: tuple[str, ...]
    required_sources: tuple[str, ...] = ()
    required_permissions: tuple[str, ...] = ("view",)
    required_entitlements: tuple[str, ...] = ()
    priority_class: int = 5              # insights: the class taken when nothing raises it
    supported_actions: tuple[str, ...] = ()
    active_flag: bool = True
    config: dict = field(default_factory=dict)      # presentation data for the surface


_ALL = STAGES
_PRE = ("idea", "pre_launch")
_TRADING = ("operating", "growth")


def _paths(stages: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(PATHWAY_OF[s] for s in stages))


def _w(widget_id: str, widget_type: str, title: str, stages: tuple[str, ...], **kw) -> WidgetDefinition:
    return WidgetDefinition(widget_id, 1, widget_type, title, _paths(stages), stages, **kw)


WIDGETS: dict[str, WidgetDefinition] = {w.widget_id: w for w in [
    # ── priority insights (slots: critical · time-sensitive · goal or scenario · supporting) ──
    _w("idea_weakness", "insight", "Idea Weakness", ("idea",), required_sources=("Assessment",), priority_class=1,
       supported_actions=("open_tool",)),
    _w("blocker", "insight", "Launch / Funding Blocker", ("pre_launch",), required_sources=("BusinessProfile", "Assessment"),
       priority_class=1, supported_actions=("open_tool",)),
    _w("risk", "insight", "Fragility / Risk Alert", _TRADING, required_sources=("RiskFlag", "Financial data"), priority_class=5,
       supported_actions=("explain", "agent")),
    _w("approval", "insight", "Approval Due Soon", _ALL, required_sources=("Approval",), required_permissions=("send",),
       priority_class=2, supported_actions=("open_run",)),
    _w("contract_action", "insight", "Contract Action", ("growth",), required_sources=("Financial data",), priority_class=2,
       supported_actions=("open_tool",)),
    _w("next_step", "insight", "Recommended Next Step", _ALL, required_sources=("Recommendation",),
       priority_class=4, supported_actions=("open_tool", "agent")),
    _w("scenario", "insight", "Suggested Scenario", _ALL, required_sources=("Scenario",), priority_class=5,
       supported_actions=("open_tool", "agent")),
    _w("cash", "insight", "Cash Position", ("operating",), required_sources=("Financial data",), priority_class=5,
       supported_actions=("open_tool",)),
    _w("marketplace_similar", "insight", "Similar Businesses", ("idea",), required_sources=("BusinessProfile",), priority_class=5,
       supported_actions=("open_tool",)),
    _w("funding_gaps", "insight", "Funding Readiness Gaps", ("pre_launch",), required_sources=("Financial data", "BusinessProfile"),
       priority_class=5, supported_actions=("open_tool",)),
    _w("opportunities", "insight", "Opportunities", ("growth",), required_sources=("Financial data",), priority_class=5,
       supported_actions=("open_tool",)),

    # ── action cards (four slots) ────────────────────────────────────────────
    _w("essentials", "action_card", "Essentials", _TRADING,
       config={"description": "Create invoices, quotations, receipts and contracts.", "cta": "Open Essentials", "href": "/operations", "icon": "doc"}),
    _w("validate", "action_card", "Validate My Idea", ("idea", "operating"),
       config={"description": "Test assumptions and analyse market risk.", "cta": "Open Idea Validation", "href": "/validation", "icon": "check"}),
    _w("business_plan", "action_card", "Business Plan", _ALL,
       config={"description": "Draft and refine a structured plan for your business.", "cta": "Open Business Plans",
               "href": "/blueprint?tab=business-plans", "icon": "book"}),
    _w("scenarios", "action_card", "Scenarios", _ALL,
       config={"description": "Simulate decisions and forecast outcomes.", "cta": "Open Simulator", "href": "/simulation", "icon": "bars"}),
    _w("registration", "action_card", "Business Registration", _PRE,
       config={"description": "Register the business and cover the legal steps.", "cta": "Open Registration", "href": "/registration", "icon": "shield"}),
    _w("funding_readiness", "action_card", "Funding Readiness", ("pre_launch",),
       config={"description": "Check how prepared you are to approach funders, and what is missing.", "cta": "Check Funding Readiness",
               "href": "/funding", "icon": "cash"}),
    _w("marketplace", "action_card", "Marketplace", ("growth",),
       config={"description": "Find businesses to work with and be found by them.", "cta": "Open Marketplace", "href": "/marketplace", "icon": "store"}),

    # ── KPI tiles ────────────────────────────────────────────────────────────
    _w("validation_score", "kpi", "Validation Score", ("idea",), required_sources=("Assessment",), config={"to": "/validation"}),
    _w("market_size", "kpi", "Market Size", ("idea",), required_sources=("Assessment",), config={"to": "/validation"}),
    _w("startup_costs", "kpi", "Startup Costs", ("idea",), required_sources=("Financial data",), config={"to": "/simulation"}),
    _w("funding_needed", "kpi", "Funding Needed", ("idea",), required_sources=("Financial data",), config={"to": "/simulation"}),
    _w("launch_readiness", "kpi", "Launch Readiness", ("pre_launch",), required_sources=("BusinessProfile",), config={"to": "/launch"}),
    _w("runway", "kpi", "Runway", ("pre_launch",), required_sources=("Financial data",), config={"to": "/operations?tab=Reports"}),
    _w("planned_costs", "kpi", "Planned Costs", ("pre_launch",), required_sources=("Financial data",), config={"to": "/simulation"}),
    _w("funding_secured", "kpi", "Funding Secured", ("pre_launch",), required_sources=("Financial data",), config={"to": "/simulation"}),
    _w("launch_risks", "kpi", "Active Risks", ("pre_launch",), required_sources=("Assessment",), config={"to": "/launch", "good_when_up": False}),
    # `client_trend`: the page draws these from the records it already holds (period filter, sparkline).
    _w("revenue", "kpi", "Total Revenue", ("operating",), required_sources=("Financial data",), config={"client_trend": "revenue"}),
    _w("cash_balance", "kpi", "Cash", _TRADING, required_sources=("Financial data",), config={"client_trend": "cash"}),
    _w("costs", "kpi", "Expenses & CoS", ("operating",), required_sources=("Financial data",), config={"client_trend": "costs"}),
    _w("receivables", "kpi", "Receivables", _TRADING, required_sources=("Financial data",), config={"client_trend": "receivables"}),
    _w("active_risks", "kpi", "Active Risks", ("operating",), required_sources=("RiskFlag",), config={"client_trend": "risks"}),
    _w("revenue_growth", "kpi", "Revenue Growth", ("growth",), required_sources=("Financial data",), config={"to": "/operations?tab=Reports"}),
    _w("margin", "kpi", "Gross Margin", ("growth",), required_sources=("Financial data",), config={"to": "/operations?tab=Reports"}),
    _w("top_customer_share", "kpi", "Top Customer Share", ("growth",), required_sources=("RiskFlag",), config={"to": "/operations?tab=Reports"}),

    # ── the one report entry ─────────────────────────────────────────────────
    _w("idea_validation_report", "report", "Idea Validation Report", ("idea",), required_sources=("Assessment",),
       config={"description": "The full result of your idea validation: scores, risks and what to test next.",
               "cta": "View Idea Validation Report", "action": {"to": "/results"}}),
    _w("launch_readiness_report", "report", "Setup checklist", ("pre_launch",), required_sources=("BusinessProfile",),
       config={"description": "The basics your business has on record, and what is still to add.",
               "cta": "View setup checklist", "action": {"panel": "launch_readiness"},
               "secondary": {"label": "Launch readiness check", "to": "/launch"}}),
    _w("business_health_report", "report", "Business Health Report", _TRADING, required_sources=("Assessment", "RiskFlag", "Recommendation"),
       config={"description": "Get a full assessment of your business performance, risks, and recommendations.",
               "cta": "View Business Health Report", "action": {"panel": "business_health"}}),

    # ── panels ───────────────────────────────────────────────────────────────
    _w("agent", "panel", "EnterprateAI Agent", _ALL, required_sources=("WorkflowRun", "Recommendation", "AI Credits")),
    _w("needs_approval", "panel", "Needs Approval", _ALL, required_sources=("Approval",)),
]}
_ORDER = {key: n for n, key in enumerate(WIDGETS)}

# Which widgets fill each surface at each stage, in order. `agent_hide` names the Agent
# suggestions and starter shortcuts that make no sense yet at that stage.
_NO_INVOICE_YET = ("payment_followup", "receipt_send", "risk_concentration", "quote_to_cash")
STAGE_LAYOUT: dict[str, dict[str, Any]] = {
    "idea": {
        "headline": "validation_score",
        "action_cards": ("validate", "business_plan", "scenarios", "registration"),
        "kpis": ("validation_score", "market_size", "startup_costs", "funding_needed"),
        # critical: idea weakness · time-sensitive: next validation step · scenario: test pricing · supporting: similar businesses
        "insights": ("idea_weakness", "approval", "next_step", "scenario", "marketplace_similar"),
        "report": "idea_validation_report",
        "agent_hide": _NO_INVOICE_YET,
        "agent_suggestions": (
            {"key": "stage_validate", "icon": "bulb", "text": "I'm scoring your idea.", "action": {"to": "/validation"}},
            {"key": "stage_plan", "icon": "doc", "text": "I'm drafting your business plan.", "action": {"to": "/blueprint?tab=business-plans"}},
            {"key": "stage_market", "icon": "bars", "text": "I'm sizing your market.", "action": {"to": "/validation"}},
        ),
        "agent_shortcuts": (
            {"key": "validate_idea", "label": "Validate Idea", "icon": "bulb", "action": {"to": "/validation"}},
            {"key": "business_plan", "label": "Business Plan", "icon": "doc", "action": {"to": "/blueprint?tab=business-plans"}},
            {"key": "market_sizing", "label": "Market Sizing", "icon": "bars", "action": {"to": "/validation"}},
            {"key": "scenario_help", "label": "Scenario Help", "icon": "bars", "action": {"capability": "scenario_help", "prompt": SCENARIO_PROMPT}},
        ),
        "agent_placeholder": "Ask EnterprateAI about your idea, plan or market…",
        "kpi_empty": "Your idea's score, market size and the money it needs appear here once the idea is scored.",
    },
    "pre_launch": {
        "headline": "launch_readiness",
        "action_cards": ("business_plan", "funding_readiness", "registration", "scenarios"),
        "kpis": ("launch_readiness", "runway", "planned_costs", "funding_secured", "launch_risks"),
        # critical: launch / funding blocker · time-sensitive: next launch action · scenario: cash runway · supporting: funding gaps
        "insights": ("blocker", "approval", "next_step", "scenario", "funding_gaps"),
        "report": "launch_readiness_report",
        "agent_hide": _NO_INVOICE_YET,
        "agent_suggestions": (
            {"key": "stage_blockers", "icon": "alert", "tone": "rose", "text": "I'm checking what your launch still needs.", "action": {"to": "/account?section=workspace"}},
            {"key": "stage_funding", "icon": "doc", "text": "I'm drafting your funding pack.", "action": {"to": "/blueprint?tab=business-plans"}},
            {"key": "stage_register", "icon": "doc", "text": "I'm preparing your registration checklist.", "action": {"to": "/registration"}},
        ),
        "agent_shortcuts": (
            {"key": "launch_checklist", "label": "Setup Checklist", "icon": "doc", "action": {"to": "/dashboard?report=open"}},
            {"key": "funding_pack", "label": "Funding Pack", "icon": "doc", "action": {"to": "/blueprint?tab=business-plans"}},
            {"key": "registration", "label": "Registration", "icon": "doc", "action": {"to": "/registration"}},
            {"key": "scenario_help", "label": "Scenario Help", "icon": "bars", "action": {"capability": "scenario_help", "prompt": SCENARIO_PROMPT}},
        ),
        "agent_placeholder": "Ask EnterprateAI to help with your launch, funding or registration…",
        "kpi_empty": "Add your plan's costs and funding to see runway and planned spending.",
    },
    "operating": {
        "headline": "health",
        "action_cards": ("essentials", "validate", "business_plan", "scenarios"),
        "kpis": ("revenue", "cash_balance", "costs", "receivables", "active_risks"),
        # critical: risk or fragility alert · time-sensitive: overdue receivables · scenario · supporting: cash position
        "insights": ("risk", "approval", "next_step", "scenario", "cash"),
        "report": "business_health_report",
        "agent_hide": (),
        "agent_suggestions": (),      # quotes, follow-ups, receipts and risk responses come from the records
        "agent_shortcuts": (),        # the Agent panel's standard set
        "agent_placeholder": "Ask EnterprateAI to help with quotes, payments, risks or scenarios…",
        "kpi_empty": "Record your first invoice or expense to see revenue, cash and costs here.",
    },
    "growth": {
        "headline": "revenue_growth",
        "action_cards": ("essentials", "scenarios", "marketplace", "business_plan"),
        "kpis": ("revenue_growth", "margin", "cash_balance", "receivables", "top_customer_share"),
        # critical: concentration risk · time-sensitive: approval or contract action · scenario: growth · supporting: opportunities
        "insights": ("risk", "approval", "next_step", "contract_action", "scenario", "opportunities"),
        "report": "business_health_report",
        "agent_hide": (),
        "agent_suggestions": (
            {"key": "stage_pricing", "icon": "bars", "text": "I'm testing a 5% and a 10% price change.", "action": {"to": "/simulation"}},
            {"key": "stage_capacity", "icon": "bars", "text": "I'm checking your capacity.", "action": {"to": "/simulation"}},
            {"key": "stage_offer", "icon": "doc", "text": "I'm reviewing what sells.", "action": {"to": "/catalogue"}},
            {"key": "stage_expand", "icon": "bars", "text": "I'm modelling a 20% expansion.", "action": {"to": "/simulation"}},
        ),
        "agent_shortcuts": (
            {"key": "pricing_scenario", "label": "Pricing Scenario", "icon": "bars", "action": {"to": "/simulation"}},
            {"key": "quote_to_cash", "label": "Quote to Invoice", "icon": "doc", "action": {"capability": "quote_to_cash"}},
            {"key": "risk_concentration", "label": "Risk & Concentration", "icon": "alert", "tone": "rose", "action": {"capability": "risk_concentration"}},
            {"key": "opportunities", "label": "Opportunities", "icon": "doc", "action": {"to": "/marketplace"}},
        ),
        "agent_placeholder": "Ask EnterprateAI to help with pricing, capacity, new offers or expansion…",
        "kpi_empty": "Record your first invoice or expense to see growth, margin and cash here.",
    },
}


def _check_configuration() -> None:
    kinds = {"action_cards": "action_card", "kpis": "kpi", "insights": "insight"}
    for stage, layout in STAGE_LAYOUT.items():
        assert stage in STAGES, stage
        for surface, kind in kinds.items():
            for wid in layout[surface]:
                w = WIDGETS[wid]
                assert w.widget_type == kind and stage in w.eligible_business_stages, (stage, surface, wid)
        assert len(layout["action_cards"]) == 4, stage
        report = WIDGETS[layout["report"]]
        assert report.widget_type == "report" and stage in report.eligible_business_stages, stage
    assert set(STAGE_LAYOUT) == set(STAGES)


_check_configuration()


# ══ Facts from the business's records ═════════════════════════════════════════

def _financials(data: dict) -> dict:
    return data.get("financials") or {}


def _invoices(data: dict) -> list[dict]:
    return [i for i in _financials(data).get("invoices") or [] if isinstance(i, dict) and not i.get("archived")]


def _issued(data: dict) -> list[dict]:
    return [i for i in _invoices(data) if bz.status_of(i) not in ("", "draft")]


def _payments(data: dict) -> list[tuple[datetime, float]]:
    """(when, amount) for every payment received."""
    out = []
    for i in _invoices(data):
        if i.get("payments"):
            for p in i["payments"]:
                m = bz._moment(p.get("paid_at"))
                if m:
                    out.append((m, bz.money(p.get("amount"))))
        elif bz.status_of(i) == "paid":
            m = bz._moment(i.get("paid_at") or i.get("updated_at") or i.get("created_at"))
            if m:
                out.append((m, bz.invoice_total(i)))
    return out


def revenue_growth(data: dict, now: datetime) -> dict:
    """Money received in the last 90 days against the 90 days before."""
    pays = _payments(data)
    cut, start = now - timedelta(days=90), now - timedelta(days=180)
    recent = bz.money(sum(a for t, a in pays if cut < t <= now))
    prior = bz.money(sum(a for t, a in pays if start < t <= cut))
    pct = round((recent - prior) / prior * 100, 1) if prior > 0 else None
    return {"recent": recent, "prior": prior, "pct": pct, "paid_count": len(pays)}


def detect_stage(data: dict, now: datetime) -> tuple[str, list[str]]:
    """The business stage read from its records, with the signals that decided it."""
    pays = _payments(data)
    issued = _issued(data)
    if issued or pays:
        g = revenue_growth(data, now)
        if g["pct"] is not None and g["pct"] >= GROWTH_MIN_PCT and g["paid_count"] >= GROWTH_MIN_PAID_INVOICES:
            return "growth", [f"Revenue up {g['pct']:g}% on the previous 90 days", f"{g['paid_count']} payments received"]
        return "operating", [f"{len(issued)} invoice{'s' if len(issued) != 1 else ''} issued", f"{len(pays)} payment{'s' if len(pays) != 1 else ''} received"]
    signals = []
    if (data.get("decision") or {}).get("status") == "accepted" or data.get("validation"):
        signals.append("Idea validated")
    if (data.get("catalogue") or {}).get("products"):
        signals.append("Products or services listed")
    if data.get("business_plan") or data.get("live_plan") or data.get("blueprints"):
        signals.append("Business plan started")
    if signals:
        return "pre_launch", [*signals, "No invoices issued yet"]
    return "idea", ["No invoices or payments yet", "Idea not yet validated"]


def stage_of(data: dict, now: datetime) -> dict:
    """The stage the dashboard is composed for. A stage the business chose ("Not right? Change
    it") wins over the one read from its records; choosing it changes no business record."""
    detected, signals = detect_stage(data, now)
    chosen = data.get("dashboard_stage") if isinstance(data.get("dashboard_stage"), dict) else None
    stage = STAGE_ALIASES.get(str((chosen or {}).get("stage") or ""), str((chosen or {}).get("stage") or ""))
    if stage in STAGES:
        return {"stage": stage, "source": "manual", "detected": detected, "signals": signals,
                "set_by": chosen.get("set_by"), "set_at": chosen.get("set_at")}
    return {"stage": detected, "source": "records", "detected": detected, "signals": signals, "set_by": None, "set_at": None}


_PLANNED_COST_KEYS = ("planned_costs", "monthly_costs", "monthly_fixed_costs", "fixed_costs", "operating_costs", "startup_costs")
_FUNDING_KEYS = ("funding_needed", "funding_required", "capital_required", "funding_secured", "funding_raised", "starting_cash", "opening_cash")


def launch_readiness(data: dict, goal: str | None = None) -> dict:
    """What must be in place before launch (plus trading records when funding is the goal),
    from the business's own records. Each item names where it is added."""
    profile = data.get("workspace_profile") or {}
    fin = _financials(data)
    cat = data.get("catalogue") or {}
    name = str(profile.get("company_name") or "").strip()
    sources = _plan_sources(data)
    items = [
        {"key": "business_name", "label": "Business name", "to": "/account?section=workspace", "done": bool(name) and name.lower() not in ("my workspace", "unnamed")},
        {"key": "business_email", "label": "Business email address", "to": "/account?section=workspace", "done": bool(str(profile.get("email") or "").strip())},
        {"key": "idea_validated", "label": "A validated business idea", "to": "/validation",
         "done": (data.get("decision") or {}).get("status") == "accepted" or bool(data.get("validation"))},
        {"key": "offer", "label": "At least one product or service with a price", "to": "/catalogue", "done": bool(cat.get("products"))},
        {"key": "business_plan", "label": "A business plan", "to": "/blueprint?tab=business-plans",
         "done": bool(data.get("business_plan") or data.get("live_plan") or data.get("blueprints"))},
        {"key": "registered", "label": "Business registration", "to": "/registration",
         "done": bool(str(profile.get("registration_number") or "").strip() or data.get("registration"))},
        {"key": "costs_and_funding", "label": "Planned costs and funding figures", "to": "/simulation",
         "done": _find_number(sources, _PLANNED_COST_KEYS) is not None and _find_number(sources, _FUNDING_KEYS) is not None},
    ]
    if goal == "funding":
        items.append({"key": "financial_records", "label": "Income and expense records", "to": "/operations",
                      "done": bool(fin.get("invoices") or fin.get("expenses"))})
    done = sum(1 for i in items if i["done"])
    return {"items": items, "done": done, "total": len(items), "percent": round(done / len(items) * 100)}


def idea_steps(data: dict) -> list[dict]:
    """What follows validation for an idea, in order."""
    sources = _plan_sources(data)
    cat = data.get("catalogue") or {}
    profile = data.get("workspace_profile") or {}
    return [
        {"key": "market", "label": "Market size", "cta": "See the market size", "to": "/validation",
         "done": _find_number(sources, ("serviceable_addressable_market", "market_size", "tam", "total_addressable_market")) is not None},
        {"key": "plan", "label": "Business plan", "cta": "Open Business Plans", "to": "/blueprint?tab=business-plans",
         "done": bool(data.get("business_plan") or data.get("live_plan") or data.get("blueprints"))},
        {"key": "offer", "label": "Add a product or service with a price", "cta": "Open Catalogue", "to": "/catalogue",
         "done": bool(cat.get("products"))},
        {"key": "register", "label": "Business registration", "cta": "Open Registration", "to": "/registration",
         "done": bool(str(profile.get("registration_number") or "").strip() or data.get("registration"))},
    ]


def weakest_factor(data: dict) -> dict | None:
    """The lowest-scoring factor of the idea validation, with every factor as evidence."""
    def find(obj: Any, depth: int = 5) -> Any:
        if depth < 0:
            return None
        if isinstance(obj, dict):
            for key in ("dimension_scores", "factor_scores", "pillar_scores", "dimensions"):
                if isinstance(obj.get(key), (dict, list)) and obj[key]:
                    return obj[key]
            for v in obj.values():
                hit = find(v, depth - 1)
                if hit:
                    return hit
        elif isinstance(obj, list):
            for v in obj[:20]:
                hit = find(v, depth - 1)
                if hit:
                    return hit
        return None

    raw = find([data.get("validation"), data.get("idea_validation")])
    pairs: list[tuple[str, float]] = []
    entries = raw.items() if isinstance(raw, dict) else [((e.get("name") or e.get("label") or e.get("key") or e.get("dimension")), e) for e in raw or [] if isinstance(e, dict)]
    for name, value in entries:
        if isinstance(value, dict):
            value = value.get("score", value.get("value"))
        if name and isinstance(value, (int, float)) and not isinstance(value, bool):
            pairs.append((str(name).replace("_", " ").strip().capitalize(), float(value)))
    if not pairs:
        return None
    if all(0 <= v <= 1 for _, v in pairs):
        pairs = [(n, v * 100) for n, v in pairs]
    pairs.sort(key=lambda p: p[1])
    return {"label": pairs[0][0], "score": pairs[0][1], "factors": pairs}


def funding_gaps(data: dict) -> list[dict]:
    """What a funder will ask for that isn't on record yet."""
    sources = _plan_sources(data)
    checks = [
        ("A business plan", "/blueprint?tab=business-plans", bool(data.get("business_plan") or data.get("live_plan") or data.get("blueprints"))),
        ("Planned costs", "/simulation", _find_number(sources, _PLANNED_COST_KEYS) is not None),
        ("How much funding you need", "/simulation", _find_number(sources, ("funding_needed", "funding_required", "capital_required", "funding_gap")) is not None),
        ("Funding or starting cash already secured", "/simulation", _find_number(sources, ("funding_secured", "funding_raised", "starting_cash", "opening_cash")) is not None),
    ]
    return [{"label": label, "to": to} for label, to, ok in checks if not ok]


def contracts_needing_action(data: dict, now: datetime) -> list[dict]:
    """Contracts waiting to be signed, or ending within 30 days."""
    out = []
    for c in _financials(data).get("contracts") or []:
        if not isinstance(c, dict) or c.get("archived"):
            continue
        st = bz.status_of(c)
        who = c.get("party_name") or c.get("customer_name") or c.get("vendor_name") or "a counterparty"
        ref = c.get("reference") or "Contract"
        end = bz.parse_day(c.get("end_date"))
        if st in ("pending", "sent", "awaiting_signature"):
            out.append({"label": ref, "value": f"awaiting signature from {who}"})
        elif st in ("active", "signed") and end and 0 <= (end - now.date()).days <= 30:
            out.append({"label": ref, "value": f"with {who} ends {end.isoformat()}"})
    return out


def transition_of(data: dict, info: dict, now: datetime) -> dict | None:
    """For 30 days after the first payment, a business that has just started trading keeps
    its launch items in view."""
    if info["source"] != "records" or info["stage"] not in ("operating", "growth"):
        return None
    pays = _payments(data)
    if not pays:
        return None
    first = min(t for t, _ in pays)
    until = first + timedelta(days=TRANSITION_DAYS)
    if now > until:
        return None
    return {"from": "pre_launch", "first_paid_at": first.isoformat(), "until": until.isoformat(),
            "message": f"You've taken your first payment. Your launch items stay here until {until.strftime('%d %b %Y').lstrip('0')}, "
                       "then the dashboard moves fully to running the business."}


def _latest_activity(data: dict) -> datetime | None:
    fin = _financials(data)
    stamps = []
    for key in ("invoices", "expenses", "quotes", "quotations", "contracts"):
        for r in fin.get(key) or []:
            if isinstance(r, dict):
                m = bz._moment(r.get("updated_at") or r.get("created_at"))
                if m:
                    stamps.append(m)
    return max(stamps) if stamps else None


def is_stale(latest: datetime | None, now: datetime) -> bool:
    """The newest financial record is older than the limit, so figures built on the records may be out of date."""
    return bool(latest and (now - latest) > timedelta(days=STALE_AFTER_DAYS))


def financial_summary(data: dict, policy: dict, now: datetime) -> dict:
    today = now.date()
    cash = bz.cash_position(data, today)
    overdue = bz.overdue_invoices(data, today)
    invoices = _invoices(data)
    receivable = sum(bz.invoice_outstanding(i) for i in invoices if bz.status_of(i) not in ("", "draft") and not bz.invoice_hold(i))
    return {
        "currency": bz.currency_of(data), "cash": cash["cash"], "monthly_burn": cash["monthly_burn"],
        "runway_months": cash["runway_months"], "receivables": bz.money(receivable),
        "overdue_count": len(overdue), "overdue_total": bz.money(sum(bz.invoice_outstanding(i) for i in overdue)),
        "has_records": bool(invoices or _financials(data).get("expenses")),
    }


def _find_number(obj: Any, names: tuple[str, ...], depth: int = 5) -> float | None:
    """The first numeric value stored under any of `names`, searching nested results. Used for
    figures other tools recorded (validation results, plan inputs); never an invented value."""
    if depth < 0:
        return None
    if isinstance(obj, dict):
        for name in names:
            v = obj.get(name)
            if isinstance(v, dict):
                v = v.get("value", v.get("amount", v.get("score")))
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                return float(v)
            if isinstance(v, str):
                try:
                    return float(v.replace(",", "").replace("£", "").replace("$", "").replace("%", "").strip())
                except ValueError:
                    pass
        for v in obj.values():
            found = _find_number(v, names, depth - 1)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for v in obj[:20]:
            found = _find_number(v, names, depth - 1)
            if found is not None:
                return found
    return None


def _plan_sources(data: dict) -> list:
    return [data.get("inputs"), data.get("assumptions"), data.get("idea_validation"), data.get("validation"),
            data.get("draft_idea_validation"), data.get("business_plan"), data.get("live_plan")]


def _compact_money(value: float, cur: str) -> str:
    """Large planning figures in short form (2.5m, 1.2bn); anything under a million in full."""
    prefix = fmt_money(0, cur).replace("0.00", "")
    for size, unit in ((1e9, "bn"), (1e6, "m")):
        if abs(value) >= size:
            return f"{prefix}{value / size:.1f}".rstrip("0").rstrip(".") + unit
    return fmt_money(value, cur)


# ══ Surfaces ══════════════════════════════════════════════════════════════════

def kpi_values(data: dict, policy: dict, now: datetime, readiness: dict) -> dict[str, dict]:
    """Every KPI's value, or the input it is missing. Values are never made up."""
    cur = bz.currency_of(data)
    today = now.date()
    cash = bz.cash_position(data, today)
    alert_pct = float((policy.get("risk") or {}).get("concentration_alert_pct") or 40)
    conc = bz.concentration(data, alert_pct)
    growth = revenue_growth(data, now)
    sources = _plan_sources(data)
    has_records = bool(_invoices(data) or _financials(data).get("expenses"))

    def have(value: str, detail: str | None = None, tone: str | None = None) -> dict:
        return {"value": value, "state": "available", "hint": detail, "tone": tone}

    def need(what: str) -> dict:
        return {"value": None, "state": "insufficient_data", "hint": what, "tone": None}

    def money_from(names: tuple[str, ...], missing: str) -> dict:
        v = _find_number(sources, names)
        return have(_compact_money(v, cur)) if v is not None else need(missing)

    score = _find_number([data.get("validation"), data.get("idea_validation")], ("overall_score", "viability_score", "composite_score", "final_score"))
    if score is not None and 0 < score <= 1:
        score *= 100
    paid = [i for i in _invoices(data) if bz.status_of(i) == "paid"]
    received = sum(bz.invoice_received(i) for i in paid)
    cos = sum(bz.money(i.get("cost_of_sales")) * (bz.invoice_received(i) / bz.invoice_total(i) if bz.invoice_total(i) else 1) for i in paid)
    paid_expenses = [e for e in _financials(data).get("expenses") or [] if isinstance(e, dict) and not e.get("archived") and bz.status_of(e) == "paid"]
    spent = sum(bz.money(e.get("price") or e.get("total_amount")) for e in paid_expenses)
    has_costs = cos > 0 or bool(paid_expenses)

    out = {
        "validation_score": have(f"{score:.0f}%", tone="emerald" if score >= 70 else "amber" if score >= 40 else "rose") if score is not None
        else need("Appears once your idea is scored"),
        "market_size": money_from(("serviceable_addressable_market", "market_size", "tam", "total_addressable_market"), "Comes from idea validation"),
        "startup_costs": money_from(("startup_costs", "startup_cost", "initial_investment", "setup_costs"), "Add startup costs to your plan"),
        "funding_needed": money_from(("funding_needed", "funding_required", "capital_required", "funding_gap"), "Add funding needs to your plan"),
        "launch_readiness": have(f"{readiness['percent']}%", f"{readiness['done']} of {readiness['total']} in place",
                                 "emerald" if readiness["percent"] >= 80 else "amber" if readiness["percent"] >= 40 else "rose"),
        "runway": have(f"{cash['runway_months']:g} months", tone="rose" if cash["runway_months"] < 3 else "emerald")
        if cash["runway_months"] is not None else need("Record cash received and monthly costs"),
        "planned_costs": money_from(("planned_costs", "monthly_costs", "monthly_fixed_costs", "fixed_costs", "operating_costs"), "Add planned costs to your plan"),
        "funding_secured": money_from(("funding_secured", "funding_raised", "starting_cash", "opening_cash"), "Add funding or starting cash to your plan"),
        "revenue_growth": have(f"{growth['pct']:+g}%", "last 90 days vs the 90 before", "emerald" if growth["pct"] >= 0 else "rose")
        if growth["pct"] is not None else need("Needs payments in the 90 days before, to compare against"),
        # Without any cost on record a margin would read 100%, which is not a real margin.
        "margin": need("Needs a paid invoice") if received <= 0
        else need("Add expenses or cost of sales to see margin") if not has_costs
        else have(f"{(received - cos - spent) / received * 100:.0f}%", "of paid revenue after cost of sales and expenses"),
        "top_customer_share": have(f"{conc['top1_share_pct']:g}%", f"alert at {alert_pct:g}%", "rose" if conc["alert"] else "emerald")
        if conc["customer_count"] else need("Needs a paid or delivered invoice"),
    }
    for key in ("revenue", "cash_balance", "costs", "receivables", "active_risks"):
        out[key] = {"value": None, "state": "available" if has_records else "insufficient_data",
                    "hint": None if has_records else "Needs an invoice or expense", "tone": None}
    return out


def headline_of(stage: str, layout: dict, kpis: dict[str, dict], risks: list[dict], readiness: dict) -> dict:
    """The one metric shown next to the stage label: "Validation 40%", "Launch readiness 3 of 7",
    "Health: Stable", and for a growing business health together with its growth."""
    high = sum(1 for r in risks if r.get("severity") == "high")
    health, tone = ("At risk", "rose") if high >= 2 else ("Needs attention", "amber") if (high or risks) else ("Stable", "emerald")
    key = layout["headline"]
    # Health is read from the business's own records. With none (a new or newly claimed business)
    # there is nothing to call stable, so it says so rather than showing a result.
    measured = bool(risks) or (kpis.get("revenue") or {}).get("state") == "available"
    if key in ("health", "revenue_growth") and not measured:
        return {"key": "health" if key == "health" else "health_growth", "label": "Health", "value": "Not enough data yet", "state": "insufficient_data", "tone": None}
    if key == "health":
        return {"key": "health", "label": "Health", "value": health, "state": "available", "tone": tone}
    if key == "revenue_growth":
        g = kpis["revenue_growth"]
        return {"key": "health_growth", "label": "Health", "tone": tone, "state": "available",
                "value": f"{health} · Growth {g['value']}" if g["value"] else f"{health} · growth not measurable yet"}
    if key == "launch_readiness":
        return {"key": key, "label": "Launch readiness", "value": f"{readiness['done']} of {readiness['total']}", "state": "available",
                "tone": kpis[key]["tone"]}
    k = kpis[key]
    return {"key": key, "label": "Validation", "value": k["value"] or "Not run yet", "state": k["state"], "tone": k["tone"]}


_SHORT_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def short_date(value: Any) -> str:
    """2026-09-26 (with or without a time) -> 26 Sep 2026. Anything else is shown as given."""
    day = bz.parse_day(value)
    return f"{day.day} {_SHORT_MONTHS[day.month - 1]} {day.year}" if day else str(value or "no date")


def _stored_number(inv: dict) -> str:
    for key in ("invoice_number", "reference", "number", "invoice_no"):
        value = str(inv.get(key) or "").strip()
        if value and not _UUID.match(value):
            return value
    return ""


_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def invoice_labels(data: dict) -> dict[str, str]:
    """The number each invoice is known by. An invoice saved without one is shown everywhere
    by a number made from its creation day and its place among that day's unnumbered invoices
    (INV-1160926): the same rule Business Operations uses, so both pages name it alike."""
    zone = bz.business_timezone(data)
    invoices = sorted((i for i in _invoices(data) if isinstance(i, dict)), key=lambda i: str(i.get("created_at") or ""))
    per_day: dict[str, int] = {}
    out: dict[str, str] = {}
    for inv in invoices:
        stored = _stored_number(inv)
        if stored:
            out[str(inv.get("id"))] = stored
            continue
        made = bz._moment(inv.get("created_at"))
        if made is None:
            continue
        day = made.astimezone(zone).strftime("%d%m%y")
        per_day[day] = per_day.get(day, 0) + 1
        out[str(inv.get("id"))] = f"INV-{per_day[day]}{day}"
    return out


def invoice_label(inv: dict, labels: dict[str, str] | None = None) -> str:
    """The invoice's number. "Invoice (no number)" only when it has none and no creation date."""
    return _stored_number(inv) or (labels or {}).get(str(inv.get("id"))) or "Invoice (no number)"


# S-1: which scenario templates a plan may run (the same rule the Simulation page applies).
_STARTER_SCENARIOS = ("tmpl_client_loss", "tmpl_payment_delay", "tmpl_revenue_drop", "tmpl_cost_increase")
SCENARIO_LOCK_NOTE = "This scenario is on paid plans. Your plan includes the Baseline Continuity projection in Simulation."


def plan_allows_scenario(plan: str | None, template: str) -> bool:
    plan = str(plan or "explorer")
    if plan == "explorer":
        return False
    return template in _STARTER_SCENARIOS if plan == "starter_insight" else True


def scenario_cta(template: str, plan: str | None, query: str = "") -> dict:
    # The button opens the full scenario for anyone who wants to look; the card itself already
    # carries what the Agent worked out, so it is "see", not "run".
    """The "Run scenario" button for a template. When the plan can't run it, the button says
    so and opens the plans page: nobody is sent to a run button that is switched off."""
    if plan_allows_scenario(plan, template):
        return {"label": "See the scenario", "to": f"/simulation?template={template}{query}"}
    # `unlocked_to`: where the button goes for an account whose access is wider than its plan
    # (a grandfathered plan, or Simulation granted by an administrator). The page decides that.
    return {"label": "See the scenario \u00b7 Pro", "to": "/pricing", "upgrade": True, "locked": True, "note": SCENARIO_LOCK_NOTE,
            "unlocked_to": f"/simulation?template={template}{query}"}


def _ev(label: str, value: Any) -> dict:
    return {"label": str(label), "value": str(value)}


def _card(widget_id: str, cls: int, tone: str, text: str, *, state: str = "available", severity: str | None = None,
          detail: str | None = None, cta: dict | None = None, more: dict | None = None, agent: dict | None = None, why: str = "",
          evidence: list[dict] | None = None, source: str = "", missing: list[str] | None = None,
          as_of: str | None = None, items: list[dict] | None = None, title: str | None = None, positive: bool = False) -> dict:
    w = WIDGETS[widget_id]
    return {
        "positive": positive,      # good news shown in a slot that usually carries a warning
        "note": cta.get("note") if cta and cta.get("locked") else None,      # shown on its own line, apart from the detail
        "key": widget_id, "widget_id": widget_id, "widget_version": w.version, "title": title or w.title, "tone": tone, "text": text,
        "state": state, "severity": severity, "priority_class": cls, "detail": detail, "cta": cta, "more": more,
        # A separate, clearly labelled action: it starts an Agent task and may use AI Credits.
        "agent_action": agent,
        "items": items or [],
        # s10.3: the evidence behind the card. Numbers are engine-owned; this is their provenance.
        "why": {"summary": why, "evidence": evidence or [], "source": source, "missing": missing or [], "as_of": as_of},
    }


_CHECK_WORD = {"ready": "Ready", "conditionally_ready": "Conditionally ready", "not_ready": "Not ready", "insufficient_evidence": "Not enough evidence yet"}
_CHECK_TONE = {"ready": "emerald", "conditionally_ready": "amber", "not_ready": "rose", "insufficient_evidence": "amber"}


def check_card(widget_id: str, cls: int, s: dict, *, what: str, to: str, tool: str) -> dict:
    """A card for a funding case or launch from its readiness summary. The dashboard presents
    the assessment service's result; it never recalculates it."""
    title = s.get("title") or what.capitalize()
    cta = {"label": "See the check", "to": to}
    nxt = (s.get("next_action") or {}).get("title")
    evidence = [_ev("Checked on", s.get("as_of") or "Not checked yet")]
    if s.get("classification"):
        evidence.append(_ev("Result", _CHECK_WORD[s["classification"]]))
    if s.get("score") is not None:
        evidence.append(_ev("Preparation score", f"{s['score']} out of 100"))
    coverage = s.get("coverage", s.get("evidence_coverage"))
    if coverage is not None:
        evidence.append(_ev("Evidence coverage", f"{coverage}%"))
    if s.get("confidence"):
        evidence.append(_ev("Confidence", str(s["confidence"]).capitalize()))
    evidence += [_ev(b["label"], b["reason"]) for b in s.get("blockers") or []]
    common = dict(cta=cta, more={"to": to}, evidence=evidence, source=tool, as_of=None,
                  why=f"From the {tool.lower()} for \u201c{title}\u201d. {s.get('selection') or ''}".strip()
                      + (f" You have {s['others']} more." if s.get("others") else ""))
    if not s.get("classification"):
        failed = s.get("execution_status") == "failed"
        return _card(widget_id, cls, "indigo",
                     f"The last check of \u201c{title}\u201d didn\u2019t finish. I\u2019m checking it again." if failed
                     else f"\u201c{title}\u201d hasn\u2019t been checked yet. I\u2019m checking it now to see what stands in the way.",
                     state="insufficient_data", missing=[f"A completed {tool.lower()}"], **common)
    stale = s.get("freshness") == "stale"
    blockers = s.get("blockers") or []
    if blockers:
        n = len(blockers)
        text = f"{n} blocker{'s' if n != 1 else ''} for \u201c{title}\u201d: {blockers[0]['reason']}"
        severity, tone = "high", "rose"
    elif s["classification"] == "insufficient_evidence":
        text = f"\u201c{title}\u201d can\u2019t be assessed yet: evidence is missing." + (f" Next: {nxt}" if nxt else "")
        severity, tone = "medium", "amber"
    elif s["classification"] == "not_ready":
        text = f"\u201c{title}\u201d is not ready against the checklist." + (f" Next: {nxt}" if nxt else "")
        severity, tone = "high", "rose"
    else:
        text = f"\u201c{title}\u201d: {s.get('headline')}" + (f" Next: {nxt}" if nxt else "")
        severity, tone = None, _CHECK_TONE[s["classification"]]
    good = s["classification"] == "ready" and not blockers and not stale
    if good:
        # Ready, nothing blocking, up to date: a status card in the same slot, with no "needs attention" about it.
        text = f"\u201c{title}\u201d is ready against its checklist" + (f", score {s['score']}" if s.get("score") is not None else "") + ". I'm watching for changes."
        common = {**common, "title": f"{what.capitalize()} status", "positive": True}
    if stale:
        text += " This result is out of date."
        evidence.append(_ev("Out of date because", str(s.get("freshness_reason") or "Something changed since the check.").replace(" Run the check again to see the effect.", "").replace(" Run the check again to use it.", "")
                            + " I\u2019m checking it again."))
    return _card(widget_id, cls, tone, text, state="stale" if stale else "available", severity=severity,
                 items=[{"label": b["label"], "to": to} for b in blockers], **common)


def agent_outcomes(tiles: list[dict], runs: list[dict], policy: dict, plan: str | None, checks: dict, data: dict) -> list[dict]:
    """The launch, funding and registration tiles as what the Agent has done or needs, not as
    instructions. Where the Agent has prepared something the tile is its outcome; where it is
    about to, the tile says so; where it can't without something only the owner has, the tile
    asks for exactly that. A tile for work the owner has switched off is left out."""
    from app.modules.agent import autostart
    from app.modules.agent import config as agent_config
    from app.modules.agent.workflows import registration_number

    def latest(workflow: str) -> dict | None:
        mine = [r for r in runs if r.get("workflow_key") == workflow and r.get("status") != "cancelled"]
        return max(mine, key=lambda r: r.get("created_at") or "") if mine else None

    def can(key: str) -> bool:
        return autostart.item_on(policy, key) and agent_config.plan_allows(plan, key)

    def outcome(run: dict) -> dict:
        return {"to": f"/agent/runs/{run['id']}"}

    # good news: green · the Agent is working: indigo · needs the owner: amber · a problem: red · idle: grey
    LOOK = {"good": ("emerald", "check"), "working": ("indigo", "clock"), "needs_you": ("amber", "chat"), "problem": ("rose", "alert"), "idle": ("slate", "info")}

    def look(x: dict, mood: str) -> None:
        x["mood"], (x["tone"], x["icon"]) = mood, LOOK[mood]

    def off(what: str) -> str:
        """Never hide the tile: say why nothing is happening."""
        return (f"{what} is switched off in Agent settings." if agent_config.plan_allows(plan, "idea_validation")
                else f"{what} is part of Agent tasks, which your plan doesn't include.")

    def status(x: dict, workflow: str, working: str, what: str, short: bool = True) -> None:
        """One tile for one capability: its question, its result, that it is on its way, or why it isn't."""
        done = latest(workflow)
        skipped = bool(done and ((done.get("state") or {}).get("outcome") or {}).get("skipped"))
        if done and done.get("status") == "running" and done.get("pending_question"):
            q = done["pending_question"]
            x["text"], x["action"] = q["question"], {"to": "/agent?tab=needs_attention"}
            x["question"] = {"run_id": done["id"], "question": q["question"], "fields": q["fields"]}      # answered from the tile
            look(x, "needs_you")
        elif done and done.get("status") == "succeeded":
            text = str(done.get("summary") or "")
            x["text"] = (text.split(". ")[0].rstrip(".") + ".") if short and not skipped and text else text
            x["action"] = outcome(done)
            look(x, "idle" if skipped else "good")
        elif done and done.get("status") == "failed":
            x["text"], x["action"] = str(done.get("error") or working), outcome(done)
            look(x, "problem")
        elif can(workflow):
            x["text"] = working
            look(x, "working")
        else:
            x["text"] = off(what)
            look(x, "idle")

    out: list[dict] = []
    for tile in tiles:
        x = dict(tile)
        if x["key"] == "stage_funding":
            done, case = latest("funding_pack_draft"), (checks or {}).get("funding")
            if done and done.get("status") == "succeeded" and not ((done.get("state") or {}).get("outcome") or {}).get("skipped"):
                x["text"], x["action"] = "Funding pack draft ready for review.", outcome(done)
                look(x, "good")
            elif not case:
                x["text"], x["action"] = "I need a funding case before the funding pack can be drafted.", {"to": "/funding"}
                look(x, "needs_you")
            elif can("funding_pack_draft"):
                x["text"], x["action"] = "I'm drafting your funding pack.", {"to": f"/funding/{case['case_id']}?tab=documents"}
                look(x, "working")
            else:
                x["text"], x["action"] = off("Funding pack drafting"), {"to": f"/funding/{case['case_id']}?tab=documents"}
                look(x, "idle")
        elif x["key"] == "stage_register":
            done = latest("registration_checklist")
            if registration_number(data):
                x["text"] = "Your business is registered."
                look(x, "good")
            elif done and done.get("status") == "succeeded":
                x["text"], x["action"] = "Registration checklist ready.", outcome(done)
                look(x, "good")
            elif can("registration_checklist"):
                x["text"], x["action"] = "I'm preparing your registration checklist.", {"to": "/registration"}
                look(x, "working")
            else:
                x["text"] = off("The registration checklist")
                look(x, "idle")
        elif x["key"] == "stage_validate":
            status(x, "idea_validation", "I'm scoring your idea.", "Idea validation")
        elif x["key"] == "stage_plan":
            status(x, "business_plan_draft", "I'm drafting your business plan.", "Business plan drafting")
        elif x["key"] == "stage_market":
            status(x, "market_size", "I'm sizing your market.", "Market sizing")
        elif x["key"] == "stage_pricing":
            status(x, "price_test", "I'm testing a 5% and a 10% price change.", "The price test")
        elif x["key"] == "stage_capacity":
            status(x, "capacity_check", "I'm checking your capacity.", "The capacity check", short=False)
        elif x["key"] == "stage_offer":
            status(x, "offer_review", "I'm reviewing what sells.", "The offer review")
        elif x["key"] == "stage_expand":
            status(x, "expansion_scenario", "I'm modelling a 20% expansion.", "The expansion scenario")
        elif x["key"] == "stage_blockers":
            launch = (checks or {}).get("launch")
            done = latest("launch_evidence_gaps")
            if launch and done and done.get("status") == "succeeded":
                found = (done.get("state") or {}).get("outcome") or {}
                n = len(found.get("gaps") or []) + len(found.get("blockers") or [])
                x["text"] = (f"{n} gap{'s' if n != 1 else ''} in your launch evidence: I've listed {'them' if n != 1 else 'it'}." if n
                             else "Nothing is missing from your launch evidence.")
                x["action"] = outcome(done)
                look(x, "needs_you" if n else "good")
            elif launch and launch.get("initiative_id") and launch.get("classification") != "ready" and can("launch_evidence_gaps"):
                # A launch is on record: the Agent runs its check (the first one too) and lists what is missing.
                x["text"], x["action"] = "I'm checking your launch evidence for gaps.", {"to": f"/launch/{launch['initiative_id']}"}
                look(x, "working")
            elif launch and launch.get("classification") == "ready":
                look(x, "good")                                           # ready: good news, never a warning sign
                x["action"] = {"to": f"/launch/{launch['initiative_id']}"}      # the launch plan itself, as "Open launch plan" does
            elif launch:
                look(x, "problem" if launch.get("blockers") else "needs_you")
                if launch.get("initiative_id") and not str((x.get("action") or {}).get("to") or "").startswith("/launch/"):
                    x["action"] = {"to": f"/launch/{launch['initiative_id']}"}
            else:
                scoring = latest("idea_validation")
                if scoring and scoring.get("status") == "running" and scoring.get("pending_question"):
                    q = scoring["pending_question"]
                    x["text"], x["question"] = q["question"], {"run_id": scoring["id"], "question": q["question"], "fields": q["fields"]}
                    look(x, "needs_you")
                else:
                    look(x, "needs_you" if x["text"].startswith("I need") else "working")
        out.append(x)
    return out


def _latest_summary(runs: list[dict] | None, workflow: str) -> str | None:
    """The first sentence of what the Agent last worked out for a capability, if it has."""
    mine = [r for r in runs or [] if r.get("workflow_key") == workflow and r.get("status") == "succeeded"
            and not ((r.get("state") or {}).get("outcome") or {}).get("skipped")]
    if not mine:
        return None
    text = str(max(mine, key=lambda r: r.get("created_at") or "").get("summary") or "")
    return text.split(". ")[0].rstrip(".") + "." if text else None


_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def runway_after_cost_rise(figures: dict, now: datetime, pct: int = 10) -> str:
    """What a cost rise does to the runway in the launch plan, worked out from the plan's own
    figures: the months lost and the month cash would run out. Says what is missing when the
    plan doesn't hold enough to work it out; never estimates."""
    runway, costs = figures.get("runway") or {}, figures.get("planned_costs")
    if runway.get("months") is not None:
        months = int(runway["months"])
        after = int(months / (1 + pct / 100))      # the same cash spent pct% faster
        lost = months - after
        end = now.year * 12 + (now.month - 1) + after
        when = f"{_MONTHS[end % 12]} {end // 12}"
        if lost <= 0:
            return f"A {pct}% cost rise leaves your runway at {months} month{'s' if months != 1 else ''} (to {when}): the extra cost is absorbed within the same month."
        return f"A {pct}% cost rise shortens your runway by {lost} month{'s' if lost != 1 else ''} (to {when})."
    if runway.get("beyond_label"):
        extra = f" It adds {fmt_money(float(costs) * pct / 100, figures.get('currency') or 'GBP')} a month to planned costs." if costs else ""
        return f"A {pct}% cost rise still leaves cash above zero to {runway['beyond_label']}, the end of your launch plan's projection.{extra}"
    if costs:
        cur = figures.get("currency") or "GBP"
        return (f"A {pct}% cost rise takes planned costs from {fmt_money(costs, cur)} to {fmt_money(float(costs) * (1 + pct / 100), cur)} a month. "
                "I need your opening cash or funding in the launch plan to turn that into months of runway.")
    return "I need your planned monthly costs in a launch plan before I can work out what a cost rise does to your runway."


KPI_HISTORY_KEY = "kpi_history"


async def keep_kpi_snapshot(orch, business_id: str, data: dict, now: datetime, figures: dict, write: bool = True) -> dict:
    """The day-by-day record of the pre-launch figures: {"YYYY-MM-DD": {figure: number}}. Today's
    row is written the first time the dashboard is built that day (and corrected if a figure has
    changed since). Only numbers that exist are kept: a figure with no value has no point."""
    day = bz.local_now(data, now).date().isoformat()
    row = {k: (float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None) for k, v in figures.items()}
    row = {k: v for k, v in row.items() if v is not None}
    history = {d: dict(r) for d, r in (data.get(KPI_HISTORY_KEY) or {}).items() if isinstance(r, dict)}
    if not row or history.get(day) == row:
        return history
    history[day] = row
    if write:
        def _apply(d: dict) -> None:
            kept = dict(d.get(KPI_HISTORY_KEY) or {})
            kept[day] = row
            d[KPI_HISTORY_KEY] = {k: kept[k] for k in sorted(kept)[-400:]}      # a little over a year
        try:
            await orch.rt.business.mutate(business_id, _apply)
        except Exception:      # noqa: BLE001 - the dashboard never fails because a snapshot couldn't be kept
            logger.warning("could not keep the key figures snapshot for business %s", business_id, exc_info=True)
    return history


def active_risks_before_launch(data: dict, policy: dict, now: datetime, checks: dict) -> tuple[int, list[str]]:
    """Everything the cards on this dashboard are warning about, counted once each: what blocks
    the launch, the gaps in the funding case (blockers and missing evidence), invoices past
    their due date, and a customer above the concentration alert level."""
    def n(count: int, one: str, many: str) -> str:
        return f"{count} {one if count == 1 else many}"
    parts: list[str] = []
    total = 0
    launch, funding = checks.get("launch") or {}, checks.get("funding") or {}
    blockers = len(launch.get("blockers") or [])
    if blockers:
        total += blockers
        parts.append(n(blockers, "launch blocker", "launch blockers"))
    gaps = len(funding.get("blockers") or []) + int(funding.get("missing_count") or 0)
    if not gaps and funding.get("classification") in ("not_ready", "insufficient_evidence"):
        gaps = 1      # the case isn't ready, so its gaps card is showing: that is at least one
    if gaps:
        total += gaps
        parts.append(n(gaps, "funding gap", "funding gaps"))
    overdue = len(bz.overdue_invoices(data, bz.local_now(data, now).date()))
    if overdue:
        total += overdue
        parts.append(n(overdue, "overdue invoice", "overdue invoices"))
    alert = float((policy.get("risk") or {}).get("concentration_alert_pct") or 40)
    conc = bz.concentration(data, alert)
    if conc["alert"]:
        total += 1
        parts.append(f"{conc['top_customers'][0]['customer']} at {conc['top1_share_pct']:g}% of revenue")
    return total, parts


def registration_status(data: dict) -> dict:
    """Where the business stands on registering, from what is on record: registered (with its
    number), or how many of the twelve standard steps the records already show as in place."""
    from app.modules.agent.workflows import registration_number
    profile = data.get("workspace_profile") or {}
    number = registration_number(data)
    name = str(profile.get("company_name") or "").strip()
    in_place = [
        bool(name) and name.lower() not in ("my workspace", "unnamed"),                                   # a business name
        bool(str(profile.get("about_company") or profile.get("description") or "").strip()),             # a description and objectives
        bool(str(profile.get("email") or "").strip() and str(profile.get("city") or profile.get("address") or "").strip()),      # address and contact email
        bool((data.get("catalogue") or {}).get("products") or profile.get("services")),                  # products or services and pricing
        _find_number(_plan_sources(data), _PLANNED_COST_KEYS) is not None,                                # basic financial assumptions
        bool(data.get("business_plan") or data.get("live_plan") or data.get("blueprints")),              # a plan to register against
    ]
    total = 12
    done = total if number else sum(1 for x in in_place if x)
    return {"registered": bool(number), "number": number or None, "steps_done": done, "steps_total": total,
            "label": "Registered" if number else "Not registered", "progress": None if number else f"{done} of {total} steps",
            "subject": name or "Your business"}


def followup_status(overdue: list[dict], runs: list[dict], policy: dict, plan: str | None, cur: str) -> tuple[str, dict | None]:
    """What the Agent has done about the overdue invoices, in one sentence, and where the owner is
    needed (an approval, or a question only they can answer). Never a task for the owner to start."""
    from app.modules.agent import autostart
    from app.modules.agent import config as agent_config
    ids = {str(i.get("id")) for i in overdue}
    mine = [r for r in runs or [] if r.get("workflow_key") == "payment_followup" and str((r.get("state") or {}).get("invoice_id")) in ids]
    ready = [r for r in mine if r.get("status") == "awaiting_approval"]
    stuck = [r for r in mine if r.get("reason_code") == "invalid_customer_destination"
             or (r.get("status") == "running" and any(f.get("key") == "customer_email" for f in (r.get("pending_question") or {}).get("fields") or []))]
    total = fmt_money(bz.money(sum(bz.invoice_outstanding(i) for i in overdue)), cur)
    head = f"{len(overdue)} overdue ({total})."
    said, cta = [], None
    if ready:
        said.append(f"I've prepared {len(ready)} reminder{'s' if len(ready) != 1 else ''} for your approval")
        cta = {"label": "Review in Needs Approval", "to": "/agent?tab=needs_approval"}
    if stuck:
        by_id = {str(i.get("id")): i for i in overdue}
        who = by_id.get(str((stuck[0].get("state") or {}).get("invoice_id")), {}).get("customer_name") or "the customer"
        said.append(f"{len(stuck)} {'is' if len(stuck) == 1 else 'are'} waiting for an email address for {who}")
        cta = cta or {"label": "Give the email address", "to": f"/agent/runs/{stuck[0]['id']}"}
    if not said:
        if not agent_config.plan_allows(plan, "payment_followup"):
            said.append("Reminders are part of Agent tasks, which your plan doesn't include")
            cta = {"label": "See plans", "to": "/pricing"}
        elif autostart.item_on(policy, "invoice_overdue"):
            said.append("I'm preparing the reminders for your approval")
        else:
            said.append("Automatic reminders are switched off in Agent settings, so nothing has been prepared")
    return f"{head} {'; '.join(said)}.", cta


def compose_insights(data: dict, policy: dict, now: datetime, *, stage: str, prefs: dict, approvals: list[dict],
                     can_send: bool, transition: dict | None = None, readiness: dict | None = None, checks: dict | None = None,
                     plan: str | None = "strategic_business_os", runs: list[dict] | None = None) -> list[dict]:
    """The priority cards for this stage right now: at most five, most important first.
    Only the stage's own families are built (plus launch items during the transition)."""
    layout = STAGE_LAYOUT[stage]
    families = list(layout["insights"])
    if transition and "blocker" not in families:
        families.append("blocker")
    today = now.date()
    cur = bz.currency_of(data)
    goal = prefs.get("current_goal")
    trading = stage in _TRADING
    alert_pct = float((policy.get("risk") or {}).get("concentration_alert_pct") or 40)
    conc = bz.concentration(data, alert_pct)
    cash = bz.cash_position(data, today)
    overdue = bz.overdue_invoices(data, today)
    overdue_total = bz.money(sum(bz.invoice_outstanding(i) for i in overdue))
    labels = invoice_labels(data) if overdue else {}
    fin = _financials(data)
    has_invoices = bool(fin.get("invoices"))
    has_expenses = bool(fin.get("expenses"))
    latest = _latest_activity(data)
    stale = is_stale(latest, now)
    as_of = latest.isoformat() if latest else None
    readiness = readiness or launch_readiness(data, goal)
    validated = next((i["done"] for i in readiness["items"] if i["key"] == "idea_validated"), False)
    cards: list[dict] = []

    if "idea_weakness" in families:
        weak = weakest_factor(data)
        if weak:
            cards.append(_card(
                "idea_weakness", 1, "rose",
                f"Your idea's weakest point is {weak['label'].lower()} ({weak['score']:.0f}%). Strengthen it before you commit money.",
                severity="high" if weak["score"] < 50 else "medium", cta={"label": "Review validation", "to": "/results"},
                why="The lowest-scoring factor in your idea validation.",
                evidence=[_ev(n, f"{v:.0f}%") for n, v in weak["factors"][:6]], source="Idea Validation"))
        else:
            cards.append(_card(
                "idea_weakness", 1, "rose", "Your idea hasn't been validated yet, so its weakest point isn't known.",
                state="insufficient_data", cta={"label": "Validate my idea", "to": "/validation"},
                why="The weakest factor comes from idea validation, which hasn't been run for this business.",
                source="Idea Validation", missing=["An idea validation result"]))

    checks = checks or {}
    if "blocker" in families and checks.get("launch"):
        # A launch is being prepared: its own check says what blocks it.
        cards.append(check_card("blocker", 1, checks["launch"], what="launch", to=f"/launch/{checks['launch']['initiative_id']}", tool="Launch Readiness Check"))
    elif "blocker" in families:
        missing = [i for i in readiness["items"] if not i["done"]]
        if missing:
            what = "funding" if goal == "funding" else "launch"
            cards.append(_card(
                "blocker", 1, "rose",
                f"{len(missing)} thing{'s are' if len(missing) != 1 else ' is'} still missing before {what}: "
                + "; ".join(m["label"].lower() if i else m["label"] for i, m in enumerate(missing[:3]))
                + ("…" if len(missing) > 3 else "."),
                severity="high", cta={"label": f"Add {missing[0]['label'].lower()}", "to": missing[0]["to"]}, more={"to": missing[0]["to"]},
                items=[{"label": m["label"], "to": m["to"]} for m in missing],
                why=f"These are required before {what} and aren't on your business's records yet.",
                evidence=[_ev(m["label"], "Missing") for m in missing], source="Your business profile, catalogue and records",
                missing=[m["label"] for m in missing]))

    if "approval" in families:
        soon = [a for a in approvals if a.get("expires_at") and bz._moment(a["expires_at"])
                and timedelta(0) <= bz._moment(a["expires_at"]) - now <= timedelta(hours=APPROVAL_SOON_HOURS)]
        if soon and can_send:
            first = min(soon, key=lambda a: a["expires_at"])
            hours = max(1, int((bz._moment(first["expires_at"]) - now).total_seconds() // 3600))
            cards.append(_card(
                "approval", 2, "amber",
                f"{len(soon)} approval{'s' if len(soon) != 1 else ''} will expire within {APPROVAL_SOON_HOURS} hours. "
                f"The first is “{first.get('title')}”, in about {hours} hour{'s' if hours != 1 else ''}.",
                severity="medium", cta={"label": "Review now", "run_id": first.get("run_id")}, more={"to": "/agent"},
                why="An approval that expires is withdrawn and has to be prepared again.",
                evidence=[_ev(a.get("title") or "Approval", f"expires {short_date(a['expires_at'])}, {str(a['expires_at'])[11:16]} UTC") for a in soon[:5]],
                source="Agent approvals waiting for you"))

    if "risk" in families:
        if conc["customer_count"] == 0:
            cards.append(_card(
                "risk", 5, "rose", "There's no paid or delivered invoice yet, so customer concentration can't be measured.",
                state="insufficient_data", cta={"label": "Record an invoice", "to": "/operations?tab=Sales&sub=Invoices"},
                why="Concentration is the share of revenue each customer brings. It needs at least one paid or delivered invoice.",
                source="Invoices in Business Operations", missing=["A paid or delivered invoice"]))
        else:
            evidence = [_ev(t["customer"], f"{t['share_pct']:g}% of revenue ({fmt_money(t['revenue'], cur)})") for t in conc["top_customers"][:3]]
            evidence.append(_ev("Your alert threshold", f"{alert_pct:g}%"))
            agent = None      # nothing to start: the Agent works out what losing them means by itself and reports it
            if conc["alert"]:
                n = 2 if conc["customer_count"] >= 2 and conc["top1_share_pct"] < alert_pct else 1
                share = conc["top2_share_pct"] if n == 2 else conc["top1_share_pct"]
                cards.append(_card(
                    "risk", 1, "rose",
                    f"{n} customer{'s' if n > 1 else ''} make{'s' if n == 1 else ''} up {share:g}% of your revenue. I'm watching it and will flag any rise.",
                    severity="high", cta={"label": "View risk details", "explain": True}, agent=agent,
                    why=f"Revenue from your largest customer{'s' if n > 1 else ''} is above the level you set as a risk.",
                    evidence=evidence, source="Paid and delivered invoices", as_of=as_of))
            else:
                cards.append(_card(
                    "risk", 5, "emerald",
                    f"Your largest customer is {conc['top1_share_pct']:g}% of revenue, within your {alert_pct:g}% threshold.",
                    severity="low", cta={"label": "View risk details", "explain": True}, agent=agent,
                    why="No customer is above the concentration level you set as a risk.",
                    evidence=evidence, source="Paid and delivered invoices", as_of=as_of))

    if "cash" in families:
        cash_evidence = [_ev("Cash received less costs paid", fmt_money(cash["cash"], cur)),
                         _ev("Average monthly costs (last 3 months)", fmt_money(cash["monthly_burn"], cur))]
        cash_cta = {"label": "View cash forecast", "to": "/operations?tab=Reports"}
        if not has_invoices and not has_expenses:
            cards.append(_card(
                "cash", 5, "emerald", "No income or costs are recorded yet, so there is no cash position to show.",
                state="insufficient_data", cta={"label": "Record income or costs", "to": "/operations"},
                why="Cash position is what you've been paid, less what you've paid out. Neither is recorded yet.",
                source="Invoices and expenses in Business Operations", missing=["A paid invoice", "A paid expense"]))
        elif cash["cash"] < 0:
            cards.append(_card(
                "cash", 1, "rose", f"Your cash position is negative at {fmt_money(cash['cash'], cur)}. Review costs and collect what you're owed.",
                severity="high", cta=cash_cta, why="More has been paid out than received.",
                evidence=cash_evidence, source="Paid invoices and paid expenses", as_of=as_of))
        elif cash["runway_months"] is not None:
            tight = cash["runway_months"] < 3
            cards.append(_card(
                "cash", 1 if tight else 5, "rose" if tight else "emerald",
                f"Your cash position is {'tight' if tight else 'healthy'} with {cash['runway_months']:g} months of runway at current burn rate.",
                severity="high" if tight else "low", cta=cash_cta, why="Runway is your cash divided by your average monthly costs.",
                evidence=[*cash_evidence, _ev("Runway", f"{cash['runway_months']:g} months")],
                source="Paid invoices and paid expenses", as_of=as_of))
        else:
            cards.append(_card(
                "cash", 5, "emerald", f"Your cash position is {fmt_money(cash['cash'], cur)}. Record expenses to see your runway.",
                state="insufficient_data", cta={"label": "Record an expense", "to": "/operations?tab=Transactions"},
                why="Runway needs your monthly costs, and no paid expense has been recorded in the last three months.",
                evidence=cash_evidence, source="Paid invoices and paid expenses", missing=["A paid expense in the last 3 months"], as_of=as_of))

    if "next_step" in families:
        if overdue:      # unpaid invoices past their due date matter at every stage
            status_text, status_cta = followup_status(overdue, runs or [], policy, plan, cur)
            cards.append(_card(
                "next_step", 2, "brand", status_text,
                severity="medium", detail=f"{len(overdue)} overdue · {fmt_money(overdue_total, cur)}",
                cta=status_cta,      # only where the owner is needed: an approval, or an answer
                why="Invoices are past their due date and still unpaid.",
                evidence=[_ev(invoice_label(i, labels),
                              f"{fmt_money(bz.invoice_outstanding(i), cur)} due {short_date(i.get('due_date'))} ({i.get('customer_name') or 'customer'})")
                          for i in overdue[:5]], source="Invoices in Business Operations", as_of=as_of))
        elif stage == "growth":
            pass      # nothing overdue: growth's time-sensitive slot goes to approvals and contracts
        elif trading and conc["alert"]:
            top = conc["top_customers"][0]
            looked = next((r for r in sorted(runs or [], key=lambda r: r.get("created_at") or "", reverse=True)
                           if r.get("workflow_key") in ("risk_concentration", "scenario_help") and r.get("status") == "succeeded"), None)
            cards.append(_card(
                "next_step", 4, "brand",
                f"{top['customer']} is {top['share_pct']:g}% of your revenue, above your {conc['threshold_pct']:g}% alert level. "
                + ("I've worked out what losing them would mean." if looked else "I'm working out what losing them would mean."),
                cta={"label": "See the result", "to": f"/agent/runs/{looked['id']}"} if looked else None,
                why="Your customer concentration is above your threshold.",
                evidence=[_ev("Top customer share", f"{conc['top1_share_pct']:g}%")], source="Paid and delivered invoices", as_of=as_of))
        elif stage == "idea":
            todo = next((i for i in idea_steps(data) if not i["done"]), None)
            if todo:
                # What comes next, as the Agent's status. Only what the owner alone can supply is asked for.
                doing = {"market": ("Next: your market size. I'm working it out.", "See the market size"),
                         "plan": ("Next: your business plan. I'm drafting it.", "Open Business Plans"),
                         "offer": ("I need a product or service with a price before I can go further.", "Add one"),
                         "register": ("Next: registering the business. I'm preparing the checklist.", "Open Registration")}[todo["key"]]
                cards.append(_card(
                    "next_step", 2, "brand", doing[0],
                    severity="medium", cta={"label": doing[1], "to": todo["to"]},
                    why="The first thing still to do for this idea, after validating it.",
                    evidence=[_ev(i["label"], "Done" if i["done"] else "To do") for i in idea_steps(data)], source="Your idea's checklist",
                    missing=[todo["label"]]))
            else:
                cards.append(_card(
                    "next_step", 2, "brand", "The groundwork is done. I'll draft the quotation as soon as your first enquiry arrives.",
                    severity="medium", cta={"label": "Open Business Operations", "to": "/operations"},
                    why="Every early step for this idea is complete.", source="Your idea's checklist"))
        elif stage == "pre_launch":
            todo = next((i for i in readiness["items"] if not i["done"]), None)
            progress = f"{readiness['done']} of {readiness['total']} launch items in place"
            if todo:
                cards.append(_card(
                    "next_step", 2, "brand", f"{progress}. I need from you: {todo['label'][0].lower() + todo['label'][1:]}.",
                    severity="medium", detail=progress, cta={"label": "Add it", "to": todo["to"]},
                    why="The first item on your launch checklist that isn't done yet.",
                    evidence=[_ev(i["label"], "Done" if i["done"] else "Missing") for i in readiness["items"]], source="Your launch checklist"))
            else:
                cards.append(_card(
                    "next_step", 2, "brand", "Everything is in place. I'll draft the quotation as soon as your first enquiry arrives.",
                    severity="medium", detail=progress, cta={"label": "Open Business Operations", "to": "/operations"},
                    why="Every launch item is done and nothing has been invoiced yet.", source="Your launch checklist"))
        elif not has_invoices:
            cards.append(_card(
                "next_step", 4, "brand", "Record your first invoice or quotation so EnterprateAI can start tracking performance.",
                cta={"label": "Open Business Operations", "to": "/operations"},
                why="There are no invoices or quotations on record yet.", source="Business Operations"))
        else:
            cards.append(_card(
                "next_step", 4, "brand", "Everything is on track: nothing is overdue and no risk is above your thresholds. I'm watching both.",
                why="No overdue invoices, and no risk above your thresholds.",
                evidence=[_ev("Overdue invoices", "0")], source="Invoices and risk thresholds", as_of=as_of))

    if "scenario" in families:
        def run_in(template: str) -> dict:
            return scenario_cta(template, plan)
        run = run_in("tmpl_cost_increase")
        if stage == "idea":
            cards.append(_card(
                "scenario", 3, "indigo", "Price moves an early plan more than anything else. I'll test yours as soon as a product has a price and a first sale is on record.",
                cta=run_in("tmpl_price_increase"), why="Price is the assumption that moves an early plan the most, and nothing has been sold yet.", source="Scenario engine"))
        elif stage == "pre_launch":
            cards.append(_card(
                "scenario", 3, "indigo", runway_after_cost_rise(((checks or {}).get("launch") or {}).get("figures") or {}, now),
                cta=run, why="Before the first sale, runway depends only on funding and planned costs, so a rise in costs shortens it directly.", source="Scenario engine"))
        elif conc["alert"]:
            name = (conc["top_customers"] or [{}])[0].get("customer") or "your largest customer"
            lost = bz.simulate(data, "client_loss", {"customer": name}, today)
            cards.append(_card(
                "scenario", 3, "indigo",
                (f"Losing {name} would cut monthly revenue by {lost['revenue_drop_pct']:g}%. I'm watching it." if lost.get("customer")
                 else f"{name} carries a large share of your revenue. I'm watching it."), cta=run_in("tmpl_client_loss"),
                why="Suggested because one customer carries a large share of your revenue.",
                evidence=[_ev(name, f"{conc['top1_share_pct']:g}% of revenue")], source="Paid and delivered invoices"))
        elif stage == "growth":
            cards.append(_card(
                "scenario", 3, "indigo", _latest_summary(runs, "price_test") or "I'm testing what a 5% and a 10% price rise would do to your revenue.",
                cta=run_in("tmpl_hire_staff"),
                why="Revenue is growing; the next decisions are about capacity and price.", source="Scenario engine"))
        else:
            up = bz.simulate(data, "cost_increase", {"pct": 10}, today)
            cards.append(_card(
                "scenario", 3, "indigo",
                (f"A 10% cost rise would take your monthly net from {fmt_money(up['monthly_net_before'], cur)} to {fmt_money(up['monthly_net_after'], cur)}."
                 if up.get("monthly_burn_before") else "No costs are recorded yet, so a cost rise has nothing to work on. I'll model it once an expense is on record."),
                cta=run,
                why="A standard stress test; nothing in your records points to a more specific one.", source="Scenario engine"))

    if "contract_action" in families:
        waiting = contracts_needing_action(data, now)
        if waiting:
            cards.append(_card(
                "contract_action", 2, "amber",
                f"{len(waiting)} contract{'s need' if len(waiting) != 1 else ' needs'} action: {waiting[0]['label']} {waiting[0]['value']}"
                + (f", and {len(waiting) - 1} more." if len(waiting) > 1 else "."),
                severity="medium", cta={"label": "Open contracts", "to": "/operations?tab=Contracts"},
                why="Contracts awaiting signature, or ending within 30 days.",
                evidence=[_ev(w["label"], w["value"]) for w in waiting[:5]], source="Contracts in Business Operations"))

    if "marketplace_similar" in families:
        industry = str((data.get("workspace_profile") or {}).get("primary_industry") or "").replace("_", " ").strip()
        named = industry and industry.lower() != "other"
        cards.append(_card(
            "marketplace_similar", 5, "indigo",
            f"See how other {industry} businesses present what they offer on the Marketplace." if named
            else "See how similar businesses present what they offer on the Marketplace.",
            cta={"label": "Browse the Marketplace", "to": "/marketplace"},
            why="Looking at businesses like yours shows how they describe and price their offer.",
            evidence=[_ev("Your industry", industry)] if named else [], source="Your business profile"))

    if "funding_gaps" in families and checks.get("funding"):
        cards.append(check_card("funding_gaps", 5, checks["funding"], what="funding case", to=f"/funding/{checks['funding']['case_id']}", tool="Funding Readiness Check"))
    elif "funding_gaps" in families:
        gaps = funding_gaps(data)
        if gaps:
            cards.append(_card(
                "funding_gaps", 5, "indigo",
                f"{len(gaps)} thing{'s' if len(gaps) != 1 else ''} a funder will ask for {'are' if len(gaps) != 1 else 'is'} not on record yet: "
                + "; ".join(g["label"].lower() if i else g["label"] for i, g in enumerate(gaps[:3])) + ("…" if len(gaps) > 3 else "."),
                cta={"label": f"Add {gaps[0]['label'][0].lower() + gaps[0]['label'][1:]}", "to": gaps[0]["to"]},
                items=gaps, why="A funder expects a plan and the figures behind it.",
                evidence=[_ev(g["label"], "Missing") for g in gaps], source="Your plan and its figures", missing=[g["label"] for g in gaps]))
        else:
            cards.append(_card(
                "funding_gaps", 5, "emerald", "The basics a funder asks for are on record: a plan, planned costs and your funding figures.",
                cta={"label": "Open Business Plans", "to": "/blueprint?tab=business-plans"},
                why="Each item a funder usually asks for has been recorded.", source="Your plan and its figures"))

    if "opportunities" in families:
        open_rfqs = [r for r in fin.get("rfq_requests") or [] if isinstance(r, dict) and bz.status_of(r) == "pending"]
        if open_rfqs:
            cards.append(_card(
                "opportunities", 5, "emerald",
                f"{len(open_rfqs)} request{'s' if len(open_rfqs) != 1 else ''} for quotation {'are' if len(open_rfqs) != 1 else 'is'} waiting for your reply.",
                cta={"label": "Open requests", "to": "/operations?tab=Procurement"},
                why="Requests for quotation you've received and not yet answered.",
                # On the free plan requests arrive but who sent them stays locked: here too.
                evidence=[_ev("Request" if plan == "explorer" else (r.get("customer_name") or "Request"), short_date(r.get("created_at")))
                          for r in open_rfqs[:5]],
                source="Requests for quotation in Business Operations"))
        else:
            cards.append(_card(
                "opportunities", 5, "emerald", "Look for new work: browse open requests and businesses on the Marketplace.",
                cta={"label": "Browse the Marketplace", "to": "/marketplace"},
                why="No request for quotation is waiting for you, so the Marketplace is where new work is found.", source="Marketplace"))

    if stale:
        day = latest.strftime("%d %b %Y").lstrip("0")
        for c in cards:
            if c["key"] in ("cash", "risk") and c["state"] == "available":
                c["state"] = "stale"
                c["stale"] = {"reason": f"Nothing has been recorded since {day}, so this may be out of date.", "as_of": as_of,
                              "refresh": {"label": "Update records", "to": "/operations"}}

    # The goal reorders within the stage: it raises its related cards to class 3, never above a
    # critical item, and never adds a card the stage doesn't show.
    for c in cards:
        c["goal_match"] = bool(goal and c["key"] in _GOAL_FAMILIES.get(goal, ()))
        if c["goal_match"] and c["priority_class"] > 3:
            c["priority_class"] = 3

    hidden = set(prefs.get("hidden_widget_ids") or [])
    pinned = list(prefs.get("pinned_widget_ids") or [])
    # Critical and time-sensitive items can't be hidden: the page must still say what needs attention (AC-11).
    cards = [c for c in cards if c["key"] not in hidden or c["priority_class"] <= 2]
    cards.sort(key=lambda c: (c["priority_class"] if c["priority_class"] <= 2 else 3,
                              0 if c["key"] in pinned and c["priority_class"] > 2 else 1,
                              c["priority_class"], _ORDER[c["key"]]))
    return cards[:CANDIDATE_CARDS]


def composition_key(cards: list[dict], prefs: dict, stage: str) -> str:
    """Changes only on a material change: the stage or goal changes, a card appears or goes, or
    its class, severity or state changes. Wording and amounts alone don't rearrange the page (s10.2)."""
    raw = "|".join([stage, str(prefs.get("current_goal"))]
                   + [f"{c['key']}:{c['priority_class']}:{c['severity']}:{c['state']}" for c in cards])
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


# ══ Preferences (presentation only, s11.2) ════════════════════════════════════

def preferences_of(data: dict, user_id: str) -> dict:
    stored = ((data.get("dashboard_preferences") or {}).get(str(user_id)) or {}) if isinstance(data.get("dashboard_preferences"), dict) else {}
    goal = stored.get("current_goal")
    insight = lambda w: w in WIDGETS and WIDGETS[w].widget_type == "insight"      # noqa: E731
    return {
        "current_goal": goal if goal in GOALS else None,
        "pinned_widget_ids": [w for w in stored.get("pinned_widget_ids") or [] if insight(w)],
        "hidden_widget_ids": [w for w in stored.get("hidden_widget_ids") or [] if insight(w)],
        "preferred_layout": stored.get("preferred_layout") or "default",
        "updated_at": stored.get("updated_at"),
    }


def clean_preferences(patch: dict, current: dict, now: datetime) -> dict:
    out = {k: current.get(k) for k in ("current_goal", "pinned_widget_ids", "hidden_widget_ids", "preferred_layout", "created_at")}
    if "current_goal" in patch:
        goal = patch["current_goal"]
        if goal not in (None, "") and goal not in GOALS:
            raise ValueError("Choose one of: " + ", ".join(GOALS) + ".")
        out["current_goal"] = goal or None
    for key in ("pinned_widget_ids", "hidden_widget_ids"):
        if key in patch and patch[key] is not None:
            ids = [str(w) for w in patch[key]]
            unknown = [w for w in ids if w not in WIDGETS or WIDGETS[w].widget_type != "insight"]
            if unknown:
                raise ValueError(f"Unknown dashboard card: {unknown[0]}.")
            out[key] = list(dict.fromkeys(ids))
    out["pinned_widget_ids"] = [w for w in out.get("pinned_widget_ids") or [] if w not in (out.get("hidden_widget_ids") or [])]
    out["created_at"] = out.get("created_at") or now.isoformat()
    out["updated_at"] = now.isoformat()
    return out


def clean_stage(stage: str | None) -> str | None:
    """A stage chosen by the user, or None to go back to the one read from the records."""
    if stage in (None, "", "auto"):
        return None
    stage = STAGE_ALIASES.get(str(stage).strip().lower(), str(stage).strip().lower())
    if stage not in STAGES:
        raise ValueError("Choose one of: " + ", ".join(STAGES) + ", or auto.")
    return stage


# ══ The composed dashboard ════════════════════════════════════════════════════

def _preview_stage(preview_stage: str | None, preview_pathway: str | None) -> str | None:
    stage = STAGE_ALIASES.get(str(preview_stage or "").lower(), str(preview_stage or "").lower())
    if stage in STAGES:
        return stage
    return {"startup": "pre_launch", "small_business": "operating"}.get(str(preview_pathway or "").lower())


def stage_routes(checks: dict, readiness: dict) -> dict:
    """Where pre-launch suggestions, shortcuts and "Add it" links go, from the selected launch
    and funding case. Each link opens the page its wording is about."""
    launch = checks.get("launch") if checks["features"]["launch"] else None
    funding = checks.get("funding") if checks["features"]["funding"] else None
    validated = next((i["done"] for i in readiness["items"] if i["key"] == "idea_validated"), False)
    out: dict = {}
    if launch:
        base = f"/launch/{launch['initiative_id']}"
        n = launch.get("blocker_count") or 0
        cls = launch.get("classification")
        if n:
            out["blockers"] = {"text": f"{n} launch blocker{'s' if n != 1 else ''} found: I'm listing what each needs.", "to": f"{base}?tab=results"}
        elif cls == "insufficient_evidence":
            out["blockers"] = {"text": "Your launch evidence has gaps: I'm listing them.", "to": f"{base}?tab=results"}
        elif cls == "ready":
            out["blockers"] = None                                   # nothing to clear: no suggestion
        elif cls:
            out["blockers"] = {"text": "Your launch plan has gaps left: I'm listing them.", "to": f"{base}?tab=results"}
        else:
            out["blockers"] = {"text": "Your launch hasn't been checked yet: I'm checking it.", "to": base}
        out["planned_costs"] = f"{base}?tab=setup&section=cash"
    elif checks["features"]["launch"]:
        out["blockers"] = ({"text": "I need your launch date and scope before I can check your readiness.", "to": "/launch"} if validated
                           else {"text": "Your idea hasn't been scored yet: I'm scoring it before you launch.", "to": "/validation"})
        out["planned_costs"] = "/launch"
    if funding:
        out["funding_pack"] = f"/funding/{funding['case_id']}?tab=documents"
        out["funding_secured"] = f"/funding/{funding['case_id']}?tab=setup&section=finances"
    elif checks["features"]["funding"]:
        out["funding_pack"] = out["funding_secured"] = "/funding"
    return out


async def readiness_checks(orch, business_id: str, ctx: dict) -> dict:
    """The selected funding case and launch, as the readiness service summarises them. A
    feature that is switched off, not set up, or failing never takes the dashboard down."""
    out: dict = {"funding": None, "launch": None, "features": {"funding": False, "launch": False}}
    try:
        from app.core.config import get_settings
        from app.modules.readiness.service import service_for
        s = get_settings()
        out["features"] = {"funding": bool(s.funding_readiness_enabled), "launch": bool(s.launch_readiness_enabled)}
        if not (out["features"]["funding"] or out["features"]["launch"]) or not ctx.get("actor"):
            return out
        found = await service_for(orch).dashboard_summaries(business_id, ctx["data"], ctx["actor"], ctx["now"])
        for key in ("funding", "launch"):
            out[key] = found.get(key) if out["features"][key] else None
    except Exception:      # noqa: BLE001
        logger.warning("readiness summaries unavailable for the dashboard", exc_info=False)
    return out


async def build_dashboard(orch, user_id: str, business_id: str, email: str | None = None,
                          preview_pathway: str | None = None, preview_stage: str | None = None) -> dict:
    """GET /businesses/{id}/dashboard (s14): context, action cards, KPIs, adaptive insights,
    Agent summary, approvals, report entry, freshness and entitlement, composed from
    authoritative services. Access (business scope and role) is checked by the Agent summary
    before anything is read."""
    from app.modules.agent import summary as summary_mod
    summary = await summary_mod.build_summary(orch, user_id, business_id, email, with_context=True)
    ctx = summary.pop("_ctx")
    data, policy, now, approvals = ctx["data"], ctx["policy"], ctx["now"], ctx["pending"]
    ent = summary["entitlement"]
    prefs = preferences_of(data, user_id)

    info = stage_of(data, now)
    wanted = _preview_stage(preview_stage, preview_pathway)
    preview = bool(wanted and wanted != info["stage"])
    if preview:
        # QA only (never in production): compose as if the business were at another stage.
        # Nothing is saved; the business's records and real stage are untouched.
        info = {**info, "stage": wanted, "source": "preview"}
    stage = info["stage"]
    layout = STAGE_LAYOUT[stage]
    transition = transition_of(data, info, now)
    readiness = launch_readiness(data, prefs["current_goal"])

    checks = await readiness_checks(orch, business_id, ctx)
    cards = compose_insights(data, policy, now, stage=stage, prefs=prefs, approvals=approvals,
                             can_send=bool(ent.get("can_approve")), transition=transition, readiness=readiness, checks=checks,
                             plan=ent.get("plan"), runs=ctx.get("runs") or [])
    values = kpi_values(data, policy, now, readiness)
    launch_check = checks.get("launch") if (checks.get("launch") or {}).get("classification") else None
    if launch_check:
        # The launch's own check replaces the record-derived percentage. Its figures are shown as given.
        coverage, blockers = launch_check.get("evidence_coverage"), launch_check.get("blocker_count") or 0
        values["launch_readiness"] = {
            "value": _CHECK_WORD[launch_check["classification"]], "state": "stale" if launch_check.get("freshness") == "stale" else "available",
            "hint": f"{coverage}% of evidence in place" + (f" \u00b7 {blockers} blocker{'s' if blockers != 1 else ''}" if blockers else ""),
            "tone": _CHECK_TONE[launch_check["classification"]]}
    risk_count, risk_parts = active_risks_before_launch(data, policy, now, checks)
    checked = any((c or {}).get("classification") for c in (checks.get("launch"), checks.get("funding")))
    values["launch_risks"] = ({"value": str(risk_count), "state": "available", "tone": "rose" if risk_count else "emerald",
                               "hint": " · ".join(risk_parts) if risk_parts else "Nothing found by your checks or in your records"} if checked or risk_count
                              else {"value": None, "state": "insufficient_data", "tone": None, "hint": "Appears once a launch or funding check has been done"})
    kpis = [{"key": k, "widget_id": k, "label": WIDGETS[k].title, "client_trend": WIDGETS[k].config.get("client_trend"),
             "to": WIDGETS[k].config.get("to"), "good_when_up": WIDGETS[k].config.get("good_when_up", True), **values[k]} for k in layout["kpis"]]
    history = None
    if stage == "pre_launch":
        # Once a day (not on a preview of another stage): today's figures are kept, so each tile can
        # show how it has moved once there are two days to compare.
        fig = (checks.get("launch") or {}).get("figures") or {}
        today_figures = {"launch_readiness": readiness.get("percent"), "runway": (fig.get("runway") or {}).get("months"),
                         "planned_costs": fig.get("planned_costs"), "funding_secured": fig.get("funding_secured"),
                         "launch_risks": risk_count if (checked or risk_count) else None}
        history = await keep_kpi_snapshot(orch, business_id, data, now, today_figures, write=not (preview_stage or preview_pathway))
    for k in kpis:
        points = [{"at": day, "value": row[k["key"]]} for day, row in sorted((history or {}).items()) if row.get(k["key"]) is not None]
        k["trend"] = {"points": points[-180:]} if history is not None else None
    report = WIDGETS[layout["report"]]

    # Agent suggestions and starter shortcuts that make no sense yet at this stage are left out
    # (no receipt or payment follow-up before the first invoice).
    hide = set(layout["agent_hide"])
    kept = [s for s in summary.get("suggestions") or [] if (s.get("action") or {}).get("capability") not in hide]
    stage_suggestions = [dict(x) for x in layout.get("agent_suggestions") or ()]
    figures = (checks.get("launch") or {}).get("figures") or {}
    cur = bz.currency_of(data)
    if figures.get("planned_costs") is not None:
        values["planned_costs"] = {"value": fmt_money(figures["planned_costs"], figures.get("currency") or cur), "state": "available", "tone": None,
                                   "hint": f"a month \u00b7 {figures['planned_costs_source']}"}
    if figures.get("runway"):
        run_ = figures["runway"]
        values["runway"] = ({"value": f"{run_['months']} month{'s' if run_['months'] != 1 else ''}", "state": "available", "tone": "rose" if run_["months"] < 3 else "amber",
                             "hint": f"Cash goes below zero in {run_['until_label']} \u00b7 from your launch plan's cash projection"} if run_.get("until")
                            else {"value": f"Beyond {run_['beyond_label']}", "state": "available", "tone": "emerald",
                                  "hint": "Cash stays above zero to the end of your launch plan's cash projection"})
    if figures.get("funding_secured") is not None:
        values["funding_secured"] = {"value": fmt_money(figures["funding_secured"], figures.get("currency") or cur), "state": "available", "tone": None,
                                     "hint": "Received, or committed with evidence, in your launch plan"}
    if figures.get("planned_costs") is not None and (figures.get("funding_secured") is not None or figures.get("opening_cash") is not None):
        items = [{**i, "done": True} if i["key"] == "costs_and_funding" else i for i in readiness["items"]]
        done = sum(1 for i in items if i["done"])
        readiness = {**readiness, "items": items, "done": done, "percent": round(done / len(items) * 100)}
    for k in kpis:
        if k["key"] in ("planned_costs", "runway", "funding_secured"):
            k.update(values[k["key"]])
    routes = stage_routes(checks, readiness)
    for x in list(stage_suggestions):
        if x["key"] == "stage_blockers":
            if "blockers" in routes:
                if routes["blockers"] is None:      # ready: the tile stays and says so
                    x["text"] = "Your launch is ready against its checklist. I'm watching for changes."
                else:
                    x["text"], x["action"] = routes["blockers"]["text"], {"to": routes["blockers"]["to"]}
            else:      # the launch check is switched off: open the first setup item still missing
                todo = next((i for i in readiness["items"] if not i["done"]), None)
                x["action"] = {"to": todo["to"]} if todo else x["action"]
        elif x["key"] == "stage_funding" and routes.get("funding_pack"):
            x["action"] = {"to": routes["funding_pack"]}
    stage_suggestions = agent_outcomes(stage_suggestions, ctx.get("runs") or [], policy, ent.get("plan"), checks, data)
    for k in kpis:      # "Add it" opens the forecast that holds the figure, not Simulation or Reports
        if k["key"] in ("planned_costs", "runway") and routes.get("planned_costs"):
            k["to"] = routes["planned_costs"]
        elif k["key"] == "funding_secured" and routes.get("funding_secured"):
            k["to"] = routes["funding_secured"]
    if routes.get("planned_costs"):
        readiness = {**readiness, "items": [{**i, "to": routes["planned_costs"]} if i["key"] == "costs_and_funding" else i for i in readiness["items"]]}
    status = [x for x in kept if x.get("key") == "attention"]              # "N tasks need attention", one line on top
    records = [x for x in kept if x.get("key") != "attention"]
    if stage_suggestions:
        records = records[:2]                                               # leave room for what the stage is about
    summary["suggestions"] = (status + records + stage_suggestions)[:4]
    summary["hidden_capabilities"] = sorted(hide)
    summary["shortcuts"] = [{**x, "action": {"to": routes["funding_pack"]}} if x["key"] == "funding_pack" and routes.get("funding_pack") else dict(x)
                            for x in layout.get("agent_shortcuts") or ()] or None
    summary["placeholder"] = layout.get("agent_placeholder")

    latest = _latest_activity(data)
    credits = ent.get("credits")
    return {
        "enabled": True,
        "business_id": business_id,
        "context": {
            "pathway": PATHWAY_OF[stage], "business_stage": stage, "stage_label": STAGE_LABEL[stage],
            "stage_source": info["source"], "detected_stage": info["detected"], "stage_signals": info["signals"],
            "stages": [{"key": s, "label": STAGE_LABEL[s]} for s in STAGES],
            "headline": ({"key": "launch_readiness", "label": "Launch readiness", "value": values["launch_readiness"]["value"], "state": "available",
                          "tone": values["launch_readiness"]["tone"]} if launch_check and layout["headline"] == "launch_readiness"
                         else headline_of(stage, layout, values, summary.get("risks") or [], readiness)),
            "transition": transition, "preview": preview,
            "account_scope": "single_business", "role": ctx["role"], "can_change_stage": bool(ent.get("can_prepare")),
            "current_goal": prefs["current_goal"], "goals": [{"key": k, "label": v} for k, v in GOALS.items()],
        },
        "action_cards": [{"key": k, "widget_id": k, "title": WIDGETS[k].title, **WIDGETS[k].config} for k in layout["action_cards"]],
        "kpis": kpis,
        "kpis_empty": layout["kpi_empty"] if all(k["state"] == "insufficient_data" for k in kpis) else None,
        "financial_summary": financial_summary(data, policy, now),
        "launch_readiness": readiness,
        # Summaries published by the readiness service (null when there is no case or launch yet).
        "funding_readiness": checks.get("funding"), "launch_check": checks.get("launch"), "readiness_features": checks["features"],
        "registration_status": registration_status(data),
        "insights": cards,
        "composition_key": composition_key(cards, prefs, stage),
        "max_priority_cards": MAX_PRIORITY_CARDS,
        "agent": summary,
        "needs_approval": summary.get("needs_approval") or [],
        "report": {"key": report.widget_id, "widget_id": report.widget_id, "title": report.title, **report.config},
        "freshness": {
            "generated_at": now.isoformat(), "data_as_of": latest.isoformat() if latest else None,
            "stale_after_days": STALE_AFTER_DAYS, "stale": is_stale(latest, now),
            "stale_reason": (f"Nothing has been recorded since {latest.strftime('%d %b %Y').lstrip('0')}, so some figures may be out of date."
                             if is_stale(latest, now) else None),
        },
        "entitlement": {**ent, "credits_exhausted": credits is not None and float(credits or 0) <= 0},
        "preferences": prefs,
        "widgets": [asdict(w) for w in WIDGETS.values() if w.active_flag and stage in w.eligible_business_stages],
    }
