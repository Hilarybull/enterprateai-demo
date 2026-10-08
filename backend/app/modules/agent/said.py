"""What the owner already said, read from their own sentence and put into whatever form the Agent
is about to show, so only what is missing is asked.

One reader for every document and task (and the same rules for names and amounts that the
homepage goal launcher uses): who it is for, money and its currency, quantities and unit prices,
dates and terms, document numbers, VAT, discount, how something was paid. Fixed rules, no model:
it costs nothing and it never makes a value up. Anything it fills is shown back under "From what
you said" for the owner to confirm or change; nothing read here is ever acted on without that.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any

from app.modules.agent.goals import _is_name

CURRENCY_OF = {"£": "GBP", "$": "USD", "€": "EUR", "₦": "NGN", "gbp": "GBP", "usd": "USD", "eur": "EUR", "ngn": "NGN", "pound": "GBP", "pounds": "GBP",
               "quid": "GBP", "dollar": "USD", "dollars": "USD", "euro": "EUR", "euros": "EUR", "naira": "NGN"}
SIGN_OF = {"GBP": "£", "USD": "$", "EUR": "€", "NGN": "₦"}
_SCALE = {"k": 1_000, "thousand": 1_000, "m": 1_000_000, "million": 1_000_000}
_NUM = r"\d[\d,]*(?:\.\d+)?"
_MONEY = re.compile(
    rf"(?:(?P<sym>[£$€₦])|\b(?P<code>gbp|usd|eur|ngn)\s?)\s?(?P<a>{_NUM})\s?(?P<as>k|m|thousand|million)?\b"
    rf"|\b(?P<b>{_NUM})\s?(?P<bs>k|m|thousand|million)?\s?(?P<word>pounds?|quid|gbp|dollars?|usd|euros?|eur|naira|ngn)\b"
    rf"|\b(?P<c>{_NUM})\s?(?P<cs>k|m)\b", re.I)
_EACH = re.compile(r"^\s*(?:each|apiece|per\s+(?:unit|item|piece|\w+)|a\s+(?:unit|piece)|/\s?(?:unit|item|each|\w+)|a\s+(?:month|week|day|hour|year)|(?:p\.?m\.?|pcm)\b)", re.I)
_REF = re.compile(r"\b(INV|QUO|QUOTE|REC|RCP|CON|PRO|PO|CN)-[A-Za-z0-9][\w-]*", re.I)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]*\w")
_PHONE = re.compile(r"(?<![\w-])\+?\d[\d ()-]{8,}\d(?![\w-])")
_MONTHS = {m: i + 1 for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"))}
_DAYS = {d: i for i, d in enumerate(("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"))}
_DATE = (r"(?:today|tomorrow|yesterday|(?:next\s+)?(?:mon|tues|wednes|thurs|fri|satur|sun)day"
         r"|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?[A-Za-z]{3,9}(?:\s+\d{4})?|[A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{1,2}/\d{1,2}(?:/\d{2,4})?)")
_PERIOD = {"day": 1, "week": 7, "fortnight": 14, "month": 30, "year": 365}
_METHODS = (("Bank transfer", r"bank\s*transfer|bacs|faster\s+payments?|wire|transfer"), ("Card", r"(?:credit\s+|debit\s+)?card|stripe"), ("Cash", r"cash"),
            ("Cheque", r"che(?:que|ck)"), ("Direct debit", r"direct\s+debit"), ("PayPal", r"paypal"))
# Words that begin a request and are never part of a name or a piece of work.
_LEAD = re.compile(r"^\s*(?:please\s+|can you\s+|could you\s+|i\s+(?:want|need|would like|'d like)\s+(?:to\s+)?|let'?s\s+|help me\s+(?:to\s+)?)*"
                   r"(?:create|make|prepare|draft|write|send|issue|raise|record|log|add|generate|get|do|give me|new)?\s*(?:me\s+)?(?:an?|the|my)?\s*", re.I)
_DOC = (r"invoices?|quotations?|quotes?|estimates?|proposals?|contracts?|service agreements?|agreements?|purchase orders?|pos?|credit notes?|refunds?|receipts?"
        r"|reminders?|payment reminders?|bills?|expenses?|remind|chase|nudge")
# Words that describe a document ("a business proposal") and are never part of a name.
_KIND = r"business|sales|formal|quick|short|simple|detailed|new|final|draft|proper|professional|tax|vat|pro[- ]?forma|commercial|project|service|client"
# Ways of pointing at a record instead of naming someone: "my latest marketplace RFQ", "the last enquiry", "that request".
_POINTS_AT = re.compile(r"\b(?:rfqs?|requests?(?:\s+for\s+(?:a\s+)?quot\w+)?|enquir(?:y|ies)|inquir(?:y|ies)|marketplace|latest|newest|most recent|last one|previous)\b", re.I)
# Stand-ins for a name that name nobody.
_NOBODY = re.compile(r"(?:(?:a|an|the|my|our|some|one of my|this|that)\s+)?(?:someone|somebody|anyone|customers?|clients?|suppliers?|vendors?|them|him|her|me|us|it|people|person)", re.I)
_WHEN = re.compile(r"(?:last|this|next|the past|the last)\s+(?:few\s+)?(?:day|week|month|quarter|year)s?|today|yesterday|tomorrow|recently|earlier", re.I)
# Someone described rather than named: "a client", "my customer in Leeds", "the company I worked for".
_DESCRIBED = re.compile(r"(?:a|an|the|my|our|some|one of my|this|that)\s+(?:\w+\s+){0,2}?(?:clients?|customers?|compan(?:y|ies)|business(?:es)?|firms?|persons?|people|friends?|suppliers?|vendors?|contacts?|guys?|man|woman|lady)\b", re.I)
_STOP = r"(?:,|;|\bfor\b|\babout\b|\bregarding\b|\bat\b|\bdue\b|\bvalid\b|\bby\b|\bpaid\b|\bfrom\b|\bstarting\b|\bon\b|\bwith\b|\bplus\b|\bno vat\b|\bpolitely\b|\bfirmly\b|$)"


def _number(text: str, scale: str | None) -> float:
    return float(text.replace(",", "")) * _SCALE.get((scale or "").lower(), 1)


def parse_date(text: str, today: date) -> date | None:
    """A date as people write one: "today", "Friday", "30 Nov", "1 Dec 2026", "2026-11-30". None when it isn't one."""
    t = (text or "").strip().lower().rstrip(".,")
    if t in ("today", "tomorrow", "yesterday"):
        return today + timedelta(days={"today": 0, "tomorrow": 1, "yesterday": -1}[t])
    t = re.sub(r"^next\s+", "", t)
    if t in _DAYS:
        return today + timedelta(days=(_DAYS[t] - today.weekday() - 1) % 7 + 1)      # the next one, never today
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", t)
    try:
        if m:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        m = re.match(r"^(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?$", t)
        if m:      # day first, as written in the UK
            year = int(m.group(3)) + (2000 if m.group(3) and len(m.group(3)) == 2 else 0) if m.group(3) else today.year
            return _soon(date(year, int(m.group(2)), int(m.group(1))), today, bool(m.group(3)))
        m = re.match(r"^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3})[a-z]*(?:\s+(\d{4}))?$", t) or None
        day, month, year = (m.group(1), m.group(2), m.group(3)) if m else (None, None, None)
        if not m:
            m = re.match(r"^([a-z]{3})[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$", t)
            day, month, year = (m.group(2), m.group(1), m.group(3)) if m else (None, None, None)
        if m and month in _MONTHS:
            return _soon(date(int(year) if year else today.year, _MONTHS[month], int(day)), today, bool(year))
    except ValueError:
        return None
    return None


