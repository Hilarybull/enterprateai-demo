"""Funding Readiness and Launch Readiness API (Funding PRD s11, Launch PRD s11).

Both features share one set of business-scoped routes. Every route resolves the caller's
authority inside the business first: no access, or a record that belongs to another business,
is a 404 and never data. Each feature has its own flag; switching one off closes its entry
points and leaves every draft and assessment where it is.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, Field

from app.modules.readiness import rules
from app.modules.readiness import service as svc_mod
from app.modules.readiness.store import NotSetUp
from app.shared.auth.deps import get_current_user

router = APIRouter(tags=["readiness"])

SEGMENTS = {"funding-cases": rules.FUNDING, "launch-initiatives": rules.LAUNCH}


def get_service() -> svc_mod.ReadinessService:
    from app.modules.agent.router import get_orchestrator
    return svc_mod.service_for(get_orchestrator())


def enabled(subject_type: str) -> bool:
    from app.core.config import get_settings
    s = get_settings()
    return bool(s.funding_readiness_enabled if subject_type == rules.FUNDING else s.launch_readiness_enabled)


def _type(segment: str) -> str:
    subject_type = SEGMENTS.get(segment)
    if not subject_type or not enabled(subject_type):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    return subject_type


def _feature(name: str | None) -> str:
    return rules.LAUNCH if name == "launch" else rules.FUNDING


async def _run(coro):
    try:
        return await coro
    except (svc_mod.Denied, svc_mod.NotFound):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    except svc_mod.Forbidden as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except svc_mod.Invalid as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"code": "invalid", "message": next(iter(e.errors.values())), "errors": e.errors})
    except svc_mod.Conflict as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": e.code, "message": e.message, "current": e.current})
    except svc_mod.Unavailable as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "unavailable", "message": str(e)})
    except NotSetUp:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail={"code": "not_set_up", "message": "Readiness checks aren't set up on this server yet."})


class SubjectIn(BaseModel):
    data: dict[str, Any] = Field(default_factory=dict)


class SubjectPatch(BaseModel):
    revision: int | None = None
    changes: dict[str, Any] = Field(default_factory=dict)
    confirm: list[str] = Field(default_factory=list, max_length=5)


class StatusIn(BaseModel):
    action: str
    reason: str | None = Field(default=None, max_length=2000)


class ForecastIn(BaseModel):
    revision: int | None = None
    forecast: dict[str, Any] = Field(default_factory=dict)


class ForecastLinkIn(BaseModel):
    forecast_id: str


class AttestIn(BaseModel):
    code: str = Field(max_length=20)
    passed: bool
    rationale: str = Field(max_length=4000)
    independent: bool = False


class AssessIn(BaseModel):
    revision: int | None = None
    idempotency_key: str | None = Field(default=None, max_length=120)


class ActionPatch(BaseModel):
    status: str | None = None
    owner: str | None = Field(default=None, max_length=200)
    due_date: str | None = None
    evidence_id: str | None = None
    rationale: str | None = Field(default=None, max_length=4000)
    reason: str | None = Field(default=None, max_length=4000)


class MaterialIn(BaseModel):
    kind: str
    assessment_id: str | None = None
    idempotency_key: str | None = Field(default=None, max_length=120)


class MaterialPatch(BaseModel):
    body: str | None = Field(default=None, max_length=60000)
    reviewed: bool | None = None
    revision: int | None = None


class DocumentIn(BaseModel):
    reviewed: bool | None = None
    evidence_id: str | None = None
    artifact_id: str | None = None


class ContradictionIn(BaseModel):
    description: str | None = Field(default=None, max_length=4000)
    resolve_id: str | None = None
    resolution: str | None = Field(default=None, max_length=4000)


class DecisionIn(BaseModel):
    decision: str
    rationale: str | None = Field(default=None, max_length=4000)
    assessment_id: str | None = None
    acknowledged_risks: list[str] = Field(default_factory=list, max_length=20)
    new_target_date: str | None = None


class LaunchIn(BaseModel):
    actual_date: str
    scope: str | None = Field(default=None, max_length=4000)
    acknowledge: bool = False


class EvidenceIn(BaseModel):
    data: dict[str, Any] = Field(default_factory=dict)


class EvidenceReviewIn(BaseModel):
    verification: str | None = None
    rationale: str = Field(max_length=4000)
    exception: bool = False


# ── availability ──────────────────────────────────────────────────────────────

@router.get("/readiness/profiles")
async def profiles(user=Depends(get_current_user)):
    """What can be checked today, and what is declared but not available yet."""
    return {"funding": {"enabled": enabled(rules.FUNDING), **svc_mod.ReadinessService.profiles(rules.FUNDING)},
            "launch": {"enabled": enabled(rules.LAUNCH), **svc_mod.ReadinessService.profiles(rules.LAUNCH)},
            "scenarios_enabled": svc_mod.ReadinessService.scenarios_enabled(),
            "evidence_types": rules.EVIDENCE_TYPES, "verification": rules.VERIFICATION}


# ── evidence and forecasts (shared by both features) ──────────────────────────

@router.get("/businesses/{business_id}/evidence")
async def list_evidence(business_id: str, user=Depends(get_current_user)):
    return {"items": await _run(get_service().list_evidence(user["id"], business_id, user.get("email")))}


@router.post("/businesses/{business_id}/evidence", status_code=201)
async def add_evidence(business_id: str, body: EvidenceIn, feature: str | None = Query(default=None), user=Depends(get_current_user)):
    return await _run(get_service().add_evidence(user["id"], business_id, body.data, user.get("email"), _feature(feature)))


@router.patch("/businesses/{business_id}/evidence/{evidence_id}")
async def update_evidence(business_id: str, evidence_id: str, body: EvidenceIn, feature: str | None = Query(default=None), user=Depends(get_current_user)):
    return await _run(get_service().update_evidence(user["id"], business_id, evidence_id, body.data, user.get("email"), _feature(feature)))


@router.post("/businesses/{business_id}/evidence/{evidence_id}/review")
async def review_evidence(business_id: str, evidence_id: str, body: EvidenceReviewIn, feature: str | None = Query(default=None), user=Depends(get_current_user)):
    return await _run(get_service().review_evidence(user["id"], business_id, evidence_id, verification=body.verification, rationale=body.rationale,
                                                    exception=body.exception, email=user.get("email"), feature=_feature(feature)))


@router.post("/businesses/{business_id}/evidence/{evidence_id}/file")
async def attach_evidence_file(business_id: str, evidence_id: str, file: UploadFile = File(...), feature: str | None = Query(default=None),
                               user=Depends(get_current_user)):
    content = await file.read(svc_mod.MAX_FILE_BYTES + 1)
    return await _run(get_service().attach_file(user["id"], business_id, evidence_id, file.filename or "attachment",
                                                file.content_type or "application/octet-stream", content, user.get("email"), _feature(feature)))


@router.get("/businesses/{business_id}/evidence/{evidence_id}/file")
async def download_evidence_file(business_id: str, evidence_id: str, user=Depends(get_current_user)):
    f = await _run(get_service().download_file(user["id"], business_id, evidence_id, user.get("email")))
    return Response(content=f["content"], media_type=f["content_type"],
                    headers={"Content-Disposition": f'attachment; filename="{f["name"].replace(chr(34), "")}"', "Cache-Control": "no-store"})


@router.get("/businesses/{business_id}/forecasts")
async def list_forecasts(business_id: str, user=Depends(get_current_user)):
    return {"items": await _run(get_service().list_forecasts(user["id"], business_id, user.get("email")))}


# ── funding cases and launch initiatives ──────────────────────────────────────

def _subject_routes(segment: str) -> APIRouter:
    """The same routes for each feature, under its own explicit path."""
    r = APIRouter(prefix="/businesses/{business_id}/" + segment)

    @r.get("")
    async def list_subjects(business_id: str, user=Depends(get_current_user)):
        if segment in SEGMENTS and not enabled(SEGMENTS[segment]):
            return {"enabled": False, "items": []}
        return {"enabled": True, **await _run(get_service().list_subjects(user["id"], business_id, _type(segment), user.get("email")))}


    @r.post("", status_code=201)
    async def create_subject(business_id: str, body: SubjectIn, user=Depends(get_current_user)):
        return await _run(get_service().create_subject(user["id"], business_id, _type(segment), body.data, user.get("email")))


    @r.get("/{subject_id}")
    async def read_subject(business_id: str, subject_id: str, user=Depends(get_current_user)):
        return await _run(get_service().get_subject(user["id"], business_id, _type(segment), subject_id, user.get("email")))


    @r.patch("/{subject_id}")
    async def update_subject(business_id: str, subject_id: str, body: SubjectPatch, user=Depends(get_current_user)):
        return await _run(get_service().update_subject(user["id"], business_id, _type(segment), subject_id, body.revision, body.changes,
                                                       user.get("email"), body.confirm))


    @r.post("/{subject_id}/status")
    async def set_status(business_id: str, subject_id: str, body: StatusIn, user=Depends(get_current_user)):
        return await _run(get_service().set_status(user["id"], business_id, _type(segment), subject_id, body.action, user.get("email"), body.reason))


    @r.put("/{subject_id}/forecast")
    async def save_forecast(business_id: str, subject_id: str, body: ForecastIn, user=Depends(get_current_user)):
        return await _run(get_service().save_forecast(user["id"], business_id, _type(segment), subject_id, body.forecast, body.revision, user.get("email")))


    @r.post("/{subject_id}/forecast/link")
    async def link_forecast(business_id: str, subject_id: str, body: ForecastLinkIn, user=Depends(get_current_user)):
        return await _run(get_service().link_forecast(user["id"], business_id, _type(segment), subject_id, body.forecast_id, user.get("email")))


    @r.post("/{subject_id}/attestations")
    async def attest(business_id: str, subject_id: str, body: AttestIn, user=Depends(get_current_user)):
        return await _run(get_service().attest(user["id"], business_id, _type(segment), subject_id, body.code, body.passed, body.rationale,
                                               body.independent, user.get("email")))


    @r.post("/{subject_id}/assessments", status_code=202)
    async def request_assessment(business_id: str, subject_id: str, body: AssessIn | None = None, user=Depends(get_current_user)):
        """Starts a check and returns its run. The run is saved with its input snapshot before it is
        calculated, so its status can be read back with the id at any time."""
        body = body or AssessIn()
        return await _run(get_service().request_assessment(user["id"], business_id, _type(segment), subject_id, revision=body.revision,
                                                           idempotency_key=body.idempotency_key, email=user.get("email")))


    @r.get("/{subject_id}/assessments")
    async def assessment_history(business_id: str, subject_id: str, user=Depends(get_current_user)):
        return {"items": await _run(get_service().history(user["id"], business_id, _type(segment), subject_id, user.get("email")))}


    @r.get("/{subject_id}/assessments/{assessment_id}")
    async def read_assessment(business_id: str, subject_id: str, assessment_id: str, user=Depends(get_current_user)):
        return await _run(get_service().get_assessment(user["id"], business_id, _type(segment), subject_id, assessment_id, user.get("email")))


    @r.patch("/{subject_id}/actions/{action_id}")
    async def update_action(business_id: str, subject_id: str, action_id: str, body: ActionPatch, user=Depends(get_current_user)):
        return await _run(get_service().update_action(user["id"], business_id, _type(segment), subject_id, action_id,
                                                      body.model_dump(exclude_unset=True), user.get("email")))


    @r.post("/{subject_id}/scenarios")
    async def run_scenario(business_id: str, subject_id: str, body: dict[str, Any], user=Depends(get_current_user)):
        return await _run(get_service().scenario(user["id"], business_id, _type(segment), subject_id, body, user.get("email")))


    @r.get("/{subject_id}/materials")
    async def list_materials(business_id: str, subject_id: str, user=Depends(get_current_user)):
        return await _run(get_service().list_materials(user["id"], business_id, _type(segment), subject_id, user.get("email")))


    @r.post("/{subject_id}/materials", status_code=201)
    async def generate_material(business_id: str, subject_id: str, body: MaterialIn, user=Depends(get_current_user)):
        return await _run(get_service().generate_material(user["id"], business_id, _type(segment), subject_id, body.kind, assessment_id=body.assessment_id,
                                                          idempotency_key=body.idempotency_key, email=user.get("email")))


    @r.get("/{subject_id}/materials/{artifact_id}")
    async def read_material(business_id: str, subject_id: str, artifact_id: str, user=Depends(get_current_user)):
        return await _run(get_service().get_material(user["id"], business_id, _type(segment), subject_id, artifact_id, user.get("email")))


    @r.patch("/{subject_id}/materials/{artifact_id}")
    async def update_material(business_id: str, subject_id: str, artifact_id: str, body: MaterialPatch, user=Depends(get_current_user)):
        return await _run(get_service().update_material(user["id"], business_id, _type(segment), subject_id, artifact_id, body=body.body,
                                                        reviewed=body.reviewed, revision=body.revision, email=user.get("email")))


    @r.get("/{subject_id}/materials/{artifact_id}/download")
    async def download_material(business_id: str, subject_id: str, artifact_id: str, format: str = Query(default="pdf", pattern="^(pdf|txt)$"),
                                user=Depends(get_current_user)):
        f = await _run(get_service().download_material(user["id"], business_id, _type(segment), subject_id, artifact_id, format, user.get("email")))
        return Response(content=f["content"], media_type=f["content_type"],
                        headers={"Content-Disposition": f'attachment; filename="{f["name"]}"', "Cache-Control": "no-store"})

    return r


for _segment in SEGMENTS:
    router.include_router(_subject_routes(_segment))


# ── funding only ──────────────────────────────────────────────────────────────

@router.post("/businesses/{business_id}/funding-cases/{subject_id}/documents/{key}")
async def review_document(business_id: str, subject_id: str, key: str, body: DocumentIn | None = None, user=Depends(get_current_user)):
    body = body or DocumentIn()
    _type("funding-cases")
    return await _run(get_service().review_document(user["id"], business_id, subject_id, key, reviewed=body.reviewed, evidence_id=body.evidence_id,
                                                    artifact_id=body.artifact_id, email=user.get("email"),
                                                    attach=bool({"evidence_id", "artifact_id"} & body.model_fields_set)))


@router.post("/businesses/{business_id}/funding-cases/{subject_id}/contradictions")
async def contradiction(business_id: str, subject_id: str, body: ContradictionIn, user=Depends(get_current_user)):
    _type("funding-cases")
    return await _run(get_service().contradiction(user["id"], business_id, subject_id, description=body.description, resolve_id=body.resolve_id,
                                                  resolution=body.resolution, email=user.get("email")))


# ── launch only ───────────────────────────────────────────────────────────────

@router.post("/businesses/{business_id}/launch-initiatives/{subject_id}/decisions")
async def record_decision(business_id: str, subject_id: str, body: DecisionIn, user=Depends(get_current_user)):
    """Proceed, defer or cancel. Records intent only: nothing is published, charged or marked as launched."""
    _type("launch-initiatives")
    return await _run(get_service().record_decision(user["id"], business_id, subject_id, decision=body.decision, rationale=body.rationale or "",
                                                    assessment_id=body.assessment_id, acknowledged_risks=body.acknowledged_risks,
                                                    new_target_date=body.new_target_date, email=user.get("email")))


@router.post("/businesses/{business_id}/launch-initiatives/{subject_id}/launch")
async def record_launch(business_id: str, subject_id: str, body: LaunchIn, user=Depends(get_current_user)):
    _type("launch-initiatives")
    return await _run(get_service().record_launch(user["id"], business_id, subject_id, actual_date=body.actual_date, scope=body.scope or "",
                                                  acknowledge=body.acknowledge, email=user.get("email")))
