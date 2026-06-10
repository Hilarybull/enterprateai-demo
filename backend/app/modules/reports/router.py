from __future__ import annotations

from fastapi import APIRouter, HTTPException, status, Request

from app.modules.reports.schemas import (
    GenerateReportRequest,
    GenerateReportResponse,
    GenerateNarrativeRequest,
    GenerateNarrativeResponse,
)
from app.modules.reports.service import (
    create_report,
    get_report,
    list_reports,
    save_narrative,
    REPORT_TITLES,
)
from app.shared.auth.deps import get_current_user

router = APIRouter(prefix="/v1/reports", tags=["reports"])


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

@router.post("/generate", status_code=status.HTTP_201_CREATED, response_model=GenerateReportResponse)
async def generate_report(
    body: GenerateReportRequest,
    request: Request,
) -> GenerateReportResponse:
    """
    Save report metadata and section list.
    The actual PDF is generated in the browser using html2pdf.js —
    this endpoint persists the record so it can be retrieved later.
    """
    user = await get_current_user(request)
    user_id = user.get("id", "")
    tenant_id = user.get("tenant_id") or user_id
    business_id = request.headers.get("X-Business-Id", "") or user_id or "unknown"

    sections_data = [s.model_dump() for s in (body.sections or [])]

    report = await create_report(
        business_id=business_id,
        tenant_id=tenant_id,
        report_type=body.reportType,
        title=body.title,
        source_assessment_id=body.sourceAssessmentId,
        source_simulation_run_id=body.sourceSimulationRunId,
        sections=sections_data,
        generated_by=user_id,
    )

    return GenerateReportResponse(
        success=True,
        reportId=report["id"],
        status="generated",
        reportType=report["report_type"],
        title=report["title"],
        fileUrl=report.get("file_url"),
        generatedAt=report["created_at"],
        sections=[],
    )


@router.get("/{report_id}", response_model=dict)
async def retrieve_report(report_id: str, request: Request) -> dict:
    user = await get_current_user(request)
    user_id = user.get("id", "")
    business_id = request.headers.get("X-Business-Id", "") or user_id or "unknown"

    report = await get_report(business_id=business_id, report_id=report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")
    return {"success": True, "report": report}


@router.get("", response_model=dict)
async def list_business_reports(request: Request) -> dict:
    user = await get_current_user(request)
    user_id = user.get("id", "")
    tenant_id = user.get("tenant_id") or user_id
    business_id = request.headers.get("X-Business-Id", "") or user_id or "unknown"

    reports = await list_reports(business_id=business_id, tenant_id=tenant_id)
    return {"success": True, "reports": reports}


# ---------------------------------------------------------------------------
# Narratives
# ---------------------------------------------------------------------------

@router.post("/narratives", status_code=status.HTTP_201_CREATED)
async def generate_narrative_endpoint(body: GenerateNarrativeRequest, request: Request) -> dict:
    """
    Template-first narrative generation. Stores narrative to ai_narratives table.
    Does not call any LLM — uses deterministic template engine only.
    """
    user = await get_current_user(request)
    user_id = user.get("id", "")
    tenant_id = user.get("tenant_id") or user_id
    business_id = request.headers.get("X-Business-Id", "") or user_id or "unknown"

    output = body.intelligenceOutput or {}
    narrative_text = _build_template_narrative(body.narrativeType, output)
    confidence = (output.get("confidence") or {}).get("overallLevel", "LOW")

    saved = await save_narrative(
        business_id=business_id,
        tenant_id=tenant_id,
        narrative_type=body.narrativeType,
        source_type=body.sourceType,
        source_id=body.sourceId,
        generated_text=narrative_text,
        validation_status="passed",
        confidence_level=confidence,
        input_snapshot={"narrativeType": body.narrativeType, "audience": body.audience},
    )

    return {
        "success": True,
        "narrativeId": saved["id"],
        "output": {
            "headline": _get_headline(body.narrativeType, output),
            "narrative": narrative_text,
            "keyPoints": [],
            "actionSummary": [],
            "confidenceNote": _confidence_note(confidence),
        },
    }


# ---------------------------------------------------------------------------
# Private template narrative builder (backend, no LLM)
# ---------------------------------------------------------------------------

def _build_template_narrative(narrative_type: str, output: dict) -> str:
    ex = output.get("executiveSummary") or {}
    sc = output.get("scores") or {}
    risks = (output.get("risks") or {}).get("topRisks") or []
    recs = (output.get("recommendations") or {}).get("topRecommendations") or []
    confidence = (output.get("confidence") or {}).get("overallLevel", "LOW")

    if narrative_type == "executive_summary":
        parts = [ex.get("summary", "Assessment complete.")]
        if ex.get("keyStrength"):
            parts.append(f"Strongest area: {ex['keyStrength']}.")
        if ex.get("keyWeakness"):
            parts.append(f"Main concern: {ex['keyWeakness']}.")
        if confidence == "LOW":
            parts.append("Note: confidence is limited — add more financial data to improve accuracy.")
        return " ".join(parts)

    if narrative_type == "risk_explanation":
        if not risks:
            return "No significant risks detected based on current data."
        top = risks[0]
        return f"The main risk identified is: {top.get('explanation', '—')} Recommended action: {top.get('recommendedAction', '—')}"

    if narrative_type == "recommendation_summary":
        if not recs:
            return "No recommendations generated yet. Add more data to unlock targeted advice."
        top = recs[0]
        return f"Priority action: {top.get('text', '—')} {top.get('reason', '')}"

    if narrative_type == "scenario_explanation":
        scenario = output.get("scenarios") or {}
        if not scenario:
            return "No scenario data available. Run a simulation to generate a detailed explanation."
        return f"Scenario '{scenario.get('scenarioName', '—')}': type {scenario.get('scenarioType', '—')}. Review the timeline for full impact."

    if narrative_type == "fragility_explanation":
        fi = sc.get("fragilityIndex")
        cl = (output.get("classifications") or {}).get("fragility")
        if fi is None:
            return "Fragility data not available. Add client concentration and revenue data."
        return f"Fragility index: {fi}/100. Classification: {cl or '—'}. This reflects structural vulnerability to single-point failures."

    return ex.get("summary") or "Assessment summary not available."


def _get_headline(narrative_type: str, output: dict) -> str:
    ex = output.get("executiveSummary") or {}
    return ex.get("headline") or "Assessment complete."


def _confidence_note(level: str) -> str:
    if level == "LOW":
        return "Limited data — treat as estimates only."
    if level == "MEDIUM":
        return "Based on available data. Accuracy improves with complete financial records."
    return "High confidence based on complete data."
