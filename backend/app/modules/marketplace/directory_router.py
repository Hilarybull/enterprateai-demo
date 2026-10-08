"""Marketplace Business Index and Claim API (PRD-MKT-GTM-001 s15).

Public routes show only the public projection. Claim routes need a signed-in user and only ever
return that user's own claims. Business routes resolve the caller's authority in the business
first. One flag closes all of it without touching verified links, businesses or audit history.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from pydantic import BaseModel, Field

from app.modules.marketplace import directory as dir_mod
from app.modules.readiness.store import NotSetUp
from app.shared.auth.deps import get_current_user, get_optional_user

router = APIRouter(tags=["marketplace-directory"])


def get_service() -> dir_mod.DirectoryService:
    from app.modules.agent.router import get_orchestrator
    return dir_mod.service_for(get_orchestrator())


def enabled() -> bool:
    from app.core.config import get_settings
    return bool(get_settings().marketplace_claim_enabled)


def _on() -> None:
    if not enabled():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")


async def _run(coro):
    try:
        return await coro
    except dir_mod.NotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    except dir_mod.Forbidden as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except dir_mod.Invalid as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": "invalid", "message": str(e), "errors": e.errors})
    except dir_mod.Conflict as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": e.code, "message": e.message, **e.detail})
    except dir_mod.RateLimited:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail={"code": "rate_limited", "message": "That's been tried too many times. Please wait a while and try again."})
    except NotSetUp:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail={"code": "not_set_up", "message": "The business directory isn't set up on this server yet."})


class IntentIn(BaseModel):
    access: str | None = Field(default=None, max_length=200)
    opportunity_ref: str | None = Field(default=None, max_length=120)
    source: str | None = Field(default=None, max_length=80)
    invitation: str | None = Field(default=None, max_length=200)


class LookupIn(BaseModel):
    name: str = Field(max_length=160)
    company_number: str | None = Field(default=None, max_length=40)
    website: str | None = Field(default=None, max_length=200)


class VisibilityIn(BaseModel):
    unclaimed_visibility: str = Field(max_length=20)


class ClaimIn(BaseModel):
    access: str | None = Field(default=None, max_length=200)
    invitation: str | None = Field(default=None, max_length=200)
    intent: str | None = Field(default=None, max_length=200)
    opportunity_ref: str | None = Field(default=None, max_length=120)
    source: str | None = Field(default=None, max_length=80)


class MatchIn(BaseModel):
    business_id: str = Field(max_length=80)      # one of the caller's businesses, or "new"


class VerificationIn(BaseModel):
    method: str
    email: str | None = Field(default=None, max_length=200)
    note: str | None = Field(default=None, max_length=2000)


class CodeIn(BaseModel):
    code: str = Field(max_length=12)


class DecisionIn(BaseModel):
    decision: str
    reason: str = Field(max_length=2000)
    reason_category: str | None = Field(default=None, max_length=60)      # required to revoke


class ReportIn(BaseModel):
    kind: str
    message: str = Field(max_length=2000)
    email: str | None = Field(default=None, max_length=200)


class ReportDecisionIn(BaseModel):
    action: str
    reason: str = Field(max_length=2000)


class ProfilePatch(BaseModel):
    revision: int | None = None
    changes: dict[str, Any] = Field(default_factory=dict)
    claim_id: str | None = None


class PreferencesPatch(BaseModel):
    changes: dict[str, Any] = Field(default_factory=dict)
    claim_id: str | None = None


class ActivateIn(BaseModel):
    publish: bool = True


class DuplicateAnswerIn(BaseModel):
    profile_id: str = Field(max_length=120)
    answer: str = "not_mine"


class IndexIn(BaseModel):
    records: list[dict[str, Any]] = Field(max_length=2000)


class ProfileVisibilityIn(BaseModel):
    profiles: list[str] = Field(max_length=500)
    visibility: str = Field(max_length=20)
    reason: str = Field(default="", max_length=500)


class BusinessIn(BaseModel):
    record: dict[str, Any]
    allow_duplicate: bool = False


class ImportIn(BaseModel):
    records: list[dict[str, Any]] = Field(max_length=500)
    commit: bool = False


class EditIn(BaseModel):
    changes: dict[str, Any]
    reason: str = Field(default="", max_length=500)


class ListingReviewIn(BaseModel):
    decision: str
    reason: str = Field(default="", max_length=2000)


class ModerateIn(BaseModel):
    action: str
    reason: str = Field(max_length=2000)


class InvitationIn(BaseModel):
    by_hand: bool = False      # a link the moderator copies to pass on personally: nothing is sent
    reason: str = "profile_control"
    opportunity_ref: str | None = Field(default=None, max_length=120)
    send: bool = False


# ── public discovery ──────────────────────────────────────────────────────────

@router.get("/marketplace/businesses")
async def search_businesses(q: str = Query(default="", max_length=120), category: str = Query(default="", max_length=80),
                            location: str = Query(default="", max_length=80), trust: str = Query(default="", max_length=20),
                            open_for: str = Query(default="", max_length=20), page: int = Query(default=1, ge=1), page_size: int = Query(default=24, ge=1, le=60)):
    if not enabled():
        return {"enabled": False, "items": [], "total": 0, "categories": []}
    return {"enabled": True, **await _run(get_service().search(q=q, category=category, location=location, trust=trust, open_for=open_for, page=page, page_size=page_size))}


def _via(invite: str = Query(default="", max_length=200), access: str = Query(default="", max_length=200), intent: str = Query(default="", max_length=200)) -> dict:
    """What the caller presents to open a profile that isn't public: an invitation link's token, an
    exact-match lookup's grant, or the claim they started."""
    return {"invitation": invite or None, "access": access or None, "intent": intent or None}


