"""
ui_pages/project_page.py  — Antigravity-style Project Workspace
================================================================
Left panel  : project sidebar (list + add)
Right panel : active project workspace
             ├─ header bar  (project name · branch · CMD · PS)
             ├─ agent runner grid  (multiple agents, live status)
             ├─ task feed / output log
             └─ task input bar  (textarea + model picker + RUN)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Callable
from functools import partial
from functools import partial

import deerflow_bridge
from PyQt6.QtCore import Qt, QTimer, pyqtSignal, QThread, QObject
from PyQt6.QtGui import QFont, QColor
from PyQt6.QtWidgets import (
    QComboBox, QFileDialog, QFrame, QHBoxLayout, QLabel,
    QLineEdit, QPushButton, QScrollArea, QSizePolicy,
    QSplitter, QTextEdit, QVBoxLayout, QWidget,
)

# ── colour palette ────────────────────────────────────────────────────────────
try:
    from ui import C  # type: ignore
except Exception:
    class C:
        BG="#000d14"; DARK="#00070d"; PRI="#00e5ff"; PRI_DIM="#00607a"
        PRI_GHO="#001a22"; ACC="#ff6b35"; ACC2="#7c3aed"; GREEN="#00ff88"
        GREEN_D="#005533"; RED="#ff3355"; TEXT="#c8d8e0"; TEXT_MED="#6b8fa0"
        TEXT_DIM="#3a5060"; BORDER="#1a2a35"; BORDER_A="#203040"; BORDER_B="#2a4050"
        PANEL2="#000f18"; WHITE="#e8f4f8"

# ── config ────────────────────────────────────────────────────────────────────
_CFG = Path(__file__).resolve().parent.parent / "config" / "projects.json"


def _load_projects() -> list[dict]:
    try:
        return json.loads(_CFG.read_text(encoding="utf-8")) if _CFG.exists() else []
    except Exception:
        return []


def _save_projects(projects: list[dict]) -> None:
    _CFG.parent.mkdir(parents=True, exist_ok=True)
    _CFG.write_text(json.dumps(projects, indent=2), encoding="utf-8")


def get_active_project() -> dict | None:
    for p in _load_projects():
        if p.get("active"):
            return p
    return None


def set_active_project(name: str | None) -> None:
    projects = _load_projects()
    for p in projects:
        p["active"] = (p.get("name") == name)
    _save_projects(projects)
    active = next((p for p in projects if p.get("active")), None)
    if active:
        # Crucial for DeerFlow LocalSandboxProvider isolation to work properly when
        # subagents write intermediate artifacts.
        os.environ["OCTO_PROJECT_ROOT"] = str(Path(active.get("path", "")).resolve())
        os.environ["OCTO_PROJECT_NAME"] = active.get("name", "")
    else:
        os.environ.pop("OCTO_PROJECT_ROOT", None)
        os.environ.pop("OCTO_PROJECT_NAME", None)


def _git_branches(path: str) -> list[str]:
    try:
        r = subprocess.run(
            ["git", "branch", "--format=%(refname:short)"],
            cwd=path, capture_output=True, text=True, timeout=3,
        )
        branches = [b.strip() for b in r.stdout.splitlines() if b.strip()]
        return branches or ["main"]
    except Exception:
        return ["main"]


def _git_current_branch(path: str) -> str:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=path, capture_output=True, text=True, timeout=3,
        )
        return r.stdout.strip() or "main"
    except Exception:
        return "main"


# ── agent worker ──────────────────────────────────────────────────────────────
class _AgentWorker(QObject):
    progress = pyqtSignal(str, str)   # (agent_id, text chunk)
    finished = pyqtSignal(str, str)   # (agent_id, final result)
    failed   = pyqtSignal(str, str)   # (agent_id, error)

    def __init__(self, agent_id: str, goal: str, model: str,
                 project: dict, parent=None):
        super().__init__(parent)
        self.agent_id = agent_id
        self.goal     = goal
        self.model    = model
        self.project  = project

    def run(self):
        try:
            import os
            from deerflow_bridge import deep_research
            proj_root = self.project.get("path", "")
            goal_ctx  = self.goal

            if proj_root:
                os.environ["OCTO_PROJECT_ROOT"] = str(proj_root)
                goal_ctx = (
                    f"[Project: {self.project.get('name','?')} | Root: {proj_root}]\n"
                    + self.goal
                )

            def _on_chunk(chunk: str):
                self.progress.emit(self.agent_id, chunk)

            # Route to deep_research so we can stream progress directly to the UI
            result = deep_research(
                topic=goal_ctx,
                session_id=self.agent_id,
                on_progress=_on_chunk
            )
            self.finished.emit(self.agent_id, result or "✅ Done.")
        except Exception as e:
            self.failed.emit(self.agent_id, str(e))


# ── agent card (live tile) ────────────────────────────────────────────────────
_AGENT_ICONS = ["◈", "◉", "◎", "⊕", "⊗"]
_STATUS_COLORS = {
    "running":  "#00e5ff",
    "done":     "#00ff88",
    "failed":   "#ff3355",
    "queued":   "#7c3aed",
}

class _AgentTile(QWidget):
    """Live agent status tile — shown in the runner grid."""

    def __init__(self, agent_id: str, icon: str, goal: str, parent=None):
        super().__init__(parent)
        self.agent_id = agent_id
        self._status  = "queued"
        self._chunks: list[str] = []
        self._setStyleForStatus("queued")
        self._build(icon, goal)

    def _setStyleForStatus(self, s: str):
        col = _STATUS_COLORS.get(s, C.BORDER_A)
        self.setStyleSheet(
            f"background: {C.PANEL2}; border: 1px solid {col}; border-radius: 6px;"
        )

    def _build(self, icon: str, goal: str):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(10, 8, 10, 8)
        lay.setSpacing(4)

        # Top row
        row = QHBoxLayout(); row.setSpacing(6)
        self._icon_lbl = QLabel(icon)
        self._icon_lbl.setFont(QFont("Courier New", 12, QFont.Weight.Bold))
        self._icon_lbl.setStyleSheet(
            f"color: {_STATUS_COLORS['queued']}; background: transparent; border: none;"
        )
        row.addWidget(self._icon_lbl)

        self._status_lbl = QLabel("QUEUED")
        self._status_lbl.setFont(QFont("Courier New", 7, QFont.Weight.Bold))
        self._status_lbl.setStyleSheet(
            f"color: {_STATUS_COLORS['queued']}; background: transparent; border: none;"
        )
        row.addWidget(self._status_lbl)
        row.addStretch()

        self._id_lbl = QLabel(self.agent_id[:8])
        self._id_lbl.setFont(QFont("Courier New", 6))
        self._id_lbl.setStyleSheet(
            f"color: {C.TEXT_DIM}; background: transparent; border: none;"
        )
        row.addWidget(self._id_lbl)
        lay.addLayout(row)

        # Goal text
        goal_lbl = QLabel(goal[:80] + ("…" if len(goal) > 80 else ""))
        goal_lbl.setFont(QFont("Courier New", 8))
        goal_lbl.setStyleSheet(f"color: {C.TEXT}; background: transparent; border: none;")
        goal_lbl.setWordWrap(True)
        lay.addWidget(goal_lbl)

        # Live output preview
        self._out_lbl = QLabel("Waiting…")
        self._out_lbl.setFont(QFont("Courier New", 7))
        self._out_lbl.setStyleSheet(
            f"color: {C.TEXT_DIM}; background: transparent; border: none;"
        )
        self._out_lbl.setWordWrap(True)
        self._out_lbl.setMaximumHeight(36)
        lay.addWidget(self._out_lbl)

    def set_status(self, status: str):
        self._status = status
        col = _STATUS_COLORS.get(status, C.BORDER_A)
        self._icon_lbl.setStyleSheet(
            f"color: {col}; background: transparent; border: none;"
        )
        self._status_lbl.setStyleSheet(
            f"color: {col}; background: transparent; border: none;"
        )
        self._status_lbl.setText(status.upper())
        self._setStyleForStatus(status)

    def append_chunk(self, text: str):
        self._chunks.append(text)
        preview = "".join(self._chunks)[-120:].replace("\n", " ")
        self._out_lbl.setText(preview)

    def set_final(self, text: str):
        preview = str(text)[-120:].replace("\n", " ")
        self._out_lbl.setText(preview)


# ── left sidebar: project list ────────────────────────────────────────────────
class _ProjectSidebar(QWidget):
    project_selected = pyqtSignal(dict)   # emits project dict
    project_added    = pyqtSignal()

    _BTN_SS = f"""
        QPushButton {{
            background: transparent; color: {C.TEXT_DIM};
            border: none; border-radius: 3px;
            font-family: 'Courier New'; font-size: 9px;
            padding: 6px 10px; text-align: left;
        }}
        QPushButton:checked {{
            background: {C.PRI_GHO}; color: {C.PRI};
            border-left: 2px solid {C.PRI};
        }}
        QPushButton:hover:!checked {{
            color: {C.TEXT}; background: #010d14;
        }}
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self._selected: str | None = None
        self._proj_btns: dict[str, QPushButton] = {}
        self.setFixedWidth(220)
        self.setStyleSheet(
            f"background: {C.DARK}; border-right: 1px solid {C.BORDER};"
        )
        self._build()
        self._refresh()

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # Header
        hdr = QLabel("  PROJECTS")
        hdr.setFont(QFont("Courier New", 8, QFont.Weight.Bold))
        hdr.setFixedHeight(36)
        hdr.setStyleSheet(
            f"color: {C.TEXT_MED}; background: {C.DARK};"
            f"border-bottom: 1px solid {C.BORDER}; padding-left: 8px;"
        )
        lay.addWidget(hdr)

        # Scroll area for project entries
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("QScrollArea{background:transparent;border:none;}"
                             "QScrollBar:vertical{width:4px;background:transparent;}"
                             f"QScrollBar::handle:vertical{{background:{C.BORDER_A};border-radius:2px;}}")
        self._list_widget = QWidget()
        self._list_widget.setStyleSheet("background:transparent;")
        self._list_lay = QVBoxLayout(self._list_widget)
        self._list_lay.setContentsMargins(0, 4, 0, 4)
        self._list_lay.setSpacing(0)
        self._list_lay.addStretch()
        scroll.setWidget(self._list_widget)
        lay.addWidget(scroll, stretch=1)

        # Add project button
        add_btn = QPushButton("＋  New Project")
        add_btn.setFixedHeight(38)
        add_btn.setFont(QFont("Courier New", 8, QFont.Weight.Bold))
        add_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        add_btn.setStyleSheet(
            f"QPushButton{{background:transparent;color:{C.PRI};"
            f"border-top:1px solid {C.BORDER};border-radius:0;padding:0 12px;}}"
            f"QPushButton:hover{{background:{C.PRI_GHO};}}"
        )
        add_btn.clicked.connect(self._show_add_dialog)
        lay.addWidget(add_btn)

    def _refresh(self):
        # Clear
        while self._list_lay.count() > 1:
            item = self._list_lay.takeAt(0)
            if w := item.widget():
                w.deleteLater()
        self._proj_btns.clear()

        projects = _load_projects()
        for proj in projects:
            name = proj.get("name", "?")
            is_active = proj.get("active", False)

            # Section container
            entry = QWidget()
            entry.setStyleSheet("background:transparent;")
            ev = QVBoxLayout(entry)
            ev.setContentsMargins(0, 0, 0, 0)
            ev.setSpacing(0)

            # Folder label
            folder_row = QHBoxLayout(); folder_row.setSpacing(4)
            folder_lbl = QLabel(f"  🗂 {name}")
            folder_lbl.setFont(QFont("Courier New", 8, QFont.Weight.Bold))
            folder_lbl.setStyleSheet(
                f"color: {C.TEXT_MED}; background: transparent; padding: 4px 0;"
            )
            folder_row.addWidget(folder_lbl, stretch=1)

            active_dot = QLabel("●" if is_active else "")
            active_dot.setFont(QFont("Courier New", 8))
            active_dot.setStyleSheet(
                f"color: {C.GREEN}; background: transparent; padding-right: 8px;"
            )
            folder_row.addWidget(active_dot)
            ev.addLayout(folder_row)

            # Select button (acts like a task row)
            btn = QPushButton(f"   Open workspace")
            btn.setCheckable(True)
            btn.setChecked(name == self._selected)
            btn.setFixedHeight(28)
            btn.setFont(QFont("Courier New", 8))
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.setStyleSheet(self._BTN_SS)
            btn.clicked.connect(lambda _, p=proj: self._select(p))
            ev.addWidget(btn)
            self._proj_btns[name] = btn

            self._list_lay.insertWidget(self._list_lay.count() - 1, entry)

        # Auto-select active or first
        if not self._selected and projects:
            active = next((p for p in projects if p.get("active")), projects[0])
            self._select(active, emit=False)

    def _select(self, proj: dict, emit: bool = True):
        self._selected = proj.get("name")
        for n, b in self._proj_btns.items():
            b.setChecked(n == self._selected)
        if emit:
            self.project_selected.emit(proj)

    def _show_add_dialog(self):
        dlg = _AddProjectDialog(self)
        if dlg.exec():
            self._refresh()
            self.project_added.emit()


