# Full-Stack AI Chat App

A resilient, multi-turn AI chat application built with FastAPI, SQLite, LiteLLM gateway with automatic key failover and caching, and a React (Vite) frontend served via Nginx.

## Live URLs

- **Backend Live URL**: [https://lyftr-ai-assignement.onrender.com](https://lyftr-ai-assignement.onrender.com)
- **Backend Health Check**: [https://lyftr-ai-assignement.onrender.com/health](https://lyftr-ai-assignement.onrender.com/health)
- **Backend API Docs (Swagger)**: [https://lyftr-ai-assignement.onrender.com/docs](https://lyftr-ai-assignement.onrender.com/docs)
- **Frontend Live URL**: (Insert your Vercel deployment URL here, e.g. `https://lyftr-ai-assignement.vercel.app`)

## Run locally: with Docker and without

### 1. With Docker (Recommended)

Make sure Docker and Docker Compose are installed and running.

```bash
# 1. Copy environment variables
cp .env.example .env

# 2. Build and start containers in detached mode
make up
# or: docker compose up -d --build

# 3. Stop containers and clean up
make down
# or: docker compose down
```

The frontend will be accessible at `http://localhost:3000` and the backend at `http://localhost:8000`. SQLite data persists inside the `sqlite_data` named volume mapped to `/data`.

### 2. Without Docker

#### Backend
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Run migrations/init and start server (falls back gracefully to ./data/app.db if /data is unavailable)
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

#### Frontend
```bash
cd frontend
npm install
npm run dev
```

#### Running Tests
```bash
cd backend
source .venv/bin/activate
pytest tests/ -v
```

## Design decisions: key fallback, caching, SQLite session storage

1. **LiteLLM Gateway & Key Failover Pool**:
   - `LLM_API_KEYS` parses a comma-separated list of at least two keys (`key_1`, `key_2`, etc.).
   - During live inference, requests iterate sequentially through the key pool.
   - When upstream encounters a 429 (rate limit/quota exhaustion), 5xx server errors, or a simulated failure (`X-Simulate-Failure`), it increments `fallback_attempts` and seamlessly fails over to the next configured key.
   - If all providers are exhausted, the API raises HTTP 503 (`{"detail": "all providers unavailable"}`) and rolls back completely—saving nothing to SQLite.

2. **Local Caching Strategy**:
   - Local in-memory cache is enabled via `litellm.cache = Cache(type="local")`.
   - The cache key strictly depends on `model` + the complete messages array (`system_prompt` + message history + user query).
   - Identical queries in new sessions hit the cache (`resolution_source: "LLM_CACHE"`), returning in under 2ms with zero upstream network overhead, `key_id: null`, and `fallback_attempts: 0`.
   - Modifying either the system prompt, history, or message content produces a cache miss (`resolution_source: "LIVE_INFERENCE"`).

3. **SQLite Storage & Graceful Fallback**:
   - Zero heavyweight database dependencies (PostgreSQL/Redis are avoided).
   - If `DATABASE_URL=sqlite:////data/app.db` cannot write to `/data` (e.g. running outside Docker without root), it automatically falls back to `./data/app.db`.
   - SQLite tables `sessions` and `messages` are created automatically on startup.
   - Database operations are atomic: user and assistant message records are written only after a successful LLM response, preventing orphaned queries on failure.

## Verification: how to see failover, cache hits and per-message token usage

1. **See Cache Hits**:
   - Send a prompt in a new session (e.g., "What is the capital of France?"). The first response will show `LIVE_INFERENCE` with `key_1`.
   - Click "New Chat" (or reload) and send the exact same question with the same system prompt. The response arrives instantly with `LLM_CACHE`, `key_id: null`, and `fallback_attempts: 0`.

2. **See Failover**:
   - In the frontend header, select "Simulate key_1=429" from the simulation dropdown, or pass the header `X-Simulate-Failure: key_1=429` via curl.
   - The assistant message metadata shows `key_2` with `fallback_attempts: 1`.
   - Select "Simulate *=429 (Total 503)" or pass `X-Simulate-Failure: *=429`. The request returns `503 all providers unavailable` displayed directly in the chat, with nothing written to the database.

3. **See Token Usage and Latency**:
   - Every assistant message renders a chip metadata bar detailing exact `input_tokens`, `output_tokens`, round-trip `latency_ms`, model identifier, and resolution source.

4. **Automated Verification**:
   - Run `pytest backend/tests/test_api.py -v`. All 7 test suites verify `/health`, 422 validations, 404 session handling, multi-turn history, cache hits, failover simulation, and atomic 503 failure behavior.

## Setup Used: your editor and AI tools

- **Runtime & Toolchain**: Python 3.14/3.11, FastAPI, Uvicorn, LiteLLM, SQLite3, Node.js 22, React 18, Vite 5, Nginx Alpine, Docker & Docker Compose.
- **AI Tooling**: Antigravity AI Agent with parallel command execution, sandboxed automated testing with `pytest`, and container build validation.

## Bonus features (if any): what you added beyond the requirements and why

1. **Interactive Failure Simulation Dropdown**:
   - An in-UI selector allows reviewers and testers to toggle `X-Simulate-Failure` (`key_1=429`, `key_1=500`, `*=429`) on the fly without needing terminal curl commands.
2. **One-Click New Session Reset**:
   - A "New Chat" button immediately rotates the session ID (`s-...`) and resets the thread for convenient testing of multi-session isolation and cache hit behavior.
3. **Live Health & Key Pool Status Indicator**:
   - A reactive pill badge in the header queries `/health` to confirm backend availability, active key pool size, and local cache status in real-time.
4. **Color-Coded Metadata Chips**:
   - Visually distinct chips highlight whether a turn was served from `LLM_CACHE` (green) or `LIVE_INFERENCE` (indigo), displaying token counts and latency clearly.
