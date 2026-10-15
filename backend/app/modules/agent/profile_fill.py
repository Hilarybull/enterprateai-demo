"""The workspace profile, filled from what the owner says (the owner's QA, 15 Oct, P0.3 and P0.4): after onboarding and
after every Agent flow, an EMPTY profile field is filled from the flow's answers, with where it came from ("From your
funding chat, 15 Oct") and an Undo. A field the owner set is never changed: a different value is a conflict, asked once
("Your business profile says England, but you mentioned Abuja. Update your profile?"). Nothing is guessed: business
type, size, year, vision and mission are left for the owner."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

# The main city's state or region, when the city names it ("Abuja" is in the FCT).
CITY_STATE = {"abuja": "FCT", "lagos": "Lagos", "ikeja": "Lagos", "lekki": "Lagos", "port harcourt": "Rivers", "ibadan": "Oyo", "kano": "Kano",
              "kaduna": "Kaduna", "enugu": "Enugu", "accra": "Greater Accra", "kumasi": "Ashanti", "nairobi": "Nairobi", "mombasa": "Mombasa",
              "leeds": "West Yorkshire", "manchester": "Greater Manchester", "birmingham": "West Midlands", "liverpool": "Merseyside",
              "london": "Greater London", "bristol": "Bristol", "sheffield": "South Yorkshire", "glasgow": "Scotland", "edinburgh": "Scotland",
              "cardiff": "Wales", "belfast": "Northern Ireland"}
# The profile's own industry list; anything else is kept in the owner's words (shown as Other, with the detail).
INDUSTRY = (("finance", r"\b(bookkeep\w*|accounting|accountan\w*|tax|payroll|finance|financial|insurance)\b"),
            ("technology", r"\b(software|saas|app|apps|platform|it support|web ?site|tech)\b"),
            ("consulting", r"\b(consult\w*|advis\w*|coach\w*)\b"), ("ecommerce", r"\b(online (?:shop|store)|e-?commerce)\b"),
            ("retail", r"\b(shop|store|boutique|retail)\b"), ("logistics", r"\b(delivery|deliveries|courier|haulage|transport|logistics|removals?)\b"),
            ("marketing", r"\b(marketing|advertis\w*|social media|branding|agency)\b"), ("healthcare", r"\b(clinic|health|care home|pharmacy|dental|physio)\b"),
            ("education", r"\b(tutor\w*|school|training|courses?|lessons?)\b"), ("real_estate", r"\b(property|real estate|letting|estate agent)\b"),
            ("manufacturing", r"\b(manufactur\w*|factory|fabricat\w*)\b"))
_SUBSCRIPTION = re.compile(r"\b(subscription|subscribers?|monthly plan|membership|per month plan)\b", re.I)
_RETAINER = re.compile(r"\bretainer\b", re.I)
_PROJECT = re.compile(r"\bper project|project[- ]based\b", re.I)

SOURCE = {"need_funding": "your funding chat", "launch": "your launch chat", "test_idea": "your idea check", "price_offer": "your pricing check",
          "more_customers": "your customer check", "onboarding": "onboarding", "create_invoice": "your invoice", "create_quotation": "your quotation",
          "create_business_plan": "your business plan chat"}
LABEL = {"country": "country", "city": "city", "state_or_region": "state", "currency": "currency", "services": "service",
         "tagline": "tagline", "vision": "vision", "mission": "mission", "core_values": "core values", "delivery_model": "delivery model",
         "key_offering_focus": "key offering", "target_customer_type": "target customer", "operating_stage": "operating stage",
         "primary_revenue_model": "revenue model", "primary_industry": "industry", "about_company": "about the company"}


def _blank(v: Any) -> bool:
    return v in (None, "", [], {}) or (isinstance(v, list) and not any(
        (x.get("service_name") or x.get("name")) if isinstance(x, dict) else x for x in v))


def _words(v: Any) -> str:
    s = " ".join(str(v or "").split()).strip(" .,")
    return "" if s.lower() in ("unknown", "not sure", "unsure", "n/a", "none") else s


# The flows that describe the business (its place, offer, customers, stage). A document task (an invoice, a quotation, a
# receipt) names one customer, a person or a company: it never describes the business, so it only sets an empty currency.
BUSINESS_FLOWS = {"need_funding", "launch", "test_idea", "price_offer", "more_customers", "onboarding", "create_business_plan"}
_SEGMENT = re.compile(r"\b(people|teams?|owners?|families|family|businesses|firms|companies|workers|households|professionals|students|parents|"
                      r"customers|clients|smes|startups|shoppers|drivers|residents|commuters|retailers|landlords|tenants|patients|members|users|"
                      r"buyers|couples|homeowners|offices|schools|restaurants|shops|traders|freelancers|agencies|in\s+[A-Z][a-z]+)\b", re.I)


def is_segment(text: str) -> bool:
    """A description of who buys ("office workers in Abuja", "small UK service firms"), never one person's or company's name."""
    t = " ".join(str(text or "").split())
    return bool(t) and (len(t.split()) >= 2 or t.lower() in ("smes", "startups", "freelancers")) and bool(_SEGMENT.search(t))


def proposed(answers: dict, goal: str, currency: str | None = None) -> dict[str, Any]:
    """What a flow's answers say about the business, as profile fields (only what was said)."""
    from app.modules.agent import credibility
    a = answers or {}
    out: dict[str, Any] = {}
    if goal not in BUSINESS_FLOWS:
        return {"currency": currency} if currency else {}
    place = _words(a.get("where"))
    if place:
        country = credibility.country_of(place)
        city = place.split(",")[0].strip()
        if country and city.lower() != country:
            out["city"] = city[:1].upper() + city[1:]
            state = CITY_STATE.get(city.lower())
            if state:
                out["state_or_region"] = state
        if country:
            out["country"] = country.title() if country != "united kingdom" else "United Kingdom"
    if currency:
        out["currency"] = currency
    raw = _words(a.get("sell") or a.get("description") or a.get("offering"))
    offering = re.sub(r"^(?:a|an|the|my|our)\s+", "", raw, flags=re.I)
    if offering:
        out["key_offering_focus"] = offering[:1].upper() + offering[1:]
        out["services"] = [{"service_name": out["key_offering_focus"][:80], "description": out["key_offering_focus"]}]
        industry = next((k for k, pattern in INDUSTRY if re.search(pattern, offering, re.I)), None)
        plain = re.sub(r"\s+(?:subscription|service|services|business|company|startup)s?$", "", offering.lower()).strip()
        plain = re.sub(r"^(?:monthly|weekly|daily|premium|affordable|local|on-demand)\s+", "", plain).strip()
        # A list field holds a list value (the owner's QA, 15 Oct): the closest option, else "other" with the detail in
        # Key offering (set above). Never free text such as "car washing".
        out["primary_industry"] = industry or "other"
    customer = _words(a.get("customer"))
    if customer.lower() in ("anybody", "anyone", "everyone", "everybody", "all", "people", "customers", "any") or not is_segment(customer):
        customer = ""      # not a target customer (a name, or nobody in particular): left for the owner
    if customer:
        out["target_customer_type"] = customer[:1].upper() + customer[1:]
    stage = str(a.get("stage") or "").lower()
    revenue = bool(re.search(r"\d", str(a.get("traction") or ""))) or a.get("monthly_sales") not in (None, "", "unknown")
    out_stage = {"idea": "idea", "pre_revenue": "pre_revenue", "growing": "growing",
                 "trading": "early_revenue" if revenue or goal != "need_funding" else "early_revenue"}.get(stage)
    if out_stage:
        out["operating_stage"] = out_stage
    said = " ".join(str(a.get(k) or "") for k in ("sell", "description", "traction", "price", "offering", "use"))
    model = "subscription" if _SUBSCRIPTION.search(said) else "retainer" if _RETAINER.search(said) else "project_based" if _PROJECT.search(said) else None
    if model:
        out["primary_revenue_model"] = model
    if offering and (str(a.get("kind") or "").lower() == "service" or _HANDS_ON.search(offering)):
        out["delivery_model"] = "manual"      # Manual / service-led: done by hand, for the customer
    if offering:
        keep = len(customer) > 1 and customer[1:2].isupper()      # "SMEs", "HR teams": never "sMEs"
        who = f" for {customer if keep else customer[:1].lower() + customer[1:]}" if customer else ""
        town = out.get("city") or place
        where = f" in {town}" if town and town.lower() not in customer.lower() else ""
        lead = raw if len(raw) > 1 and raw[1:2].isupper() else raw[:1].lower() + raw[1:]
        if not re.match(r"^(?:a|an|the|our|my)\b", lead, re.I) and not lead.endswith("s"):
            lead = f"{'an' if lead[:1].lower() in 'aeiou' else 'a'} {lead}"
        out["about_company"] = tidy(f"We offer {lead}{who}{where}.")
    return out