def _soon(d: date, today: date, year_given: bool) -> date:
    """A day and month with no year means the next time that date comes round."""
    if year_given or d >= today - timedelta(days=45):
        return d
    return d.replace(year=d.year + 1)


def _span(period: str, n: float) -> int:
    return int(round(n * _PERIOD[period.lower().rstrip("s")]))


def _count(word: str) -> float:
    return 1.0 if word.lower() in ("a", "an", "one") else float(word)


def read(text: str, today: date) -> dict[str, Any]:
    """Everything stated in the sentence. Keys are present only when the sentence says so."""
    original = (text or "").strip()
    out: dict[str, Any] = {}
    if not original:
        return out
    rest = original      # what is left once each stated thing has been taken out

    def take(m: re.Match | None, repl: str = " , ") -> None:
        nonlocal rest
        if m:
            rest = rest.replace(m.group(0), repl, 1)

    m = _EMAIL.search(rest)
    if m:
        out["email"] = m.group(0)
        take(m)
    refs = [r.group(0).upper() for r in _REF.finditer(rest)]
    if refs:
        out["refs"] = refs

    # VAT and discount, before amounts are read (so "£50 discount" is not taken for the price).
    m = re.search(r"\b(?:no|without|zero|0%)\s+vat\b|\bvat[- ]?(?:free|exempt)\b", rest, re.I)
    if m:
        out["vat"] = 0.0
        take(m)
    else:
        m = re.search(rf"\b({_NUM})\s?%\s?vat\b|\bvat\s+(?:at\s+|of\s+)?({_NUM})\s?%", rest, re.I)
        if m:
            out["vat"] = float(m.group(1) or m.group(2))
            take(m)
        else:
            m = re.search(r"(?:\bplus\b|\+|\bincluding\b|\binc\.?\b|\bwith\b)\s*vat\b", rest, re.I)
            if m:
                out["vat_default"] = True      # VAT applies, at the business's own rate: no rate was said, so none is made up
                take(m)
    m = re.search(rf"\b({_NUM})\s?%\s*(?:off|discount)\b|\b(?:discount|less)\s+(?:of\s+)?({_NUM})\s?%", rest, re.I)
    if m:
        out["discount"] = {"type": "percent", "value": float(m.group(1) or m.group(2))}
        take(m)
    else:
        m = re.search(rf"[£$€₦]\s?({_NUM})\s*(?:off|discount)\b|\bdiscount\s+(?:of\s+)?[£$€₦]\s?({_NUM})", rest, re.I)
        if m:
            out["discount"] = {"type": "amount", "value": float((m.group(1) or m.group(2)).replace(",", ""))}
            take(m)

    # Dates and terms.
    m = re.search(r"\bdue\s+(?:in\s+|within\s+)?(\d+)\s+(day|week|month)s?\b|\bnet\s?(\d+)\b|\b(\d+)\s+days?\s+(?:terms|to pay)\b", rest, re.I)
    if m:
        days = _span(m.group(2), float(m.group(1))) if m.group(1) else int(m.group(3) or m.group(4))
        out["terms_days"], out["due"] = days, today + timedelta(days=days)
        take(m)
    else:
        m = re.search(rf"\bdue\s+(?:on\s+|by\s+)?({_DATE})", rest, re.I)
        if m and parse_date(m.group(1), today):
            out["due"] = parse_date(m.group(1), today)
            take(m)
    m = re.search(r"\bvalid\s+(?:for\s+)?(\d+|a|an|one)\s+(day|week|fortnight|month)s?\b", rest, re.I)
    if m:
        out["valid"] = today + timedelta(days=_span(m.group(2), _count(m.group(1))))
        take(m)
    else:
        m = re.search(rf"\bvalid\s+(?:until|till|to|through)\s+({_DATE})", rest, re.I)
        if m and parse_date(m.group(1), today):
            out["valid"] = parse_date(m.group(1), today)
            take(m)
    m = re.search(rf"\b(?:deliver(?:y|ed)?|needed|required)\s+(?:by|on|for)\s+({_DATE})", rest, re.I)
    if m and parse_date(m.group(1), today):
        out["delivery"] = parse_date(m.group(1), today)
        take(m)
    m = re.search(rf"\b(?:paid|received|settled)\s+(?:on\s+)?({_DATE})|\b({_DATE})\s*,?\s*(?=by\s+(?:bank|card|cash|che))", rest, re.I)
    paid_word = re.search(r"\b(paid|received|settled|payment)\b", rest, re.I)
    if m and parse_date(m.group(1) or m.group(2), today):
        out["paid_on"] = parse_date(m.group(1) or m.group(2), today)
        rest = rest.replace(m.group(1) or m.group(2), " ", 1)
    elif paid_word:
        m = re.search(r"\b(today|yesterday)\b", rest, re.I)
        if m:
            out["paid_on"] = parse_date(m.group(1), today)
            take(m, " ")
    m = re.search(rf"\b(?:(\d+)\s+(week|month|year)s?\s+)?(?:from|start(?:ing|s)?(?:\s+(?:on|from))?|commenc\w+(?:\s+on)?|beginning)\s+({_DATE})", rest, re.I)
    if m and parse_date(m.group(3), today):
        out["start"] = parse_date(m.group(3), today)
        if m.group(1):
            out["duration"] = f"{m.group(1)} {m.group(2).lower()}{'s' if m.group(1) != '1' else ''}"
        take(m)
    m = re.search(rf"\bby\s+({_DATE})", rest, re.I)
    if m and parse_date(m.group(1), today):
        out["by"] = parse_date(m.group(1), today)      # a due date for an invoice, a delivery date for an order: the form decides
        take(m)
    for label, pattern in _METHODS:
        m = re.search(rf"\b(?:by|via|in|with|through)\s+({pattern})\b", rest, re.I) or (re.search(rf"\b({pattern})\b", rest, re.I) if paid_word else None)
        if m:
            out["method"] = label
            take(m)
            break
    m = re.search(r"\b(politely|polite|friendly|gently|gentle|firmly|firm)\b(?:\s+(?:reminder|notice|tone))?|\b(final|last)\s+(?:reminder|notice|warning)\b", rest, re.I)
    if m:
        out["tone"] = "final" if m.group(2) else "firm" if m.group(1).lower().startswith("firm") else "friendly"
        take(m, " ")

    # Money: every amount with the currency it was written in.
    money = []
    for m in _MONEY.finditer(rest):
        raw, scale = (m.group("a"), m.group("as")) if m.group("a") else (m.group("b"), m.group("bs")) if m.group("b") else (m.group("c"), m.group("cs"))
        token = m.group("sym") or m.group("code") or m.group("word")
        before = rest[max(0, m.start() - 12):m.start()].lower()
        money.append({"value": _number(raw, scale), "currency": CURRENCY_OF.get((token or "").lower().rstrip("s"), CURRENCY_OF.get((token or "").lower())),
                      "each": bool(_EACH.match(rest[m.end():])) or bool(re.search(r"\b(?:at|@)\s*$", before)), "span": m.group(0),
                      "period": (re.match(r"^\s*(?:/|per\s+|a\s+)\s?(month|week|day|hour|year)", rest[m.end():], re.I) or [None, None])[1]})
    if money:
        out["money"] = [{k: v for k, v in x.items() if k != "span"} for x in money]
        out["amount"] = money[0]["value"]
        named = [x["currency"] for x in money if x["currency"]]
        if named:
            out["currency"] = named[0]
        for x in money:
            rest = re.sub(r"(?:\b(?:at|@|for|of|costing|worth|totall?ing|priced at)\s*)?" + re.escape(x["span"]) + r"(?:\s*(?:each|apiece|/\s?\w+|per\s+\w+|a\s+(?:month|week|day|hour|year|unit|piece)))?", " , ", rest, count=1, flags=re.I)
    # A length of time on its own ("12 months", "4 weeks"): a contract's term, a proposal's timeline.
    if "duration" not in out:
        m = re.search(r"(?:^|,)\s*(?:for\s+|over\s+|in\s+)?(\d+)\s+(week|month|year)s?\s*(?=,|$)", rest, re.I)
        if m:
            out["duration"] = f"{m.group(1)} {m.group(2).lower()}{'s' if m.group(1) != '1' else ''}"
            take(m)
    m = _PHONE.search(rest)
    if m and not _REF.search(m.group(0)):
        out["phone"] = re.sub(r"\s+", " ", m.group(0)).strip()
        take(m)

    # Who it is for, and what for.
    body = _LEAD.sub("", re.sub(r"\s+", " ", rest), count=1)
    # "a business proposal", "a formal quotation", "a quick invoice": the word before the document's name describes it; it is nobody's name.
    body = re.sub(rf"^(?:(?:{_KIND})\s+){{1,2}}(?=(?:{_DOC})\b)", "", body, count=1, flags=re.I)
    clauses = [c.strip(" .;:") for c in re.split(r"\s*,\s*", body) if c.strip(" .;:")]
    # "paid" on its own has done its job (the date and method were read above): it is not a name or a piece of work.
    clauses = clauses[:1] + [c for c in (re.sub(r"^(?:and\s+)?(?:was\s+|been\s+)?(?:paid|received|settled)\b\s*", "", c, flags=re.I).strip() for c in clauses[1:]) if c]
    head = clauses[0] if clauses else ""
    party = work = None
    m = re.match(rf"^(?P<name>.+?)\s+(?:has\s+|have\s+|just\s+)?paid\b", head, re.I)
    if m and _is_name(m.group("name")) and not re.match(rf"^(?:{_DOC})\b", m.group("name"), re.I):
        party = m.group("name")
    add = re.match(r"^(?:new\s+)?(customer|client|vendor|supplier|service|product|item)\s+(?:called\s+|named\s+)?(?P<name>.+)$", head, re.I)
    if add:
        kind = add.group(1).lower()
        out["record"] = "item" if kind in ("service", "product", "item") else "vendor" if kind in ("vendor", "supplier") else "customer"
        out["item_type"] = "service" if kind == "service" else "product" if kind == "product" else None
        if out["record"] == "item":
            out["item_name"] = add.group("name").strip()
        else:
            party = add.group("name").strip()
    if not party and not add:
        m = re.match(rf"^(?:(?:{_DOC})(?:\s+|$))?(?:(?P<doc2>{_DOC})(?:\s+|$))?(?P<tail>.*)$", head, re.I)
        tail = (m.group("tail") if m else head).strip()
        # "…from BT for broadband": the supplier follows "from".
        frm = re.search(rf"\bfrom\s+(?P<name>.+?)\s*(?:\bfor\b\s*(?P<work>.+))?$", tail, re.I)
        to = re.match(rf"^(?:for|to|with|on)\s+(?P<name>.+?)\s*(?:(?:\bfor\b|\babout\b|\bregarding\b|\bcovering\b|:)\s*(?P<work>.+))?$", tail, re.I)
        bare = re.match(rf"^(?P<name>(?!for\b|to\b|with\b|on\b|a\b|an\b|the\b|my\b|about\b).+?)\s*(?:(?:\bfor\b|\babout\b|\bregarding\b|:)\s*(?P<work>.+))?$", tail, re.I)
        about = re.match(r"^about\s+(?P<work>.+)$", tail, re.I)
        hit = frm or to or bare
        # "quote a customer for a new kitchen": nobody is named, but what it is for is said.
        described = None if hit else re.match(r"^(?P<who>.+?)\s+(?:for|about|regarding)\s+(?P<work>.+)$", tail, re.I)
        if described and _DESCRIBED.match(described.group("who")):
            work = described.group("work")
        elif about:
            work = about.group("work")
        elif hit:
            name, said_work = hit.group("name").strip(), (hit.group("work") or "").strip()
            if _POINTS_AT.search(name) or re.fullmatch(rf"(?:(?:{_KIND})\s+)*(?:{_DOC})", name, re.I):
                name = ""      # "my latest marketplace RFQ", "the last enquiry", "a business proposal": a record or a kind of document, not a customer
            if _NOBODY.fullmatch(name) or _DESCRIBED.match(name) or re.search(r"\b(?:that|who|whom|which|where)\b|\bi\b", name, re.I):
                name = ""      # "invoice someone", "a customer", "a client that I consulted for": nobody was named, so the name is asked for
            if _REF.fullmatch(name) or not name:
                work = said_work or None
            elif said_work or _is_name(name):
                party, work = name, said_work or None
            else:
                work = name      # "invoice for consulting": the work, with nobody named
    if party and not _REF.search(party):
        out["party"] = re.sub(r"\s+", " ", party).strip(" .,:;-")
    extra = [c for c in clauses[1:] if c and not re.fullmatch(r"(?:and|plus|also)?", c, re.I)]
    if not work and extra and not _REF.fullmatch(extra[0]):
        # The next thing said after the name: the work ("Mark, website redesign"), or the reason on a credit note.
        work = extra.pop(0)
    if work:
        work = re.sub(r"^(?:(?:for|about|regarding|in|on)\s+)+", "", work.strip(" .,:;-"), flags=re.I)
        if work and not _REF.fullmatch(work) and not _WHEN.fullmatch(work):      # "last month" says when, not what
            out["work"] = work
    if extra:
        out["note"] = ", ".join(extra)
    if out.get("work"):
        out["items"] = _lines(out["work"], money)
    elif money and (party or add is None):
        # An amount with nothing said about what it is for: one line at that amount, the description left for the owner.
        out["items"] = [{"name": "", "quantity": 1, "unit_price": money[0]["value"]}]
    if out.get("item_name") is None:
        out.pop("item_name", None)
    if out.get("item_type") is None:
        out.pop("item_type", None)
    return out


