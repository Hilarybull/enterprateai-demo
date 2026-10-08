"""The shared readiness service: funding cases, launch initiatives, evidence, the forecast,
assessments, actions, decisions and summaries (Blueprint s4-5 and s10; Funding PRD; Launch PRD).

Everything is scoped to one business and checks the caller's authority there first. A record
that belongs to another business is reported as not found, never described. A case or
initiative owns its own assumptions: editing one never changes a business record, and a
scenario changes nothing at all. Readiness changes only when an assessment is run again.
"""
from __future__ import annotations

import copy
import logging
import uuid
from datetime import date, datetime, timezone
import asyncio
from typing import Any, Awaitable, Callable

from app.modules.agent import business as bz
from app.modules.readiness import engine, rules
from app.modules.readiness import forecast as fc
from app.modules.readiness.store import Duplicate, MemoryStore, Store

logger = logging.getLogger(__name__)

EVENT_SCHEMA = 1
MAX_TEXT = 4000
MAX_LIST = 60
MAX_FILE_BYTES = 10 * 1024 * 1024
FILE_TYPES = {"application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "text/plain": "txt", "text/csv": "csv",
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx"}

CORE_FIELDS = {
    rules.FUNDING: ("title", "route", "jurisdiction", "business_model", "stage", "target_amount", "currency", "receipt_date", "timing_confirmed",
                    "purpose", "purpose_milestone_id", "milestones", "use_of_funds", "market", "traction", "economics", "team", "risks",
                    "no_known_risks", "pinned", "owner"),
    rules.LAUNCH: ("name", "launch_type", "scope", "business_model", "offerings", "audience", "geography", "target_date", "planned_volume",
                   "customers", "offer", "economics", "delivery", "operations", "prerequisites", "no_prerequisites", "no_prerequisites_rationale",
                   "market", "control", "pinned", "owner", "previous_initiative_id"),
}
DATE_FIELDS = {
    rules.FUNDING: ("receipt_date", "traction.results_through"),
    rules.LAUNCH: ("target_date", "operations.dry_run.date", "control.review_date"),
}
AMOUNT_FIELDS = {
    rules.FUNDING: ("target_amount", "economics.price", "economics.direct_cost", "economics.fixed_costs_monthly"),
    rules.LAUNCH: ("offer.price", "economics.price_per_unit", "economics.variable_cost_per_unit", "economics.fixed_costs_monthly", "market.budget",
                   "planned_volume.amount", "delivery.capacity_available", "delivery.capacity_committed", "delivery.capacity_per_unit"),
}
LIST_FIELDS = {
    rules.FUNDING: {"milestones": ("due_date",), "use_of_funds": (), "team.responsibilities": (), "team.gaps": (), "risks": ()},
    rules.LAUNCH: {"prerequisites": ("required_by", "valid_until"), "delivery.dependencies": (), "control.milestones": ("due_date",), "offerings": ()},
}
FEATURE = {rules.FUNDING: "funding", rules.LAUNCH: "launch"}


class Denied(Exception):
    """No access to this business."""


class Forbidden(Exception):
    """The caller's role doesn't include this capability."""


class NotFound(Exception):
    pass


class Invalid(Exception):
    def __init__(self, errors: dict[str, str] | str):
        self.errors = errors if isinstance(errors, dict) else {"_": errors}
        super().__init__("; ".join(self.errors.values()))


class Conflict(Exception):
    def __init__(self, code: str, message: str, current: dict | None = None):
        self.code, self.message, self.current = code, message, current
        super().__init__(message)


class Unavailable(Exception):
    """A profile or capability that has not been released."""


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


def _deep_merge(base: Any, patch: Any) -> Any:
    """Dicts merge key by key; lists and values replace."""
    if isinstance(base, dict) and isinstance(patch, dict):
        out = dict(base)
        for k, v in patch.items():
            out[k] = _deep_merge(base.get(k), v)
        return out
    return copy.deepcopy(patch)


def _set(data: dict, path: str, value: Any) -> None:
    parts = path.split(".")
    cur = data
    for p in parts[:-1]:
        if not isinstance(cur.get(p), dict):
            cur[p] = {}
        cur = cur[p]
    cur[parts[-1]] = value


def _clean(value: Any, depth: int = 0) -> Any:
    """Trim strings, cap sizes, drop anything that isn't plain data."""
    if isinstance(value, str):
        return value.strip()[:MAX_TEXT]
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    if isinstance(value, list) and depth < 4:
        return [_clean(v, depth + 1) for v in value[:MAX_LIST]]
    if isinstance(value, dict) and depth < 4:
        return {str(k)[:60]: _clean(v, depth + 1) for k, v in list(value.items())[:80]}
    return None


def _known_fields(subject_type: str, payload: dict | None) -> None:
    unknown = sorted(str(k) for k in (payload or {}) if k not in CORE_FIELDS[subject_type])
    if unknown:
        raise Invalid({k: f"Unknown field: {k}. Send nested values inside their parent, for example {{\"market\": {{...}}}}." for k in unknown})


def _evidence_ids(value: Any) -> set[str]:
    out: set[str] = set()
    if isinstance(value, dict):
        for k, v in value.items():
            if k == "evidence_id" and v:
                out.add(str(v))
            else:
                out |= _evidence_ids(v)
    elif isinstance(value, list):
        for v in value:
            out |= _evidence_ids(v)
    return out


class ReadinessService:
    def __init__(self, *, store: Store, business: bz.Business, policy_of: Callable[[str], Awaitable[dict]] | None = None,
                 clock: Callable[[], datetime] = now_utc, emit: Callable[[dict], Awaitable[None]] | None = None):
        self.store, self.business, self.clock = store, business, clock
        self._policy_of, self._emit = policy_of, emit
        self.during_run: Callable[[dict], Awaitable[None]] | None = None      # test hook: something changes mid-assessment

    # ── access ────────────────────────────────────────────────────────────────

    async def _ctx(self, user_id: str, business_id: str, email: str | None = None) -> dict:
        async def no_policy() -> dict:
            return {}
        try:
            # The settings and the business record are fetched side by side.
            policy, record = await asyncio.gather(self._policy_of(business_id) if self._policy_of else no_policy(), self.business.record(business_id))
            actor = await self.business.actor(user_id, business_id, policy or {}, email)
        except bz.BusinessAccessDenied as e:
            raise Denied(str(e)) from e
        now = self.clock()
        return {"actor": actor, "data": record["data"], "now": now, "today": bz.local_now(record["data"], now).date(), "business_id": business_id}

    @staticmethod
    def can(actor, subject_type: str) -> dict:
        """Capabilities, mapped onto the roles the business already has (no second role system)."""
        f = FEATURE[subject_type]
        senior = bool(actor.is_owner or actor.can_send)
        caps = {f"{f}.read": bool(actor.can_view), f"{f}.edit": bool(actor.can_prepare), f"{f}.assess": bool(actor.can_prepare),
                f"{f}.review": senior, f"{f}.export": bool(actor.can_prepare), "business.membership.manage": bool(actor.is_owner)}
        if subject_type == rules.LAUNCH:
            caps["launch.decide"] = senior
        return caps

    def _need(self, ctx: dict, subject_type: str, capability: str) -> None:
        if not self.can(ctx["actor"], subject_type).get(f"{FEATURE[subject_type]}.{capability}"):
            raise Forbidden("Your role in this business doesn't allow that.")

    async def _row(self, coll: str, business_id: str, record_id: str, kind: str | None = None) -> dict:
        try:
            uuid.UUID(str(record_id))
        except ValueError:
            raise NotFound()
        row = await self.store.get(coll, str(record_id))
        if not row or row["business_id"] != business_id or (kind and row.get("kind") != kind):
            raise NotFound()      # another business's record is simply not there
        return row

    async def emit(self, ctx: dict, type_: str, subject: dict | None, payload: dict | None = None, correlation: str | None = None, causation: str | None = None) -> None:
        if not self._emit:
            return
        try:
            await self._emit({"id": new_id(), "business_id": ctx["business_id"], "type": type_, "schema_version": EVENT_SCHEMA,
                              "correlation_id": correlation or new_id(), "causation_id": causation,
                              "payload": {"subject_type": subject.get("kind") if subject else None, "subject_id": subject.get("id") if subject else None,
                                          **(payload or {})}, "created_at": ctx["now"]})
        except Exception:      # noqa: BLE001 - an event that can't be recorded never fails the action
            logger.warning("readiness event %s could not be recorded", type_)

    # ── validation ────────────────────────────────────────────────────────────

    def _validate(self, subject_type: str, data: dict, before: dict | None = None) -> dict:
        errors: dict[str, str] = {}
        for path in DATE_FIELDS[subject_type]:
            v = engine.get(data, path)
            if not engine.blank(v) and engine.parse_day(v) is None:
                errors[path] = "Enter a valid date."
        for path in AMOUNT_FIELDS[subject_type]:
            v = engine.get(data, path)
            try:
                d = fc.dec(v)
            except fc.Invalid:
                errors[path] = "Enter a number."
                continue
            if d is not None and d < 0:
                errors[path] = "This can't be negative."
        if subject_type == rules.LAUNCH and not {"delivery.capacity_available", "delivery.capacity_committed"} & set(errors):
            available, committed = (fc.dec(engine.get(data, f"delivery.capacity_{k}")) for k in ("available", "committed"))
            was = engine.get(before or {}, "delivery") or {}
            touched = any(str(was.get(f"capacity_{k}") or "") != str(engine.get(data, f"delivery.capacity_{k}") or "") for k in ("available", "committed"))
            # Rejected when it is being entered. A record that already holds it can still be saved for other edits; the check reports it.
            if available is not None and committed is not None and committed > available and (before is None or touched):
                errors["delivery.capacity_committed"] = engine.OVERCOMMITTED
        for path, date_keys in LIST_FIELDS[subject_type].items():
            items = engine.get(data, path)
            if items is None:
                continue
            if not isinstance(items, list):
                errors[path] = "This should be a list."
                continue
            for i, item in enumerate(items):
                if not isinstance(item, dict):
                    errors[f"{path}.{i}"] = "This entry isn't valid."
                    continue
                item.setdefault("id", new_id())
                if not item["id"]:
                    item["id"] = new_id()
                for key in date_keys:
                    if not engine.blank(item.get(key)) and engine.parse_day(item.get(key)) is None:
                        errors[f"{path}.{i}.{key}"] = "Enter a valid date."
                if "amount" in item:
                    try:
                        amount = fc.dec(item.get("amount"))
                        if amount is not None and amount < 0:
                            errors[f"{path}.{i}.amount"] = "This can't be negative."
                    except fc.Invalid:
                        errors[f"{path}.{i}.amount"] = "Enter a number."
                if "period" in item and not engine.blank(item.get("period")) and fc.parse_month(item.get("period")) is None:
                    errors[f"{path}.{i}.period"] = "Enter a month."
        if subject_type == rules.FUNDING:
            cur = str(data.get("currency") or "").upper()
            if cur and cur not in rules.SUPPORTED_CURRENCIES:
                errors["currency"] = f"{cur} isn't supported yet. Choose one of {', '.join(rules.SUPPORTED_CURRENCIES)}."
            data["currency"] = cur or None
            if engine.blank(data.get("title")):
                errors["title"] = "Give the case a name."
        else:
            if engine.blank(data.get("name")):
                errors["name"] = "Give the launch a name."
            for path, label in (("control.milestones", "milestone"), ("prerequisites", "prerequisite")):
                items = [x for x in engine.get(data, path) or [] if isinstance(x, dict)]
                ids = {str(x.get("id")) for x in items}
                for i, x in enumerate(items):
                    x["depends_on"] = [str(d) for d in x.get("depends_on") or [] if str(d) in ids]
                cycle = engine.dependency_cycle(items)
                if cycle:
                    names = {str(x.get("id")): x.get("outcome") or x.get("name") or f"a {label}" for x in items}
                    errors[path] = ("These depend on each other in a circle, so none could ever start: "
                                    + " → ".join(str(names.get(c, c)) for c in cycle) + ". Remove one of the links.")
                    continue
                done = {str(x.get("id")) for x in items if x.get("status") in ("done", "completed")}
                for i, x in enumerate(items):
                    waiting = [d for d in x.get("depends_on") or [] if d not in done]
                    if x.get("status") in ("done", "completed") and waiting and path == "control.milestones":
                        first = next((y.get("outcome") for y in items if str(y.get("id")) == waiting[0]), "another milestone")
                        errors[f"{path}.{i}.status"] = f"This can't be marked done until '{first}' is done."
        try:
            rules.select_profile(subject_type, data)
        except rules.UnsupportedProfile as e:
            raise Unavailable(str(e)) from e
        if errors:
            raise Invalid(errors)
        return data

    def _stamp(self, subject_type: str, data: dict, before: dict, ctx: dict, confirm: list[str] | None = None) -> None:
        """Record when figures were last confirmed. A test run belongs to the process version it tested."""
        today = ctx["today"].isoformat()
        confirm = confirm or []
        if subject_type != rules.LAUNCH:
            return
        econ = lambda d: [str(engine.get(d, f"economics.{k}") or "") for k in ("price_per_unit", "variable_cost_per_unit", "fixed_costs_monthly")]
        if (econ(data) != econ(before) or "economics" in confirm) and any(econ(data)):
            _set(data, "economics.confirmed_at", today)
        cap = lambda d: [str(engine.get(d, p) or "") for p in ("planned_volume.amount", "planned_volume.unit", "delivery.capacity_available",
                                                                "delivery.capacity_committed", "delivery.capacity_unit", "delivery.capacity_per_unit")]
        if (cap(data) != cap(before) or "capacity" in confirm) and any(cap(data)):
            _set(data, "delivery.capacity_confirmed_at", today)
        run = lambda d: [str(engine.get(d, f"operations.dry_run.{k}") or "") for k in ("date", "outcome", "failures_resolved", "notes")]
        if run(data) != run(before) and engine.get(data, "operations.dry_run.outcome"):
            _set(data, "operations.dry_run.process_version", str(engine.get(data, "operations.process_version") or ""))

    async def _check_references(self, business_id: str, data: dict) -> None:
        """Evidence, forecasts and linked records must belong to this business (no cross-business references)."""
        for eid in _evidence_ids(data):
            try:
                await self._row("evidence", business_id, eid)
            except NotFound:
                raise Invalid({"evidence_id": "That evidence can't be found in this business."})
        if data.get("forecast_id"):
            try:
                await self._row("forecasts", business_id, data["forecast_id"])
            except NotFound:
                raise Invalid({"forecast_id": "That forecast can't be found in this business."})
        if data.get("previous_initiative_id"):
            try:
                await self._row("subjects", business_id, data["previous_initiative_id"], rules.LAUNCH)
            except NotFound:
                raise Invalid({"previous_initiative_id": "That launch can't be found in this business."})

    # ── prefill ───────────────────────────────────────────────────────────────

    def prefill(self, subject_type: str, data: dict, today: date) -> tuple[dict, dict]:
        """Values reused from the business's records, each with where it came from and when.
        Only what is on record is offered: nothing is estimated or made up."""
        from app.modules.agent.dashboard import _find_number, _plan_sources
        values: dict[str, Any] = {}
        prov: dict[str, dict] = {}
        sources = _plan_sources(data)

        def take(path: str, value: Any, source: str) -> None:
            if not engine.blank(value):
                values[path] = value
                prov[path] = {"source": source, "as_of": today.isoformat(), "value": value}

        def text(names: tuple[str, ...]) -> str | None:
            def find(obj: Any, depth: int = 4) -> str | None:
                if depth < 0:
                    return None
                if isinstance(obj, dict):
                    for n in names:
                        if isinstance(obj.get(n), str) and obj[n].strip():
                            return obj[n].strip()
                    for v in obj.values():
                        hit = find(v, depth - 1)
                        if hit:
                            return hit
                elif isinstance(obj, list):
                    for v in obj[:10]:
                        hit = find(v, depth - 1)
                        if hit:
                            return hit
                return None
            return find(sources)

        fin = data.get("financials") or {}
        trading = any(isinstance(i, dict) and bz.invoice_received(i) > 0 for i in fin.get("invoices") or [])
        products = [p for p in (data.get("catalogue") or {}).get("products") or [] if isinstance(p, dict) and p.get("name")]
        segment = text(("target_customer", "target_customers", "target_market", "customer_segment", "target_audience"))
        price = _find_number(sources, ("price_per_unit", "price", "average_price"))
        variable = _find_number(sources, ("variable_cost_per_unit", "direct_cost", "cost_per_unit"))
        fixed = _find_number(sources, ("fixed_costs_monthly", "monthly_fixed_costs", "fixed_costs"))
        if subject_type == rules.FUNDING:
            take("currency", bz.currency_of(data), "Business settings")
            take("stage", "trading" if trading else "pre_revenue", "Invoices" if trading else "No paid invoices on record")
            take("market.target_segment", segment, "Idea Validation")
            take("economics.price", price, "Idea Validation")
            take("economics.direct_cost", variable, "Idea Validation")
            take("economics.fixed_costs_monthly", fixed, "Idea Validation")
        else:
            take("launch_type", "new_offering" if trading else "initial_business", "Invoices" if trading else "No paid invoices on record")
            take("customers.target_segment", segment, "Idea Validation")
            take("economics.price_per_unit", price, "Idea Validation")
            take("economics.variable_cost_per_unit", variable, "Idea Validation")
            take("economics.fixed_costs_monthly", fixed, "Idea Validation")
            if products:
                take("offerings", [{"id": str(p.get("id") or new_id()), "name": p["name"]} for p in products[:20]], "Catalogue")
                if price is None and len(products) == 1 and bz.money(products[0].get("base_price")) > 0:
                    take("economics.price_per_unit", bz.money(products[0].get("base_price")), "Catalogue")
        return values, prov

    # ── subjects: funding cases and launch initiatives ────────────────────────

    def _public(self, row: dict, ctx: dict) -> dict:
        data = row.get("data") or {}
        if any(isinstance(a, dict) and a.get("independent") for a in (data.get("attestations") or {}).values()):
            subject = {**data, "created_by": row.get("created_by")}
            data = {**data, "attestations": {code: ({**a, "independent": engine.is_independent(a, subject)} if isinstance(a, dict) else a)
                                             for code, a in data["attestations"].items()}}
        return {"id": row["id"], "business_id": row["business_id"], "type": row["kind"], "status": row.get("status"), "revision": row.get("revision"),
                "title": data.get("title") or data.get("name"), "profile": data.get("profile"), "data": data,
                "created_at": row.get("created_at"), "updated_at": row.get("updated_at"), "can": self.can(ctx["actor"], row["kind"])}

    async def create_subject(self, user_id: str, business_id: str, subject_type: str, payload: dict, email: str | None = None) -> dict:
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, subject_type, "edit")
        _known_fields(subject_type, payload)
        values, prov = self.prefill(subject_type, ctx["data"], ctx["today"])
        data: dict = {}
        for path, value in values.items():
            _set(data, path, value)
        given = {k: _clean(v) for k, v in (payload or {}).items() if k in CORE_FIELDS[subject_type]}
        data = _deep_merge(data, given)
        for path in list(prov):                      # what the user typed is their own assumption, not a reused value
            if path.split(".")[0] in given and engine.get(given, path) not in (None, prov[path]["value"]):
                prov.pop(path)
        if subject_type == rules.FUNDING:
            data.setdefault("route", "equity")
            data.setdefault("jurisdiction", "UK")
            data.setdefault("business_model", "service")
        else:
            data.setdefault("scope", "commercial")
            data.setdefault("business_model", "service")
        data = self._validate(subject_type, data)
        self._stamp(subject_type, data, {}, ctx)
        await self._check_references(business_id, data)
        data["profile"] = rules.profile_key(rules.select_profile(subject_type, data))
        data["provenance"] = prov
        data["editors"] = [user_id]
        data.setdefault("owner", ctx["actor"].email or user_id)
        row = await self.store.insert("subjects", {"id": new_id(), "business_id": business_id, "kind": subject_type, "subject_id": None, "status": "draft",
                                                   "revision": 1, "key": None, "data": data, "created_by": user_id,
                                                   "created_at": ctx["now"], "updated_at": ctx["now"]})
        await self.emit(ctx, "FundingCaseChanged" if subject_type == rules.FUNDING else "LaunchInitiativeChanged", row, {"change": "created"})
        return await self._detail(row, ctx)

    async def list_subjects(self, user_id: str, business_id: str, subject_type: str, email: str | None = None, include_archived: bool = True) -> dict:
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, subject_type, "read")
        rows = await self.store.list("subjects", business_id, kind=subject_type)
        items = []
        for row in rows:
            if row.get("status") == "archived" and not include_archived:
                continue
            latest = await self._latest(row)
            items.append({**{k: v for k, v in self._public(row, ctx).items() if k not in ("data", "can")},
                          "target_date": (row["data"] or {}).get("target_date"), "target_amount": (row["data"] or {}).get("target_amount"),
                          "currency": (row["data"] or {}).get("currency"), "launch_type": (row["data"] or {}).get("launch_type"),
                          "summary": await self._summary_of(row, latest, ctx)})
        return {"items": items, "can": self.can(ctx["actor"], subject_type), "profiles": self.profiles(subject_type)}

    @staticmethod
    def profiles(subject_type: str) -> dict:
        return {"current": rules.public_profile(rules.PROFILES[rules.CURRENT[subject_type]]),
                "unavailable": [u for u in rules.UNAVAILABLE if u["subject_type"] == subject_type]}

    async def get_subject(self, user_id: str, business_id: str, subject_type: str, subject_id: str, email: str | None = None) -> dict:
        from app.core.supabase import read_cache
        with read_cache():
            async def nothing() -> None:
                return None
            # Everything that can be looked up from the address alone goes out together; the
            # checks and the page are then built from what has already been read. Nothing is
            # returned unless the access check passes.
            await asyncio.gather(
                self._policy_of(business_id) if self._policy_of else nothing(), self.business.record(business_id),
                self.store.get("subjects", str(subject_id)),
                self.store.list("assessments", business_id, subject_id=subject_id, limit=4),
                self.store.list("actions", business_id, subject_id=subject_id, limit=300),
                self.store.list("evidence", business_id, limit=500),
                self.store.list("artifacts", business_id, subject_id=subject_id),
                self.store.list("forecasts", business_id, limit=100),
                self.store.list("decisions", business_id, subject_id=subject_id) if subject_type == rules.LAUNCH else nothing(),
                return_exceptions=True)
            ctx = await self._ctx(user_id, business_id, email)
            self._need(ctx, subject_type, "read")
            return await self._detail(await self._row("subjects", business_id, subject_id, subject_type), ctx)

    async def _detail(self, row: dict, ctx: dict, extra: dict | None = None) -> dict:
        data = row["data"] or {}
        profile = rules.get_profile(data["profile"])
        async def decisions_of() -> list[dict] | None:
            if row["kind"] != rules.LAUNCH:
                return None
            return [self._public_decision(d) for d in await self.store.list("decisions", row["business_id"], subject_id=row["id"])]

        async def nothing() -> None:
            return None
        # Everything the page shows is looked up side by side, not one after another.
        forecast, latest, actions, decisions = await asyncio.gather(self._forecast_of(row), self._latest(row), self._actions(row), decisions_of())
        evidence = await self._evidence_for(row, forecast)
        assessment, summary = await asyncio.gather(self._public_assessment(latest, row, ctx) if latest else nothing(), self._summary_of(row, latest, ctx))
        out = self._public(row, ctx)
        out.update({
            "profile_definition": rules.public_profile(profile),
            "sections": engine.section_progress(profile, data, (forecast or {}).get("data")),
            "forecast": self._public_forecast(forecast, row, ctx, evidence) if forecast else None,
            "evidence": [self._public_evidence(e, ctx["today"], profile) for e in evidence],
            "assessment": assessment,
            "actions": actions,
            "summary": summary,
            "decisions": decisions,
            "scenarios_available": self.scenarios_enabled(),
        })
        out.update(extra or {})
        return out

    async def update_subject(self, user_id: str, business_id: str, subject_type: str, subject_id: str, revision: int | None, changes: dict,
                             email: str | None = None, confirm: list[str] | None = None) -> dict:
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, subject_type, "edit")
        row = await self._row("subjects", business_id, subject_id, subject_type)
        if row.get("status") == "archived":
            raise Conflict("archived", "This is archived. Reactivate it before making changes.")
        if revision is None or int(revision) != int(row["revision"]):
            raise Conflict("stale_revision", "Someone else changed this while you were editing. Your changes are kept here so you can compare and apply them again.",
                           current=self._public(row, ctx))
        _known_fields(subject_type, changes)
        before = row["data"] or {}
        given = {k: _clean(v) for k, v in (changes or {}).items() if k in CORE_FIELDS[subject_type]}
        data = _deep_merge(before, given)
        data = self._validate(subject_type, data, before)
        self._stamp(subject_type, data, before, ctx, confirm)
        await self._check_references(business_id, data)
        data["profile"] = rules.profile_key(rules.select_profile(subject_type, data))
        prov = dict(before.get("provenance") or {})
        for path in list(prov):
            if engine.get(data, path) != prov[path].get("value"):
                prov.pop(path)                       # edited: now the case's own assumption
        data["provenance"] = prov
        data["editors"] = sorted(set(before.get("editors") or []) | {user_id})
        extra: dict = {}
        if subject_type == rules.LAUNCH and str(before.get("target_date") or "") != str(data.get("target_date") or "") and data.get("target_date"):
            extra["date_review"] = self._date_review(data)
        saved = await self.store.update("subjects", row["id"], {"data": data, "updated_at": ctx["now"]}, expect_revision=row["revision"])
        if saved is None:
            fresh = await self._row("subjects", business_id, subject_id, subject_type)
            raise Conflict("stale_revision", "Someone else changed this while you were saving. Your changes are kept here so you can compare and apply them again.",
                           current=self._public(fresh, ctx))
        await self._invalidate(saved, ctx, "The details changed.")
        await self.emit(ctx, "FundingCaseChanged" if subject_type == rules.FUNDING else "LaunchInitiativeChanged", saved, {"change": "updated", "revision": saved["revision"]})
        return await self._detail(saved, ctx, extra)

    @staticmethod
    def _date_review(data: dict) -> list[dict]:
        """Dates the user set by hand that no longer fit the new launch date. They are listed
        for review; none is changed automatically and none is invented."""
        target = engine.parse_day(data.get("target_date"))
        out = []
        for path, key, label in (("control.milestones", "due_date", "outcome"), ("prerequisites", "required_by", "name")):
            for item in engine.get(data, path) or []:
                when = engine.parse_day(item.get(key)) if isinstance(item, dict) else None
                if when and target and when > target:
                    out.append({"path": path, "id": item.get("id"), "label": item.get(label), "date": when.isoformat(),
                                "issue": "This is after the new launch date."})
        for item in data.get("prerequisites") or []:
            until = engine.parse_day(item.get("valid_until")) if isinstance(item, dict) else None
            if until and target and until < target:
                out.append({"path": "prerequisites", "id": item.get("id"), "label": item.get("name"), "date": until.isoformat(),
                            "issue": "Its validity ends before the new launch date."})
        return out

    async def set_status(self, user_id: str, business_id: str, subject_type: str, subject_id: str, action: str, email: str | None = None, reason: str | None = None) -> dict:
        """archive | reactivate | reopen (a cancelled launch). Archiving keeps every assessment."""
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, subject_type, "edit")
        row = await self._row("subjects", business_id, subject_id, subject_type)
        data = dict(row["data"] or {})
        status = row.get("status")
        if action == "archive":
            if status == "archived":
                return await self._detail(row, ctx)
            data["archived_from"] = status
            new = "archived"
        elif action == "reactivate":
            if status != "archived":
                raise Conflict("not_archived", "This isn't archived.")
            new = data.pop("archived_from", None) or "draft"
        elif action == "reopen" and subject_type == rules.LAUNCH:
            if status != "cancelled":
                raise Conflict("not_cancelled", "Only a cancelled launch can be reopened.")
            self._need(ctx, subject_type, "decide")
            new = "preparing"
            await self._decision(row, ctx, "reopen", {"rationale": (reason or "").strip()[:MAX_TEXT] or None})
        else:
            raise Invalid("Unknown action.")
        saved = await self.store.update("subjects", row["id"], {"status": new, "data": data, "updated_at": ctx["now"]})
        await self.emit(ctx, "FundingCaseChanged" if subject_type == rules.FUNDING else "LaunchInitiativeChanged", saved, {"change": action})
        return await self._detail(saved, ctx)

    # ── reviewer records: attestations, document review, contradictions ───────

    async def _patch_data(self, row: dict, ctx: dict, fn: Callable[[dict], None], reason: str, quiet: bool = False) -> dict:
        """`quiet`: bookkeeping that is not a change to the case (no new revision, nothing invalidated)."""
        if row.get("status") == "archived":
            raise Conflict("archived", "This is archived. Reactivate it before making changes.")
        for _ in range(4):
            data = copy.deepcopy(row["data"] or {})
            fn(data)
            patch = {"data": data} if quiet else {"data": data, "updated_at": ctx["now"]}
            saved = await self.store.update("subjects", row["id"], patch, expect_revision=row["revision"], bump=not quiet)
            if saved:
                if not quiet:
                    await self._invalidate(saved, ctx, reason)
                return saved
            row = await self._row("subjects", row["business_id"], row["id"])
        raise Conflict("busy", "This changed repeatedly while saving. Please try again.")

    async def attest(self, user_id: str, business_id: str, subject_type: str, subject_id: str, code: str, passed: bool, rationale: str,
                     independent: bool = False, email: str | None = None) -> dict:
        """An authorised person's explicit confirmation of a qualitative check, with their reasons.
        A founder may review their own case: that is recorded, and shown, as self-attested."""
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, subject_type, "review")
        row = await self._row("subjects", business_id, subject_id, subject_type)
        check = rules.checks_of(rules.get_profile(row["data"]["profile"])).get(code)
        if not check or check["kind"] != "attested":
            raise Invalid({"code": "That check isn't one a reviewer confirms."})
        if len((rationale or "").strip()) < 3:
            raise Invalid({"rationale": "Say why, so the confirmation can be understood later."})
        snapshot = await self._snapshot(row, ctx)
        # A review by whoever created or edited this is self-attested, whatever was ticked:
        # an independent review is one by a different authorised person.
        prepared = user_id == row.get("created_by") or user_id in ((row["data"] or {}).get("editors") or [])
        independent = bool(independent) and not prepared
        record = {"passed": bool(passed), "rationale": rationale.strip()[:MAX_TEXT], "actor_id": user_id, "actor_name": ctx["actor"].email or user_id,
                  "independent": independent, "at": ctx["today"].isoformat(),
                  "fingerprint": engine.fingerprint(engine.attestation_inputs(subject_type, code, snapshot))}

        def apply(data: dict) -> None:
            data.setdefault("attestations", {})[code] = record
        saved = await self._patch_data(row, ctx, apply, "A review was recorded.")
        await self._decision(saved, ctx, "attestation", {"check": code, **{k: record[k] for k in ("passed", "rationale", "independent")}})
        return await self._detail(saved, ctx)

    async def review_document(self, user_id: str, business_id: str, subject_id: str, key: str, *, reviewed: bool | None = None,
                              evidence_id: str | None = None, artifact_id: str | None = None, email: str | None = None,
                              attach: bool | None = None) -> dict:
        """`attach`: evidence_id / artifact_id were sent (None for both clears the attachment)."""
        attach = (evidence_id is not None or artifact_id is not None) if attach is None else attach
        if reviewed is None and not attach:
            raise Invalid({"_": "Say what to change: attach a document (evidence_id or artifact_id) or record a review (reviewed)."})
        ctx = await self._ctx(user_id, business_id, email)
        row = await self._row("subjects", business_id, subject_id, rules.FUNDING)
        profile = rules.get_profile(row["data"]["profile"])
        if key not in {d["key"] for d in profile["required_documents"]}:
            raise Invalid({"key": "Unknown document."})
        self._need(ctx, rules.FUNDING, "review" if reviewed is not None else "edit")
        if evidence_id:
            await self._row("evidence", business_id, evidence_id)
        if artifact_id:
            art = await self._row("artifacts", business_id, artifact_id)
            if art.get("subject_id") != row["id"]:
                raise NotFound()
        forecast = await self._forecast_of(row)
        facts = engine.fingerprint(engine.document_facts(row["data"], (forecast or {}).get("data")))

        def apply(data: dict) -> None:
            entry = dict((data.setdefault("documents", {})).get(key) or {})
            if attach:
                entry.update({"evidence_id": evidence_id, "artifact_id": artifact_id, "reviewed": False})
            if reviewed is not None:
                entry.update({"reviewed": bool(reviewed), "reviewed_by": ctx["actor"].email or user_id, "reviewed_at": ctx["today"].isoformat(),
                              "facts_fingerprint": facts if reviewed else None})
            data["documents"][key] = entry
        return await self._detail(await self._patch_data(row, ctx, apply, "A document was reviewed."), ctx)

    async def contradiction(self, user_id: str, business_id: str, subject_id: str, *, description: str | None = None, resolve_id: str | None = None,
                            resolution: str | None = None, email: str | None = None) -> dict:
        """A reviewer raises, or resolves, a contradiction between figures in the case documents (gate G4)."""
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, rules.FUNDING, "review")
        row = await self._row("subjects", business_id, subject_id, rules.FUNDING)
        if resolve_id is None and len((description or "").strip()) < 3:
            raise Invalid({"description": "Describe the figures that disagree."})
        if resolve_id is not None and len((resolution or "").strip()) < 3:
            raise Invalid({"resolution": "Say how it was resolved."})

        def apply(data: dict) -> None:
            items = data.setdefault("contradictions", [])
            if resolve_id is None:
                items.append({"id": new_id(), "description": description.strip()[:MAX_TEXT], "raised_by": ctx["actor"].email or user_id,
                              "at": ctx["today"].isoformat(), "resolved": False})
            else:
                for c in items:
                    if c.get("id") == resolve_id:
                        c.update({"resolved": True, "resolution": resolution.strip()[:MAX_TEXT], "resolved_by": ctx["actor"].email or user_id,
                                  "resolved_at": ctx["today"].isoformat()})
        return await self._detail(await self._patch_data(row, ctx, apply, "A contradiction was recorded."), ctx)

    # ── forecast ──────────────────────────────────────────────────────────────

    async def _forecast_of(self, row: dict) -> dict | None:
        fid = (row.get("data") or {}).get("forecast_id")
        if not fid:
            return None
        # From the business's forecasts (already read with everything else for the page), not a further look-up by id.
        f = next((x for x in await self.store.list("forecasts", row["business_id"], limit=100) if x["id"] == fid), None)             or await self.store.get("forecasts", fid)
        return f if f and f["business_id"] == row["business_id"] else None

    def _public_forecast(self, f: dict, row: dict, ctx: dict, evidence: list[dict] | None = None) -> dict:
        data = f["data"] or {}
        profile = rules.get_profile(row["data"]["profile"])
        required = (engine.funding_required_months(row["data"], data, profile) if row["kind"] == rules.FUNDING
                    else engine.launch_required_months(row["data"], profile, ctx["today"]))
        return {"id": f["id"], "revision": f["revision"], "updated_at": f.get("updated_at"), "data": data, "required_months": required,
                "computed": fc.public(fc.compute(data, required, proof=engine.financing_proof(
                    [{"id": e["id"], **(e.get("data") or {})} for e in evidence or []], ctx["today"], profile["freshness_days"]["evidence"])))}

    def _clean_forecast(self, payload: dict, ctx: dict, before: dict | None = None) -> dict:
        errors: dict[str, str] = {}
        p = _clean(payload or {}) or {}
        out: dict[str, Any] = {"name": p.get("name") or "Cash forecast", "currency": str(p.get("currency") or bz.currency_of(ctx["data"])).upper(),
                               "start_month": None, "opening_cash": None, "opening_cash_as_of": None, "months": [], "financing_items": [],
                               "assumptions": [], "commitments": [], "no_commitments": bool(p.get("no_commitments"))}
        if out["currency"] not in rules.SUPPORTED_CURRENCIES:
            errors["currency"] = f"{out['currency']} isn't supported yet."
        if not engine.blank(p.get("start_month")):
            ym = fc.parse_month(p.get("start_month"))
            if ym is None:
                errors["start_month"] = "Enter a month."
            else:
                out["start_month"] = fc.month_key(ym)

        def amount(value: Any, path: str, allow_negative: bool = False) -> str | None:
            try:
                d = fc.dec(value)
            except fc.Invalid:
                errors[path] = "Enter a number."
                return None
            if d is not None and d < 0 and not allow_negative:
                errors[path] = "This can't be negative."
            return fc.money_str(d)

        out["opening_cash"] = amount(p.get("opening_cash"), "opening_cash", allow_negative=True)      # an overdrawn balance is a real opening position
        if not engine.blank(p.get("opening_cash_as_of")):
            d = engine.parse_day(p.get("opening_cash_as_of"))
            if d is None:
                errors["opening_cash_as_of"] = "Enter a valid date."
            elif d > ctx["today"]:
                errors["opening_cash_as_of"] = "This can't be in the future."
            else:
                out["opening_cash_as_of"] = d.isoformat()
        seen: set[str] = set()
        for i, m in enumerate(p.get("months") or []):
            if not isinstance(m, dict):
                continue
            ym = fc.parse_month(m.get("month"))
            if ym is None:
                errors[f"months.{i}.month"] = "Enter a month."
                continue
            key = fc.month_key(ym)
            if key in seen:
                errors[f"months.{i}.month"] = "This month appears twice."
                continue
            seen.add(key)
            out["months"].append({"month": key, "receipts": amount(m.get("receipts"), f"months.{i}.receipts"),
                                  "payments": amount(m.get("payments"), f"months.{i}.payments"),
                                  "basis": m.get("basis") if m.get("basis") in rules.DATA_BASES else "forecast"})
        out["months"].sort(key=lambda m: m["month"])
        if out["start_month"] is None and out["months"]:
            out["start_month"] = out["months"][0]["month"]
        for i, item in enumerate(p.get("financing_items") or []):
            if not isinstance(item, dict):
                continue
            ym = fc.parse_month(item.get("month"))
            if ym is None and not engine.blank(item.get("month")):
                errors[f"financing_items.{i}.month"] = "Enter a month."
            out["financing_items"].append({"id": item.get("id") or new_id(), "label": item.get("label") or "Financing",
                                           "month": fc.month_key(ym) if ym else None, "amount": amount(item.get("amount"), f"financing_items.{i}.amount"),
                                           "status": item.get("status") if item.get("status") in ("received", "committed", "proposed") else "proposed",
                                           "evidence_id": item.get("evidence_id") or None, "conditions": item.get("conditions") or None})
        for item in p.get("assumptions") or []:
            if isinstance(item, dict) and item.get("applies_to") in ("receipts", "payments", "financing"):
                out["assumptions"].append({"id": item.get("id") or new_id(), "applies_to": item["applies_to"], "text": item.get("text") or "", "source": item.get("source") or ""})
        for i, item in enumerate(p.get("commitments") or []):
            if not isinstance(item, dict):
                continue
            ym = fc.parse_month(item.get("month"))
            out["commitments"].append({"id": item.get("id") or new_id(), "label": item.get("label") or "", "kind": item.get("kind") if item.get("kind") in ("setup", "operating") else "operating",
                                       "month": fc.month_key(ym) if ym else None, "amount": amount(item.get("amount"), f"commitments.{i}.amount"),
                                       "basis": item.get("basis") if item.get("basis") in ("evidenced", "assumption") else None,
                                       "evidence_id": item.get("evidence_id") or None})
        if errors:
            raise Invalid(errors)
        return out

    async def save_forecast(self, user_id: str, business_id: str, subject_type: str, subject_id: str, payload: dict, revision: int | None = None,
                            email: str | None = None) -> dict:
        """Create or replace the subject's forecast. Saving records that the figures were confirmed today."""
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, subject_type, "edit")
        row = await self._row("subjects", business_id, subject_id, subject_type)
        if row.get("status") == "archived":
            raise Conflict("archived", "This is archived. Reactivate it before making changes.")
        existing = await self._forecast_of(row)
        data = self._clean_forecast(payload, ctx)
        for eid in _evidence_ids(data):
            try:
                await self._row("evidence", business_id, eid)
            except NotFound:
                raise Invalid({"evidence_id": "That evidence can't be found in this business."})
        data.update({"confirmed_at": ctx["today"].isoformat(), "confirmed_by": ctx["actor"].email or user_id})
        if existing:
            if revision is None or int(revision) != int(existing["revision"]):
                raise Conflict("stale_revision", "The forecast changed while you were editing. Your figures are kept here so you can compare and apply them again.",
                               current={"forecast": self._public_forecast(existing, row, ctx, await self._evidence_for(row, existing))})
            saved = await self.store.update("forecasts", existing["id"], {"data": data, "updated_at": ctx["now"]}, expect_revision=existing["revision"])
            if saved is None:
                raise Conflict("stale_revision", "The forecast changed while you were saving.")
        else:
            saved = await self.store.insert("forecasts", {"id": new_id(), "business_id": business_id, "kind": "forecast", "subject_id": None, "status": "active",
                                                          "revision": 1, "key": None, "data": data, "created_by": user_id,
                                                          "created_at": ctx["now"], "updated_at": ctx["now"]})
            row = await self._patch_data(row, ctx, lambda d: d.__setitem__("forecast_id", saved["id"]), "A forecast was added.")
        if user_id not in ((row["data"] or {}).get("editors") or []):
            row = await self._patch_data(row, ctx, lambda d: d.__setitem__("editors", sorted(set(d.get("editors") or []) | {user_id})), "", quiet=True)
        # Every case or launch that uses this forecast is affected, not only the one being edited.
        for other in await self.store.list("subjects", business_id):
            if (other.get("data") or {}).get("forecast_id") == saved["id"]:
                await self._invalidate(other, ctx, "The forecast changed.")
        return await self._detail(await self._row("subjects", business_id, subject_id, subject_type), ctx)

    async def link_forecast(self, user_id: str, business_id: str, subject_type: str, subject_id: str, forecast_id: str, email: str | None = None) -> dict:
        """Use a forecast the business already has (a launch can reuse its funding case's forecast)."""
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, subject_type, "edit")
        row = await self._row("subjects", business_id, subject_id, subject_type)
        await self._row("forecasts", business_id, forecast_id)
        saved = await self._patch_data(row, ctx, lambda d: d.__setitem__("forecast_id", forecast_id), "A different forecast was linked.")
        return await self._detail(saved, ctx)

    async def list_forecasts(self, user_id: str, business_id: str, email: str | None = None) -> list[dict]:
        ctx = await self._ctx(user_id, business_id, email)
        subjects = await self.store.list("subjects", business_id)
        out = []
        for f in await self.store.list("forecasts", business_id):
            used = [s["data"].get("title") or s["data"].get("name") for s in subjects if (s.get("data") or {}).get("forecast_id") == f["id"]]
            out.append({"id": f["id"], "name": (f["data"] or {}).get("name"), "start_month": (f["data"] or {}).get("start_month"),
                        "months": len((f["data"] or {}).get("months") or []), "updated_at": f.get("updated_at"), "used_by": used})
        return out

    # ── evidence ──────────────────────────────────────────────────────────────

    def _public_evidence(self, row: dict, today: date, profile: dict | None = None) -> dict:
        data = row["data"] or {}
        days = (profile or rules.FUNDING_EQUITY_V1)["freshness_days"]["evidence"]
        return {"id": row["id"], "version": row["revision"], **{k: data.get(k) for k in (
            "title", "type", "claim", "source", "effective_date", "expires_on", "verification", "reviewed_at", "reviewed_by", "review_rationale",
            "facts", "links", "freshness_exception")},
            "has_file": bool(data.get("file")), "file_name": (data.get("file") or {}).get("name"),
            "type_label": rules.EVIDENCE_TYPES.get(data.get("type"), "Evidence"), "strength": rules.EVIDENCE_STRENGTH.get(data.get("type")),
            "verification_label": rules.VERIFICATION.get(data.get("verification") or "unverified"),
            "freshness": engine.evidence_freshness(data, today, days), "created_at": row.get("created_at")}

    async def _evidence_for(self, row: dict, forecast: dict | None) -> list[dict]:
        """Evidence linked to the subject or referenced by it or its forecast."""
        wanted = _evidence_ids(row.get("data")) | _evidence_ids((forecast or {}).get("data"))
        out = []
        for e in await self.store.list("evidence", row["business_id"], limit=500):
            links = (e.get("data") or {}).get("links") or []
            if e["id"] in wanted or any(l.get("subject_id") == row["id"] for l in links):
                out.append(e)
        return out

    async def list_evidence(self, user_id: str, business_id: str, email: str | None = None) -> list[dict]:
        ctx = await self._ctx(user_id, business_id, email)
        return [self._public_evidence(e, ctx["today"]) for e in await self.store.list("evidence", business_id, limit=500)]

    async def _clean_evidence(self, ctx: dict, payload: dict, before: dict | None = None) -> dict:
        p = _clean(payload or {}) or {}
        b = before or {}
        errors: dict[str, str] = {}
        title = p.get("title", b.get("title"))
        if engine.blank(title):
            errors["title"] = "Give the evidence a name."
        etype = p.get("type", b.get("type") or "other")
        if etype not in rules.EVIDENCE_TYPES:
            errors["type"] = "Choose a type."
        effective = engine.parse_day(p.get("effective_date", b.get("effective_date")))
        if effective is None:
            errors["effective_date"] = "Evidence needs the date it is from."
        elif effective > ctx["today"]:
            errors["effective_date"] = "This can't be in the future."
        expires_raw = p.get("expires_on", b.get("expires_on"))
        expires = engine.parse_day(expires_raw)
        if not engine.blank(expires_raw) and expires is None:
            errors["expires_on"] = "Enter a valid date."
        elif expires and effective and expires < effective:
            errors["expires_on"] = "This is before the evidence date."
        source = p.get("source", b.get("source")) or {}
        if not isinstance(source, dict):
            source = {"kind": "note", "reference": str(source)}
        source = {"kind": source.get("kind") if source.get("kind") in ("link", "note", "record", "file") else "note",
                  "reference": str(source.get("reference") or "")[:1000]}
        if source["kind"] == "link" and not source["reference"].lower().startswith(("http://", "https://")):
            errors["source"] = "Enter a web address starting with https://."
        links = []
        for l in p.get("links", b.get("links")) or []:
            if isinstance(l, dict) and l.get("subject_id") and l.get("check"):
                subject = await self._row("subjects", ctx["business_id"], l["subject_id"])      # another business's subject: not found
                if l["check"] not in rules.checks_of(rules.get_profile(subject["data"]["profile"])):
                    errors["links"] = "That check doesn't exist on this checklist."
                elif {"subject_id": subject["id"], "check": l["check"]} not in links:
                    links.append({"subject_id": subject["id"], "check": l["check"]})
        facts = p.get("facts", b.get("facts")) or {}
        clean_facts = {}
        if isinstance(facts, dict):
            for k in ("target_amount", "currency", "forecast_start"):
                if not engine.blank(facts.get(k)):
                    try:
                        clean_facts[k] = fc.money_str(fc.dec(facts[k])) if k == "target_amount" else str(facts[k]).strip().upper() if k == "currency" else str(facts[k])[:7]
                    except fc.Invalid:
                        errors["facts"] = "The amount this document states isn't a number."
        if errors:
            raise Invalid(errors)
        return {**b, "title": title, "type": etype, "claim": p.get("claim", b.get("claim")) or "", "source": source,
                "effective_date": effective.isoformat(), "expires_on": expires.isoformat() if expires else None, "links": links, "facts": clean_facts,
                "verification": b.get("verification") or "unverified"}

    async def add_evidence(self, user_id: str, business_id: str, payload: dict, email: str | None = None, feature: str = rules.FUNDING) -> dict:
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, feature, "edit")
        data = await self._clean_evidence(ctx, payload)
        key = engine.fingerprint([data["title"].lower(), data["type"], data["source"], data["effective_date"]])
        existing = await self.store.find_key("evidence", business_id, None, key)
        duplicate = bool(existing)
        if existing:      # the same evidence entered twice is one item: add any new links to it
            merged = list((existing["data"] or {}).get("links") or [])
            new_links = [l for l in data["links"] if l not in merged]
            row = existing
            if new_links:
                row = await self.store.update("evidence", existing["id"], {"data": {**existing["data"], "links": merged + new_links}, "updated_at": ctx["now"]}, bump=False) or existing
        else:
            try:
                row = await self.store.insert("evidence", {"id": new_id(), "business_id": business_id, "kind": "evidence", "subject_id": None, "status": "active",
                                                           "revision": 1, "key": key, "data": data, "created_by": user_id,
                                                           "created_at": ctx["now"], "updated_at": ctx["now"]})
            except Duplicate:
                row = await self.store.find_key("evidence", business_id, None, key)
                duplicate = True
        await self._evidence_changed(row, ctx, "Evidence was added.")
        return {**self._public_evidence(row, ctx["today"]), "duplicate": duplicate}

    async def update_evidence(self, user_id: str, business_id: str, evidence_id: str, payload: dict, email: str | None = None, feature: str = rules.FUNDING) -> dict:
        """A change to evidence is a new version. A review of the old version does not carry over."""
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, feature, "edit")
        row = await self._row("evidence", business_id, evidence_id)
        data = await self._clean_evidence(ctx, payload, row["data"])
        material = any(data.get(k) != (row["data"] or {}).get(k) for k in ("title", "type", "claim", "source", "effective_date", "expires_on", "facts"))
        if material:
            data.update({"verification": "unverified", "reviewed_at": None, "reviewed_by": None, "review_rationale": None, "freshness_exception": None})
        saved = await self.store.update("evidence", row["id"], {"data": data, "updated_at": ctx["now"]}, bump=material) or row
        await self._evidence_changed(saved, ctx, "Evidence was updated.", before=row)
        return self._public_evidence(saved, ctx["today"])

    async def review_evidence(self, user_id: str, business_id: str, evidence_id: str, *, verification: str | None = None, rationale: str = "",
                              exception: bool = False, email: str | None = None, feature: str = rules.FUNDING) -> dict:
        """Record a reviewer's verification, or a reasoned exception that keeps old evidence
        current. The evidence keeps its original date either way."""
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, feature, "review")
        row = await self._row("evidence", business_id, evidence_id)
        if len((rationale or "").strip()) < 3:
            raise Invalid({"rationale": "Say why, so the review can be understood later."})
        data = dict(row["data"] or {})
        who = ctx["actor"].email or user_id
        if exception:
            data["freshness_exception"] = {"rationale": rationale.strip()[:MAX_TEXT], "actor": who, "at": ctx["today"].isoformat()}
        else:
            if verification not in ("self_attested", "independently_reviewed", "corroborated", "unverified"):
                raise Invalid({"verification": "Choose how this was verified."})
            data.update({"verification": verification, "reviewed_at": ctx["today"].isoformat(), "reviewed_by": who, "review_rationale": rationale.strip()[:MAX_TEXT]})
        saved = await self.store.update("evidence", row["id"], {"data": data, "updated_at": ctx["now"]}, bump=False) or row
        await self._evidence_changed(saved, ctx, "Evidence was reviewed.")
        return self._public_evidence(saved, ctx["today"])

    async def attach_file(self, user_id: str, business_id: str, evidence_id: str, name: str, content_type: str, content: bytes,
                          email: str | None = None, feature: str = rules.FUNDING) -> dict:
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, feature, "edit")
        row = await self._row("evidence", business_id, evidence_id)
        if content_type not in FILE_TYPES:
            raise Invalid({"file": "Attach a PDF, image, Word, Excel, CSV or text file."})
        if not content or len(content) > MAX_FILE_BYTES:
            raise Invalid({"file": "The file is empty or larger than 10 MB."})
        path = f"{business_id}/{row['id']}/{new_id()}.{FILE_TYPES[content_type]}"
        await self.store.put_file(path, content, content_type)
        data = {**(row["data"] or {}), "file": {"path": path, "name": str(name or "attachment")[:200], "content_type": content_type, "size": len(content)}}
        saved = await self.store.update("evidence", row["id"], {"data": data, "updated_at": ctx["now"]}) or row
        await self._evidence_changed(saved, ctx, "A file was attached to evidence.")
        return self._public_evidence(saved, ctx["today"])

    async def download_file(self, user_id: str, business_id: str, evidence_id: str, email: str | None = None) -> dict:
        """Access is checked now, on download, not when the link was shown."""
        ctx = await self._ctx(user_id, business_id, email)
        if not (ctx["actor"].can_prepare or ctx["actor"].is_owner):
            raise Forbidden("Your role in this business doesn't include its confidential attachments.")
        row = await self._row("evidence", business_id, evidence_id)
        meta = (row["data"] or {}).get("file")
        content = await self.store.get_file(meta["path"]) if meta else None
        if content is None:
            raise NotFound()
        return {"name": meta["name"], "content_type": meta["content_type"], "content": content}

    async def _evidence_changed(self, row: dict, ctx: dict, reason: str, before: dict | None = None) -> None:
        touched = {l.get("subject_id") for src in (row, before or {}) for l in ((src.get("data") or {}).get("links") or [])}
        for s in await self.store.list("subjects", ctx["business_id"]):
            forecast = await self._forecast_of(s)
            if s["id"] in touched or row["id"] in (_evidence_ids(s.get("data")) | _evidence_ids((forecast or {}).get("data"))):
                await self._invalidate(s, ctx, reason)
        await self.emit(ctx, "EvidenceUpdated", None, {"evidence_id": row["id"], "version": row.get("revision")})

    # ── assessment ────────────────────────────────────────────────────────────

    async def _snapshot(self, row: dict, ctx: dict) -> dict:
        """Everything the engine reads, copied so the result can always be reproduced."""
        async def inputs():
            forecast = await self._forecast_of(row)
            return forecast, await self._evidence_for(row, forecast)
        (forecast, evidence), artifacts = await asyncio.gather(inputs(), self.store.list("artifacts", row["business_id"], subject_id=row["id"]))
        profile_data = ctx["data"].get("workspace_profile") or {}
        return {
            "subject": {"id": row["id"], "type": row["kind"], "created_by": row.get("created_by"), **copy.deepcopy(row["data"] or {})},
            "subject_revision": row["revision"],
            "forecast": ({"id": forecast["id"], "revision": forecast["revision"], **copy.deepcopy(forecast["data"] or {})} if forecast else None),
            "evidence": sorted(({"id": e["id"], "version": e["revision"], **{k: (e["data"] or {}).get(k) for k in (
                "title", "type", "claim", "source", "effective_date", "expires_on", "verification", "reviewed_at", "facts", "links", "freshness_exception")}}
                for e in evidence), key=lambda e: e["id"]),
            "artifacts": sorted(({"id": a["id"], "kind": a["kind"], "status": a.get("status"), "facts": (a["data"] or {}).get("facts")} for a in artifacts), key=lambda a: a["id"]),
            "business": {"name": profile_data.get("company_name"), "country": profile_data.get("country"), "currency": bz.currency_of(ctx["data"])},
        }

    @staticmethod
    def _hashes(snapshot: dict) -> dict:
        """Fingerprints of what the user provided. Documents prepared here are outputs, not
        inputs: preparing one never makes a result stale. A document counts once the user
        attaches their own or records a review."""
        subject = {k: v for k, v in snapshot["subject"].items() if k not in ("provenance", "pinned", "archived_from", "editors", "documents", "created_by")}
        documents = {k: {x: v.get(x) for x in ("evidence_id", "reviewed", "facts_fingerprint")}
                     for k, v in (snapshot["subject"].get("documents") or {}).items() if isinstance(v, dict) and (v.get("reviewed") or v.get("evidence_id"))}
        if documents:
            subject["documents"] = documents
        return {"subject": engine.fingerprint(subject), "forecast": engine.fingerprint(snapshot.get("forecast")),
                "evidence": engine.fingerprint(snapshot.get("evidence")), "profile": snapshot["subject"].get("profile"),
                "all": engine.fingerprint([subject, snapshot.get("forecast"), snapshot.get("evidence")])}

    async def _latest(self, row: dict, succeeded_only: bool = False) -> dict | None:
        # The newest few are nearly always enough; each check carries its whole snapshot, so the
        # full history is only fetched when none of those few succeeded.
        for limit in (4, 50):
            rows = await self.store.list("assessments", row["business_id"], subject_id=row["id"], limit=limit)
            for a in rows:
                if not succeeded_only or a.get("status") == "succeeded":
                    return a
            if len(rows) < limit:
                break
        return None

    async def request_assessment(self, user_id: str, business_id: str, subject_type: str, subject_id: str, *, revision: int | None = None,
                                 idempotency_key: str | None = None, email: str | None = None) -> dict:
        """Run the check. One logical run per idempotency key: a retry returns the same run.
        The input snapshot is saved before anything is calculated."""
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, subject_type, "assess")
        row = await self._row("subjects", business_id, subject_id, subject_type)
        key = (idempotency_key or "").strip()[:120] or None
        if key:
            existing = await self.store.find_key("assessments", business_id, row["id"], key)
            if existing:
                return {**await self._public_assessment(existing, row, ctx), "repeated": True}
        if row.get("status") in ("archived", "cancelled"):
            raise Conflict(row["status"], "This is archived. Reactivate it before running a check." if row["status"] == "archived"
                           else "This launch was cancelled. Reopen it before running a check.")
        if revision is not None and int(revision) != int(row["revision"]):
            raise Conflict("stale_revision", "This changed since you opened it. Reload to check the latest version.", current=self._public(row, ctx))
        profile = rules.get_profile(row["data"]["profile"])
        current = rules.PROFILES[rules.CURRENT[subject_type]]
        if rules.profile_key(profile) != rules.profile_key(current) and rules.select_profile(subject_type, row["data"])["id"] == current["id"]:
            # A newer version of the same checklist: new checks use it; earlier results keep theirs.
            profile = current
            row = await self.store.update("subjects", row["id"], {"data": {**row["data"], "profile": rules.profile_key(current)}}, bump=False) or row
        snapshot = await self._snapshot(row, ctx)
        correlation = new_id()
        record = {"id": new_id(), "business_id": business_id, "kind": subject_type, "subject_id": row["id"], "status": "running", "revision": 1,
                  "key": key, "created_by": user_id, "created_at": ctx["now"], "updated_at": ctx["now"],
                  "data": {"snapshot": snapshot, "hashes": self._hashes(snapshot), "profile": rules.profile_key(profile), "as_of": ctx["today"].isoformat(),
                           "subject_revision": row["revision"], "correlation_id": correlation, "requested_by": ctx["actor"].email or user_id}}
        try:
            run = await self.store.insert("assessments", record)
        except Duplicate:
            existing = await self.store.find_key("assessments", business_id, row["id"], key)
            return {**await self._public_assessment(existing, row, ctx), "repeated": True}
        if self.during_run:
            await self.during_run(run)
        try:
            result = engine.assess(subject_type, snapshot, profile, ctx["today"])
            patch = {"status": "succeeded", "data": {**run["data"], "result": result, "completed_at": ctx["now"].isoformat()}, "updated_at": ctx["now"]}
        except Exception as e:      # noqa: BLE001 - a failed run is recorded with its reason and can be retried
            logger.exception("readiness assessment failed")
            patch = {"status": "failed", "data": {**run["data"], "failure": "The check could not be completed. Nothing was changed; you can run it again.",
                                                  "failure_detail": type(e).__name__}, "updated_at": ctx["now"]}
        run = await self.store.update("assessments", run["id"], patch, bump=False) or {**run, **patch}
        if run["status"] == "succeeded":
            # Access is checked again before anything is written back from the run.
            ctx = await self._ctx(user_id, business_id, email)
            self._need(ctx, subject_type, "assess")
            await self._sync_actions(row, run, ctx)
            if row.get("status") == "draft":
                row = await self.store.update("subjects", row["id"], {"status": "active" if subject_type == rules.FUNDING else "preparing", "updated_at": ctx["now"]}, bump=False) or row
            await self.emit(ctx, "AssessmentCompleted", row, {"assessment_id": run["id"], "classification": result["classification"], "profile": run["data"]["profile"]}, correlation)
        row = await self._row("subjects", business_id, subject_id, subject_type)
        return await self._public_assessment(run, row, ctx)

    async def _freshness(self, run: dict, row: dict, ctx: dict, newest: dict | None = None) -> dict:
        """Whether a past result still describes the case: `current` or `stale`, with the reason.
        `newest`: the latest succeeded run, when the caller already has it."""
        data = run["data"] or {}
        as_of = data.get("as_of")
        if run.get("status") != "succeeded":
            return {"status": None, "reason": None, "as_of": as_of}
        latest = newest or await self._latest(row, succeeded_only=True)
        if latest and latest["id"] != run["id"]:
            return {"status": "stale", "reason": "A newer check has been run.", "as_of": as_of, "superseded": True}
        now_hashes = self._hashes(await self._snapshot(row, ctx))
        was = data.get("hashes") or {}
        if now_hashes["all"] != was.get("all"):
            what = ("The checklist changed." if now_hashes["profile"] != was.get("profile") else "Evidence changed." if now_hashes["evidence"] != was.get("evidence")
                    else "The forecast changed." if now_hashes["forecast"] != was.get("forecast") else "The details changed.")
            return {"status": "stale", "reason": f"{what} Run the check again to see the effect.", "as_of": as_of}
        if data.get("profile") != rules.CURRENT.get(run["kind"]) and rules.get_profile(data["profile"])["id"] == rules.PROFILES[rules.CURRENT[run["kind"]]]["id"]:
            return {"status": "stale", "reason": "A newer version of the checklist is available. Run the check again to use it.", "as_of": as_of}
        # Nothing was edited, but time passes: evidence expires and confirmations age.
        again = engine.assess(run["kind"], data["snapshot"], rules.get_profile(data["profile"]), ctx["today"])
        was_states = {c["code"]: c["state"] for cr in data["result"]["criteria"] for c in cr["checks"]} | {g["code"]: g["state"] for g in data["result"]["gates"]}
        now_states = {c["code"]: c["state"] for cr in again["criteria"] for c in cr["checks"]} | {g["code"]: g["state"] for g in again["gates"]}
        aged = sorted(code for code in now_states if now_states[code] != was_states.get(code))
        if aged:
            return {"status": "stale", "reason": "Some evidence has expired or gone out of date since this check. Run it again.", "as_of": as_of, "affected": aged}
        return {"status": "current", "reason": None, "as_of": as_of}

    async def _public_assessment(self, run: dict, row: dict, ctx: dict, with_snapshot: bool = False) -> dict:
        data = run["data"] or {}
        result = data.get("result")
        saved = ((data.get("snapshot") or {}).get("subject") or {}).get("attestations") or {}
        who = {"created_by": row.get("created_by"), "editors": (row.get("data") or {}).get("editors")}
        if result and any(ch.get("attestation", {}).get("independent") and not engine.is_independent(saved.get(ch["code"]) or {}, who)
                          for c in result["criteria"] for ch in c["checks"]):
            result = copy.deepcopy(result)
            for c in result["criteria"]:
                for ch in c["checks"]:
                    if ch.get("attestation", {}).get("independent") and not engine.is_independent(saved.get(ch["code"]) or {}, who):
                        ch["attestation"]["independent"] = False
                        if ch["state"] == "passed":
                            ch["reason"] = "Self-attested."
            data = {**data, "result": result}
        if result and result.get("score_display") != engine.display_score(result.get("score")):
            data = {**data, "result": {**result, "score_display": engine.display_score(result.get("score"))}}
        out = {"id": run["id"], "subject_id": run["subject_id"], "subject_type": run["kind"], "execution_status": run.get("status"),
               "profile": data.get("profile"), "as_of": data.get("as_of"), "created_at": run.get("created_at"), "completed_at": data.get("completed_at"),
               "subject_revision": data.get("subject_revision"), "requested_by": data.get("requested_by"), "failure": data.get("failure"),
               "result": data.get("result"), "freshness": await self._freshness(run, row, ctx),
               "can_retry": run.get("status") in ("failed", "cancelled")}
        if with_snapshot:
            out["snapshot"] = data.get("snapshot")
        return out

    async def get_assessment(self, user_id: str, business_id: str, subject_type: str, subject_id: str, assessment_id: str, email: str | None = None) -> dict:
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, subject_type, "read")
        row = await self._row("subjects", business_id, subject_id, subject_type)
        run = await self._row("assessments", business_id, assessment_id, subject_type)
        if run["subject_id"] != row["id"]:
            raise NotFound()
        return await self._public_assessment(run, row, ctx, with_snapshot=True)

    async def history(self, user_id: str, business_id: str, subject_type: str, subject_id: str, email: str | None = None) -> list[dict]:
        """Every check, newest first, each saying what changed since the one before it."""
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, subject_type, "read")
        row = await self._row("subjects", business_id, subject_id, subject_type)
        runs = await self.store.list("assessments", business_id, subject_id=row["id"], limit=100)
        out = []
        for i, run in enumerate(runs):
            data = run["data"] or {}
            result = data.get("result") or {}
            older = next((r for r in runs[i + 1:] if r.get("status") == "succeeded"), None)
            changed = []
            if older and run.get("status") == "succeeded":
                a, b = data.get("hashes") or {}, (older["data"] or {}).get("hashes") or {}
                if a.get("profile") != b.get("profile"):
                    changed.append("a new version of the checklist")
                if a.get("evidence") != b.get("evidence"):
                    changed.append("new or changed evidence")
                if a.get("subject") != b.get("subject") or a.get("forecast") != b.get("forecast"):
                    changed.append("changed assumptions")
            out.append({"id": run["id"], "execution_status": run.get("status"), "created_at": run.get("created_at"), "as_of": data.get("as_of"),
                        "profile": data.get("profile"), "classification": result.get("classification"), "score": engine.display_score(result.get("score")),
                        "coverage": result.get("coverage"), "blocker_count": result.get("blocker_count"), "confidence": (result.get("confidence") or {}).get("level"),
                        "requested_by": data.get("requested_by"),
                        "changed_because": changed, "comparable": bool(older) and (older["data"] or {}).get("profile") == data.get("profile"),
                        "freshness": (await self._freshness(run, row, ctx)) if i == 0 else {"status": "stale", "reason": "A newer check has been run.", "superseded": True}})
        return out

    async def _invalidate(self, row: dict, ctx: dict, reason: str) -> None:
        """Tell listeners the current result no longer describes the case. The result itself is
        kept as history; its staleness is worked out from the snapshot whenever it is read."""
        latest = await self._latest(row, succeeded_only=True)
        if latest:
            await self.emit(ctx, "AssessmentInvalidated", row, {"assessment_id": latest["id"], "reason": reason})

    # ── actions ───────────────────────────────────────────────────────────────

    @staticmethod
    def _rank(a: dict) -> tuple:
        d = a["data"]
        return (d.get("group") or 9, d.get("due_date") or "9999-12-31", d.get("order") if d.get("order") is not None else 99, -(d.get("weight") or 0), a.get("key") or "")

    def _public_action(self, a: dict) -> dict:
        return {"id": a["id"], "code": a.get("key"), "status": a.get("status"), "revision": a.get("revision"), **{k: (a["data"] or {}).get(k) for k in (
            "title", "why", "priority_reason", "evidence_required", "group", "criterion", "section", "tool", "owner", "due_date", "due_date_source",
            "proposed_due_date", "assessment_id", "completion", "dismissal", "resolved_by_assessment_id", "reopened_at", "kind", "also")},
            "updated_at": a.get("updated_at")}

    async def _actions(self, row: dict) -> list[dict]:
        rows = await self.store.list("actions", row["business_id"], subject_id=row["id"], limit=300)
        live = sorted((a for a in rows if a.get("status") in rules.UNRESOLVED_ACTION_STATES), key=self._rank)
        rest = sorted((a for a in rows if a.get("status") not in rules.UNRESOLVED_ACTION_STATES), key=lambda a: str(a.get("updated_at")), reverse=True)
        return [self._public_action(a) for a in live + rest]

    async def _sync_actions(self, row: dict, run: dict, ctx: dict) -> None:
        """One action per criterion check or blocker. A repeated check updates the existing
        action; it never creates a second one. An action whose gap is gone is closed by the
        check that found it resolved. Dismissed actions stay dismissed."""
        gaps = {g["code"]: g for g in run["data"]["result"]["gaps"]}
        existing = {a["key"]: a for a in await self.store.list("actions", row["business_id"], subject_id=row["id"], limit=300) if a.get("key")}
        for code, gap in gaps.items():
            fields = {k: gap.get(k) for k in ("title", "why", "priority_reason", "evidence_required", "group", "criterion", "section", "tool", "weight", "order", "also")}
            fields["assessment_id"] = run["id"]
            current = existing.get(code)
            if current is None:
                data = {**fields, "kind": "gap", "owner": None, "due_date": gap.get("due_date"), "proposed_due_date": gap.get("due_date"),
                        "due_date_source": "proposed" if gap.get("due_date") else None, "first_assessment_id": run["id"]}
                try:
                    await self.store.insert("actions", {"id": new_id(), "business_id": row["business_id"], "kind": row["kind"], "subject_id": row["id"], "status": "open",
                                                        "revision": 1, "key": code, "data": data, "created_by": "system",
                                                        "created_at": ctx["now"], "updated_at": ctx["now"]})
                    await self.emit(ctx, "RecommendationCreated", row, {"action_code": code, "assessment_id": run["id"]}, run["data"].get("correlation_id"))
                except Duplicate:
                    pass      # a simultaneous run created it first
                continue
            data = {**current["data"], **fields, "proposed_due_date": gap.get("due_date")}
            if current["data"].get("due_date_source") != "manual":      # a date the user set by hand is never replaced
                data["due_date"], data["due_date_source"] = gap.get("due_date"), "proposed" if gap.get("due_date") else None
            patch: dict = {"data": data, "updated_at": ctx["now"]}
            if current.get("status") == "completed":
                # Marked complete, but the check still finds the gap: it is open again.
                patch["status"] = "open"
                data["reopened_at"] = ctx["today"].isoformat()
                data["resolved_by_assessment_id"] = None
            await self.store.update("actions", current["id"], patch, bump=False)
        covered = {c: g["code"] for g in gaps.values() for c in g.get("also") or []}
        for code, current in existing.items():
            if code not in gaps and current.get("status") in rules.UNRESOLVED_ACTION_STATES and (current["data"] or {}).get("kind") == "gap":
                note = f"Covered by the action for {covered[code]}: they are the same fix." if code in covered else "The check no longer finds this gap."
                data = {**current["data"], "resolved_by_assessment_id": run["id"],
                        "completion": {"kind": "reassessment", "at": ctx["today"].isoformat(), "note": note}}
                await self.store.update("actions", current["id"], {"status": "completed", "data": data, "updated_at": ctx["now"]}, bump=False)
                await self.emit(ctx, "ActionCompleted", row, {"action_code": code, "by": "reassessment"}, run["data"].get("correlation_id"))

    async def update_action(self, user_id: str, business_id: str, subject_type: str, subject_id: str, action_id: str, changes: dict, email: str | None = None) -> dict:
        """Change an action's owner, date or state. Completing one needs evidence or a recorded
        reviewer decision; dismissing one needs a reason. Neither changes the criterion: only a
        new check does."""
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, subject_type, "edit")
        row = await self._row("subjects", business_id, subject_id, subject_type)
        action = await self._row("actions", business_id, action_id, subject_type)
        if action["subject_id"] != row["id"]:
            raise NotFound()
        c = _clean(changes or {}) or {}
        data = dict(action["data"] or {})
        patch: dict = {"updated_at": ctx["now"]}
        if "owner" in c:
            data["owner"] = c["owner"] or None
        if "due_date" in c:
            if engine.blank(c["due_date"]):
                data["due_date"], data["due_date_source"] = data.get("proposed_due_date"), "proposed" if data.get("proposed_due_date") else None
            else:
                d = engine.parse_day(c["due_date"])
                if d is None:
                    raise Invalid({"due_date": "Enter a valid date."})
                data["due_date"], data["due_date_source"] = d.isoformat(), "manual"
        status = c.get("status")
        if status is not None:
            if status not in rules.ACTION_STATES:
                raise Invalid({"status": "Unknown state."})
            if status == "completed":
                evidence_id, rationale = c.get("evidence_id"), (c.get("rationale") or "").strip()
                if evidence_id:
                    await self._row("evidence", business_id, evidence_id)
                    data["completion"] = {"kind": "evidence", "evidence_id": evidence_id, "by": ctx["actor"].email or user_id, "at": ctx["today"].isoformat()}
                elif rationale:
                    self._need(ctx, subject_type, "review")
                    data["completion"] = {"kind": "reviewer_decision", "rationale": rationale, "by": ctx["actor"].email or user_id, "at": ctx["today"].isoformat()}
                else:
                    raise Invalid({"completion": "Attach the evidence that completes this, or have a reviewer record why it is complete."})
            elif status == "dismissed":
                reason = (c.get("reason") or "").strip()
                if len(reason) < 3:
                    raise Invalid({"reason": "Say why this is being dismissed."})
                data["dismissal"] = {"reason": reason, "by": ctx["actor"].email or user_id, "at": ctx["today"].isoformat()}
            patch["status"] = status
        patch["data"] = data
        saved = await self.store.update("actions", action["id"], patch) or action
        if status == "completed":
            await self.emit(ctx, "ActionCompleted", row, {"action_code": saved.get("key"), "by": data["completion"]["kind"]})
        return {**self._public_action(saved),
                "note": "This is recorded. Readiness changes when the check is run again." if status in ("completed", "dismissed") else None}

    # ── launch decisions ──────────────────────────────────────────────────────

    def _public_decision(self, d: dict) -> dict:
        return {"id": d["id"], "kind": d["kind"], "created_at": d.get("created_at"), **(d.get("data") or {})}

    async def _decision(self, row: dict, ctx: dict, kind: str, data: dict) -> dict:
        return await self.store.insert("decisions", {"id": new_id(), "business_id": row["business_id"], "kind": kind, "subject_id": row["id"], "status": "recorded",
                                                     "revision": 1, "key": None, "created_by": ctx["actor"].user_id, "created_at": ctx["now"], "updated_at": ctx["now"],
                                                     "data": {**data, "actor": ctx["actor"].email or ctx["actor"].user_id, "at": ctx["now"].isoformat()}})

    async def _open_risks(self, row: dict, ctx: dict, assessment_id: str | None) -> tuple[dict | None, dict]:
        run = await self._row("assessments", row["business_id"], assessment_id, rules.LAUNCH) if assessment_id else await self._latest(row, succeeded_only=True)
        if run and run["subject_id"] != row["id"]:
            raise NotFound()
        result = (run["data"] or {}).get("result") if run else None
        fresh = await self._freshness(run, row, ctx) if run else {"status": None, "reason": "No check has been run."}
        return run, {"assessment_id": run["id"] if run else None, "assessment_as_of": (run["data"] or {}).get("as_of") if run else None,
                     "classification": (result or {}).get("classification"), "freshness": fresh.get("status"),
                     "blockers": [{"code": g["code"], "label": g["label"], "reason": g["reason"]} for g in (result or {}).get("gates", []) if g["state"] == "failed"],
                     "unknown": [g["code"] for g in (result or {}).get("gates", []) if g["state"] == "unknown"]}

    async def record_decision(self, user_id: str, business_id: str, subject_id: str, *, decision: str, rationale: str = "", assessment_id: str | None = None,
                              acknowledged_risks: list[str] | None = None, new_target_date: str | None = None, email: str | None = None) -> dict:
        """Proceed, defer or cancel. This records intent only: it publishes nothing, takes no
        payment and does not mark the business as launched."""
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, rules.LAUNCH, "decide")
        row = await self._row("subjects", business_id, subject_id, rules.LAUNCH)
        if row.get("status") in ("archived", "launched", "cancelled"):
            raise Conflict(row["status"], "A decision can't be recorded on a launch that is " + row["status"] + ".")
        if decision not in ("proceed", "defer", "cancel"):
            raise Invalid({"decision": "Choose proceed, defer or cancel."})
        _, risks = await self._open_risks(row, ctx, assessment_id)
        data = dict(row["data"] or {})
        status = "preparing"
        if decision == "defer":
            when = engine.parse_day(new_target_date)
            if when is None:
                raise Invalid({"new_target_date": "Enter the new launch date."})
            data["target_date"] = when.isoformat()
        if decision == "cancel":
            status = "cancelled"
        record = await self._decision(row, ctx, "decision", {
            "decision": decision, "rationale": (rationale or "").strip()[:MAX_TEXT] or None, "scope": data.get("scope"), "target_date": data.get("target_date"),
            "previous_target_date": (row["data"] or {}).get("target_date") if decision == "defer" else None,
            "acknowledged_risks": [str(x)[:300] for x in (acknowledged_risks or [])][:20], **risks})
        saved = await self.store.update("subjects", row["id"], {"status": status, "data": data, "updated_at": ctx["now"]}) or row
        if decision == "defer":
            await self._invalidate(saved, ctx, "The launch date changed.")
        await self.emit(ctx, "LaunchDecisionRecorded", saved, {"decision": decision, "decision_id": record["id"]})
        extra = {"date_review": self._date_review(data)} if decision == "defer" else {}
        return await self._detail(saved, ctx, extra)

    async def record_launch(self, user_id: str, business_id: str, subject_id: str, *, actual_date: str, scope: str = "", acknowledge: bool = False,
                            email: str | None = None) -> dict:
        """Record that the launch happened. It can be recorded whatever the last check said: the
        result is preserved as it was and open blockers are recorded as acknowledged, not resolved.
        The business's operating stage is not changed."""
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, rules.LAUNCH, "decide")
        row = await self._row("subjects", business_id, subject_id, rules.LAUNCH)
        if row.get("status") in ("archived", "launched", "cancelled"):
            raise Conflict(row["status"], "This launch is " + row["status"] + ".")
        when = engine.parse_day(actual_date)
        if when is None:
            raise Invalid({"actual_date": "Enter the date the launch happened."})
        if when > ctx["today"]:
            raise Invalid({"actual_date": "The launch date can't be in the future. Record it once it has happened."})
        _, risks = await self._open_risks(row, ctx, None)
        open_risk = bool(risks["blockers"]) or risks["classification"] not in ("ready", "conditionally_ready") or risks["freshness"] != "current"
        if open_risk and not acknowledge:
            raise Conflict("acknowledgement_required",
                           "The last check did not find this launch ready. You can still record what happened: confirm you have seen the open blockers and risks.",
                           current={"open_risks": risks})
        data = {**(row["data"] or {}), "actual_launch": {"date": when.isoformat(), "scope": (scope or "").strip()[:MAX_TEXT] or (row["data"] or {}).get("scope"),
                                                          "recorded_by": ctx["actor"].email or user_id, "recorded_at": ctx["now"].isoformat(),
                                                          "acknowledged": bool(acknowledge), **risks}}
        record = await self._decision(row, ctx, "actual_launch", {"actual_date": when.isoformat(), "scope": data["actual_launch"]["scope"],
                                                                  "acknowledged": bool(acknowledge), **risks})
        saved = await self.store.update("subjects", row["id"], {"status": "launched", "data": data, "updated_at": ctx["now"]}) or row
        try:
            await self.store.insert("actions", {"id": new_id(), "business_id": business_id, "kind": rules.LAUNCH, "subject_id": row["id"], "status": "open", "revision": 1,
                                                "key": "post_launch_review", "created_by": "system", "created_at": ctx["now"], "updated_at": ctx["now"],
                                                "data": {"kind": "follow_up", "title": "Hold the post-launch review", "group": 3, "order": 99, "weight": 0,
                                                         "why": "The launch has happened. Compare what happened with the plan and record what you learned.",
                                                         "priority_reason": "A follow-up after launch.", "evidence_required": "Notes from the review",
                                                         "due_date": engine.get(data, "control.review_date"), "due_date_source": "proposed" if engine.get(data, "control.review_date") else None,
                                                         "proposed_due_date": engine.get(data, "control.review_date"), "section": "sales", "tool": None}})
        except Duplicate:
            pass
        await self.emit(ctx, "LaunchRecorded", saved, {"decision_id": record["id"], "actual_date": when.isoformat()})
        return await self._detail(saved, ctx)

    # ── scenarios (nothing is saved) ──────────────────────────────────────────

    @staticmethod
    def scenarios_enabled() -> bool:
        try:
            from app.core.config import get_settings
            return bool(getattr(get_settings(), "readiness_scenarios_enabled", True))
        except Exception:      # noqa: BLE001
            return True

    async def scenario(self, user_id: str, business_id: str, subject_type: str, subject_id: str, change: dict, email: str | None = None) -> dict:
        """Compare a supported change with the baseline. The case, its forecast, the business's
        records and every assessment are left exactly as they were."""
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, subject_type, "read")
        if not self.scenarios_enabled():
            raise Unavailable("Scenarios aren't available yet. The readiness check works without them.")
        row = await self._row("subjects", business_id, subject_id, subject_type)
        forecast = await self._forecast_of(row)
        if not forecast:
            raise Invalid({"forecast": "Add a cash forecast before testing a scenario."})
        snapshot = await self._snapshot(row, ctx)
        profile = rules.get_profile(row["data"]["profile"])
        proof = engine.financing_proof(snapshot["evidence"], ctx["today"], profile["freshness_days"]["evidence"])
        change = _clean(change or {}) or {}
        fdata = copy.deepcopy(forecast["data"] or {})
        try:
            if subject_type == rules.FUNDING:
                required = engine.funding_required_months(row["data"], fdata, profile)
                amount = fc.dec(change.get("amount") if not engine.blank(change.get("amount")) else row["data"].get("target_amount"))
                when = engine.parse_day(change.get("receipt_date") or row["data"].get("receipt_date"))
                if amount is None or amount <= 0 or when is None:
                    raise fc.Invalid("Enter a funding amount above zero and a receipt date.")
                month = fc.month_key((when.year, when.month))
                baseline = fc.compute(fdata, required, proof=proof)
                result = fc.compute(fdata, required, proof=proof, extra_financing={month: amount})
                notes = [f"{row['data'].get('currency') or ''} {amount:,.2f} is received in {fc.month_label(month)}.".strip()]
            else:
                required = engine.launch_required_months(row["data"], profile, ctx["today"])
                target = engine.parse_day(row["data"].get("target_date"))
                launch_month = fc.month_key((target.year, target.month)) if target else None
                changed, notes = fc.scenario_forecast(fdata, change, launch_month)
                baseline = fc.compute(fdata, required, proof=proof)
                result = fc.compute(changed, required, proof=proof)
        except fc.Invalid as e:
            raise Invalid({"scenario": str(e)}) from e
        return {"saved": False, "formula_version": fc.SCENARIO_VERSION, "assumption_changes": notes,
                "baseline": {**fc.public(baseline), "forecast_id": forecast["id"], "forecast_revision": forecast["revision"]},
                "scenario": fc.public(result),
                "comparison": {"min_cash": {"baseline": baseline["min_cash"], "scenario": result["min_cash"]},
                               "first_negative_month": {"baseline": baseline["first_negative_month"], "scenario": result["first_negative_month"]}},
                "note": "This is a comparison only. Nothing was saved, and a scenario never clears a blocker: only the assessed baseline does."}

    # ── materials: reports and preparation documents ──────────────────────────

    async def _public_artifact(self, a: dict, row: dict, with_content: bool = True) -> dict:
        data = a["data"] or {}
        needs_review, reason = False, None
        if a.get("status") != "superseded":
            if row["kind"] == rules.FUNDING:
                forecast = await self._forecast_of(row)
                if data.get("facts") != engine.document_facts(row["data"], (forecast or {}).get("data")):
                    needs_review, reason = True, "The funding target, currency or forecast changed after this was prepared."
            latest = await self._latest(row, succeeded_only=True)
            if not needs_review and latest and latest["id"] != data.get("assessment_id"):
                needs_review, reason = True, "A newer check has been run since this was prepared."
        out = {"id": a["id"], "kind": a["kind"], "status": a.get("status"), "revision": a.get("revision"), "title": data.get("title"),
               "version": data.get("version"), "assessment_id": data.get("assessment_id"), "as_of": data.get("as_of"), "profile": data.get("profile"),
               "created_at": a.get("created_at"), "generated_by": data.get("generated_by"), "edited": bool(data.get("edited")),
               "reviewed_by": data.get("reviewed_by"), "reviewed_at": data.get("reviewed_at"), "needs_review": needs_review, "needs_review_reason": reason,
               "formats": ["pdf", "txt"]}
        if with_content:
            out.update({"content": data.get("content"), "body": data.get("body")})
        return out

    async def list_materials(self, user_id: str, business_id: str, subject_type: str, subject_id: str, email: str | None = None) -> dict:
        from app.modules.readiness import materials
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, subject_type, "read")
        row = await self._row("subjects", business_id, subject_id, subject_type)
        rows = await self.store.list("artifacts", business_id, subject_id=row["id"])
        return {"kinds": [{"kind": k, "title": v} for k, v in materials.KINDS[subject_type].items()],
                "items": [await self._public_artifact(a, row, with_content=False) for a in rows]}

    async def generate_material(self, user_id: str, business_id: str, subject_type: str, subject_id: str, kind: str, *, assessment_id: str | None = None,
                                idempotency_key: str | None = None, email: str | None = None) -> dict:
        """Prepare a document from one assessment snapshot. A retry with the same key returns the
        same document; a new one supersedes the earlier draft of its kind and never rewrites it."""
        from app.modules.readiness import materials
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, subject_type, "export")
        row = await self._row("subjects", business_id, subject_id, subject_type)
        if kind not in materials.KINDS[subject_type]:
            raise Invalid({"kind": "That document isn't available."})
        key = (idempotency_key or "").strip()[:120] or None
        if key:
            existing = await self.store.find_key("artifacts", business_id, row["id"], key)
            if existing:
                return {**await self._public_artifact(existing, row), "repeated": True}
        run = await self._row("assessments", business_id, assessment_id, subject_type) if assessment_id else await self._latest(row, succeeded_only=True)
        if not run or run["subject_id"] != row["id"] or run.get("status") != "succeeded":
            raise Invalid({"assessment": "Run the check first. Documents are prepared from a completed check."})
        actions = [a for a in await self._actions(row) if a["status"] in rules.UNRESOLVED_ACTION_STATES]
        content = materials.build(kind, row, run, actions)
        snap = run["data"]["snapshot"]
        earlier = [a for a in await self.store.list("artifacts", business_id, subject_id=row["id"], kind=kind)]
        record = {"id": new_id(), "business_id": business_id, "kind": kind, "subject_id": row["id"], "status": "draft", "revision": 1, "key": key,
                  "created_by": user_id, "created_at": ctx["now"], "updated_at": ctx["now"],
                  "data": {"title": content["title"], "content": content, "body": materials.to_text(content), "version": len(earlier) + 1,
                           "assessment_id": run["id"], "as_of": run["data"].get("as_of"), "profile": run["data"].get("profile"),
                           "facts": engine.document_facts(snap["subject"], snap.get("forecast")) if subject_type == rules.FUNDING else None,
                           "generated_by": ctx["actor"].email or user_id, "edited": False}}
        try:
            saved = await self.store.insert("artifacts", record)
        except Duplicate:
            existing = await self.store.find_key("artifacts", business_id, row["id"], key)
            return {**await self._public_artifact(existing, row), "repeated": True}
        for a in earlier:
            if a.get("status") != "superseded":
                await self.store.update("artifacts", a["id"], {"status": "superseded", "updated_at": ctx["now"]}, bump=False)
        slot = {"executive_summary": "executive_summary", "pitch_outline": "executive_summary"}.get(kind)
        if subject_type == rules.FUNDING and slot and row.get("status") != "archived":
            current = ((row["data"] or {}).get("documents") or {}).get(slot) or {}
            if not current.get("evidence_id"):      # a document the user attached themselves is left alone

                def apply(data: dict) -> None:
                    data.setdefault("documents", {})[slot] = {"artifact_id": saved["id"], "evidence_id": None, "reviewed": False}
                row = await self._patch_data(row, ctx, apply, "A document was prepared.", quiet=True)
        return await self._public_artifact(saved, row)

    async def get_material(self, user_id: str, business_id: str, subject_type: str, subject_id: str, artifact_id: str, email: str | None = None) -> dict:
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, subject_type, "read")
        row = await self._row("subjects", business_id, subject_id, subject_type)
        a = await self._row("artifacts", business_id, artifact_id)
        if a["subject_id"] != row["id"]:
            raise NotFound()
        return await self._public_artifact(a, row)

    async def update_material(self, user_id: str, business_id: str, subject_type: str, subject_id: str, artifact_id: str, *, body: str | None = None,
                              reviewed: bool | None = None, revision: int | None = None, email: str | None = None) -> dict:
        """Edit a draft's text, or mark it reviewed. A superseded document is never changed."""
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, subject_type, "review" if reviewed is not None else "edit")
        row = await self._row("subjects", business_id, subject_id, subject_type)
        a = await self._row("artifacts", business_id, artifact_id)
        if a["subject_id"] != row["id"]:
            raise NotFound()
        if a.get("status") == "superseded":
            raise Conflict("superseded", "This version has been replaced and can't be changed. Open the latest version.")
        data = dict(a["data"] or {})
        patch: dict = {"updated_at": ctx["now"]}
        if body is not None:
            data.update({"body": str(body)[:60000], "edited": True, "reviewed_by": None, "reviewed_at": None})
            patch["status"] = "draft"
        if reviewed is not None:
            patch["status"] = "reviewed" if reviewed else "draft"
            data.update({"reviewed_by": (ctx["actor"].email or user_id) if reviewed else None, "reviewed_at": ctx["today"].isoformat() if reviewed else None})
        patch["data"] = data
        saved = await self.store.update("artifacts", a["id"], patch, expect_revision=revision)
        if saved is None:
            raise Conflict("stale_revision", "This document changed while you were editing. Your text is kept here so you can compare and apply it again.",
                           current=await self._public_artifact(await self._row("artifacts", business_id, artifact_id), row))
        return await self._public_artifact(saved, row)

    async def download_material(self, user_id: str, business_id: str, subject_type: str, subject_id: str, artifact_id: str, fmt: str = "pdf",
                                email: str | None = None) -> dict:
        """The stored document, exactly as prepared. Access is checked at download."""
        from app.modules.readiness import materials
        ctx = await self._ctx(user_id, business_id, email)
        self._need(ctx, subject_type, "export")
        row = await self._row("subjects", business_id, subject_id, subject_type)
        a = await self._row("artifacts", business_id, artifact_id)
        if a["subject_id"] != row["id"]:
            raise NotFound()
        data = a["data"] or {}
        name = f"{(data.get('title') or 'document').lower().replace(' ', '-')}-{data.get('as_of') or ''}"
        if fmt == "txt":
            return {"name": f"{name}.txt", "content_type": "text/plain; charset=utf-8", "content": (data.get("body") or materials.to_text(data["content"])).encode("utf-8")}
        return {"name": f"{name}.pdf", "content_type": "application/pdf",
                "content": materials.to_pdf(data["content"], data.get("body") if data.get("edited") else None)}

    # ── summaries for the dashboard (the dashboard presents these; it never recalculates) ──

    async def _summary_of(self, row: dict, latest: dict | None, ctx: dict) -> dict:
        data = row["data"] or {}
        done = latest if latest and latest.get("status") == "succeeded" else await self._latest(row, succeeded_only=True)
        result = (done["data"] or {}).get("result") if done else None
        async def no_check() -> dict:
            return {"status": None, "reason": None}
        fresh, listed = await asyncio.gather(self._freshness(done, row, ctx, newest=done) if done else no_check(),
                                             self.store.list("actions", row["business_id"], subject_id=row["id"], limit=300))
        actions = [a for a in listed if a.get("status") in rules.UNRESOLVED_ACTION_STATES]
        actions.sort(key=self._rank)
        nxt = actions[0] if actions else None
        out = {"business_id": row["business_id"], "assessment_id": done["id"] if done else None, "profile_version": data.get("profile"),
               "classification": (result or {}).get("classification"), "score": engine.display_score((result or {}).get("score")),
               "confidence": ((result or {}).get("confidence") or {}).get("level"), "freshness": fresh.get("status"), "freshness_reason": fresh.get("reason"),
               "blocker_count": (result or {}).get("blocker_count") if result else None, "next_action_id": nxt["id"] if nxt else None,
               # Beyond the contract, for display:
               "title": data.get("title") or data.get("name"), "headline": (result or {}).get("headline"), "as_of": (done["data"] or {}).get("as_of") if done else None,
               "next_action": {"id": nxt["id"], "title": nxt["data"].get("title"), "section": nxt["data"].get("section")} if nxt else None,
               "open_actions": len(actions), "missing_count": len((result or {}).get("missing") or []) if result else None,
               "blockers": [{"code": g["code"], "label": g["label"], "reason": g["reason"]} for g in (result or {}).get("gates", []) if g["state"] == "failed"],
               "execution_status": latest.get("status") if latest else None}
        if row["kind"] == rules.FUNDING:
            out.update({"case_id": row["id"], "coverage": (result or {}).get("coverage") if result else None, "route": data.get("route"),
                        "lifecycle_status": row.get("status")})
        else:
            out.update({"initiative_id": row["id"], "launch_type": data.get("launch_type"), "scope": data.get("scope"), "target_date": data.get("target_date"),
                        "lifecycle_status": row.get("status"), "evidence_coverage": (result or {}).get("coverage") if result else None,
                        "gate_completeness": (result or {}).get("gate_completeness") if result else None})
        return out

    async def launch_figures(self, row: dict, today: date) -> dict:
        """Planned costs, runway and funding secured for a launch, from its plan and cash
        projection. Each is None when the plan does not hold it: nothing is estimated.
        Funding counts under the same rule as everywhere else (engine.financing_proof)."""
        data = row["data"] or {}
        forecast = await self._forecast_of(row)
        fdata = (forecast or {}).get("data") or {}
        out: dict[str, Any] = {"planned_costs": None, "planned_costs_source": None, "runway": None, "funding_secured": None,
                               "opening_cash": fdata.get("opening_cash"), "currency": fdata.get("currency")}
        payments, months = [], []
        for m in fdata.get("months") or []:
            try:
                value = fc.dec(m.get("payments"))
            except fc.Invalid:
                value = None
            if fc.parse_month(m.get("month")):
                months.append(fc.month_key(fc.parse_month(m.get("month"))))
            if value is not None:
                payments.append(value)
        if payments and sum(payments) > 0:
            out.update({"planned_costs": float((sum(payments) / len(payments)).quantize(fc.CENT)), "planned_costs_source": "average payments in your launch plan's cash projection"})
        else:
            try:
                fixed, variable, volume = (fc.dec(engine.get(data, p)) for p in ("economics.fixed_costs_monthly", "economics.variable_cost_per_unit", "planned_volume.amount"))
                total = (fixed or 0) + ((variable or 0) * (volume or 0))
                if total > 0:
                    out.update({"planned_costs": float(total), "planned_costs_source": "fixed costs plus delivery costs in your launch plan"})
            except fc.Invalid:
                pass
        if not months:
            return out
        profile = rules.get_profile(data["profile"])
        evidence = await self._evidence_for(row, forecast)
        proof = engine.financing_proof([{"id": e["id"], **(e.get("data") or {})} for e in evidence], today, profile["freshness_days"]["evidence"])
        counted, _ = fc.baseline_financing(fdata, proof)
        if fdata.get("financing_items"):
            out["funding_secured"] = float(sum(counted.values(), fc.Decimal(0)))
        computed = fc.compute(fdata, sorted(set(months)), proof=proof)
        if computed["state"] == "complete":
            ahead = [k for k in sorted(computed["cash_by_month"]) if k >= fc.month_key((today.year, today.month))]
            negative = next((k for k in ahead if computed["cash_by_month"][k] < 0), None)
            if negative:
                out["runway"] = {"months": max(0, fc.months_between((today.year, today.month), fc.parse_month(negative))), "until": negative, "until_label": fc.month_label(negative)}
            elif ahead:
                out["runway"] = {"beyond": ahead[-1], "beyond_label": fc.month_label(ahead[-1])}
        return out

    async def planned_monthly_costs(self, business_id: str) -> dict | None:
        """Planned monthly costs from the business's launch plan, for a caller already authorised
        for it: fixed costs plus the cost of delivering the planned volume, or else the average
        monthly payments in its cash projection. None when no plan holds a cost."""
        launches = [r for r in await self.store.list("subjects", business_id, kind=rules.LAUNCH) if r.get("status") in ("draft", "preparing")]
        launches.sort(key=lambda r: (not (r["data"] or {}).get("pinned"), str((r["data"] or {}).get("target_date") or "9999")))
        for row in launches:
            data = row["data"] or {}
            name = f"your launch plan \u201c{data.get('name')}\u201d"
            try:
                fixed, variable, volume = (fc.dec(engine.get(data, p)) for p in ("economics.fixed_costs_monthly", "economics.variable_cost_per_unit", "planned_volume.amount"))
            except fc.Invalid:
                fixed = variable = volume = None
            total = (fixed or 0) + ((variable or 0) * (volume or 0))
            if total > 0:
                return {"amount": float(total), "source": name}
            forecast = await self._forecast_of(row)
            payments = []
            for m in ((forecast or {}).get("data") or {}).get("months") or []:
                try:
                    value = fc.dec(m.get("payments"))
                except fc.Invalid:
                    value = None
                if value is not None:
                    payments.append(value)
            if payments and sum(payments) > 0:
                return {"amount": float(sum(payments) / len(payments)), "source": f"the cash projection in {name}"}
        return None

    async def dashboard_summaries(self, business_id: str, ctx_data: dict, actor, now: datetime) -> dict:
        """The selected funding case and launch initiative for a business the caller has already
        been authorised for. Selection is explained, and other records are counted, not hidden."""
        ctx = {"actor": actor, "data": ctx_data, "now": now, "today": bz.local_now(ctx_data, now).date(), "business_id": business_id}
        out: dict[str, Any] = {"funding": None, "launch": None}
        rows = await self.store.list("subjects", business_id)
        async def summarise(pick: dict) -> dict:
            return await self._summary_of(pick, await self._latest(pick), ctx)
        jobs: dict[str, Any] = {}
        cases = [r for r in rows if r["kind"] == rules.FUNDING and r.get("status") in ("draft", "active")]
        if cases:
            pinned = [r for r in cases if (r["data"] or {}).get("pinned")]
            pick = (pinned or sorted(cases, key=lambda r: str(r.get("updated_at")), reverse=True))[0]
            jobs["funding"] = (summarise(pick), {"selection": "You pinned this case." if pinned else "Your most recently updated case.", "others": len(cases) - 1})
        launches = [r for r in rows if r["kind"] == rules.LAUNCH and r.get("status") in ("draft", "preparing")]
        if launches:
            today = ctx["today"].isoformat()
            pinned = [r for r in launches if (r["data"] or {}).get("pinned")]

            def order(r: dict) -> tuple:
                d = str((r["data"] or {}).get("target_date") or "")
                return (0, d) if d >= today else (1, "~" + d) if d else (2, "")      # upcoming, nearest first; then past; undated last
            pick = (pinned or sorted(launches, key=order))[0]
            async def with_figures(pick: dict = pick) -> dict:
                summary, figures = await asyncio.gather(summarise(pick), self.launch_figures(pick, ctx["today"]))
                return {**summary, "figures": figures}
            jobs["launch"] = (with_figures(), {"selection": "You pinned this launch." if pinned else "Your launch with the nearest date." if (pick["data"] or {}).get("target_date") else "Your only undated launch.",
                                                "others": len(launches) - 1})
        # The two are independent, so they are read side by side rather than one after the other.
        found = await asyncio.gather(*(job for job, _ in jobs.values()))
        for (key, (_, extra)), summary in zip(jobs.items(), found):
            out[key] = {**summary, **extra}
        return out


# ── wiring ────────────────────────────────────────────────────────────────────

def service_for(orch) -> ReadinessService:
    """The readiness service that shares an Agent runtime's business gateway, clock, policy and
    event log (one permission model, one event mechanism)."""
    existing = getattr(orch, "_readiness", None)
    if existing is not None:
        return existing
    from app.modules.agent.store import MemoryStore as AgentMemoryStore
    from app.modules.readiness.store import SupabaseStore
    store: Store = MemoryStore() if isinstance(orch.rt.store, AgentMemoryStore) else SupabaseStore()
    svc = ReadinessService(store=store, business=orch.rt.business, policy_of=orch.rt.store.get_policy, clock=orch.rt.clock, emit=orch.rt.store.emit_event)
    orch._readiness = svc
    return svc