_GRAMMAR = ((r"\b(people|customers|workers|owners|families|households|drivers|students|businesses)\s+that\s+(?:has|have)\b", r"\1 who have"),
            (r"\b(people|customers|workers|owners|families|households|drivers|students)\s+that\b", r"\1 who"),
            (r"\ba\s+(?=[aeiou])", "an "), (r"\ban\s+(?=[^aeiou\W])", "a "),
            (r"\b(\w+)\s+\1\b", r"\1"), (r"\s+([,.!?])", r"\1"), (r"\s{2,}", " "), (r"[–—]", ","))


def tidy(text: str) -> str:
    """The grammar and spelling pass every drafted field gets before it is saved: "people that has car" reads "people who
    have a car"-style agreement fixes, a/an, doubled words, spacing, a capital first letter and a full stop; no em or en
    dashes. Deterministic: the owner's own words are kept, only their grammar is tidied."""
    t = " ".join(str(text or "").split())
    t = re.sub(r"\bhas\s+car\b", "have a car", t, flags=re.I)
    for pattern, repl in _GRAMMAR:
        t = re.sub(pattern, repl, t, flags=re.I)
    t = t.strip(" ,")
    if t and not t.endswith((".", "!", "?")):
        t += "."
    return t[:1].upper() + t[1:] if t else t


