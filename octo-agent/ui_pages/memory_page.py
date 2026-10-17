"""Memory page — view and edit OCTO's long-term user memory."""
from __future__ import annotations
import threading
from PyQt6.QtCore import pyqtSignal, QTimer
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QLineEdit, QComboBox, QFrame,
)
from PyQt6.QtGui import QFont
from .base import OctoPage, PRI, ACC2, GREEN, RED, TEXT_MED, TEXT_DIM, BORDER, PANEL, WHITE, TEXT


class MemoryPage(OctoPage):
    _refresh_sig = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._refresh_sig.connect(self._render)
        lay = self.page_layout()

        # ── header ──
        hdr = QHBoxLayout()
        hdr.addWidget(self.lbl("◈  USER MEMORY", 11, bold=True, color=PRI))
        hdr.addStretch()
        ref = self.btn("↺ Refresh", color=PRI, height=26)
        ref.clicked.connect(lambda: threading.Thread(target=self._load, daemon=True).start())
        hdr.addWidget(ref)
        lay.addLayout(hdr)
        lay.addWidget(self.lbl("Facts OCTO remembers about you. Stored in memory/long_term.json.",
                               7, color=TEXT_DIM))
        lay.addWidget(self.sep())

        # ── add new memory ──
        lay.addWidget(self.lbl("ADD MEMORY", 8, bold=True, color=ACC2))
        add_row = QHBoxLayout(); add_row.setSpacing(6)
        self._cat_cb = QComboBox()
        self._cat_cb.addItems(["identity","preferences","projects","relationships","wishes","notes"])
        self._cat_cb.setFixedHeight(28)
        self._cat_cb.setFont(QFont("Courier New", 8))
        self._cat_cb.setStyleSheet(f"""
            QComboBox{{background:#000d14;color:{WHITE};border:1px solid {BORDER};
                border-radius:3px;padding:2px 6px;}}
            QComboBox::drop-down{{border:none;}}
            QComboBox QAbstractItemView{{background:{PANEL};color:{TEXT};border:1px solid {BORDER};}}""")
        self._key_f  = self.field("key  (e.g. name)", height=28)
        self._val_f  = self.field("value  (e.g. Alice)", height=28)
        save_b = self.btn("+ Save", color=GREEN, height=28)
        save_b.clicked.connect(self._save_entry)
        add_row.addWidget(self._cat_cb, 1)
        add_row.addWidget(self._key_f, 2)
        add_row.addWidget(self._val_f, 3)
        add_row.addWidget(save_b)
        lay.addLayout(add_row)
        self._msg_lbl = self.lbl("", 7, color=GREEN)
        lay.addWidget(self._msg_lbl)
        lay.addWidget(self.sep())

        # ── memory display ──
        self._mem_container = QVBoxLayout(); self._mem_container.setSpacing(4)
        lay.addLayout(self._mem_container)
        lay.addStretch()

        self._memory_data: dict = {}
        threading.Thread(target=self._load, daemon=True).start()

    def _load(self):
        try:
            from memory.memory_manager import load_memory
            self._memory_data = load_memory()
        except Exception as e:
            self._memory_data = {}
        self._refresh_sig.emit()

    def _render(self):
        # Clear existing
        while self._mem_container.count():
            item = self._mem_container.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        COLORS = {"identity": PRI, "preferences": ACC2, "projects": GREEN,
                  "relationships": "#ff88cc", "wishes": "#cc88ff", "notes": TEXT_MED}

        total = 0
        for cat, items in self._memory_data.items():
            if not isinstance(items, dict) or not items:
                continue
            # Category header
            cat_lbl = QLabel(f"  {cat.upper()}")
            cat_lbl.setFont(QFont("Courier New", 7, QFont.Weight.Bold))
            col = COLORS.get(cat, TEXT_MED)
            cat_lbl.setStyleSheet(f"color:{col};background:transparent;")
            self._mem_container.addWidget(cat_lbl)

            for key, entry in items.items():
                val = entry.get("value") if isinstance(entry, dict) else str(entry)
                upd = entry.get("updated", "") if isinstance(entry, dict) else ""
                if not val:
                    continue
                total += 1
                row = QHBoxLayout(); row.setSpacing(6)
                row_w = QWidget()
                row_w.setStyleSheet(f"background:{PANEL};border:1px solid {BORDER};border-radius:3px;")
                rl = QHBoxLayout(row_w); rl.setContentsMargins(8,4,8,4); rl.setSpacing(6)

                kl = QLabel(key.replace("_"," ")); kl.setFixedWidth(120)
                kl.setFont(QFont("Courier New", 8, QFont.Weight.Bold))
                kl.setStyleSheet(f"color:{col};background:transparent;")
                vl = QLabel(str(val)[:80]); vl.setWordWrap(True)
                vl.setFont(QFont("Courier New", 8))
                vl.setStyleSheet(f"color:{WHITE};background:transparent;")
                dl = QLabel(upd); dl.setFixedWidth(70)
                dl.setFont(QFont("Courier New", 7))
                dl.setStyleSheet(f"color:{TEXT_DIM};background:transparent;")
                del_b = QPushButton("✕"); del_b.setFixedSize(20,20)
                del_b.setFont(QFont("Courier New", 8))
                del_b.setCursor(__import__("PyQt6.QtCore", fromlist=["Qt"]).Qt.CursorShape.PointingHandCursor)
                del_b.setStyleSheet(f"QPushButton{{background:transparent;color:{TEXT_DIM};border:none;}} QPushButton:hover{{color:{RED};}}")
                del_b.clicked.connect(lambda _, c=cat, k=key: self._delete(c, k))

                rl.addWidget(kl); rl.addWidget(vl, stretch=1)
                rl.addWidget(dl); rl.addWidget(del_b)
                self._mem_container.addWidget(row_w)

        if total == 0:
            self._mem_container.addWidget(
                self.lbl("No memories stored yet. OCTO will save facts automatically during conversation.",
                         8, color=TEXT_DIM, wrap=True))

    def _save_entry(self):
        cat = self._cat_cb.currentText()
        key = self._key_f.text().strip()
        val = self._val_f.text().strip()
        if not key or not val:
            self._msg_lbl.setText("Both key and value are required.")
            self._msg_lbl.setStyleSheet(f"color:{RED};background:transparent;")
            return
        try:
            from memory.memory_manager import update_memory
            update_memory({cat: {key: {"value": val}}})
            self._key_f.clear(); self._val_f.clear()
            self._msg_lbl.setText(f"Saved: {cat}/{key}")
            self._msg_lbl.setStyleSheet(f"color:{GREEN};background:transparent;")
            threading.Thread(target=self._load, daemon=True).start()
        except Exception as e:
            self._msg_lbl.setText(f"Error: {e}")

    def _delete(self, cat: str, key: str):
        try:
            from memory.memory_manager import forget
            forget(key, cat)
            threading.Thread(target=self._load, daemon=True).start()
        except Exception as e:
            print(f"[OCTO] Memory delete error: {e}")