@router.post("/marketplace/claim-lookup")
async def claim_lookup(body: LookupIn, request: Request, user=Depends(get_optional_user)):
    """Find and claim your business: an exact name with its company number or website. Limited per caller."""
    _on()
    client = f"user:{user['id']}" if user else f"ip:{request.client.host if request.client else 'unknown'}"
    return await _run(get_service().find_to_claim(name=body.name, company_number=body.company_number or "", website=body.website or "", client=client))


@router.get("/marketplace/sitemap.xml")
async def sitemap():
    """Profile pages search engines may list. Unclaimed profiles appear only when they are public."""
    if not enabled():
        return Response(content='<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>', media_type="application/xml")
    from xml.sax.saxutils import escape
    from app.core.config import get_settings
    base = str(get_settings().frontend_url or "").split(",")[0].strip().rstrip("/")
    urls = "".join(f"<url><loc>{escape(base)}/marketplace/business/{escape(slug)}</loc></url>" for slug in await _run(get_service().sitemap_slugs()))
    return Response(content=f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>', media_type="application/xml")


@router.get("/marketplace/businesses/{ref}")
async def read_business(ref: str, user=Depends(get_optional_user), via: dict = Depends(_via)):
    _on()
    return await _run(get_service().public_profile(ref, user, via))


@router.post("/marketplace/businesses/{ref}/view", status_code=202)
async def record_view(ref: str, user=Depends(get_optional_user), via: dict = Depends(_via)):
    _on()
    await _run(get_service().record_view(ref, user, via))
    return {"ok": True}


@router.post("/marketplace/businesses/{ref}/reports", status_code=201)
async def report_business(ref: str, body: ReportIn, user=Depends(get_optional_user), via: dict = Depends(_via)):
    """Correct a profile or ask for it to be unlisted. No account or claim is needed."""
    _on()
    return await _run(get_service().report(ref, kind=body.kind, message=body.message, reporter_email=body.email, viewer=user, via=via))


@router.post("/marketplace/directory-profiles/{ref}/claim-intents", status_code=201)
async def claim_intent(ref: str, body: IntentIn | None = None, user=Depends(get_optional_user)):
    """Before sign-in: keep which profile is being claimed, and why, on the server."""
    _on()
    body = body or IntentIn()
    return await _run(get_service().create_intent(ref, opportunity_ref=body.opportunity_ref, source=body.source, invitation_token=body.invitation, access=body.access, viewer=user))


@router.post("/marketplace/invitations/{token}/opt-out")
async def invitation_opt_out(token: str):
    return await _run(get_service().opt_out(token))      # honoured whether or not the feature is switched on


# ── claims ────────────────────────────────────────────────────────────────────

@router.post("/marketplace/directory-profiles/{ref}/claims", status_code=201)
async def start_claim(ref: str, body: ClaimIn | None = None, user=Depends(get_current_user)):
    _on()
    body = body or ClaimIn()
    return await _run(get_service().start_claim(user, ref, intent=body.intent, opportunity_ref=body.opportunity_ref, source=body.source, access=body.access, invitation=body.invitation))


@router.get("/business-claims")
async def my_claims(user=Depends(get_current_user)):
    if not enabled():
        return {"enabled": False, "items": []}
    return {"enabled": True, "items": await _run(get_service().my_claims(user))}


@router.get("/business-claims/{claim_id}")
async def read_claim(claim_id: str, user=Depends(get_current_user)):
    _on()
    return await _run(get_service().get_claim(user, claim_id))


@router.post("/business-claims/{claim_id}/match")
async def confirm_match(claim_id: str, body: MatchIn, user=Depends(get_current_user)):
    _on()
    return await _run(get_service().confirm_match(user, claim_id, body.business_id))


@router.post("/business-claims/{claim_id}/verification", status_code=201)
async def start_verification(claim_id: str, body: VerificationIn, user=Depends(get_current_user)):
    _on()
    return await _run(get_service().start_verification(user, claim_id, method=body.method, email=body.email, note=body.note))


@router.post("/business-claims/{claim_id}/verification/{verification_id}/complete")
async def complete_verification(claim_id: str, verification_id: str, body: CodeIn, user=Depends(get_current_user)):
    _on()
    return await _run(get_service().complete_verification(user, claim_id, verification_id, body.code))


@router.post("/business-claims/{claim_id}/verification/{verification_id}/evidence")
async def attach_evidence(claim_id: str, verification_id: str, file: UploadFile = File(...), user=Depends(get_current_user)):
    _on()
    content = await file.read(dir_mod.MAX_FILE_BYTES + 1)
    return await _run(get_service().attach_evidence(user, claim_id, verification_id, file.filename or "evidence", file.content_type or "application/octet-stream", content))


@router.post("/business-claims/{claim_id}/cancel")
async def cancel_claim(claim_id: str, user=Depends(get_current_user)):
    _on()
    return await _run(get_service().cancel_claim(user, claim_id))


@router.post("/business-claims/{claim_id}/handoff")
async def complete_handoff(claim_id: str, user=Depends(get_current_user)):
    _on()
    return await _run(get_service().complete_handoff(user, claim_id))


@router.get("/marketplace/claimable-businesses")
async def claimable(name: str = Query(default="", max_length=160), website: str = Query(default="", max_length=200),
                    company_number: str = Query(default="", max_length=40), user=Depends(get_current_user)):
    """Unclaimed profiles that may be the caller's business: link one instead of creating a duplicate."""
    if not enabled():
        return {"items": []}
    return {"items": await _run(get_service().claimable(user, name=name, website=website, company_number=company_number))}


# ── a business's Marketplace profile and opportunity settings ─────────────────

@router.get("/businesses/{business_id}/marketplace-profile")
async def read_marketplace_profile(business_id: str, user=Depends(get_current_user)):
    _on()
    return await _run(get_service().business_profile(user, business_id))


@router.patch("/businesses/{business_id}/marketplace-profile")
async def update_marketplace_profile(business_id: str, body: ProfilePatch, user=Depends(get_current_user)):
    _on()
    return await _run(get_service().update_profile(user, business_id, body.changes, body.revision, body.claim_id))


@router.patch("/businesses/{business_id}/marketplace-opportunity-preferences")
async def update_opportunity_preferences(business_id: str, body: PreferencesPatch, user=Depends(get_current_user)):
    _on()
    return await _run(get_service().update_preferences(user, business_id, body.changes, body.claim_id))


class DescribeIn(BaseModel):
    description: str = Field(default="", max_length=4000)
    service_area: str = Field(default="", max_length=200)
    service_tags: list[str] = Field(default_factory=list, max_length=40)


async def _write_with_ai(user_id: str, prompt: str) -> str:
    """One short piece of writing, charged as the other "AI fill" buttons are."""
    from app.modules.credits.service import credit_guard
    from app.modules.idea_validation.market_research_service import _call_claude, _call_openai
    async with credit_guard(user_id, "suggest_field"):
        try:
            result = await _call_claude(prompt, user_id=user_id, feature="suggest_field")
        except Exception:      # noqa: BLE001 - the second provider is the fallback
            result = await _call_openai(prompt, user_id=user_id, feature="suggest_field")
    return str((result or {}).get("suggestion") or (result or {}).get("text") or "")


@router.post("/businesses/{business_id}/marketplace-profile/suggest-description")
async def suggest_marketplace_description(business_id: str, body: DescribeIn | None = None, user=Depends(get_current_user)):
    """AI fill for the public description. Returns words for the form; nothing is saved or published."""
    _on()
    draft = (body or DescribeIn()).model_dump()
    return await _run(get_service().suggest_description(user, business_id, draft, lambda prompt: _write_with_ai(user["id"], prompt)))


@router.post("/businesses/{business_id}/marketplace-profile/suggest-services")
async def suggest_marketplace_services(business_id: str, body: DescribeIn | None = None, user=Depends(get_current_user)):
    """AI fill for Services. Returns a short comma-separated list for the form; nothing is saved."""
    _on()
    draft = (body or DescribeIn()).model_dump()
    return await _run(get_service().suggest_services(user, business_id, draft, lambda prompt: _write_with_ai(user["id"], prompt)))


@router.post("/businesses/{business_id}/marketplace-profile/activate")
async def activate_marketplace_profile(business_id: str, body: ActivateIn | None = None, user=Depends(get_current_user)):
    _on()
    return await _run(get_service().activate(user, business_id, publish=(body or ActivateIn()).publish))


@router.post("/businesses/{business_id}/marketplace-profile/verification", status_code=201)
async def verify_own_business(business_id: str, user=Depends(get_current_user)):
    """"Verify your business": starts (or resumes) verification of a profile the business made itself."""
    _on()
    return await _run(get_service().start_self_verification(user, business_id))


@router.post("/businesses/{business_id}/marketplace-profile/duplicate-answers")
async def answer_possible_duplicate(business_id: str, body: DuplicateAnswerIn, user=Depends(get_current_user)):
    """"This isn't my business": recorded for the business with who said it and when."""
    _on()
    return await _run(get_service().answer_duplicate(user, business_id, body.profile_id, body.answer))


# ── EnterprateAI staff: indexing, review, invitations (audited) ───────────────

@router.get("/admin/marketplace/access")
async def moderator_access(user=Depends(get_current_user)):
    """Whether the caller may use the moderation tools (so the page can say so rather than fail)."""
    return {"moderator": enabled() and dir_mod.DirectoryService.is_admin(user)}


@router.get("/admin/marketplace/settings")
async def read_settings(user=Depends(get_current_user)):
    return await _run(get_service().visibility_setting(user))


@router.put("/admin/marketplace/settings")
async def change_settings(body: VisibilityIn, user=Depends(get_current_user)):
    """Who can see unclaimed profiles. Kept on the server with who changed it and when."""
    return await _run(get_service().set_visibility(user, body.unclaimed_visibility))


@router.get("/admin/marketplace/directory/unclaimed")
async def unclaimed_profiles(user=Depends(get_current_user)):
    return await _run(get_service().unclaimed_profiles(user))


@router.post("/admin/marketplace/directory/index")
async def index_records(body: IndexIn, user=Depends(get_current_user)):
    if not dir_mod.DirectoryService.is_admin(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not available.")
    return await _run(get_service().index_records(body.records, actor=f"admin:{user['id']}"))


@router.post("/admin/marketplace/directory/normalise-locations")
async def normalise_locations(user=Depends(get_current_user)):
    """Reduce stored locations to a town or region and rebuild affected profile addresses (old ones keep working)."""
    return await _run(get_service().normalise_locations(user))


@router.get("/admin/marketplace/claims")
async def review_queue(status_: str = Query(default="pending", alias="status"), user=Depends(get_current_user)):
    return await _run(get_service().review_queue(user, status_))


@router.post("/business-claims/{claim_id}/review-decision")
async def review_decision(claim_id: str, body: DecisionIn, user=Depends(get_current_user)):
    return await _run(get_service().review_decision(user, claim_id, decision=body.decision, reason=body.reason, reason_category=body.reason_category))


@router.get("/admin/marketplace/verifications/{verification_id}/files/{index}")
async def evidence_file(verification_id: str, index: int, user=Depends(get_current_user)):
    f = await _run(get_service().evidence_file(user, verification_id, index))
    return Response(content=f["content"], media_type=f["content_type"],
                    headers={"Content-Disposition": f'attachment; filename="{f["name"].replace(chr(34), "")}"', "Cache-Control": "no-store"})


@router.post("/admin/marketplace/reports/{report_id}/resolve")
async def resolve_report(report_id: str, body: ReportDecisionIn, user=Depends(get_current_user)):
    return await _run(get_service().resolve_report(user, report_id, action=body.action, reason=body.reason))


@router.post("/admin/marketplace/directory-profiles/{ref}/invitations", status_code=201)
async def create_invitation(ref: str, body: InvitationIn, user=Depends(get_current_user)):
    return await _run(get_service().create_invitation(user, ref, reason=body.reason, opportunity_ref=body.opportunity_ref, send=body.send, by_hand=body.by_hand))


@router.post("/admin/marketplace/directory/visibility")
async def set_profile_visibility(body: ProfileVisibilityIn, user=Depends(get_current_user)):
    """One or many unclaimed profiles' own visibility (inherit | hidden | invite_only | public)."""
    return await _run(get_service().set_profile_visibility(user, body.profiles, body.visibility, body.reason))


@router.post("/admin/marketplace/directory/check")
async def check_business(body: BusinessIn, user=Depends(get_current_user)):
    """What saving this record would do, without saving it."""
    return await _run(get_service().check_business(user, body.record))


@router.post("/admin/marketplace/directory/businesses", status_code=201)
async def add_business(body: BusinessIn, user=Depends(get_current_user)):
    return await _run(get_service().add_business(user, body.record, allow_duplicate=body.allow_duplicate))


@router.post("/admin/marketplace/directory/import")
async def import_businesses(body: ImportIn, user=Depends(get_current_user)):
    """CSV rows: a preview unless `commit` is set."""
    return await _run(get_service().import_businesses(user, body.records, commit=body.commit))


@router.patch("/admin/marketplace/directory-profiles/{ref}")
async def edit_profile(ref: str, body: EditIn, user=Depends(get_current_user)):
    return await _run(get_service().edit_profile(user, ref, body.changes, body.reason))


@router.post("/admin/marketplace/listings/{ref}/review")
async def review_listing(ref: str, body: ListingReviewIn, user=Depends(get_current_user)):
    """Approve or suppress a newly published self-made profile."""
    return await _run(get_service().review_listing(user, ref, decision=body.decision, reason=body.reason))


@router.get("/admin/marketplace/directory-profiles/{ref}/sources")
async def profile_sources(ref: str, user=Depends(get_current_user)):
    return await _run(get_service().profile_sources(user, ref))


@router.post("/admin/marketplace/directory-profiles/{ref}/moderation")
async def moderate_profile(ref: str, body: ModerateIn, user=Depends(get_current_user)):
    """Suppress or restore a profile. The reason is kept."""
    return await _run(get_service().moderate_profile(user, ref, action=body.action, reason=body.reason))


@router.get("/admin/marketplace/funnel")
async def funnel(user=Depends(get_current_user)):
    return await _run(get_service().funnel(user))
