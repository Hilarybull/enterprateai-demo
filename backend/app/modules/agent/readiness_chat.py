"""Keep readiness work actions and the real outstanding items in the conversation."""
import re


async def work_on_item(orch, user, business_id, request, selected, history=None):
    """Work on one current action, without entering the all-case research flow."""
    import asyncio
    import json
    from datetime import datetime, timezone
    from app.modules.agent import converse, research
    from app.modules.readiness.service import service_for
    from app.modules.readiness import rules

    topic = selected.get("topic")
    if topic not in ("funding", "launch"):
        raise ValueError("This item is not a funding or launch task.")
    svc = service_for(orch)
    kind = rules.FUNDING if topic == "funding" else rules.LAUNCH
    case_id = str(selected.get("case_id") or "")
    subject = await svc.get_subject(user["id"], business_id, kind, case_id, user.get("email"))
    # Resolve against server actions. The browser label does not authorize another
    # case or let a stale card invent a field to write.
    action = next((a for a in subject.get("actions") or [] if a.get("title") == selected.get("title") and a.get("status") == "open"), None)
    selected_path = selected.get("path")
    if not action and selected_path in svc.drafts_now(subject.get("data") or {}, await orch.rt.business.load(business_id) or {}):
        field_section = next((section for section in subject.get("profile_definition", {}).get("sections", []) if any(field.get("key") == selected_path for field in section.get("fields") or [])), None)
        if field_section:
            action = {"title": selected.get("title"), "section": field_section["key"], "detail": selected.get("detail")}
    if not action:
        return {"kind": "answer", "message": "That item has changed. I've refreshed what remains for this case.",
                "cards": [await remaining_card(orch, user, business_id, topic, [], [{"case_id": case_id}])]}
    section = action.get("section") or (action.get("tool") or {}).get("section")
    fields = {f["key"]: f.get("label") for s in subject.get("profile_definition", {}).get("sections", []) if s.get("key") == section
              for f in s.get("fields", []) if f.get("key") in research.CASE_DRAFT_FIELDS.get("need_funding" if topic == "funding" else "launch", {}) and (not selected_path or f["key"] == selected_path)}
    workspace = await orch.rt.business.load(business_id) or {}
    facts = {"item": action, "case": subject.get("data") or {}, "fields_you_may_draft": fields,
             "records": converse.records_of(workspace), "history": history or [], "request": request,
             "existing_drafts": (subject.get("data") or {}).get("agent_drafts") or {}}
    if re.search(r"currenc|exchange|convert",str(action)+str(request),re.I):
        from app.modules.agent.currency_conversion import quote
        from app.modules.agent import business as bz
        target = str((subject.get("data") or {}).get("currency") or bz.currency_of(workspace)).upper()
        codes = {bz.currency_of(workspace)}
        for docs in (workspace.get("financials") or {}).values():
            if isinstance(docs,list):
                codes.update(bz.doc_currency(doc,bz.currency_of(workspace)) for doc in docs if isinstance(doc,dict))
        facts["currency_quotes"] = [await quote(1,code,target) for code in sorted(codes-{target})[:5]]
    llm = research._default_llm(user["id"])
    if not llm:
        raise RuntimeError("The agent isn't available to work on this item right now. Please try again.")
    system = (
        "Work only on the selected readiness action. Return JSON with message and drafts (a mapping of permitted field paths to proposed values). "
        "Use the actual item detail and case facts. Draft the selected fields where the evidence supports a useful proposal. "
        "Do not approve or change live answers. Do not claim an issue is fixed: drafts need review. "
        "If the issue is blocked on missing facts, ask one precise question and return empty drafts. "
        "For a currency mismatch, use the verified currency_quotes and their rate dates when available, show the conversion for review, and never ask the owner to calculate it. If the rate service is unavailable, offer to retry or use an explicit rate supplied by the owner; "
        "do not invent exchange rates or change the business currency. A document or forecast conflict cannot be fixed by drafting unrelated profile fields. "
        "Never restart general research or just list all remaining items. Existing research is not proof this action is complete. "
        "Never expose internal IDs. Use plain conversational language. No HTML or action markup."
    )
    result = await asyncio.wait_for(converse.paid_reply(orch, user, lambda: llm.generate_text(
        system=system, prompt=json.dumps(facts, ensure_ascii=False, default=str), feature="agent_conversation", max_tokens=1200)), 60)
    output = converse._parse(result.text)
    message = str(output.get("message") or "").strip()
    if not message:
        raise RuntimeError("The agent couldn't prepare a response for this item. Please try again.")
    proposed = output.get("drafts") if isinstance(output.get("drafts"), dict) else {}
    proposed = {path: value for path, value in proposed.items() if path in fields and value not in (None, "", [], {})}
    if proposed:
        held = (subject.get("data") or {}).get("agent_drafts") or {}
        drafts = {**held, **{path: {"value": value, "source": "Suggested by the agent; awaiting your review"} for path, value in proposed.items()}}
        await svc.update_subject(user["id"], business_id, kind, case_id, subject.get("revision"), {"agent_drafts": drafts}, user.get("email"))
        message = "I've prepared a draft for this item. Review it below before approving it."
    card = await remaining_card(orch, user, business_id, topic, [], [{"case_id": case_id}]) if proposed else None
    return await converse._said(orch, user, business_id, request, message, [], datetime.now(timezone.utc), topic=topic,
                                cards=[card] if card else [])


