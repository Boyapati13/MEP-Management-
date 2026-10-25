"""Skills page — browse and manage OCTO capability modules."""
from __future__ import annotations
import json
import threading
from pathlib import Path
from PyQt6.QtCore import pyqtSignal
from PyQt6.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton
from PyQt6.QtGui import QFont
from .base import OctoPage, PRI, ACC2, GREEN, RED, TEXT_MED, TEXT_DIM, BORDER, PANEL, WHITE

_SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"


class SkillsPage(OctoPage):
    _refresh_sig = pyqtSignal(list)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._refresh_sig.connect(self._render)
        self._build()

    def _build(self):
        lay = self.page_layout()

        hdr = QHBoxLayout()
        hdr.addWidget(self.lbl("◈  OCTO CAPABILITIES HUB", 11, bold=True, color=PRI))
        hdr.addStretch()
        ref = self.btn("↺ Refresh", color=PRI, height=26)
        ref.clicked.connect(lambda: threading.Thread(target=self._load, daemon=True).start())
        hdr.addWidget(ref)
        lay.addLayout(hdr)
        lay.addWidget(self.lbl(
            "Procedural memory — skills teach OCTO how to handle specific domains.",
            7, color=TEXT_DIM, wrap=True))
        lay.addWidget(self.sep())

        # ── Search DeerFlow skills ──
        lay.addWidget(self.lbl("SEARCH SKILLS", 8, bold=True, color=ACC2))
        search_row = QHBoxLayout(); search_row.setSpacing(6)
        self._search_f = self.field("e.g. github, docker, aws", height=30)
        search_b = self.btn("Search", color=ACC2, height=30)
        search_b.clicked.connect(self._search)
        search_row.addWidget(self._search_f, stretch=1)
        search_row.addWidget(search_b)
        lay.addLayout(search_row)
        self._search_results = QVBoxLayout(); self._search_results.setSpacing(3)
        lay.addLayout(self._search_results)
        lay.addWidget(self.sep())

        # ── Installed skills ──
        lay.addWidget(self.lbl("INSTALLED SKILLS", 8, bold=True, color=PRI))
        self._inst_layout = QVBoxLayout(); self._inst_layout.setSpacing(4)
        lay.addLayout(self._inst_layout)
        lay.addStretch()

        threading.Thread(target=self._load, daemon=True).start()

    def _load(self):
        """Load skills directly from deerflow_bridge (embedded skill catalog)."""
        skills: list = []
        try:
            from deerflow_bridge import list_local_skills
            skills = list_local_skills()
        except Exception:
            pass

        # Also scan octo/skills/ directory
        try:
            from skills.skill_manager import list_skills
            for s in list_skills():
                if not any(x.get("id") == s.get("id") for x in skills):
                    skills.append(s)
        except Exception:
            pass

        self._refresh_sig.emit(skills)

    def _render(self, skills: list):
        while self._inst_layout.count():
            item = self._inst_layout.takeAt(0)
            if item.widget(): item.widget().deleteLater()

        if not skills:
            self._inst_layout.addWidget(
                self.lbl("No skills found. The skill catalog is in octo/deerflow/skills/.",
                         8, color=TEXT_DIM, wrap=True))
            return

        for s in skills:
            name = s.get("name") or s.get("id", "unknown")
            desc = s.get("description", "")[:80]
            card = QWidget()
            card.setStyleSheet(f"background:{PANEL};border:1px solid {BORDER};border-radius:3px;")
            cl = QHBoxLayout(card); cl.setContentsMargins(10, 6, 10, 6); cl.setSpacing(8)
            cl.addWidget(self.lbl("📚", 10))
            info = QVBoxLayout(); info.setSpacing(1)
            info.addWidget(self.lbl(name, 9, bold=True, color=ACC2))
            if desc:
                info.addWidget(self.lbl(desc, 7, color=TEXT_DIM))
            cl.addLayout(info, stretch=1)
            view_b = self.btn("View", color=PRI, height=22)
            view_b.clicked.connect(lambda _, sid=s.get("id", name): self._view_skill(sid))
            cl.addWidget(view_b)
            self._inst_layout.addWidget(card)

    def _search(self):
        query = self._search_f.text().strip()
        while self._search_results.count():
            item = self._search_results.takeAt(0)
            if item.widget(): item.widget().deleteLater()

        if not query:
            return

        def _run():
            try:
                from deerflow_bridge import search_skills
                results = search_skills(query)
                for s in results[:6]:
                    name = s.get("name") or s.get("id", "")
                    desc = s.get("description", "")[:80]
                    card = QWidget()
                    card.setStyleSheet(
                        f"background:{PANEL};border:1px solid #1a5c7a;border-radius:3px;")
                    cl = QHBoxLayout(card); cl.setContentsMargins(8, 5, 8, 5); cl.setSpacing(6)
                    info = QVBoxLayout(); info.setSpacing(1)
                    info.addWidget(self.lbl(name, 8, bold=True, color=ACC2))
                    if desc:
                        info.addWidget(self.lbl(desc, 7, color=TEXT_DIM))
                    cl.addLayout(info, stretch=1)
                    self._search_results.addWidget(card)
                if not results:
                    self._search_results.addWidget(
                        self.lbl(f"No skills found for '{query}'.", 7, color=TEXT_DIM))
            except Exception as e:
                self._search_results.addWidget(self.lbl(str(e)[:80], 7, color=RED))

        threading.Thread(target=_run, daemon=True).start()

    def _view_skill(self, skill_id: str):
        try:
            from deerflow_bridge import get_skill_content
            content = get_skill_content(skill_id)
            if content:
                from PyQt6.QtWidgets import QDialog, QTextEdit, QVBoxLayout
                dlg = QDialog(self)
                dlg.setWindowTitle(f"Skill: {skill_id}")
                dlg.resize(700, 500)
                te = QTextEdit(); te.setReadOnly(True)
                te.setPlainText(content)
                te.setStyleSheet(f"background:#000d14;color:#d8f8ff;border:none;font-family:Courier New;font-size:9pt;")
                v = QVBoxLayout(dlg); v.addWidget(te)
                dlg.exec()
        except Exception as e:
            print(f"[OCTO] Skill view error: {e}")
