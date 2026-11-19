"""Reproject existing tender metadata from retained releases; never fetch the feed.
Run: python -m app.modules.tenders.repair_index [--apply]
Default is a dry run. Updates use an optimistic details comparison to preserve concurrent changes.
"""
import argparse
import asyncio
import json
from app.core.supabase import sb_select, sb_update
from app.modules.tenders.service import parse_release


def repaired_details(row, history):
    for source in history:
        if source.get("notice_id") != row["notice_id"] or source.get("ocid") != row["ocid"]:
            continue
        projection = next((item for item in parse_release(source.get("payload")).get("listings", []) if item["id"] == row["id"]), None)
        if projection:
            return {**row["details"], **{key: value for key, value in projection["details"].items() if value is not None and value != []}}
    return row["details"]


async def repair(apply=False):
    counts = {"checked": 0, "changed": 0, "updated": 0, "concurrent_changes": 0}
    cursor = None
    while True:
        rows = await sb_select("fts_listings", columns="id,ocid,notice_id,details", filters=[("id", "gt", cursor)] if cursor else [], order="id", limit=100) or []
        if not rows:
            break
        notice_ids = list({row["notice_id"] for row in rows})
        history = await sb_select("fts_release_history", filters=[("notice_id", "in", notice_ids)], order="observed_at", desc=True, limit=1000) or []
        for row in rows:
            counts["checked"] += 1
            details = repaired_details(row, history)
            if details == row["details"]:
                continue
            counts["changed"] += 1
            if apply:
                updated = await sb_update("fts_listings", filters=[("id", "eq", row["id"]), ("details", "eq", json.dumps(row["details"], ensure_ascii=False))], payload={"details": details})
                counts["updated" if updated else "concurrent_changes"] += 1
        cursor = rows[-1]["id"]
    return counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(json.dumps(asyncio.run(repair(args.apply))))
