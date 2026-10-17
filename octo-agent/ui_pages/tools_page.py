"""Tools page — enable/disable OCTO capability toolsets."""
from __future__ import annotations
import json
import threading
from pathlib import Path
from PyQt6.QtCore import pyqtSignal, Qt
from PyQt6.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton
from PyQt6.QtGui import QFont
from .base import OctoPage, PRI, ACC2, GREEN, GREEN_D, RED, TEXT_MED, TEXT_DIM, BORDER, PANEL, WHITE

_TOOLS_CFG = Path(__file__).resolve().parent.parent / "config" / "tools_config.json"

_TOOLSETS = [
    ("web",            "🔍", "Web Search & Scraping",      "DuckDuckGo, Exa, Tavily, web scraping"),
    ("browser",        "🌐", "Browser Automation",         "Navigate, click, fill forms, screenshot"),
    ("terminal",       "💻", "Terminal & Processes",        "Run commands, scripts, manage processes"),
    ("file",           "📁", "File Operations",             "Read, write, move, search files"),
    ("code_execution", "⚡", "Code Execution",              "Run Python, JS, bash in sandbox"),
    ("vision",         "👁",  "Vision / Image Analysis",    "Screenshot analysis, describe images"),
    ("memory",         "💾", "Memory",                      "Persistent user memory across sessions"),
    ("skills",         "📚", "Skills",                      "Install and run capability modules"),
    ("todo",           "📋", "Task Planning",               "Break goals into sub-tasks"),
    ("delegation",     "👥", "Task Delegation",             "Spawn sub-agents for parallel work"),
    ("cronjob",        "⏰", "Cron Jobs",                   "Create and manage scheduled tasks"),
    ("messaging",      "📨", "Cross-Platform Messaging",    "Send messages via Telegram, Slack, etc."),
    ("image_gen",      "🎨", "Image Generation",            "Generate images via AI"),
    ("tts",            "🔊", "Text-to-Speech",              "Convert text to audio files"),
    ("homeassistant",  "🏠", "Home Assistant",              "Control smart home devices"),
    ("deerflow",       "🧠", "DeerFlow Orchestration",      "Multi-agent task decomposition"),
    ("deep_research",  "🔬", "Deep Research",               "Long-horizon web crawling + synthesis"),
]

_DEFAULT_ENABLED = {
    "terminal", "file", "code_execution", "memory",
    "todo", "skills", "delegation", "cronjob",
    "web", "browser", "deerflow", "deep_research",
}


def _load_tools_cfg() -> set:
    if not _TOOLS_CFG.exists():
        return set(_DEFAULT_ENABLED)
    try:
        data = json.loads(_TOOLS_CFG.read_text(encoding="utf-8"))
        return set(data.get("enabled", list(_DEFAULT_ENABLED)))
    except Exception:
        return set(_DEFAULT_ENABLED)


def _save_tools_cfg(enabled: set) -> None:
    _TOOLS_CFG.parent.mkdir(parents=True, exist_ok=True)
    _TOOLS_CFG.write_text(
        json.dumps({"enabled": sorted(enabled)}, indent=2),
        encoding="utf-8"
    )


