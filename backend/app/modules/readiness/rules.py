"""Versioned readiness profiles (Shared Architecture Blueprint s5; Funding PRD s7-8; Launch PRD s7-8).

A profile is configuration, checked when the module loads: criteria and their two checks,
weights, gates, thresholds, freshness policy, wording and the guided sections. It holds no
executable code. The engine evaluates each check by its code; a profile decides which checks
exist, what they weigh and how results are worded.

The rubrics are pilot designs. They measure preparation against a named checklist. They do
not predict funding outcomes or commercial success.
"""
from __future__ import annotations

from typing import Any

FUNDING = "funding_case"
LAUNCH = "launch_initiative"

CHECK_STATES = ("passed", "failed", "unknown")
CRITERION_STATES = ("met", "partially_met", "unmet", "unknown", "not_applicable")
CLASSIFICATIONS = ("ready", "conditionally_ready", "not_ready", "insufficient_evidence")
EXECUTION_STATES = ("queued", "running", "succeeded", "failed", "cancelled")
ACTION_STATES = ("open", "in_progress", "awaiting_evidence", "completed", "dismissed")
UNRESOLVED_ACTION_STATES = ("open", "in_progress", "awaiting_evidence")
DATA_BASES = ("actual", "forecast", "estimate")
SUPPORTED_CURRENCIES = ("GBP", "USD", "EUR")

FUNDING_STATUSES = ("draft", "active", "archived")
LAUNCH_STATUSES = ("draft", "preparing", "launched", "cancelled", "archived")

EVIDENCE_TYPES = {
    "research": "Market research", "interview": "Customer interview", "enquiry": "Customer enquiry",
    "letter_of_intent": "Letter of intent", "pilot": "Pilot", "sale": "Sale", "record": "Business record",
    "document": "Document", "permission": "Permission or licence", "dry_run": "Test run", "other": "Other",
}
# How strongly each type of demand evidence supports a claim. Shown beside the evidence; a
# reviewed research item can establish preparation without establishing strong demand.
EVIDENCE_STRENGTH = {"research": "indicative", "interview": "indicative", "enquiry": "moderate", "letter_of_intent": "moderate",
                     "pilot": "strong", "sale": "strong"}
VERIFICATION = {"unverified": "Not reviewed", "self_attested": "Self-attested", "independently_reviewed": "Independently reviewed",
                "corroborated": "Backed by records"}


def _c(code: str, title: str, weight: int, a: tuple[str, str], b: tuple[str, str], *, attested: tuple[str, ...] = (), tool: dict | None = None,
       section: str = "") -> dict:
    def check(suffix: str, item: tuple[str, str]) -> dict:
        return {"code": f"{code}.{suffix}", "label": item[0], "missing": item[1], "kind": "attested" if suffix in attested else "computed"}
    return {"code": code, "title": title, "weight": weight, "checks": [check("A", a), check("B", b)], "tool": tool, "section": section}


def _f(key: str, label: str, type_: str = "text", **extra: Any) -> dict:
    return {"key": key, "label": label, "type": type_, **extra}


# ══ Funding Readiness: equity preparation, UK service and software businesses ══