def fill(data: dict, answers: dict, goal: str, *, currency: str | None = None, now: datetime | None = None) -> dict:
    """Fill the empty profile fields from a flow's answers. Returns {"filled": [fields], "conflicts": [{field, profile, said}]}.
    Each filled field's source is kept in data["profile_provenance"] (with the value before, for Undo)."""
    now = now or datetime.now(timezone.utc)
    p = data.setdefault("workspace_profile", {})
    prov = data.setdefault("profile_provenance", {})
    settings = data.setdefault("settings", {})
    source = f"From {SOURCE.get(goal, 'your chat')}, {now.day} {now.strftime('%b')}"
    filled, conflicts = [], []
    asked = {c.get("field"): c for c in data.get("profile_conflicts") or []}
    said = proposed(answers, goal, currency)
    if said.get("country") and not _blank(p.get("country")) and str(p["country"]).strip().lower() != said["country"].lower():
        # Another country than the profile's: the place is asked about as a whole, never half written (city without country).
        said.pop("city", None)
        said.pop("state_or_region", None)
    if not said.get("currency") and not said.get("country") and not _blank(p.get("country")) and _blank(settings.get("currency")) and _blank(p.get("currency")):
        said["country"] = None      # the country already on record names the currency (Nigeria: NGN)
        from app.modules.agent import credibility as _cr
        code = _cr.currency_of_country(p.get("country"))
        if code:
            said["currency"] = code
        said.pop("country", None)
    if not said.get("currency") and said.get("country") and _blank(settings.get("currency")) and _blank(p.get("currency")):
        # The country's own currency, when the business has none set yet ("Abuja" gives NGN).
        from app.modules.agent import credibility
        code = credibility.currency_of_country(said["country"])
        if code:
            said["currency"] = code
    for field, value in said.items():
        have = settings.get("currency") if field == "currency" else p.get(field)
        if field == "currency" and not have:
            have = p.get("currency")
        if (prov.get(field) or {}).get("by") == "owner" or field in (data.get("profile_undone") or {}):
            continue      # set (or cleared, or undone) by the owner by hand: theirs, never filled again
        if _blank(have):
            if field == "currency":
                settings["currency"] = value
            else:
                p[field] = value
            prov[field] = {"source": source, "at": now.isoformat(), "suggestion": field == "about_company", "value": value}
            filled.append(field)
        elif field in ("country", "city", "currency") and str(have).strip().lower() != str(value).strip().lower() and field not in asked:
            conflicts.append({"field": field, "profile": have, "said": value, "goal": goal, "source": source})
    if conflicts:
        data["profile_conflicts"] = list(data.get("profile_conflicts") or []) + conflicts
    if filled:
        had = (data.get("profile_filled") or {}).get("fields") or []
        data["profile_filled"] = {"fields": list(dict.fromkeys(had + filled)), "source": source, "at": now.isoformat()}
    return {"filled": filled, "conflicts": conflicts}


