"""QA U6: the public feature pages say what is free and what is paid from the entitlement registry. The copy the
site reads (frontend/src/content/entitlements.json) is the registry itself; this fails the moment they differ."""
import json
from pathlib import Path

from app.modules.plans.capabilities import public_registry

SITE_COPY = Path(__file__).resolve().parents[2] / "frontend" / "src" / "content" / "entitlements.json"


def test_the_public_site_reads_the_registry_as_it_is():
    assert json.loads(SITE_COPY.read_text(encoding="utf-8")) == public_registry(), (
        "Regenerate it: cd backend && python -m app.modules.plans.capabilities > ../frontend/src/content/entitlements.json")
