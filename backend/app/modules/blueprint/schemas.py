from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field



BlueprintType = Literal[
    "business_plan",
    "client_proposal",
    "sales_letter",
    "sales_quotation",
    "invoice_template",
    "cashflow_analysis",
    "financial_projection",
]


class BlueprintGenerateRequest(BaseModel):
    document_id: Optional[str] = Field(default=None, description="Optional existing blueprint document id to update instead of creating a new one.")
    type: BlueprintType
    company_name: str = Field(min_length=2, max_length=64)
    logo_data_url: Optional[str] = Field(default=None, max_length=2_000_000)
    workspace_id: Optional[str] = Field(default=None, description="Optional idea-validation workspace id to pull deterministic metrics.")
    include_validation_snapshot: bool = Field(
        default=False,
        description="When workspace_id is provided, include a deterministic validation + financial snapshot in the document.",
    )
    industry: Optional[str] = Field(default=None, max_length=80)
    pricing_model: Optional[str] = Field(default=None, max_length=40)

    problem: Optional[str] = None
    solution: Optional[str] = None
    target_market: Optional[str] = None
    value_proposition: Optional[str] = None
    tone: str = Field(default="professional", max_length=32)
    extra_notes: Optional[str] = None
    selected_services: Optional[list[str]] = Field(default=None, description="Selected services from workspace.")

    bill_to: Optional[str] = None
    items: Optional[str] = None
    terms: Optional[str] = None

    # Optional document-specific inputs (narrative only)
    proposal_title: Optional[str] = None
    contact_details: Optional[str] = None
    timeline: Optional[str] = None
    scope_exclusions: Optional[str] = None
    assumptions: Optional[str] = None

    headline: Optional[str] = None
    proof: Optional[str] = None
    offer: Optional[str] = None
    cta: Optional[str] = None
    urgency: Optional[str] = None
    sender_name: Optional[str] = None
    sender_position: Optional[str] = None
    sender_phone: Optional[str] = None
    sender_email: Optional[str] = None
    sender_website: Optional[str] = None
    contact_name: Optional[str] = None
    objective: Optional[str] = None
    subject_lines: Optional[str] = None
    followup_sequence: Optional[str] = None
    sections: Optional[list[str]] = Field(default=None, description="Optional section identifiers to generate.")
    word_count: Optional[int] = Field(default=None, ge=50, le=5000, description="Target word count for sales letters.")


class BlueprintGenerateResponse(BaseModel):
    document_markdown: str
    provider: str
    model: str
    warnings: list[str] = []
    document_id: Optional[str] = None


class BlueprintDocument(BaseModel):
    id: str
    user_id: str
    type: BlueprintType
    title: str
    company_name: str
    industry: Optional[str] = None
    pricing_model: Optional[str] = None
    workspace_id: Optional[str] = None
    document_markdown: str
    document_html: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class BlueprintDocumentListItem(BaseModel):
    id: str
    type: BlueprintType
    title: str
    company_name: str
    updated_at: datetime


class BlueprintDocumentUpdateRequest(BaseModel):
    title: Optional[str] = None
    document_markdown: Optional[str] = None
    document_html: Optional[str] = None


class BlueprintShareLinkResponse(BaseModel):
    token: str = Field(min_length=16, max_length=256)


class BlueprintFinancialShareRequest(BaseModel):
    document_id: Optional[str] = None
    type: Literal["sales_quotation", "invoice_template"]
    title: str = Field(min_length=2, max_length=120)
    company_name: str = Field(min_length=2, max_length=120)
    workspace_id: Optional[str] = None
    industry: Optional[str] = Field(default=None, max_length=80)
    pricing_model: Optional[str] = Field(default=None, max_length=40)
    document_markdown: str = Field(min_length=1)
    document_html: Optional[str] = None


class BlueprintFinancialShareResponse(BlueprintShareLinkResponse):
    document_id: str


class BlueprintSharedDocument(BaseModel):
    type: BlueprintType
    title: str
    company_name: str
    document_markdown: str
    document_html: Optional[str] = None
    updated_at: datetime
