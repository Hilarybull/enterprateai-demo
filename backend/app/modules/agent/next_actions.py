"""What to run next after a funding readiness check (the owner's brief, 21 Oct 2026): each open gap mapped to a real
feature, prefilled from the workspace and this case, ranked by what moves the score most (blockers first), then free
first, then quickest. At most three. Deterministic: nothing here asks a model.

Each recommendation: a short title, one reason tied to the gap, the feature, where it opens (with what it is prefilled
with), its cost ("Free", "N credits" or the plan that includes it) and whether the plan allows it. Anything already done,
or already waiting in Needs Approval, is left out; a locked feature is never offered without saying which plan has it."""
from __future__ import annotations

from typing import Any

from app.modules.agent import business as bz
from app.modules.agent import config as agent_config

# Minutes it usually takes, for the tie-break after cost.
_MINUTES = {"catalogue": 2, "operations": 5, "answers": 2, "scenario": 3, "plan": 10, "validation": 10, "pack": 5, "letter": 5, "options": 3}


def _short(amount: Any, currency: str) -> str:
    try:
        n = float(amount)
    except (TypeError, ValueError):
        return ""
    sign = {"GBP": "£", "NGN": "₦", "USD": "$", "EUR": "€"}.get(currency, "")
    for size, word in ((1e9, "bn"), (1e6, "m"), (1e3, "K")):
        if n >= size:
            v = n / size
            return f"{sign}{v:.1f}".rstrip("0").rstrip(".") + word
    return f"{sign}{n:,.0f}"


def _economics_clash(co: dict, case: dict) -> dict | None:
    """The catalogue's price and cost against the case's, when either differs by more than a tenth."""
    def num(v):
        try:
            return float(str(v).replace(",", "")) if v not in (None, "") else None
        except ValueError:
            return None
    priced = co.get("priced") or []
    if not priced:
        return None
    first = priced[0]
    cat = {"price": num(first.get("base_price")), "cost": num(first.get("cost_of_sales")) if first in (co.get("costed") or []) else None}
    mine = {"price": num(case.get("price")), "cost": num(case.get("cost"))}
    differs = [k for k in ("price", "cost") if cat[k] is not None and mine[k] is not None and abs(cat[k] - mine[k]) > 0.1 * max(abs(cat[k]), 1)]
    if not differs:
        return None
    return {"catalogue": cat, "case": mine, "fields": differs, "name": first.get("name")}


def _route_word(route: str | None) -> str:
    return {"loan": "loan", "grant": "grant", "equity": "investment"}.get(str(route or "").lower(), "funding")


