"""
memory/config_manager.py
========================
OCTO-Pro unified configuration manager.

Handles:
  - Gemini API key       → config/api_keys.json
  - Proxy provider keys  → ~/.fcc/.env  (read by free-claude-code proxy)
  - Gateway settings     → config/gateway.json
  - DeerFlow settings    → config/deerflow.json
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

def get_base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent.parent

BASE_DIR    = get_base_dir()
CONFIG_DIR  = BASE_DIR / "config"
CONFIG_FILE = CONFIG_DIR / "api_keys.json"
GW_FILE     = CONFIG_DIR / "gateway.json"
DF_FILE     = CONFIG_DIR / "deerflow.json"

# Proxy writes to ~/.fcc/.env
FCC_ENV = Path.home() / ".fcc" / ".env"


# ── Internal helpers ──────────────────────────────────────────────────────────

def _ensure_config_dir() -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)

def _load_json(path: Path, default: dict) -> dict:
    if not path.exists():
        return dict(default)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return dict(default)

def _save_json(path: Path, data: dict) -> None:
    _ensure_config_dir()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


# ── ~/.fcc/.env sync ──────────────────────────────────────────────────────────

def _read_fcc_env() -> dict[str, str]:
    """Read ~/.fcc/.env as key=value pairs."""
    if not FCC_ENV.exists():
        return {}
    env: dict[str, str] = {}
    for line in FCC_ENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env

def _write_fcc_env(env: dict[str, str]) -> None:
    """Write key=value pairs to ~/.fcc/.env, preserving comments."""
    FCC_ENV.parent.mkdir(parents=True, exist_ok=True)
    lines = ["# OCTO-Pro proxy environment — managed by OCTO settings\n"]
    for k, v in env.items():
        if v:
            lines.append(f'{k}="{v}"\n')
    FCC_ENV.write_text("".join(lines), encoding="utf-8")

def _set_fcc_key(env_key: str, value: str) -> None:
    env = _read_fcc_env()
    env[env_key] = value
    _write_fcc_env(env)

def _get_fcc_key(env_key: str) -> str:
    return _read_fcc_env().get(env_key, "")


# ── Gemini API key ────────────────────────────────────────────────────────────

def save_api_keys(gemini_api_key: str) -> None:
    _ensure_config_dir()
    data = _load_json(CONFIG_FILE, {})
    data["gemini_api_key"] = gemini_api_key.strip()
    _save_json(CONFIG_FILE, data)

def load_api_keys() -> dict:
    return _load_json(CONFIG_FILE, {})

def get_gemini_key() -> str:
    return load_api_keys().get("gemini_api_key", "")

def is_configured() -> bool:
    key = get_gemini_key()
    return bool(key and len(key) > 15)


# ── Proxy provider keys  (synced → ~/.fcc/.env) ───────────────────────────────

_PROXY_KEY_MAP = {
    # (our name in api_keys.json) → (env var name in ~/.fcc/.env)
    "anthropic_auth_token":  "ANTHROPIC_AUTH_TOKEN",
    "openrouter_api_key":    "OPENROUTER_API_KEY",
    "deepseek_api_key":      "DEEPSEEK_API_KEY",
    "kimi_api_key":          "KIMI_API_KEY",
    "wafer_api_key":         "WAFER_API_KEY",
    "opencode_api_key":      "OPENCODE_API_KEY",
    "zai_api_key":           "ZAI_API_KEY",
    "fireworks_api_key":     "FIREWORKS_API_KEY",
    "nvidia_nim_api_key":    "NVIDIA_NIM_API_KEY",
    "gemini_api_key":        "GEMINI_API_KEY",
    "gemini_trading_api_key":"GEMINI_TRADING_API_KEY",
    "gemini_trading_model":  "GEMINI_TRADING_MODEL",
}

def save_proxy_keys(keys: dict[str, str]) -> None:
    """Save proxy provider keys to api_keys.json AND ~/.fcc/.env AND update os.environ."""
    import os
    data = _load_json(CONFIG_FILE, {})
    fcc  = _read_fcc_env()
    for our_key, env_key in _PROXY_KEY_MAP.items():
        if our_key in keys:
            val = keys[our_key].strip()
            if val:
                data[our_key] = val
                fcc[env_key]  = val
                os.environ[env_key] = val
            else:
                data.pop(our_key, None)
                fcc.pop(env_key, None)
                os.environ.pop(env_key, None)
    _save_json(CONFIG_FILE, data)
    _write_fcc_env(fcc)

def load_proxy_keys() -> dict[str, str]:
    """Load proxy keys from api_keys.json (fallback: ~/.fcc/.env)."""
    stored = _load_json(CONFIG_FILE, {})
    fcc    = _read_fcc_env()
    result = {}
    for our_key, env_key in _PROXY_KEY_MAP.items():
        val = stored.get(our_key) or fcc.get(env_key, "")
        result[our_key] = val
    return result

def get_proxy_key(name: str) -> str:
    return load_proxy_keys().get(name, "")

def sync_proxy_env() -> None:
    """Ensure all stored proxy keys are present in ~/.fcc/.env."""
    save_proxy_keys(load_proxy_keys())


# ── Gateway config ────────────────────────────────────────────────────────────

def save_gateway_config(cfg: dict) -> None:
    _save_json(GW_FILE, cfg)
    # Also update the embedded ChannelManager config
    try:
        from agent.hermes_bridge import write_gateway_config
        write_gateway_config(cfg)
    except Exception:
        pass

def load_gateway_config() -> dict:
    return _load_json(GW_FILE, {})


# ── DeerFlow config ───────────────────────────────────────────────────────────

_DF_DEFAULTS = {
    "mode": "standard",
    "thinking_enabled": False,
    "subagent_enabled": True,
    "search_engine": "ddg",
    "max_plan_iterations": 3,
    "max_step_num": 20,
}

def save_deerflow_config(cfg: dict) -> None:
    data = {**_DF_DEFAULTS, **cfg}
    _save_json(DF_FILE, data)

def load_deerflow_config() -> dict:
    stored = _load_json(DF_FILE, {})
    return {**_DF_DEFAULTS, **stored}


# ── Watchlist persistence ─────────────────────────────────────────────────────

WATCHLIST_FILE = CONFIG_DIR / "watchlist.json"

def load_watchlist() -> list[str]:
    default = ["EURUSD+", "XAUUSD+", "XAUEUR+", "CL-OIL", "BTCUSD"]
    if not WATCHLIST_FILE.exists():
        return default
    try:
        data = json.loads(WATCHLIST_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return [str(x) for x in data]
        return default
    except Exception:
        return default

def save_watchlist(watchlist: list[str]) -> None:
    _ensure_config_dir()
    WATCHLIST_FILE.write_text(json.dumps(watchlist, indent=2, ensure_ascii=False), encoding="utf-8")


# ── Full config dump/load (for Settings UI) ───────────────────────────────────

def load_all_config() -> dict:
    return {
        "gemini_api_key":  get_gemini_key(),
        "proxy":           load_proxy_keys(),
        "gateway":         load_gateway_config(),
        "deerflow":        load_deerflow_config(),
    }

def save_all_config(cfg: dict) -> None:
    if "gemini_api_key" in cfg:
        save_api_keys(cfg["gemini_api_key"])
    if "proxy" in cfg:
        save_proxy_keys(cfg["proxy"])
    if "gateway" in cfg:
        save_gateway_config(cfg["gateway"])
    if "deerflow" in cfg:
        save_deerflow_config(cfg["deerflow"])
