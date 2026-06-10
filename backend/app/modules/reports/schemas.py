from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


ReportType = Literal[
    "business_health_report",
    "viability_report",
    "survival_report",
    "stability_report",
    "growth_report",
    "fragility_report",
    "scenario_report",
    "adaptive_decision_report",
    "investor_summary",
]


class ReportSectionData(BaseModel):
    sectionKey: str
    title: str
    content: Optional[str] = None
    dataSource: Literal["scores", "risks", "recommendations", "fragility", "scenario", "narrative"]
    sectionOrder: int = 0


class GenerateReportRequest(BaseModel):
    reportType: ReportType = "business_health_report"
    sourceAssessmentId: Optional[str] = None
    sourceSimulationRunId: Optional[str] = None
    includeNarratives: bool = True
    branding: Optional[Dict[str, Any]] = None
    sections: Optional[List[ReportSectionData]] = None
    title: Optional[str] = None


class GenerateReportResponse(BaseModel):
    success: bool
    reportId: str
    status: Literal["generated", "failed", "generating"]
    reportType: str
    title: str
    fileUrl: Optional[str] = None
    generatedAt: str
    sections: List[ReportSectionData] = Field(default_factory=list)


class ReportRecord(BaseModel):
    id: str
    business_id: str
    report_type: str
    title: str
    status: str
    source_assessment_id: Optional[str] = None
    source_simulation_run_id: Optional[str] = None
    file_url: Optional[str] = None
    generated_by: Optional[str] = None
    created_at: str
    completed_at: Optional[str] = None
    sections: List[Dict[str, Any]] = Field(default_factory=list)


class GenerateNarrativeRequest(BaseModel):
    sourceType: Literal["assessment", "simulation", "manual"] = "manual"
    sourceId: Optional[str] = None
    narrativeType: Literal[
        "executive_summary",
        "risk_explanation",
        "recommendation_summary",
        "scenario_explanation",
        "fragility_explanation",
        "pdf_report_section",
        "advisor_chat",
    ] = "executive_summary"
    audience: Literal["founder", "advisor", "investor", "internal"] = "founder"
    tone: Literal["simple", "professional", "strategic"] = "professional"
    intelligenceOutput: Optional[Dict[str, Any]] = None


class GenerateNarrativeResponse(BaseModel):
    success: bool
    narrativeId: str
    output: Dict[str, Any]
