"""The model's version and what changed, in plain words, for the page's model-update notices (Phase 6, model 1.6).
MODEL.md section 12 holds the full change log; keep the two in step (change control, MODEL.md section 10)."""
from __future__ import annotations

from typing import Any, Dict, List

from app.modules.scenario_intelligence.projection import MODEL_VERSION

CHANGES: List[Dict[str, Any]] = [
    dict(version="projection-1.6", date="2026-11-21", summary=[
        "A data check before each projection: gaps, unusual months, possible duplicates, uncategorised or undated records.",
        "Several changes can be simulated together (for example a price rise and a new hire).",
        "Saved runs can be checked to reproduce exactly, and compared side by side."]),
    dict(version="projection-1.5", date="2026-11-21", summary=[
        "Figures come straight from your invoices, expenses and settings, so nothing is entered twice.",
        "Payment time is how fast your customers actually pay; sales are by invoice date, excluding VAT.",
        "This month is shown (recorded so far plus the rest), and every figure says how it was calculated."]),
    dict(version="projection-1.4", date="2026-11-20", summary=[
        "Funding, payroll with employer costs by country, owner drawings and dividends, equipment, unpaid sales and UK "
        "corporation tax are included."]),
    dict(version="projection-1.3", date="2026-11-20", summary=[
        "Seasonal patterns only when they are real; a 90% forecast range; confidence reflects how predictable sales are."]),
    dict(version="projection-1.2", date="2026-11-17", summary=["Ranges, sensitivity, input sources, confidence and accuracy tracking."]),
    dict(version="projection-1.1", date="2026-11-17", summary=["Complete-month baseline, customers' response to price, tax, VAT and loans."]),
    dict(version="projection-1.0", date="2026-11-16", summary=["Cash that collects what is owed; one verdict rule."]),
]


def info() -> Dict[str, Any]:
    return dict(version=MODEL_VERSION, changes=CHANGES,
                note="Results saved with an earlier version were worked out by the rules of that version; run them again to "
                     "see them with the current one.")


def changes_since(version: str | None) -> List[str]:
    """Plain-word changes made after `version` (all of them when it is unknown)."""
    out: List[str] = []
    for c in CHANGES:
        if c["version"] == version:
            break
        out.extend(c["summary"])
    return out
