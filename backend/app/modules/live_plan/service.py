from __future__ import annotations

import copy
import json
import re
from datetime import datetime, timezone
from typing import Any, Iterable
from uuid import uuid4

from app.core.supabase import sb_insert, sb_select, sb_update, sb_upsert

DEFAULT_SECTION_ORDER = [
    ("executive_summary", "Executive Summary", "STRATEGIC"),
    ("business_overview", "Business Overview", "STRATEGIC"),
    ("products_services", "Products & Services", "COMMERCIAL"),
    ("market_analysis", "Market Analysis", "MARKET"),
    ("competitive_analysis", "Competitive Analysis", "MARKET"),
    ("business_model", "Business Model", "COMMERCIAL"),
    ("marketing_sales_strategy", "Marketing & Sales Strategy", "COMMERCIAL"),
    ("operations_plan", "Operations Plan", "OPERATIONAL"),
    ("management_organisation", "Management & Organisation", "OPERATIONAL"),
    ("financial_snapshot", "Financial Snapshot", "FINANCIAL"),
    ("funding_requirements", "Funding Requirements", "FINANCIAL"),
    ("risk_analysis_mitigation", "Risk Analysis & Mitigation", "STRATEGIC"),
    ("conclusion", "Conclusion", "STRATEGIC"),
]

DEFAULT_KPIS = [
    ("monthly_revenue_target", "Monthly Revenue Target", "FINANCIAL", "up", "currency"),
    ("gross_margin_target_pct", "Gross Margin Target", "FINANCIAL", "up", "percent"),
    ("cash_runway_months", "Cash Runway", "FINANCIAL", "up", "months"),
    ("active_customers_target", "Active Customers", "CUSTOMER", "up", "count"),
    ("on_time_delivery_pct", "On-Time Delivery", "OPERATIONAL", "up", "percent"),
]

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _clean(doc: dict[str, Any] | None) -> dict[str, Any] | None:
    if not doc:
        return doc
    d = dict(doc)
    d.pop("_id", None)
    return d


def _clean_many(docs: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    return [_clean(doc) for doc in (docs or []) if doc]


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.strip().lower())
    slug = re.sub(r"_+", "_", slug).strip("_")
    return slug or "section"


def _strip_markdown_heading(line: str) -> str | None:
    value = line.strip()
    if not value.startswith("##"):
        return None
    value = value.lstrip("#").strip()
    return value or None


def _extract_section_headings(markdown: str | None) -> list[tuple[str, str]]:
    headings: list[tuple[str, str]] = []
    for line in str(markdown or "").splitlines():
        heading = _strip_markdown_heading(line)
        if heading:
            headings.append((_slugify(heading), heading))
    seen: set[str] = set()
    unique: list[tuple[str, str]] = []
    for slug, title in headings:
        if slug in seen:
            continue
        seen.add(slug)
        unique.append((slug, title))
    return unique


def _extract_first_number(markdown: str | None, keywords: Iterable[str]) -> float | None:
    text = str(markdown or "").lower()
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines:
        if not any(keyword in line for keyword in keywords):
            continue
        match = re.search(r"([-+]?\d[\d,]*(?:\.\d+)?)", line)
        if match:
            try:
                return float(match.group(1).replace(",", ""))
            except ValueError:
                continue
    return None


def _json_copy(value: Any) -> Any:
    return copy.deepcopy(value)


def _value_to_number(value: Any) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.replace(",", "").strip())
        except ValueError:
            return None
    if isinstance(value, dict):
        for key in ("value", "amount", "target", "actual", "observed", "score"):
            if key in value:
                nested = _value_to_number(value.get(key))
                if nested is not None:
                    return nested
    return None


def _variance_status(pct: float | None, tolerance: float | None) -> tuple[str, str]:
    if pct is None:
        return "unknown", "low"
    abs_pct = abs(pct)
    tol = abs(tolerance or 0.0)
    if abs_pct <= tol:
        return "on_track", "low"
    if abs_pct <= max(5.0, tol * 2 or 5.0):
        return "watch", "medium"
    return "off_track", "high"


async def _safe_select(table: str, **kwargs):
    try:
        return await sb_select(table, **kwargs)
    except Exception:
        return None


async def _safe_insert(table: str, payload: Any):
    try:
        return await sb_insert(table, payload)
    except Exception:
        return None


async def _safe_update(table: str, *, payload: dict[str, Any], filters: list[tuple[str, str, Any]]):
    try:
        return await sb_update(table, payload=payload, filters=filters)
    except Exception:
        return None


async def _safe_upsert(table: str, *, payload: dict[str, Any], on_conflict: str | None = None):
    try:
        return await sb_upsert(table, payload=payload, on_conflict=on_conflict)
    except Exception:
        return None


async def _load_workspace(user_id: str, business_id: str) -> dict[str, Any] | None:
    ws = await _safe_select(
        "workspaces",
        filters=[("id", "eq", business_id), ("user_id", "eq", user_id)],
        single=True,
    )
    if ws:
        return _clean(ws)
    ws = await _safe_select(
        "workspaces",
        filters=[("id", "eq", business_id)],
        single=True,
    )
    return _clean(ws)


