"""QA P2-13: sending the sign-in code does not keep the visitor waiting on the mail service."""
import asyncio
import time

from app.modules.agent import goals


def test_a_slow_mail_service_does_not_hold_up_the_reply(monkeypatch):
    monkeypatch.setattr(goals, "MAIL_WAIT_SECONDS", 0.2)
    sent = []

    async def slow_mailer(email, code, text):
        await asyncio.sleep(1.0)
        sent.append(email)

    async def go():
        store = goals.SessionStore()
        session = await goals.start(store, text=None, key="need_funding", entry_mode="business_goal")
        began = time.monotonic()
        await goals.send_code(store, session, "ada@example.test", slow_mailer, name="Ada")
        took = time.monotonic() - began
        await asyncio.sleep(1.2)      # and the email still goes out
        return took

    took = asyncio.run(go())
    assert took < 0.8 and sent == ["ada@example.test"]
