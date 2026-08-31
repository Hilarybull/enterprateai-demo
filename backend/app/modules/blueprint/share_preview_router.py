from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from html import escape

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from app.core.config import get_settings
from app.core.supabase import sb_select
from app.shared.utils.doc_labels import doc_label as _doc_label

logger = logging.getLogger(__name__)

share_preview_router = APIRouter(tags=["share-preview"])


@share_preview_router.get("/share/{token}", include_in_schema=False)
async def share_preview(token: str) -> HTMLResponse:
    """
    Returns an HTML page with dynamic OG meta tags for social link previews
    (WhatsApp, Slack, etc.), then JS-redirects the browser to the frontend SPA.
    """
    settings = get_settings()
    frontend_url = settings.frontend_url.rstrip("/")
    # token is token_urlsafe (base64url: [A-Za-z0-9_-]) — no HTML-escaping needed in the path
    spa_url = f"{frontend_url}/share/{token}"

    og_title = "Shared Document"
    og_description = "A document has been shared with you via EnterprateAI."
    workspace = ""

    try:
        share = await sb_select(
            "blueprint_document_shares",
            filters=[("token", "eq", token), ("revoked", "eq", False)],
            columns="user_id,document_id,expires_at",
            single=True,
        )
        if share:
            # Skip building preview for expired shares — just redirect
            expires_at = share.get("expires_at")
            if expires_at:
                try:
                    if datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")) <= datetime.now(timezone.utc):
                        share = None
                except Exception:
                    pass

        if share:
            doc = await sb_select(
                "blueprint_documents",
                filters=[
                    ("id", "eq", share["document_id"]),
                    ("user_id", "eq", share["user_id"]),
                ],
                columns="title,type,company_name",
                single=True,
            )
            if doc:
                doc_title = str(doc.get("title") or "").strip()
                doc_type = _doc_label(doc.get("type"))
                workspace = str(doc.get("company_name") or "").strip()

                if doc_title:
                    og_title = f"{doc_type}: {doc_title}"
                    if workspace:
                        og_description = f"{workspace} shared {doc_type.lower()} '{doc_title}' with you."
                    else:
                        og_description = f"A {doc_type.lower()} has been shared with you via EnterprateAI."
    except Exception:
        logger.exception("share_preview: failed to fetch share metadata for token=%s", token)

    site_name = workspace or "EnterprateAI"
    # HTML-escape values for use in HTML attributes
    h_title = escape(og_title)
    h_description = escape(og_description)
    h_url = escape(spa_url)
    h_site_name = escape(site_name)
    # JSON-encode for use as a JavaScript string literal (safe for all characters)
    js_url = json.dumps(spa_url)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="refresh" content="0; url={h_url}"/>
<title>{h_title}</title>
<meta property="og:title" content="{h_title}"/>
<meta property="og:description" content="{h_description}"/>
<meta property="og:url" content="{h_url}"/>
<meta property="og:type" content="article"/>
<meta property="og:site_name" content="{h_site_name}"/>
<meta name="twitter:card" content="summary"/>
<meta name="twitter:title" content="{h_title}"/>
<meta name="twitter:description" content="{h_description}"/>
<link rel="canonical" href="{h_url}"/>
</head>
<body>
<script>window.location.replace({js_url});</script>
<p>Redirecting… <a href="{h_url}">Click here if not redirected</a></p>
</body>
</html>"""

    return HTMLResponse(content=html, status_code=200)
