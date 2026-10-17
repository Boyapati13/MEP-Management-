"""
agent/hermes_bridge.py
======================
OCTO extended context engine — powered by embedded Hermes modules.

All Hermes source files were pulled directly into octo/agent/*_hermes.py.
This module re-exports clean aliases so the rest of OCTO never needs to
know where the code came from.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import threading
from pathlib import Path
from typing import Callable, Optional

log = logging.getLogger(__name__)

BASE_DIR    = Path(__file__).resolve().parent.parent
CFG_PATH    = BASE_DIR / "config" / "api_keys.json"
GW_CFG_PATH = BASE_DIR / "config" / "gateway.json"
MEM_DIR     = Path(os.environ.get("USERPROFILE", str(Path.home()))) / ".octo"

# Ensure agent/ is on path so *_hermes imports work
_agent_dir = str(BASE_DIR / "agent")
if _agent_dir not in sys.path:
    sys.path.insert(0, _agent_dir)


# ── Config helpers ────────────────────────────────────────────────────────────

def _api_key() -> str:
    try:
        return json.loads(CFG_PATH.read_text(encoding="utf-8")).get("gemini_api_key", "")
    except Exception:
        return ""


# ── Memory sync ───────────────────────────────────────────────────────────────

def sync_memory() -> None:
    """Export OCTO memory → MEMORY.md for the extended engine."""
    try:
        from memory.memory_manager import load_memory
        memory = load_memory()
        MEM_DIR.mkdir(parents=True, exist_ok=True)
        lines = ["# OCTO User Memory\n\n"]
        for cat, items in memory.items():
            if not isinstance(items, dict) or not items:
                continue
            lines.append(f"## {cat.title()}\n")
            for key, entry in items.items():
                val = entry.get("value") if isinstance(entry, dict) else str(entry)
                if val:
                    lines.append(f"- **{key.replace('_',' ').title()}**: {val}\n")
            lines.append("\n")
        (MEM_DIR / "MEMORY.md").write_text("".join(lines), encoding="utf-8")
    except Exception as e:
        log.debug("Memory sync: %s", e)

# Alias used by main.py scheduler integration
sync_memory_to_hermes = sync_memory


# ── Context compression (Hermes embedded) ─────────────────────────────────────

_compressor      = None
_compressor_lock = threading.Lock()


def get_compressor():
    """Lazy-init the embedded Hermes context compressor."""
    global _compressor
    with _compressor_lock:
        if _compressor is None:
            try:
                # Try the OCTO native one first
                from agent.context_compressor import ContextCompressor
                _compressor = ContextCompressor(context_limit=1_000_000)
                log.info("[Hermes] Native ContextCompressor loaded")
            except Exception:
                try:
                    # Fall back to the pulled-in Hermes version
                    from agent.context_compressor_hermes import ContextCompressor  # type: ignore
                    _compressor = ContextCompressor(context_limit=1_000_000)
                    log.info("[Hermes] Hermes ContextCompressor loaded")
                except Exception as e:
                    log.debug("[Hermes] Compressor unavailable: %s", e)
    return _compressor


def maybe_compress(messages: list, system_prompt: str = "") -> list:
    """Compress message history if needed."""
    try:
        comp = get_compressor()
        if comp and comp.should_compress(messages):
            log.info("[Hermes] Compressing %d messages…", len(messages))
            return comp.compress(messages, system_prompt=system_prompt)
    except Exception as e:
        log.debug("Compression error: %s", e)
    return messages


# ── MCP tools ─────────────────────────────────────────────────────────────────

_mcp_started = False
_mcp_lock    = threading.Lock()


def get_mcp_tools() -> list:
    """Start MCP servers once, return tool list."""
    global _mcp_started
    with _mcp_lock:
        if not _mcp_started:
            try:
                from agent.mcp_bridge import start_all
                result = start_all()
                if result:
                    total = sum(len(v) for v in result.values())
                    log.info("[MCP] %d servers, %d tools", len(result), total)
                _mcp_started = True
            except Exception as e:
                log.debug("[MCP] init: %s", e)
    try:
        from agent.mcp_bridge import get_all_tools
        return get_all_tools()
    except Exception:
        return []


def call_mcp_tool(server_name: str, tool_name: str, arguments: dict) -> str:
    try:
        from agent.mcp_bridge import call_tool
        return call_tool(server_name, tool_name, arguments)
    except Exception as e:
        return f"[MCP] {e}"


# ── Skill utilities (Hermes embedded) ─────────────────────────────────────────

def load_skill_bundle(name: str) -> dict | None:
    """Load a skill bundle by name (Hermes embedded)."""
    try:
        from agent.skill_bundles_hermes import load_bundle  # type: ignore
        return load_bundle(name)
    except Exception:
        return None


def preprocess_skill(content: str, context: dict) -> str:
    """Apply Hermes skill preprocessing."""
    try:
        from agent.skill_preprocessing_hermes import preprocess  # type: ignore
        return preprocess(content, context)
    except Exception:
        return content


# ── Smart router ───────────────────────────────────────────────────────────────

_EXTENDED_KEYWORDS = {
    "terminal", "bash", "script", "execute", "run command", "shell",
    "install package", "pip install", "npm install", "git clone",
    "code execution", "compile", "docker", "schedule", "cron",
    "every day", "every hour", "every week", "at midnight",
    "skill", "delegation", "subagent", "mcp",
}


def should_use_extended(goal: str) -> bool:
    return any(kw in goal.lower() for kw in _EXTENDED_KEYWORDS)


# ── Extended agent executor ───────────────────────────────────────────────────

def run_extended(goal: str, speak: Callable | None = None, max_turns: int = 20) -> str:
    """Run goal through the extended engine (native planner)."""
    threading.Thread(target=sync_memory, daemon=True).start()
    mcp_tools = get_mcp_tools()
    if mcp_tools and speak:
        speak(f"Loading {len(mcp_tools)} MCP tools.")
    return _native_fallback(goal, speak)


def _native_fallback(goal: str, speak: Callable | None = None) -> str:
    try:
        from agent.planner  import create_plan
        from agent.executor import execute_plan
        if speak:
            speak("Using native agent.")
        return execute_plan(create_plan(goal), speak=speak)
    except Exception as e:
        return f"Could not execute task: {e}"


# ── Cron scheduling ───────────────────────────────────────────────────────────

def create_cron_job(prompt: str, schedule: str, label: str = "") -> dict | None:
    """Register a cron job in the scheduler."""
    try:
        from agent.task_queue import get_queue
        q = get_queue()
        job = q.schedule(prompt=prompt, cron=schedule, label=label)
        return job
    except Exception as e:
        log.warning("[Cron] %s", e)
        return None

    hermes_agent_path = str(BASE_DIR / "hermes-agent")
    if hermes_agent_path not in sys.path and Path(hermes_agent_path).exists():
        sys.path.insert(0, hermes_agent_path)


# ── Gateway ───────────────────────────────────────────────────────────────────

import asyncio

_gateway_loop: Optional[asyncio.AbstractEventLoop] = None
_gateway_thread: Optional[threading.Thread] = None
_gateway_lock = threading.Lock()


def _get_running_service():
    """Return ChannelService singleton if already started (e.g. by uvicorn)."""
    try:
        from channels.service import get_channel_service
        return get_channel_service()
    except Exception:
        return None


def _patch_message_bus(bus, on_message: Callable) -> None:
    """Monkey-patch bus.publish_inbound to forward messages to GUI callback."""
    if getattr(bus, "_octo_gui_patched", False):
        return
    original = bus.publish_inbound

    async def _patched(msg):
        await original(msg)
        try:
            on_message(msg.channel_name, msg.user_id, msg.text)
        except Exception:
            pass

    bus.publish_inbound = _patched
    bus._octo_gui_patched = True


def _running_channel_names() -> list[str]:
    svc = _get_running_service()
    if not svc:
        return []
    status = svc.get_status()
    if not status.get("service_running"):
        return []
    return [name for name, info in status.get("channels", {}).items() if info.get("running")]


def get_gateway():
    """Return the singleton ChannelService if running, else None."""
    return _get_running_service()


def start_gateway(on_message: Callable | None = None) -> list:
    """Start the IM channel service and return list of running channel names."""
    global _gateway_loop, _gateway_thread

    # 1. Already running (e.g. started by uvicorn gateway thread)
    svc = _get_running_service()
    if svc and svc.get_status().get("service_running"):
        log.info("[Gateway] ChannelService already running")
        if on_message:
            _patch_message_bus(svc.bus, on_message)
        return _running_channel_names()

    # 2. Start in dedicated background thread
    with _gateway_lock:
        if _gateway_thread is not None and _gateway_thread.is_alive():
            return _running_channel_names()

        loop = asyncio.new_event_loop()
        _gateway_loop = loop

        def _run():
            asyncio.set_event_loop(loop)
            try:
                from channels.service import start_channel_service
                from deerflow.config.app_config import get_app_config
                try:
                    app_config = get_app_config()
                except Exception as e:
                    log.warning("[Gateway] config.yaml not found (%s); starting with empty channels", e)
                    app_config = None

                async def _start():
                    started_svc = await start_channel_service(app_config)
                    if on_message:
                        _patch_message_bus(started_svc.bus, on_message)
                    log.info("[Gateway] ChannelService started: %s", started_svc.get_status())

                loop.run_until_complete(_start())
                loop.run_forever()
            except Exception as exc:
                log.error("[Gateway] background thread failed: %s", exc, exc_info=True)

        _gateway_thread = threading.Thread(target=_run, name="octo-channel-svc", daemon=True)
        _gateway_thread.start()

    # Wait up to 5 s for the service to come up
    import time as _time
    for _ in range(50):
        _time.sleep(0.1)
        svc = _get_running_service()
        if svc and svc.get_status().get("service_running"):
            break

    return _running_channel_names()


def send_via_gateway(channel: str, user_id: str, text: str) -> None:
    """Send an outbound message to a channel via the ChannelService."""
    svc = _get_running_service()
    if not svc:
        return
    try:
        from channels.message_bus import OutboundMessage
        msg = OutboundMessage(
            channel_name=channel,
            chat_id=user_id,
            thread_id="direct",
            text=text,
            is_final=True,
        )
        bus = svc.bus
        # Use the event loop where ChannelService was started (if available)
        loop = getattr(svc, "loop", None) or _gateway_loop
        if loop is None or not loop.is_running():
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                # No running loop, run synchronously
                asyncio.run(bus.publish_outbound(msg))
                return
        asyncio.run_coroutine_threadsafe(bus.publish_outbound(msg), loop)
    except Exception as e:
        log.warning("[Gateway] send_via_gateway: %s", e)


def gateway_status() -> dict:
    """Return the full ChannelService status dict."""
    svc = _get_running_service()
    return svc.get_status() if svc else {}


# ── Backward-compat aliases ───────────────────────────────────────────────────
# task_queue.py calls these names — map them to the new functions above.
should_use_hermes = should_use_extended
run_with_hermes   = run_extended


# ══════════════════════════════════════════════════════════════════════════════
# Gateway config writer
# ══════════════════════════════════════════════════════════════════════════════

def write_gateway_config(cfg: dict) -> None:
    """
    Update active channel configs and restart changed channels.
    cfg format: {"telegram": {"bot_token": "...", "enabled": true}, ...}
    """
    # Persist to env vars so DeerFlow channel drivers pick them up
    for platform, platform_cfg in cfg.items():
        if not isinstance(platform_cfg, dict):
            continue
        prefix = platform.upper()
        for key, val in platform_cfg.items():
            if val and isinstance(val, str):
                os.environ[f"{prefix}_{key.upper()}"] = val

    # Push into running ChannelService and restart affected channels
    svc = _get_running_service()
    if not svc:
        return
    loop = getattr(svc, "loop", None) or _gateway_loop
    if loop is None or not loop.is_running():
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # Run synchronously if no event loop running
            for name, channel_cfg in cfg.items():
                if not isinstance(channel_cfg, dict):
                    continue
                svc._config[name] = {**svc._config.get(name, {}), **channel_cfg}
                asyncio.run(svc.restart_channel(name))
            return

    for name, channel_cfg in cfg.items():
        if not isinstance(channel_cfg, dict):
            continue
        svc._config[name] = {**svc._config.get(name, {}), **channel_cfg}
        asyncio.run_coroutine_threadsafe(svc.restart_channel(name), loop)


# ══════════════════════════════════════════════════════════════════════════════
# Scheduler  (backed by agent/task_queue.py)
# ══════════════════════════════════════════════════════════════════════════════

def _get_queue():
    try:
        from agent.task_queue import get_queue
        return get_queue()
    except Exception:
        return None


def list_scheduled() -> list[dict]:
    """Return all scheduled recurring jobs."""
    q = _get_queue()
    if q is None:
        return []
    try:
        if hasattr(q, "list_scheduled"):
            return q.list_scheduled()
        if hasattr(q, "jobs"):
            return [
                {
                    "id":       str(getattr(j, "id", i)),
                    "prompt":   getattr(j, "prompt", getattr(j, "goal", "")),
                    "schedule": getattr(j, "cron", getattr(j, "schedule", "")),
                    "label":    getattr(j, "label", ""),
                    "enabled":  getattr(j, "enabled", True),
                }
                for i, j in enumerate(q.jobs)
                if getattr(j, "cron", None) or getattr(j, "schedule", None)
            ]
    except Exception as e:
        log.debug("[Scheduler] list_scheduled: %s", e)
    return []


def create_scheduled(prompt: str, schedule: str, label: str = "") -> dict | None:
    """Create a new recurring scheduled task."""
    q = _get_queue()
    if q is None:
        return None
    try:
        # Validate cron expression (5 or 6 parts)
        parts = schedule.strip().split()
        if len(parts) not in (5, 6):
            log.warning("[Scheduler] Invalid cron: %s", schedule)
            return None

        if hasattr(q, "schedule"):
            job = q.schedule(prompt=prompt, cron=schedule, label=label)
            if job:
                return {
                    "id":       str(getattr(job, "id", "new")),
                    "prompt":   prompt,
                    "schedule": schedule,
                    "label":    label,
                    "enabled":  True,
                }
        # Fallback: use APScheduler if available
        try:
            from apscheduler.schedulers.background import BackgroundScheduler
            from apscheduler.triggers.cron import CronTrigger
            import uuid as _uuid

            if not hasattr(create_scheduled, "_scheduler"):
                create_scheduled._scheduler = BackgroundScheduler()
                create_scheduled._scheduler.start()
                create_scheduled._jobs: list = []

            scheduler = create_scheduled._scheduler
            job_id    = str(_uuid.uuid4())[:8]

            def _run_job():
                try:
                    run_extended(prompt)
                except Exception as ex:
                    log.error("[Scheduler] job %s failed: %s", job_id, ex)

            fields = {k: v for k, v in zip(
                ["minute", "hour", "day", "month", "day_of_week"],
                parts[:5]
            )}
            scheduler.add_job(_run_job, CronTrigger(**fields), id=job_id)
            entry = {"id": job_id, "prompt": prompt, "schedule": schedule,
                     "label": label, "enabled": True}
            create_scheduled._jobs.append(entry)
            return entry
        except ImportError:
            log.warning("[Scheduler] apscheduler not installed")
    except Exception as e:
        log.warning("[Scheduler] create_scheduled: %s", e)
    return None


def delete_scheduled(job_id: str) -> bool:
    """Delete a scheduled task by ID."""
    q = _get_queue()
    if q and hasattr(q, "cancel"):
        try:
            q.cancel(job_id)
            return True
        except Exception:
            pass

    # APScheduler fallback
    try:
        scheduler = getattr(create_scheduled, "_scheduler", None)
        if scheduler:
            scheduler.remove_job(job_id)
        jobs: list = getattr(create_scheduled, "_jobs", [])
        create_scheduled._jobs = [j for j in jobs if j.get("id") != job_id]
        return True
    except Exception as e:
        log.debug("[Scheduler] delete_scheduled %s: %s", job_id, e)
    return False
