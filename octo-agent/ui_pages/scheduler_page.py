"""Scheduler page — create and manage OCTO recurring tasks."""
from __future__ import annotations
import threading
from PyQt6.QtCore import pyqtSignal, QTimer
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
)
from PyQt6.QtGui import QFont
from .base import OctoPage, PRI, ACC2, GREEN, GREEN_D, RED, TEXT_MED, TEXT_DIM, BORDER, PANEL, WHITE


_QUICK_SCHEDULES = [
    ("Every morning 9am",  "0 9 * * *"),
    ("Every evening 6pm",  "0 18 * * *"),
    ("Every Monday 9am",   "0 9 * * 1"),
    ("Hourly",             "0 * * * *"),
    ("Every 30 min",       "*/30 * * * *"),
    ("Daily midnight",     "0 0 * * *"),
]


class SchedulerPage(OctoPage):
    _refresh_sig = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._refresh_sig.connect(self._render_jobs)
        lay = self.page_layout()

        # ── header ──
        hdr = QHBoxLayout()
        hdr.addWidget(self.lbl("◈  OCTO SCHEDULER", 11, bold=True, color=PRI))
        hdr.addStretch()
        ref = self.btn("↺ Refresh", color=PRI, height=26)
        ref.clicked.connect(lambda: threading.Thread(target=self._load, daemon=True).start())
        hdr.addWidget(ref)
        lay.addLayout(hdr)
        lay.addWidget(self.lbl("Schedule recurring tasks — OCTO will run them automatically using the full tool suite.",
                               7, color=TEXT_DIM, wrap=True))
        lay.addWidget(self.sep())

        # ── create form ──
        lay.addWidget(self.lbl("CREATE SCHEDULE", 8, bold=True, color=ACC2))

        lay.addWidget(self.lbl("What OCTO should do:", 7, color=TEXT_MED))
        self._prompt_f = self.field("e.g. Check the weather and send me a summary", height=32)
        lay.addWidget(self._prompt_f)

        lay.addWidget(self.lbl("When (cron expression or select below):", 7, color=TEXT_MED))
        sched_row = QHBoxLayout(); sched_row.setSpacing(6)
        self._sched_f = self.field("0 9 * * *  (min hour day month weekday)", height=28)
        sched_row.addWidget(self._sched_f, stretch=1)
        lay.addLayout(sched_row)

        # Quick-pick buttons
        qp_row = QHBoxLayout(); qp_row.setSpacing(4)
        for label, expr in _QUICK_SCHEDULES:
            b = QPushButton(label); b.setFixedHeight(22)
            b.setFont(QFont("Courier New", 7))
            b.setCursor(__import__("PyQt6.QtCore", fromlist=["Qt"]).Qt.CursorShape.PointingHandCursor)
            b.setStyleSheet(f"""QPushButton{{background:{PANEL};color:{TEXT_MED};
                border:1px solid {BORDER};border-radius:3px;padding:0 5px;}}
                QPushButton:hover{{color:{PRI};border-color:{PRI};}}""")
            b.clicked.connect(lambda _, e=expr: self._sched_f.setText(e))
            qp_row.addWidget(b)
        qp_row.addStretch()
        lay.addLayout(qp_row)

        lay.addWidget(self.lbl("Label (optional):", 7, color=TEXT_MED))
        self._label_f = self.field("e.g. Morning briefing", height=28)
        lay.addWidget(self._label_f)

        create_row = QHBoxLayout()
        create_b = self.btn("+ Create Schedule", color=GREEN, height=32)
        create_b.clicked.connect(self._create)
        self._create_msg = self.lbl("", 7, color=GREEN)
        create_row.addWidget(create_b)
        create_row.addWidget(self._create_msg, stretch=1)
        lay.addLayout(create_row)
        lay.addWidget(self.sep())

        # ── job list ──
        lay.addWidget(self.lbl("ACTIVE SCHEDULES", 8, bold=True, color=PRI))
        self._jobs_layout = QVBoxLayout(); self._jobs_layout.setSpacing(4)
        lay.addLayout(self._jobs_layout)
        lay.addStretch()

        threading.Thread(target=self._load, daemon=True).start()
        self._timer = QTimer(self); self._timer.timeout.connect(
            lambda: threading.Thread(target=self._load, daemon=True).start())
        self._timer.start(5000)

    def _load(self):
        try:
            from agent.hermes_bridge import list_scheduled
            self._jobs = list_scheduled()
        except Exception:
            self._jobs = []
        self._refresh_sig.emit()

    def _render_jobs(self):
        while self._jobs_layout.count():
            item = self._jobs_layout.takeAt(0)
            if item.widget(): item.widget().deleteLater()

        if not self._jobs:
            self._jobs_layout.addWidget(
                self.lbl("No schedules yet. Create one above.", 8, color=TEXT_DIM))
            return

        for job in self._jobs:
            enabled = job.get("enabled", True)
            label   = job.get("label") or job.get("prompt", "")
            sched   = job.get("schedule", "")
            jid     = str(job.get("id", ""))[:8]
            prompt  = job.get("prompt", "")[:60]

            card = QWidget()
            card.setStyleSheet(f"background:{PANEL};border:1px solid {BORDER};border-radius:4px;")
            cl = QHBoxLayout(card); cl.setContentsMargins(10,6,10,6); cl.setSpacing(8)

            status_dot = QLabel("●")
            status_dot.setFont(QFont("Courier New", 10))
            status_dot.setStyleSheet(f"color:{GREEN if enabled else TEXT_DIM};background:transparent;")
            cl.addWidget(status_dot)

            info = QVBoxLayout(); info.setSpacing(1)
            info.addWidget(self.lbl(label[:48] or prompt[:48], 8, bold=True, color=ACC2))
            info.addWidget(self.lbl(f"{sched}  ·  #{jid}", 7, color=TEXT_DIM))
            if prompt and prompt != label:
                info.addWidget(self.lbl(prompt[:60], 7, color=TEXT_MED, wrap=True))
            cl.addLayout(info, stretch=1)

            del_b = self.btn("✕ Delete", color=RED, height=24)
            del_b.clicked.connect(lambda _, j=job.get("id",""): self._delete(str(j)))
            cl.addWidget(del_b)
            self._jobs_layout.addWidget(card)

    def _create(self):
        prompt = self._prompt_f.text().strip()
        sched  = self._sched_f.text().strip()
        label  = self._label_f.text().strip()
        if not prompt or not sched:
            self._create_msg.setText("Prompt and schedule are required.")
            self._create_msg.setStyleSheet(f"color:{RED};background:transparent;")
            return

        def _run():
            try:
                from agent.hermes_bridge import create_scheduled
                job = create_scheduled(prompt, sched, label)
                if job:
                    self._create_msg.setText(f"Created: {label or prompt[:30]}")
                else:
                    self._create_msg.setText("Failed — check cron expression.")
                    self._create_msg.setStyleSheet(f"color:{RED};background:transparent;")
                self._load()
            except Exception as e:
                self._create_msg.setText(str(e)[:60])

        self._create_msg.setText("Creating…")
        self._create_msg.setStyleSheet(f"color:{ACC2};background:transparent;")
        threading.Thread(target=_run, daemon=True).start()

    def _delete(self, job_id: str):
        def _run():
            try:
                from agent.hermes_bridge import delete_scheduled
                delete_scheduled(job_id)
                self._load()
            except Exception as e:
                print(f"[OCTO] Scheduler delete: {e}")
        threading.Thread(target=_run, daemon=True).start()
