from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class RegistrationGuideRequest(BaseModel):
    country: str = Field(min_length=2, max_length=64, description="Country where you plan to operate")
    founder_count: int = Field(ge=1, le=50)
    wants_investment: bool = False
    liability_risk: str = Field(default="medium", description="low|medium|high")
    has_employees_soon: bool = False
    industry: str = Field(default="general", max_length=64)


class RegistrationGuideResponse(BaseModel):
    recommended_type: str
    checklist: list[str]
    next_steps: list[str]
    external_link: str


class UkFee(BaseModel):
    online_gbp: Optional[float] = None
    paper_gbp: Optional[float] = None
    same_day_gbp: Optional[float] = None
    note: str = ""


class UkEntityType(BaseModel):
    key: str
    name: str
    authority: str = Field(description="Registration authority (Companies House, HMRC, etc.)")
    recommended: bool = False
    description: str
    fee: UkFee = Field(default_factory=UkFee)
    ideal_for: List[str] = Field(default_factory=list)
    benefits: List[str] = Field(default_factory=list)


class UkEntityTypeGroup(BaseModel):
    title: str
    subtitle: str = ""
    items: List[UkEntityType]


class UkEntityTypesResponse(BaseModel):
    updated_year: int = 2024
    groups: List[UkEntityTypeGroup]


class UkNameCheckResponse(BaseModel):
    name: str
    available: bool
    exact_matches: List[str] = Field(default_factory=list)
    similar: List[str] = Field(default_factory=list)
    source: str = "companies_house_search"


class UkSicCode(BaseModel):
    code: str = Field(pattern=r"^\d{5}$")
    title: str


class UkSicSuggestRequest(BaseModel):
    description: str = Field(min_length=20, max_length=500)


class UkSicSuggestResponse(BaseModel):
    suggestions: List[UkSicCode]
    note: str = "UK SIC 2007 (ONS). Select exactly 4 SIC codes for Companies House registration."


class UkSicSearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=500)
    limit: int = Field(default=6, ge=1, le=6)


class UkSicSearchResponse(BaseModel):
    results: List[UkSicCode]
    source: str = "ons_uk_sic_2007_csv"
    note: str = "UK SIC 2007 (ONS). Select exactly 4 SIC codes for Companies House registration."
