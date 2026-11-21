import os
import sqlite3
import json
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from app.config import settings

def resolve_db_path(database_url: str) -> str:
    path = database_url
    if path.startswith("sqlite:////"):
        path = "/" + path[len("sqlite:////"):]
    elif path.startswith("sqlite:///"):
        path = path[len("sqlite:///"):]
    else:
        path = "./data/app.db"

    try:
        dir_name = os.path.dirname(os.path.abspath(path))
        os.makedirs(dir_name, exist_ok=True)
        test_file = os.path.join(dir_name, ".write_test")
        with open(test_file, "w") as f:
            f.write("ok")
        os.remove(test_file)
        return os.path.abspath(path)
    except (OSError, PermissionError):
        fallback_path = os.path.abspath("./data/app.db")
        os.makedirs(os.path.dirname(fallback_path), exist_ok=True)
        return fallback_path

DB_PATH = resolve_db_path(settings.DATABASE_URL)

def get_db_connection(db_path: str = DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def init_db(db_path: str = DB_PATH) -> None:
    with get_db_connection(db_path) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
              session_id TEXT PRIMARY KEY,
              system_prompt TEXT,
              created_at TEXT NOT NULL
            );
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              session_id TEXT NOT NULL,
              role TEXT NOT NULL,
              content TEXT NOT NULL,
              metadata TEXT,
              created_at TEXT NOT NULL
            );
        """)

def get_session(session_id: str, db_path: str = DB_PATH) -> Optional[Dict[str, Any]]:
    with get_db_connection(db_path) as conn:
        row = conn.execute(
            "SELECT session_id, system_prompt, created_at FROM sessions WHERE session_id = ?",
            (session_id,)
        ).fetchone()
        if row:
            return dict(row)
        return None

def get_session_messages(session_id: str, db_path: str = DB_PATH) -> List[Dict[str, Any]]:
    with get_db_connection(db_path) as conn:
        rows = conn.execute(
            "SELECT role, content, metadata FROM messages WHERE session_id = ? ORDER BY id ASC",
            (session_id,)
        ).fetchall()
        return [dict(r) for r in rows]

def save_turn(
    session_id: str,
    system_prompt: Optional[str],
    user_message: str,
    assistant_reply: str,
    assistant_metadata: Dict[str, Any],
    db_path: str = DB_PATH
) -> None:
    now_str = datetime.now(timezone.utc).isoformat()
    with get_db_connection(db_path) as conn:
        existing = conn.execute(
            "SELECT session_id, system_prompt FROM sessions WHERE session_id = ?",
            (session_id,)
        ).fetchone()
        if existing is None:
            conn.execute(
                "INSERT INTO sessions (session_id, system_prompt, created_at) VALUES (?, ?, ?)",
                (session_id, system_prompt, now_str)
            )
        else:
            if system_prompt is not None:
                conn.execute(
                    "UPDATE sessions SET system_prompt = ? WHERE session_id = ?",
                    (system_prompt, session_id)
                )

        conn.execute(
            "INSERT INTO messages (session_id, role, content, metadata, created_at) VALUES (?, 'user', ?, NULL, ?)",
            (session_id, user_message, now_str)
        )
        conn.execute(
            "INSERT INTO messages (session_id, role, content, metadata, created_at) VALUES (?, 'assistant', ?, ?, ?)",
            (session_id, assistant_reply, json.dumps(assistant_metadata), now_str)
        )
        conn.commit()
