import json
from contextlib import asynccontextmanager
from typing import Optional, Dict, Any, List
from fastapi import FastAPI, Request, HTTPException, Header
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

from app.config import settings
from app.database import (
    init_db,
    get_session,
    get_session_messages,
    save_turn,
    DB_PATH
)
from app.llm import execute_chat_completion

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db(DB_PATH)
    yield

app = FastAPI(title="AI Chat API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": jsonable_encoder(exc.errors())}
    )

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail}
    )

@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)}
    )

class ChatRequest(BaseModel):
    session_id: str
    message: str
    system_prompt: Optional[str] = None

    @field_validator("session_id")
    @classmethod
    def validate_session_id(cls, v: str) -> str:
        s = v.strip() if isinstance(v, str) else ""
        if not s or len(s) > 128:
            raise ValueError("session_id must be between 1 and 128 characters")
        return s

    @field_validator("message")
    @classmethod
    def validate_message(cls, v: str) -> str:
        s = v.strip() if isinstance(v, str) else ""
        if not s or len(s) > 4000:
            raise ValueError("message must be between 1 and 4000 characters")
        return s

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "keys_configured": len(settings.KEY_POOL),
        "cache_enabled": True
    }

@app.post("/chat")
def chat_endpoint(
    req: ChatRequest,
    x_simulate_failure: Optional[str] = Header(None, alias="X-Simulate-Failure")
):
    session_id = req.session_id
    trimmed_message = req.message

    # Determine existing session & effective system prompt
    existing_session = get_session(session_id, DB_PATH)
    if req.system_prompt is not None and req.system_prompt.strip():
        effective_system_prompt = req.system_prompt.strip()
    elif existing_session and existing_session.get("system_prompt"):
        effective_system_prompt = existing_session["system_prompt"]
    else:
        effective_system_prompt = settings.DEFAULT_SYSTEM_PROMPT

    # Load session history
    history_rows = get_session_messages(session_id, DB_PATH)
    session_history = [{"role": r["role"], "content": r["content"]} for r in history_rows]

    # Build messages array
    messages = [{"role": "system", "content": effective_system_prompt}] + session_history + [{"role": "user", "content": trimmed_message}]

    # Call LLM Gateway
    reply, metadata = execute_chat_completion(
        messages=messages,
        model=settings.LLM_MODEL,
        key_pool=settings.KEY_POOL,
        enable_simulation=settings.ENABLE_FAILURE_SIMULATION,
        simulate_header=x_simulate_failure
    )

    # Save to SQLite only after successful completion
    save_turn(
        session_id=session_id,
        system_prompt=effective_system_prompt,
        user_message=trimmed_message,
        assistant_reply=reply,
        assistant_metadata=metadata,
        db_path=DB_PATH
    )

    return {
        "session_id": session_id,
        "reply": reply,
        "metadata": metadata
    }

@app.get("/sessions/{session_id}/messages")
def get_messages_endpoint(session_id: str):
    existing_session = get_session(session_id, DB_PATH)
    rows = get_session_messages(session_id, DB_PATH)
    if not existing_session and not rows:
        raise HTTPException(status_code=404, detail="session not found")

    result_messages = []
    for r in rows:
        item: Dict[str, Any] = {"role": r["role"], "content": r["content"]}
        if r["role"] == "assistant" and r["metadata"]:
            try:
                meta = json.loads(r["metadata"]) if isinstance(r["metadata"], str) else r["metadata"]
                item["metadata"] = {
                    "resolution_source": meta.get("resolution_source"),
                    "input_tokens": meta.get("input_tokens"),
                    "output_tokens": meta.get("output_tokens")
                }
            except Exception:
                pass
        result_messages.append(item)

    return {
        "session_id": session_id,
        "messages": result_messages
    }