async def _load_blueprint_document(user_id: str, business_id: str) -> dict[str, Any] | None:
    doc = await _safe_select(
        "blueprint_documents",
        filters=[("user_id", "eq", user_id), ("workspace_id", "eq", business_id), ("type", "eq", "business_plan")],
        order="updated_at",
        desc=True,
        limit=1,
    )
    if isinstance(doc, list) and doc:
        return _clean(doc[0])
    return None


async def _get_live_plan_record(user_id: str, business_id: str) -> dict[str, Any] | None:
    doc = await _safe_select(
        "live_business_plans",
        filters=[("user_id", "eq", user_id), ("business_id", "eq", business_id)],
        single=True,
    )
    return _clean(doc)


async def _get_versions(live_plan_id: str) -> list[dict[str, Any]]:
    data = await _safe_select(
        "live_plan_versions",
        filters=[("live_plan_id", "eq", live_plan_id)],
        order="version_number",
        desc=False,
    )
    return _clean_many(data)


async def _get_current_version(plan: dict[str, Any]) -> dict[str, Any] | None:
    version_id = plan.get("current_version_id")
    if not version_id:
        return None
    version = await _safe_select("live_plan_versions", filters=[("id", "eq", version_id)], single=True)
    return _clean(version)


async def _load_version_bundle(live_plan_id: str, version_id: str) -> dict[str, Any]:
    version = await _safe_select("live_plan_versions", filters=[("id", "eq", version_id), ("live_plan_id", "eq", live_plan_id)], single=True)
    if not version:
        raise ValueError("VERSION_NOT_FOUND")
    assumptions = await _safe_select(
        "live_plan_assumptions",
        filters=[("live_plan_id", "eq", live_plan_id), ("live_plan_version_id", "eq", version_id)],
        order="created_at",
        desc=False,
    )
    changes = await _safe_select(
        "planned_entity_changes",
        filters=[("live_plan_id", "eq", live_plan_id), ("live_plan_version_id", "eq", version_id)],
        order="created_at",
        desc=False,
    )
    kpis = await _safe_select(
        "plan_kpis",
        filters=[("live_plan_id", "eq", live_plan_id), ("live_plan_version_id", "eq", version_id)],
        order="code",
        desc=False,
    )
    observations = await _safe_select(
        "kpi_observations",
        filters=[("live_plan_id", "eq", live_plan_id), ("live_plan_version_id", "eq", version_id)],
        order="observed_at",
        desc=False,
    )
    variances = await _safe_select(
        "plan_variances",
        filters=[("live_plan_id", "eq", live_plan_id), ("live_plan_version_id", "eq", version_id)],
        order="detected_at",
        desc=True,
    )
    alerts = await _safe_select(
        "live_plan_alerts",
        filters=[("live_plan_id", "eq", live_plan_id), ("live_plan_version_id", "eq", version_id)],
        order="created_at",
        desc=True,
    )
    return {
        "version": _clean(version),
        "assumptions": _clean_many(assumptions),
        "changes": _clean_many(changes),
        "kpis": _clean_many(kpis),
        "observations": _clean_many(observations),
        "variances": _clean_many(variances),
        "alerts": _clean_many(alerts),
    }


def _section_seed_rows(markdown: str | None) -> list[dict[str, Any]]:
    headings = _extract_section_headings(markdown)
    if not headings:
        headings = [(slug, title) for slug, title, _domain in DEFAULT_SECTION_ORDER]
    rows: list[dict[str, Any]] = []
    for index, (slug, title) in enumerate(headings):
        domain = next((domain for _slug, section_title, domain in DEFAULT_SECTION_ORDER if _slug == slug or section_title.lower() == title.lower()), "STRATEGIC")
        rows.append(
            {
                "domain": domain,
                "entity_type": "section",
                "entity_id": slug,
                "operation": "CREATE" if index == 0 else "UPDATE",
                "field_name": "narrative",
                "planned_value_json": {"section_title": title, "section_key": slug},
                "status": "PLANNED",
                "notes": "Seeded from blueprint document" if index == 0 else None,
            }
        )
    return rows


def _initial_assumption_rows(doc: dict[str, Any] | None, workspace: dict[str, Any] | None, markdown: str | None) -> list[dict[str, Any]]:
    company_name = (doc or {}).get("company_name") or (workspace or {}).get("name") or "Business"
    industry = (doc or {}).get("industry") or (workspace or {}).get("industry") or "General"
    pricing_model = (doc or {}).get("pricing_model") or "Not specified"
    target_market = _extract_first_number(markdown, ("market", "customer", "target")) or None
    return [
        {
            "domain": "STRATEGIC",
            "entity_type": "business",
            "entity_id": company_name,
            "metric_code": "business_name",
            "assumption_name": "Business name",
            "assumption_value_json": company_name,
            "baseline_value_json": None,
            "target_value_json": company_name,
            "source_type": "IMPORTED_PLAN" if doc else "GENERATED_PLAN",
            "source_reference_id": (doc or {}).get("id"),
            "confidence_score": 1.0,
            "notes": f"Seeded for {company_name}",
        },
        {
            "domain": "MARKET",
            "entity_type": "business",
            "entity_id": company_name,
            "metric_code": "industry",
            "assumption_name": "Primary industry",
            "assumption_value_json": industry,
            "target_value_json": industry,
            "source_type": "IMPORTED_PLAN" if doc else "GENERATED_PLAN",
            "source_reference_id": (doc or {}).get("id"),
            "confidence_score": 0.9,
        },
        {
            "domain": "COMMERCIAL",
            "entity_type": "business",
            "entity_id": company_name,
            "metric_code": "pricing_model",
            "assumption_name": "Pricing model",
            "assumption_value_json": pricing_model,
            "target_value_json": pricing_model,
            "source_type": "IMPORTED_PLAN" if doc else "GENERATED_PLAN",
            "source_reference_id": (doc or {}).get("id"),
            "confidence_score": 0.8,
        },
        {
            "domain": "FINANCIAL",
            "entity_type": "business",
            "entity_id": company_name,
            "metric_code": "target_market_reference",
            "assumption_name": "Target market reference",
            "assumption_value_json": target_market,
            "baseline_value_json": None,
            "target_value_json": target_market,
            "source_type": "IMPORTED_PLAN" if doc else "GENERATED_PLAN",
            "source_reference_id": (doc or {}).get("id"),
            "confidence_score": 0.5,
        },
    ]


