"""Shared helpers and styles for all OCTO pages — Premium Dark Theme."""
from __future__ import annotations
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QLineEdit, QFrame, QScrollArea, QTextEdit, QCheckBox,
)
from PyQt6.QtGui import QFont, QColor
from PyQt6.QtCore import Qt, pyqtSignal

# ── Premium colour palette ────────────────────────────────────────────────────
BG       = "#060b18"
PANEL    = "#0c1225"
PANEL2   = "#101830"
BORDER   = "#1a2744"
BORDER_B = "#2a4070"
PRI      = "#4da6ff"
PRI_DIM  = "#2970b8"
PRI_GHO  = "#0d1f3a"
ACC      = "#ff7a33"
ACC2     = "#f0b840"
GREEN    = "#2ddb8a"
GREEN_D  = "#1a9960"
RED      = "#f04060"
TEXT     = "#c8d8f0"
TEXT_DIM = "#556888"
TEXT_MED = "#7a98c0"
WHITE    = "#e8f0ff"
DARK     = "#080e1c"

# ── Typography ────────────────────────────────────────────────────────────────
FONT_UI   = "Segoe UI"      # primary UI font (Windows native)
FONT_DATA = "Consolas"       # monospaced for data/numbers
FONT_SIZE_XS = 7
FONT_SIZE_SM = 8
FONT_SIZE_MD = 9
FONT_SIZE_LG = 11
FONT_SIZE_XL = 14


class OctoPage(QWidget):
    """Base class for all OCTO feature pages."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setStyleSheet(f"background: {BG};")

    # ── shared widget factories ───────────────────────────────────────────────
    @staticmethod
    def lbl(text: str, size: float = 8, bold: bool = False,
            color: str = TEXT, wrap: bool = False) -> QLabel:
        w = QLabel(text)
        w.setFont(QFont(FONT_UI, int(size),
                        QFont.Weight.Bold if bold else QFont.Weight.Normal))
        w.setStyleSheet(f"color: {color}; background: transparent;")
        w.setWordWrap(wrap)
        return w

    @staticmethod
    def data_lbl(text: str, size: float = 9, bold: bool = True,
                 color: str = WHITE) -> QLabel:
        """Label specifically for data/numbers using monospace font."""
        w = QLabel(text)
        w.setFont(QFont(FONT_DATA, int(size),
                        QFont.Weight.Bold if bold else QFont.Weight.Normal))
        w.setStyleSheet(f"color: {color}; background: transparent;")
        return w

    @staticmethod
    def sep() -> QFrame:
        s = QFrame(); s.setFrameShape(QFrame.Shape.HLine)
        s.setStyleSheet(f"color: {BORDER}; margin: 2px 0;")
        return s

    @staticmethod
    def field(ph: str = "", val: str = "", echo: bool = False,
              height: int = 32) -> QLineEdit:
        f = QLineEdit(val); f.setPlaceholderText(ph)
        f.setFont(QFont(FONT_UI, 9)); f.setFixedHeight(height)
        if echo: f.setEchoMode(QLineEdit.EchoMode.Password)
        f.setStyleSheet(f"""
            QLineEdit {{
                background: {DARK};
                color: {WHITE};
                border: 1px solid {BORDER};
                border-radius: 6px;
                padding: 4px 10px;
            }}
            QLineEdit:focus {{
                border: 1px solid {PRI};
                background: #0a1428;
            }}""")
        return f

    @staticmethod
    def btn(text: str, color: str = PRI, height: int = 32) -> QPushButton:
        b = QPushButton(text); b.setFixedHeight(height)
        b.setFont(QFont(FONT_UI, 8, QFont.Weight.Bold))
        b.setCursor(Qt.CursorShape.PointingHandCursor)
        b.setStyleSheet(f"""
            QPushButton {{
                background: transparent;
                color: {color};
                border: 1px solid {color};
                border-radius: 6px;
                padding: 0 14px;
            }}
            QPushButton:hover {{
                background: rgba({_hex_to_rgb_str(color)}, 0.12);
                border-color: {color};
            }}
            QPushButton:pressed {{
                background: rgba({_hex_to_rgb_str(color)}, 0.22);
            }}""")
        return b

    @staticmethod
    def card(title: str, color: str = PRI) -> QWidget:
        w = QWidget()
        w.setStyleSheet(f"""
            background: qlineargradient(x1:0, y1:0, x2:0, y2:1,
                stop:0 {PANEL}, stop:1 {DARK});
            border: 1px solid {BORDER};
            border-radius: 8px;
        """)
        lay = QVBoxLayout(w); lay.setContentsMargins(12, 10, 12, 10); lay.setSpacing(6)
        t = QLabel(title); t.setFont(QFont(FONT_UI, 8, QFont.Weight.Bold))
        t.setStyleSheet(f"color:{color};background:transparent;border:none;letter-spacing:0.5px;")
        lay.addWidget(t)
        return w, lay

    @staticmethod
    def scrollable(inner_widget: QWidget) -> QScrollArea:
        sa = QScrollArea(); sa.setWidgetResizable(True)
        sa.setStyleSheet(f"""
            QScrollArea {{background:transparent;border:none;}}
            QScrollBar:vertical {{background:{PANEL};width:6px;border-radius:3px;}}
            QScrollBar::handle:vertical {{background:{BORDER_B};border-radius:3px;}}""")
        sa.setWidget(inner_widget)
        return sa

    def page_layout(self) -> QVBoxLayout:
        """Return a pre-configured VBoxLayout for the page with scroll."""
        inner = QWidget(); inner.setStyleSheet("background:transparent;")
        lay = QVBoxLayout(inner); lay.setContentsMargins(16, 12, 16, 12); lay.setSpacing(8)
        sa = self.scrollable(inner)
        root = QVBoxLayout(self); root.setContentsMargins(0,0,0,0)
        root.addWidget(sa)
        return lay


def _hex_to_rgb_str(hex_color: str) -> str:
    """Convert '#RRGGBB' to 'R, G, B' string for rgba() CSS usage."""
    h = hex_color.lstrip('#')
    if len(h) == 6:
        return f"{int(h[0:2], 16)}, {int(h[2:4], 16)}, {int(h[4:6], 16)}"
    return "255, 255, 255"
