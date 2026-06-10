from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from app.core.supabase import sb_insert, sb_select

_MEM_REPORTS: Dict[str, Dict[str, Any]] = {}
_MEM_SECTIONS: Dict[str, List[Dict[str, Any]]] = {}
_MEM_NARRATIVES: Dict[str, Dict[str, Any]] = {}

REPORT_TITLES = {
    "business_health_report": "Business Health Report",
    "viability_report": "Viability Report",
    "survival_report": "Survival Report",
    "stability_report": "Stability Report",
    "growth_report": "Growth Report",
    "fragility_report": "Fragility Report",
    "scenario_report": "Scenario Analysis Report",
    "adaptive_decision_report": "Adaptive Decision Report",
    "investor_summary": "Investor Summary",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _safe_insert(table: str, doc: Any) -> bool:
    try:
        await sb_insert(table, doc)
        return True
    except Exception:
        return False


async def _safe_select(table: str, **kwargs) -> Any:
    try:
        return await sb_select(table, **kwargs)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Report CRUD
# ---------------------------------------------------------------------------

async def create_report(
    business_id: str,
    tenant_id: str,
    report_type: str,
    title: Optional[str],
    source_assessment_id: Optional[str],
    source_simulation_run_id: Optional[str],
    sections: Optional[List[Dict[str, Any]]],
    generated_by: Optional[str],
) -> Dict[str, Any]:
    report_id = str(uuid4())
    now = _now()
    resolved_title = title or REPORT_TITLES.get(report_type, "Intelligence Report")

    report_doc = dict(
        id=report_id,
        business_id=business_id,
        tenant_id=tenant_id,
        report_type=report_type,
        title=resolved_title,
        status="generated",
        source_assessment_id=source_assessment_id,
        source_simulation_run_id=source_simulation_run_id,
        file_url=None,
        generated_by=generated_by,
        created_at=now,
        completed_at=now,
    )

    stored = await _safe_insert("reports", report_doc)
    if not stored:
        _MEM_REPORTS[report_id] = report_doc

    section_docs = []
    for idx, sec in enumerate(sections or []):
        section_doc = dict(
            id=str(uuid4()),
            report_id=report_id,
            section_key=sec.get("sectionKey") or sec.get("section_key", f"section_{idx}"),
            section_title=sec.get("title", "—"),
            content_text=sec.get("content") or "",
            data_source=sec.get("dataSource") or sec.get("data_source", "narrative"),
            section_order=sec.get("sectionOrder", idx),
            created_at=now,
        )
        section_docs.append(section_doc)

    if section_docs:
        stored_sec = await _safe_insert("report_sections", section_docs)
        if not stored_sec:
            _MEM_SECTIONS[report_id] = section_docs

    return {**report_doc, "sections": section_docs}


async def get_report(business_id: str, report_id: str) -> Optional[Dict[str, Any]]:
    report = await _safe_select(
        "reports",
        filters=[("id", "eq", report_id), ("business_id", "eq", business_id)],
        single=True,
    )
    if not report:
        report = _MEM_REPORTS.get(report_id)
        if not report or report.get("business_id") != business_id:
            return None

    sections = await _safe_select(
        "report_sections",
        filters=[("report_id", "eq", report_id)],
        order="section_order",
        desc=False,
    ) or _MEM_SECTIONS.get(report_id, [])

    return {**report, "sections": sections}


async def list_reports(business_id: str, tenant_id: str) -> List[Dict[str, Any]]:
    rows = await _safe_select(
        "reports",
        filters=[("business_id", "eq", business_id), ("tenant_id", "eq", tenant_id)],
        order="created_at",
        desc=True,
    )
    if rows:
        return rows
    return [r for r in _MEM_REPORTS.values() if r.get("business_id") == business_id]


# ---------------------------------------------------------------------------
# AI Narrative persistence
# ---------------------------------------------------------------------------

async def save_narrative(
    business_id: str,
    tenant_id: str,
    narrative_type: str,
    source_type: str,
    source_id: Optional[str],
    generated_text: str,
    validation_status: str,
    confidence_level: Optional[str],
    input_snapshot: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    narrative_id = str(uuid4())
    now = _now()
    doc = dict(
        id=narrative_id,
        business_id=business_id,
        tenant_id=tenant_id,
        source_type=source_type,
        source_id=source_id,
        narrative_type=narrative_type,
        prompt_version="template_v1.0",
        model_name=None,
        input_context_snapshot=input_snapshot or {},
        generated_text=generated_text,
        validation_status=validation_status,
        confidence_level=confidence_level,
        created_at=now,
    )
    stored = await _safe_insert("ai_narratives", doc)
    if not stored:
        _MEM_NARRATIVES[narrative_id] = doc
    return doc
