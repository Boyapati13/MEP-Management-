"""
actions/deerflow_task.py
=========================
Submit an arbitrary long-horizon task to DeerFlow's LangGraph super-agent.

Unlike deep_research (which is domain-specific), this is the general-purpose
bridge for any task that benefits from DeerFlow's sub-agent orchestration,
sandboxed code execution, and skill-augmented reasoning.
"""

from __future__ import annotations

from typing import Callable


def deerflow_task(
    parameters: dict,
    player=None,
    speak: Callable[[str], None] | None = None,
) -> str:
    """
    Submit a task to DeerFlow's agent runtime.

    parameters:
      goal        – what to accomplish (required)
      mode        – "flash" | "standard" | "pro" | "ultra" (default: standard)
                    flash=fast, standard=balanced, pro=planning, ultra=sub-agents
      model       – override model name (optional)
      save        – save result to Desktop as .md (bool, default: False)
    """
    goal  = parameters.get("goal", "").strip()
    mode  = parameters.get("mode", "standard").lower()
    model = parameters.get("model")
    save  = parameters.get("save", False)

    if not goal:
        return "Please specify a task goal."

    def _log(msg: str):
        if player:
            try:
                player.write_log(msg)
            except Exception:
                pass

    _log(f"[DeerFlow] Submitting task: {goal[:80]}…")

    try:
        import sys
        from pathlib import Path
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from deerflow_bridge import is_running, chat, deep_research

        if not is_running():
            _log("[DeerFlow] Backend offline — falling back to OCTO native agent")
            return _native_fallback(goal, player, speak)

        # Map mode to DeerFlow options
        thinking  = mode in ("pro", "ultra")
        subagents = mode == "ultra"

        if speak:
            mode_desc = {
                "flash":    "quickly",
                "standard": "with balanced depth",
                "pro":      "with planning mode",
                "ultra":    "with full sub-agent orchestration",
            }.get(mode, "")
            speak(f"I'll handle that {mode_desc} via DeerFlow, sir.")

        if mode in ("pro", "ultra"):
            result = deep_research(goal, on_progress=lambda c: _log(f"[DeerFlow] …{c[:80]}"))
        else:
            result = chat(goal, model=model, thinking=thinking, subagents=subagents)

        if save and result:
            _save_result(goal, result, player)

        _log(f"[DeerFlow] Task complete ({len(result)} chars)")
        return result or "Task completed — no text output."

    except Exception as e:
        _log(f"[DeerFlow] Task error: {e}")
        return _native_fallback(goal, player, speak)


def _native_fallback(goal: str, player, speak) -> str:
    try:
        from agent.task_queue import get_queue, TaskPriority
        task_id = get_queue().submit(goal=goal, priority=TaskPriority.NORMAL, speak=speak)
        return f"Task submitted to OCTO native agent (ID: {task_id})."
    except Exception as e:
        return f"Task '{goal[:40]}' failed: {e}"


def _save_result(goal: str, content: str, player) -> None:
    try:
        import re
        from pathlib import Path
        safe = re.sub(r"[^\w\s-]", "", goal)[:40].strip().replace(" ", "_")
        out  = Path.home() / "Desktop" / f"OCTO_Task_{safe}.md"
        out.write_text(f"# OCTO Task Result\n**Goal:** {goal}\n\n{content}", encoding="utf-8")
        if player:
            try:
                player.write_log(f"[DeerFlow] Result saved: {out}")
            except Exception:
                pass
    except Exception:
        pass
