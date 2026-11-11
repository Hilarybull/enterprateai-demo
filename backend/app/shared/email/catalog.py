"""Every kind of email the platform sends, for the superadmin's Emails area: what it is, whether it may be switched
off, and, for the ones whose wording can be edited, the wording sent today and the details it is filled with.

An edited email is written as plain text with {placeholders}. In the HTML version, a line that is just {link} becomes
the button and a line that is just {code} becomes the code box; every other line is escaped, so nothing typed here
can inject markup. The footer is added as it always is.
"""
from __future__ import annotations

import logging
import re
import time
from html import escape
from typing import Any

logger = logging.getLogger(__name__)

# key: (label, description, essential, editable)
# essential: needed for someone to get into their account, or sent because a person asked for it right then (their
# own invoice, their own document): it can't be switched off here.
KINDS: dict[str, dict[str, Any]] = {
    "email_verification": {"label": "Verify your email", "description": "Sent at sign-up to confirm the address.", "essential": True},
    "password_reset": {"label": "Password link", "description": "Sent when someone asks to set a new password.", "essential": True},
    "password_otp": {"label": "Password verification code", "description": "The code that confirms a password change.", "essential": True},
    "task_code": {"label": "Task sign-in code", "description": "The code that saves a task started on the homepage.", "essential": True},
    "workspace_invitation": {"label": "Workspace invitation", "description": "A team member invited to a workspace.", "essential": False},
    "proposal_invite": {"label": "Proposal invitation", "description": "A business invites someone to answer its RFP.", "essential": False},
    "document_share": {"label": "Document shared", "description": "A business shares a document by email.", "essential": True},
    "invoice_share": {"label": "Invoice sent", "description": "A business emails an invoice from Business Operations.", "essential": True},
    "agent_document": {"label": "Sent by the Agent", "description": "Quotes, invoices and documents the Agent sends for a business after the owner approves.", "essential": True},
    "quote_sent": {"label": "Quotation received", "description": "A buyer receives the quotation a business approved.", "essential": True},
    "quote_question": {"label": "Question about a quotation", "description": "Tells a business its customer asked about a quotation.", "essential": False},
    "quote_customer_action": {"label": "Customer acted on a quotation", "description": "Tells a business its customer accepted, declined or replied.", "essential": False},
    "claim_code": {"label": "Claim verification code", "description": "The code that proves someone manages a business they are claiming.", "essential": True},
    "claim_invitation": {"label": "Claim invitation and reminders", "description": "Tells a listed business about its Marketplace profile, then weekly until it is claimed.", "essential": False},
    "claim_decision": {"label": "Claim decision", "description": "Tells a claimant their claim was approved, rejected or removed.", "essential": False},
    "marketplace_team_invite": {"label": "Marketplace team invitation", "description": "Someone added to the Marketplace moderation team.", "essential": False},
    "activation": {"label": "Activation and tips", "description": "Getting-started emails and tips, only to people who agreed to them.", "essential": False},
    "demo_request": {"label": "Demo request notice", "description": "Tells the team someone asked for a demo.", "essential": False},
    "manual": {"label": "Sent from the superadmin", "description": "One-off emails written in this Emails area.", "essential": True},
    "other": {"label": "Other", "description": "Anything not listed above.", "essential": True},
}

