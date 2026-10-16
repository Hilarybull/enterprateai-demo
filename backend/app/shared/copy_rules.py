"""The owner's copy rules for anything the owner reads (16 Oct): no em or en dashes."""
from __future__ import annotations

import re

_RANGE = re.compile(r"(\d)\s*[\u2013\u2014]\s*(\d)")
_DASH = re.compile(r"\s*[\u2013\u2014]\s*")


def no_dashes(text):
    """"15–20 interviews" reads "15 to 20 interviews"; a clause break becomes a comma. Anything else is left as it is."""
    if not isinstance(text, str) or ("\u2013" not in text and "\u2014" not in text):
        return text
    return _DASH.sub(", ", _RANGE.sub(r"\1 to \2", text))


_CREDIT_SIGN = re.compile(r"(?:[£$€₦]|NGN|GBP|USD|EUR)\s?(\d[\d,]*)(\s*credits?\b)", re.I)


def credits_plain(text):
    """Credits are never money: "₦60 credits" reads "60 credits" (the owner's rule, 16 Oct)."""
    if not isinstance(text, str):
        return text
    return _CREDIT_SIGN.sub(r"\1\2", text)


def owner_copy(text):
    """Every rule for what the owner reads: no dashes, credits without a currency sign."""
    return credits_plain(no_dashes(text))