def conversation_actions(actions):
    out = []
    for action in actions or []:
        action = dict(action)
        destination = str(action.get("to") or "")
        match = re.match(r"^/(funding|launch)/([^/?]+)", destination)
        if match and not str(action.get("label") or "").lower().startswith("view workspace"):
            topic = match[1]
            label = str(action.get("label") or "Continue")
            prompt = (f"List every remaining item on this {topic} case here, including drafts waiting for review. "
                      "Help me attend to them one at a time in this conversation.")
            if "manual" in label.lower():
                label = "Work through it here"
            elif label.lower().startswith("open"):
                label = "Review remaining items"
            action = {"label": label, "kind": "explain", "prompt": prompt}
        out.append(action)
    return out


_FUNDING_REVIEW_FIELDS = {
    "C1.A": ["target_amount", "receipt_date"], "G1": ["target_amount", "receipt_date"],
    "C1.B": ["purpose", "milestones", "purpose_milestone_id"],
    "C2.A": ["target_amount", "use_of_funds"], "G2": ["target_amount", "use_of_funds"], "C2.B": ["use_of_funds"],
    "C5.A": ["economics.price", "economics.direct_cost", "economics.fixed_costs_monthly"],
    "C6.A": ["market.target_segment", "market.differentiation"],
    "C6.B": ["market.acquisition_approach", "market.acquisition_owner", "market.acquisition_cost", "market.acquisition_milestone_id"],
    "C7.A": ["team.responsibilities"], "C7.B": ["team.gaps", "team.no_gaps"],
}


