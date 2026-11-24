"""The C5/C7 data fix's finder, on synthetic workspaces: only what provably wasn't the owner's choice is changed."""
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location("fixdata", Path(__file__).resolve().parents[1] / "scripts" / "fix_timezones_and_wizard_defaults.py")
fixdata = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fixdata)


def ws(i, profile, draft=None):
    return {"id": f"w{i}", "data": {"workspace_profile": profile, **({"draft_idea_validation": draft} if draft is not None else {})}}


def test_only_provable_defaults_change_and_the_rest_wait_for_the_owner():
    found = fixdata.plan_fixes([
        ws(1, {"country": "United Kingdom", "timezone": "Africa/Lagos", "timezone_source": "browser"}),      # set by a browser: changed
        ws(2, {"country": "United Kingdom", "timezone": "Africa/Lagos"}),                                    # nobody knows who: asked
        ws(3, {"country": "United Kingdom", "timezone": "Europe/London"}),                                   # right already
        ws(4, {"country": "United Kingdom"}, {"context": {"business_type_category": "Technology", "primary_industry_category": "IT"},
                                              "problem": {"customer_segment_category": "SMEs"}}),
        ws(5, {"country": "Nigeria", "business_type": "Technology"}, {"context": {"business_type_category": "Technology", "business_type_other": ""}}),
        ws(6, {"country": "Nigeria"}, {"context": {"business_type_category": "Technology", "business_type_other": "Cleaning"}}),   # their own words beside it
    ])
    changed = {(c["workspace"], c["what"]) for c in found["changes"]}
    asked = {(c["workspace"], c["what"]) for c in found["confirm"]}
    assert changed == {("w1", "timezone"), ("w4", "draft context.business_type_category"), ("w4", "draft context.primary_industry_category")}
    assert asked == {("w2", "timezone"), ("w4", "draft problem.customer_segment_category"), ("w5", "draft context.business_type_category")}
    fixed = fixdata.apply_to({"workspace_profile": {"timezone": "Africa/Lagos"}, "draft_idea_validation": {"context": {"business_type_category": "Technology"}}},
                             [c for c in found["changes"] if c["workspace"] in ("w1", "w4")])
    assert fixed["workspace_profile"]["timezone"] == "Europe/London" and fixed["draft_idea_validation"]["context"]["business_type_category"] == ""