def _lines(work: str, money: list[dict]) -> list[dict]:
    """The work as lines: "10 chairs" is 10 of them; an amount "at £50" or "each" is the unit price, else the total."""
    lines = []
    parts = [p.strip() for p in re.split(r"\s+(?:and|plus|\+|&)\s+", work) if p.strip()] or [work]
    for i, part in enumerate(parts):
        qty, name = 1.0, part
        m = re.match(r"^(\d+(?:\.\d+)?)\s*(?:x|×)?\s+(?P<unit>(?:months?|weeks?|days?|hours?|years?)\s+(?:of\s+)?)?(?P<name>.+)$", part, re.I) \
            or re.match(r"^(?P<name>.+?)\s*(?:x|×)\s*(\d+(?:\.\d+)?)$", part, re.I)
        if m:
            number = m.group(1) if m.re.pattern.startswith("^(\\d") else m.group(2)
            qty, name = float(number), m.group("name").strip()
        price: Any = ""
        if i < len(money):
            x = money[i]
            price = x["value"] if (x["each"] or qty == 1) else round(x["value"] / qty, 2)      # a total over several: what each comes to
        lines.append({"name": name, "quantity": int(qty) if float(qty).is_integer() else qty, "unit_price": price})
    return lines


# ── into the form ────────────────────────────────────────────────────────────

