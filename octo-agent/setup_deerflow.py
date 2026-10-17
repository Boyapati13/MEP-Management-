#!/usr/bin/env python3
"""
setup_deerflow.py
=================
OCTO-Pro Monolith — first-time setup wizard.

All components (DeerFlow, free-claude-code proxy, Hermes) are already
bundled inside this repository. No external git clones needed.

What this does:
  1. Checks Python version and key dependencies
  2. Installs requirements.txt
  3. Runs playwright install
  4. Guides you through setting your Gemini API key
  5. Optionally creates Windows / macOS launch shortcuts
  6. Validates that the monolith can import correctly
"""

import json
import os
import platform
import subprocess
import sys
from pathlib import Path

ROOT        = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config" / "api_keys.json"

RED   = "\033[91m"
GREEN = "\033[92m"
CYAN  = "\033[96m"
YELLOW = "\033[93m"
RESET = "\033[0m"

def log(msg):    print(f"{CYAN}[Setup]{RESET}  {msg}")
def ok(msg):     print(f"{GREEN}[  OK]{RESET}  {msg}")
def warn(msg):   print(f"{YELLOW}[WARN]{RESET}  {msg}")
def err(msg):    print(f"{RED}[FAIL]{RESET}  {msg}")
def section(t):  print(f"\n{CYAN}{'─'*55}\n  {t}\n{'─'*55}{RESET}")


# ── Checks ────────────────────────────────────────────────────────────────────

def check_python():
    section("Python version")
    vi = sys.version_info
    if vi < (3, 11):
        err(f"Python 3.11+ required, got {vi.major}.{vi.minor}")
        sys.exit(1)
    ok(f"Python {vi.major}.{vi.minor}.{vi.micro}")


def check_structure():
    section("Monolith structure")
    required = [
        ROOT / "server.py",
        ROOT / "main.py",
        ROOT / "proxy" / "app.py",
        ROOT / "proxy" / "proxy_path_shim.py",
        ROOT / "deerflow" / "__init__.py",
        ROOT / "gateway" / "__init__.py",
        ROOT / "channels" / "__init__.py",
        ROOT / "agent" / "hermes_bridge.py",
        ROOT / "deerflow_bridge.py",
    ]
    all_ok = True
    for p in required:
        if p.exists():
            ok(str(p.relative_to(ROOT)))
        else:
            err(f"MISSING: {p.relative_to(ROOT)}")
            all_ok = False
    if not all_ok:
        warn("Some files missing — try re-running: git pull")
    return all_ok


def install_requirements():
    section("Installing dependencies")
    req = ROOT / "requirements.txt"
    if not req.exists():
        err("requirements.txt not found"); return
    log("Running: pip install -r requirements.txt …")
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "-r", str(req), "--quiet"],
        cwd=ROOT
    )
    if result.returncode == 0:
        ok("Dependencies installed")
    else:
        warn("Some packages failed — check output above")


def install_playwright():
    section("Playwright (vision layer)")
    result = subprocess.run(
        [sys.executable, "-m", "playwright", "install", "--with-deps", "chromium"],
        cwd=ROOT
    )
    if result.returncode == 0:
        ok("Playwright Chromium installed")
    else:
        warn("Playwright install failed — browser vision will not work")


def setup_api_key():
    section("Gemini API key")
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    existing = {}
    if CONFIG_PATH.exists():
        try:
            existing = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass

    current_key = existing.get("gemini_api_key", "")
    if current_key and len(current_key) > 10:
        ok(f"Key already set: {current_key[:8]}…")
        change = input("  Change it? [y/N] ").strip().lower()
        if change != "y":
            return

    print(f"\n  Get a free key at: {CYAN}https://aistudio.google.com/app/apikey{RESET}")
    key = input("  Paste your Gemini API key: ").strip()
    if not key:
        warn("No key entered — skipping")
        return

    existing["gemini_api_key"] = key
    CONFIG_PATH.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    ok("API key saved to config/api_keys.json")


def create_shortcuts():
    section("Launch shortcuts")
    plat = platform.system()

    if plat == "Windows":
        bat = ROOT / "LAUNCH_OCTO.bat"
        bat.write_text(
            f'@echo off\ncd /d "{ROOT}"\npython server.py\npause\n',
            encoding="utf-8"
        )
        ok(f"Windows launcher: {bat}")

    elif plat == "Darwin":
        sh = ROOT / "LAUNCH_OCTO.command"
        sh.write_text(
            f'#!/bin/bash\ncd "{ROOT}"\npython3 server.py\n',
            encoding="utf-8"
        )
        sh.chmod(0o755)
        ok(f"macOS launcher: {sh}")

    else:
        sh = ROOT / "LAUNCH_OCTO.sh"
        sh.write_text(
            f'#!/usr/bin/env bash\ncd "{ROOT}"\npython3 server.py\n',
            encoding="utf-8"
        )
        sh.chmod(0o755)
        ok(f"Linux launcher: {sh}")


def validate_imports():
    section("Import validation")
    tests = [
        ("Core voice loop",          "import main"),
        ("Agent planner",            "from agent.planner import create_plan"),
        ("Agent executor",           "from agent.executor import AgentExecutor"),
        ("DeerFlow bridge",          "from deerflow_bridge import is_running"),
        ("Hermes bridge",            "from agent.hermes_bridge import get_compressor"),
        ("MCP bridge",               "from agent.mcp_bridge import list_servers"),
        ("Memory manager",           "from memory.memory_manager import load_memory"),
        ("Proxy path shim",          "from proxy.proxy_path_shim import setup"),
        ("Channels package",         "from channels import Channel"),
        ("Gateway shim",             "from octo_gateway_shim import create_gateway_app"),
    ]

    sys.path.insert(0, str(ROOT))
    pass_count = 0
    for label, stmt in tests:
        try:
            exec(stmt, {})   # noqa: S102
            ok(f"{label}")
            pass_count += 1
        except ImportError as e:
            warn(f"{label}: {e}")
        except Exception as e:
            warn(f"{label}: {e}")

    print(f"\n  {pass_count}/{len(tests)} imports OK")
    return pass_count == len(tests)


def print_summary():
    section("Setup complete")
    print(f"""
  {GREEN}Start OCTO-Pro:{RESET}

    {CYAN}python server.py{RESET}              # full stack (voice + proxy + gateway)
    {CYAN}python server.py --no-voice{RESET}   # headless (servers only)

  {GREEN}Services:{RESET}
    Model proxy   → http://127.0.0.1:8082
    DeerFlow API  → http://127.0.0.1:2026/api
    Admin UI      → http://127.0.0.1:8082/admin
""")


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"\n{CYAN}{'═'*55}")
    print("   🐙  OCTO-Pro Monolith — Setup Wizard")
    print(f"{'═'*55}{RESET}\n")

    check_python()
    check_structure()

    do_install = input("\nInstall/update dependencies? [Y/n] ").strip().lower()
    if do_install != "n":
        install_requirements()

    do_pw = input("Install Playwright browser? [Y/n] ").strip().lower()
    if do_pw != "n":
        install_playwright()

    setup_api_key()
    create_shortcuts()
    validate_imports()
    print_summary()