def _initial_kpi_rows(doc: dict[str, Any] | None, markdown: str | None) -> list[dict[str, Any]]:
    revenue = _extract_first_number(markdown, ("revenue", "turnover", "sales", "monthly revenue")) or 0.0
    gross_margin = _extract_first_number(markdown, ("gross margin", "margin")) or 0.0
    runway = _extract_first_number(markdown, ("runway", "cash runway")) or 3.0
    customers = _extract_first_number(markdown, ("customers", "clients")) or 0.0
    delivery = _extract_first_number(markdown, ("delivery", "on-time")) or 95.0
    mapping = [
        ("monthly_revenue_target", revenue, {"tolerance_pct": 10}, "currency"),
        ("gross_margin_target_pct", gross_margin, {"tolerance_pct": 5}, "percent"),
        ("cash_runway_months", runway, {"tolerance_months": 1}, "months"),
        ("active_customers_target", customers, {"tolerance_pct": 15}, "count"),
        ("on_time_delivery_pct", delivery, {"tolerance_pct": 5}, "percent"),
    ]
    rows: list[dict[str, Any]] = []
    for code, target, tolerance, unit in mapping:
        domain = next((domain for metric_code, _name, domain, _direction, _unit in DEFAULT_KPIS if metric_code == code), "STRATEGIC")
        name = next((name for metric_code, name, _domain, _direction, _unit in DEFAULT_KPIS if metric_code == code), code.replace("_", " ").title())
        direction = next((direction for metric_code, _name, _domain, direction, _unit in DEFAULT_KPIS if metric_code == code), "up")
        rows.append(
            {
                "code": code,
                "name": name,
                "domain": domain,
                "metric_path": code,
                "target_value_json": target,
                "tolerance_json": tolerance,
                "unit": unit,
                "direction": direction,
                "status": "PLANNED",
                "source_type": "IMPORTED_PLAN" if doc else "GENERATED_PLAN",
                "source_reference_id": (doc or {}).get("id"),
            }
        )
    return rows


def _initial_change_rows(doc: dict[str, Any] | None, markdown: str | None) -> list[dict[str, Any]]:
    return _section_seed_rows(markdown)


def _assemble_narrative(plan: dict[str, Any], version: dict[str, Any], kpis: list[dict[str, Any]], variances: list[dict[str, Any]], alerts: list[dict[str, Any]]) -> tuple[str, dict[str, Any]]:
    current_version = version.get("version_number")
    title = plan.get("business_id") or "Business"
    sections: list[str] = []
    sections.append(f"# Live Business Plan — {title}")
    sections.append("")
    sections.append(f"Status: **{plan.get('status', 'DRAFT')}**")
    sections.append(f"Current version: **v{current_version}**")
    sections.append("")
    sections.append("## Planned KPIs")
    if kpis:
        for kpi in kpis[:12]:
            target = kpi.get("target_value_json")
            actual = kpi.get("actual_value_json")
            sections.append(f"- **{kpi.get('name', kpi.get('code'))}** target: {json.dumps(target, default=str)} | actual: {json.dumps(actual, default=str)}")
    else:
        sections.append("- No KPIs seeded yet.")
    sections.append("")
    sections.append("## Variance Summary")
    if variances:
        for variance in variances[:12]:
            sections.append(
                f"- {variance.get('code')}: {variance.get('status')} ({variance.get('severity')}) "
                f"variance={json.dumps(variance.get('variance_value_json'), default=str)}"
            )
    else:
        sections.append("- No variances recorded yet.")
    sections.append("")
    sections.append("## Alerts")
    if alerts:
        for alert in alerts[:12]:
            sections.append(f"- {alert.get('title')} [{alert.get('severity')}] - {alert.get('status')}")
    else:
        sections.append("- No alerts at this time.")
    narrative = "\n".join(sections).strip()
    meta = {
        "version_number": current_version,
        "kpi_count": len(kpis),
        "variance_count": len(variances),
        "alert_count": len(alerts),
    }
    return narrative, meta