def told(filled: list[str], data: dict | None = None) -> str:
    """"I've added Abuja, Nigeria to your business profile." or "I added your country, city and target customer to your
    business profile." """
    p = (data or {}).get("workspace_profile") or {}
    if "currency" in filled and data is not None and len(filled) > 1:
        rest = told([f for f in filled if f != "currency"], data)
        code = str(((data.get("settings") or {}).get("currency")) or "")
        sign = {"GBP": "£", "USD": "$", "EUR": "€", "NGN": "₦", "GHS": "GH₵", "KES": "KSh", "ZAR": "R"}.get(code, "")
        return (rest + " " if rest else "") + f"Your business currency is now {code}" + (f" ({sign})." if sign else ".")
    if filled == ["currency"] and data is not None:
        code = str(((data.get("settings") or {}).get("currency")) or "")
        sign = {"GBP": "£", "USD": "$", "EUR": "€", "NGN": "₦", "GHS": "GH₵", "KES": "KSh", "ZAR": "R"}.get(code, "")
        return f"Your business currency is now {code}" + (f" ({sign})." if sign else ".")
    if data is not None and ("city" in filled or "country" in filled) and len([f for f in filled if f not in ("city", "country", "state_or_region", "currency")]) == 0:
        place = ", ".join(x for x in (p.get("city") if "city" in filled else "", p.get("country") if "country" in filled else "") if x)
        if place:
            return f"I've added {place} to your business profile."
    names = [LABEL.get(f, f) for f in filled if f != "about_company"] + (["a short description"] if "about_company" in filled else [])
    if not names:
        return ""
    listed = names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]
    return f"I added your {listed} to your business profile."


def keep(data: dict, field: str) -> bool:
    """[Keep] (or Keep all, with field "all"): the value accepted, its "From your … chat" hint gone; the panel shows only
    what is still to keep."""
    prov = data.get("profile_provenance") or {}
    fields = [f for f, v in prov.items() if not v.get("kept")] if field == "all" else [field]
    done = False
    for f in fields:
        if f in prov:
            prov[f]["kept"] = True
            done = True
    if field == "all" or not [f for f, v in prov.items() if not v.get("kept")]:
        data.pop("profile_filled", None)
    return done


def redo(data: dict, field: str) -> bool:
    """[Redo] on the "Removed" toast: the value put back, as it was."""
    stash = (data.get("profile_undone") or {}).pop(field, None)
    if not stash:
        return False
    if field == "currency":
        data.setdefault("settings", {})["currency"] = stash["value"]
    else:
        data.setdefault("workspace_profile", {})[field] = stash["value"]
    data.setdefault("profile_provenance", {})[field] = stash
    return True