FUNDING_EQUITY_V1 = {
    "id": "funding.equity.uk_service_software", "version": "0.1", "subject_type": FUNDING, "available": True,
    "title": "Equity preparation", "route": "equity", "jurisdiction": "UK", "business_models": ("service", "software"),
    "description": "Preparation for initial equity discussions, for UK service and software businesses.",
    "status_note": "Pilot checklist. Weights and thresholds are proposals that have not been calibrated against funding outcomes.",
    "score_needs_gates": False,
    "thresholds": {"conditionally_ready": 60, "ready": 80},
    "wording": {
        "ready": "Prepared for initial equity discussions against this checklist.",
        "conditionally_ready": "Preparation gaps remain.",
        "not_ready": "Not prepared yet against this checklist.",
        "insufficient_evidence": "Not enough evidence to assess yet.",
        "disclaimer": "This measures preparation against the checklist. It is not the likelihood of securing investment and does not replace an investor's own assessment.",
    },
    "freshness_days": {"cash_position": 30, "operating_results": 90, "forecast": 30, "evidence": 180, "attestation": 180},
    "forecast_months": 12,
    "criteria": [
        _c("C1", "Funding purpose", 10,
           ("Positive target, currency and intended receipt date confirmed", "Enter the amount you want to raise, its currency and when you expect to receive it, then confirm them."),
           ("Purpose links to a measurable milestone", "Say what the funding is for and link it to a milestone with a measure and a target."),
           tool={"label": "Funding goal", "section": "goal"}, section="goal"),
        _c("C2", "Use of funds", 15,
           ("Allocations reconcile exactly to the target", "Allocate the whole amount, including any reserve and fundraising costs."),
           ("Every allocation has a period and a purpose, or a reserve rationale", "Give each allocation a month and a purpose (or, for a reserve, why it is held)."),
           tool={"label": "Use of funds", "section": "finances"}, section="finances"),
        _c("C3", "Financial preparation", 20,
           ("The monthly forecast is complete and reconciles", "Complete the monthly cash forecast: opening cash, and receipts and payments for every month."),
           ("Material receipts and payments have documented assumptions and sources", "Write down the assumption behind your receipts and your payments, and where each comes from."),
           tool={"label": "Cash forecast", "section": "finances"}, section="finances"),
        _c("C4", "Demand evidence", 15,
           ("At least one dated customer or market evidence item is attached", "Attach at least one dated piece of customer or market evidence."),
           ("Its relevance to the target customer and offer is confirmed by a reviewer", "Have a reviewer confirm the evidence is relevant to your target customer and offer."),
           attested=("B",), tool={"label": "Evidence", "section": "traction"}, section="traction"),
        _c("C5", "Business economics", 10,
           ("Pricing and direct and fixed costs are provided on a consistent basis", "Enter your price, direct cost per sale and monthly fixed costs."),
           ("Break-even and capacity findings and their limitations are reviewed and explained", "Have a reviewer confirm the break-even and capacity findings, and their limits, have been reviewed."),
           attested=("B",), tool={"label": "Finances", "section": "finances"}, section="finances"),
        _c("C6", "Market and growth plan", 10,
           ("Target segment and differentiation are documented", "Describe your target segment and what sets you apart."),
           ("The acquisition approach has an owner, cost assumptions and a measurable milestone", "Give your acquisition approach an owner, a cost assumption and a milestone."),
           tool={"label": "Business and market", "section": "market"}, section="market"),
        _c("C7", "Team and delivery", 10,
           ("Key execution responsibilities have named owners", "Name who is responsible for each key area."),
           ("Material capacity and dependency gaps have documented actions", "List any capacity or dependency gaps with the action for each, or confirm there are none."),
           tool={"label": "Team and delivery", "section": "team"}, section="team"),
        _c("C8", "Materials and risks", 10,
           ("Required preparation documents exist and are reviewed", "Provide and review the four preparation documents."),
           ("Known material risks and funding-timing issues are disclosed with actions", "List known material risks, each with an action, or confirm there are none."),
           tool={"label": "Documents and risks", "section": "documents"}, section="documents"),
    ],
    "gates": [
        {"code": "G1", "label": "A confirmed positive funding target and explicit timing", "criterion": "C1",
         "remedy": "Enter a funding target above zero and the date you expect to receive it, then confirm them."},
        {"code": "G2", "label": "Allocations reconcile to the target", "criterion": "C2",
         "remedy": "Change the allocations or the target so they are equal. The target is never changed for you."},
        {"code": "G3", "label": "A complete, internally reconciled forecast", "criterion": "C3",
         "remedy": "Complete every month of the forecast and correct any invalid figures."},
        {"code": "G4", "label": "No unresolved contradictory figures across the case documents", "criterion": "C8",
         "remedy": "Review each document and resolve any figure that disagrees with the case."},
    ],
    "required_documents": [
        {"key": "executive_summary", "label": "Executive summary or equivalent pitch content"},
        {"key": "use_of_funds_schedule", "label": "Use-of-funds schedule", "record": "use_of_funds"},
        {"key": "forecast", "label": "Monthly forecast", "record": "forecast"},
        {"key": "team_summary", "label": "Team and ownership summary"},
    ],
    "sections": [
        {"key": "goal", "title": "Funding goal", "fields": [
            _f("target_amount", "How much do you want to raise?", "money", help="Leave blank if you don't know yet. The forecast can help you work it out."),
            _f("currency", "Currency", "select", options=list(SUPPORTED_CURRENCIES)),
            _f("receipt_date", "When do you expect to receive it?", "date"),
            _f("timing_confirmed", "I confirm this amount and date", "boolean"),
            _f("purpose", "What is the funding for?", "textarea"),
            _f("milestones", "Milestones", "list", item="milestone", fields=[
                _f("outcome", "Outcome"), _f("measure", "How it is measured"), _f("baseline", "Where it is now"),
                _f("target", "Target"), _f("due_date", "Due", "date"), _f("owner", "Owner")]),
            _f("purpose_milestone_id", "Which milestone does the funding pay for?", "ref", of="milestones", show="outcome"),
        ]},
        {"key": "market", "title": "Business and market", "fields": [
            _f("business_model", "Business model", "select", options=["service", "software"]),
            _f("stage", "Trading so far", "select", options=["pre_revenue", "trading"], labels={"pre_revenue": "Not trading yet", "trading": "Trading"}),
            _f("market.target_segment", "Who is your target customer?", "textarea"),
            _f("market.differentiation", "What sets you apart?", "textarea"),
            _f("market.acquisition_approach", "How will you win customers?", "textarea"),
            _f("market.acquisition_owner", "Who owns customer acquisition?"),
            _f("market.acquisition_cost", "What do you assume it costs?", help="For example a monthly budget or a cost per customer."),
            _f("market.acquisition_milestone_id", "Milestone it is measured by", "ref", of="milestones", show="outcome"),
        ]},
        {"key": "traction", "title": "Traction", "fields": [
            _f("traction.summary", "What demand have you seen so far?", "textarea",
               help="Research, enquiries, pilots or sales. If you have no sales yet, say so: nothing is filled in for you."),
            _f("traction.results_through", "Trading results are recorded up to", "date", when={"stage": "trading"}),
        ], "evidence": ["C4.A"], "attest": ["C4.B"]},
        {"key": "finances", "title": "Finances and use of funds", "fields": [
            _f("economics.price", "Price per sale", "money"),
            _f("economics.direct_cost", "Direct cost per sale", "money"),
            _f("economics.fixed_costs_monthly", "Fixed costs each month", "money"),
            _f("use_of_funds", "Use of funds", "list", item="allocation", fields=[
                _f("category", "Category", "select", options=["People", "Product", "Marketing and sales", "Operations", "Equipment", "Fundraising costs", "Reserve", "Other"]),
                _f("amount", "Amount", "money"), _f("period", "Month", "month"), _f("purpose", "Purpose"),
                _f("rationale", "Reserve rationale", help="For a reserve: why it is held."),
                _f("milestone_id", "Milestone", "ref", of="milestones", show="outcome")]),
        ], "forecast": True, "attest": ["C5.B"]},
        {"key": "team", "title": "Team and delivery", "fields": [
            _f("team.responsibilities", "Who is responsible for what", "list", item="responsibility", fields=[_f("area", "Area"), _f("owner", "Owner")]),
            _f("team.gaps", "Capacity and dependency gaps", "list", item="gap", fields=[_f("gap", "Gap"), _f("action", "Action")]),
            _f("team.no_gaps", "There are no material capacity or dependency gaps", "boolean"),
        ]},
        {"key": "documents", "title": "Documents and risks", "fields": [
            _f("risks", "Known material risks", "list", item="risk", fields=[
                _f("risk", "Risk"), _f("action", "Action"),
                _f("kind", "Type", "select", options=["general", "funding_timing"], labels={"general": "General", "funding_timing": "Funding timing"})]),
            _f("no_known_risks", "There are no known material risks", "boolean"),
        ], "documents": True},
    ],
}