# ── add project dialog ────────────────────────────────────────────────────────
class _AddProjectDialog(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent, Qt.WindowType.Dialog | Qt.WindowType.WindowStaysOnTopHint)
        self.setWindowTitle("Add Project")
        self.setFixedSize(420, 220)
        self.setStyleSheet(
            f"background:{C.DARK};color:{C.TEXT};"
            f"border:1px solid {C.BORDER_A};border-radius:8px;"
        )
        self._result = False
        self._build()

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(20, 18, 20, 18)
        lay.setSpacing(10)

        title = QLabel("◈  Add New Project")
        title.setFont(QFont("Courier New", 11, QFont.Weight.Bold))
        title.setStyleSheet(f"color:{C.PRI};")
        lay.addWidget(title)

        _inp_ss = (f"QLineEdit{{background:#000d12;color:{C.TEXT};"
                   f"border:1px solid {C.BORDER};border-radius:3px;padding:4px 8px;}}"
                   f"QLineEdit:focus{{border:1px solid {C.PRI};}}")

        self._name = QLineEdit(); self._name.setPlaceholderText("Project name (e.g. my-app)")
        self._name.setStyleSheet(_inp_ss); self._name.setFixedHeight(30)
        lay.addWidget(self._name)

        path_row = QHBoxLayout(); path_row.setSpacing(6)
        self._path = QLineEdit(); self._path.setPlaceholderText("Root folder path")
        self._path.setStyleSheet(_inp_ss); self._path.setFixedHeight(30)
        browse = QPushButton("Browse")
        browse.setFixedHeight(30)
        browse.setStyleSheet(
            f"QPushButton{{background:transparent;color:{C.ACC2};"
            f"border:1px solid {C.BORDER};border-radius:3px;padding:0 10px;}}"
            f"QPushButton:hover{{border:1px solid {C.ACC2};}}"
        )
        browse.clicked.connect(self._browse)
        path_row.addWidget(self._path, stretch=1); path_row.addWidget(browse)
        lay.addLayout(path_row)

        self._desc = QLineEdit(); self._desc.setPlaceholderText("Description (optional)")
        self._desc.setStyleSheet(_inp_ss); self._desc.setFixedHeight(30)
        lay.addWidget(self._desc)

        btns = QHBoxLayout(); btns.setSpacing(8)
        cancel = QPushButton("Cancel")
        cancel.setFixedHeight(30)
        cancel.setStyleSheet(
            f"QPushButton{{background:transparent;color:{C.TEXT_DIM};"
            f"border:1px solid {C.BORDER};border-radius:3px;padding:0 12px;}}"
            f"QPushButton:hover{{color:{C.TEXT};}}"
        )
        cancel.clicked.connect(self.close)
        ok = QPushButton("Add Project")
        ok.setFixedHeight(30)
        ok.setStyleSheet(
            f"QPushButton{{background:transparent;color:{C.PRI};"
            f"border:1px solid {C.PRI_DIM};border-radius:3px;padding:0 14px;}}"
            f"QPushButton:hover{{background:{C.PRI_GHO};}}"
        )
        ok.clicked.connect(self._save)
        btns.addWidget(cancel); btns.addStretch(); btns.addWidget(ok)
        lay.addLayout(btns)

    def exec(self) -> bool:
        self.show()
        loop = __import__("PyQt6.QtWidgets", fromlist=["QApplication"]).QApplication
        while self.isVisible():
            loop.processEvents()
        return self._result

    def _browse(self):
        d = QFileDialog.getExistingDirectory(self, "Select root folder", str(Path.home()))
        if d:
            self._path.setText(d)
            if not self._name.text().strip():
                self._name.setText(Path(d).name)

    def _save(self):
        name = self._name.text().strip()
        path = self._path.text().strip()
        if not name or not path:
            return
        projects = _load_projects()
        existing = next((p for p in projects if p["name"] == name), None)
        entry = {"name": name, "path": path, "desc": self._desc.text().strip(), "active": False}
        if existing:
            projects[projects.index(existing)] = {**existing, **entry}
        else:
            projects.append(entry)
        _save_projects(projects)
        self._result = True
        self.close()