def recommend(result: dict, answers: dict, data: dict | None, *, plan: str | None, prices: dict[str, int], pending: set[str],
              case_id: str | None = None, session_id: str | None = None, currency: str | None = None, case_forecast: bool = False,
              case_economics: dict | None = None) -> list[dict]:
    """At most three next actions for this funding result. `prices`: credits per capability (0 is free); `pending`: the
    capabilities already waiting in Needs Approval."""
    from app.modules.agent import first_value, research
    data = data or {}
    co = first_value._company(data)
    cur = str(currency or bz.currency_of(data) or "GBP").upper()
    gaps = {b.get("key"): b for b in result.get("blockers") or []}
    failed = {k for k, b in gaps.items() if b.get("kind") == "failed"}
    amount = answers.get("amount")
    use = str(answers.get("use") or "").strip()
    route = str(answers.get("route") or "").lower()
    loan = f"{_short(amount, cur)} {_route_word(route)}".strip() if amount else f"your {_route_word(route)}"
    said = research.traction_figures(answers.get("traction"))
    price_said = round(said["monthly_revenue"] / said["monthly_sales"]) if said.get("monthly_revenue") and said.get("monthly_sales") else None
    case = f"/funding/{case_id}" if case_id else "/funding"
    out: list[dict] = []

    def add(key: str, title: str, reason: str, feature: str, kind: str, *, capability: str | None = None, to: str | None = None,
            prefill: dict | None = None, gap: str | None = None, time: str = "scenario") -> None:
        if capability and capability in pending:
            return      # already waiting in Needs Approval
        cost = prices.get(capability, 0) if capability else 0
        allowed = agent_config.plan_allows(plan, capability) if capability else True
        need = agent_config.CAPABILITY_MIN_PLAN.get(capability or "", "starter_insight") if capability else None
        out.append({"key": key, "title": title, "reason": reason, "feature": feature, "kind": kind, "capability": capability, "to": to,
                    "prefill": prefill or {}, "gap": gap, "blocker": gap in failed, "credits": cost,
                    "cost": ("Free" if not cost else f"{cost} credits") if allowed else agent_config.PLAN_LABEL.get(need, "Starter") + " plan",
                    "allowed": allowed, "upgrade": None if allowed else {"label": "Upgrade", "to": "/pricing"},
                    "button": "Open" if kind == "open" else "Start", "_minutes": _MINUTES.get(time, 5)})

    # a. Price and cost per sale: the Catalogue, the price worked out from the chat, the cost asked. Where the case says
    #    another price or cost than the catalogue, asked which is right (the owner's QA, 21 Oct: ₦1,000 and ₦60 on the
    #    case, ₦4,000 and ₦1,500 in the catalogue), and kept until they agree.
    clash = _economics_clash(co, case_economics or {})
    if clash:
        m = lambda v: research.money(v, cur)      # noqa: E731
        add("catalogue", "Check your price and cost per sale",
            f"Your catalogue says {m(clash['catalogue']['price'])} a sale and {m(clash['catalogue']['cost'])} cost; your case says "
            f"{m(clash['case']['price'])} and {m(clash['case']['cost'])}. Which is right?",
            "Catalogue", "inline", prefill={"conflict": True, "catalogue": clash["catalogue"], "case": clash["case"], "currency": cur,
                                            "name": clash.get("name") or answers.get("sell") or ""},
            gap="economics", time="catalogue")
    elif "economics" in gaps and not (co["priced"] and co["costed"]):
        add("catalogue", f"Set your {'price' if not use else 'price'} and cost per sale", "Funders check each sale makes money",
            "Catalogue", "inline", prefill={"name": answers.get("sell") or answers.get("description") or "", "price": price_said, "currency": cur},
            gap="economics", time="catalogue")
    # b. Forecast: does the loan pay back, month by month.
    if "financial" in gaps and not co["forecast"]:
        # Said as the case stands (the owner's QA, 21 Oct): a forecast on the case without the repayments, or none yet.
        why = ("Your forecast doesn't include repayments yet" if route == "loan" else "Your forecast doesn't show the funding yet") if case_forecast \
            else "Funders need a forecast; yours is missing"
        add("scenario", f"See if the {loan} pays back", why, "Simulation", "task",
            capability="expansion_scenario", prefill={"amount": amount, "use": use, "currency": cur}, gap="financial", time="scenario")
    # c. Business plan or executive summary.
    if not co["plan"] and ("materials" in gaps or "use_of_funds" in gaps or "market" in gaps):
        add("plan", "Draft your business plan", "Funders ask for one; you have none", "Business Blueprints", "task",
            capability="business_plan_draft", prefill={"answers": {k: v for k, v in answers.items() if v not in (None, "")}}, gap="materials", time="plan")
    # (No "Show who is already buying" or "Name who delivers the plan": the case's own fields are its next steps, worded
    # from the case, and gone once filled. The owner's QA, 21 Oct: they repeated the steps and stayed after the fields were filled.)
    # e. Revenue on record.
    if not co["invoices"] and (said.get("monthly_revenue") or "demand" in gaps):
        add("operations", "Record your sales", "Recorded sales back up what you told me", "Business Operations", "open",
            to="/operations?tab=Sales", gap="demand", time="operations")
    # g. The funding pack.
    if "materials" in gaps:
        add("pack", "Prepare your funding pack", "A summary and plan are what you send", "Funding pack", "task",
            capability="funding_pack_draft", prefill={"case_id": case_id}, gap="materials", time="pack")
    # (No "Draft a letter to your lender": the sales letter writes to customers, not to a lender, and it stopped asking for
    # a word count. The owner's QA, 21 Oct.)
    # i. Ready: where to apply.
    score = result.get("score")
    from app.modules.readiness import rules as _rules
    if isinstance(score, (int, float)) and score >= _rules.ready_at():      # the one threshold (22 Oct: 75)
        add("options", "See funding options that fit", "You are close to ready to apply", "Funding options", "open", to=f"{case}?tab=research", time="options")

    # Fewer than three: other features that strengthen the case, whatever the chat's first result said (the owner's QA,
    # 21 Oct: "What to do next" was empty, or repeated the steps, when it could point to Simulation, Idea Validation or the
    # Catalogue).
    have = {r["key"] for r in out}
    if len(out) < 3 and "scenario" not in have:
        add("scenario", f"Test a change to your {loan} in Simulation", "See what a bigger or smaller amount does to your cash", "Simulation", "task",
            capability="expansion_scenario", prefill={"amount": amount, "use": use, "currency": cur}, time="scenario")
    if len(out) < 3 and "validation" not in have and not (data.get("validation") or {}).get("result"):
        add("validation", "Check demand with Idea Validation", "A scored check of your market and customers", "Idea Validation", "task",
            capability="idea_validation", prefill={"answers": {k: v for k, v in answers.items() if v not in (None, "")}}, time="validation")
    if len(out) < 3 and not co["customers"]:
        add("customers", "Add your customers", "Named customers back up your demand", "Catalogue", "open", to="/catalogue?tab=customers", time="catalogue")

    # Blockers first; then what moves a funder most, in the owner's order (a price and cost that hold up, a forecast, a plan,
    # proof of demand, recorded sales, the team, the pack, the letter); then free first, then quickest.
    order = ["catalogue", "scenario", "plan", "validation", "operations", "customers", "team", "pack", "letter", "options"]
    out.sort(key=lambda r: (not r["blocker"], order.index(r["key"]), 0 if r["allowed"] and not r["credits"] else 1 if r["allowed"] else 2, r["_minutes"]))
    for r in out:
        r.pop("_minutes", None)
        if session_id:
            r["session_id"] = session_id
    return out[:3]