def undo(data: dict, field: str) -> bool:
    """Undo one filled field: back to empty, its source removed. A field the owner has edited since is left alone."""
    prov = (data.get("profile_provenance") or {}).get(field)
    if not prov:
        return False
    p = data.setdefault("workspace_profile", {})
    now_value = (data.get("settings") or {}).get("currency") if field == "currency" else p.get(field)
    if now_value != prov.get("value"):
        return False
    data.setdefault("profile_undone", {})[field] = dict(prov)      # for Redo
    if field == "currency":
        data["settings"].pop("currency", None)
    else:
        p.pop(field, None)
    data["profile_provenance"].pop(field, None)
    return True


def country_question(data: dict) -> dict | None:
    """Asked once when the business has a currency but no country: "Which country is your business in?", with the
    currency's own country as the suggestion (GBP: United Kingdom)."""
    from app.modules.agent import credibility
    p = data.get("workspace_profile") or {}
    code = (data.get("settings") or {}).get("currency")
    if not _blank(p.get("country")) or not code or data.get("country_asked"):
        return None
    guess = credibility.country_of_currency(code)
    options = ([{"choice": f"set:{guess}", "label": guess}] if guess else []) + [{"choice": "other", "label": "Another country"}]
    return {"field": "country", "question": "Which country is your business in?", "options": options}


def resolve(data: dict, field: str, choice: str) -> bool:
    """A conflict answered: "update" writes what was said, "keep" or "task" leave the profile as it is (a value for one
    task stays on that task). Asked once either way."""
    if field == "country" and (choice.startswith("set:") or choice == "other"):
        data["country_asked"] = True      # asked once
        if choice.startswith("set:"):
            data.setdefault("workspace_profile", {})["country"] = choice[4:]
            data.setdefault("profile_provenance", {})["country"] = {"source": "You told the Agent", "at": datetime.now(timezone.utc).isoformat(), "value": choice[4:]}
        return True
    conflicts = data.get("profile_conflicts") or []
    hit = next((c for c in conflicts if c.get("field") == field and not c.get("resolved")), None)
    if not hit:
        return False
    if choice == "update":
        if field == "currency":
            data.setdefault("settings", {})["currency"] = hit["said"]
        else:
            data.setdefault("workspace_profile", {})[field] = hit["said"]
        data.setdefault("profile_provenance", {})[field] = {"source": hit.get("source"), "at": datetime.now(timezone.utc).isoformat(), "value": hit["said"]}
    hit["resolved"] = choice
    return True


def question(c: dict) -> str:
    """Asked once in the Agent: "Your business profile says England, but you mentioned Abuja. Update your profile?" """
    if c["field"] == "currency":
        return f"Your business is set to {c['profile']}, but you mentioned {c['said']}. Which currency should the business use?"
    return f"Your business profile says {c['profile']}, but you mentioned {c['said']}. Update your profile?"


def options(c: dict) -> list[dict]:
    if c["field"] == "currency":
        return [{"choice": "update", "label": f"Use {c['said']} for my whole business"}, {"choice": "task", "label": f"Keep {c['profile']} and convert this amount"}]
    return [{"choice": "update", "label": f"Update to {c['said']}"}, {"choice": "keep", "label": f"Keep {c['profile']}"},
            {"choice": "task", "label": "This was for one task only"}]


# ── AI-drafted brand fields (the owner's QA, 15 Oct): one call, only for empty fields, from the workspace's own data ──
BRAND_FIELDS = ("tagline", "vision", "mission", "core_values")
_HANDS_ON = re.compile(r"\b(wash\w*|clean\w*|repair\w*|install\w*|deliver\w*|courier|tutor\w*|coach\w*|care|salon|barber\w*|plumb\w*|garden\w*|"
                       r"catering|photograph\w*|tailor\w*|bak\w*|landscap\w*|removals?|handyman|mechanic|security|event\w*)\b", re.I)


