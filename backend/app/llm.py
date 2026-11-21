import os
import time
from typing import Dict, Any, List, Optional, Tuple

os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
import litellm
from litellm.caching import Cache
from fastapi import HTTPException

litellm.telemetry = False
litellm.suppress_debug_info = True
litellm.cache = Cache(type="local")
if "cache" not in litellm.input_callback:
    litellm.input_callback.append("cache")
if "cache" not in litellm.success_callback:
    litellm.logging_callback_manager.add_litellm_success_callback("cache")

def parse_simulate_failure_header(header_value: Optional[str]) -> Dict[str, int]:
    if not header_value:
        return {}
    sim_map = {}
    for part in header_value.split(","):
        part = part.strip()
        if "=" in part:
            k, v = part.split("=", 1)
            k = k.strip()
            try:
                status = int(v.strip())
                if status in (429, 500, 502, 503):
                    sim_map[k] = status
            except ValueError:
                pass
    return sim_map

def execute_chat_completion(
    messages: List[Dict[str, str]],
    model: str,
    key_pool: List[Dict[str, str]],
    enable_simulation: bool = True,
    simulate_header: Optional[str] = None
) -> Tuple[str, Dict[str, Any]]:
    start_time = time.time()

    # 1. Check local cache (bypass if simulating failure to allow testing key failover)
    is_simulating = bool(simulate_header and simulate_header.strip()) if enable_simulation else False
    cached = litellm.cache.get_cache(messages=messages, model=model) if not is_simulating else None
    if cached is not None:
        reply = ""
        prompt_tokens = 0
        completion_tokens = 0
        if isinstance(cached, dict):
            choices = cached.get("choices", [])
            if choices:
                reply = choices[0].get("message", {}).get("content", "")
            usage = cached.get("usage", {}) or {}
            prompt_tokens = usage.get("prompt_tokens", 0)
            completion_tokens = usage.get("completion_tokens", 0)
        else:
            reply = cached.choices[0].message.content or ""
            if getattr(cached, "usage", None):
                prompt_tokens = getattr(cached.usage, "prompt_tokens", 0)
                completion_tokens = getattr(cached.usage, "completion_tokens", 0)

        elapsed_ms = max(1, int((time.time() - start_time) * 1000))
        metadata = {
            "resolution_source": "LLM_CACHE",
            "model": model,
            "latency_ms": elapsed_ms,
            "input_tokens": prompt_tokens,
            "output_tokens": completion_tokens,
            "key_id": None,
            "fallback_attempts": 0
        }
        return reply, metadata

    # 2. Iterate keys
    sim_map = parse_simulate_failure_header(simulate_header) if enable_simulation else {}
    fallback_attempts = 0

    for key_entry in key_pool:
        key_id = key_entry["id"]
        api_key = key_entry["key"]

        # Check simulated failure
        sim_status = None
        if enable_simulation:
            if "*" in sim_map:
                sim_status = sim_map["*"]
            elif key_id in sim_map:
                sim_status = sim_map[key_id]

        if sim_status is not None:
            fallback_attempts += 1
            continue

        try:
            response = litellm.completion(
                model=model,
                messages=messages,
                api_key=api_key
            )

            # Check if litellm returned a cache hit
            if getattr(response, "_hidden_params", {}).get("cache_hit"):
                reply = response.choices[0].message.content or ""
                p_tokens = getattr(response.usage, "prompt_tokens", 0) if hasattr(response, "usage") and response.usage else 0
                c_tokens = getattr(response.usage, "completion_tokens", 0) if hasattr(response, "usage") and response.usage else 0
                elapsed_ms = max(1, int((time.time() - start_time) * 1000))
                metadata = {
                    "resolution_source": "LLM_CACHE",
                    "model": model,
                    "latency_ms": elapsed_ms,
                    "input_tokens": p_tokens,
                    "output_tokens": c_tokens,
                    "key_id": None,
                    "fallback_attempts": 0
                }
                return reply, metadata

            reply = response.choices[0].message.content or ""
            p_tokens = getattr(response.usage, "prompt_tokens", 0) if hasattr(response, "usage") and response.usage else 0
            c_tokens = getattr(response.usage, "completion_tokens", 0) if hasattr(response, "usage") and response.usage else 0

            # Store in cache for future hits
            litellm.cache.add_cache(response, messages=messages, model=model)

            elapsed_ms = max(1, int((time.time() - start_time) * 1000))
            metadata = {
                "resolution_source": "LIVE_INFERENCE",
                "model": model,
                "latency_ms": elapsed_ms,
                "input_tokens": p_tokens,
                "output_tokens": c_tokens,
                "key_id": key_id,
                "fallback_attempts": fallback_attempts
            }
            return reply, metadata
        except Exception as e:
            print(f"[LLM Provider Error] {key_id} failed for model {model}: {e}", flush=True)
            fallback_attempts += 1
            continue

    raise HTTPException(status_code=503, detail="all providers unavailable")