async def _sync_variances_and_alerts(
    *,
    live_plan: dict[str, Any],
    version_id: str,
) -> None:
    plan_id = live_plan["id"]
    kpis = await _safe_select(
        "plan_kpis",
        filters=[("live_plan_id", "eq", plan_id), ("live_plan_version_id", "eq", version_id)],
        order="code",
        desc=False,
    ) or []
    latest_observations = await _safe_select(
        "kpi_observations",
        filters=[("live_plan_id", "eq", plan_id), ("live_plan_version_id", "eq", version_id)],
        order="observed_at",
        desc=False,
    ) or []
    obs_by_code: dict[str, dict[str, Any]] = {}
    for obs in latest_observations:
        code = obs.get("code")
        if code:
            obs_by_code[code] = obs

    for kpi in kpis:
        code = kpi.get("code")
        target = kpi.get("target_value_json")
        obs = obs_by_code.get(code or "")
        if not code or obs is None:
            continue
        actual = obs.get("value_json")
        target_num = _value_to_number(target)
        actual_num = _value_to_number(actual)
        variance_value: Any = None
        variance_pct: float | None = None
        if target_num is not None and actual_num is not None:
            variance_value = actual_num - target_num
            variance_pct = (variance_value / target_num * 100.0) if target_num not in (None, 0) else None
        elif actual is not None:
            variance_value = {"target": target, "actual": actual}
        tolerance_json = kpi.get("tolerance_json") or {}
        tolerance = None
        if isinstance(tolerance_json, dict):
            tolerance = (
                tolerance_json.get("tolerance_pct")
                or tolerance_json.get("pct")
                or tolerance_json.get("percentage")
                or tolerance_json.get("threshold_pct")
            )
        status, severity = _variance_status(variance_pct, float(tolerance) if tolerance is not None else None)
        narrative = None
        if status == "on_track":
            narrative = f"{kpi.get('name', code)} is within target."
        elif status == "watch":
            narrative = f"{kpi.get('name', code)} is drifting from target."
        elif status == "off_track":
            narrative = f"{kpi.get('name', code)} is materially off target."
        await _safe_upsert(
            "plan_variances",
            on_conflict="live_plan_version_id,plan_kpi_id,observed_at",
            payload={
                "id": str(uuid4()),
                "live_plan_id": plan_id,
                "live_plan_version_id": version_id,
                "plan_kpi_id": kpi.get("id"),
                "code": code,
                "observed_at": obs.get("observed_at"),
                "target_value_json": target,
                "actual_value_json": actual,
                "variance_value_json": variance_value,
                "variance_pct": variance_pct,
                "status": status,
                "severity": severity,
                "narrative": narrative,
                "updated_at": _now_iso(),
                "detected_at": _now_iso(),
            },
        )
        if status in {"watch", "off_track"}:
            await _safe_upsert(
                "live_plan_alerts",
                on_conflict="live_plan_version_id,alert_type,plan_kpi_id,plan_variance_id",
                payload={
                    "id": str(uuid4()),
                    "live_plan_id": plan_id,
                    "live_plan_version_id": version_id,
                    "plan_kpi_id": kpi.get("id"),
                    "plan_variance_id": None,
                    "alert_type": "kpi_variance",
                    "severity": severity,
                    "title": f"{kpi.get('name', code)} variance",
                    "description": narrative or f"{code} is off target.",
                    "status": "OPEN",
                    "updated_at": _now_iso(),
                },
            )


async def ensure_live_plan(*, user_id: str, business_id: str, source_document_id: str | None = None) -> dict[str, Any]:
    plan = await _get_live_plan_record(user_id, business_id)
    if plan:
        if not plan.get("current_version_id"):
            version_rows = await _get_versions(plan["id"])
            if version_rows:
                await _safe_update(
                    "live_business_plans",
                    payload={"current_version_id": version_rows[-1]["id"], "updated_at": _now_iso()},
                    filters=[("id", "eq", plan["id"]), ("user_id", "eq", user_id)],
                )
                plan["current_version_id"] = version_rows[-1]["id"]
        return _clean(plan) or plan

    ws = await _load_workspace(user_id, business_id)
    blueprint = await _load_blueprint_document(user_id, business_id)
    if source_document_id and not blueprint:
        blueprint = await _safe_select(
            "blueprint_documents",
            filters=[("id", "eq", source_document_id), ("user_id", "eq", user_id)],
            single=True,
        )
        blueprint = _clean(blueprint)

    plan_id = str(uuid4())
    version_id = str(uuid4())
    now = _now_iso()
    markdown = str((blueprint or {}).get("document_markdown") or "")
    assumptions = _initial_assumption_rows(blueprint, ws, markdown)
    kpis = _initial_kpi_rows(blueprint, markdown)
    changes = _initial_change_rows(blueprint, markdown)
    version_number = 1
    plan_payload = {
        "id": plan_id,
        "user_id": user_id,
        "business_id": business_id,
        "status": "DRAFT",
        "current_version_id": version_id,
        "source_document_id": (blueprint or {}).get("id"),
        "created_by": user_id,
        "narrative_markdown": None,
        "narrative_json": {},
        "narrative_updated_at": None,
        "created_at": now,
        "updated_at": now,
    }
    version_payload = {
        "id": version_id,
        "live_plan_id": plan_id,
        "version_number": version_number,
        "previous_version_id": None,
        "source_type": "IMPORTED_PLAN" if blueprint else "GENERATED_PLAN",
        "source_reference_id": (blueprint or {}).get("id") or source_document_id,
        "change_summary": f"Seeded live plan from {blueprint.get('title') if blueprint else 'business context'}",
        "approved_by": None,
        "approved_at": None,
        "created_at": now,
    }

    inserted = await _safe_insert("live_business_plans", plan_payload)
    if not inserted:
        raise RuntimeError("Failed to create live business plan")
    await _safe_insert("live_plan_versions", version_payload)

    assumption_rows = []
    for row in assumptions:
        assumption_rows.append(
            {
                "id": str(uuid4()),
                "live_plan_id": plan_id,
                "live_plan_version_id": version_id,
                "created_at": now,
                "updated_at": now,
                **row,
            }
        )
    kpi_rows = []
    for row in kpis:
        kpi_rows.append(
            {
                "id": str(uuid4()),
                "live_plan_id": plan_id,
                "live_plan_version_id": version_id,
                "created_at": now,
                "updated_at": now,
                "actual_value_json": None,
                "last_observed_at": None,
                **row,
            }
        )
    change_rows = []
    for row in changes:
        change_rows.append(
            {
                "id": str(uuid4()),
                "live_plan_id": plan_id,
                "live_plan_version_id": version_id,
                "created_at": now,
                "updated_at": now,
                **row,
            }
        )

    if assumption_rows:
        await _safe_insert("live_plan_assumptions", assumption_rows)
    if kpi_rows:
        await _safe_insert("plan_kpis", kpi_rows)
    if change_rows:
        await _safe_insert("planned_entity_changes", change_rows)

    plan = await _get_live_plan_record(user_id, business_id)
    if not plan:
        raise RuntimeError("Failed to load created live plan")
    await _sync_variances_and_alerts(live_plan=plan, version_id=version_id)
    return _clean(plan) or plan


