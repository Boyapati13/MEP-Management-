# OCTO-Pro — Monolith Integration Guide

> **No external git clones. No separate background processes. One command starts everything.**

---

## What Changed

OCTO-Pro was previously a hub that **pointed at** four external repos running as separate background processes. It is now a **single unified monolith** — all four codebases are pulled directly into this repository and run inside one Python process.

```
Before (external deps):                After (monolith):
  git clone deer-flow        →         octo/deerflow/        (embedded)
  git clone free-claude-code →         octo/proxy/           (embedded)
  git clone hermes-agent     →         octo/agent/*_hermes.py (embedded)
  git clone Mark-XXXIX       →         octo/actions/         (already merged)

  4 terminals / background   →         python server.py       (ONE command)
  processes to manage
```

---

## Repository Structure

```
octo/
│
├── server.py                   ← 🚀 SINGLE ENTRY POINT (start here)
├── octo_gateway_shim.py        ← Path wiring for embedded gateway
├── main.py                     ← Gemini Live voice loop (unchanged)
│
├── proxy/                      ← free-claude-code (model routing proxy)
│   ├── api/                    ←   FastAPI app: /v1/messages intercept
│   ├── providers/              ←   DeepSeek, Kimi, NIM, Ollama, OpenRouter…
│   ├── core_fcc/               ←   Anthropic SSE normalisation
│   ├── config_fcc/             ←   Settings, provider catalog
│   └── messaging/              ←   Telegram/Discord streaming
│
├── deerflow/                   ← deer-flow harness (LangGraph orchestration)
│   ├── agents/                 ←   Lead agent + middlewares
│   ├── config/                 ←   App config, model config, sandbox config
│   ├── community/              ←   Search tools (DDG, Tavily, Serper, Exa…)
│   ├── sandbox/                ←   Local + Docker + K8s sandbox providers
│   ├── skills/                 ←   Skill catalog (agentskills.io)
│   ├── subagents/              ←   Parallel sub-agent execution
│   └── persistence/            ←   SQLite thread/run/memory store
│
├── gateway/                    ← deer-flow gateway (FastAPI + LangGraph API)
│   ├── routers/                ←   /api/runs, /api/threads, /api/skills…
│   ├── auth/                   ←   JWT + local provider
│   └── app.py                  ←   FastAPI app factory
│
├── channels/                   ← deer-flow channels (messaging gateway)
│   ├── manager.py              ←   ChannelManager — routes inbound messages
│   ├── telegram.py             ←   Telegram bot
│   ├── discord.py              ←   Discord bot
│   ├── slack.py                ←   Slack Socket Mode
│   └── …                      ←   WeChat, DingTalk, Feishu, Wecom
│
├── agent/                      ← Core planner/executor + Hermes modules
│   ├── context_compressor_hermes.py   ← Hermes: smart context window compression
│   ├── context_engine_hermes.py       ← Hermes: conversation context engine
│   ├── memory_manager_hermes.py       ← Hermes: FTS5 session search + summarise
│   ├── skill_bundles_hermes.py        ← Hermes: agentskills.io bundle loader
│   ├── skill_commands_hermes.py       ← Hermes: /skill CLI commands
│   ├── error_classifier_hermes.py     ← Hermes: LLM error classification
│   └── hermes_bridge.py              ← Re-exports all Hermes under OCTO API
│
├── actions/                    ← Mark-XXXIX OS actions (already merged)
├── memory/                     ← OCTO persistent memory (JSON + SQLite)
├── skills/                     ← OCTO skill manager
├── deerflow_bridge.py          ← DeerFlow bridge (embedded + HTTP fallback)
└── requirements.txt            ← All deps in one file
```

---

## How the Monolith Boots

```
python server.py
       │
       ├─ Thread: proxy (uvicorn on :8082)
       │    └─ octo/proxy/api/app.py → create_asgi_app()
       │
       ├─ Thread: gateway (uvicorn on :2026)
       │    └─ octo_gateway_shim.py → create_gateway_app()
       │         └─ octo/gateway/app.py (with path aliases wired)
       │
       ├─ Thread: hermes init
       │    └─ agent/hermes_bridge.py → get_compressor(), get_mcp_tools()
       │
       └─ Main: voice loop
            └─ main.py → OctoLive.run()
```