# ══ Launch Readiness: commercial service launch ═══════════════════════════════

LAUNCH_COMMERCIAL_V1 = {
    "id": "launch.commercial_service.uk", "version": "0.1", "subject_type": LAUNCH, "available": True,
    "title": "Commercial service launch", "scope": "commercial", "jurisdiction": "UK", "business_models": ("service", "software"),
    "launch_types": ("initial_business", "new_offering"),
    "description": "A first commercial launch, or a new service within an existing business.",
    "status_note": "Pilot checklist. It is self-reviewed and is not a compliance certificate: it does not claim to list every requirement that applies to you.",
    "score_needs_gates": True,
    "thresholds": {"conditionally_ready": 60, "ready": 80},
    "wording": {
        "ready": "Prepared for the defined launch scope against this checklist.",
        "conditionally_ready": "Preparation gaps remain.",
        "not_ready": "Not prepared yet for the defined launch scope.",
        "insufficient_evidence": "Not enough evidence to assess yet.",
        "disclaimer": "This measures preparation for the launch you defined. It does not guarantee demand, profit, regulatory compliance or survival.",
    },
    "freshness_days": {"cash_position": 30, "forecast": 30, "economics": 30, "capacity": 30, "evidence": 180, "attestation": 180},
    "forecast_months": 6, "months_after_launch": 3, "final_check_days": 7,
    "criteria": [
        _c("C1", "Customer and demand", 15,
           ("Target segment, problem and dated demand evidence are documented", "Describe your target customer and their problem, and attach dated demand evidence."),
           ("Evidence relevance and limitations are explicitly reviewed", "Confirm you have reviewed how relevant the evidence is and what it does not show."),
           attested=("B",), tool={"label": "Customers and offer", "section": "customers"}, section="customers"),
        _c("C2", "Offer and pricing", 15,
           ("Launch scope, price, delivery terms and customer promise are confirmed", "Fill in what you are launching, the price, delivery terms and your promise to the customer, then confirm them."),
           ("Cost and margin inputs are validated and their implications reviewed", "Enter price and costs, then confirm you have reviewed what the margin means."),
           attested=("B",), tool={"label": "Pricing and economics", "section": "economics"}, section="economics"),
        _c("C3", "Cash preparation", 20,
           ("The required cash projection is complete and reconciled", "Complete the cash projection for every month it must cover."),
           ("Setup and operating commitments are included with evidence or labelled as assumptions", "List your setup and operating commitments, each marked as evidenced or an assumption."),
           tool={"label": "Cash", "section": "cash"}, section="cash"),
        _c("C4", "Delivery capability", 15,
           ("Planned demand fits evidenced available capacity", "Enter your available capacity, what is already committed and what the launch needs."),
           ("Critical suppliers, people and systems are available, with contingency where needed", "List the suppliers, people and systems you depend on, and whether each is available."),
           tool={"label": "Delivery", "section": "delivery"}, section="delivery"),
        _c("C5", "Operational process", 10,
           ("The enquiry or order to delivery and payment process is documented", "Describe how an enquiry or order becomes a delivery and a payment."),
           ("A representative end-to-end dry run has recorded results and resolved critical failures", "Record an end-to-end test run and what happened."),
           tool={"label": "Operational prerequisites", "section": "operations"}, section="operations"),
        _c("C6", "Applicable prerequisites", 10,
           ("Applicable launch obligations and prerequisites are identified and reviewed", "List what you must have in place to launch, then confirm you have reviewed which apply."),
           ("Required permissions or prerequisites are evidenced as completed by launch", "Mark each prerequisite completed, with its evidence, before launch."),
           attested=("A",), tool={"label": "Operational prerequisites", "section": "operations"}, section="operations"),
        _c("C7", "Route to market", 10,
           ("Initial acquisition channel, audience and launch message are defined", "Name your first channel, its audience and your launch message."),
           ("Channel execution has an owner, budget and measurable target", "Give the channel an owner, a budget and a target."),
           tool={"label": "Sales and launch plan", "section": "sales"}, section="sales"),
        _c("C8", "Launch control", 5,
           ("Launch milestones, date and owners are agreed", "Set the launch date and give every milestone a date and an owner."),
           ("Success measures, incident response and post-launch review date are recorded", "Record how you will measure success, what you do if something goes wrong and when you will review."),
           tool={"label": "Sales and launch plan", "section": "sales"}, section="sales"),
    ],
    "gates": [
        {"code": "B1", "label": "No cash shortfall in the months the projection must cover", "criterion": "C3", "severity": "critical",
         "remedy": "Change the plan so cash stays above zero in every month, or add committed, evidenced financing. Expected funding is not enough."},
        {"code": "B2", "label": "Planned demand fits confirmed delivery capacity", "criterion": "C4", "severity": "critical",
         "remedy": "Reduce the launch volume, or add capacity that is confirmed available by the launch date."},
        {"code": "B3", "label": "Every required permission or prerequisite is completed and valid at launch", "criterion": "C6", "severity": "critical",
         "remedy": "Complete the prerequisite and attach its evidence. A permission must still be valid on the launch date."},
        {"code": "B4", "label": "The end-to-end delivery and payment test has no unresolved critical failure", "criterion": "C5", "severity": "critical",
         "remedy": "Resolve the failure, run the test again and record the result."},
        {"code": "B5", "label": "Each sale contributes more than it costs to deliver", "criterion": "C2", "severity": "critical",
         "remedy": "Raise the price or lower the cost of delivery until the contribution is above zero."},
    ],
    "sections": [
        {"key": "customers", "title": "Customers and offer", "fields": [
            _f("customers.target_segment", "Who is this launch for?", "textarea"),
            _f("customers.problem", "What problem does it solve for them?", "textarea"),
            _f("audience", "Launch audience"),
            _f("geography", "Where are you launching?"),
        ], "evidence": ["C1.A"], "attest": ["C1.B"]},
        {"key": "economics", "title": "Pricing and economics", "fields": [
            _f("offer.launch_scope", "What exactly are you launching?", "textarea"),
            _f("offer.price", "Price", "money"),
            _f("offer.delivery_terms", "Delivery terms", "textarea"),
            _f("offer.customer_promise", "Your promise to the customer", "textarea"),
            _f("offer.confirmed", "I confirm the scope, price, terms and promise", "boolean"),
            _f("economics.price_per_unit", "Price per unit sold", "money"),
            _f("economics.variable_cost_per_unit", "Cost to deliver one unit", "money"),
            _f("economics.fixed_costs_monthly", "Fixed costs each month", "money",
               help="For a new service in an existing business, enter only the costs the launch adds."),
            _f("economics.shared_cost_method", "How shared costs are split", help="Only for a new service that shares costs with the rest of the business.",
               when={"launch_type": "new_offering"}),
        ], "attest": ["C2.B"]},
        {"key": "cash", "title": "Cash", "fields": [], "forecast": True, "commitments": True},
        {"key": "delivery", "title": "Delivery", "fields": [
            _f("planned_volume.amount", "Planned launch volume each month", "number"),
            _f("planned_volume.unit", "Measured in", help="For example hours, customers or projects."),
            _f("delivery.capacity_available", "Capacity available each month", "number"),
            _f("delivery.capacity_committed", "Already committed to existing work", "number"),
            _f("delivery.capacity_unit", "Capacity is measured in", help="For example hours."),
            _f("delivery.capacity_per_unit", "Capacity used by one unit of volume", "number",
               help="Only needed when volume and capacity use different units, for example hours per customer."),
            _f("delivery.dependencies", "Critical suppliers, people and systems", "list", item="dependency", fields=[
                _f("name", "Name"), _f("kind", "Type", "select", options=["supplier", "person", "system"]),
                _f("available", "Available by launch", "select", options=["yes", "no"], labels={"yes": "Yes", "no": "No"}),
                _f("needs_contingency", "Needs a backup", "boolean"), _f("contingency", "Backup arrangement")]),
            _f("delivery.no_dependencies", "The launch does not depend on any critical supplier, person or system", "boolean"),
        ]},
        {"key": "operations", "title": "Operational prerequisites", "fields": [
            _f("operations.process", "How does an enquiry or order become a delivery and a payment?", "textarea"),
            _f("operations.process_version", "Process version", help="Change this when the process changes. A test run only counts for the version it tested."),
            _f("operations.dry_run.date", "Test run date", "date"),
            _f("operations.dry_run.outcome", "Test run result", "select", options=["passed", "failed"], labels={"passed": "Worked end to end", "failed": "A critical step failed"}),
            _f("operations.dry_run.failures_resolved", "Every critical failure has been resolved", "boolean"),
            _f("operations.dry_run.notes", "What happened", "textarea"),
            _f("prerequisites", "What must be in place to launch", "list", item="prerequisite", fields=[
                _f("name", "Prerequisite"),
                _f("applicable", "Applies to this launch", "select", options=["yes", "no"], labels={"yes": "Applies", "no": "Does not apply"}),
                _f("rationale", "Why it does not apply"),
                _f("critical", "Required before launch", "boolean"),
                _f("status", "Status", "select", options=["completed", "not_completed"], labels={"completed": "Completed", "not_completed": "Not completed"}),
                _f("required_by", "Required by", "date"), _f("valid_until", "Valid until", "date"),
                _f("source_reference", "Where the requirement comes from"),
                _f("evidence_id", "Evidence", "evidence")]),
            _f("no_prerequisites", "Nothing has to be in place before this launch", "boolean"),
            _f("no_prerequisites_rationale", "Why nothing is required"),
        ], "attest": ["C6.A"]},
        {"key": "sales", "title": "Sales and launch plan", "fields": [
            _f("market.channel", "First acquisition channel"),
            _f("market.audience", "Who it reaches"),
            _f("market.message", "Launch message", "textarea"),
            _f("market.owner", "Channel owner"),
            _f("market.budget", "Channel budget", "money"),
            _f("market.target", "Channel target", help="For example 20 enquiries in the first month."),
            _f("control.milestones", "Launch milestones", "list", item="milestone", fields=[
                _f("outcome", "Outcome"), _f("due_date", "Due", "date"), _f("owner", "Owner"),
                _f("depends_on", "Depends on", "refs", of="control.milestones", show="outcome"),
                _f("status", "Status", "select", options=["open", "done"], labels={"open": "Open", "done": "Done"})]),
            _f("control.success_measures", "How you will measure success", "textarea"),
            _f("control.incident_response", "What you will do if something goes wrong", "textarea"),
            _f("control.review_date", "Post-launch review date", "date"),
        ]},
    ],
}