# The ones whose wording can be edited: today's wording, the details it is filled with, and which must stay in it.
TEMPLATES: dict[str, dict[str, Any]] = {
    "email_verification": {
        "subject": "Verify your {app_name} email",
        "body": "{greeting}\n\nThank you for signing up to {app_name}! Please verify your email address to activate your account.\n\n{link}\n\nThis link expires in 24 hours. If you did not create an account, you can safely ignore this email.",
        "button": "Verify my email", "variables": ["greeting", "app_name", "link"], "required": ["link"]},
    "password_reset": {
        "subject": "Your {app_name} password link",
        "body": "Hi,\n\nWe received a request to set a new password for your {app_name} account ({email}).\n\n{link}\n\nThis link expires in {minutes} minutes.",
        "button": "Set new password", "variables": ["app_name", "email", "minutes", "link"], "required": ["link"]},
    "password_otp": {
        "subject": "Your {app_name} password verification code",
        "body": "Use the code below to verify your identity and update your password.\n\n{code}\n\nThis code expires in 10 minutes. If you did not request this, ignore this email. Your password will not change.",
        "button": "", "variables": ["app_name", "code"], "required": ["code"]},
    "task_code": {
        "subject": "{code} is your {app_name} code",
        "body": "Enter this on the page where you started, to save your work{saving}.\n\n{code}\n\nThis code expires in 10 minutes. If you didn't ask for it, you can ignore this email.",
        "button": "", "variables": ["app_name", "code", "saving"], "required": ["code"]},
    "workspace_invitation": {
        "subject": "You've been invited to join a workspace on {app_name}",
        "body": "{inviter_email} has invited you to join their workspace on {app_name}.\n\nAccess level: {access_level}\nThis invitation expires in {expires}.\n\n{link}",
        "button": "Accept invitation", "variables": ["inviter_email", "app_name", "access_level", "expires", "link"], "required": ["link"]},
    "proposal_invite": {
        "subject": "{sender_name} invited you to submit a proposal: {request_title}",
        "body": "{sender_name} has invited you to submit a proposal for the following request:\n\n{request_title}\n{request_description}\n\n{requirements}\n\n{link}",
        "button": "View request & apply", "variables": ["sender_name", "request_title", "request_description", "requirements", "link"], "required": ["link"]},
    "document_share": {
        "subject": "{sender_label} shared {article} {doc_label} with you",
        "body": "{sender_label} shared {article} {doc_label} with you via {app_name}.\n\nThis link expires in {expires}.\n\n{link}",
        "button": "Open {doc_label}", "variables": ["sender_label", "article", "doc_label", "app_name", "expires", "link"], "required": ["link"]},
    "invoice_share": {
        "subject": "{business_name} shared {article} {doc_type} with you",
        "body": "{business_name} shared {article} {doc_type} with you via EnterprateAI.\n\n{link}\n\nYou received this email because a document was shared with you via EnterprateAI. If you were not expecting this, you can safely ignore this email.",
        "button": "Open {doc_type}", "variables": ["business_name", "article", "doc_type", "link"], "required": ["link"]},
    "quote_sent": {
        "subject": "Quotation received from {business_name}",
        "body": "Hi {customer_name},\n\n{business_name} has responded to your request for quotation.\n\nReference: {reference}\nTotal: {total}\nValid for: {valid_days} days\n\nPlease find the quotation PDF attached to this email.",
        "button": "", "variables": ["customer_name", "business_name", "reference", "total", "valid_days"], "required": []},
    "quote_question": {
        "subject": "Question about quotation {reference} from {customer_name}",
        "body": "{customer_name} has a question about quotation {reference} before deciding:\n\n{question}\n\n{link}\n\nReply to this email to answer {customer_name} directly. The quotation stays open until they accept or decline it.",
        "button": "Open the quotation", "variables": ["customer_name", "reference", "question", "business_name", "link"], "required": ["question", "link"]},
    "quote_customer_action": {
        "subject": "{customer_name} {outcome} quotation {reference}",
        "body": "{customer_name} {outcome} quotation {reference}. {detail}\n\n{link}",
        "button": "Open in Business Operations", "variables": ["customer_name", "outcome", "reference", "detail", "business_name", "link"], "required": ["link"]},
    "claim_code": {
        "subject": "Your {app_name} verification code",
        "body": "Your {app_name} verification code is\n\n{code}\n\nEnter it to confirm that you manage {business_name} on the EnterprateAI Marketplace. It works for 30 minutes.\n\nIf you didn't ask for this, you can ignore this email: nothing changes without the code.",
        "button": "", "variables": ["app_name", "business_name", "code"], "required": ["code"]},
    "claim_invitation": {
        "subject": "{headline}",
        "body": "{message}\n\n{link}\n\nNot interested? Stop these emails: {opt_out}",
        "button": "Claim {business_name}", "variables": ["headline", "message", "business_name", "waiting", "link", "opt_out"], "required": ["link", "opt_out"]},
    "claim_decision": {
        "subject": "{headline}",
        "body": "{message}\n\n{reason}\n\n{waiting}\n\n{next_step}\n\n{link}",
        "button": "{action}", "variables": ["headline", "message", "business_name", "reason", "waiting", "next_step", "action", "link"], "required": ["link"]},
    "marketplace_team_invite": {
        "subject": "Your {app_name} Marketplace team invitation",
        "body": "You've been invited to help review business profiles and claims on the EnterprateAI Marketplace.\n\nOpen the secure link to verify your email and access Marketplace Claims. It expires in 48 hours.\n\n{link}\n\nSent to {email}. If you weren't expecting this, ignore this email.",
        "button": "Verify email and open Claims", "variables": ["app_name", "email", "link"], "required": ["link"]},
    "demo_request": {
        "subject": "[EnterprateAI] Demo request from {name} ({company})",
        "body": "New demo request\n\nName: {name}\nEmail: {email}\nCompany: {company}\nPhone: {phone}\nRole or interest: {role}\nMessage: {message}",
        "button": "", "variables": ["name", "email", "company", "phone", "role", "message"], "required": []},
}