All services share the same Python process, same memory space. No socket connections between components — `deerflow_bridge.py` imports the DeerFlow client directly when the embedded package is available.

---

## Running

### Full stack (voice + all services)
```bash
python server.py
# or
./start_octo_pro.sh
```

### Headless (no UI — for servers)
```bash
python server.py --no-voice
```

### Without a specific service
```bash
python server.py --no-proxy    # skip model proxy
python server.py --no-gateway  # skip DeerFlow gateway
```

### Custom ports
```bash
python server.py --proxy-port 9090 --gateway-port 3000
```

---

## First-Time Setup

```bash
# 1. Install all dependencies
pip install -r requirements.txt

# 2. Install browser automation
playwright install

# 3. Set your Gemini API key
#    Settings → API Keys  (in the UI)
#    or directly edit: config/api_keys.json

# 4. (Optional) Configure model backends
#    Proxy Admin UI → http://127.0.0.1:8082/admin
#    Set ANTHROPIC_API_KEY or any provider key in ~/.fcc/.env

# 5. Launch
python server.py
```

---

## Service Endpoints (all loopback-only by default)

| Service | URL | Purpose |
|---------|-----|---------|
| Model Proxy | `http://127.0.0.1:8082` | Route Claude requests to any backend |
| Proxy Admin UI | `http://127.0.0.1:8082/admin` | Configure providers |
| DeerFlow API | `http://127.0.0.1:2026/api` | LangGraph runs, threads, skills |
| DeerFlow UI  | `http://127.0.0.1:2026` | Monitor agent runs |

---

## Dependency Tiers

Install only what you need:

| Tier | Install | Enables |
|------|---------|---------|
| **Minimal** (voice only) | `pip install sounddevice google-genai PyQt6 playwright` | Voice + OS actions |
| **Standard** | `pip install -r requirements.txt` | Full stack |
| **With local LLMs** | + `ollama` running locally | Haiku-tier routing |
| **With GPU inference** | NVIDIA NIM API key in `~/.fcc/.env` | Opus-tier routing |

---

## How DeerFlow Bridge Works

`deerflow_bridge.py` tries two modes automatically:

```
chat("research topic")
    │
    ├─ if octo/deerflow/ importable → DeerFlowClient().chat(...)   ← ZERO network
    │
    └─ elif localhost:2026 running  → HTTP POST /api/chat          ← local HTTP
```

No external URLs. No cloud dependencies. Everything runs locally.

---

## Hermes Modules

The following Hermes modules were pulled in verbatim under `octo/agent/*_hermes.py`:

| Module | Purpose |
|--------|---------|
| `context_compressor_hermes.py` | Smart context window compression with structured summaries |
| `context_engine_hermes.py` | Full conversation context management |
| `memory_manager_hermes.py` | FTS5 full-text session search + LLM summarisation |
| `memory_provider_hermes.py` | MEMORY.md + USER.md persistent profile |
| `skill_bundles_hermes.py` | agentskills.io bundle discovery and loading |
| `skill_commands_hermes.py` | `/skill` CLI command parsing |
| `skill_preprocessing_hermes.py` | Template preprocessing for skill files |
| `error_classifier_hermes.py` | LLM-powered error classification and retry hints |
| `retry_utils_hermes.py` | Exponential backoff with jitter |
| `redact_hermes.py` | Sensitive data redaction before summarisation |

All accessible via `agent/hermes_bridge.py` using the clean OCTO API.

---

## Updating Upstream Sources

When an upstream repo ships improvements, pull them in with:

```bash
# Update DeerFlow harness
git clone --depth=1 https://github.com/bytedance/deer-flow.git /tmp/deer-flow
cp -r /tmp/deer-flow/backend/packages/harness/deerflow/. octo/deerflow/
cp -r /tmp/deer-flow/backend/app/channels/. octo/channels/
cp -r /tmp/deer-flow/backend/app/gateway/. octo/gateway/

# Update proxy
git clone --depth=1 https://github.com/Alishahryar1/free-claude-code.git /tmp/fcc
cp -r /tmp/fcc/api       octo/proxy/
cp -r /tmp/fcc/providers octo/proxy/
cp -r /tmp/fcc/core      octo/proxy/core_fcc
cp -r /tmp/fcc/config    octo/proxy/config_fcc

git add -A && git commit -m "chore: sync upstream sources"
```
