"""The owner, 25 Oct: the funding page score flipped between 88 and 95 after a change. The summary shows the check of the
newest version of the case, whatever order the checks were made or finished in."""
import asyncio

from app.modules.readiness.service import ReadinessService


class _Store:
    def __init__(self, rows):
        self.rows = rows

    async def list(self, table, business_id, subject_id=None, limit=50):
        return self.rows[:limit]


def test_the_check_of_the_newest_version_wins():
    svc = ReadinessService.__new__(ReadinessService)
    rows = [  # newest created first
        {"id": "old-rev-later", "status": "succeeded", "data": {"subject_revision": 4, "result": {"score": 88}}},
        {"id": "new-rev", "status": "succeeded", "data": {"subject_revision": 5, "result": {"score": 95}}},
        {"id": "older", "status": "succeeded", "data": {"subject_revision": 3, "result": {"score": 70}}},
    ]
    svc.store = _Store(rows)
    got = asyncio.run(svc._latest({"business_id": "A", "id": "C1"}, succeeded_only=True))
    assert got["id"] == "new-rev"
    assert asyncio.run(svc._latest({"business_id": "A", "id": "C1"}))["id"] == "old-rev-later"      # the newest of any status, unchanged