def _same(a: str, b: str) -> bool:
    """The same name, however it was typed: case, "Ltd" and punctuation don't make it someone else."""
    strip = lambda s: re.sub(r"\b(ltd|limited|llp|llc|inc|plc|co|company)\b\.?", "", re.sub(r"[^a-z0-9 ]", " ", s.lower()))      # noqa: E731
    x, y = strip(a).split(), strip(b).split()
    if not x or not y:
        return False
    return x == y or (len(x) <= len(y) and y[:len(x)] == x) or (len(y) < len(x) and x[:len(y)] == y)


def _equal(a: Any, b: Any) -> bool:
    try:
        return abs(float(a) - float(b)) < 0.005
    except (TypeError, ValueError):
        return str(a).strip().lower() == str(b).strip().lower()


def _option(options: list[dict], name: str | None, refs: list[str]) -> dict | None:
    for ref in refs:
        hit = next((o for o in options if ref.lower() in str(o.get("label") or "").lower()), None)
        if hit:
            return hit
    if name:
        exact = [o for o in options if _same(name, str(o.get("label") or "").split(" · ")[0])]
        if len(exact) == 1:
            return exact[0]
        loose = [o for o in options if re.search(rf"\b{re.escape(name.lower())}\b", str(o.get("label") or "").lower())]
        if len(loose) == 1:
            return loose[0]
    return None