# The ones with no single wording to edit here, and where their words come from instead.
WRITTEN_ELSEWHERE: dict[str, str] = {
    "activation": "activation",      # its own area: Activation emails
    "agent_document": "each_time",   # the owner approves the exact words of each one
    "manual": "each_time",           # written here, in Send an email
    "other": "none",
}

_PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")
_CACHE: dict[str, tuple[float, dict | None]] = {}
_TTL = 30.0


def label(kind: str) -> str:
    return (KINDS.get(kind) or KINDS["other"])["label"]


def problems(kind: str, subject: str, body: str, button: str) -> dict[str, str]:
    """What is wrong with an edited wording, field by field. Nothing is saved while anything is."""
    t = TEMPLATES.get(kind)
    if not t:
        return {"kind": "This email's wording is set in the product and can't be edited here."}
    out: dict[str, str] = {}
    allowed = set(t["variables"])
    for field, text in (("subject", subject), ("body", body), ("button", button)):
        unknown = sorted(set(_PLACEHOLDER.findall(text or "")) - allowed)
        if unknown:
            out[field] = f"Unknown detail: {', '.join('{' + u + '}' for u in unknown)}. You can use {', '.join('{' + v + '}' for v in t['variables'])}."
    if len((subject or "").strip()) < 3:
        out["subject"] = "Write a subject."
    if "{link}" in (subject or ""):
        out.setdefault("subject", "The link goes in the body, as the button.")
    for need in t["required"]:
        if "{" + need + "}" not in (body or ""):
            out["body"] = f"Keep {{{need}}} on a line of its own: without it the email is useless."
    if "link" in t["required"] and len((button or "").strip()) < 2:
        out["button"] = "Write the button's label."
    return out


def _fill(text: str, values: dict[str, Any]) -> str:
    return _PLACEHOLDER.sub(lambda m: str(values.get(m.group(1), "")), text or "")


