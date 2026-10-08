"""Readiness reports and preparation documents (Funding PRD s9, Launch PRD s10).

Everything here is assembled from one assessment snapshot: the facts as they were when the
check ran. Nothing is written by a language model. A fact that isn't in the snapshot appears
as a named gap; clients, traction, approvals, market figures and commitments are never made up.
Forecast figures are labelled as forecasts wherever they appear.
"""
from __future__ import annotations

import io
from typing import Any

from app.modules.readiness import engine, rules
from app.modules.readiness import forecast as fc

KINDS = {
    rules.FUNDING: {"readiness_report": "Funding readiness report", "executive_summary": "Executive summary draft", "pitch_outline": "Pitch content outline"},
    rules.LAUNCH: {"readiness_report": "Launch readiness report", "launch_checklist": "Launch checklist"},
}
STATE_WORD = {"passed": "In place", "failed": "Not in place", "unknown": "Not known yet"}
STATE_MARK = {"passed": "[x]", "failed": "[ ]", "unknown": "[?]"}
CLASS_WORD = {"ready": "Ready", "conditionally_ready": "Conditionally ready", "not_ready": "Not ready", "insufficient_evidence": "Insufficient evidence"}


def _gap(text: str) -> str:
    return f"Gap: {text}"


def _money(cur: str | None, value: Any) -> str | None:
    try:
        d = fc.dec(value)
    except fc.Invalid:
        return None
    return None if d is None else f"{cur or ''} {d:,.2f}".strip()


def _section(heading: str, paragraphs: list[str] | None = None, items: list[dict] | None = None, gaps: list[str] | None = None, sources: list[str] | None = None) -> dict:
    return {"heading": heading, "paragraphs": [p for p in paragraphs or [] if p], "items": items or [], "gaps": gaps or [], "sources": sources or []}


def _item(label: str, value: Any, note: str | None = None) -> dict:
    return {"label": label, "value": "" if value is None else str(value), "note": note}


def _summary_section(result: dict, run_data: dict) -> dict:
    score = f"{result['score_display']} out of 100" if result.get("score_display") is not None else "Not available: some evidence is missing"
    basis = (result.get("data_basis") or {}).get("label")
    return _section("Result", [result["headline"], result["disclaimer"]], [
        _item("Classification", CLASS_WORD[result["classification"]]),
        _item("Preparation score", score),
        _item("Evidence coverage", f"{result['coverage']}% of the checklist by weight"),
        _item("Blocker checks known", f"{result['gate_completeness']}%"),
        _item("Confidence", result["confidence"]["level"].capitalize(), " ".join(result["confidence"]["reasons"])),
        _item("Assessed on", run_data.get("as_of")),
        _item("Checklist", f"{result['profile_title']} (version {result['ruleset_version']})"),
        _item("Data basis", (basis or "not available").capitalize(), (result.get("data_basis") or {}).get("note")),
    ])


def _criteria_sections(result: dict) -> list[dict]:
    gates = _section("Blockers" if result["subject_type"] == rules.LAUNCH else "Gates", [
        "These are checked separately from the score. A confirmed failure means not ready, whatever the score."],
        [_item(f"{g['code']} {g['label']}", STATE_WORD[g["state"]], g.get("reason")) for g in result["gates"]])
    criteria = _section("Checklist results", items=[
        _item(f"{c['code']} {c['title']} (weight {c['weight']}): {ch['label']}", STATE_WORD[ch["state"]], ch.get("reason"))
        for c in result["criteria"] for ch in c["checks"]])
    return [gates, criteria]


def _cash_section(result: dict, cur: str | None) -> dict:
    m = result["metrics"]
    f = m["forecast"]
    if f["state"] != "complete":
        return _section("Cash (forecast)", gaps=[_gap("the monthly cash forecast is not complete, so no cash figures are shown.")])
    items = [_item("Lowest baseline cash (forecast)", _money(cur, (m.get("baseline_min_cash") or {}).get("amount")), fc.month_label((m.get("baseline_min_cash") or {}).get("month"))),
             _item("First month below zero (forecast)", fc.month_label(m.get("first_negative_month")) or "None in the forecast")]
    if "funded_min_cash" in m:
        items.append(_item("Lowest cash with the proposed funding (forecast)", _money(cur, (m.get("funded_min_cash") or {}).get("amount")) or "Not available",
                           fc.month_label((m.get("funded_min_cash") or {}).get("month"))))
        gap = m.get("funding_timing_gap")
        if gap and gap.get("exists"):
            items.append(_item("Funding timing gap", f"{gap['months']} month{'s' if gap['months'] != 1 else ''}", gap["text"]))
    if "cash_at_launch" in m:
        items.append(_item("Cash at launch (forecast)", _money(cur, m.get("cash_at_launch")) or "Not available", fc.month_label(m.get("launch_month"))))
    return _section("Cash (forecast)", [fc.MONTHLY_LABEL, "The baseline excludes any funding that is proposed but not committed."], items)