async def get_existing_live_plan(*, user_id: str, business_id: str) -> dict[str, Any] | None:
    plan = await _get_live_plan_record(user_id, business_id)
    return _clean(plan) if plan else None


async def get_live_plan(*, user_id: str, business_id: str) -> dict[str, Any]:
    plan = await ensure_live_plan(user_id=user_id, business_id=business_id)
    current = await _get_current_version(plan) if plan else None
    if not current:
        raise RuntimeError("Plan version missing")
    bundle = await _load_version_bundle(plan["id"], current["id"])
    narrative, narrative_meta = _assemble_narrative(plan, bundle["version"], bundle["kpis"], bundle["variances"], bundle["alerts"])
    return {
        "plan": plan,
        "current_version": bundle["version"],
        "versions": await _get_versions(plan["id"]),
        "assumptions": bundle["assumptions"],
        "planned_changes": bundle["changes"],
        "kpis": bundle["kpis"],
        "observations": bundle["observations"],
        "variances": bundle["variances"],
        "alerts": bundle["alerts"],
        "narrative": narrative,
        "narrative_meta": narrative_meta,
    }


async def list_versions(*, user_id: str, business_id: str) -> list[dict[str, Any]]:
    plan = await ensure_live_plan(user_id=user_id, business_id=business_id)
    return await _get_versions(plan["id"])


async def get_version(*, user_id: str, business_id: str, version_id: str) -> dict[str, Any]:
    plan = await ensure_live_plan(user_id=user_id, business_id=business_id)
    bundle = await _load_version_bundle(plan["id"], version_id)
    return bundle


def _diff_rows(rows_a: list[dict[str, Any]], rows_b: list[dict[str, Any]], *, key: str) -> list[dict[str, Any]]:
    map_a = {row.get(key): row for row in rows_a if row.get(key) is not None}
    map_b = {row.get(key): row for row in rows_b if row.get(key) is not None}
    keys = sorted(set(map_a) | set(map_b), key=lambda item: str(item))
    diffs: list[dict[str, Any]] = []
    for item_key in keys:
        a = map_a.get(item_key)
        b = map_b.get(item_key)
        if a == b:
            continue
        diffs.append({"key": item_key, "version_a": a, "version_b": b})
    return diffs


async def compare_versions(*, user_id: str, business_id: str, version_a: str, version_b: str) -> dict[str, Any]:
    plan = await ensure_live_plan(user_id=user_id, business_id=business_id)
    bundle_a = await _load_version_bundle(plan["id"], version_a)
    bundle_b = await _load_version_bundle(plan["id"], version_b)
    return {
        "plan": plan,
        "version_a": bundle_a["version"],
        "version_b": bundle_b["version"],
        "kpi_differences": _diff_rows(bundle_a["kpis"], bundle_b["kpis"], key="code"),
        "assumption_differences": _diff_rows(bundle_a["assumptions"], bundle_b["assumptions"], key="metric_code"),
        "planned_change_differences": _diff_rows(bundle_a["changes"], bundle_b["changes"], key="entity_id"),
    }


async def _latest_kpi_rows(live_plan_id: str, live_plan_version_id: str) -> list[dict[str, Any]]:
    data = await _safe_select(
        "plan_kpis",
        filters=[("live_plan_id", "eq", live_plan_id), ("live_plan_version_id", "eq", live_plan_version_id)],
        order="code",
        desc=False,
    )
    return _clean_many(data)


async def list_kpis(*, user_id: str, business_id: str) -> list[dict[str, Any]]:
    plan = await ensure_live_plan(user_id=user_id, business_id=business_id)
    current = await _get_current_version(plan)
    if not current:
        return []
    return await _latest_kpi_rows(plan["id"], current["id"])