def render(kind: str, setting: dict, values: dict[str, Any], *, footer_html: str, footer_text: str) -> tuple[str, str, str]:
    """subject, text, html for an edited email."""
    t = TEMPLATES[kind]
    subject = " ".join(_fill(setting.get("subject") or t["subject"], values).split())
    body = setting.get("body") or t["body"]
    button = _fill(setting.get("button_label") or t["button"], values)
    text_lines, html_parts = [], []
    for para in re.split(r"\n\s*\n", body.strip()):
        stripped = para.strip()
        if stripped == "{link}":
            text_lines.append(f"{button}:\n{values.get('link', '')}")
            html_parts.append(f"<p style=\"text-align:center;margin:28px 0;\"><a href=\"{escape(str(values.get('link', '')), quote=True)}\" "
                              "style=\"background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;display:inline-block;\">"
                              f"{escape(button)}</a></p>")
            continue
        if stripped == "{code}":
            text_lines.append(f"Your code: {values.get('code', '')}")
            html_parts.append("<div style=\"text-align:center;margin:28px 0;\"><span style=\"display:inline-block;padding:16px 32px;border-radius:12px;background:#f1f5f9;"
                              f"font-size:32px;font-weight:800;letter-spacing:8px;color:#0f172a;\">{escape(str(values.get('code', '')))}</span></div>")
            continue
        filled = _fill(para, values).strip()
        if not filled:
            continue
        text_lines.append(filled)
        html_parts.append("<p style=\"margin:0 0 14px;\">" + "<br/>".join(escape(line) for line in filled.split("\n")) + "</p>")
    text = "\n\n".join(text_lines) + footer_text
    html = ("<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:520px;margin:0 auto;padding:24px 16px;\">"
            + "".join(html_parts) + footer_html + "</div>")
    return subject, text, html


async def setting(kind: str) -> dict | None:
    """The superadmin's choices for this kind (switched off, edited wording), or None. Cached briefly; never raises."""
    hit = _CACHE.get(kind)
    if hit and time.monotonic() - hit[0] < _TTL:
        return hit[1]
    try:
        from app.core.supabase import sb_select
        row = await sb_select("email_settings", filters=[("kind", "eq", kind)], single=True)
    except Exception:      # noqa: BLE001 - not set up yet, or unreachable: the email goes out as written in the product
        row = None
    _CACHE[kind] = (time.monotonic(), row or None)
    return row or None


def forget(kind: str | None = None) -> None:
    if kind:
        _CACHE.pop(kind, None)
    else:
        _CACHE.clear()


async def log(*, kind: str, to: str | list[str], subject: str, status: str, error: str | None = None, message_id: str | None = None,
              sent_by: str | None = None) -> None:
    """One row per email, whatever happened to it. A failure to log never affects the email."""
    try:
        from app.core.supabase import sb_insert
        await sb_insert("email_log", {"kind": kind if kind in KINDS else "other", "to_email": ", ".join(to) if isinstance(to, list) else str(to),
                                      "subject": (subject or "")[:500], "status": status, "error": (error or None) and str(error)[:500],
                                      "provider_message_id": message_id, "sent_by": sent_by})
    except Exception:      # noqa: BLE001
        logger.info("Email log not written (kind=%s status=%s)", kind, status, exc_info=True)


_EVENT = {"email.delivered": "delivered", "email.delivery_delayed": "delayed", "email.opened": "opened", "email.clicked": "clicked",
          "email.bounced": "bounced", "email.complained": "complained"}


async def record_event(*, event_id: str, type_: str, message_id: str | None, at: str, data: dict | None = None) -> bool:
    """What Resend reports after an email was sent, kept on that email's row in the log. The same event twice counts
    once. Returns whether anything changed. Never raises: the webhook's other work goes on regardless."""
    kind = _EVENT.get(type_)
    if not kind or not message_id:
        return False
    try:
        from app.core.supabase import sb_select, sb_update
        row = await sb_select("email_log", filters=[("provider_message_id", "eq", message_id)], single=True)
        if not row:
            return False
        events = list(row.get("events") or [])
        if any(e.get("id") == event_id for e in events if isinstance(e, dict)):
            return False
        data = data or {}
        change: dict[str, Any] = {"events": [*events, {"id": event_id, "type": kind, "at": at}][-100:]}
        if kind == "delivered":
            change["delivered_at"] = row.get("delivered_at") or at
        elif kind == "delayed":
            change["delayed_at"] = at
        elif kind == "opened":
            change.update({"opened_at": row.get("opened_at") or at, "last_opened_at": at, "open_count": int(row.get("open_count") or 0) + 1})
        elif kind == "clicked":
            link = ((data.get("click") or {}).get("link") or "")[:1000] or None
            change.update({"clicked_at": row.get("clicked_at") or at, "last_clicked_at": at, "click_count": int(row.get("click_count") or 0) + 1,
                           **({"last_clicked_link": link} if link else {})})
        elif kind == "bounced":
            change.update({"bounced_at": at, "bounce_reason": ((data.get("bounce") or {}).get("message") or "")[:500] or None})
        elif kind == "complained":
            change["complained_at"] = at
        await sb_update("email_log", filters=[("id", "eq", row["id"])], payload=change)
        return True
    except Exception:      # noqa: BLE001 - not set up yet (migrations 047 and 048), or unreachable
        logger.info("Email event not recorded (%s %s)", type_, message_id, exc_info=True)
        return False


