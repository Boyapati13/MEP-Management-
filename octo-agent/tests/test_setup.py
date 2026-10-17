import os
from pathlib import Path

def test_install_ps1_exists():
    assert os.path.exists("install.ps1")

def test_start_octo_pro_bat_contains_repos():
    with open("start_octo_pro.bat", "r", encoding="utf-8") as f:
        content = f.read()
    assert "https://github.com/bytedance/deer-flow.git" in content
    assert "https://github.com/NousResearch/hermes-agent.git" in content
    assert "https://github.com/FatihMakes/Mark-XXXIX.git" in content
    assert "https://github.com/Alishahryar1/free-claude-code.git" in content
    assert "fcc-server" in content

def test_start_octo_pro_sh_contains_repos():
    with open("start_octo_pro.sh", "r", encoding="utf-8") as f:
        content = f.read()
    assert "https://github.com/bytedance/deer-flow.git" in content
    assert "https://github.com/NousResearch/hermes-agent.git" in content
    assert "https://github.com/FatihMakes/Mark-XXXIX.git" in content
    assert "https://github.com/Alishahryar1/free-claude-code.git" in content
    assert "fcc-server" in content

def test_hermes_bridge_contains_path():
    with open("agent/hermes_bridge.py", "r", encoding="utf-8") as f:
        content = f.read()
    assert 'str(BASE_DIR / "hermes-agent")' in content
