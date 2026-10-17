"""
OCTO CLI — terminal interface, same brain as the desktop app.

Usage:
    py octo_cli.py              # interactive REPL
    py octo_cli.py "do X"       # one-shot
    py octo_cli.py --hermes     # launch Hermes with OCTO identity (full 40+ tools)
"""
from __future__ import annotations

import logging
import json
import sys
import os
from pathlib import Path

# Windows cp1252 terminals can't print emoji/box-drawing chars — force UTF-8.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BASE_DIR = Path(__file__).resolve().parent

# ── Config ────────────────────────────────────────────────────────────────────
def _cfg() -> dict:
    try:
        return json.loads((BASE_DIR / "config" / "api_keys.json").read_text(encoding="utf-8"))
    except Exception:
        return {}

def _prompt_txt() -> str:
    try:
        return (BASE_DIR / "core" / "prompt.txt").read_text(encoding="utf-8")
    except Exception:
        return "You are OCTO, a professional AI assistant. Be concise and direct."

SYSTEM = (
    "You are OCTO — a powerful desktop AI assistant running in CLI mode.\n"
    "You have access to the user's computer and can help with any task.\n\n"
    + _prompt_txt()
)

# ── Colours ───────────────────────────────────────────────────────────────────
def _c(code: str, text: str) -> str:
    if sys.platform == "win32" and not os.environ.get("TERM"):
        return text
    return f"\033[{code}m{text}\033[0m"

CYAN   = lambda t: _c("96", t)
YELLOW = lambda t: _c("93", t)
GREEN  = lambda t: _c("92", t)
DIM    = lambda t: _c("2",  t)
RED    = lambda t: _c("91", t)
BOLD   = lambda t: _c("1",  t)

# ── History ───────────────────────────────────────────────────────────────────
_history: list[dict] = []

def _ask(user_text: str) -> str:
    from core import text_llm
    _history.append({"role": "user", "content": user_text})
    ctx = "\n".join(
        f"{'User' if m['role'] == 'user' else 'OCTO'}: {m['content']}"
        for m in _history[-12:]
    )
    system = SYSTEM + (f"\n\nConversation history:\n{ctx}" if len(_history) > 1 else "")
    response = text_llm.ask(user_text, system=system)
    _history.append({"role": "assistant", "content": response})
    return response

# ── Agent task via executor ───────────────────────────────────────────────────
def _agent_task(goal: str) -> str:
    from agent.executor import AgentExecutor
    executor = AgentExecutor()
    return executor.execute(goal=goal, speak=lambda t: print(CYAN(f"  → {t}")))

# ── Hermes launch ─────────────────────────────────────────────────────────────
def _launch_hermes(goal: str | None = None) -> None:
    import subprocess
    hermes = Path(sys.executable).parent / "hermes.exe"
    if not hermes.exists():
        hermes = Path(sys.executable).parent / "Scripts" / "hermes.exe"

    # Write OCTO identity as context file for Hermes
    ctx_file = Path(os.environ.get("USERPROFILE", "~")) / ".hermes" / "CONTEXT.md"
    ctx_file.write_text(
        f"# OCTO Agent\n\n{_prompt_txt()}\n\n"
        "You are running as OCTO in CLI mode. Be concise and action-oriented.\n",
        encoding="utf-8",
    )

    cmd = [str(hermes), "chat", "-m", "gemini-2.5-flash", "--yolo"]
    if goal:
        cmd += ["-q", goal, "-Q", "--max-turns", "10"]

    subprocess.run(cmd)

# ── REPL ──────────────────────────────────────────────────────────────────────
_COMMANDS = {
    "/help":    "Show this help",
    "/agent X": "Run goal X through the full agent executor (multi-step tools)",
    "/hermes":  "Switch to Hermes CLI (full 40+ tool suite)",
    "/hermes X":"Run X in Hermes one-shot",
    "/history": "Show conversation history",
    "/clear":   "Clear conversation history",
    "/config":  "Show current config",
    "/quit":    "Exit",
}

def _print_help():
    print(CYAN("\n  OCTO CLI commands:"))
    for cmd, desc in _COMMANDS.items():
        print(f"  {BOLD(cmd):<20} {DIM(desc)}")
    print()

