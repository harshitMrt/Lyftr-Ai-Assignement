import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    root_env = Path(__file__).resolve().parent.parent.parent / ".env"
    if root_env.exists():
        load_dotenv(dotenv_path=root_env)
    else:
        load_dotenv()
except ImportError:
    pass

class Config:
    def __init__(self):
        raw_keys = os.getenv("LLM_API_KEYS", "your_key_1,your_key_2")
        self.KEY_POOL = [
            {"id": f"key_{i+1}", "key": k.strip()}
            for i, k in enumerate(raw_keys.split(","))
            if k.strip()
        ]
        self.LLM_MODEL = os.getenv("LLM_MODEL", "gemini/gemini-2.0-flash")
        self.DEFAULT_SYSTEM_PROMPT = os.getenv(
            "DEFAULT_SYSTEM_PROMPT", "You are a helpful assistant."
        )
        self.DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:////data/app.db")
        raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
        self.ALLOWED_ORIGINS = [
            o.strip() for o in raw_origins.split(",") if o.strip()
        ]
        self.ENABLE_FAILURE_SIMULATION = (
            os.getenv("ENABLE_FAILURE_SIMULATION", "true").lower() == "true"
        )

settings = Config()