class ToolsPage(OctoPage):
    _status_sig = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._status_sig.connect(self._on_status)
        self._toggle_btns: dict[str, QPushButton] = {}
        self._enabled: set = _load_tools_cfg()
        self._status_lbl = None
        self._build()

    def _build(self):
        lay = self.page_layout()

        hdr = QHBoxLayout()
        hdr.addWidget(self.lbl("◈  OCTO CAPABILITIES", 11, bold=True, color=PRI))
        hdr.addStretch()
        lay.addLayout(hdr)

        lay.addWidget(self.lbl(
            "Enable or disable tool categories for OCTO's agent.",
            7, color=TEXT_DIM))
        self._status_lbl = self.lbl("", 7, color=GREEN)
        lay.addWidget(self._status_lbl)
        lay.addWidget(self.sep())

        # Grid of tool cards (2 per row)
        row_widgets: list = []
        for tid, icon, name, desc in _TOOLSETS:
            row_widgets.append(self._tool_card(tid, icon, name, desc))

        for i in range(0, len(row_widgets), 2):
            hr = QHBoxLayout(); hr.setSpacing(8)
            hr.addWidget(row_widgets[i], stretch=1)
            if i + 1 < len(row_widgets):
                hr.addWidget(row_widgets[i + 1], stretch=1)
            else:
                hr.addStretch(1)
            lay.addLayout(hr)

        lay.addWidget(self.sep())
        btn_row = QHBoxLayout()
        enable_all = self.btn("✓ Enable All", color=GREEN, height=30)
        enable_all.clicked.connect(self._enable_all)
        disable_all = self.btn("✕ Disable All", color=RED, height=30)
        disable_all.clicked.connect(self._disable_all)
        save_b = self.btn("▸  SAVE CONFIG", color=PRI, height=30)
        save_b.clicked.connect(self._save)
        btn_row.addWidget(enable_all)
        btn_row.addWidget(disable_all)
        btn_row.addStretch()
        btn_row.addWidget(save_b)
        lay.addLayout(btn_row)
        lay.addStretch()

    def _tool_card(self, tid: str, icon: str, name: str, desc: str) -> QWidget:
        enabled = tid in self._enabled
        card = QWidget()
        card.setStyleSheet(f"background:{PANEL};border:1px solid {BORDER};border-radius:4px;")
        cl = QHBoxLayout(card); cl.setContentsMargins(10, 8, 10, 8); cl.setSpacing(8)

        icon_l = QLabel(icon)
        icon_l.setFont(QFont("Courier New", 14))
        icon_l.setStyleSheet(f"color:{ACC2};background:transparent;border:none;")
        icon_l.setFixedWidth(24)
        cl.addWidget(icon_l)

        info = QVBoxLayout(); info.setSpacing(1)
        info.addWidget(self.lbl(name, 8, bold=True, color=WHITE))
        info.addWidget(self.lbl(desc, 7, color=TEXT_DIM))
        cl.addLayout(info, stretch=1)

        tog = QPushButton("ON" if enabled else "OFF")
        tog.setFixedSize(44, 24)
        tog.setFont(QFont("Courier New", 7, QFont.Weight.Bold))
        tog.setCursor(Qt.CursorShape.PointingHandCursor)
        self._update_tog_style(tog, enabled)
        tog.clicked.connect(lambda _, t=tid, b=tog: self._toggle(t, b))
        cl.addWidget(tog)
        self._toggle_btns[tid] = tog
        return card

    def _update_tog_style(self, btn: QPushButton, on: bool):
        if on:
            btn.setText("ON")
            btn.setStyleSheet(f"""QPushButton{{background:{GREEN_D};color:#001a0a;
                border:none;border-radius:3px;font-weight:bold;}}""")
        else:
            btn.setText("OFF")
            btn.setStyleSheet(f"""QPushButton{{background:{PANEL};color:{TEXT_DIM};
                border:1px solid {BORDER};border-radius:3px;}}
                QPushButton:hover{{color:{PRI};border-color:{PRI};}}""")

    def _toggle(self, tid: str, btn: QPushButton):
        if tid in self._enabled:
            self._enabled.discard(tid)
            self._update_tog_style(btn, False)
        else:
            self._enabled.add(tid)
            self._update_tog_style(btn, True)

    def _enable_all(self):
        for tid, btn in self._toggle_btns.items():
            self._enabled.add(tid)
            self._update_tog_style(btn, True)

    def _disable_all(self):
        for tid, btn in self._toggle_btns.items():
            self._enabled.discard(tid)
            self._update_tog_style(btn, False)

    def _on_status(self, msg: str):
        if self._status_lbl:
            self._status_lbl.setText(msg)

    def _save(self):
        _save_tools_cfg(self._enabled)
        # Propagate to MCP bridge tool filter
        try:
            from agent.mcp_bridge import set_enabled_toolsets
            set_enabled_toolsets(self._enabled)
        except Exception:
            pass
        self._status_sig.emit(f"✓ Saved {len(self._enabled)} enabled toolsets.")
