"""The activation and education journeys.

`tick` does two things, in order. The selector reads every account's real state and schedules,
moves or cancels its steps. The sender then takes each step that is due and, immediately before
sending, checks again that the person may be emailed and that the step still applies: someone
who creates a workspace between scheduling and delivery gets nothing.

A step exists once per (user, journey, step): the ledger's unique key and the provider's
idempotency key together mean a retry, a second worker or a repeated job cannot send twice.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from html import escape
from typing import Any, Awaitable, Callable

from app.modules.activation import rules
from app.modules.activation.store import Duplicate, NotSetUp, Store

logger = logging.getLogger(__name__)

PENDING = ("scheduled", "uncertain", "sending")
# The exact words a person agreed to, by version, kept with their permission.
WORDING_VERSION = "tips-v1"
WORDING = {"tips-v1": "Send me getting-started guides and product tips by email. Optional; you can unsubscribe at any time."}
SOURCE_WORDS = {"signup_checkbox_v1": "sign-up", "google_signup_prompt": "the prompt after signing in with Google", "preference_page": "the email preferences page",
                "account_settings": "account settings", "unsubscribe_link": "an unsubscribe link", "bounced": "an email that couldn't be delivered", "complained": "a spam report"}
STUCK_AFTER = timedelta(minutes=30)       # a step left "sending" this long is reconciled by retrying with the same idempotency key
RETRY_AFTER = timedelta(hours=1)


@dataclass
class Config:
    enabled: bool = False                 # off: nothing is scheduled or sent
    dry_run: bool = True                  # on: everything is worked out and reported, nothing is sent
    cohort: str = "internal"              # internal | sample | all  (the staged rollout)
    internal_emails: frozenset = frozenset()
    sample_percent: int = 10
    holdout_percent: int = 10             # eligible users who are never emailed, to measure what the emails change
    start_at: datetime | None = None      # accounts verified before this are "historical": enrolled in limited batches
    backlog_batch: int = 25               # historical accounts enrolled per run
    base_url: str = "http://localhost:5173"
    api_base_url: str = ""                # public API address, for the one-click unsubscribe header
    secret: str = "dev-activation-secret"
    sender_name: str = "EnterprateAI"
    reply_to: str | None = None
    postal_address: str = ""


@dataclass
class SendResult:
    sent: bool
    message_id: str | None = None
    uncertain: bool = False
    recipient_rejected: bool = False
    error: str | None = None


Sender = Callable[[dict], Awaitable[SendResult]]


def _bucket(user_id: str, salt: str) -> int:
    return int(hashlib.sha256(f"{salt}:{user_id}".encode()).hexdigest()[:8], 16) % 100


class ActivationService:
    def __init__(self, *, store: Store, send: Sender, config: Config | Callable[[], Config], clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
                 plan_of: Callable[[str], Awaitable[str]] | None = None):
        self.store, self._send, self._config, self.clock, self._plan_of = store, send, config, clock, plan_of

    @property
    def config(self) -> Config:
        return self._config() if callable(self._config) else self._config

    # ── permission ────────────────────────────────────────────────────────────

    @staticmethod
    def permission(user: dict) -> tuple[bool, str]:
        """Whether this account may be sent a promotional email, and if not, why."""
        if user.get("email_verified") is False:
            return False, "not_verified"
        status = user.get("marketing_email_status") or "unknown"
        if status in rules.PERMITTED:
            return True, status
        return False, {"unknown": "no_permission_recorded"}.get(status, status)

    def in_cohort(self, user: dict) -> bool:
        c = self.config
        if c.cohort == "all":
            return True
        if c.cohort == "sample":
            return _bucket(user["id"], "cohort") < c.sample_percent or str(user.get("email") or "").lower() in c.internal_emails
        return str(user.get("email") or "").lower() in c.internal_emails

    def internal(self, user: dict) -> bool:
        return str(user.get("email") or user.get("id") or "").strip().lower() in self.config.internal_emails

    def holdout(self, user: dict) -> bool:
        """Internal test accounts are never held out: they exist to receive the emails."""
        return not self.internal(user) and _bucket(user["id"], "holdout") < self.config.holdout_percent

    def token(self, user_id: str) -> str:
        sig = hmac.new(self.config.secret.encode(), user_id.encode(), hashlib.sha256).hexdigest()[:32]
        return base64.urlsafe_b64encode(user_id.encode()).decode().rstrip("=") + "." + sig

    def user_from_token(self, token: str) -> str | None:
        try:
            raw, sig = str(token).split(".", 1)
            user_id = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode()
        except Exception:      # noqa: BLE001
            return None
        return user_id if hmac.compare_digest(self.token(user_id).split(".", 1)[1], sig) else None

    async def set_permission(self, user_id: str, status: str, *, source: str, actor: str = "user", wording: str | None = None) -> dict:
        """Record (or withdraw) permission, with where it came from and when. Withdrawing takes effect at once."""
        if status not in rules.STATUSES:
            raise ValueError("unknown status")
        user = await self.store.get_user(user_id)
        if not user:
            raise KeyError(user_id)
        now = self.clock()
        patch: dict[str, Any] = {"marketing_email_status": status, "marketing_last_change_source": source}
        if status in rules.PERMITTED:
            if (user.get("marketing_email_status") or "unknown") == "suppressed" and actor != "admin":
                return user      # a bounced or complained address isn't switched back on by a tick box
            patch.update({"marketing_permission_source": source, "marketing_permission_at": now, "marketing_unsubscribed_at": None, "marketing_suppression_reason": None,
                          "marketing_permission_wording": wording or (WORDING_VERSION if actor == "user" else None)})
        elif status == "unsubscribed":
            patch.update({"marketing_unsubscribed_at": now})
        elif status == "suppressed":
            patch.update({"marketing_suppression_reason": source})
        await self.store.update_user(user_id, patch)
        if status not in rules.PERMITTED:
            await self._cancel(await self.store.ledger(user_id), status if status != "unknown" else "no_permission_recorded")
        await self._event(user_id, "unsubscribed" if status == "unsubscribed" else "suppressed" if status == "suppressed" else "permission_recorded",
                          {"status": status, "source": source, "actor": actor})
        return await self.store.get_user(user_id)

    async def preferences(self, user_id: str) -> dict | None:
        user = await self.store.get_user(user_id)
        if not user:
            return None
        status = user.get("marketing_email_status") or "unknown"
        changed = max((t for t in (rules.parse(user.get("marketing_permission_at")), rules.parse(user.get("marketing_unsubscribed_at"))) if t), default=None)
        source = user.get("marketing_last_change_source") or user.get("marketing_permission_source")
        return {"available": True, "email": user.get("email"), "product_tips": status in rules.PERMITTED, "status": status, "can_resubscribe": status != "suppressed",
                "permission_source": user.get("marketing_permission_source"), "permission_at": user.get("marketing_permission_at"),
                "last_changed_at": changed.isoformat() if changed else None,
                "last_changed_from": (SOURCE_WORDS.get(source) or ("support" if source and "recorded by" in source else source)) if changed else None,
                "wording": WORDING[WORDING_VERSION],
                # Signed up with Google, so never saw the sign-up tick box: asked once, in the app, and never again.
                "ask_once": status == "unknown" and user.get("auth_provider") == "google" and not user.get("marketing_prompt_answered_at")}

    async def answer_prompt(self, user_id: str, product_tips: bool) -> dict | None:
        """The one-time question for people who signed up with Google. A tick is consent, kept with
        the wording shown; closing it without a tick is not, and either way it isn't asked again."""
        user = await self.store.get_user(user_id)
        if not user:
            return None
        await self.store.update_user(user_id, {"marketing_prompt_answered_at": self.clock()})
        if product_tips:
            await self.set_permission(user_id, "subscribed", source="google_signup_prompt", wording=WORDING_VERSION)
        else:
            await self._event(user_id, "prompt_dismissed", {"source": "google_signup_prompt", "wording": WORDING_VERSION})
        return await self.preferences(user_id)

    # ── bookkeeping ───────────────────────────────────────────────────────────

    async def _event(self, user_id: str | None, type_: str, data: dict | None = None, *, dedupe: str | None = None, at: datetime | None = None) -> bool:
        try:
            await self.store.insert_event({"user_id": user_id, "type": type_, "at": at or self.clock(), "data": data or {}, "dedupe_key": dedupe})
            return True
        except Duplicate:
            return False
        except Exception:      # noqa: BLE001 - a log line that can't be written never stops a journey
            logger.warning("activation event %s could not be recorded", type_)
            return False

    async def _cancel(self, rows: list[dict], reason: str, journey: str | None = None) -> int:
        n = 0
        for r in rows:
            if r.get("state") in PENDING and (journey is None or r["journey_key"] == journey):
                if await self.store.update_ledger(r["id"], {"state": "cancelled", "stopped_reason": reason, "updated_at": self.clock()}, expect_state=r["state"]):
                    n += 1
        return n

    async def _schedule(self, user_id: str, journey: str, step: str, due: datetime) -> bool:
        try:
            await self.store.insert_ledger({"user_id": user_id, "journey_key": journey, "step_key": step, "due_at": due, "state": "scheduled", "attempt_count": 0,
                                            "provider_message_id": None, "sent_at": None, "stopped_reason": None, "template_version": rules.TEMPLATE_VERSION,
                                            "delivery_status": None, "created_at": self.clock(), "updated_at": self.clock()})
            return True
        except Duplicate:
            if journey != "C":
                return False      # already there: a step exists once, and journeys A and B never restart
            # A tip that was stopped before it went (the person had opted out) is put back in the queue: the
            # same row, so it still exists once and can still only be sent once.
            old = next((r for r in await self.store.ledger(user_id) if r["journey_key"] == "C" and r["step_key"] == step and r.get("state") == "cancelled"), None)
            if not old:
                return False
            return bool(await self.store.update_ledger(old["id"], {"state": "scheduled", "due_at": due, "stopped_reason": None, "attempt_count": 0,
                                                                   "template_version": rules.TEMPLATE_VERSION, "updated_at": self.clock()}, expect_state="cancelled"))

    def _historical(self, user: dict) -> bool:
        start = self.config.start_at
        verified = rules.parse(user.get("verified_at")) or rules.parse(user.get("created_at"))
        return bool(start) and (verified is None or verified < start)

    # ── the selector ──────────────────────────────────────────────────────────

    async def select(self, *, write: bool = True, explain: bool = False) -> list[dict]:
        """Work out what each account's state calls for. With `write=False` nothing is saved and the
        result is the dry-run report: every step that would be scheduled or cancelled, and why."""
        now, c = self.clock(), self.config
        users = await self.store.list_users()
        index = await self.store.workspace_index()
        by_user: dict[str, list[dict]] = {}
        for r in await self.store.ledger():
            by_user.setdefault(r["user_id"], []).append(r)
        plan: list[dict] = []
        backlog = 0
        for user in users:
            uid = user["id"]
            rows = by_user.get(uid, [])
            pending = [r for r in rows if r.get("state") in PENDING]
            allowed, why = self.permission(user)
            if not allowed:
                if pending:
                    plan.append({"user_id": uid, "action": "cancel", "journey": None, "why": why, "count": len(pending)})
                    if write:
                        await self._cancel(rows, why)
                elif explain:
                    plan.append({"user_id": uid, "action": "skip", "journey": None, "why": why})
                continue
            spaces = index.get(uid, [])
            has_ws = bool(spaces)
            journeys = {r["journey_key"] for r in rows}
            if has_ws and any(r["journey_key"] == "A" for r in pending):
                plan.append({"user_id": uid, "action": "cancel", "journey": "A", "why": "workspace_created"})
                if write:
                    await self._cancel(rows, "workspace_created", "A")
                    await self._event(uid, "workspace_created", dedupe=f"workspace_created:{uid}", at=rules.parse(min(str(s.get("created_at")) for s in spaces)) or now)
            if not self.in_cohort(user):
                if explain:
                    plan.append({"user_id": uid, "action": "skip", "journey": None, "why": "not_in_rollout"})
                continue
            before = len(plan)
            historical = self._historical(user)
            if not has_ws:
                # Journey A, once: an account that has had it, or has ever had a workspace, never re-enters.
                if "A" not in journeys and "B" not in journeys and "C" not in journeys:
                    if historical and backlog >= c.backlog_batch:
                        if explain:
                            plan.append({"user_id": uid, "action": "skip", "journey": "A", "why": "waiting_in_backlog"})
                        continue
                    backlog += 1 if historical else 0
                    start = now if historical else (rules.parse(user.get("verified_at")) or rules.parse(user.get("created_at")) or now)
                    plan.append({"user_id": uid, "action": "enrol", "journey": "A", "why": "verified, permission recorded, no workspace" + (" (historical account)" if historical else ""),
                                 "steps": [s for s, _ in rules.SCHEDULE["A"]]})
                    if write:
                        for step, offset in rules.SCHEDULE["A"]:
                            await self._schedule(uid, "A", step, max(start + offset, now))
                        await self._event(uid, "journey_started", {"journey": "A", "holdout": self.holdout(user)}, dedupe=f"journey:A:{uid}")
                elif explain:
                    plan.append({"user_id": uid, "action": "skip", "journey": "A", "why": "journey_already_run" if not pending else "already_in_journey"})
                continue
            # Has a workspace: what has been done comes from the records in it.
            facts = rules.user_facts(await self.store.workspaces_of(uid))
            if facts["first_task_done"]:
                if any(r["journey_key"] == "B" for r in pending):
                    plan.append({"user_id": uid, "action": "cancel", "journey": "B", "why": "first_task_completed"})
                    if write:
                        await self._cancel(rows, "first_task_completed", "B")
                if write:
                    await self._event(uid, "first_task_completed", dedupe=f"first_task:{uid}")
                tip = await self._next_tip(user, rows, facts, now)
                if tip:
                    plan.append({"user_id": uid, "action": "schedule", "journey": "C", "why": f"tip {tip}: has access, meets its condition, hasn't done what it suggests", "steps": [tip]})
                    if write:
                        await self._schedule(uid, "C", tip, now)
                elif explain:
                    plan.append({"user_id": uid, "action": "skip", "journey": "C", "why": "already_in_journey" if any(r["journey_key"] == "C" for r in pending) else "no_tip_due"})
                continue
            if "B" not in journeys:
                created = rules.parse(facts["workspace_created_at"]) or now
                old = now - created > timedelta(days=2)
                if old and backlog >= c.backlog_batch:
                    continue
                backlog += 1 if old else 0
                start = now if old else created
                plan.append({"user_id": uid, "action": "enrol", "journey": "B", "why": "workspace created, no first task completed", "steps": [s for s, _ in rules.SCHEDULE["B"]]})
                if write:
                    for step, offset in rules.SCHEDULE["B"]:
                        await self._schedule(uid, "B", step, max(start + offset, now))
                    await self._event(uid, "journey_started", {"journey": "B", "holdout": self.holdout(user)}, dedupe=f"journey:B:{uid}")
            if explain and len(plan) == before:
                plan.append({"user_id": uid, "action": "skip", "journey": "B", "why": "already_in_journey" if any(r["journey_key"] == "B" for r in pending) else "journey_already_run"})
        return plan

    async def _next_tip(self, user: dict, rows: list[dict], facts: dict, now: datetime) -> str | None:
        """At most two tips in any 30 days, at least ten days apart, and none while one is waiting or the account has gone quiet."""
        mine = [r for r in rows if r["journey_key"] == "C"]
        if any(r.get("state") in PENDING for r in mine):
            return None
        active = rules.parse(facts.get("last_active_at"))
        if active is None or now - active > rules.INACTIVE_AFTER:
            return None
        recent = [rules.parse(r.get("sent_at") or r.get("created_at")) for r in mine if r.get("state") in ("sent", "holdout")]
        recent = [t for t in recent if t and now - t < rules.C_WINDOW]
        if len(recent) >= rules.C_PER_MONTH or any(now - t < rules.C_MIN_GAP for t in recent):
            return None
        plan = await self._plan_of(user["id"]) if self._plan_of else "explorer"
        # "Had it" means it went (or was deliberately held back): a tip cancelled because the person had
        # unsubscribed was never received, so after they subscribe again it can be offered.
        tips = rules.eligible_tips(facts, plan, {r["step_key"] for r in mine if r.get("state") in ("sent", "holdout", "failed")})
        return tips[0] if tips else None

    # ── the sender ────────────────────────────────────────────────────────────

    async def _still_applies(self, row: dict, user: dict) -> tuple[bool, str]:
        """Checked against the records as they are now, not as they were when the step was scheduled."""
        spaces = await self.store.workspaces_of(user["id"])
        facts = rules.user_facts(spaces)
        if row["journey_key"] == "A":
            return (False, "workspace_created") if facts["has_workspace"] else (True, "no workspace")
        if row["journey_key"] == "B":
            if not facts["has_workspace"]:
                return False, "no_workspace"
            return (False, "first_task_completed") if facts["first_task_done"] else (True, "workspace, no first task")
        plan = await self._plan_of(user["id"]) if self._plan_of else "explorer"
        tip = rules.TIPS.get(row["step_key"])
        if not tip or not rules.plan_allows(plan, tip["feature"]) or not all(facts.get(n) for n in tip["needs"]) or facts.get(tip["suggests"]):
            return False, "no_longer_relevant"
        return True, "tip still relevant"

    def message(self, user: dict, row: dict) -> dict:
        """The email for one step. No business content: a neutral greeting, the reviewed copy, one link into the app."""
        c = self.config
        t = rules.ALL_TEMPLATES[row["step_key"]]
        base = c.base_url.rstrip("/")
        to = t["to"]
        link = f"{base}{to}{'&' if '?' in to else '?'}utm_source=activation&utm_medium=email&utm_campaign=journey_{row['journey_key'].lower()}&utm_content={row['step_key']}"
        token = self.token(user["id"])
        unsubscribe, prefs = f"{base}/email/unsubscribe?token={token}", f"{base}/email/preferences?token={token}"
        hello = f"Hello {rules.first_name(user.get('name'))}," if rules.first_name(user.get("name")) else "Hello,"
        foot = (f"You are receiving this because you asked for tips on getting started with EnterprateAI. "
                f"Unsubscribe: {unsubscribe}  ·  Email preferences: {prefs}")
        sender = f"{c.sender_name}" + (f", {c.postal_address}" if c.postal_address else "")
        text = "\n\n".join([hello, *t["body"], f"{t['button']}: {link}", "The EnterprateAI team", foot, sender])
        html = (f"<div style='font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1e293b;max-width:560px'>"
                f"<p>{escape(hello)}</p>" + "".join(f"<p>{escape(p)}</p>" for p in t["body"])
                + f"<p style='margin:24px 0'><a href='{escape(link)}' style='background:#4f46e5;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:10px;font-weight:600;display:inline-block'>{escape(t['button'])}</a></p>"
                f"<p>The EnterprateAI team</p>"
                f"<p style='font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:12px;margin-top:28px'>"
                f"You are receiving this because you asked for tips on getting started with EnterprateAI. "
                f"<a href='{escape(unsubscribe)}' style='color:#64748b'>Unsubscribe</a> · <a href='{escape(prefs)}' style='color:#64748b'>Email preferences</a><br>{escape(sender)}</p></div>")
        headers = {"X-Entity-Ref-ID": f"activation-{row['id']}"}
        if c.api_base_url:      # one-click unsubscribe for mail clients that offer it
            headers["List-Unsubscribe"] = f"<{c.api_base_url.rstrip('/')}/email/unsubscribe?token={token}>"
            headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
        return {"to": user["email"], "subject": t["subject"], "text": text, "html": html, "headers": headers, "reply_to": c.reply_to,
                "idempotency_key": f"activation/{user['id']}/{row['journey_key']}/{row['step_key']}/{row.get('template_version') or rules.TEMPLATE_VERSION}"}

    async def deliver(self, *, dry_run: bool | None = None) -> list[dict]:
        """Send what is due. Each step is claimed first, so two workers can't both take it, and
        everything that decides whether it should go is read again at this moment."""
        now, c = self.clock(), self.config
        dry = c.dry_run if dry_run is None else dry_run
        rows = [r for r in await self.store.ledger() if (r.get("state") in ("scheduled", "uncertain") and (rules.parse(r.get("due_at")) or now) <= now)
                or (r.get("state") == "sending" and (rules.parse(r.get("updated_at")) or now) <= now - STUCK_AFTER)]
        rows.sort(key=lambda r: (str(r.get("due_at")), r["journey_key"], r["step_key"]))
        report, sent_this_run = [], set()
        for r in rows:
            out = {"user_id": r["user_id"], "journey": r["journey_key"], "step": r["step_key"], "ledger_id": r["id"]}
            user = await self.store.get_user(r["user_id"])
            if not user:
                await self.store.update_ledger(r["id"], {"state": "cancelled", "stopped_reason": "account_deleted", "updated_at": now}, expect_state=r["state"])
                report.append({**out, "result": "cancelled", "why": "account_deleted"})
                continue
            allowed, why = self.permission(user)
            if not allowed:
                await self.store.update_ledger(r["id"], {"state": "cancelled", "stopped_reason": why, "updated_at": now}, expect_state=r["state"])
                report.append({**out, "result": "cancelled", "why": why})
                continue
            applies, reason = await self._still_applies(r, user)
            if not applies:
                await self.store.update_ledger(r["id"], {"state": "cancelled", "stopped_reason": reason, "updated_at": now}, expect_state=r["state"])
                if reason in ("workspace_created", "first_task_completed"):      # the rest of that journey has no purpose either
                    await self._cancel(await self.store.ledger(r["user_id"]), reason, r["journey_key"])
                report.append({**out, "result": "cancelled", "why": reason})
                continue
            if self.holdout(user):
                # Held back on purpose and counted, so the emails' effect can be measured against people who got none.
                await self.store.update_ledger(r["id"], {"state": "holdout", "stopped_reason": "holdout", "updated_at": now}, expect_state=r["state"])
                report.append({**out, "result": "holdout", "why": "in the measurement holdout"})
                continue
            if not rules.in_send_window(now, user.get("timezone")):
                later = rules.next_window_start(now, user.get("timezone"))
                await self.store.update_ledger(r["id"], {"due_at": later, "updated_at": now}, expect_state=r["state"])
                report.append({**out, "result": "deferred", "why": "outside 09:00 to 18:00 where they are", "until": later.isoformat()})
                continue
            mine = await self.store.ledger(r["user_id"])
            last = max((t for t in (rules.parse(x.get("sent_at")) for x in mine if x["id"] != r["id"] and x.get("state") == "sent") if t), default=None)
            if r["user_id"] in sent_this_run or (last and now - last < rules.MIN_GAP):
                later = rules.next_window_start((last or now) + rules.MIN_GAP, user.get("timezone"))
                await self.store.update_ledger(r["id"], {"due_at": later, "updated_at": now}, expect_state=r["state"])
                report.append({**out, "result": "deferred", "why": "another activation email went in the last 48 hours", "until": later.isoformat()})
                continue
            if dry:
                report.append({**out, "result": "would_send", "why": reason, "to": user["email"], "subject": rules.ALL_TEMPLATES[r["step_key"]]["subject"]})
                continue
            claimed = await self.store.update_ledger(r["id"], {"state": "sending", "attempt_count": int(r.get("attempt_count") or 0) + 1, "updated_at": now}, expect_state=r["state"])
            if not claimed:
                report.append({**out, "result": "skipped", "why": "already being handled"})
                continue
            try:
                result = await self._send(self.message(user, claimed))
            except Exception as e:      # noqa: BLE001 - whether it went is unknown: reconcile by retrying with the same key
                logger.warning("activation send raised for %s/%s: %s", r["user_id"], r["step_key"], e)
                result = SendResult(sent=False, uncertain=True, error=str(e))
            attempts = int(claimed.get("attempt_count") or 1)
            if result.sent:
                await self.store.update_ledger(r["id"], {"state": "sent", "sent_at": now, "provider_message_id": result.message_id, "delivery_status": "accepted", "updated_at": now})
                await self._event(r["user_id"], "sent", {"journey": r["journey_key"], "step": r["step_key"], "template_version": claimed.get("template_version")}, dedupe=f"sent:{r['id']}")
                sent_this_run.add(r["user_id"])
                report.append({**out, "result": "sent", "why": reason})
            elif result.recipient_rejected:
                await self.store.update_ledger(r["id"], {"state": "failed", "stopped_reason": "recipient_rejected", "delivery_status": "bounced", "updated_at": now})
                await self.set_permission(r["user_id"], "suppressed", source="bounced", actor="system")
                report.append({**out, "result": "failed", "why": "the address was refused; no further emails"})
            elif attempts >= rules.MAX_ATTEMPTS:
                await self.store.update_ledger(r["id"], {"state": "failed", "stopped_reason": "uncertain_after_retries" if result.uncertain else "send_failed", "updated_at": now})
                report.append({**out, "result": "failed", "why": result.error or "could not be sent"})
            else:
                # Not known to have gone, or not gone: try again later with the same idempotency key, which cannot deliver twice.
                await self.store.update_ledger(r["id"], {"state": "uncertain" if result.uncertain else "scheduled", "due_at": now + (STUCK_AFTER if result.uncertain else RETRY_AFTER), "updated_at": now})
                report.append({**out, "result": "retry", "why": result.error or "will be tried again"})
        return report

    async def tick(self) -> dict:
        """One run of the scheduled job."""
        if not self.config.enabled:
            return {"enabled": False, "selected": [], "delivered": []}
        return {"enabled": True, "dry_run": self.config.dry_run, "selected": await self.select(), "delivered": await self.deliver()}

    async def dry_run(self, at: datetime | None = None) -> dict:
        """Who would be enrolled, cancelled or emailed if the job ran now (or at `at`), and why each
        account is in or out, including whether it is 09:00 to 18:00 where they are. Nothing is written or sent."""
        if at is not None:
            # The same rules, with the clock set to the moment asked about.
            then = ActivationService(store=self.store, send=self._send, config=self._config, clock=lambda: at, plan_of=self._plan_of)
            return await then.dry_run()
        return {"at": self.clock().isoformat(), "config": self.describe(), "selected": await self.select(write=False, explain=True), "due": await self._due_preview()}

    async def _due_preview(self) -> list[dict]:
        now, out = self.clock(), []
        for r in await self.store.ledger():
            if r.get("state") not in PENDING or (rules.parse(r.get("due_at")) or now) > now:
                continue
            user = await self.store.get_user(r["user_id"])
            row = {"user_id": r["user_id"], "journey": r["journey_key"], "step": r["step_key"]}
            if not user:
                out.append({**row, "result": "would_cancel", "why": "account_deleted"})
                continue
            allowed, why = self.permission(user)
            applies, reason = (False, why) if not allowed else await self._still_applies(r, user)
            if not applies:
                out.append({**row, "result": "would_cancel", "why": reason})
            elif self.holdout(user):
                out.append({**row, "result": "holdout", "why": "in the measurement holdout"})
            elif not rules.in_send_window(now, user.get("timezone")):
                local = now.astimezone(rules.zone(user.get("timezone")))
                out.append({**row, "result": "would_defer", "why": f"outside 09:00 to 18:00 where they are (it would be {local:%H:%M} in {user.get('timezone') or rules.DEFAULT_TIMEZONE})",
                            "until": rules.next_window_start(now, user.get("timezone")).isoformat(), "timezone": user.get("timezone") or rules.DEFAULT_TIMEZONE})
            else:
                out.append({**row, "result": "would_send", "why": reason, "subject": rules.ALL_TEMPLATES[r["step_key"]]["subject"]})
        return out

    # ── delivery events from the provider ─────────────────────────────────────

    async def delivery_event(self, *, event_id: str, type_: str, message_id: str | None, at: datetime | None = None) -> dict:
        """delivered | bounced | complained | suppressed, from the provider's webhook. The same event
        arriving again changes nothing. A bounce or complaint stops every promotional email at once."""
        kind = {"email.delivered": "delivered", "email.bounced": "bounced", "email.complained": "complained", "email.suppressed": "suppressed",
                "email.delivery_delayed": "delayed"}.get(type_, type_)
        row = await self.store.ledger_by_message(message_id) if message_id else None
        if not await self._event(row["user_id"] if row else None, f"delivery_{kind}", {"message_id": message_id, "step": row["step_key"] if row else None}, dedupe=f"provider:{event_id}", at=at):
            return {"ok": True, "duplicate": True}
        if not row:
            return {"ok": True, "matched": False}
        if kind in ("delivered", "bounced", "complained", "suppressed"):
            if not (kind == "delivered" and row.get("delivery_status") in ("bounced", "complained")):
                await self.store.update_ledger(row["id"], {"delivery_status": kind, "updated_at": self.clock()})
        if kind in ("bounced", "complained", "suppressed"):
            await self.set_permission(row["user_id"], "suppressed", source=kind, actor="system")
        return {"ok": True, "matched": True, "status": kind}

    # ── for administrators ────────────────────────────────────────────────────

    def describe(self) -> dict:
        c = self.config
        return {"enabled": c.enabled, "dry_run": c.dry_run, "cohort": c.cohort, "internal_accounts": len(c.internal_emails), "sample_percent": c.sample_percent,
                "holdout_percent": c.holdout_percent, "historical_before": c.start_at.isoformat() if c.start_at else None, "backlog_batch": c.backlog_batch,
                "template_version": rules.TEMPLATE_VERSION, "one_click_unsubscribe": bool(c.api_base_url)}

    async def user_journey(self, user_id: str) -> dict | None:
        """One user's journey state for an administrator: steps, template versions, delivery, permission
        evidence and why anything stopped. Nothing from inside their business."""
        user = await self.store.get_user(user_id)
        if not user:
            return None
        allowed, why = self.permission(user)
        rows = sorted(await self.store.ledger(user_id), key=lambda r: (r["journey_key"], str(r.get("due_at"))))
        return {
            "user": {"id": user["id"], "email": user.get("email"), "verified": user.get("email_verified") is not False, "verified_at": user.get("verified_at"),
                     "timezone": user.get("timezone") or rules.DEFAULT_TIMEZONE},
            "permission": {"may_email": allowed, "reason": why, "status": user.get("marketing_email_status") or "unknown", "source": user.get("marketing_permission_source"),
                           "collected_at": user.get("marketing_permission_at"), "unsubscribed_at": user.get("marketing_unsubscribed_at"),
                           "suppression_reason": user.get("marketing_suppression_reason")},
            "cohort": {"in_rollout": self.in_cohort(user), "holdout": self.holdout(user), "internal": self.internal(user)},
            "steps": [{"journey": r["journey_key"], "step": r["step_key"], "subject": rules.ALL_TEMPLATES.get(r["step_key"], {}).get("subject"), "state": r.get("state"),
                       "due_at": r.get("due_at"), "sent_at": r.get("sent_at"), "attempts": r.get("attempt_count"), "template_version": r.get("template_version"),
                       "delivery_status": r.get("delivery_status"), "stopped_reason": r.get("stopped_reason")} for r in rows],
        }

    async def dashboard(self) -> dict:
        """Eligible users, sends and deliveries by step, activation within 7 and 14 days, first tasks,
        and the guardrails. Activation is read from workspaces and records, never from clicks or opens."""
        now = self.clock()
        users = {u["id"]: u for u in await self.store.list_users()}
        index = await self.store.workspace_index()
        rows = await self.store.ledger()
        events = await self.store.events()
        steps: dict[str, dict] = {}
        for key, t in rules.ALL_TEMPLATES.items():
            steps[key] = {"step": key, "journey": t["journey"], "subject": t["subject"], "scheduled": 0, "sent": 0, "delivered": 0, "bounced": 0, "complained": 0, "cancelled": 0, "holdout": 0, "failed": 0}
        for r in rows:
            s = steps.get(r["step_key"])
            if not s:
                continue
            state = r.get("state")
            s["scheduled" if state in PENDING else state if state in ("sent", "cancelled", "holdout", "failed") else "scheduled"] += 1
            if r.get("delivery_status") in ("delivered", "bounced", "complained"):
                s[r["delivery_status"]] += 1
        started = {e["user_id"]: e for e in events if e["type"] == "journey_started" and (e.get("data") or {}).get("journey") == "A"}
        first_task = {e["user_id"]: rules.parse(e.get("at")) for e in events if e["type"] == "first_task_completed"}

        def cohort(holdout: bool) -> dict:
            ids = [uid for uid, e in started.items() if bool((e.get("data") or {}).get("holdout")) == holdout]
            out = {"users": len(ids), "workspace_7d": 0, "workspace_14d": 0, "first_task_14d": 0}
            for uid in ids:
                begun = rules.parse(started[uid].get("at")) or now
                made = min((t for t in (rules.parse(w.get("created_at")) for w in index.get(uid, [])) if t), default=None)
                if made and made - begun <= timedelta(days=7):
                    out["workspace_7d"] += 1
                if made and made - begun <= timedelta(days=14):
                    out["workspace_14d"] += 1
                if first_task.get(uid) and first_task[uid] - begun <= timedelta(days=14):
                    out["first_task_14d"] += 1
            return out
        permitted = [u for u in users.values() if self.permission(u)[0]]
        return {
            "config": self.describe(),
            "eligible_users": len(permitted),
            "no_permission_recorded": sum(1 for u in users.values() if (u.get("marketing_email_status") or "unknown") == "unknown"),
            "eligible_without_workspace": sum(1 for u in permitted if not index.get(u["id"])),
            "steps": list(steps.values()),
            "emailed": cohort(False), "holdout": cohort(True),
            "guardrails": {"unsubscribed": sum(1 for u in users.values() if u.get("marketing_email_status") == "unsubscribed"),
                           "suppressed": sum(1 for u in users.values() if u.get("marketing_email_status") == "suppressed"),
                           "bounced": sum(s["bounced"] for s in steps.values()), "complained": sum(s["complained"] for s in steps.values())},
            "copy_notes": rules.NOTES,
        }
