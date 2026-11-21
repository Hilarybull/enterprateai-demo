"""Keep readiness work actions and the real outstanding items in the conversation."""
import re


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
    items = [{"title": str(item.get("title") or "")[:300], "detail": str(item.get("detail") or item.get("description") or "")[:600]}
             for item in subject.get("actions") or [] if isinstance(item, dict) and item.get("status") == "open" and item.get("title")]
    workspace = await orch.rt.business.load(business_id) or {} if orch else {}
    def readable(value):
        if isinstance(value, dict):
            return "; ".join(f"{str(key).replace('_', ' ').capitalize()}: {readable(part)}" for key, part in value.items())
        if isinstance(value, list):
            return "\n".join(readable(part) for part in value)
        return str(value) if value is not None else ""
    drafts = [{"label": path.split(".")[-1].replace("_", " ").capitalize(),
               "value": readable(draft.get("value") if isinstance(draft, dict) else draft),
               "source": str(draft.get("source") or "Draft for your review") if isinstance(draft, dict) else "Draft for your review"}
              for path, draft in service_for(orch).drafts_now(subject.get("data") or {}, workspace).items()]
    return {"type": "readiness_tasks", "case_id": subject_id, "topic": topic, "items": items, "drafts": drafts,
            "title": "Your remaining funding items" if topic == "funding" else "Your remaining launch items"}
