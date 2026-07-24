"""Native Gemini generateContent + google_search grounding for plan_page.

OpenRouter brokers web search via the `:online` suffix or the `web` plugin;
Google's OpenAI-compatible endpoint does not honour those. When
``LLM_PROVIDER=google`` and ``GOOGLE_GROUNDING_SEARCH=true``, plan_page calls
the native ``/v1beta/models/{model}:generateContent`` endpoint with the
``google_search`` tool instead.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx

from _env import env_flag

from .client import (
    DEFAULT_TEXT_MODEL,
    _JSON_REPAIR_HINT,
    _llm_provider,
    _request_timeout_s,
    _safe_json,
    _safe_log,
)

DEFAULT_GROUNDING_API_BASE = "https://generativelanguage.googleapis.com/v1beta"

_GROUNDING_HTTPX: httpx.AsyncClient | None = None


@dataclass
class GroundingCitation:
    url: str
    title: str | None = None


def _google_grounding_enabled(online: bool) -> bool:
    """True when plan_page should use native Gemini google_search grounding."""
    if not online:
        return False
    if _llm_provider() != "google":
        return False
    return env_flag("GOOGLE_GROUNDING_SEARCH", "false")


def _grounding_api_base() -> str:
    return (
        os.environ.get("GOOGLE_GROUNDING_API_BASE_URL", "").strip()
        or DEFAULT_GROUNDING_API_BASE
    ).rstrip("/")


def _grounding_api_key() -> str:
    key = os.environ.get("LLM_API_KEY", "").strip()
    if not key:
        raise RuntimeError("LLM_API_KEY is not set for GOOGLE_GROUNDING_SEARCH")
    return key


def native_gemini_model(model: str | None = None) -> str:
    """Strip OpenRouter/OpenAI-compat adornments from a planner model slug."""
    base = (
        model
        or os.environ.get("LLM_TEXT_MODEL")
        or os.environ.get("OPENROUTER_TEXT_MODEL")
        or DEFAULT_TEXT_MODEL
    ).strip()
    if base.startswith("google/"):
        base = base[len("google/") :]
    if ":" in base:
        base = base.split(":", 1)[0]
    return base or DEFAULT_TEXT_MODEL


def extract_google_grounding_citations(
    payload: dict[str, Any],
    *,
    max_sources: int = 3,
) -> list[GroundingCitation]:
    """Pull URL citations from Gemini groundingMetadata.groundingChunks."""
    out: list[GroundingCitation] = []
    seen: set[str] = set()

    def _push(url: str | None, title: str | None) -> None:
        if not url or not isinstance(url, str):
            return
        u = url.strip()
        if not u.startswith(("http://", "https://")):
            return
        try:
            domain = urlparse(u).netloc.lower()
        except Exception:
            domain = u
        if domain in seen:
            return
        seen.add(domain)
        clean_title = title.strip() if isinstance(title, str) and title.strip() else None
        out.append(GroundingCitation(url=u, title=clean_title))

    try:
        candidates = payload.get("candidates")
        if not isinstance(candidates, list) or not candidates:
            return out
        meta = candidates[0].get("groundingMetadata") or {}
        chunks = meta.get("groundingChunks") or []
        if isinstance(chunks, list):
            for chunk in chunks:
                if not isinstance(chunk, dict):
                    continue
                web = chunk.get("web") or {}
                if isinstance(web, dict):
                    _push(web.get("uri"), web.get("title"))
                if len(out) >= max_sources:
                    return out
    except Exception:
        return out
    return out


def _response_text(payload: dict[str, Any]) -> str:
    try:
        candidates = payload.get("candidates")
        if not isinstance(candidates, list) or not candidates:
            return ""
        parts = candidates[0].get("content", {}).get("parts") or []
        texts: list[str] = []
        for part in parts:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                texts.append(part["text"])
        return "\n".join(texts).strip()
    except Exception:
        return ""


def _grounding_http_client() -> httpx.AsyncClient:
    global _GROUNDING_HTTPX
    if _GROUNDING_HTTPX is None:
        timeout = _request_timeout_s()
        _GROUNDING_HTTPX = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout, connect=10.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _GROUNDING_HTTPX


def _build_generate_content_body(
    *,
    system: str,
    user: str,
    temperature: float,
    max_tokens: int,
) -> dict[str, Any]:
    return {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "tools": [{"google_search": {}}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
            "responseMimeType": "application/json",
        },
    }


async def _post_generate_content(
    *,
    model: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    url = f"{_grounding_api_base()}/models/{model}:generateContent"
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": _grounding_api_key(),
    }
    client = _grounding_http_client()
    last: Exception | None = None
    for attempt in range(3):
        try:
            resp = await client.post(url, headers=headers, json=body)
            if resp.status_code in (408, 429, 500, 502, 503, 504):
                raise httpx.HTTPStatusError(
                    f"upstream {resp.status_code}",
                    request=resp.request,
                    response=resp,
                )
            resp.raise_for_status()
            data = resp.json()
            if not isinstance(data, dict):
                raise RuntimeError("Gemini grounding response was not a JSON object")
            return data
        except (httpx.TimeoutException, httpx.TransportError, httpx.HTTPStatusError) as err:
            last = err
            if attempt == 2:
                break
            delay = 1.0 * (2**attempt)
            _safe_log(
                "warn",
                "llm.google_grounding.retry",
                error=type(err).__name__,
                attempt=attempt + 1,
                delay=delay,
                model=model,
            )
            await asyncio.sleep(delay)
    assert last is not None
    raise last


async def complete_plan_json_with_google_grounding(
    *,
    model: str,
    system: str,
    user: str,
    temperature: float,
    max_tokens: int,
    span_ctx: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[GroundingCitation]]:
    """Plan via native Gemini + google_search; returns (parsed_json, citations)."""
    native_model = native_gemini_model(model)
    if span_ctx is not None:
        span_ctx["google_grounding"] = True
        span_ctx["native_model"] = native_model
    body = _build_generate_content_body(
        system=system,
        user=user,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    payload = await _post_generate_content(model=native_model, body=body)
    text = _response_text(payload)
    parsed = _safe_json(text or "{}")
    if not parsed and text.strip():
        repair_body = _build_generate_content_body(
            system=f"{system}\n\n{_JSON_REPAIR_HINT}",
            user=user,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        payload = await _post_generate_content(model=native_model, body=repair_body)
        text = _response_text(payload)
        parsed = _safe_json(text or "{}")
    sources = extract_google_grounding_citations(payload)
    return parsed, sources
