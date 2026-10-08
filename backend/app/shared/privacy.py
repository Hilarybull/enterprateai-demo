"""Server-side protection for customer contact details (PRD-AO-001: protections must
not depend on how the model is prompted).

Two deterministic checks, used by the Agent and the Business Assistant:
  * a request to list or export contact details in bulk is refused before any model
    is called, however it is worded or wrapped in instructions;
  * an answer that would still contain several people's emails or phone numbers has
    them removed before it leaves the server.
Looking up one customer's details stays possible.
"""
from __future__ import annotations

import re

_CONTACT = re.compile(r"\b(e-?mails?|e-?mail address(es)?|phones?|phone numbers?|mobiles?|mobile numbers?|telephone\w*|"
                      r"contact (details|info\w*|list|data)|contacts|addresses)\b", re.I)
_PEOPLE = re.compile(r"\b(customers?|customer's|customers'|clients?|client's|clients'|contacts?|leads?|buyers?|vendors?|"
                     r"suppliers?|people|users?|everyone|everybody|database|crm)\b", re.I)
_BULK = re.compile(r"\b(all|every|each|everyone|everybody|full|entire|whole|complete|bulk|list|lists|listing|export\w*|"
                   r"dump|download\w*|extract\w*|csv|spreadsheet|excel|copy of)\b", re.I)

MAX_CONTACTS_PER_ANSWER = 2

REFUSAL = ("I can't list or export customers' contact details in bulk. You can look up one customer's details "
           "in Catalogue > Customers, where access is controlled.")
REDACTION_NOTE = ("Contact details for several people can't be shared in one answer, so they've been hidden. "
                  "Open Catalogue > Customers to see an individual customer's details.")

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
# Phone numbers: start with + or 0 and contain 10-15 digits (so dates and amounts don't match).
_PHONE = re.compile(r"(?<![\w£$€])(?:\+\d|0\d)[\d\s().-]{7,}\d")


def is_bulk_contact_request(text: str | None) -> bool:
    body = text or ""
    return bool(_CONTACT.search(body) and _PEOPLE.search(body) and _BULK.search(body))


def _phones(text: str) -> list[str]:
    return [m.group(0) for m in _PHONE.finditer(text) if 10 <= sum(c.isdigit() for c in m.group(0)) <= 15]


def redact_bulk_contacts(text: str, limit: int = MAX_CONTACTS_PER_ANSWER) -> tuple[str, bool]:
    """(text, redacted). Hides every email and phone number when more than `limit` distinct
    ones appear, so one customer's details can be shared but a list cannot."""
    emails = {e.lower() for e in _EMAIL.findall(text or "")}
    phones = {re.sub(r"\D", "", p) for p in _phones(text or "")}
    if len(emails) + len(phones) <= limit:
        return text, False
    out = _EMAIL.sub("[email hidden]", text)
    for p in sorted(set(_phones(out)), key=len, reverse=True):
        out = out.replace(p, "[phone hidden]")
    return f"{out.rstrip()}\n\n{REDACTION_NOTE}", True
