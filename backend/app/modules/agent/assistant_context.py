"""What the Assistant tab shows beside the conversation (the owner's mockups, 27 Oct: "exactly like the mockups"): the
business, its revenue over the last 12 months, what the Agent already knows from its records, recent activity, approvals
waiting, and whether "Do all for me" is still working. Read only, from the business's own records; nothing is invented."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from app.modules.agent import business as bz

WORKING_MINUTES = 10      # "Do all for me" still working: shown as in progress for at most this long
STARTED = datetime.now(timezone.utc)      # a run marked before this server started was stopped by the restart
INTERRUPTED = "The research stopped because the server restarted. Please try again."


def _words(v: Any) -> str:
    return " ".join(str(v or "").split())


def business_card(name: str | None, data: dict, now: datetime) -> dict:
    from app.modules.agent import dashboard
    from app.modules.agent.stages import STAGE_LABEL
    p = data.get("workspace_profile") or {}
    stage = dashboard.stage_of(data, now).get("stage")
    place = ", ".join(x for x in (_words(p.get("city")), _words(p.get("country"))) if x)
    out = {"name": _words(p.get("company_name")) or _words(name) or "Your business", "stage": STAGE_LABEL.get(stage) if stage else None,
           "sector": _words(p.get("primary_industry")) or None, "location": place or None,
           "founded": _words(p.get("year_established") or p.get("established")) or None, "employees": _words(p.get("company_size")) or None,
           "logo": p.get("logo_data_url") if str(p.get("logo_data_url") or "").startswith("data:image/") else None,
           # what the profile sheet shows beside the chat (the owner, 27 Oct: "View profile opens the business profile in a sheet")
           "description": _words(p.get("business_description") or p.get("description")) or None, "website": _words(p.get("website")) or None,
           "registration_number": _words(p.get("registration_number")) or None}
    return out


def revenue(data: dict, now: datetime) -> dict:
    """Money received in the last 12 months, month by month, against the 12 months before."""
    from app.modules.agent import research
    # The same reading as the research and the funding check: received, in the workspace's currency
    pays = [(datetime(d.year, d.month, d.day, tzinfo=now.tzinfo), v) for _i, d, v in research.paid_invoices(data, now.date())]
    months = [0.0] * 12
    start = now - timedelta(days=365)
    for t, a in pays:
        if start < t <= now:
            back = (now.year - t.year) * 12 + now.month - t.month
            if 0 <= back < 12:
                months[11 - back] += a
    total = bz.money(sum(a for t, a in pays if start < t <= now))
    prior = bz.money(sum(a for t, a in pays if now - timedelta(days=730) < t <= start))
    from app.modules.agent import figures
    from app.modules.agent.research import task_currency
    f = figures.of(data, now.date())      # the month the simulation and the dashboard use: one figure on all three
    return {"total": total, "pct": round((total - prior) / prior * 100, 1) if prior > 0 else None, "months": [bz.money(m) for m in months],
            "currency": task_currency(data), "has_any": bool(pays), "monthly": f.get("revenue_monthly"), "monthly_months": f.get("revenue_months"),
            # everything ever received, said as such on the card (the owner, 28 Oct: "label it All time")
            "all_time": bz.money(sum(a for _t, a in pays))}


def records_check(data: dict, kind: str) -> list[dict]:
    """What the Agent already knows, by record (the mockups' "Reviewing business information"): each one available or not."""
    p = data.get("workspace_profile") or {}
    cat, fin = data.get("catalogue") or {}, data.get("financials") or {}
    live = lambda rows: [x for x in rows or [] if isinstance(x, dict) and not x.get("archived")]      # noqa: E731
    customers, products = live(cat.get("customers")), live(cat.get("products"))
    invoices, expenses = live(fin.get("invoices")), live(fin.get("expenses"))
    quotes = live(fin.get("quotes") or fin.get("quotations"))
    paid = [i for i in invoices if bz.status_of(i) == "paid" or i.get("payments")]
    priced = [x for x in products if bz.money(x.get("base_price")) > 0]
    filled = sum(1 for k in ("company_name", "primary_industry", "city", "country", "company_size") if _words(p.get(k)))
    rows = [("profile", "Business profile", filled >= 3, f"{filled} of 5 details"),
            ("revenue", "Revenue information", bool(paid), f"{len(paid)} paid invoice{'s' if len(paid) != 1 else ''}"),
            ("customers", "Customer records", bool(customers), f"{len(customers)} customer{'s' if len(customers) != 1 else ''}"),
            ("pricing", "Pricing", bool(priced), f"{len(priced)} priced item{'s' if len(priced) != 1 else ''}"),
            ("costs", "Operating costs", bool(expenses), f"{len(expenses)} expense{'s' if len(expenses) != 1 else ''}"),
            ("sales", "Recent sales activity", bool(invoices or quotes), f"{len(invoices)} invoice{'s' if len(invoices) != 1 else ''}, {len(quotes)} quote{'s' if len(quotes) != 1 else ''}")]
    if kind == "launch":
        rows[1] = ("revenue", "Revenue information", bool(paid), rows[1][3])
    return [{"key": k, "label": label, "available": ok, "detail": detail} for k, label, ok, detail in rows]


def activity(data: dict, now: datetime, limit: int = 5) -> list[dict]:
    """The latest things that happened in the business's own records, newest first."""
    out: list[tuple[datetime, dict]] = []
    fin, cat = data.get("financials") or {}, data.get("catalogue") or {}
    ccy = "GBP"
    try:
        from app.modules.agent.research import task_currency
        ccy = task_currency(data)
    except Exception:      # noqa: BLE001
        pass

    def add(when: Any, kind: str, title: str, detail: str = "") -> None:
        m = bz._moment(when)
        if m and m <= now + timedelta(minutes=5):
            out.append((m, {"kind": kind, "title": title, "detail": detail, "at": m.isoformat()}))
    from app.modules.agent.documents import fmt_money
    for i in fin.get("invoices") or []:
        if not isinstance(i, dict) or i.get("archived"):
            continue
        who = _words(i.get("customer_name"))
        if bz.status_of(i) == "paid":
            add(i.get("paid_at") or i.get("updated_at"), "invoice_paid", "Invoice paid", f"{fmt_money(bz.invoice_total(i), ccy)}{f' from {who}' if who else ''}")
        elif bz.status_of(i) not in ("", "draft"):
            add(i.get("sent_at") or i.get("created_at"), "invoice_sent", "Invoice sent", f"{fmt_money(bz.invoice_total(i), ccy)}{f' to {who}' if who else ''}")
    for q in fin.get("quotes") or fin.get("quotations") or []:
        if isinstance(q, dict) and not q.get("archived") and bz.status_of(q) not in ("", "draft"):
            add(q.get("sent_at") or q.get("created_at"), "quote_sent", "Quotation sent", f"{fmt_money(bz.invoice_total(q), ccy)}{(' to ' + _words(q.get('customer_name'))) if q.get('customer_name') else ''}")
    for c in cat.get("customers") or []:
        if isinstance(c, dict) and not c.get("archived"):
            add(c.get("created_at"), "customer_added", "New customer added", _words(c.get("name")))
    for r in (data.get("research_runs") or {}).values():
        if isinstance(r, dict) and r.get("created_at") and not r.get("error"):
            from app.modules.agent.research import CHECK_NAME
            add(r.get("adopted_at") or r["created_at"], "research", "Research adopted" if r.get("status") == "adopted" else "Research ready to review",
                CHECK_NAME.get(r.get("goal"), ""))
    out.sort(key=lambda x: x[0], reverse=True)
    return [x for _, x in out[:limit]]


def failed(data: dict, case_id: str) -> str | None:
    """Why the last research for this case didn't start or finish, while it is the latest thing that happened to it."""
    w = (data.get("agent_working") or {}).get(str(case_id)) or {}
    m = bz._moment(w.get("at"))
    if not w.get("failed") and m and m < STARTED:
        return INTERRUPTED      # never a card spinning for a run that no longer exists (the owner, 29 Oct)
    return w.get("failed") or None


def working(data: dict, case_id: str, now: datetime) -> bool:
    at = ((data.get("agent_working") or {}).get(str(case_id)) or {}).get("at")
    m = bz._moment(at)
    return bool(m and m >= STARTED and now - m <= timedelta(minutes=WORKING_MINUTES))


async def context(orch, user: dict, business_id: str, kind: str, case_id: str | None = None, name: str | None = None) -> dict:
    from app.modules.agent import research, summary as summary_mod
    import asyncio
    now = orch.rt.clock()
    # The three reads at once, not one after another (the owner, 27 Oct: the idea page "takes about 25 seconds to load")
    loaded, who, pending = await asyncio.gather(orch.rt.business.load(business_id), orch.actor_for(user["id"], business_id, user.get("email")),
                                                summary_mod.pending_approvals(orch.rt.store, business_id, now), return_exceptions=True)
    if isinstance(loaded, BaseException):
        raise loaded
    data = loaded or {}
    can_act = not isinstance(who, BaseException) and bool(who[0].can_send or who[0].can_prepare)      # the router checks access first
    approvals = [summary_mod.approval_card(a, now) for a in pending] if can_act and not isinstance(pending, BaseException) else []
    goal = {"launch": "launch", "idea": "test_idea"}.get(kind, "need_funding")
    from app.modules.agent import converse_idea
    extra = {"risk": converse_idea.concentration(data)}
    if kind == "idea":
        extra["idea"] = idea_card(data)
    return {**extra, "business": business_card(name, data, now), "revenue": revenue(data, now), "records": records_check(data, kind),
            "activity": activity(data, now), "approvals": {"count": len(approvals), "items": [
                {k: a.get(k) for k in ("approval_id", "run_id", "kind", "title", "subtitle", "age")} for a in approvals[:3]]},
            "research": research.research_state(data, goal, case_id=case_id,
                                                  # a launch's last answers may be another plan's: never read as this plan's change
                                                  **({"answers": {}} if kind == "launch" else {})) if case_id else None, "working": working(data, case_id, now) if case_id else False,
            "failed": failed(data, case_id) if case_id else None}


def price_check(data: dict, answers: dict) -> dict | None:
    """The idea's price against the prices its latest research found (the owner, 28 Oct: ₦25,000 against ₦20,000 to ₦20,500
    went unsaid): {"low", "high", "price", "text"} when the price is outside them, else None."""
    import re
    from app.modules.agent import research
    try:
        price = float(str(answers.get("price") or "").replace(",", ""))
    except ValueError:
        return None
    state = research.research_state(data, "test_idea")
    run = (research._runs(data) or {}).get(state.get("run_id")) or {} if state.get("run_id") else {}
    found = []
    for x in run.get("items") or []:
        if x.get("topic") in ("competitors", "competitor_prices", "pricing", "prices") and x.get("value"):
            found += [float(n.replace(",", "")) for n in re.findall(r"[₦£$€]\s?(\d[\d,]*(?:\.\d+)?)", str(x["value"]))]
    if not price or not found:
        return None
    low, high = min(found), max(found)
    if low <= price <= high:
        return None
    ccy = research.task_currency(data)
    m = lambda n: research.money(n, ccy)      # noqa: E731
    where = "above" if price > high else "below"
    return {"low": low, "high": high, "price": price, "text": f"Your price, {m(price)}, is {where} what the research found others charge ({m(low)} to {m(high)})."
            + (" Customers may compare; say what makes yours worth more, or test a lower price." if where == "above" else " You may be able to charge more.")}


def idea_card(data: dict) -> dict:
    """The idea being tested: its answers, its viability result (the engine's), and what is known for each input."""
    from app.modules.agent import converse_idea, first_value
    answers = dict((((data.get("quick_check_answers") or {}).get("test_idea") or {}).get("answers")) or {})
    result = first_value.assess("test_idea", answers, data) if answers else None
    known = lambda *ks: any(str(answers.get(k) or "").strip() for k in ks)      # noqa: E731
    inputs = [{"key": "customer", "label": "Customer profile", "available": known("customer")},
              {"key": "costs", "label": "Costs", "available": known("cost", "fixed_costs")},
              {"key": "capacity", "label": "Capacity", "available": known("capacity")},
              {"key": "price", "label": "Proposed price", "available": known("price")},
              {"key": "demand", "label": "Current demand evidence", "available": str(answers.get("demand") or "") not in ("", "assumption")}]
    # Whether the service is in the catalogue already, by its name (the owner's QA, 27 Oct: the Catalogue tab only had a button to leave)
    from app.modules.agent import answer_memory
    named = answer_memory.norm(answers.get("description"))
    listed = next((p for p in ((data.get("catalogue") or {}).get("products") or []) if isinstance(p, dict) and not p.get("archived")
                   and named and answer_memory.norm(p.get("name")) == named), None)
    return {"answers": answers, "inputs": inputs, **converse_idea.view(answers, result), "price_check": price_check(data, answers),
            "criteria": (result or {}).get("criteria") or [], "currency_sign": (result or {}).get("currency_sign"),
            "catalogue": {"listed": bool(listed), "name": (listed or {}).get("name"), "price": (listed or {}).get("base_price")}}