# ── task feed item ────────────────────────────────────────────────────────────
class _TaskFeedItem(QWidget):
    def __init__(self, goal: str, agents: int, ts: str, status: str = "running", parent=None):
        super().__init__(parent)
        self._status = status
        self._build(goal, agents, ts)

    def _build(self, goal: str, agents: int, ts: str):
        col = _STATUS_COLORS.get(self._status, C.BORDER_A)
        self.setStyleSheet(
            f"background:{C.PANEL2};border-left:3px solid {col};"
            f"border-radius:0 4px 4px 0;padding:0;"
        )
        lay = QHBoxLayout(self)
        lay.setContentsMargins(10, 6, 10, 6)
        lay.setSpacing(8)

        dot = QLabel("◈" if self._status == "running" else
                     "✓" if self._status == "done" else "✕")
        dot.setFont(QFont("Courier New", 9, QFont.Weight.Bold))
        dot.setStyleSheet(f"color:{col};background:transparent;border:none;")
        lay.addWidget(dot)

        text_col = QVBoxLayout(); text_col.setSpacing(2)
        goal_lbl = QLabel(goal[:90] + ("…" if len(goal) > 90 else ""))
        goal_lbl.setFont(QFont("Courier New", 9))
        goal_lbl.setStyleSheet(f"color:{C.TEXT};background:transparent;border:none;")
        text_col.addWidget(goal_lbl)

        meta_lbl = QLabel(f"{agents} agent{'s' if agents > 1 else ''}  ·  {ts}")
        meta_lbl.setFont(QFont("Courier New", 7))
        meta_lbl.setStyleSheet(f"color:{C.TEXT_DIM};background:transparent;border:none;")
        text_col.addWidget(meta_lbl)
        lay.addLayout(text_col, stretch=1)

        self._spin_lbl = QLabel("⟳" if self._status == "running" else "")
        self._spin_lbl.setFont(QFont("Courier New", 10))
        self._spin_lbl.setStyleSheet(f"color:{C.PRI};background:transparent;border:none;")
        lay.addWidget(self._spin_lbl)

        if self._status == "running":
            self._spin_timer = QTimer()
            self._spin_timer.timeout.connect(self._spin)
            self._spin_timer.start(300)
            self._spin_chars = ["⟳", "⟲"]
            self._spin_i = 0

    def _spin(self):
        self._spin_i = (self._spin_i + 1) % 2
        self._spin_lbl.setText(self._spin_chars[self._spin_i])

    def mark_done(self, ok: bool = True):
        self._status = "done" if ok else "failed"
        col = _STATUS_COLORS[self._status]
        self.setStyleSheet(
            f"background:{C.PANEL2};border-left:3px solid {col};"
            f"border-radius:0 4px 4px 0;"
        )
        self._spin_lbl.setText("✓" if ok else "✕")
        try:
            self._spin_timer.stop()
        except Exception:
            pass