def review_values(subject, item, topic, drafts):
    """Only content belonging to this check; a review-type check is not proof content exists."""
    from app.modules.readiness import engine
    section = item.get("section") or (item.get("tool") or {}).get("section")
    profile = subject.get("profile_definition") or {}
    definition = next((s for s in profile.get("sections") or [] if s.get("key") == section), {})
    fields = definition.get("fields") or []
    paths = _FUNDING_REVIEW_FIELDS.get(item.get("code")) if topic == "funding" else None
    paths = paths if paths is not None else [f["key"] for f in fields if f["key"] not in ("title", "name", "currency")]
    evidence_checks = set(definition.get("evidence") or [])
    evidence_only = item.get("code") in evidence_checks or (item.get("review") == "attestation" and bool(evidence_checks))
    if evidence_only:
        paths = []
    elif topic == "funding" and item.get("code") == "C5.B":
        paths = ["economics.price", "economics.direct_cost", "economics.fixed_costs_monthly"]
    elif topic == "launch" and item.get("code") == "C2.B":
        paths = ["economics.price_per_unit", "economics.variable_cost_per_unit", "economics.fixed_costs_monthly"]
    if item.get("review") == "attestation":
        drafts = {}  # A reviewer confirms saved inputs, never an unapproved proposal.
    labels = {f["key"]: f.get("label") or f["key"] for s in profile.get("sections") or [] for f in s.get("fields") or []}
    values = []
    if item.get("review") == "forecast":
        if "forecast" in ((subject.get("data") or {}).get("rejected_drafts") or []) and not subject.get("forecast"):
            return []
        forecast = (subject.get("forecast") or {}).get("data") or subject.get("forecast_draft") or {}
        currency = forecast.get("currency") or (subject.get("data") or {}).get("currency") or ""
        for month in forecast.get("months") or []:
            if not engine.blank(month.get("receipts")) or not engine.blank(month.get("payments")):
                values.append({"label": str(month.get("month") or "Month"), "value": f"Receipts: {currency} {month.get('receipts') if month.get('receipts') is not None else 'Not entered'}; Payments: {currency} {month.get('payments') if month.get('payments') is not None else 'Not entered'}", "draft": not bool(subject.get("forecast"))})
        return values
    if item.get("review") != "documents":
        for path in paths:
            proposed = drafts.get(path)
            value = proposed.get("value") if isinstance(proposed, dict) else proposed if path in drafts else engine.get(subject.get("data") or {}, path)
            if value is not False and not engine.blank(value) and readable(value).strip():
                field = next((f for f in fields if f.get("key") == path), {})
                shown = f"{(subject.get('data') or {}).get('currency') or ''} {readable(value)}".strip() if field.get("type") == "money" else readable(value)
                if field.get("type") == "ref":
                    linked = next((row for row in (subject.get("data") or {}).get(field.get("of")) or [] if str(row.get("id")) == str(value)), {})
                    shown = str(linked.get(field.get("show")) or linked.get("name") or "Linked item")
                elif isinstance(value, bool):
                    shown = "Yes" if value else "No"
                elif isinstance(value, str):
                    shown = (field.get("labels") or {}).get(value) or shown
                values.append({"path": path, "label": labels.get(path) or path.replace("_", " "), "value": shown, "draft": path in drafts})
    if item.get("review") == "documents":
        for doc in profile.get("required_documents") or []:
            entry = ((subject.get("data") or {}).get("documents") or {}).get(doc["key"]) or {}
            if entry.get("evidence_id") or entry.get("artifact_id"):
                values.append({"path": "documents." + doc["key"], "label": doc.get("label") or doc["key"], "value": "Document attached", "document": True})
    checks = set(definition.get("evidence") or []) | {str(item.get("code") or "")}
    if evidence_only or item.get("review") == "attestation":
        for evidence in subject.get("evidence") or []:
            if any(link.get("check") in checks and str(link.get("subject_id")) == str(subject.get("id")) for link in evidence.get("links") or []):
                values.append({"label": evidence.get("title") or "Evidence", "value": evidence.get("claim") or "Evidence attached", "evidence": True})
    return values