def _common_tail(result: dict, actions: list[dict]) -> list[dict]:
    return [
        _section("Business risks", ["Shown separately from preparation: a well-prepared case can still carry commercial risk."],
                 [_item(r["severity"].capitalize(), r["text"]) for r in result.get("risks") or []] or [_item("None found", "No commercial risk was found from the figures provided")]),
        _section("Next actions", ["In priority order. Completing an action does not change the result: run the check again."],
                 [_item(a.get("title") or "", (a.get("status") or "open").replace("_", " "), a.get("why")) for a in actions[:20]] or [_item("None", "No open actions")]),
        _section("Evidence and sources", items=[
            _item(e.get("title") or "Evidence", f"{rules.EVIDENCE_TYPES.get(e.get('type'), 'Evidence')}, dated {e.get('effective_date')}",
                  f"{rules.VERIFICATION.get(e.get('verification') or 'unverified')}" + (f"; strength: {e['strength']}" if e.get("strength") else ""))
            for e in result.get("evidence_used") or []] or [_item("None", "No evidence items were attached")]),
        _section("Method and limitations", [result["status_note"], *result.get("limitations", []),
                                           "Each check is passed, failed or unknown. Two passed checks score 100, one 50, none 0; an unknown check leaves the criterion unknown. "
                                           "The score is the weighted sum and is shown only when every criterion is known."]),
    ]


def readiness_report(subject: dict, run: dict, actions: list[dict]) -> dict:
    result = run["data"]["result"]
    snap = run["data"]["snapshot"]
    s = snap["subject"]
    cur = s.get("currency") or (snap.get("forecast") or {}).get("currency") or snap["business"].get("currency")
    if result["subject_type"] == rules.FUNDING:
        about = _section("Funding case", items=[
            _item("Business", snap["business"].get("name") or ""), _item("Case", s.get("title")), _item("Route", str(s.get("route") or "").capitalize()),
            _item("Target", _money(s.get("currency"), s.get("target_amount")) or "Not set"), _item("Intended receipt", s.get("receipt_date") or "Not set")])
    else:
        about = _section("Launch", items=[
            _item("Business", snap["business"].get("name") or ""), _item("Launch", s.get("name")),
            _item("Type", "First launch" if s.get("launch_type") == "initial_business" else "New service"),
            _item("Scope", str(s.get("scope") or "").capitalize()), _item("Target date", s.get("target_date") or "Not set"),
            _item("Where", s.get("geography") or "Not set")])
    return {"title": KINDS[result["subject_type"]]["readiness_report"], "subtitle": s.get("title") or s.get("name"),
            "sections": [about, _summary_section(result, run["data"]), *_criteria_sections(result), _cash_section(result, cur), *_common_tail(result, actions)]}


def _use_of_funds(s: dict) -> tuple[list[dict], list[str]]:
    items = [_item(a.get("category") or "Allocation", _money(s.get("currency"), a.get("amount")) or "No amount",
                   " · ".join(x for x in (fc.month_label(a.get("period")), a.get("purpose") or a.get("rationale")) if x))
             for a in s.get("use_of_funds") or [] if isinstance(a, dict)]
    return items, ([] if items else [_gap("no use-of-funds allocations are recorded.")])


