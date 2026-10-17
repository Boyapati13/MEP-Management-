"""
octo_gateway_shim.py
====================
Builds and returns the DeerFlow FastAPI gateway application.
Imports are already rewritten (from app.gateway.* → from gateway.*)
so this shim is now just a clean factory wrapper.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.environ.setdefault("DEER_FLOW_PROJECT_ROOT", str(ROOT))
for _p in [ROOT, ROOT / "deerflow", ROOT / "gateway"]:
    s = str(_p)
    if s not in sys.path:
        sys.path.insert(0, s)


def create_gateway_app():
    """Build and return the DeerFlow FastAPI application."""
    try:
        from gateway.app import create_app  # type: ignore
        return create_app()
    except (ImportError, AttributeError):
        pass

    # Minimal fallback when langgraph deps aren't installed
    try:
        from fastapi import FastAPI
        app = FastAPI(title="OCTO-Pro DeerFlow Gateway (minimal)")

        @app.get("/health")
        async def health():
            return {"status": "ok", "mode": "minimal"}

        @app.get("/api/health")
        async def api_health():
            return {"status": "ok"}

        return app
    except ImportError:
        raise RuntimeError("FastAPI not installed. Run: pip install fastapi uvicorn")
