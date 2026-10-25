"""Text LLM router: gemini-3.1-pro-preview first, Ollama fallback."""
from __future__ import annotations

import json
from pathlib import Path

_CFG_PATH          = Path(__file__).parent.parent / "config" / "api_keys.json"
TEXT_MODEL         = "gemini-2.5-flash"   # free-tier quota; override via text_llm_provider
DEFAULT_OLLAMA_URL = "http://localhost:11434"
# Preferred local models — gemma4 first, skip cloud-proxied ones
_OLLAMA_PREFER = [
    "gemma4", "gemma3", "gemma2",
    "llama3.3", "llama3.2", "llama3.1", "llama3",
    "qwen2.5", "mistral", "phi4", "phi3",
]
# Tags that mean the model is cloud-proxied (not truly local)
_CLOUD_TAGS = (":cloud", ":remote", ":api")


def _list_ollama_models_cli() -> list[str]:
    """Run `ollama list` and return model names."""
    try:
        import subprocess
        out = subprocess.check_output(
            ["ollama", "list"], text=True, timeout=6,
            creationflags=0x08000000 if __import__("sys").platform == "win32" else 0,
        )
        models = []
        for line in out.strip().splitlines()[1:]:   # skip header
            parts = line.split()
            if parts:
                models.append(parts[0])
        return models
    except Exception:
        return []


def _detect_ollama_model(base_url: str) -> str:
    """Return the best truly-local Ollama model."""
    # Try CLI first (most reliable)
    installed = _list_ollama_models_cli()

    # Fallback: query REST API
    if not installed:
        try:
            import requests
            r = requests.get(f"{base_url.rstrip('/')}/api/tags", timeout=5)
            r.raise_for_status()
            installed = [m["name"] for m in r.json().get("models", [])]
        except Exception as e:
            import logging
            logging.warning(f"Failed to fetch models from Ollama API: {e}")

    # Filter out cloud-proxied models
    local = [m for m in installed if not any(m.endswith(t) for t in _CLOUD_TAGS)]
    pool  = local if local else installed   # if all are cloud, use them anyway

    for pref in _OLLAMA_PREFER:
        for name in pool:
            if name.lower().startswith(pref.split(":")[0]):
                print(f"[TextLLM] Ollama model selected: {name}")
                return name

    if pool:
        print(f"[TextLLM] Ollama fallback to first available: {pool[0]}")
        return pool[0]

    return "gemma4"


def _cfg() -> dict:
    try:
        return json.loads(_CFG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def ask(
    prompt: str,
    system: str = "",
    image_bytes: bytes | None = None,
    mime_type: str = "image/jpeg",
) -> str:
    """Return a text response, honouring text_llm_provider from config."""
    cfg      = _cfg()
    provider = cfg.get("text_llm_provider", "auto").lower().strip()
    key      = cfg.get("gemini_api_key", "")
    has_key  = bool(key) and key not in ("", "YOUR_GEMINI_API_KEY_HERE")

    if provider == "ollama":
        return _ollama(prompt, system, cfg)

    # gemini-specific model override
    model = TEXT_MODEL
    if provider not in ("auto", "ollama", ""):
        model = provider      # e.g. "gemini-3.1-pro-preview-customtools"

    if provider != "ollama" and has_key:
        try:
            return _gemini(
                prompt,
                system,
                key,
                image_data=(image_bytes, mime_type) if image_bytes else None,
                model=model,
            )
        except Exception as e:
            print(f"[TextLLM] Gemini failed ({e.__class__.__name__}: {e}) — trying Ollama")

    return _ollama(prompt, system, cfg)


def _gemini(
    prompt: str,
    system: str,
    key: str,
    image_data: tuple[bytes, str] | None = None,
    model: str = TEXT_MODEL,
) -> str:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=key)
    parts: list = []
    if image_data:
        parts.append(types.Part.from_bytes(data=image_data[0], mime_type=image_data[1]))
    parts.append(types.Part.from_text(text=prompt))

    cfg = types.GenerateContentConfig(system_instruction=system) if system else None
    resp = client.models.generate_content(
        model=model,
        contents=parts,
        config=cfg,
    )
    return (resp.text or "").strip()


def _ollama(prompt: str, system: str, cfg: dict) -> str:
    import requests

    base  = cfg.get("ollama_base_url", DEFAULT_OLLAMA_URL).rstrip("/")
    model = cfg.get("ollama_model") or _detect_ollama_model(base)
    messages: list[dict] = []
    # Force plain-text responses — some models default to tool/JSON format
    hard_system = (
        "You are OCTO, a helpful AI assistant. "
        "ALWAYS respond in plain natural language. "
        "NEVER return JSON, tool calls, or structured data. "
        "Be concise and direct."
    )
    if system:
        hard_system = hard_system + " " + system
    messages.append({"role": "system", "content": hard_system})
    messages.append({"role": "user", "content": prompt})

    try:
        r = requests.post(
            f"{base}/api/chat",
            json={"model": model, "messages": messages, "stream": False},
            timeout=120,
        )
        r.raise_for_status()
        return r.json()["message"]["content"].strip()
    except Exception as e:
        raise RuntimeError(f"Ollama at {base} failed: {e}") from e