async def remaining_card(orch, user, business_id, topic, actions, cards):
    if topic not in {"funding", "launch"}:
        return None
    subject_id = next((str(card["case_id"]) for card in cards or [] if card.get("case_id")), None)
    if not subject_id:
        for action in actions or []:
            match = re.match(rf"^/{topic}/([^/?]+)", str(action.get("to") or ""))
            if match:
                subject_id = match[1]
                break
    if not subject_id:
        return None
    from app.modules.readiness.service import service_for
    from app.modules.readiness import rules
    subject = await service_for(orch).get_subject(user["id"], business_id,
        rules.FUNDING if topic == "funding" else rules.LAUNCH, subject_id, user.get("email"))
    attested = {code for section in (subject.get("profile_definition") or {}).get("sections") or [] for code in section.get("attest") or []}
    evidence_codes = {code for section in (subject.get("profile_definition") or {}).get("sections") or [] for code in section.get("evidence") or []}
    items = [{"title": str(item.get("title") or "")[:300], "detail": str(item.get("detail") or item.get("why") or item.get("description") or "")[:600],
              "code": item.get("code"),
              "review": "documents" if topic == "funding" and item.get("code") in ("C8.A", "G4") else "forecast" if item.get("code") in ("C3.A", "C3.B", "G3") else "attestation" if item.get("code") in attested else "evidence" if item.get("code") in evidence_codes else None,
              "section": item.get("section") or (item.get("tool") or {}).get("section") or ""}
             for item in subject.get("actions") or [] if isinstance(item, dict) and item.get("status") == "open" and item.get("title")]
    workspace = await orch.rt.business.load(business_id) or {} if orch else {}
    labels = {field["key"]: field.get("label") for section in (subject.get("profile_definition") or {}).get("sections") or [] for field in section.get("fields") or []}
    pending = service_for(orch).drafts_now(subject.get("data") or {}, workspace)
    for item in items:
        item["values"] = review_values(subject, item, topic, pending)
        item["has_values"] = bool(item["values"])
        if item["review"] == "forecast" and item["has_values"] and any(v.get("draft") for v in item["values"]):
            item["detail"] = "A proposed forecast is ready to review. It has not been approved or saved as your forecast yet."
    drafts = [{"label": labels.get(path) or path.split(".")[-1].replace("_", " ").capitalize(), "path": path,
               "value": readable(draft.get("value") if isinstance(draft, dict) else draft),
               "source": str(draft.get("source") or "Draft for your review") if isinstance(draft, dict) else "Draft for your review"}
              for path, draft in pending.items() if readable(draft.get("value") if isinstance(draft, dict) else draft).strip()]
    return {"type": "readiness_tasks", "case_id": subject_id, "topic": topic, "items": items, "drafts": drafts, "revision": subject.get("revision"), "currency": (subject.get("data") or {}).get("currency"),
            "score": (subject.get("summary") or {}).get("score"), "score_partial": bool((subject.get("summary") or {}).get("score_partial")),
            "title": "Your remaining funding items" if topic == "funding" else "Your remaining launch items"}


def readable(value):
    """Human review text, excluding record keys and links between internal records."""
    if isinstance(value, dict):
        return "\n".join(f"{str(key).replace('_', ' ').capitalize()}: {readable(part)}"
                         for key, part in value.items()
                         if key != "id" and not str(key).startswith("_") and not str(key).endswith("_id")
                         and part not in (None, "", [], {}))
    if isinstance(value, list):
        return "\n\n".join(filter(None, (readable(part) for part in value)))
    return str(value) if value is not None else ""


async def funding_options_card(orch, user, business_id, case_id):
    """Options-only searches complete with their sourced options, never readiness drafts."""
    from app.modules.readiness import rules
    from app.modules.readiness.service import service_for
    from app.modules.agent import converse, goal_router
    subject = await service_for(orch).get_subject(user["id"], business_id, rules.FUNDING, case_id, user.get("email"))
    answers = goal_router._case_answers(subject.get("data") or {})
    data = await orch.rt.business.load(business_id) or {}
    found = converse.options_found(data, case_id=case_id, answers=answers)
    route = str(answers.get("route") or "").lower()
    routes = [route] if route in ("loan", "grant", "equity") else ["loan", "grant", "equity"]
    return {"type": "options", "case_id": case_id, "options": converse.option_cards(found), "routes": routes,
            "title": "Funding options for your business", "message": "" if found else "No funding options with a checked source were found for this case. You can ask me to search again."}


