"""The business stages, in one place (QA R10, PRD taxonomy: idea / pre-launch / startup / operating / growth).

    idea        an idea, nothing built yet
    pre_launch  getting ready to sell: offer, plan, registration, no revenue yet
    startup     early revenue: selling, but young (from onboarding's "Early revenue")
    operating   trading steadily, shown by the records (invoices issued, payments received)
    growth      revenue rising quarter on quarter (records)

How a stage is decided (dashboard.stage_of):
  1. a stage the owner chose on the dashboard ("Not right? Change it") wins;
  2. otherwise the stage given at onboarding is used, unless the records show the business is further on;
  3. otherwise the stage read from the records.
The records can only move a business forward from what it said: "Early revenue" with invoices on record is
"operating" (the records prove it); "Early revenue" with no invoices yet stays "startup".
"""
from __future__ import annotations

STAGES = ("idea", "pre_launch", "startup", "operating", "growth")
STAGE_LABEL = {"idea": "Idea", "pre_launch": "Pre-launch", "startup": "Startup", "operating": "Operating", "growth": "Growth"}
PATHWAY_OF = {"idea": "startup", "pre_launch": "startup", "startup": "startup", "operating": "small_business", "growth": "small_business"}

# Onboarding's "Business stage" answer (workspace profile `operating_stage`) → the stage above.
DECLARED_STAGE = {"idea": "idea", "pre_revenue": "pre_launch", "early_revenue": "startup", "established": "operating",
                  "growing": "growth", "growth": "growth"}
DECLARED_LABEL = {"idea": "Just an idea", "pre_revenue": "Pre-revenue", "early_revenue": "Early revenue", "growing": "Growing",
                  "growth": "Growing", "established": "Established"}

# A stage saved on the dashboard before "startup" existed meant pre-launch: read that way (saved choices carry v2 now).
LEGACY_CHOICE = {"startup": "pre_launch"}
CHOICE_VERSION = 2


def further(a: str, b: str) -> bool:
    """Whether stage a is further on than stage b."""
    return STAGES.index(a) > STAGES.index(b)