def money_text(value: float, currency: str) -> str:
    return f"{SIGN_OF.get(currency, currency + ' ')}{value:,.2f}"


def _day(d: date) -> str:
    return d.strftime("%d %b %Y").lstrip("0")


def apply(fields: list[dict], text: str, today: date, *, default_currency: str = "GBP", answered: dict | None = None,
          default_vat: float | None = None, extras: tuple[str, ...] = ()) -> list[dict]:
    """The form, with what the owner already said filled in. A field filled here carries `said`
    (so the page can show it for a yes instead of asking) and `said_text` (how to show it).
    A field the owner has already answered, or that already has a value from the records, is left alone."""
    told = read(text, today)
    if not told or not fields:
        return fields
    answered = answered or {}
    currency = told.get("currency") or default_currency
    out = [dict(f) for f in fields]
    by_key = {f["key"]: f for f in out}
    refs = told.get("refs") or []
    empty = lambda f: f.get("default") in (None, "") and f["key"] not in answered      # noqa: E731

    def fill(f: dict, value: Any, shown: str | None) -> None:
        f.update({"default": value, "said": True, "said_text": shown})

    def note(f: dict | None, value: Any, shown: str) -> None:
        """The task already filled this from the message itself: say so, the same way."""
        if f and not f.get("said") and f["key"] not in answered and f.get("default") not in (None, "") and _equal(f.get("default"), value):
            f.update({"said": True, "said_text": shown})

    party = told.get("party")
    for key, name_key, email_key in (("customer_id", "customer_name", "customer_email"), ("vendor_id", "vendor_name", "vendor_email"), ("customer", None, None)):
        f = by_key.get(key)
        if f and f.get("options") is not None and (empty(f) or f.get("default") == "new") and (party or refs):
            hit = _option(f["options"], party, refs if key != "vendor_id" else [])
            if hit:
                fill(f, hit["value"], str(hit["label"]))
            elif party and f.get("type") == "customer":
                # Nobody on record by that name: "+ New", with the name filled in. Only their contact details are still to ask.
                fill(f, "new", f"{party} (new)")
                if name_key and name_key in by_key and key not in answered and name_key not in answered:
                    fill(by_key[name_key], party, None)
    for name_key in ("customer_name", "vendor_name"):
        f = by_key.get(name_key)
        picker = by_key.get(name_key.replace("_name", "_id"))
        if f and party and empty(f) and not f.get("said") and not (picker and picker.get("said")):
            fill(f, party, party if picker is None else f"{party} (new)")
        if party:
            note(f, party, party)
    f = by_key.get("name")
    if f and empty(f) and (told.get("item_name") or party):
        fill(f, told.get("item_name") or party, told.get("item_name") or party)
    if told.get("item_name") or party:
        note(f, told.get("item_name") or party, told.get("item_name") or party)
    for key in ("customer_email", "vendor_email", "email"):
        f = by_key.get(key)
        if f and told.get("email") and empty(f):
            fill(f, told["email"], told["email"])
        if told.get("email"):
            note(f, told["email"], told["email"])
    f = by_key.get("phone_number")
    if f and told.get("phone") and empty(f):
        fill(f, told["phone"], told["phone"])

    for key in ("invoice_id", "start_from", "record", "quote_id"):
        f = by_key.get(key)
        if f and f.get("options") and (empty(f) or f.get("default") == "new") and (refs or party):
            hit = _option([o for o in f["options"] if o.get("value") != "new"], party, refs)
            if hit:
                fill(f, hit["value"], str(hit["label"]))
        elif f and f.get("options") and not f.get("said") and key not in answered and (refs or party):
            hit = _option([o for o in f["options"] if o.get("value") == f.get("default")], party, refs)
            if hit:
                f.update({"said": True, "said_text": str(hit["label"])})

    f = by_key.get("items")
    if f and "items" not in answered and told.get("items"):
        suggested = [dict(s) for s in f.get("suggested") or []]
        if not suggested:
            # Not in the catalogue: an "Other item" line as written. A price or description that wasn't said is left for the owner.
            suggested = [{"product_id": None, "name": line["name"], "quantity": line["quantity"], "unit_price": line["unit_price"]} for line in told["items"]]
        else:
            for s, line in zip(suggested, told["items"]):
                if s.get("unit_price") in (None, "", 0) and line["unit_price"] != "":
                    s["unit_price"] = line["unit_price"]
                if not s.get("product_id") and not str(s.get("name") or "").strip() and line["name"]:
                    s["name"] = line["name"]
        f["suggested"] = suggested
        if all(str(s.get("name") or s.get("product_id") or "").strip() and s.get("unit_price") not in (None, "") for s in suggested):
            f.update({"said": True, "said_text": "; ".join(
                f"{s['quantity']} × {s.get('name') or 'item'} at {money_text(float(s['unit_price']), currency)}" for s in suggested)})
        else:
            # Part of a line was said (the amount, or what it is for): listed with the rest, and the line is still shown for what is missing.
            known = [" ".join(x for x in (f"{s['quantity']} ×" if s.get("quantity") not in (None, "", 1) else "", str(s.get("name") or "").strip(),
                                          money_text(float(s["unit_price"]), currency) if s.get("unit_price") not in (None, "") else "") if x) for s in suggested]
            if any(known):
                priced_only = all(not str(s.get("name") or "").strip() for s in suggested)
                f.update({"said_note": "; ".join(k for k in known if k), "said_label": "Amount" if priced_only else f.get("label") or "Items"})
    amount = told.get("amount")
    for key in ("amount", "total", "price", "base_price"):
        f = by_key.get(key)
        if f and amount is not None and empty(f) and f.get("type") == "number":
            fill(f, amount, money_text(amount, currency))
            break
        if f and amount is not None and f.get("type") == "number" and f.get("default") not in (None, ""):
            note(f, amount, money_text(amount, currency))
            break
    for key, value in (("due_date", told.get("due") or (told.get("by") if "delivery_date" not in by_key else None)), ("valid_until", told.get("valid")),
                       ("delivery_date", told.get("delivery") or told.get("by")), ("start_date", told.get("start")),
                       ("paid_at", told.get("paid_on")), ("date", told.get("paid_on"))):
        f = by_key.get(key)
        if f and value and key not in answered:
            fill(f, value.isoformat(), _day(value))
    for key in ("term", "timeline"):
        f = by_key.get(key)
        if f and told.get("duration") and empty(f):
            fill(f, told["duration"], told["duration"])
    f = by_key.get("vat_rate")
    vat = told.get("vat") if "vat" in told else (default_vat if told.get("vat_default") else None)
    if f and vat is not None and "vat_rate" not in answered:
        fill(f, vat, "No VAT" if not vat else f"{vat:g}% VAT")
    f = by_key.get("discount")
    if f and told.get("discount") and "discount" not in answered:
        d = told["discount"]
        fill(f, d, f"{d['value']:g}% off" if d["type"] == "percent" else f"{money_text(d['value'], currency)} off")
    f = by_key.get("method")
    if f and told.get("method") and "method" not in answered and any(o.get("value") == told["method"] for o in f.get("options") or []):
        fill(f, told["method"], told["method"])
    if told.get("method"):
        note(f, told["method"], told["method"])
    f = by_key.get("paid")
    if f and told.get("paid_on") and empty(f) and any(o.get("value") == "yes" for o in f.get("options") or []):
        fill(f, "yes", "Paid")
    work = told.get("work")
    for key in ("solution", "description", "reason"):
        f = by_key.get(key)
        if f and work and empty(f) and "items" not in by_key:
            fill(f, work[:1].upper() + work[1:] if key != "reason" else work, work)
            break
        if f and work and "items" not in by_key and f.get("default") not in (None, ""):
            note(f, f.get("default") if str(f.get("default")).strip().lower() == work.strip().lower() else work, work)
            break
    f = by_key.get("tone")
    if f and told.get("tone") and empty(f) and any(o.get("value") == told["tone"] for o in f.get("options") or []):
        fill(f, told["tone"], told["tone"].capitalize())

    # Said, and the task takes it in its answers, but this form had no place for it: it is given one.
    if "items" in by_key:
        if told.get("valid") and "valid_until" not in by_key and "valid_until" not in answered and extras and "valid_until" in extras:
            out.append({"key": "valid_until", "label": "Valid until", "type": "date", "default": told["valid"].isoformat(), "said": True, "said_text": _day(told["valid"])})
        if told.get("discount") and "discount" not in by_key and "discount" not in answered and extras and "discount" in extras:
            d = told["discount"]
            out.append({"key": "discount", "label": "Discount", "type": "discount", "default": d, "said": True,
                        "said_text": f"{d['value']:g}% off" if d["type"] == "percent" else f"{money_text(d['value'], currency)} off"})
    # A currency other than the business's own is kept, and said: never dropped, never converted.
    takes_money = any(k in by_key for k in ("items", "amount", "total", "price", "base_price"))
    if told.get("currency") and told["currency"] != default_currency and takes_money and "currency" not in by_key and "currency" not in answered:
        out.append({"key": "currency", "label": "Currency", "type": "choice", "required": True, "default": told["currency"], "toggle": True, "said_note": told["currency"],
                    "hint": f"In {told['currency']} (your default is {default_currency}).",
                    "options": [{"value": told["currency"], "label": f"{told['currency']} (as you wrote it)"}, {"value": default_currency, "label": f"{default_currency} (your default)"}]})
    return out


