"""
proxy/proxy_path_shim.py
========================
Wires the free-claude-code proxy's internal flat imports so they resolve
correctly when running inside the OCTO monolith (where proxy/ is a sub-package
rather than the repo root).

Import this BEFORE importing anything else from the proxy.

Maps:
  from config.*   → proxy/config_fcc/*
  from core.*     → proxy/core_fcc/*
  from providers.*→ proxy/providers/*
  from messaging.*→ proxy/messaging/*
  from cli.*      → proxy/cli/*
  from api.*      → proxy itself (proxy/ is the 'api' namespace)
"""
from __future__ import annotations

import importlib
import sys
import types
from pathlib import Path

_PROXY_DIR = Path(__file__).resolve().parent

def _ensure_path(p: Path) -> None:
    s = str(p)
    if s not in sys.path:
        sys.path.insert(0, s)

def _alias_package(real_path: Path, alias: str) -> None:
    """Make alias importable by inserting real_path into sys.path and
    registering a sys.modules shim so 'import alias' finds real_path's __init__."""
    _ensure_path(real_path.parent)
    real_name = real_path.name
    # Overwrite sys.modules entry if it doesn't point to our expected real_path
    if alias in sys.modules:
        existing = sys.modules[alias]
        existing_path = getattr(existing, "__file__", "") or ""
        existing_paths = getattr(existing, "__path__", []) or []
        is_correct = (str(real_path) in existing_path or 
                      any(str(real_path) in str(p) for p in existing_paths))
        if is_correct:
            return

    # Try to load the top-level monolith's real package first to preserve its attributes
    real_parent_mod = None
    if alias == "config":
        try:
            # We temporarily put parent of proxy on path to load the real parent config package
            parent_path = str(_PROXY_DIR.parent)
            sys.path.insert(0, parent_path)
            # Remove any existing cached module to force reload of the parent package
            if alias in sys.modules:
                del sys.modules[alias]
            real_parent_mod = importlib.import_module(alias)
        except Exception:
            pass
        finally:
            if str(_PROXY_DIR.parent) in sys.path:
                sys.path.remove(str(_PROXY_DIR.parent))

    # Pre-register a namespace placeholder module in sys.modules so recursive/circular
    # imports like `from config.constants` can resolve while the package is importing.
    mod = types.ModuleType(alias)
    paths = [str(real_path)]
    top_dir = _PROXY_DIR.parent / alias
    if top_dir.exists():
        paths.insert(0, str(top_dir))
    mod.__path__ = paths   # type: ignore[assignment]
    mod.__package__ = alias
    sys.modules[alias] = mod

    try:
        real_mod = importlib.import_module(real_name)
        
        # Copy everything from real_mod to our registered module except the path search list
        for k, v in real_mod.__dict__.items():
            if k != "__path__":
                setattr(mod, k, v)
            
        # Copy over package-level attributes if we preserved a parent module
        if alias == "config" and real_parent_mod is not None:
            for k, v in real_parent_mod.__dict__.items():
                if not k.startswith("__"):
                    setattr(mod, k, v)
                
        # Alias all already-imported sub-modules
        for key in list(sys.modules):
            if key == real_name or key.startswith(real_name + "."):
                new_key = alias + key[len(real_name):]
                sys.modules.setdefault(new_key, sys.modules[key])
    except Exception:
        # Keep the placeholder namespace package if importing fails
        pass

def _alias_self_as(alias: str) -> None:
    """Make the proxy directory importable under 'alias' (e.g. 'api')."""
    if alias in sys.modules:
        return
    mod = types.ModuleType(alias)
    mod.__path__ = [str(_PROXY_DIR)]   # type: ignore[assignment]
    mod.__package__ = alias
    sys.modules[alias] = mod

def setup() -> None:
    """Call once before importing anything from proxy internals."""
    # 1. proxy/ itself must be on path so flat imports (providers, messaging…) work
    _ensure_path(_PROXY_DIR)

    # 2. config → proxy/config_fcc
    _alias_package(_PROXY_DIR / "config_fcc", "config")

    # 3. core → proxy/core_fcc
    _alias_package(_PROXY_DIR / "core_fcc", "core")

    # 4. api → proxy/ itself  (e.g. 'from api.routes import router')
    _alias_self_as("api")

    # 5. providers / messaging / cli / models / web_tools are already in proxy/
    #    so they're importable once proxy/ is on sys.path (step 1).

# Auto-run on import
setup()