def executive_summary(subject: dict, run: dict, actions: list[dict]) -> dict:
    result = run["data"]["result"]
    snap = run["data"]["snapshot"]
    s = snap["subject"]
    cur = s.get("currency")
    get = lambda p: engine.get(s, p)
    sections = []
    target = _money(cur, s.get("target_amount"))
    sections.append(_section("The ask", [
        f"{snap['business'].get('name') or 'The business'} is seeking {target}" + (f", expected {s['receipt_date']}." if s.get("receipt_date") else ".") if target else "",
        s.get("purpose") or ""],
        gaps=[g for g, missing in ((_gap("the funding target is not set."), not target), (_gap("the purpose of the funding is not stated."), engine.blank(s.get("purpose"))),
                                   (_gap("the intended receipt date is not set."), engine.blank(s.get("receipt_date")))) if missing]))
    sections.append(_section("Customer and market", [get("market.target_segment") or "", get("market.differentiation") or "", get("market.acquisition_approach") or ""],
                             gaps=[g for g, missing in ((_gap("the target customer is not described."), engine.blank(get("market.target_segment"))),
                                                        (_gap("what sets the business apart is not described."), engine.blank(get("market.differentiation"))),
                                                        (_gap("how customers will be won is not described."), engine.blank(get("market.acquisition_approach")))) if missing]))
    used = result.get("evidence_used") or []
    sections.append(_section("Traction", [get("traction.summary") or "", "Not trading yet: there is no trading history." if s.get("stage") != "trading" else ""],
                             [_item(e.get("title") or "Evidence", f"{rules.EVIDENCE_TYPES.get(e.get('type'), 'Evidence')}, dated {e.get('effective_date')}",
                                    rules.VERIFICATION.get(e.get("verification") or "unverified")) for e in used],
                             gaps=[] if used else [_gap("no customer or market evidence is attached. No customers or traction are claimed.")],
                             sources=[e.get("title") or "" for e in used]))
    econ = result["metrics"]["economics"]
    sections.append(_section("Business model", items=[
        _item("Price per sale", _money(cur, get("economics.price")) or ""), _item("Direct cost per sale", _money(cur, get("economics.direct_cost")) or ""),
        _item("Fixed costs each month", _money(cur, get("economics.fixed_costs_monthly")) or ""),
        _item("Contribution per sale", _money(cur, econ.get("contribution_per_sale")) or ""),
        _item("Monthly break-even sales", econ.get("break_even_sales_per_month") or "Not reachable at this price and cost")] if econ["state"] == "available" else [],
        gaps=[] if econ["state"] == "available" else [_gap("price and costs are not all entered.")]))
    funds, gaps = _use_of_funds(s)
    sections.append(_section("Use of funds", items=funds, gaps=gaps + [_gap(g["reason"]) for g in result["gates"] if g["code"] == "G2" and g["state"] == "failed"]))
    sections.append(_section("Milestones", items=[_item(m.get("outcome") or "Milestone", f"{m.get('measure') or 'no measure'}: {m.get('baseline') or '?'} to {m.get('target') or '?'}",
                                                        f"Due {m.get('due_date') or 'not set'}; owner {m.get('owner') or 'not set'}")
                                                  for m in s.get("milestones") or [] if isinstance(m, dict)],
                             gaps=[] if s.get("milestones") else [_gap("no milestones are recorded.")]))
    sections.append(_cash_section(result, cur))
    people = [p for p in get("team.responsibilities") or [] if isinstance(p, dict)]
    sections.append(_section("Team", ["This describes who does what. It is not a legal verification of ownership."],
                             [_item(p.get("area") or "", p.get("owner") or "No owner named") for p in people], gaps=[] if people else [_gap("no team responsibilities are recorded.")]))
    risks = [x for x in s.get("risks") or [] if isinstance(x, dict)]
    sections.append(_section("Risks", items=[_item(x.get("risk") or "", x.get("action") or "No action recorded") for x in risks],
                             gaps=[] if risks or s.get("no_known_risks") else [_gap("known risks are not recorded.")]))
    return {"title": KINDS[rules.FUNDING]["executive_summary"], "subtitle": s.get("title"), "sections": sections}


def pitch_outline(subject: dict, run: dict, actions: list[dict]) -> dict:
    summary = executive_summary(subject, run, actions)
    by = {sec["heading"]: sec for sec in summary["sections"]}
    order = [("1. Customer and problem", "Customer and market"), ("2. Traction", "Traction"), ("3. Business model", "Business model"),
             ("4. Financial forecast", "Cash (forecast)"), ("5. The ask", "The ask"), ("6. Use of funds", "Use of funds"),
             ("7. Milestones", "Milestones"), ("8. Team", "Team"), ("9. Risks and how they are handled", "Risks")]
    return {"title": KINDS[rules.FUNDING]["pitch_outline"], "subtitle": summary["subtitle"],
            "sections": [{**by[src], "heading": slide} for slide, src in order]}