_AFTER = r"\s*(?:[:,-]|\bof\b|\bfor\b|\babout\b|\bis\b|\bthat\b|\bcalled\b)?\s*(?P<idea>.+)$"
_IDEA = re.compile(r"\b(?:validate|test|check|assess|evaluate|size|plan)\b[^:.]*?\b(?:idea|concept)\b" + _AFTER, re.I)
_IDEA_LOOSE = re.compile(r"\b(?:validate|test|check|assess|evaluate|size|plan)\b[^:.]*?\b(?:business|startup|market)\b" + _AFTER, re.I)


def idea_in(text: str | None) -> str:
    """The business idea named in a message ("Validate my idea: a mobile car wash in Abuja" gives
    "Mobile car wash in Abuja"), or "" when the message names none ("validate my idea")."""
    said = re.sub(r"\s+", " ", str(text or "")).strip()
    m = _IDEA.search(said) or _IDEA_LOOSE.search(said)
    if not m:
        return ""
    idea = re.sub(r"^(?:an?|the|my|our|this)\s+", "", m.group("idea").strip(" .,:;-\"'"), flags=re.I).strip()
    if len(idea.split()) < 2 or len(idea) < 8 or re.fullmatch(r"(?:please|for me|now|today|again|properly)\W*", idea, re.I):
        return ""
    return idea[:1].upper() + idea[1:300]

