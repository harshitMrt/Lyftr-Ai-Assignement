import os
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient
from litellm.types.utils import ModelResponse, Choices, Message, Usage
import litellm
from litellm.caching import Cache

# Use local test db
os.environ["DATABASE_URL"] = "sqlite:///./data/test_app.db"
os.environ["LLM_API_KEYS"] = "test_key_1,test_key_2"
os.environ["ENABLE_FAILURE_SIMULATION"] = "true"

from app.main import app
from app.database import DB_PATH, init_db, get_session, get_session_messages

@pytest.fixture(autouse=True)
def setup_teardown_db():
    if os.path.exists(DB_PATH):
        try:
            os.remove(DB_PATH)
        except OSError:
            pass
    init_db(DB_PATH)
    litellm.cache = Cache(type="local")
    yield
    if os.path.exists(DB_PATH):
        try:
            os.remove(DB_PATH)
        except OSError:
            pass

client = TestClient(app)

def mock_llm_response(content="Hello world", prompt_tokens=10, completion_tokens=5):
    return ModelResponse(
        id="test-id",
        choices=[Choices(message=Message(content=content, role="assistant"))],
        usage=Usage(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens, total_tokens=prompt_tokens + completion_tokens)
    )

def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["keys_configured"] == 2
    assert data["cache_enabled"] is True

def test_validation_errors():
    # Missing session_id
    res = client.post("/chat", json={"message": "hello"})
    assert res.status_code == 422
    assert "detail" in res.json()

    # Empty session_id
    res = client.post("/chat", json={"session_id": "   ", "message": "hello"})
    assert res.status_code == 422
    assert "detail" in res.json()

    # Empty message
    res = client.post("/chat", json={"session_id": "s-1", "message": "   "})
    assert res.status_code == 422
    assert "detail" in res.json()

    # Message > 4000 characters
    long_msg = "a" * 4001
    res = client.post("/chat", json={"session_id": "s-1", "message": long_msg})
    assert res.status_code == 422
    assert "detail" in res.json()

    # Malformed JSON
    res = client.post("/chat", content="not-a-json", headers={"Content-Type": "application/json"})
    assert res.status_code == 422
    assert "detail" in res.json()

def test_unknown_session_404():
    res = client.get("/sessions/unknown-session-123/messages")
    assert res.status_code == 404
    assert res.json() == {"detail": "session not found"}

def test_chat_multi_turn_history():
    with patch("litellm.completion") as mock_comp:
        mock_comp.side_effect = [
            mock_llm_response(content="Paris is the capital of France.", prompt_tokens=25, completion_tokens=7),
            mock_llm_response(content="It has about 2.1 million residents.", prompt_tokens=40, completion_tokens=8)
        ]

        # Turn 1
        res1 = client.post("/chat", json={
            "session_id": "s-france",
            "message": "What is the capital of France?",
            "system_prompt": "You are a geography bot."
        })
        assert res1.status_code == 200
        data1 = res1.json()
        assert data1["reply"] == "Paris is the capital of France."
        assert data1["metadata"]["resolution_source"] == "LIVE_INFERENCE"
        assert data1["metadata"]["key_id"] == "key_1"
        assert data1["metadata"]["fallback_attempts"] == 0

        # Turn 2
        res2 = client.post("/chat", json={
            "session_id": "s-france",
            "message": "What is its population?"
        })
        assert res2.status_code == 200
        data2 = res2.json()
        assert data2["reply"] == "It has about 2.1 million residents."

        # Verify second call included full history
        assert mock_comp.call_count == 2
        second_call_messages = mock_comp.call_args_list[1].kwargs["messages"]
        assert len(second_call_messages) == 4
        assert second_call_messages[0] == {"role": "system", "content": "You are geography bot." if False else "You are a geography bot."}
        assert second_call_messages[1] == {"role": "user", "content": "What is the capital of France?"}
        assert second_call_messages[2] == {"role": "assistant", "content": "Paris is the capital of France."}
        assert second_call_messages[3] == {"role": "user", "content": "What is its population?"}

        # Verify GET /sessions/{session_id}/messages
        hist_res = client.get("/sessions/s-france/messages")
        assert hist_res.status_code == 200
        hist_data = hist_res.json()
        assert hist_data["session_id"] == "s-france"
        assert len(hist_data["messages"]) == 4
        assert hist_data["messages"][0]["role"] == "user"
        assert hist_data["messages"][1]["role"] == "assistant"
        assert hist_data["messages"][1]["metadata"]["resolution_source"] == "LIVE_INFERENCE"
        assert hist_data["messages"][1]["metadata"]["input_tokens"] == 25
        assert hist_data["messages"][1]["metadata"]["output_tokens"] == 7

