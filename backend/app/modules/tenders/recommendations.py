"""Explainable discovery matches from saved capabilities; no bidding actions."""
import re

from app.modules.proposals import sourcing
from app.modules.tenders import service

STOP = set("the and for with from your our business services service solutions company other general providing provide delivery product products ltd limited industry".split())
STOP.update("framework frameworks agreement agreements contract contracts project projects programme programmes procurement provision management adoption".split())
SPECIFIC = set("software cloud cybersecurity ai digital automation data computer internet network saas crm erp chatbot flight aviation aircraft aerospace".split())


def tokens(value):
    words = {word.rstrip("s") for word in re.findall(r"[a-z]{2,}", str(value).lower()) if word not in STOP and word not in {"of", "to", "in", "on", "by", "as", "an", "is", "be", "or"}}
    if words & {"consulting", "consultancy", "consultant", "advisory"}:
        words -= {"consultancy", "consultant", "advisory"}
        words.add("consulting")
    if {"artificial", "intelligence"} <= words:
        words.add("ai")
    return words


def capabilities(data):
    profile = data.get("workspace_profile") or {}
    secondary = profile.get("secondary_industries") or []
    values = [profile.get("primary_industry"), *([secondary] if isinstance(secondary, str) else secondary)]
    for item in profile.get("services") or []:
        if isinstance(item, dict):
            values.extend(item.get(key) for key in ("service_name", "service_category"))
    for item in (data.get("financials") or {}).get("products") or []:
        if isinstance(item, dict):
            values.extend(item.get(key) for key in ("name", "category"))
    for item in (data.get("catalogue") or {}).get("products") or []:
        if isinstance(item, dict):
            values.extend(item.get(key) for key in ("name", "category"))
    return list(dict.fromkeys(value.strip() for value in values if isinstance(value, str) and tokens(value)))[:40]


def match(notice, labels):
    # Description alone is too weak: require a capability in title or classifications.
    content = " ".join(str(notice.get(key) or "") for key in ("title", "industry"))
    content += " " + " ".join(str(item.get("description") or "") for item in notice.get("cpv_classifications") or [] if isinstance(item, dict))
    words = tokens(content)
    title_words = tokens(notice.get("title"))
    codes = [str(notice.get("cpv") or ""), *[str(item.get("id") or "") for item in notice.get("cpv_classifications") or [] if isinstance(item, dict)]]
    primary_code = str(notice.get("cpv") or next((code for code in codes if code), ""))
    consultancy_category = primary_code.startswith(("794", "721", "72224", "726"))
    reasons, score = [], 0
    for label in labels:
        meaningful = tokens(label)
        overlap = meaningful & words
        # The broad IT category 72000000 mentions consulting even for software resales.
        # General consulting needs actual consultancy scope or a specific consultancy code.
        if meaningful == {"consulting"}:
            if "consulting" in title_words or consultancy_category:
                score += 2
                reasons.append(f"Matches your saved capability: {label}")
            continue
        if overlap and (len(meaningful) == 1 or len(overlap) >= 2 or overlap & SPECIFIC):
            score += len(overlap)
            reasons.append(f"Matches your saved capability: {label}")
    return score, reasons[:3]


async def recommend(user_id, workspace_id, *, stage=None, page=1, page_size=10):
    workspace = await sourcing._owned_workspace(user_id, workspace_id)
    labels = capabilities(workspace.get("data") or {})
    result = {"workspace_id": workspace_id, "profile_needed": not bool(labels),
              "open_count": 0, "award_count": 0, "open": [], "awards": [],
              "generated_at": service.utc_now().isoformat(), "last_checked": None, "stale": False}
    if stage:
        result.update(items=[], total=0, page=page, page_size=page_size, more=False)
    if not labels:
        return result
    groups = {kind: [] for kind in ([stage] if stage else ["open", "award"])}
    requested_stage = stage
    for kind in groups:
        source_page = 1
        seen = set()
        while True:
            batch = await service.search(stage=kind, page=source_page, limit=50, sme="all")
            result.update(last_checked=batch.get("last_sync"), stale=result["stale"] or bool(batch.get("stale")))
            added = 0
            for notice in batch.get("items") or []:
                if notice["id"] in seen:
                    continue
                seen.add(notice["id"])
                added += 1
                if notice.get("status") != kind:
                    continue
                score, reasons = match(notice, labels)
                if score:
                    groups[kind].append({"id": notice["id"], "title": notice.get("title"),
                        "buyer": notice.get("buyer"), "deadline": notice.get("deadline"),
                        "published_at": notice.get("published_at"), "reasons": reasons, "score": score})
            if not batch.get("more") or not added:
                break
            source_page += 1
    for kind, matches in groups.items():
        ranked = sorted(matches, key=lambda item: (item["score"], item.get("published_at") or ""), reverse=True)
        public = [{key: value for key, value in item.items() if key != "score"} for item in ranked]
        result[kind + "_count"] = len(public)
        result["open" if kind == "open" else "awards"] = public[:2]
        if requested_stage == kind:
            offset = (page - 1) * page_size
            result.update(items=public[offset:offset + page_size], total=len(public), more=offset + page_size < len(public))
    return result
