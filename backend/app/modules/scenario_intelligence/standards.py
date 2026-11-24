"""Register of every standard figure, rate and threshold the simulation uses: value, where it lives in the code, its
source, how well it is evidenced, and when it was last reviewed. Simulation audit, Phase 7.

* tests/test_simulation_phase7.py checks that every value here equals the constant in the code, so the register and the
  model cannot drift apart.
* The release gate (scripts/simulation_release_gate.py) fails when a review is overdue (REVIEW_EVERY_MONTHS).
* Evidence: "published" (an authority's published rate or a peer-reviewed method), "calibrated" (set on data and checked
  on separate data), "practice" (common practice, no single source), "own choice" (our decision, to calibrate from
  tracked accuracy). REFERENCES.md holds the citations.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List

REVIEW_EVERY_MONTHS = 12
REVIEWED = date(2026, 11, 21)

STANDARDS: List[Dict[str, Any]] = [
    # Country rules (factors.py): published, change every tax year
    dict(name="UK employer National Insurance rate", value=0.15, code="factors.UK_NI_RATE", evidence="published", source="HMRC, from 6 April 2025"),
    dict(name="UK NI secondary threshold (a year)", value=5000.0, code="factors.UK_NI_THRESHOLD_YEAR", evidence="published", source="HMRC, from 6 April 2025"),
    dict(name="UK auto-enrolment employer pension", value=0.03, code="factors.UK_PENSION_RATE", evidence="published", source="The Pensions Regulator, 2025/26"),
    dict(name="UK qualifying earnings, lower (a year)", value=6240.0, code="factors.UK_QE_LOWER_YEAR", evidence="published", source="The Pensions Regulator, 2025/26"),
    dict(name="UK qualifying earnings, upper (a year)", value=50270.0, code="factors.UK_QE_UPPER_YEAR", evidence="published", source="The Pensions Regulator, 2025/26"),
    dict(name="Nigeria employer pension", value=0.10, code="factors.NG_PENSION_RATE", evidence="published", source="Pension Reform Act 2014; PenCom"),
    dict(name="Nigeria NSITF", value=0.01, code="factors.NG_NSITF_RATE", evidence="published", source="Employees' Compensation Act 2010"),
    dict(name="Nigeria ITF", value=0.01, code="factors.NG_ITF_RATE", evidence="published", source="Industrial Training Fund Act"),
    dict(name="US employer FICA", value=0.0765, code="factors.US_FICA_RATE", evidence="published", source="IRS"),
    dict(name="US FUTA net rate", value=0.006, code="factors.US_FUTA_RATE", evidence="published", source="IRS (6.0% less 5.4% credit)"),
    dict(name="US FUTA wage base (a year)", value=7000.0, code="factors.US_FUTA_WAGE_BASE_YEAR", evidence="published", source="IRS"),
    dict(name="UK corporation tax small profits rate", value=0.19, code="factors.UK_SMALL_RATE", evidence="published", source="HMRC, from 1 April 2023"),
    dict(name="UK corporation tax main rate", value=0.25, code="factors.UK_MAIN_RATE", evidence="published", source="HMRC, from 1 April 2023"),
    dict(name="UK marginal relief fraction", value=3 / 200, code="factors.UK_MR_FRACTION", evidence="published", source="HMRC"),
    # Methods
    dict(name="Trend significance (|t|)", value=2.0, code="baseline.TREND_T_THRESHOLD", evidence="published", source="Student's t, about 95%"),
    dict(name="Trend damping", value=0.9, code="baseline.TREND_DAMPING", evidence="published", source="Gardner & McKenzie (1985); common range 0.8-0.98"),
    dict(name="Seasonality test level", value=0.01, code="baseline.SEASONAL_ALPHA", evidence="published", source="F-test for stable seasonality (X-11 / X-13ARIMA-SEATS)"),
    dict(name="Unusual month (modified z)", value=3.5, code="quality.MODIFIED_Z_LIMIT", evidence="published", source="Iglewicz & Hoaglin (1993)"),
    dict(name="Forecast range z (90%)", value=1.645, code="uncertainty.FORECAST_Z", evidence="published", source="Normal distribution"),
    dict(name="Forecast range calibration", value=1.4, code="uncertainty.RANGE_CALIBRATION", evidence="calibrated", source="07-phase4-changes.md: set on one mock set, 94% on a holdout set"),
    # Defaults
    dict(name="Customer payment terms when none recorded (days)", value=30, code="projection.DEFAULT_PAYMENT_TERMS_DAYS", evidence="practice", source="Common invoice terms"),
    dict(name="Customer price sensitivity", value=-1.0, code="projection.DEFAULT_PRICE_ELASTICITY", evidence="practice", source="Meta-analyses: Tellis (1988) about -1.8; Bijmolt et al. (2005) about -2.6 (to cite)"),
    dict(name="Employer on-costs, other countries (%)", value=15.0, code="projection.DEFAULT_ONCOST_PCT", evidence="own choice", source="Typical 10-25% (to cite)"),
    dict(name="New-hire ramp-up (months)", value=3, code="projection.DEFAULT_HIRE_RAMP_MONTHS", evidence="own choice", source="Standard onboarding assumption"),
    dict(name="Revenue range with no history", value=0.15, code="uncertainty.DEFAULT_REVENUE_SWING", evidence="own choice", source="To calibrate from tracked accuracy"),
    dict(name="Cost range with no history", value=0.10, code="uncertainty.DEFAULT_COST_SWING", evidence="own choice", source="To calibrate from tracked accuracy"),
    dict(name="Verdict materiality (share of revenue)", value=0.01, code="projection.MATERIALITY_SHARE", evidence="own choice", source="MODEL.md section 7"),
    dict(name="Confidence: wide range (-1)", value=0.20, code="uncertainty.WIDE_RANGE", evidence="own choice", source="Set before testing; checked on mock data (07)"),
    dict(name="Confidence: very wide range (-2)", value=0.35, code="uncertainty.VERY_WIDE_RANGE", evidence="own choice", source="Set before testing; checked on mock data (07)"),
    # Monitoring thresholds (monitoring.py)
    dict(name="Review threshold: WAPE (%)", value=25.0, code="monitoring.WAPE_LIMIT", evidence="own choice", source="MODEL.md section 9"),
    dict(name="Review threshold: bias (±%)", value=10.0, code="monitoring.BIAS_LIMIT", evidence="own choice", source="MODEL.md section 9"),
    dict(name="Review threshold: range coverage floor (%)", value=80.0, code="monitoring.COVERAGE_FLOOR", evidence="own choice", source="Below the 90% the range aims for"),
]


def overdue(today: date | None = None) -> List[str]:
    """Names of standards whose review is overdue (all share one review date; a review re-dates REVIEWED)."""
    today = today or date.today()
    months = (today.year - REVIEWED.year) * 12 + today.month - REVIEWED.month - (1 if today.day < REVIEWED.day else 0)
    return [s["name"] for s in STANDARDS] if months >= REVIEW_EVERY_MONTHS else []


def register() -> Dict[str, Any]:
    by_evidence: Dict[str, int] = {}
    for s in STANDARDS:
        by_evidence[s["evidence"]] = by_evidence.get(s["evidence"], 0) + 1
    return dict(reviewed=REVIEWED.isoformat(), review_every_months=REVIEW_EVERY_MONTHS, standards=STANDARDS, by_evidence=by_evidence)
