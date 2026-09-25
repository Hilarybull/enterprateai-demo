from app.modules.workspace_profile.schemas import WorkspaceProfile
from app.modules.workspace_profile.service import _clean_answers, _defaults


def _build(answers: dict) -> WorkspaceProfile:
    cleaned = _clean_answers(answers)
    merged = {**_defaults(email="owner@example.test", company_name=cleaned.get("company_name") or "My workspace"), **cleaned}
    category = merged["primary_industry"]
    merged["services"] = [{"service_category": category, **s} for s in merged["services"]]
    return WorkspaceProfile.model_validate(merged)


def test_clean_drops_unknown_blank_and_short_values():
    cleaned = _clean_answers({
        "company_name": "  Acme Ltd ",
        "tagline": "   ",
        "is_admin": True,
        "services": [{"service_name": "Bookkeeping"}, {"service_name": "x"}, "Payroll"],
    })
    assert cleaned == {
        "company_name": "Acme Ltd",
        "services": [{"service_name": "Bookkeeping"}, {"service_name": "Payroll"}],
    }


def test_single_answer_produces_valid_profile_with_defaults():
    profile = _build({"company_name": "Acme Ltd"})
    assert profile.company_name == "Acme Ltd"
    assert profile.email == "owner@example.test"
    assert profile.business_type == "startup"
    assert profile.services == []


def test_answers_override_defaults_and_services_get_category():
    profile = _build({
        "company_name": "Acme Ltd",
        "primary_industry": "consulting",
        "country": "United Kingdom",
        "city": "London",
        "operating_stage": "growing",
        "services": [{"service_name": "Strategy review"}],
    })
    assert profile.country == "United Kingdom"
    assert profile.operating_stage == "growing"
    assert profile.services[0].service_category == "consulting"


def test_empty_answers_clean_to_nothing():
    assert _clean_answers({}) == {}
    assert _clean_answers({"company_name": "", "services": []}) == {}
