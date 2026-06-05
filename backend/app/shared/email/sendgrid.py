from __future__ import annotations

from dataclasses import dataclass
from html import escape

import httpx

from app.core.config import get_settings


SENDGRID_MAIL_SEND_URL = "https://api.sendgrid.com/v3/mail/send"


@dataclass
class EmailDeliveryResult:
    sent: bool
    error: str | None = None


def _email_ready() -> tuple[bool, str | None]:
    settings = get_settings(refresh=True)
    if not settings.sendgrid_api_key:
        return False, "SENDGRID_API_KEY is not configured."
    if not settings.sendgrid_from_email:
        return False, "SENDGRID_FROM_EMAIL is not configured."
    return True, None


_FOOTER_HTML = (
    "<div style=\"margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;"
    "font-size:11px;color:#94a3b8;line-height:1.5;\">"
    "You received this email because an action was requested for your EnterprateAI account.<br/>"
    "EnterprateAI &mdash; Business AI Platform<br/>"
    "If you did not request this, you can safely ignore this email."
    "</div>"
)

_FOOTER_TEXT = (
    "\n\n---\n"
    "You received this email because an action was requested for your EnterprateAI account.\n"
    "EnterprateAI — Business AI Platform\n"
    "If you did not request this, you can safely ignore this email."
)