def brand_brief(data: dict) -> dict | None:
    """What the drafts may use: only the workspace's own words (offering, customer, place, problem). None when there is
    no offering yet, or nothing left to draft."""
    p = data.get("workspace_profile") or {}
    empty = [f for f in BRAND_FIELDS if _blank(p.get(f))]
    offering = p.get("key_offering_focus") or ((p.get("services") or [{}])[0] or {}).get("service_name") if isinstance(p.get("services"), list) and p.get("services") else p.get("key_offering_focus")
    if not empty or not offering:
        return None
    return {"fields": empty, "offering": offering, "customer": p.get("target_customer_type") if is_segment(p.get("target_customer_type")) else "", "place": ", ".join(x for x in (p.get("city"), p.get("country")) if x),
            "problem": p.get("problem") or "", "company": p.get("company_name") or ""}


BRAND_SYSTEM = ("You write short, plain, specific business profile text from the facts given and nothing else. No hype, no claims, "
                "no em or en dashes. Reply with one JSON object only.")


def brand_prompt(brief: dict) -> str:
    import json as _json
    return ("Draft these empty business profile fields: " + ", ".join(brief["fields"]) + ".\n"
            "Rules: tagline under 8 words; vision one sentence; mission one sentence; core_values 3 to 5 short values as a list.\n"
            "Use only these facts: " + _json.dumps({k: v for k, v in brief.items() if k != "fields" and v}, ensure_ascii=False) + "\n"
            'Reply as {"tagline": "...", "vision": "...", "mission": "...", "core_values": ["...", "..."]} with only the fields asked for.')


def apply_brand(data: dict, drafted: dict, now: datetime | None = None) -> list[str]:
    """The drafts written into the fields still empty, tidied, each marked "Suggested by the Agent" (Keep or Undo)."""
    now = now or datetime.now(timezone.utc)
    p = data.setdefault("workspace_profile", {})
    prov = data.setdefault("profile_provenance", {})
    filled = []
    for f in BRAND_FIELDS:
        v = drafted.get(f)
        if v in (None, "", []) or not _blank(p.get(f)) or (prov.get(f) or {}).get("by") == "owner" or f in (data.get("profile_undone") or {}):
            continue
        if f == "core_values":
            items = v if isinstance(v, list) else re.split(r",\s*", str(v))
            v = [tidy(x).rstrip(".") for x in items if str(x).strip()][:5]
            if len(v) < 3:
                continue
        elif f == "tagline":
            v = tidy(v).rstrip(".")
            if len(v.split()) >= 8:
                continue
        else:
            v = tidy(re.split(r"(?<=[.!?])\s", str(v).strip())[0])
        if re.search("[–—]", str(v)):
            continue
        p[f] = v
        prov[f] = {"source": "Suggested by the Agent", "at": now.isoformat(), "suggestion": True, "value": v}
        filled.append(f)
    if filled:
        had = (data.get("profile_filled") or {}).get("fields") or []
        data["profile_filled"] = {"fields": list(dict.fromkeys(had + filled)), "source": "Suggested by the Agent", "at": now.isoformat()}
    return filled


async def draft_brand_later(orch, business_id: str, user_id: str | None) -> list[str]:
    """After a flow: the empty brand fields drafted in ONE model call (through the AI gateway) and written to the fields
    still empty. Never blocks the flow; a failure leaves them empty for the next flow."""
    import json as _json
    import logging as _logging
    data = await orch.rt.business.load(business_id) or {}
    brief = brand_brief(data)
    if not brief:
        return []
    try:
        from app.shared.llm.openai_client import AutoLLMClient
        res = await AutoLLMClient(user_id=user_id).generate_text(system=BRAND_SYSTEM, prompt=brand_prompt(brief), feature="profile.brand_draft", max_tokens=400)
        m = re.search(r"\{[\s\S]*\}", res.text or "")
        drafted = _json.loads(m.group(0)) if m else {}
    except Exception:      # noqa: BLE001 - left empty, tried again after the next flow
        _logging.getLogger(__name__).info("brand fields not drafted for %s", business_id, exc_info=True)
        return []
    return await orch.rt.business.mutate(business_id, lambda d: apply_brand(d, drafted))