# Declared so the product can say plainly that they are not available yet. An unavailable
# profile can never produce a score (Funding PRD s2, Launch PRD s2-3).
UNAVAILABLE = [
    {"id": "funding.debt", "subject_type": FUNDING, "route": "debt", "title": "Loans and debt", "available": False,
     "reason": "Lender criteria have not been defined yet, so a loan readiness check isn't available."},
    {"id": "funding.grant", "subject_type": FUNDING, "route": "grant", "title": "Grants", "available": False,
     "reason": "Grant programme criteria have not been defined yet, so a grant readiness check isn't available."},
    {"id": "launch.pilot", "subject_type": LAUNCH, "scope": "pilot", "title": "Limited pilot", "available": False,
     "reason": "A separate checklist for limited pilots has not been released yet."},
    {"id": "launch.new_market", "subject_type": LAUNCH, "launch_type": "new_market", "title": "New market", "available": False,
     "reason": "A checklist for entering a new market has not been released yet."},
    {"id": "launch.physical_product", "subject_type": LAUNCH, "business_model": "product", "title": "Physical products and stock", "available": False,
     "reason": "Service formulas don't apply to stock-holding businesses, and a product checklist has not been released yet."},
]

# The check that a gate's fix also resolves. When both fail, they are one action, not two.
# This is bookkeeping for actions only: it changes no weight, gate, threshold or wording.
for _profile, _covers in ((FUNDING_EQUITY_V1, {"G1": "C1.A", "G2": "C2.A", "G3": "C3.A"}),
                          (LAUNCH_COMMERCIAL_V1, {"B2": "C4.A", "B3": "C6.B", "B4": "C5.B"})):
    for _gate in _profile["gates"]:
        _gate["covers"] = _covers.get(_gate["code"])

