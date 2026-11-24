"""The owner, 27 Oct: "I can't remember asking all these", "hope it stores history conversations too": each conversation is
kept apart, listed newest first, opened again, and only ever the person's own."""
from test_goal_onboarding import world, OWNER  # noqa: F401


def test_conversations_are_kept_listed_and_opened(world):
    env, store, client, who = world
    who["user"] = OWNER
    said = [{"role": "assistant", "content": "Good evening."}, {"role": "user", "content": "How ready am I for funding?"},
            {"role": "assistant", "content": "80 so far.", "links": [{"label": "Open your funding case", "to": "/funding/c1"}], "check": {"x": 1}}]
    assert client.put("/businesses/A/agent/chats/chat-one", json={"messages": said}).json()["title"] == "How ready am I for funding?"
    client.put("/businesses/A/agent/chats/chat-two", json={"messages": [{"role": "user", "content": "Create an invoice for Mark"}]})
    listed = client.get("/businesses/A/agent/chats").json()["items"]
    assert [c["id"] for c in listed] == ["chat-two", "chat-one"]
    one = client.get("/businesses/A/agent/chats/chat-one").json()
    assert one["messages"][2] == {"role": "assistant", "content": "80 so far.", "links": [{"label": "Open your funding case", "to": "/funding/c1"}]}      # nothing else kept


def test_someone_elses_conversations_are_never_shown(world):
    env, store, client, who = world
    who["user"] = OWNER
    client.put("/businesses/A/agent/chats/chat-one", json={"messages": [{"role": "user", "content": "mine"}]})
    env.businesses["A"]["data"]["agent_chats"]["someone-else"] = [{"id": "theirs", "title": "theirs", "at": "2026-10-27", "messages": []}]
    assert [c["id"] for c in client.get("/businesses/A/agent/chats").json()["items"]] == ["chat-one"]
    assert client.get("/businesses/A/agent/chats/theirs").status_code == 404
