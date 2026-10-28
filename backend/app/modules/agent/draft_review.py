"""The Agent's drafts on a case, reviewed by talking (the owner's mockups, 27 Oct: "The use of funds allocation looks ok, but
let me edit the supporting market evidence", "Reduce the expected monthly sales slightly and keep this customer segment.
Adopt it."). The model reads the drafts waiting and says which the owner accepted, changed or rejected; nothing is applied
unless the owner's own message approves or rejects, and only drafts that are waiting can be touched."""
from __future__ import annotations

import json
import re
from typing import Any

ADOPT = re.compile(r"\b(?:adopt|accept|approve|apply|use (?:it|them|that|those|these|all)|keep (?:it|them|that|this|those|these)|looks? (?:right|good|fine|ok(?:ay)?)|"
                   r"go with|that'?s (?:right|fine|good)|all good|yes,? (?:use|adopt|accept|apply))", re.I)
REJECT = re.compile(r"\b(?:reject|drop|discard|remove|don'?t (?:use|want)|not (?:that|this) one|bin it)\b", re.I)


def _get(data: dict, path: str) -> Any:
    cur: Any = data
    for part in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def _same(a: Any, b: Any) -> bool:
    return json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str) or str(a if a is not None else "").strip() == str(b if b is not None else "").strip()


def waiting(data: dict) -> dict:
    """The drafts still waiting: never one that already says what its field says."""
    return {p: d for p, d in ((data or {}).get("agent_drafts") or {}).items() if isinstance(d, dict) and "value" in d and not _same(_get(data, p), d.get("value"))}


def labels(subject_type: str, data: dict) -> dict:
    from app.modules.readiness import rules
    try:
        profile = rules.select_profile(subject_type, data)
    except Exception:      # noqa: BLE001
        return {}
    out = {}
    for s in profile.get("sections") or []:
        for f in s.get("fields") or []:
            if f.get("key"):
                out[f["key"]] = {"label": f.get("label") or f["key"], "section": s.get("title")}
    return out


def view(subject_type: str, data: dict) -> list[dict]:
    """The drafts as the model sees them: where each goes, what it says (short), and where it came from."""
    named = labels(subject_type, data)
    return [{"path": p, "label": (named.get(p) or {}).get("label") or p, "section": (named.get(p) or {}).get("section"),
             "draft": json.dumps(d.get("value"), ensure_ascii=False, default=str)[:400], "source": d.get("source")} for p, d in waiting(data).items()][:12]


def _nest(path: str, value: Any) -> dict:
    out: dict = {}
    cur = out
    parts = path.split(".")
    for part in parts[:-1]:
        cur = cur.setdefault(part, {})
    cur[parts[-1]] = value
    return out


def _merge(a: dict, b: dict) -> dict:
    out = dict(a)
    for k, v in b.items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def decided(said: str, got: Any, data: dict) -> dict | None:
    """What the owner decided, from the model's reading, kept to what their own words allow: {"accept": {path: value},
    "reject": [paths]}; None when nothing was decided."""
    if not isinstance(got, dict):
        return None
    drafts = waiting(data)
    if not drafts:
        return None
    adopting, rejecting = bool(ADOPT.search(said or "")), bool(REJECT.search(said or ""))
    accept: dict = {}
    if adopting:
        wanted = list(drafts) if got.get("accept") == "all" else [p for p in got.get("accept") or [] if p in drafts]
        accept = {p: drafts[p]["value"] for p in wanted}
        for p, v in (got.get("edit") or {}).items() if isinstance(got.get("edit"), dict) else []:
            if p in drafts and v not in (None, ""):
                old = drafts[p]["value"]
                # The changed value keeps the draft's shape: a number stays a number, a list stays a list
                if isinstance(old, (int, float)) and not isinstance(old, bool):
                    try:
                        v = float(str(v).replace(",", ""))
                    except ValueError:
                        continue
                elif isinstance(old, list) and not isinstance(v, list):
                    continue
                accept[p] = v
    reject = [p for p in got.get("reject") or [] if p in drafts and p not in accept] if rejecting else []
    return {"accept": accept, "reject": reject} if accept or reject else None


def changes_for(decision: dict, data: dict) -> dict:
    """The case update: each accepted value in its field, the drafts decided taken off, a rejected one never drafted again."""
    out: dict = {}
    for p, v in decision["accept"].items():
        out = _merge(out, _nest(p, v))
    gone = set(decision["accept"]) | set(decision["reject"])
    out["agent_drafts"] = {p: d for p, d in ((data or {}).get("agent_drafts") or {}).items() if p not in gone}
    if decision["reject"]:
        out["rejected_drafts"] = sorted(set((data or {}).get("rejected_drafts") or []) | set(decision["reject"]))
    return out
