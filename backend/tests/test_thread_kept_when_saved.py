"""The chat keeps every message once saved (the owner's QA, 21 Oct, three times live): the opening message and the first
question were added after the session was saved, so the first answer loaded a thread without them. A store that saves a
copy, as the database does, shows it."""
import asyncio
import copy

from app.modules.agent import goals


class CopyingStore(goals.SessionStore):
    """Saves and reads a copy, as the real database does: nothing changed after a save is kept."""
    def __init__(self):
        self.rows, self.events = {}, []

    async def put(self, row):
        self.rows[row["id"]] = copy.deepcopy(row)

    async def get(self, session_id):
        return copy.deepcopy(self.rows.get(session_id))

    async def record(self, event):
        self.events.append(event)


def test_the_opening_message_and_first_question_survive_the_first_answer():
    store = CopyingStore()
    s = asyncio.run(goals.start(store, text="I need funding to expand my car wash", key=None, entry_mode="free_text"))
    opening = [t["content"] for t in s["turns"]]
    assert opening[0] == "I need funding to expand my car wash" and len(opening) == 2
    saved = asyncio.run(store.get(s["id"]))
    assert [t["content"] for t in saved["turns"]] == opening      # saved with the session, not only returned
    asked = saved["turns"][-1].get("next")
    after = asyncio.run(goals.add_inputs(store, saved, {}, message="about 5 million naira", asked=asked, rules_only=True))
    said = [t["content"] for t in after["turns"]]
    assert said[:2] == opening and said[2] == "about 5 million naira" and len(said) == 4