async def send_email_via_sendgrid(
    *,
    to_email: str,
    subject: str,
    text_content: str,
    html_content: str,
) -> EmailDeliveryResult:
    ready, reason = _email_ready()
    if not ready:
        return EmailDeliveryResult(sent=False, error=reason)

    settings = get_settings(refresh=True)
    from_email = settings.sendgrid_from_email
    payload = {
        "personalizations": [{"to": [{"email": to_email}]}],
        "from": {
            "email": from_email,
            "name": settings.app_name,
        },
        "reply_to": {
            "email": from_email,
            "name": settings.app_name,
        },
        "subject": subject,
        "content": [
            {"type": "text/plain", "value": text_content},
            {"type": "text/html", "value": html_content},
        ],
        "tracking_settings": {
            "click_tracking": {"enable": False},
            "open_tracking": {"enable": False},
        },
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                SENDGRID_MAIL_SEND_URL,
                headers={
                    "Authorization": f"Bearer {settings.sendgrid_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.HTTPError as exc:
        return EmailDeliveryResult(sent=False, error=f"SendGrid request failed: {exc}")

    if response.status_code == 202:
        return EmailDeliveryResult(sent=True)

    error_message = response.text
    try:
        data = response.json()
        errors = data.get("errors")
        if isinstance(errors, list) and errors:
            messages = [str(item.get("message") or "").strip() for item in errors if isinstance(item, dict)]
            error_message = "; ".join(msg for msg in messages if msg) or error_message
    except Exception:
        pass

    return EmailDeliveryResult(
        sent=False,
        error=f"SendGrid rejected the email ({response.status_code}): {error_message}",
    )


async def send_workspace_invitation_email_with_link(
    *,
    to_email: str,
    inviter_email: str,
    invite_url: str,
    expires_in_days: int,
    permission_type: str,
) -> EmailDeliveryResult:
    app_name = get_settings().app_name
    access_label = "module access" if permission_type == "module" else "feature-based access"
    subject = f"You've been invited to join a workspace on {app_name}"
    text_content = (
        f"{inviter_email} has invited you to join their workspace on {app_name}.\n\n"
        f"Access level: {access_label}\n"
        f"This invitation expires in {expires_in_days} day{'s' if expires_in_days != 1 else ''}.\n\n"
        f"Accept invitation:\n{invite_url}"
        + _FOOTER_TEXT
    )
    html_content = (
        "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;"
        "line-height:1.6;color:#0f172a;max-width:520px;margin:0 auto;padding:24px 16px;\">"
        f"<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700;color:#0f172a;\">Workspace invitation</h2>"
        f"<p style=\"margin:0 0 12px;\"><strong>{escape(inviter_email)}</strong> has invited you to join their "
        f"workspace on <strong>{escape(app_name)}</strong>.</p>"
        f"<p style=\"margin:0 0 20px;color:#475569;\">Access level: {escape(access_label)}<br/>"
        f"This invitation expires in {expires_in_days} day{'s' if expires_in_days != 1 else ''}.</p>"
        f"<p><a href=\"{escape(invite_url)}\" "
        "style=\"display:inline-block;padding:12px 24px;border-radius:8px;background:#2563eb;"
        "color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;\">"
        "Accept invitation</a></p>"
        f"<p style=\"margin-top:16px;font-size:13px;color:#64748b;\">If the button doesn't work, "
        f"copy and paste this link into your browser:<br/>"
        f"<a href=\"{escape(invite_url)}\" style=\"color:#2563eb;word-break:break-all;\">{escape(invite_url)}</a></p>"
        + _FOOTER_HTML
        + "</div>"
    )
    return await send_email_via_sendgrid(
        to_email=to_email,
        subject=subject,
        text_content=text_content,
        html_content=html_content,
    )


async def send_password_reset_email(
    *,
    to_email: str,
    reset_url: str,
    expires_in_minutes: int = 60,
) -> EmailDeliveryResult:
    app_name = get_settings().app_name
    subject = f"Your {app_name} password link"
    text_content = (
        f"Hi,\n\n"
        f"We received a request to set a new password for your {app_name} account.\n\n"
        f"Use the link below to continue. It expires in {expires_in_minutes} minutes.\n\n"
        f"{reset_url}"
        + _FOOTER_TEXT
    )
    html_content = (
        "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;"
        "line-height:1.6;color:#0f172a;max-width:520px;margin:0 auto;padding:24px 16px;\">"
        f"<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700;color:#0f172a;\">Set a new password</h2>"
        f"<p style=\"margin:0 0 12px;\">We received a request to set a new password for your "
        f"<strong>{escape(app_name)}</strong> account ({escape(to_email)}).</p>"
        f"<p style=\"margin:0 0 20px;color:#475569;\">This link expires in <strong>{expires_in_minutes} minutes</strong>.</p>"
        f"<p><a href=\"{escape(reset_url)}\" "
        "style=\"display:inline-block;padding:12px 24px;border-radius:8px;background:#2563eb;"
        "color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;\">"
        "Set new password</a></p>"
        f"<p style=\"margin-top:16px;font-size:13px;color:#64748b;\">If the button doesn't work, "
        f"copy and paste this link into your browser:<br/>"
        f"<a href=\"{escape(reset_url)}\" style=\"color:#2563eb;word-break:break-all;\">{escape(reset_url)}</a></p>"
        + _FOOTER_HTML
        + "</div>"
    )
    return await send_email_via_sendgrid(
        to_email=to_email,
        subject=subject,
        text_content=text_content,
        html_content=html_content,
    )


async def send_document_share_email(
    *,
    to_email: str,
    sender_email: str,
    share_url: str,
    document_title: str,
    company_name: str,
    expires_in_days: int,
) -> EmailDeliveryResult:
    app_name = get_settings().app_name
    sender_label = company_name or app_name
    subject = f"{escape(sender_label)} shared a document with you"
    text_content = (
        f"{sender_label} shared \"{document_title}\" with you via {app_name}.\n\n"
        f"This secure link expires in {expires_in_days} day{'s' if expires_in_days != 1 else ''}.\n\n"
        f"Open document:\n{share_url}"
        + _FOOTER_TEXT
    )
    html_content = (
        "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;"
        "line-height:1.6;color:#0f172a;max-width:520px;margin:0 auto;padding:24px 16px;\">"
        f"<h2 style=\"margin:0 0 16px;font-size:18px;font-weight:700;color:#0f172a;\">Document shared with you</h2>"
        f"<p style=\"margin:0 0 12px;\"><strong>{escape(sender_label)}</strong> shared "
        f"<strong>{escape(document_title)}</strong> with you via {escape(app_name)}.</p>"
        f"<p style=\"margin:0 0 20px;color:#475569;\">This link expires in "
        f"{expires_in_days} day{'s' if expires_in_days != 1 else ''}.</p>"
        f"<p><a href=\"{escape(share_url)}\" "
        "style=\"display:inline-block;padding:12px 24px;border-radius:8px;background:#2563eb;"
        "color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;\">"
        "Open document</a></p>"
        f"<p style=\"margin-top:16px;font-size:13px;color:#64748b;\">If the button doesn't work, "
        f"copy and paste this link into your browser:<br/>"
        f"<a href=\"{escape(share_url)}\" style=\"color:#2563eb;word-break:break-all;\">{escape(share_url)}</a></p>"
        + _FOOTER_HTML
        + "</div>"
    )
    return await send_email_via_sendgrid(
        to_email=to_email,
        subject=subject,
        text_content=text_content,
        html_content=html_content,
    )