def test_cache_hits():
    with patch("litellm.completion") as mock_comp:
        mock_comp.return_value = mock_llm_response(content="Cached capital answer", prompt_tokens=15, completion_tokens=4)

        # First request in session 1 -> live inference
        res1 = client.post("/chat", json={
            "session_id": "sess-c1",
            "message": "Hello capital",
            "system_prompt": "You are a bot."
        })
        assert res1.status_code == 200
        data1 = res1.json()
        assert data1["metadata"]["resolution_source"] == "LIVE_INFERENCE"
        assert mock_comp.call_count == 1

        # Same first message in new session sess-c2 -> must hit cache!
        res2 = client.post("/chat", json={
            "session_id": "sess-c2",
            "message": "Hello capital",
            "system_prompt": "You are a bot."
        })
        assert res2.status_code == 200
        data2 = res2.json()
        assert data2["reply"] == "Cached capital answer"
        assert data2["metadata"]["resolution_source"] == "LLM_CACHE"
        assert data2["metadata"]["key_id"] is None
        assert data2["metadata"]["fallback_attempts"] == 0
        assert data2["metadata"]["input_tokens"] == 15
        assert data2["metadata"]["output_tokens"] == 4
        # Did not call provider again
        assert mock_comp.call_count == 1

        # Different message in sess-c3 -> must miss cache
        mock_comp.return_value = mock_llm_response(content="Different answer", prompt_tokens=20, completion_tokens=6)
        res3 = client.post("/chat", json={
            "session_id": "sess-c3",
            "message": "Different question",
            "system_prompt": "You are a bot."
        })
        assert res3.status_code == 200
        data3 = res3.json()
        assert data3["metadata"]["resolution_source"] == "LIVE_INFERENCE"
        assert mock_comp.call_count == 2

def test_failover_simulation():
    # 1. key_1=429 -> key_2 succeeds
    with patch("litellm.completion") as mock_comp:
        mock_comp.return_value = mock_llm_response(content="Key 2 response")

        res = client.post(
            "/chat",
            json={"session_id": "s-failover-1", "message": "test failover 429"},
            headers={"X-Simulate-Failure": "key_1=429"}
        )
        assert res.status_code == 200
        data = res.json()
        assert data["reply"] == "Key 2 response"
        assert data["metadata"]["key_id"] == "key_2"
        assert data["metadata"]["fallback_attempts"] == 1
        assert data["metadata"]["resolution_source"] == "LIVE_INFERENCE"
        assert mock_comp.call_count == 1
        assert mock_comp.call_args.kwargs["api_key"] == "test_key_2"

    # 2. key_1=500 -> key_2 succeeds
    with patch("litellm.completion") as mock_comp:
        mock_comp.return_value = mock_llm_response(content="Key 2 response for 500")

        res = client.post(
            "/chat",
            json={"session_id": "s-failover-2", "message": "test failover 500"},
            headers={"X-Simulate-Failure": "key_1=500"}
        )
        assert res.status_code == 200
        data = res.json()
        assert data["reply"] == "Key 2 response for 500"
        assert data["metadata"]["key_id"] == "key_2"
        assert data["metadata"]["fallback_attempts"] == 1

def test_total_failure_503_nothing_saved():
    with patch("litellm.completion") as mock_comp:
        res = client.post(
            "/chat",
            json={"session_id": "s-total-fail", "message": "fail everything"},
            headers={"X-Simulate-Failure": "*=429"}
        )
        assert res.status_code == 503
        assert res.json() == {"detail": "all providers unavailable"}
        assert mock_comp.call_count == 0

        # Verify nothing was added to DB
        assert get_session("s-total-fail", DB_PATH) is None
        assert len(get_session_messages("s-total-fail", DB_PATH)) == 0
