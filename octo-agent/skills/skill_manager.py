"""
skills/skill_manager.py
========================
OCTO skill discovery engine — powers the /find-skill voice command.

Searches the bundled DeerFlow skills catalog, formats results for both
voice output (short) and log output (detailed), and can read the full
SKILL.md content on demand.
"""

from __future__ import annotations

import textwrap
from pathlib import Path
import sys

# Resolve paths relative to project root
_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent


def _bridge():
    """Lazy import of deerflow_bridge to avoid circular deps."""
    sys.path.insert(0, str(_ROOT))
    import deerflow_bridge as db
    return db


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def find_skill(query: str, max_results: int = 5) -> dict:
    """
    Search for skills matching *query*.

    Returns::
        {
          "found": int,
          "skills": [{"id", "name", "description"}, ...],
          "voice_summary": str,          # short spoken reply
          "log_detail": str,             # multi-line log output
        }
    """
    db = _bridge()
    results = db.search_skills(query)[:max_results]

    if not results:
        voice = f"I searched for a skill matching '{query}' but found nothing. I can still handle that task directly."
        log   = f"[Skills] No match for query: {query}"
        return {"found": 0, "skills": [], "voice_summary": voice, "log_detail": log}

    names = ", ".join(s["name"] or s["id"] for s in results[:3])
    voice = (
        f"I found {len(results)} skill{'s' if len(results) != 1 else ''} matching '{query}': "
        f"{names}. Check the log panel for details."
    )

    lines = [f"[Skills] Results for '{query}' ({len(results)} found)"]
    for s in results:
        lines.append(f"  • {s['name'] or s['id']}")
        if s.get("description"):
            desc = textwrap.shorten(s["description"], width=90, placeholder="…")
            lines.append(f"    {desc}")
        lines.append(f"    id: {s['id']}")
    log = "\n".join(lines)

    return {
        "found":        len(results),
        "skills":       results,
        "voice_summary": voice,
        "log_detail":   log,
    }


def list_all_skills() -> dict:
    """Return all available skills."""
    db = _bridge()
    all_skills = db.list_local_skills()

    voice = f"I have {len(all_skills)} skills available from DeerFlow: " + \
            ", ".join(s["name"] or s["id"] for s in all_skills[:6])
    if len(all_skills) > 6:
        voice += f", and {len(all_skills) - 6} more."

    lines = [f"[Skills] All available skills ({len(all_skills)} total)"]
    for s in all_skills:
        lines.append(f"  • {s['id']:30s}  {textwrap.shorten(s['description'], 70, placeholder='…')}")

    return {
        "count":         len(all_skills),
        "skills":        all_skills,
        "voice_summary": voice,
        "log_detail":    "\n".join(lines),
    }


def read_skill(skill_id: str) -> dict:
    """
    Read and return the full SKILL.md for a given skill ID.
    Also activates the skill in DeerFlow if it's running.
    """
    db = _bridge()
    content = db.get_skill_content(skill_id)

    if not content:
        return {
            "ok":            False,
            "voice_summary": f"I couldn't find the skill '{skill_id}'. Try /find-skill to search.",
            "content":       "",
        }

    # Send skill content to DeerFlow to activate it for this session
    if db.is_running():
        try:
            db._post("/skills/activate", {"skill_id": skill_id})
        except Exception:
            pass

    voice = f"Skill '{skill_id}' loaded. I'm ready to use it."
    return {
        "ok":            True,
        "skill_id":      skill_id,
        "voice_summary": voice,
        "content":       content,
    }


def install_skill_instructions(skill_id: str) -> str:
    """Return the install instructions for a skill."""
    return (
        f"To install the '{skill_id}' skill globally, run:\n\n"
        f"  npx skills add https://github.com/bytedance/deer-flow --skill {skill_id}\n\n"
        f"Or browse all skills at: https://skills.sh/"
    )
