"""MCP page — connect any MCP server for extended OCTO capabilities."""
from __future__ import annotations
import json
import threading
from pathlib import Path
from PyQt6.QtCore import pyqtSignal, Qt
from PyQt6.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QLineEdit
from PyQt6.QtGui import QFont
from .base import OctoPage, PRI, ACC2, GREEN, GREEN_D, RED, TEXT_MED, TEXT_DIM, BORDER, PANEL, WHITE

_MCP_CFG = Path(__file__).resolve().parent.parent / "config" / "mcp_servers.json"

_POPULAR_MCP = [
    ("filesystem",   "npx -y @modelcontextprotocol/server-filesystem",   "Local file system access"),
    ("github",       "npx -y @modelcontextprotocol/server-github",        "GitHub repos, issues, PRs"),
    ("postgres",     "npx -y @modelcontextprotocol/server-postgres",      "PostgreSQL database queries"),
    ("brave-search", "npx -y @modelcontextprotocol/server-brave-search",  "Web search via Brave"),
    ("puppeteer",    "npx -y @modelcontextprotocol/server-puppeteer",     "Browser automation"),
    ("memory",       "npx -y @modelcontextprotocol/server-memory",        "Persistent knowledge graph"),
    ("slack",        "npx -y @modelcontextprotocol/server-slack",         "Slack workspace integration"),
    ("google-maps",  "npx -y @modelcontextprotocol/server-google-maps",   "Maps & location data"),
]


def _load_mcp_json() -> list:
    if not _MCP_CFG.exists():
        return []
    try:
        data = json.loads(_MCP_CFG.read_text(encoding="utf-8"))
        return data.get("servers", data) if isinstance(data, dict) else data
    except Exception:
        return []

def _save_mcp_json(servers: list) -> None:
    _MCP_CFG.parent.mkdir(parents=True, exist_ok=True)
    _MCP_CFG.write_text(json.dumps({"servers": servers}, indent=2), encoding="utf-8")
    # Hot-reload the mcp_bridge
    try:
        from agent.mcp_bridge import reload_servers
        reload_servers()
    except Exception:
        pass