PROFILES: dict[str, dict] = {f"{p['id']}@{p['version']}": p for p in (FUNDING_EQUITY_V1, LAUNCH_COMMERCIAL_V1)}
CURRENT = {FUNDING: f"{FUNDING_EQUITY_V1['id']}@{FUNDING_EQUITY_V1['version']}", LAUNCH: f"{LAUNCH_COMMERCIAL_V1['id']}@{LAUNCH_COMMERCIAL_V1['version']}"}


class UnsupportedProfile(ValueError):
    pass


def profile_key(profile: dict) -> str:
    return f"{profile['id']}@{profile['version']}"


def get_profile(key: str) -> dict:
    if key not in PROFILES:
        raise UnsupportedProfile("This checklist version is not available.")
    return PROFILES[key]


def select_profile(subject_type: str, data: dict) -> dict:
    """The profile for a case or initiative, or UnsupportedProfile with the reason shown to the user."""
    if subject_type == FUNDING:
        route = str(data.get("route") or "equity").lower()
        if route != "equity":
            raise UnsupportedProfile(next((u["reason"] for u in UNAVAILABLE if u.get("route") == route), "That funding route isn't available yet."))
        model = str(data.get("business_model") or "service").lower()
        if model not in FUNDING_EQUITY_V1["business_models"]:
            raise UnsupportedProfile("This check supports service and software businesses for now.")
        return FUNDING_EQUITY_V1
    if subject_type == LAUNCH:
        if str(data.get("scope") or "commercial").lower() != "commercial":
            raise UnsupportedProfile(UNAVAILABLE[2]["reason"])
        kind = str(data.get("launch_type") or "initial_business").lower()
        if kind not in LAUNCH_COMMERCIAL_V1["launch_types"]:
            raise UnsupportedProfile(UNAVAILABLE[3]["reason"])
        model = str(data.get("business_model") or "service").lower()
        if model not in LAUNCH_COMMERCIAL_V1["business_models"]:
            raise UnsupportedProfile(UNAVAILABLE[4]["reason"])
        return LAUNCH_COMMERCIAL_V1
    raise UnsupportedProfile("Unknown subject.")


