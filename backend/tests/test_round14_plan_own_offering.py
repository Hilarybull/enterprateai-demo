"""A launch plan's suggestions are about its own offering, never the profile's main one (the owner, 30 Oct: "Clean cars for
Abuja office workers" and "office workers" on the Rango marketplace app plan)."""
from datetime import date

from app.modules.readiness.service import ReadinessService

DATA = {"workspace_profile": {"key_offering_focus": "Car wash subscription", "services": [{"service_name": "Car wash subscription"}],
                              "tagline": "Clean cars for Abuja office workers", "target_customer_type": "office workers",
                              "problem": "No time to wash their cars", "city": "Abuja", "country": "Nigeria"}}


def test_another_offering_never_takes_the_profiles_tagline_customers_or_problem():
    out = ReadinessService._launch_proposals({"name": "Rango marketplace app"}, DATA, date(2026, 10, 30))
    assert out["offer.launch_scope"][0] == "Rango marketplace app"
    for path in ("offer.customer_promise", "customers.problem", "customers.target_segment", "audience", "market.audience"):
        assert path not in out, path
    assert "office workers" not in out["market.message"][0] and "Clean cars" not in out["market.message"][0]


def test_the_main_offering_still_uses_its_profile():
    out = ReadinessService._launch_proposals({"name": "Car wash subscription"}, DATA, date(2026, 10, 30))
    assert out["offer.customer_promise"][0] == "Clean cars for Abuja office workers"
    assert out["audience"][0] == "office workers"
