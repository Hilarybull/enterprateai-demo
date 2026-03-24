from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit


def redact_uri(uri: str) -> str:
    """
    Redacts credentials in URIs for safe logging.
    """
    try:
        parts = urlsplit(uri)
        if not parts.netloc:
            return uri
        if "@" not in parts.netloc:
            return uri
        creds, host = parts.netloc.rsplit("@", 1)
        if ":" in creds:
            user, _pwd = creds.split(":", 1)
            safe_user = (user[:2] + "…") if user else "…"
            safe_netloc = f"{safe_user}:***@{host}"
        else:
            safe_netloc = f"***@{host}"
        return urlunsplit((parts.scheme, safe_netloc, parts.path, parts.query, parts.fragment))
    except Exception:
        return "<redacted>"

