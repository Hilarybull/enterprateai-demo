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
    payload = {
        "personalizations": [{"to": [{"email": to_email}]}],
        "from": {
            "email": settings.sendgrid_from_email,
            "name": settings.app_name,
        },
        "subject": subject,
        "content": [
            {"type": "text/plain", "value": text_content},
            {"type": "text/html", "value": html_content},
        ],
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
    access_label = "module access" if permission_type == "module" else "feature-based access"
    subject = f"{get_settings().app_name}: workspace invitation"
    text_content = (
        f"{inviter_email} invited you to join a workspace on {get_settings().app_name}.\n\n"
        f"Access: {access_label}\n"
        f"Expires in: {expires_in_days} day(s)\n\n"
        f"Open invitation:\n{invite_url}\n"
    )
    html_content = (
        "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;\">"
        f"<p><strong>{escape(inviter_email)}</strong> invited you to join a workspace on "
        f"<strong>{escape(get_settings().app_name)}</strong>.</p>"
        f"<p>Access: {escape(access_label)}<br/>"
        f"Expires in: {expires_in_days} day{'s' if expires_in_days != 1 else ''}</p>"
        f"<p><a href=\"{escape(invite_url)}\" "
        "style=\"display:inline-block;padding:10px 16px;border-radius:10px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;\">"
        "Accept invitation</a></p>"
        f"<p>If the button does not work, use this link:<br/><a href=\"{escape(invite_url)}\">{escape(invite_url)}</a></p>"
        "</div>"
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
    sender_label = company_name or get_settings().app_name
    subject = f"{get_settings().app_name}: {document_title}"
    text_content = (
        f"{sender_label} shared \"{document_title}\" with you.\n\n"
        f"This secure link expires in {expires_in_days} day(s).\n\n"
        f"Open document:\n{share_url}\n"
    )
    html_content = (
        "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;\">"
        f"<p><strong>{escape(sender_label)}</strong> shared <strong>{escape(document_title)}</strong> with you.</p>"
        f"<p>This secure link expires in {expires_in_days} day{'s' if expires_in_days != 1 else ''}.</p>"
        f"<p><a href=\"{escape(share_url)}\" "
        "style=\"display:inline-block;padding:10px 16px;border-radius:10px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;\">"
        "Open shared document</a></p>"
        f"<p>If the button does not work, use this link:<br/><a href=\"{escape(share_url)}\">{escape(share_url)}</a></p>"
        "</div>"
    )
    return await send_email_via_sendgrid(
        to_email=to_email,
        subject=subject,
        text_content=text_content,
        html_content=html_content,
    )