# ── main workspace (right panel) ──────────────────────────────────────────────
class _ProjectWorkspace(QWidget):
    """Shown on the right when a project is selected."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._project: dict = {}
        self._agent_tiles: dict[str, _AgentTile] = {}
        self._threads: dict[str, QThread] = {}
        self._workers: dict[str, QObject] = {}
        self._feed_items: list[_TaskFeedItem] = []
        self.setStyleSheet(f"background:{C.BG};")
        self._build()

    def _build(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # ── header bar ─────────────────────────────────────────────────────
        self._header = QWidget()
        self._header.setFixedHeight(50)
        self._header.setStyleSheet(
            f"background:{C.DARK};border-bottom:1px solid {C.BORDER};"
        )
        hlay = QHBoxLayout(self._header)
        hlay.setContentsMargins(16, 0, 12, 0)
        hlay.setSpacing(8)

        self._proj_name_lbl = QLabel("Select a project →")
        self._proj_name_lbl.setFont(QFont("Courier New", 11, QFont.Weight.Bold))
        self._proj_name_lbl.setStyleSheet(f"color:{C.PRI};background:transparent;")
        hlay.addWidget(self._proj_name_lbl)

        hlay.addWidget(self.__sep_v())

        # Branch selector
        branch_icon = QLabel("⎇")
        branch_icon.setFont(QFont("Courier New", 9))
        branch_icon.setStyleSheet(f"color:{C.TEXT_DIM};background:transparent;")
        hlay.addWidget(branch_icon)

        self._branch_combo = QComboBox()
        self._branch_combo.setFixedHeight(26)
        self._branch_combo.setFont(QFont("Courier New", 8))
        self._branch_combo.setStyleSheet(
            f"QComboBox{{background:#000d12;color:{C.TEXT};"
            f"border:1px solid {C.BORDER};border-radius:3px;padding:0 8px;}}"
            f"QComboBox::drop-down{{border:none;}}"
            f"QComboBox QAbstractItemView{{background:{C.DARK};color:{C.TEXT};"
            f"border:1px solid {C.BORDER_A};}}"
        )
        hlay.addWidget(self._branch_combo)

        hlay.addStretch()

        # Activate button
        self._activate_btn = QPushButton("▸ Activate")
        self._activate_btn.setFixedHeight(28)
        self._activate_btn.setFont(QFont("Courier New", 8, QFont.Weight.Bold))
        self._activate_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._activate_btn.setStyleSheet(
            f"QPushButton{{background:transparent;color:{C.GREEN};"
            f"border:1px solid {C.GREEN_D};border-radius:3px;padding:0 10px;}}"
            f"QPushButton:hover{{background:#001a0d;border:1px solid {C.GREEN};}}"
        )
        self._activate_btn.clicked.connect(self._toggle_activate)
        hlay.addWidget(self._activate_btn)

        # Terminal / PS buttons
        for label, color, slot in [
            ("⊞ CMD", C.ACC2, self._open_cmd),
            ("⊞ PS",  C.ACC,  self._open_ps),
        ]:
            b = QPushButton(label)
            b.setFixedHeight(28)
            b.setFont(QFont("Courier New", 8))
            b.setCursor(Qt.CursorShape.PointingHandCursor)
            b.setStyleSheet(
                f"QPushButton{{background:transparent;color:{color};"
                f"border:1px solid {C.BORDER};border-radius:3px;padding:0 8px;}}"
                f"QPushButton:hover{{border:1px solid {color};}}"
            )
            b.clicked.connect(slot)
            hlay.addWidget(b)

        root.addWidget(self._header)

        # ── body splitter: agents grid (top) + feed (bottom) ───────────────
        splitter = QSplitter(Qt.Orientation.Vertical)
        splitter.setStyleSheet("QSplitter::handle{background:#0d1f2d;height:3px;}")

        # Agent runner grid
        agents_wrap = QWidget()
        agents_wrap.setStyleSheet(f"background:{C.BG};")
        agents_outer = QVBoxLayout(agents_wrap)
        agents_outer.setContentsMargins(16, 10, 16, 6)
        agents_outer.setSpacing(6)

        grid_hdr = QHBoxLayout()
        agents_label = QLabel("◈  AGENT RUNNERS")
        agents_label.setFont(QFont("Courier New", 8, QFont.Weight.Bold))
        agents_label.setStyleSheet(f"color:{C.TEXT_MED};background:transparent;")
        grid_hdr.addWidget(agents_label, stretch=1)

        self._agent_count_lbl = QLabel("0 active")
        self._agent_count_lbl.setFont(QFont("Courier New", 7))
        self._agent_count_lbl.setStyleSheet(f"color:{C.TEXT_DIM};background:transparent;")
        grid_hdr.addWidget(self._agent_count_lbl)
        agents_outer.addLayout(grid_hdr)

        # Horizontal scroll for tiles
        tile_scroll = QScrollArea()
        tile_scroll.setWidgetResizable(True)
        tile_scroll.setFixedHeight(130)
        tile_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        tile_scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        tile_scroll.setStyleSheet(
            "QScrollArea{background:transparent;border:none;}"
            f"QScrollBar:horizontal{{height:4px;background:transparent;}}"
            f"QScrollBar::handle:horizontal{{background:{C.BORDER_A};border-radius:2px;}}"
        )
        self._tile_container = QWidget()
        self._tile_container.setStyleSheet("background:transparent;")
        self._tile_row = QHBoxLayout(self._tile_container)
        self._tile_row.setContentsMargins(0, 0, 0, 0)
        self._tile_row.setSpacing(8)
        self._tile_row.addStretch()
        tile_scroll.setWidget(self._tile_container)
        agents_outer.addWidget(tile_scroll)

        splitter.addWidget(agents_wrap)

        # Task feed
        feed_wrap = QWidget()
        feed_wrap.setStyleSheet(f"background:{C.BG};")
        feed_outer = QVBoxLayout(feed_wrap)
        feed_outer.setContentsMargins(16, 6, 16, 0)
        feed_outer.setSpacing(6)

        feed_hdr = QLabel("◈  TASK HISTORY")
        feed_hdr.setFont(QFont("Courier New", 8, QFont.Weight.Bold))
        feed_hdr.setStyleSheet(f"color:{C.TEXT_MED};background:transparent;")
        feed_outer.addWidget(feed_hdr)

        feed_scroll = QScrollArea()
        feed_scroll.setWidgetResizable(True)
        feed_scroll.setStyleSheet(
            "QScrollArea{background:transparent;border:none;}"
            f"QScrollBar:vertical{{width:4px;background:transparent;}}"
            f"QScrollBar::handle:vertical{{background:{C.BORDER_A};border-radius:2px;}}"
        )
        self._feed_container = QWidget()
        self._feed_container.setStyleSheet("background:transparent;")
        self._feed_layout = QVBoxLayout(self._feed_container)
        self._feed_layout.setContentsMargins(0, 0, 0, 0)
        self._feed_layout.setSpacing(4)
        self._feed_layout.addStretch()
        feed_scroll.setWidget(self._feed_container)
        feed_outer.addWidget(feed_scroll, stretch=1)

        splitter.addWidget(feed_wrap)
        splitter.setSizes([160, 300])
        root.addWidget(splitter, stretch=1)

        # ── task input bar ──────────────────────────────────────────────────
        input_bar = QWidget()
        input_bar.setStyleSheet(
            f"background:{C.DARK};border-top:1px solid {C.BORDER};"
        )
        input_bar.setFixedHeight(110)
        ilay = QVBoxLayout(input_bar)
        ilay.setContentsMargins(16, 10, 16, 10)
        ilay.setSpacing(6)

        # Text area
        self._task_input = QTextEdit()
        self._task_input.setFixedHeight(52)
        self._task_input.setFont(QFont("Courier New", 9))
        self._task_input.setPlaceholderText(
            "Describe a task…  @mention file  /deerflow  /dev  /research"
        )
        self._task_input.setStyleSheet(
            f"QTextEdit{{background:#000d12;color:{C.TEXT};"
            f"border:1px solid {C.BORDER};border-radius:4px;padding:6px 10px;}}"
            f"QTextEdit:focus{{border:1px solid {C.PRI};}}"
        )
        ilay.addWidget(self._task_input)

        # Bottom row: model + agent count + run
        ctrl_row = QHBoxLayout(); ctrl_row.setSpacing(8)

        # Model picker
        model_icon = QLabel("⊕")
        model_icon.setFont(QFont("Courier New", 9))
        model_icon.setStyleSheet(f"color:{C.PRI_DIM};background:transparent;")
        ctrl_row.addWidget(model_icon)

        self._model_combo = QComboBox()
        self._model_combo.setFixedHeight(26)
        self._model_combo.setFont(QFont("Courier New", 8))
        
        # Dynamically load models
        models = ["deerflow/auto"]
        try:
            from memory.config_manager import load_proxy_keys, _load_json, CONFIG_FILE
            proxy_keys = load_proxy_keys()
            if proxy_keys.get("anthropic_auth_token"): models.append("claude-3-5-sonnet")
            if proxy_keys.get("gemini_api_key"): models.extend(["gemini-2.5-flash", "gemini-2.5-pro"])
            if proxy_keys.get("openrouter_api_key"): models.append("openrouter/auto")
            if proxy_keys.get("deepseek_api_key"): models.append("deepseek-chat")
            
            # Local ollama dynamic detection
            try:
                import urllib.request
                import json
                req = urllib.request.Request("http://localhost:11434/api/tags", method="GET")
                with urllib.request.urlopen(req, timeout=1.0) as r:
                    data = json.loads(r.read())
                    for m in data.get("models", []):
                        models.append(f"ollama/{m['name']}")
            except Exception:
                models.extend(["ollama/llama3", "ollama/gemma3"])  # Local fallback if ollama offline during boot

            cfg = _load_json(CONFIG_FILE, {})
            ollama_m = cfg.get("ollama_model", "")
            if ollama_m and f"ollama/{ollama_m}" not in models:
                models.append(f"ollama/{ollama_m}")

        except Exception:
            models.extend(["gemini-2.5-flash", "ollama/llama3"])
            
        self._model_combo.addItems(models)
        self._model_combo.setStyleSheet(
            f"QComboBox{{background:#000d12;color:{C.TEXT};"
            f"border:1px solid {C.BORDER};border-radius:3px;padding:0 8px;}}"
            f"QComboBox::drop-down{{border:none;}}"
            f"QComboBox QAbstractItemView{{background:{C.DARK};color:{C.TEXT};"
            f"border:1px solid {C.BORDER_A};}}"
        )
        ctrl_row.addWidget(self._model_combo)

        ctrl_row.addWidget(self.__sep_v())

        # Agent count spinner
        agents_icon = QLabel("◎ Agents:")
        agents_icon.setFont(QFont("Courier New", 8))
        agents_icon.setStyleSheet(f"color:{C.TEXT_DIM};background:transparent;")
        ctrl_row.addWidget(agents_icon)

        self._agent_spin = QComboBox()
        self._agent_spin.addItems(["1", "2", "3", "4"])
        self._agent_spin.setFixedHeight(26)
        self._agent_spin.setFixedWidth(50)
        self._agent_spin.setFont(QFont("Courier New", 8))
        self._agent_spin.setStyleSheet(
            f"QComboBox{{background:#000d12;color:{C.TEXT};"
            f"border:1px solid {C.BORDER};border-radius:3px;padding:0 6px;}}"
            f"QComboBox::drop-down{{border:none;}}"
            f"QComboBox QAbstractItemView{{background:{C.DARK};color:{C.TEXT};"
            f"border:1px solid {C.BORDER_A};}}"
        )
        ctrl_row.addWidget(self._agent_spin)

        ctrl_row.addStretch()

        # Run button
        self._run_btn = QPushButton("▶  Run Task")
        self._run_btn.setFixedHeight(30)
        self._run_btn.setFont(QFont("Courier New", 9, QFont.Weight.Bold))
        self._run_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._run_btn.setStyleSheet(
            f"QPushButton{{background:{C.PRI_GHO};color:{C.PRI};"
            f"border:1px solid {C.PRI_DIM};border-radius:4px;padding:0 18px;}}"
            f"QPushButton:hover{{background:#002233;border:1px solid {C.PRI};}}"
            f"QPushButton:disabled{{color:{C.TEXT_DIM};border:1px solid {C.BORDER};}}"
        )
        self._run_btn.clicked.connect(self._run_task)
        ctrl_row.addWidget(self._run_btn)

        ilay.addLayout(ctrl_row)
        root.addWidget(input_bar)

    def __sep_v(self) -> QFrame:
        f = QFrame(); f.setFrameShape(QFrame.Shape.VLine)
        f.setFixedWidth(1)
        f.setStyleSheet(f"color:{C.BORDER};background:{C.BORDER};")
        return f

    # ── project loading ────────────────────────────────────────────────────
    def load_project(self, proj: dict):
        self._project = proj
        name = proj.get("name", "?")
        path = proj.get("path", "")
        is_active = proj.get("active", False)

        self._proj_name_lbl.setText(f"🗂  {name}")

        # Load branches
        self._branch_combo.clear()
        branches = _git_branches(path) if path else ["main"]
        self._branch_combo.addItems(branches)
        current = _git_current_branch(path) if path else "main"
        idx = self._branch_combo.findText(current)
        if idx >= 0:
            self._branch_combo.setCurrentIndex(idx)

        # Activate button state
        if is_active:
            self._activate_btn.setText("◻ Deactivate")
            self._activate_btn.setStyleSheet(
                f"QPushButton{{background:transparent;color:{C.TEXT_MED};"
                f"border:1px solid {C.BORDER};border-radius:3px;padding:0 10px;}}"
                f"QPushButton:hover{{color:{C.TEXT};border:1px solid {C.BORDER_B};}}"
            )
        else:
            self._activate_btn.setText("▸ Activate")
            self._activate_btn.setStyleSheet(
                f"QPushButton{{background:transparent;color:{C.GREEN};"
                f"border:1px solid {C.GREEN_D};border-radius:3px;padding:0 10px;}}"
                f"QPushButton:hover{{background:#001a0d;border:1px solid {C.GREEN};}}"
            )

    # ── run task ───────────────────────────────────────────────────────────
    def _run_task(self):
        goal = self._task_input.toPlainText().strip()
        if not goal or not self._project:
            return

        self._task_input.clear()
        n_agents = int(self._agent_spin.currentText())
        model    = self._model_combo.currentText()
        ts       = datetime.now().strftime("%H:%M")

        # Add task feed item
        feed_item = _TaskFeedItem(goal, n_agents, ts, "running")
        self._feed_layout.insertWidget(self._feed_layout.count() - 1, feed_item)
        self._feed_items.append(feed_item)

        # Spin up N agent tiles + threads
        done_counter = {"count": 0, "total": n_agents, "feed": feed_item}

        icons = _AGENT_ICONS * 4
        for i in range(n_agents):
            agent_id = str(uuid.uuid4())
            icon = icons[i % len(icons)]

            tile = _AgentTile(agent_id, icon, goal)
            tile.setFixedWidth(200)
            self._tile_row.insertWidget(self._tile_row.count() - 1, tile)
            self._agent_tiles[agent_id] = tile

            thread = QThread()
            worker = _AgentWorker(agent_id, goal, model, self._project)
            worker.moveToThread(thread)

            # Create wrapper methods on `self` and connect to them using partials.
            # This ensures PyQt6 correctly routes the cross-thread signal to the main GUI thread.
            worker.progress.connect(partial(self._on_progress_wrapper, tile))
            worker.finished.connect(partial(self._on_done_wrapper, tile, done_counter))
            worker.failed.connect(partial(self._on_fail_wrapper, tile, done_counter))

            thread.started.connect(worker.run)
            self._threads[agent_id] = thread
            self._workers[agent_id] = worker
            thread.start()

            tile.set_status("running")

        self._update_agent_count()

    def _on_progress_wrapper(self, tile, aid, txt):
        tile.append_chunk(txt)

    def _on_done_wrapper(self, tile, dc, aid, res):
        self._on_done(aid, res, tile, dc)

    def _on_fail_wrapper(self, tile, dc, aid, err):
        self._on_fail(aid, err, tile, dc)

    def _on_progress_wrapper(self, tile, aid, txt):
        tile.append_chunk(txt)

    def _on_done_wrapper(self, tile, dc, aid, res):
        self._on_done(aid, res, tile, dc)

    def _on_fail_wrapper(self, tile, dc, aid, err):
        self._on_fail(aid, err, tile, dc)

    def _on_done(self, agent_id: str, result: str, tile: _AgentTile, dc: dict):
        tile.set_status("done")
        tile.set_final(result)
        dc["count"] += 1
        if dc["count"] >= dc["total"]:
            dc["feed"].mark_done(True)
        self._cleanup_thread(agent_id)
        self._update_agent_count()

    def _on_fail(self, agent_id: str, error: str, tile: _AgentTile, dc: dict):
        tile.set_status("failed")
        tile.set_final(f"Error: {error}")
        dc["count"] += 1
        if dc["count"] >= dc["total"]:
            dc["feed"].mark_done(False)
        self._cleanup_thread(agent_id)
        self._update_agent_count()

    def _cleanup_thread(self, agent_id: str):
        t = self._threads.pop(agent_id, None)
        if t:
            t.quit()
            t.wait()
            t.deleteLater()
        w = self._workers.pop(agent_id, None)
        if w:
            w.deleteLater()

    def _update_agent_count(self):
        n = sum(1 for t in self._agent_tiles.values() if hasattr(t, "_status") and t._status == "running")
        self._agent_count_lbl.setText(f"{n} active")

    def _toggle_activate(self):
        if not self._project:
            return
        name = self._project.get("name")
        if self._project.get("active"):
            set_active_project(None)
            self._project["active"] = False
        else:
            set_active_project(name)
            self._project["active"] = True
        self.load_project(self._project)

    def _open_cmd(self):
        path = self._project.get("path", "")
        if path:
            try:
                subprocess.Popen(["cmd.exe", "/k", f"cd /d {path}"],
                                 creationflags=subprocess.CREATE_NEW_CONSOLE)
            except Exception:
                pass

    def _open_ps(self):
        path = self._project.get("path", "")
        if path:
            try:
                subprocess.Popen(
                    ["powershell.exe", "-NoExit", "-Command", f"Set-Location '{path}'"],
                    creationflags=subprocess.CREATE_NEW_CONSOLE,
                )
            except Exception:
                pass


# ── page root ─────────────────────────────────────────────────────────────────
class ProjectPage(QWidget):
    """Antigravity-style project workspace page."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setStyleSheet(f"background:{C.BG};")
        self._build()

    def _build(self):
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # Left sidebar
        self._sidebar = _ProjectSidebar()
        self._sidebar.project_selected.connect(self._on_project_selected)
        self._sidebar.project_added.connect(self._on_project_added)
        lay.addWidget(self._sidebar)

        # Right workspace
        self._workspace = _ProjectWorkspace()
        lay.addWidget(self._workspace, stretch=1)

        # Load initial project
        projects = _load_projects()
        if projects:
            active = next((p for p in projects if p.get("active")), projects[0])
            self._workspace.load_project(active)

    def _on_project_selected(self, proj: dict):
        self._workspace.load_project(proj)

    def _on_project_added(self):
        self._sidebar._refresh()
        projects = _load_projects()
        if projects:
            self._workspace.load_project(projects[-1])

    def run_task(self, goal: str):
        """Called externally (e.g. from DeerFlow task dispatch) to push a task."""
        self._workspace._task_input.setPlainText(goal)
        self._workspace._run_task()