async def decide_item(orch, user, business_id, topic, case_id, code, revision, approve):
    from app.modules.readiness import rules, engine
    from app.modules.readiness.service import service_for, Invalid, Conflict, _set
    svc = service_for(orch)
    kind = rules.FUNDING if topic == "funding" else rules.LAUNCH
    subject = await svc.get_subject(user["id"], business_id, kind, case_id, user.get("email"))
    if subject.get("revision") != revision:
        raise Conflict("stale_revision", "These values changed. Review the latest values before deciding.", subject)
    action = next((a for a in subject.get("actions") or [] if a.get("code") == code and a.get("status") == "open"), None)
    if not action:
        raise Invalid({"item": "This item is no longer pending. Refresh the list."})
    profile = subject.get("profile_definition") or {}
    attested = {c for section in profile.get("sections") or [] for c in section.get("attest") or []}
    evidence_codes = {c for section in profile.get("sections") or [] for c in section.get("evidence") or []}
    target = {**action, "review": "documents" if topic == "funding" and code in ("C8.A", "G4") else "forecast" if code in ("C3.A", "C3.B", "G3") else "attestation" if code in attested else "evidence" if code in evidence_codes else None}
    pending = svc.drafts_now(subject.get("data") or {}, await orch.rt.business.load(business_id) or {})
    values = review_values(subject, target, topic, pending)
    if not values:
        raise Invalid({"item": "There is nothing to review yet. Fill this item first."})
    if target["review"] == "attestation":
        await svc.attest(user["id"], business_id, kind, case_id, code, approve,
                         "Reviewed the available values in Agent chat: " + ("approved." if approve else "rejected."), email=user.get("email"))
    elif target["review"] == "evidence":
        for evidence in subject.get("evidence") or []:
            links = evidence.get("links") or []
            matching = [link for link in links if link.get("check") == code and str(link.get("subject_id")) == str(case_id)]
            if not matching:
                continue
            if approve:
                await svc.review_evidence(user["id"], business_id, evidence["id"], verification="self_attested", rationale="Approved by the user after reviewing the attached evidence in Agent chat.", email=user.get("email"), feature=kind)
            else:
                await svc.update_evidence(user["id"], business_id, evidence["id"], {"links": [link for link in links if link not in matching]}, email=user.get("email"), feature=kind)
    elif target["review"] == "forecast":
        forecast = subject.get("forecast") or {}
        if approve:
            forecast_data = forecast.get("data") or subject.get("forecast_draft") or {}
            await svc.save_forecast(user["id"], business_id, kind, case_id, forecast_data, forecast.get("revision"), user.get("email"))
        else:
            await svc.update_subject(user["id"], business_id, kind, case_id, revision, {"forecast_id": None, "rejected_drafts": sorted(set((subject.get("data") or {}).get("rejected_drafts") or []) | {"forecast"})}, user.get("email"))
    elif target["review"] == "documents":
        for value in values:
            await svc.review_document(user["id"], business_id, case_id, value["path"].split(".", 1)[1], reviewed=approve, email=user.get("email"))
    else:
        data = subject.get("data") or {}
        paths = [value["path"] for value in values if value.get("path")]
        changes = {}
        for path in paths:
            raw = pending[path].get("value") if isinstance(pending.get(path), dict) else pending[path] if path in pending else engine.get(data, path)
            _set(changes, path, raw if approve else [] if isinstance(raw, list) else None)
        changes["agent_drafts"] = {path: value for path, value in (data.get("agent_drafts") or {}).items() if path not in paths}
        if not approve:
            changes["rejected_drafts"] = sorted(set(data.get("rejected_drafts") or []) | set(paths))
        await svc.update_subject(user["id"], business_id, kind, case_id, revision, changes, user.get("email"))
    row = await svc.store.get("subjects", case_id)
    await svc.request_assessment(user["id"], business_id, kind, case_id, idempotency_key=f"chat-review:{case_id}:{row['revision']}:{code}:{approve}", email=user.get("email"))
    card = await remaining_card(orch, user, business_id, topic, [], [{"case_id": case_id}])
    return {"card": card, "message": "Values approved. Any missing details remain on the list." if approve else "Values rejected. You can enter replacements yourself or ask the Agent for help."}
