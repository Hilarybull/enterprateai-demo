"""A person's own name: read from what they write about themselves, checked, and kept tidy.

Only what someone says of themselves counts ("I'm Munah", "my name is Munah Okoro", "this is
Munah from Apex", "call me Hilary"). A customer, recipient or company in a request is never the
user: in "invoice for Mark", Mark is the customer.
"""
from __future__ import annotations

import re

MAX_NAME = 40
# The wording of the marketing choice, by version, so a stored consent says what was agreed to.
CONSENT_VERSION = "2026-10-08"
CONSENT_TEXT = "Send me tips, product updates and the EnterprateAI newsletter. Unsubscribe any time."

_WORD = r"[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'’-]*"
_NAME = rf"({_WORD}(?:\s+{_WORD}){{0,3}})"
# Said of oneself. Each ends where the name ends: at punctuation, "from", "and", or the end.
_SELF = [
    re.compile(rf"\b(?:my name is|my name's|i am called|you can call me|call me)\s+{_NAME}", re.I),
    re.compile(rf"\b(?:i'm|i’m|im|i am)\s+{_NAME}", re.I),
    re.compile(rf"\b(?:this is|it's|it is)\s+{_NAME}(?=\s+(?:from|at|of|here)\b|\s*[,.;:!]|\s*$)", re.I),
]
# Words that follow "I'm" or "I am" and are not names.
_NOT_A_NAME = {
    "a", "an", "the", "not", "so", "very", "just", "also", "still", "now", "here", "there", "in", "on", "at", "from", "with", "for", "to", "of",
    "looking", "trying", "going", "planning", "hoping", "thinking", "working", "running", "starting", "building", "selling", "launching", "raising",
    "interested", "new", "ready", "sure", "sorry", "happy", "glad", "keen", "based", "currently", "about", "after", "wanting", "needing", "struggling",
    "invoice", "quote", "quotation", "receipt", "proposal", "contract", "owner", "founder", "director", "self", "self-employed", "freelance", "freelancer",
}
_STOP = re.compile(r"\s+(?:from|at|of|and|but|who|here|invoice|i\b).*$", re.I)


def clean_name(value: object) -> dict | None:
    """`{"first_name", "full_name"}` in title case, or None when it isn't a name: 1 to 40 characters,
    letters, spaces, hyphens and apostrophes only (so no web address, email or number)."""
    text = re.sub(r"\s+", " ", str(value or "").replace("’", "'")).strip(" .,;:!")
    if not text or len(text) > MAX_NAME or not re.fullmatch(r"[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ' -]*", text):
        return None
    parts = [p for p in text.split(" ") if p]
    if not parts or parts[0].lower() in _NOT_A_NAME:
        return None
    tidy = lambda w: "-".join(seg[:1].upper() + seg[1:].lower() if seg.islower() or seg.isupper() else seg for seg in w.split("-"))      # noqa: E731
    full = " ".join(tidy(p) for p in parts)
    return {"first_name": full.split(" ")[0], "full_name": full}


def own_name(text: str | None) -> tuple[dict | None, str]:
    """The name someone gives for themselves in a message, and the message with that part taken out
    (so the rest can be read as the request it is). `(None, text)` when they don't say."""
    original = str(text or "")
    for pattern in _SELF:
        m = pattern.search(original)
        if not m:
            continue
        said = _STOP.sub("", m.group(1)).strip()
        words = said.split()
        while words and words[-1].lower() in _NOT_A_NAME:
            words.pop()
        name = clean_name(" ".join(words[:3])) if words else None
        if not name:
            continue
        start = m.start()
        end = m.start(1) + len(" ".join(words[:3]))
        tail = re.match(r"\s+(?:from|at|of)\s+[^,.;:!]+", original[end:], re.I)      # "from Apex Consulting" belongs to the introduction
        if tail:
            end += tail.end()
        rest = (original[:start] + original[end:]).strip()
        rest = re.sub(r"^[\s,.;:!-]+|(?<=^)\s*(?:and|so|hi|hello|hey)\b[\s,]*", "", rest, flags=re.I).strip()
        rest = re.sub(r"^(?:hi|hello|hey)[\s,!.]*", "", rest, flags=re.I).strip(" ,.;:")
        return name, rest
    return None, original


def call_me(text: str | None) -> dict | None:
    """The name in a message that is only that: "call me Hilary", "my name is Hilary Bull"."""
    said = re.fullmatch(r"\s*(?:please\s+)?(?:call me|my name is|my name's|you can call me)\s+(.+?)\s*[.!]?\s*", str(text or ""), re.I)
    return clean_name(said.group(1)) if said else None