def checks_of(profile: dict) -> dict[str, dict]:
    return {ch["code"]: {**ch, "criterion": c["code"], "weight": c["weight"]} for c in profile["criteria"] for ch in c["checks"]}


def public_profile(profile: dict) -> dict:
    return {"key": profile_key(profile), **{k: v for k, v in profile.items() if k not in ("business_models", "launch_types")}}


def _check_configuration() -> None:
    """Fail at import, not in front of a user, when a profile is malformed."""
    for key, p in PROFILES.items():
        assert sum(c["weight"] for c in p["criteria"]) == 100, f"{key}: criterion weights must total 100"
        codes = [c["code"] for c in p["criteria"]]
        assert len(set(codes)) == len(codes), f"{key}: duplicate criterion code"
        for c in p["criteria"]:
            assert len(c["checks"]) == 2 and all(ch["kind"] in ("computed", "attested") for ch in c["checks"]), f"{key}/{c['code']}: two checks required"
        for g in p["gates"]:
            assert g["criterion"] in codes and g.get("remedy"), f"{key}/{g['code']}: gate needs a criterion and a remedy"
        t = p["thresholds"]
        assert 0 < t["conditionally_ready"] < t["ready"] <= 100, f"{key}: thresholds out of order"
        assert set(p["wording"]) >= set(CLASSIFICATIONS), f"{key}: wording missing for a classification"
        section_keys = {s["key"] for s in p["sections"]}
        assert len(p["sections"]) == 6, f"{key}: six guided sections"
        for c in p["criteria"]:
            assert c["section"] in section_keys, f"{key}/{c['code']}: unknown section"


_check_configuration()