def launch_checklist(subject: dict, run: dict, actions: list[dict]) -> dict:
    result = run["data"]["result"]
    s = run["data"]["snapshot"]["subject"]
    sections = [_section("Launch", items=[_item("Launch", s.get("name")), _item("Target date", s.get("target_date") or "Not set"),
                                          _item("Result when checked", CLASS_WORD[result["classification"]], f"Checked on {run['data'].get('as_of')}")])]
    sections.append(_section("Blockers", items=[_item(f"{STATE_MARK[g['state']]} {g['label']}", STATE_WORD[g["state"]], g.get("reason")) for g in result["gates"]]))
    for c in result["criteria"]:
        sections.append(_section(f"{c['code']} {c['title']}", items=[_item(f"{STATE_MARK[ch['state']]} {ch['label']}", STATE_WORD[ch["state"]], ch.get("reason")) for ch in c["checks"]]))
    prereqs = [p for p in s.get("prerequisites") or [] if isinstance(p, dict)]
    sections.append(_section("Prerequisites you recorded", ["This list is the one you recorded. It is not a complete list of legal requirements."],
                             [_item(f"{'[x]' if p.get('status') == 'completed' else '[ ]'} {p.get('name') or ''}",
                                    "Does not apply" if p.get("applicable") in (False, "no") else (p.get("status") or "not set").replace("_", " "),
                                    " · ".join(x for x in (f"required by {p['required_by']}" if p.get("required_by") else "", f"valid until {p['valid_until']}" if p.get("valid_until") else "",
                                                           p.get("rationale") or "") if x)) for p in prereqs] or [_item("None recorded", "")]))
    miles = [m for m in engine.get(s, "control.milestones") or [] if isinstance(m, dict)]
    sections.append(_section("Milestones", items=[_item(f"{'[x]' if m.get('status') == 'done' else '[ ]'} {m.get('outcome') or ''}", m.get("due_date") or "Date not set",
                                                        f"Owner: {m.get('owner') or 'not set'}") for m in miles] or [_item("None recorded", "")]))
    sections.append(_section("Next actions", items=[_item(f"[ ] {a.get('title') or ''}", a.get("due_date") or "Date not set", a.get("why")) for a in actions[:30]] or [_item("None", "")]))
    return {"title": KINDS[rules.LAUNCH]["launch_checklist"], "subtitle": s.get("name"), "sections": sections}


BUILDERS = {"readiness_report": readiness_report, "executive_summary": executive_summary, "pitch_outline": pitch_outline, "launch_checklist": launch_checklist}


def build(kind: str, subject: dict, run: dict, actions: list[dict]) -> dict:
    content = BUILDERS[kind](subject, run, actions)
    try:
        checklist = rules.get_profile(run["data"].get("profile"))
        name = f"{checklist['title']}, version {checklist['version']}"
    except rules.UnsupportedProfile:
        name = "an earlier version"
    content["footer"] = (f"Prepared from the check of {run['data'].get('as_of')} using the checklist {name}. "
                         "Figures are as they were on that date.")
    return content


def to_text(content: dict) -> str:
    lines = [content["title"]]
    if content.get("subtitle"):
        lines.append(str(content["subtitle"]))
    for sec in content["sections"]:
        lines += ["", sec["heading"].upper()]
        lines += sec["paragraphs"]
        for it in sec["items"]:
            line = f"- {it['label']}" + (f": {it['value']}" if it["value"] else "")
            lines.append(line + (f" ({it['note']})" if it.get("note") else ""))
        lines += sec["gaps"]
    lines += ["", content.get("footer") or ""]
    return "\n".join(lines).strip() + "\n"


def to_pdf(content: dict, body: str | None = None) -> bytes:
    """The document as a PDF. With `body`, the user's edited text is printed instead of the sections."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    from xml.sax.saxutils import escape

    ink, muted, line, brand = (colors.HexColor(c) for c in ("#0f172a", "#64748b", "#e2e8f0", "#4f46e5"))

    def st(size=10, bold=False, color=ink):
        return ParagraphStyle("s", fontName="Helvetica-Bold" if bold else "Helvetica", fontSize=size, leading=size * 1.4, textColor=color)

    def para(text: Any, style) -> Paragraph:
        return Paragraph(escape(str(text or "")).replace("\n", "<br/>"), style)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm, title=content["title"])
    flow: list = [para(content["title"], st(18, True)), para(content.get("subtitle") or "", st(11, False, muted)), Spacer(1, 6 * mm)]
    if body:
        for block in body.split("\n"):
            flow.append(para(block, st(10)) if block.strip() else Spacer(1, 2 * mm))
    else:
        for sec in content["sections"]:
            flow += [para(sec["heading"], st(12, True, brand)), Spacer(1, 1.5 * mm)]
            for p in sec["paragraphs"]:
                flow += [para(p, st(9.5)), Spacer(1, 1 * mm)]
            if sec["items"]:
                rows = [[para(it["label"], st(9)), [para(it["value"], st(9, True))] + ([para(it["note"], st(8, False, muted))] if it.get("note") else [])] for it in sec["items"]]
                table = Table(rows, colWidths=[82 * mm, 92 * mm])
                table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.4, line),
                                           ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
                flow.append(table)
            for g in sec["gaps"]:
                flow.append(para(g, st(9.5, True, colors.HexColor("#b45309"))))
            flow.append(Spacer(1, 5 * mm))
    flow.append(para(content.get("footer") or "", st(8, False, muted)))
    doc.build(flow)
    return buf.getvalue()