class McpPage(OctoPage):
    _refresh_sig = pyqtSignal(list)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._refresh_sig.connect(self._render_servers)
        self._servers: list = []
        self._build()

    def _build(self):
        lay = self.page_layout()

        hdr = QHBoxLayout()
        hdr.addWidget(self.lbl("◈  MCP INTEGRATION", 11, bold=True, color=PRI))
        hdr.addStretch()
        ref = self.btn("↺ Refresh", color=PRI, height=26)
        ref.clicked.connect(lambda: threading.Thread(target=self._load, daemon=True).start())
        hdr.addWidget(ref)
        lay.addLayout(hdr)
        lay.addWidget(self.lbl(
            "Connect any MCP server to extend OCTO with custom tools and data sources.",
            7, color=TEXT_DIM, wrap=True))
        lay.addWidget(self.sep())

        # ── Add server form ──
        lay.addWidget(self.lbl("ADD MCP SERVER", 8, bold=True, color=ACC2))

        name_row = QHBoxLayout(); name_row.setSpacing(6)
        n_lbl = QLabel("Name"); n_lbl.setFixedWidth(70)
        n_lbl.setFont(QFont("Courier New", 7))
        n_lbl.setStyleSheet(f"color:{TEXT_MED};background:transparent;")
        self._name_f = self.field("e.g. my-database", height=28)
        name_row.addWidget(n_lbl); name_row.addWidget(self._name_f, stretch=1)
        lay.addLayout(name_row)

        cmd_row = QHBoxLayout(); cmd_row.setSpacing(6)
        cmd_lbl = QLabel("Command"); cmd_lbl.setFixedWidth(70)
        cmd_lbl.setFont(QFont("Courier New", 7))
        cmd_lbl.setStyleSheet(f"color:{TEXT_MED};background:transparent;")
        self._cmd_f = self.field("npx -y @modelcontextprotocol/server-filesystem /path", height=28)
        cmd_row.addWidget(cmd_lbl); cmd_row.addWidget(self._cmd_f, stretch=1)
        lay.addLayout(cmd_row)

        url_row = QHBoxLayout(); url_row.setSpacing(6)
        url_lbl = QLabel("OR  URL"); url_lbl.setFixedWidth(70)
        url_lbl.setFont(QFont("Courier New", 7))
        url_lbl.setStyleSheet(f"color:{TEXT_DIM};background:transparent;")
        self._url_f = self.field("https://mcp.example.com/sse  (SSE endpoint)", height=28)
        url_row.addWidget(url_lbl); url_row.addWidget(self._url_f, stretch=1)
        lay.addLayout(url_row)

        add_row = QHBoxLayout()
        add_b = self.btn("+ Connect Server", color=GREEN, height=30)
        add_b.clicked.connect(self._add_server)
        self._add_msg = self.lbl("", 7, color=GREEN)
        add_row.addWidget(add_b); add_row.addWidget(self._add_msg, stretch=1)
        lay.addLayout(add_row)
        lay.addWidget(self.sep())

        # ── Popular servers ──
        lay.addWidget(self.lbl("POPULAR MCP SERVERS", 8, bold=True, color=TEXT_MED))
        lay.addWidget(self.lbl("Click to auto-configure  (requires Node.js / npx)", 7, color=TEXT_DIM))
        for name, cmd, desc in _POPULAR_MCP:
            lay.addWidget(self._quick_card(name, cmd, desc))

        lay.addWidget(self.sep())
        lay.addWidget(self.lbl("CONNECTED SERVERS", 8, bold=True, color=PRI))
        self._servers_layout = QVBoxLayout(); self._servers_layout.setSpacing(4)
        lay.addLayout(self._servers_layout)
        lay.addStretch()

        threading.Thread(target=self._load, daemon=True).start()

    def _quick_card(self, name: str, cmd: str, desc: str) -> QWidget:
        card = QWidget()
        card.setStyleSheet(f"background:{PANEL};border:1px solid {BORDER};border-radius:4px;")
        cl = QHBoxLayout(card); cl.setContentsMargins(10, 6, 10, 6); cl.setSpacing(8)
        info = QVBoxLayout(); info.setSpacing(1)
        info.addWidget(self.lbl(name, 8, bold=True, color=ACC2))
        info.addWidget(self.lbl(desc, 7, color=TEXT_DIM))
        cl.addLayout(info, stretch=1)
        add_b = self.btn("+ Add", color=PRI, height=24)
        add_b.clicked.connect(lambda _, n=name, c=cmd: self._quick_add(n, c))
        cl.addWidget(add_b)
        return card

    def _load(self):
        """Load MCP servers — directly from mcp_servers.json + mcp_bridge."""
        servers: list = []
        # 1. Read config file
        for s in _load_mcp_json():
            name = s.get("name", "unknown")
            servers.append({
                "name":    name,
                "status":  "configured",
                "command": s.get("command", ""),
                "url":     s.get("url", ""),
                "label":   s.get("label", name),
                "icon":    s.get("icon", "🔌"),
                "desc":    s.get("description", ""),
                "n_tools": 0,
            })

        # 2. Enrich with live tool counts from mcp_bridge
        try:
            from agent.mcp_bridge import _registry
            for s in servers:
                entry = _registry.get(s["name"])
                if entry:
                    s["status"]  = "connected"
                    s["n_tools"] = len(entry.get("tools", []))
        except Exception:
            pass

        self._servers = servers
        self._refresh_sig.emit(servers)

    def _render_servers(self, servers: list):
        while self._servers_layout.count():
            item = self._servers_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        if not servers:
            self._servers_layout.addWidget(
                self.lbl("No MCP servers configured yet.", 8, color=TEXT_DIM))
            return

        for s in servers:
            name    = s.get("name", "unknown")
            label   = s.get("label", name)
            status  = s.get("status", "configured")
            n_tools = s.get("n_tools", 0)
            icon    = s.get("icon", "🔌")
            desc    = s.get("desc", "") or s.get("command", "") or s.get("url", "")
            connected = status == "connected"
            dot_col = GREEN if connected else TEXT_DIM
            border  = f"border:1px solid {GREEN}44;" if connected else f"border:1px solid {BORDER};"

            card = QWidget()
            card.setStyleSheet(
                f"background:{PANEL};{border}border-radius:4px;"
            )
            cl = QHBoxLayout(card)
            cl.setContentsMargins(10, 8, 10, 8)
            cl.setSpacing(8)

            # Status dot
            dot_lbl = self.lbl("●", 12, color=dot_col)
            cl.addWidget(dot_lbl)

            # Info column
            info = QVBoxLayout(); info.setSpacing(2)
            title_row = QHBoxLayout(); title_row.setSpacing(6)
            title_row.addWidget(self.lbl(f"{icon}  {label}", 9, bold=True, color=WHITE))
            if connected:
                badge = self.lbl(f"{n_tools} tools", 7, color=GREEN)
                badge.setStyleSheet(
                    f"color:{GREEN};background:#002211;border:1px solid {GREEN}44;"
                    f"border-radius:3px;padding:1px 5px;"
                )
                title_row.addWidget(badge)
            title_row.addStretch()
            info.addLayout(title_row)
            if desc:
                info.addWidget(self.lbl(desc[:70], 7, color=TEXT_DIM))
            cl.addLayout(info, stretch=1)

            # Status label
            status_lbl = self.lbl(
                "● LIVE" if connected else "○ OFFLINE",
                7, color=dot_col
            )
            cl.addWidget(status_lbl)

            # Reconnect button
            def _reconnect(checked=False, _name=name):
                self._add_msg.setText(f"Connecting {_name}…")
                def _run():
                    try:
                        from agent.mcp_bridge import _load_config, _connect_server, _registry
                        _registry.pop(_name, None)   # clear stale entry
                        cfgs = _load_config()
                        cfg  = next((c for c in cfgs if c.get("name") == _name), None)
                        if cfg:
                            _connect_server(cfg)
                            self._add_msg.setText(f"✓ {_name} reconnected")
                        else:
                            self._add_msg.setText(f"✗ {_name} not found in config")
                    except Exception as ex:
                        self._add_msg.setText(str(ex)[:60])
                    self._load()
                __import__("threading").Thread(target=_run, daemon=True).start()

            recon_b = self.btn("⟳", color=ACC2, height=24)
            recon_b.setFixedWidth(28)
            recon_b.setToolTip(f"Reconnect {name}")
            recon_b.clicked.connect(_reconnect)
            cl.addWidget(recon_b)

            rm = self.btn("✕", color=RED, height=24)
            rm.setFixedWidth(28)
            rm.setToolTip(f"Remove {name}")
            rm.clicked.connect(lambda _, n=name: self._remove(n))
            cl.addWidget(rm)

            self._servers_layout.addWidget(card)


    def _add_server(self):
        name = self._name_f.text().strip()
        cmd  = self._cmd_f.text().strip()
        url  = self._url_f.text().strip()
        if not name:
            self._add_msg.setText("Name is required."); return
        if not cmd and not url:
            self._add_msg.setText("Command or URL is required."); return

        def _run():
            try:
                servers = _load_mcp_json()
                # Remove existing with same name
                servers = [s for s in servers if s.get("name") != name]
                entry: dict = {"name": name}
                if url:
                    entry["url"] = url
                else:
                    parts = cmd.split()
                    entry["command"] = parts[0]
                    if len(parts) > 1:
                        entry["args"] = parts[1:]
                servers.append(entry)
                _save_mcp_json(servers)
                self._add_msg.setText(f"✓ Added: {name}")
                self._name_f.clear(); self._cmd_f.clear(); self._url_f.clear()
                self._load()
            except Exception as e:
                self._add_msg.setText(str(e)[:60])

        self._add_msg.setText("Adding…")
        threading.Thread(target=_run, daemon=True).start()

    def _quick_add(self, name: str, cmd: str):
        self._name_f.setText(name)
        self._cmd_f.setText(cmd)
        self._url_f.clear()

    def _remove(self, name: str):
        def _run():
            servers = _load_mcp_json()
            servers = [s for s in servers if s.get("name") != name]
            _save_mcp_json(servers)
            self._load()
        threading.Thread(target=_run, daemon=True).start()