def _print_banner():
    print(CYAN("""
  ██████╗  ██████╗████████╗ ██████╗
  ██╔═══██╗██╔════╝╚══██╔══╝██╔═══██╗
  ██║   ██║██║        ██║   ██║   ██║
  ██║   ██║██║        ██║   ██║   ██║
  ╚██████╔╝╚██████╗   ██║   ╚██████╔╝
   ╚═════╝  ╚═════╝   ╚═╝    ╚═════╝
"""))
    cfg = _cfg()
    provider = cfg.get("text_llm_provider", "gemini-2.5-flash")
    print(f"  {DIM('Voice:')} {GREEN('Gemini Live')}   "
          f"{DIM('Agent LLM:')} {GREEN(provider)}")
    print(f"  {DIM('Type')} {BOLD('/help')} {DIM('for commands or just chat.')}\n")

def repl():
    _print_banner()
    while True:
        try:
            user = input(YELLOW("You › ")).strip()
        except (EOFError, KeyboardInterrupt):
            print(f"\n{DIM('Goodbye, sir.')}")
            break

        if not user:
            continue

        if user in ("/quit", "/exit", "exit", "quit"):
            print(DIM("Goodbye, sir."))
            break

        elif user == "/help":
            _print_help()

        elif user == "/history":
            if not _history:
                print(DIM("  No history yet."))
            for m in _history:
                label = YELLOW("You:") if m["role"] == "user" else CYAN("OCTO:")
                print(f"  {label} {m['content'][:120]}")
            print()

        elif user == "/clear":
            _history.clear()
            print(GREEN("  History cleared."))

        elif user == "/config":
            cfg = _cfg()
            print(f"  {DIM('Live model:')}  {cfg.get('live_model', 'N/A')}")
            print(f"  {DIM('Agent LLM:')}   {cfg.get('text_llm_provider', 'gemini-2.5-flash')}")
            print(f"  {DIM('Ollama URL:')}  {cfg.get('ollama_base_url', 'N/A')}\n")

        elif user == "/hermes":
            print(DIM("  Launching Hermes CLI (Ctrl+C to return)…"))
            _launch_hermes()

        elif user.startswith("/hermes "):
            goal = user[8:].strip()
            print(DIM(f"  Running in Hermes: {goal}"))
            _launch_hermes(goal)

        elif user.startswith("/agent "):
            goal = user[7:].strip()
            if not goal:
                print(RED("  Usage: /agent <goal>"))
                continue
            print(DIM(f"  Running agent task: {goal}"))
            try:
                result = _agent_task(goal)
                print(f"\n{CYAN('OCTO:')} {result}\n")
            except Exception as e:
                print(RED(f"  Agent error: {e}"))

        else:
            print(DIM("  OCTO is thinking…"), end="\r")
            try:
                response = _ask(user)
                print(f"  {' ' * 20}\r{CYAN('OCTO:')} {response}\n")
            except Exception as e:
                print(RED(f"  Error: {e}"))

# ── Auto-update ───────────────────────────────────────────────────────────────
def _auto_update():
    import subprocess
    try:
        before = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=BASE_DIR, capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        subprocess.run(
            ["git", "pull", "--ff-only"],
            cwd=BASE_DIR, capture_output=True, timeout=15,
        )
        after = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=BASE_DIR, capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        if before and after and before != after:
            print(f"[OCTO] Code updated ({before[:7]} → {after[:7]}) — restarting...")
            os.execv(sys.executable, [sys.executable] + sys.argv)
    except Exception as e:
        logging.warning(f"Auto-update failed: {e}")


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    _auto_update()
    # Ensure OCTO package is on path
    sys.path.insert(0, str(BASE_DIR))

    args = sys.argv[1:]

    if "--hermes" in args:
        goal = " ".join(a for a in args if a != "--hermes") or None
        _launch_hermes(goal)

    elif args:
        # One-shot mode
        sys.path.insert(0, str(BASE_DIR))
        goal = " ".join(args)
        print(DIM(f"OCTO: {goal}"))
        try:
            print(_ask(goal))
        except Exception as e:
            print(RED(f"Error: {e}"), file=sys.stderr)
            sys.exit(1)

    else:
        repl()