# ── Opting out ──────────────────────────────────────────────────────────────────────────────────
# Optional emails carry an unsubscribe link (and the one-click header mail apps show as a button). Activation tips and
# claim invitations have their own unsubscribe already; an opt-out from "all" stops them too. Essential emails never stop.
OPT_OUT_LINKED = {"workspace_invitation", "proposal_invite", "quote_question", "quote_customer_action", "claim_decision", "marketplace_team_invite", "manual"}
OPT_OUT_HONOURED = OPT_OUT_LINKED | {"activation", "claim_invitation"}


def _secret() -> bytes:
    from app.core.config import get_settings
    return str(get_settings().jwt_secret_key or "dev-email-secret").encode()


def optout_token(email: str, kind: str) -> str:
    import base64
    import hashlib
    import hmac
    raw = f"{email.strip().lower()}|{kind}".encode()
    sig = hmac.new(_secret(), b"optout:" + raw, hashlib.sha256).hexdigest()[:32]
    return base64.urlsafe_b64encode(raw).decode().rstrip("=") + "." + sig


def read_optout_token(token: str) -> tuple[str, str] | None:
    import base64
    import hashlib
    import hmac
    try:
        body, sig = (token or "").split(".", 1)
        raw = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
        email, kind = raw.decode().split("|", 1)
    except Exception:      # noqa: BLE001
        return None
    expected = hmac.new(_secret(), b"optout:" + raw, hashlib.sha256).hexdigest()[:32]
    return (email, kind) if hmac.compare_digest(expected, sig) and kind in OPT_OUT_LINKED else None


def optout_links(email: str, kind: str) -> tuple[str, str | None]:
    """The page link for the email's footer, and the one-click address for the mail app's own button (when the API's
    public address is known)."""
    from app.core.config import get_settings
    s = get_settings()
    token = optout_token(email, kind)
    page = (str(s.frontend_url or "").split(",")[0].strip().rstrip("/") or "http://localhost:5173") + f"/email/opt-out?t={token}"
    api = str(s.activation_api_base_url or "").strip().rstrip("/")
    return page, (f"{api}/email/opt-out?t={token}&one_click=1" if api else None)


async def opted_out(email: str, kind: str) -> bool:
    if kind not in OPT_OUT_HONOURED or not email:
        return False
    try:
        from app.core.supabase import sb_select
        rows = await sb_select("email_optouts", filters=[("email", "eq", email.strip().lower()), ("kind", "in", [kind, "all"])]) or []
        return bool(rows)
    except Exception:      # noqa: BLE001 - not set up yet: nothing has been opted out of
        return False


async def opt_out(email: str, kind: str, source: str) -> None:
    from app.core.supabase import sb_upsert
    await sb_upsert("email_optouts", payload={"email": email.strip().lower(), "kind": kind, "source": source}, on_conflict="email,kind")


async def opt_in(email: str, kind: str | None = None) -> None:
    """Undo: one kind, or every opt-out this address has."""
    from app.core.supabase import sb_delete
    filters = [("email", "eq", email.strip().lower())] + ([("kind", "eq", kind)] if kind else [])
    await sb_delete("email_optouts", filters=filters)
