"""
actions/deep_research.py
=========================
Routes long-horizon research tasks to DeerFlow's LangGraph super-agent.

Falls back to OCTO's native web_search if DeerFlow is not running.
"""

from __future__ import annotations

import threading
from typing import Callable


def deep_research(
    parameters: dict,
    player=None,
    speak: Callable[[str], None] | None = None,
) -> str:
    """
    Execute a deep research task via DeerFlow.

    parameters:
      topic       – what to research (required)
      report_type – "detailed" | "summary" | "bullets" (default: detailed)
      save        – save report to desktop (bool, default: True)
      model       – override DeerFlow model (optional)
    """
    topic       = parameters.get("topic", "").strip()
    report_type = parameters.get("report_type", "detailed").lower()
    save        = parameters.get("save", True)
    model       = parameters.get("model")

    if not topic:
        return "Please specify a research topic."

    def _log(msg: str):
        if player:
            try:
                player.write_log(msg)
            except Exception:
                pass

    _log(f"[DeepResearch] Starting: {topic[:60]}…")

    try:
        import sys
        from pathlib import Path
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from deerflow_bridge import is_running, deep_research as _df_research

        if not is_running():
            _log("[DeepResearch] DeerFlow offline — using native web search fallback")
            return _native_fallback(topic, player, speak)

        _log("[DeepResearch] DeerFlow connected — launching sub-agents…")
        if speak:
            speak(f"Starting deep research on {topic}. This may take a minute — I'll stream progress to the log.")

        progress_lines: list[str] = []

        def _on_progress(chunk: str):
            progress_lines.append(chunk)
            _log(f"[DeepResearch] …{chunk[:80]}")

        report = _df_research(
            topic=topic,
            on_progress=_on_progress,
        )

        if not report:
            return "DeerFlow completed research but returned no content."

        # Format by report_type
        if report_type == "summary":
            # Return first ~500 chars
            report = report[:500].rsplit(" ", 1)[0] + "…"
        elif report_type == "bullets":
            lines = [l for l in report.splitlines() if l.strip()]
            report = "\n".join(f"• {l}" for l in lines[:20])

        # Save to file if requested
        if save:
            _save_report(topic, report, player)

        return report

    except Exception as e:
        _log(f"[DeepResearch] Error: {e}")
        return _native_fallback(topic, player, speak)


def _native_fallback(topic: str, player, speak) -> str:
    """Use OCTO's existing web_search as a fallback."""
    try:
        from actions.web_search import web_search
        return web_search(parameters={"query": topic}, player=player)
    except Exception as e:
        return f"Research on '{topic}' failed: {e}"


def _save_report(topic: str, content: str, player) -> None:
    """Save the research report to the Desktop."""
    try:
        import re
        from pathlib import Path
        safe_name = re.sub(r"[^\w\s-]", "", topic)[:40].strip().replace(" ", "_")
        desktop   = Path.home() / "Desktop"
        desktop.mkdir(parents=True, exist_ok=True)
        out_path  = desktop / f"OCTO_Research_{safe_name}.md"
        out_path.write_text(
            f"# OCTO Deep Research Report\n**Topic:** {topic}\n\n{content}",
            encoding="utf-8"
        )
        if player:
            try:
                player.write_log(f"[DeepResearch] Report saved: {out_path}")
            except Exception:
                pass
    except Exception:
        pass
