#!/usr/bin/env bash
# ┌──────────────────────────────────────────────────────────────┐
# │          OCTO-Pro Super Model — Unified Launcher             │
# │  Starts: Voice Loop + Model Proxy + DeerFlow + Hermes        │
# │                                                              │
# │  Unified Repositories Indexed:                               │
# │   - https://github.com/bytedance/deer-flow.git                │
# │   - https://github.com/NousResearch/hermes-agent.git          │
# │   - https://github.com/FatihMakes/Mark-XXXIX.git              │
# │   - https://github.com/Alishahryar1/free-claude-code.git (fcc-server) │
# └──────────────────────────────────────────────────────────────┘
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Prefer uv if available
if command -v uv &>/dev/null; then
    PY="uv run python"
else
    PY="python3"
fi

echo "🐙 OCTO-Pro Monolith starting…"
exec $PY server.py "$@"