async def upsert_kpi(*, user_id: str, business_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    plan = await ensure_live_plan(user_id=user_id, business_id=business_id)
    current = await _get_current_version(plan)
    if not current:
        raise RuntimeError("Plan version missing")
    version_id = current["id"]
    plan_id = plan["id"]
    existing = None
    if payload.get("id"):
        existing = await _safe_select(
            "plan_kpis",
            filters=[("id", "eq", payload["id"]), ("live_plan_id", "eq", plan_id), ("live_plan_version_id", "eq", version_id)],
            single=True,
        )
    if not existing and payload.get("code"):
        existing = await _safe_select(
            "plan_kpis",
            filters=[("code", "eq", payload["code"]), ("live_plan_id", "eq", plan_id), ("live_plan_version_id", "eq", version_id)],
            single=True,
        )
    now = _now_iso()
    row = {
        "id": (existing or {}).get("id") or str(uuid4()),
        "live_plan_id": plan_id,
        "live_plan_version_id": version_id,
        "code": payload["code"],
        "name": payload["name"],
        "domain": payload["domain"],
        "metric_path": payload.get("metric_path"),
        "target_value_json": _json_copy(payload.get("target_value")),
        "tolerance_json": _json_copy(payload.get("tolerance")),
        "actual_value_json": _json_copy(payload.get("actual_value")),
        "unit": payload.get("unit"),
        "direction": payload.get("direction") or "up",
        "status": payload.get("status") or ("ACTIVE" if payload.get("target_value") is not None else "PLANNED"),
        "last_observed_at": payload.get("observed_at").isoformat() if getattr(payload.get("observed_at"), "isoformat", None) else payload.get("observed_at"),
        "source_type": payload.get("source_type"),
        "source_reference_id": payload.get("source_reference_id"),
        "created_at": (existing or {}).get("created_at") or now,
        "updated_at": now,
    }
    await _safe_upsert("plan_kpis", payload=row, on_conflict="live_plan_version_id,code")
    stored = await _safe_select("plan_kpis", filters=[("id", "eq", row["id"])], single=True)
    if stored and payload.get("actual_value") is not None:
        await record_kpi_observation(
            user_id=user_id,
            business_id=business_id,
            plan_kpi_id=stored["id"],
            code=stored["code"],
            actual_value=payload.get("actual_value"),
            observed_at=payload.get("observed_at"),
            source_type=payload.get("source_type"),
            source_reference_id=payload.get("source_reference_id"),
            confidence_score=payload.get("confidence_score"),
            notes=payload.get("notes"),
        )
    await _sync_variances_and_alerts(live_plan=plan, version_id=version_id)
    return _clean(stored or row) or row


async def patch_kpi(*, user_id: str, business_id: str, kpi_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    plan = await ensure_live_plan(user_id=user_id, business_id=business_id)
    current = await _get_current_version(plan)
    if not current:
        raise RuntimeError("Plan version missing")
    existing = await _safe_select(
        "plan_kpis",
        filters=[("id", "eq", kpi_id), ("live_plan_id", "eq", plan["id"]), ("live_plan_version_id", "eq", current["id"])],
        single=True,
    )
    if not existing:
        raise ValueError("KPI_NOT_FOUND")
    update: dict[str, Any] = {}
    for field in ("code", "name", "domain", "metric_path", "target_value", "tolerance", "actual_value", "unit", "direction", "source_type", "source_reference_id", "confidence_score", "notes"):
        if field in payload and payload[field] is not None:
            if field == "target_value":
                update["target_value_json"] = _json_copy(payload[field])
            elif field == "tolerance":
                update["tolerance_json"] = _json_copy(payload[field])
            elif field == "actual_value":
                update["actual_value_json"] = _json_copy(payload[field])
            else:
                update[field] = payload[field]
    if payload.get("observed_at"):
        observed = payload["observed_at"]
        update["last_observed_at"] = observed.isoformat() if getattr(observed, "isoformat", None) else observed
    update["updated_at"] = _now_iso()
    await _safe_update("plan_kpis", payload=update, filters=[("id", "eq", kpi_id)])
    if payload.get("actual_value") is not None:
        await record_kpi_observation(
            user_id=user_id,
            business_id=business_id,
            plan_kpi_id=kpi_id,
            code=payload.get("code") or existing.get("code"),
            actual_value=payload["actual_value"],
            observed_at=payload.get("observed_at"),
            source_type=payload.get("source_type"),
            source_reference_id=payload.get("source_reference_id"),
            confidence_score=payload.get("confidence_score"),
            notes=payload.get("notes"),
        )
    stored = await _safe_select("plan_kpis", filters=[("id", "eq", kpi_id)], single=True)
    await _sync_variances_and_alerts(live_plan=plan, version_id=current["id"])
    return _clean(stored) or existing


async def record_kpi_observation(
    *,
    user_id: str,
    business_id: str,
    plan_kpi_id: str,
    code: str,
    actual_value: Any,
    observed_at: datetime | None = None,
    source_type: str | None = None,
    source_reference_id: str | None = None,
    confidence_score: float | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    plan = await ensure_live_plan(user_id=user_id, business_id=business_id)
    current = await _get_current_version(plan)
    if not current:
        raise RuntimeError("Plan version missing")
    ts = observed_at.isoformat() if observed_at and getattr(observed_at, "isoformat", None) else _now_iso()
    row = {
        "id": str(uuid4()),
        "live_plan_id": plan["id"],
        "live_plan_version_id": current["id"],
        "plan_kpi_id": plan_kpi_id,
        "code": code,
        "observed_at": ts,
        "value_json": _json_copy(actual_value),
        "source_type": source_type,
        "source_reference_id": source_reference_id,
        "confidence_score": confidence_score,
        "is_authoritative": False,
        "notes": notes,
        "created_at": _now_iso(),
    }
    await _safe_insert("kpi_observations", row)
    await _safe_update(
        "plan_kpis",
        payload={
            "actual_value_json": _json_copy(actual_value),
            "last_observed_at": ts,
            "updated_at": _now_iso(),
        },
        filters=[("id", "eq", plan_kpi_id)],
    )
    return row


async def list_variances(*, user_id: str, business_id: str) -> list[dict[str, Any]]:
    plan = await ensure_live_plan(user_id=user_id, business_id=business_id)
    current = await _get_current_version(plan)
    if not current:
        return []
    data = await _safe_select(
        "plan_variances",
        filters=[("live_plan_id", "eq", plan["id"]), ("live_plan_version_id", "eq", current["id"])],
        order="detected_at",
        desc=True,
    )
    return _clean_many(data)


async def list_alerts(*, user_id: str, business_id: str) -> list[dict[str, Any]]:
    plan = await ensure_live_plan(user_id=user_id, business_id=business_id)
    current = await _get_current_version(plan)
    if not current:
        return []
    data = await _safe_select(
        "live_plan_alerts",
        filters=[("live_plan_id", "eq", plan["id"]), ("live_plan_version_id", "eq", current["id"])],
        order="created_at",
        desc=True,
    )
    return _clean_many(data)


async def acknowledge_alert(*, user_id: str, business_id: str, alert_id: str, dismissed: bool = False) -> dict[str, Any]:
    plan = await ensure_live_plan(user_id=user_id, business_id=business_id)
    current = await _get_current_version(plan)
    if not current:
        raise RuntimeError("Plan version missing")
    existing = await _safe_select(
        "live_plan_alerts",
        filters=[("id", "eq", alert_id), ("live_plan_id", "eq", plan["id"]), ("live_plan_version_id", "eq", current["id"])],
        single=True,
    )
    if not existing:
        raise ValueError("ALERT_NOT_FOUND")
    payload = {"updated_at": _now_iso()}
    if dismissed:
        payload.update({"status": "DISMISSED", "dismissed_at": _now_iso(), "dismissed_by": user_id})
    else:
        payload.update({"status": "ACKNOWLEDGED", "acknowledged_at": _now_iso(), "acknowledged_by": user_id})
    await _safe_update("live_plan_alerts", payload=payload, filters=[("id", "eq", alert_id)])
    stored = await _safe_select("live_plan_alerts", filters=[("id", "eq", alert_id)], single=True)
    return _clean(stored) or existing


async def activate_live_plan(*, user_id: str, business_id: str) -> dict[str, Any]:
    plan = await ensure_live_plan(user_id=user_id, business_id=business_id)
    current = await _get_current_version(plan)
    if current:
        await _safe_update(
            "live_plan_versions",
            payload={"approved_by": user_id, "approved_at": _now_iso()},
            filters=[("id", "eq", current["id"])],
        )
    await _safe_update(
        "live_business_plans",
        payload={"status": "ACTIVE", "adopted_at": _now_iso(), "updated_at": _now_iso()},
        filters=[("id", "eq", plan["id"]), ("user_id", "eq", user_id)],
    )
    return await get_live_plan(user_id=user_id, business_id=business_id)


async def adopt_scenario(*, user_id: str, business_id: str, scenario_id: str) -> dict[str, Any]:
    plan = await ensure_live_plan(user_id=user_id, business_id=business_id)
    current = await _get_current_version(plan)
    if not current:
        raise RuntimeError("Plan version missing")
    run = await _safe_select(
        "scenario_runs",
        filters=[("scenario_run_id", "eq", scenario_id), ("business_id", "eq", business_id)],
        single=True,
    )
    if not run:
        raise ValueError("SCENARIO_NOT_FOUND")
    run = _clean(run) or run
    new_version_number = int(current.get("version_number") or 1) + 1
    new_version_id = str(uuid4())
    now = _now_iso()
    change_summary = f"Adopted scenario '{run.get('scenario_name')}' ({run.get('scenario_type')})"
    await _safe_insert(
        "live_plan_versions",
        {
            "id": new_version_id,
            "live_plan_id": plan["id"],
            "version_number": new_version_number,
            "previous_version_id": current["id"],
            "source_type": "SCENARIO_ADOPTION",
            "source_reference_id": scenario_id,
            "change_summary": change_summary,
            "approved_by": user_id,
            "approved_at": now,
            "created_at": now,
        },
    )

    current_kpis = await _latest_kpi_rows(plan["id"], current["id"])
    scenario_metrics = run.get("scenario_metrics") or {}
    target_map = {
        "monthly_revenue_target": scenario_metrics.get("revenue_monthly") or scenario_metrics.get("revenue"),
        "gross_margin_target_pct": scenario_metrics.get("gross_margin_pct"),
        "cash_runway_months": scenario_metrics.get("cash_runway_months"),
        "active_customers_target": scenario_metrics.get("clients_count"),
        "on_time_delivery_pct": scenario_metrics.get("delivery_pct"),
    }
    if not current_kpis:
        current_kpis = _initial_kpi_rows(None, None)
    for kpi in current_kpis:
        code = kpi.get("code")
        target = target_map.get(code, kpi.get("target_value_json"))
        await _safe_insert(
            "plan_kpis",
            {
                "id": str(uuid4()),
                "live_plan_id": plan["id"],
                "live_plan_version_id": new_version_id,
                "code": code,
                "name": kpi.get("name"),
                "domain": kpi.get("domain"),
                "metric_path": kpi.get("metric_path"),
                "target_value_json": _json_copy(target),
                "tolerance_json": _json_copy(kpi.get("tolerance_json")),
                "actual_value_json": _json_copy(kpi.get("actual_value_json")),
                "unit": kpi.get("unit"),
                "direction": kpi.get("direction") or "up",
                "status": "ACTIVE",
                "last_observed_at": kpi.get("last_observed_at"),
                "source_type": "SCENARIO_ADOPTION",
                "source_reference_id": scenario_id,
                "created_at": now,
                "updated_at": now,
            },
        )

    recs = await _safe_select(
        "scenario_recommendations",
        filters=[("scenario_run_id", "eq", scenario_id)],
        order="priority",
        desc=False,
    ) or []
    change_rows = []
    for index, rec in enumerate(recs[:10], 1):
        rec = _clean(rec) or rec
        change_rows.append(
            {
                "id": str(uuid4()),
                "live_plan_id": plan["id"],
                "live_plan_version_id": new_version_id,
                "domain": "STRATEGIC",
                "entity_type": "scenario_recommendation",
                "entity_id": rec.get("recommendation_id") or f"recommendation-{index}",
                "operation": "UPDATE",
                "field_name": "adopted_action",
                "current_value_json": None,
                "planned_value_json": rec,
                "effective_from": now,
                "due_date": None,
                "status": "PLANNED",
                "source_type": "SCENARIO_ADOPTION",
                "source_reference_id": scenario_id,
                "notes": rec.get("description"),
                "created_at": now,
                "updated_at": now,
            }
        )
    if change_rows:
        await _safe_insert("planned_entity_changes", change_rows)

    await _safe_update(
        "live_business_plans",
        payload={
            "current_version_id": new_version_id,
            "status": "ACTIVE",
            "adopted_at": now,
            "updated_at": now,
        },
        filters=[("id", "eq", plan["id"]), ("user_id", "eq", user_id)],
    )
    plan = await _get_live_plan_record(user_id, business_id)
    if plan:
        await _sync_variances_and_alerts(live_plan=plan, version_id=new_version_id)
    return await get_live_plan(user_id=user_id, business_id=business_id)


async def refresh_narrative(*, user_id: str, business_id: str, section: str | None = None) -> dict[str, Any]:
    plan = await ensure_live_plan(user_id=user_id, business_id=business_id)
    current = await _get_current_version(plan)
    if not current:
        raise RuntimeError("Plan version missing")
    bundle = await _load_version_bundle(plan["id"], current["id"])
    narrative, narrative_meta = _assemble_narrative(plan, bundle["version"], bundle["kpis"], bundle["variances"], bundle["alerts"])
    if section:
        narrative = f"## {section}\n\n{narrative}"
    await _safe_update(
        "live_business_plans",
        payload={
            "narrative_markdown": narrative,
            "narrative_json": narrative_meta,
            "narrative_updated_at": _now_iso(),
            "updated_at": _now_iso(),
        },
        filters=[("id", "eq", plan["id"]), ("user_id", "eq", user_id)],
    )
    return {
        "business_id": business_id,
        "narrative": narrative,
        "narrative_meta": narrative_meta,
    }


async def build_performance(*, user_id: str, business_id: str) -> dict[str, Any]:
    plan = await ensure_live_plan(user_id=user_id, business_id=business_id)
    current = await _get_current_version(plan)
    if not current:
        return {"status": "missing"}
    bundle = await _load_version_bundle(plan["id"], current["id"])
    kpis = bundle["kpis"]
    observations = bundle["observations"]
    variances = bundle["variances"]
    on_track = len([v for v in variances if v.get("status") == "on_track"])
    watch = len([v for v in variances if v.get("status") == "watch"])
    off_track = len([v for v in variances if v.get("status") == "off_track"])
    latest_observation_at = None
    if observations:
        latest_observation_at = observations[-1].get("observed_at")
    summary = {
        "kpi_count": len(kpis),
        "observation_count": len(observations),
        "variance_count": len(variances),
        "on_track_count": on_track,
        "watch_count": watch,
        "off_track_count": off_track,
        "latest_observation_at": latest_observation_at,
        "health": "healthy" if off_track == 0 else "at_risk" if off_track < max(1, len(kpis) // 2) else "critical",
    }
    return {"plan": plan, "current_version": current, "summary": summary, "kpis": kpis, "observations": observations, "variances": variances, "alerts": bundle["alerts"]}
