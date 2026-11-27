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
    if not action:
        return {"kind": "answer", "message": "That item has changed. I've refreshed what remains for this case.",
                "cards": [await remaining_card(orch, user, business_id, topic, [], [{"case_id": case_id}])]}
    section = action.get("section") or (action.get("tool") or {}).get("section")
    fields = {f["key"]: f.get("label") for s in subject.get("profile_definition", {}).get("sections", []) if s.get("key") == section
              for f in s.get("fields", []) if f.get("key") in research.CASE_DRAFT_FIELDS.get("need_funding" if topic == "funding" else "launch", {})}
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
    items = [{"title": str(item.get("title") or "")[:300], "detail": str(item.get("detail") or item.get("why") or item.get("description") or "")[:600],
              "code": item.get("code"),
              "review": "documents" if topic == "funding" and item.get("code") in ("C8.A", "G4") else "attestation" if item.get("code") in attested else None,
              "section": item.get("section") or (item.get("tool") or {}).get("section") or ""}
             for item in subject.get("actions") or [] if isinstance(item, dict) and item.get("status") == "open" and item.get("title")]
    workspace = await orch.rt.business.load(business_id) or {} if orch else {}
    labels = {field["key"]: field.get("label") for section in (subject.get("profile_definition") or {}).get("sections") or [] for field in section.get("fields") or []}
    drafts = [{"label": labels.get(path) or path.split(".")[-1].replace("_", " ").capitalize(), "path": path,
               "value": readable(draft.get("value") if isinstance(draft, dict) else draft),
               "source": str(draft.get("source") or "Draft for your review") if isinstance(draft, dict) else "Draft for your review"}
              for path, draft in service_for(orch).drafts_now(subject.get("data") or {}, workspace).items()]
    return {"type": "readiness_tasks", "case_id": subject_id, "topic": topic, "items": items, "drafts": drafts,
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
