"""Addresses the server may fetch for a user or a search result: never its own network (SSRF)."""
from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit

_NAMES = {"localhost", "metadata.google.internal"}


def _private(ip: str) -> bool:
    try:
        a = ipaddress.ip_address(ip.split("%")[0])
    except ValueError:
        return True
    mapped = getattr(a, "ipv4_mapped", None)
    a = mapped or a
    return not a.is_global or a.is_multicast


async def blocked_url(url: str) -> bool:
    """True for anything but http(s) to a public address. A name that doesn't resolve isn't blocked: it can't connect anyway."""
    try:
        parts = urlsplit(str(url))
        host = (parts.hostname or "").strip().lower().rstrip(".")
    except ValueError:
        return True
    if parts.scheme not in ("http", "https") or not host or host in _NAMES or host.endswith((".local", ".internal", ".localhost")):
        return True
    try:
        ipaddress.ip_address(host)
        return _private(host)
    except ValueError:
        pass
    try:
        found = await asyncio.get_running_loop().getaddrinfo(host, parts.port or 443, type=socket.SOCK_STREAM)
    except OSError:
        return False
    return any(_private(f[4][0]) for f in found)
