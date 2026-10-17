"""Gateway page — configure and launch OCTO messaging gateway on all platforms."""
from __future__ import annotations
import json
import socket
import threading
import urllib.parse
from datetime import datetime
from pathlib import Path
from PyQt6.QtCore import pyqtSignal, Qt, QTimer
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QLineEdit, QFrame, QDialog,
)
from PyQt6.QtGui import QFont, QPixmap
import requests

from .base import (
    OctoPage, PRI, PRI_DIM, ACC2, GREEN, GREEN_D, RED, TEXT_MED, TEXT_DIM,
    BORDER, BORDER_B, PANEL, PANEL2, WHITE, DARK,
)

# ── Platform catalogue — all have matching channel implementations ─────────────
_PLATFORMS = [
    {
        "id": "telegram", "name": "TELEGRAM", "icon": "✈", "color": "#2CA5E0",
        "fields": [
            ("token",         "Bot token  (from @BotFather)",       True),
            ("allowed_users", "Your Telegram user IDs  (comma-sep)", False),
        ],
        "hint": "Telegram → @BotFather → /newbot  |  Your ID: @userinfobot",
        "impl": "channels.telegram_channel",
    },
    {
        "id": "discord", "name": "DISCORD", "icon": "🎮", "color": "#5865F2",
        "fields": [
            ("token",         "Bot token  (discord.com/developers)",  True),
            ("allowed_users", "Your Discord user IDs  (comma-sep)",   False),
        ],
        "hint": "Developer Portal → New App → Bot → Reset Token  |  Enable Message Content Intent",
        "impl": "channels.discord_channel",
    },
    {
        "id": "slack", "name": "SLACK", "icon": "#", "color": "#4A154B",
        "fields": [
            ("token",         "Bot token  xoxb-…",                   True),
            ("api_key",       "App token  xapp-…  (Socket Mode)",    True),
            ("allowed_users", "Member IDs  (comma-sep)",             False),
        ],
        "hint": "api.slack.com/apps → OAuth: xoxb token  |  Settings → Socket Mode: xapp token",
        "impl": "channels.slack_channel",
    },
    {
        "id": "whatsapp", "name": "WHATSAPP", "icon": "📱", "color": "#25D366",
        "fields": [
            ("allowed_users", "Allowed phones (comma-separated, or * for all)",  False),
        ],
        "hint": "Powered by local Node.js Baileys Bridge — click button below to generate a pairing QR!",
        "impl": "channels.whatsapp_channel",
    },
    {
        "id": "dingtalk", "name": "DINGTALK", "icon": "🔔", "color": "#FF6900",
        "fields": [
            ("webhook",       "Group webhook URL  (from DingTalk)",  True),
            ("secret",        "Signing secret  (optional)",          True),
        ],
        "hint": "DingTalk group → Settings → Robots → Add a robot → Webhook URL",
        "impl": "channels.dingtalk",
    },
    {
        "id": "feishu", "name": "FEISHU / LARK", "icon": "🕊", "color": "#00B96B",
        "fields": [
            ("app_id",        "App ID  (open.feishu.cn)",            True),
            ("app_secret",    "App Secret",                          True),
            ("allowed_users", "User open-IDs  (comma-sep)",          False),
        ],
        "hint": "Feishu Open Platform → Create App → Event Subscription",
        "impl": "channels.feishu",
    },
]

# Platforms that cannot be auto-tested
_NO_AUTO_TEST = {"whatsapp", "dingtalk", "feishu"}


class WhatsAppQRDialog(QDialog):
    """Cyberpunk WhatsApp QR pairing visual dialog."""
    qr_signal = pyqtSignal(bytes)
    status_signal = pyqtSignal(str, str)  # (text, color_hex)
    success_signal = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("📱 PAIR WHATSAPP VIA QR")
        self.setFixedSize(360, 420)
        self.setWindowFlags(self.windowFlags() | Qt.WindowType.CustomizeWindowHint)
        self.setWindowFlags(self.windowFlags() & ~Qt.WindowType.WindowCloseButtonHint)
        
        # Cyberpunk style matching gateway colors
        self.setStyleSheet("""
            QDialog {
                background-color: #000a10;
                border: 2px solid #25D366;
                border-radius: 8px;
            }
            QLabel {
                font-family: 'Courier New';
                color: #ffffff;
            }
            QPushButton {
                font-family: 'Courier New';
                font-weight: bold;
                background: transparent;
                border: 1px solid #25D366;
                color: #25D366;
                border-radius: 4px;
                padding: 6px 16px;
            }
            QPushButton:hover {
                background: #001a0d;
            }
            QPushButton:disabled {
                border-color: #333333;
                color: #555555;
            }
        """)

        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(20, 20, 20, 20)
        self.layout.setSpacing(15)

        # Title
        self.title_lbl = QLabel("◈ WHATSAPP PAIRING CYCLE ◈")
        self.title_lbl.setFont(QFont("Courier New", 11, QFont.Weight.Bold))
        self.title_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.title_lbl.setStyleSheet("color: #25D366;")
        self.layout.addWidget(self.title_lbl)

        # QR Placeholder Frame
        self.qr_label = QLabel()
        self.qr_label.setFixedSize(250, 250)
        self.qr_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.qr_label.setStyleSheet("border: 1px dashed #25D366; background: #000d14; border-radius: 4px;")
        self.qr_label.setText("INITIALIZING BRIDGE...\nPLEASE WAIT.")
        
        # Center QR code
        qr_container = QHBoxLayout()
        qr_container.addStretch()
        qr_container.addWidget(self.qr_label)
        qr_container.addStretch()
        self.layout.addLayout(qr_container)

        # Status indicator
        self.status_lbl = QLabel("Starting Node.js bridge...")
        self.status_lbl.setFont(QFont("Courier New", 8))
        self.status_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.status_lbl.setStyleSheet("color: #888888;")
        self.layout.addWidget(self.status_lbl)

        # Close/Cancel button
        self.close_btn = QPushButton("CANCEL")
        self.close_btn.clicked.connect(self.reject)
        self.layout.addWidget(self.close_btn)

        # Signals
        self.qr_signal.connect(self._on_qr_loaded)
        self.status_signal.connect(self._on_status)
        self.success_signal.connect(self._on_success)

        self.session_dir = Path.home() / ".octo" / "whatsapp" / "session"
        self.qr_path = self.session_dir / "qr.txt"
        self.creds_path = self.session_dir / "creds.json"
        
        # Clean up any stale qr.txt first
        if self.qr_path.exists():
            try:
                self.qr_path.unlink()
            except Exception:
                pass

        self.running = True
        self.paired = False
        self.last_qr = ""
        
        # Start bridge thread
        threading.Thread(target=self._run_pairing, daemon=True).start()
        # Start file polling thread
        threading.Thread(target=self._poll_files, daemon=True).start()

    def _run_pairing(self):
        try:
            from channels.whatsapp_channel import WhatsAppChannel
            ch = WhatsAppChannel(None, {"port": 3005})
            ch.pair_qr()
        except Exception as e:
            self.status_signal.emit(f"Bridge error: {e}", "#ff3355")

    def _poll_files(self):
        import time
        start_time = time.time()
        
        while self.running:
            if self.creds_path.exists() and not self.qr_path.exists():
                self.paired = True
                self.success_signal.emit()
                break
                
            if time.time() - start_time > 120:
                self.status_signal.emit("Pairing timed out. Please try again.", "#ff3355")
                break

            if self.qr_path.exists():
                try:
                    qr_data = self.qr_path.read_text(encoding="utf-8").strip()
                    if qr_data and qr_data != self.last_qr:
                        self.last_qr = qr_data
                        self.status_signal.emit("QR Code generated. Scan now!", "#25D366")
                        
                        encoded = urllib.parse.quote(qr_data)
                        url = f"https://api.qrserver.com/v1/create-qr-code/?size=250x250&data={encoded}"
                        r = requests.get(url, timeout=5)
                        if r.status_code == 200 and self.running:
                            self.qr_signal.emit(r.content)
                except Exception:
                    pass
                    
            time.sleep(1)

    def _on_qr_loaded(self, img_data: bytes):
        pixmap = QPixmap()
        pixmap.loadFromData(img_data)
        self.qr_label.setPixmap(pixmap)

    def _on_status(self, text: str, color: str):
        self.status_lbl.setText(text)
        self.status_lbl.setStyleSheet(f"color: {color};")

    def _on_success(self):
        self.title_lbl.setText("◈ CONNECTION SECURED ◈")
        self.title_lbl.setStyleSheet("color: #00ff88;")
        self.status_lbl.setText("✓ SUCCESS: Connected! Device paired.")
        self.status_lbl.setStyleSheet("color: #00ff88; font-weight: bold;")
        
        self.qr_label.setPixmap(QPixmap())  # Clear pixmap
        self.qr_label.setText("✓ SUCCESS\nCONNECTED")
        self.qr_label.setStyleSheet("border: 2px solid #00ff88; background: #001a0d; color: #00ff88; font-size: 14pt; font-weight: bold;")
        self.close_btn.setText("DONE")
        self.close_btn.setStyleSheet("""
            QPushButton {
                background: #001a0d;
                border: 2px solid #00ff88;
                color: #00ff88;
            }
            QPushButton:hover {
                background: #00331a;
            }
        """)

    def reject(self):
        self.running = False
        super().reject()


class GatewayPage(OctoPage):
    _status_sig = pyqtSignal(str)
    _state_sig  = pyqtSignal(bool)   # True = gateway running
    _test_sig   = pyqtSignal(str, str)  # (pid, result_html_text)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._status_sig.connect(self._on_status)
        self._state_sig.connect(self._on_gw_state)
        self._test_sig.connect(self._on_test_result)
        self._fields: dict[str, dict[str, QLineEdit]] = {}
        self._test_labels: dict[str, QLabel] = {}
        self._status_lbl: QLabel | None = None
        self._cfg = self._load_cfg()
        self._build()

        # Poll gateway port
        self._gw_timer = QTimer(self)
        self._gw_timer.timeout.connect(self._poll_gateway)
        self._gw_timer.start(5000)
        self._poll_gateway()

    # ── persistence ──────────────────────────────────────────────────────────
    def _load_cfg(self) -> dict:
        try:
            from memory.config_manager import load_gateway_config
            return load_gateway_config()
        except Exception:
            return {}

    def _save_cfg(self) -> dict:
        data: dict = {}
        for pid, flds in self._fields.items():
            vals = {k: f.text().strip() for k, f in flds.items() if f.text().strip()}
            if vals:
                vals["enabled"] = True
                data[pid] = vals
        try:
            from memory.config_manager import save_gateway_config
            save_gateway_config(data)
        except Exception as e:
            print(f"[OCTO] Gateway save error: {e}")
        return data

    # ── port polling ─────────────────────────────────────────────────────────
    def _poll_gateway(self):
        try:
            with socket.create_connection(("127.0.0.1", 2026), timeout=0.5):
                self._state_sig.emit(True)
        except OSError:
            self._state_sig.emit(False)

    def _on_gw_state(self, running: bool):
        ts = datetime.now().strftime("%H:%M:%S")
        if running:
            self._gw_status.setText(f"● ACTIVE  [2026]  {ts}")
            self._gw_status.setStyleSheet(f"color:{GREEN};background:transparent;font-weight:bold;")
            self._gw_btn.setText("▪  GATEWAY RUNNING")
            self._gw_btn.setStyleSheet(f"""QPushButton{{background:transparent;color:{TEXT_DIM};
                border:1px solid {BORDER};border-radius:3px;padding:0 12px;}}""")
            self._gw_btn.setEnabled(False)
        else:
            self._gw_status.setText(f"○ OFFLINE  {ts}")
            self._gw_status.setStyleSheet(f"color:{TEXT_DIM};background:transparent;")
            self._gw_btn.setText("▸  START GATEWAY")
            self._gw_btn.setStyleSheet(f"""QPushButton{{background:transparent;color:{GREEN};
                border:1px solid {GREEN_D};border-radius:3px;padding:0 12px;}}
                QPushButton:hover{{background:#001a0d;border-color:{GREEN};}}""")
            self._gw_btn.setEnabled(True)

    # ── test result handler (main thread via signal) ──────────────────────────
    def _on_test_result(self, pid: str, html: str):
        lbl = self._test_labels.get(pid)
        if lbl:
            lbl.setText(html)

    # ── build ─────────────────────────────────────────────────────────────────
    def _build(self):
        lay = self.page_layout()

        # Header
        hdr = QHBoxLayout()
        hdr.addWidget(self.lbl("◈  OCTO MESSAGING GATEWAY", 11, bold=True, color=PRI))
        hdr.addStretch()
        self._gw_status = self.lbl("○ CHECKING", 7, color=TEXT_DIM)
        hdr.addWidget(self._gw_status)

        # ⟳ REFRESH STATUS button
        refresh_btn = QPushButton("⟳  REFRESH STATUS")
        refresh_btn.setFixedHeight(30)
        refresh_btn.setFont(QFont("Courier New", 8, QFont.Weight.Bold))
        refresh_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        refresh_btn.setStyleSheet(f"""QPushButton{{background:transparent;color:{ACC2};
            border:1px solid {ACC2}55;border-radius:3px;padding:0 10px;}}
            QPushButton:hover{{background:#0a0a1a;border-color:{ACC2};}}""")
        refresh_btn.clicked.connect(self._refresh_all)
        hdr.addWidget(refresh_btn)

        self._gw_btn = QPushButton("▸  START GATEWAY")
        self._gw_btn.setFixedHeight(30)
        self._gw_btn.setFont(QFont("Courier New", 9, QFont.Weight.Bold))
        self._gw_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._gw_btn.setStyleSheet(f"""QPushButton{{background:transparent;color:{GREEN};
            border:1px solid {GREEN_D};border-radius:3px;padding:0 12px;}}
            QPushButton:hover{{background:#001a0d;border-color:{GREEN};}}""")
        self._gw_btn.clicked.connect(self._start_gateway)
        hdr.addWidget(self._gw_btn)
        lay.addLayout(hdr)

        self._status_lbl = self.lbl(
            "Configure a messaging platform below, save, then click Start Gateway. "
            "The gateway runs on port 2026 — messages sent to your bot arrive here.",
            7, color=TEXT_DIM, wrap=True,
        )
        lay.addWidget(self._status_lbl)
        lay.addWidget(self.sep())

        # Platform cards
        for p in _PLATFORMS:
            lay.addWidget(self._platform_card(p))
            lay.addSpacing(4)

        lay.addWidget(self.sep())

        # Footer buttons
        footer = QHBoxLayout()
        save_b = self.btn("▸  SAVE ALL CHANNEL SETTINGS", color=PRI, height=34)
        save_b.clicked.connect(lambda: [self._save_cfg(),
                                        self._on_status("✓ Channel settings saved.")])
        footer.addStretch(); footer.addWidget(save_b)
        lay.addLayout(footer)
        lay.addStretch()

    def _platform_card(self, p: dict) -> QWidget:
        pid   = p["id"]
        saved = self._cfg.get(pid, {})
        has   = bool(saved)
        color = p["color"]

        card = QWidget()
        card.setStyleSheet(f"""QWidget{{background:{PANEL};
            border:1px solid {"#1a5c7a" if has else BORDER};border-radius:6px;}}""")
        cl = QVBoxLayout(card)
        cl.setContentsMargins(14, 10, 14, 10)
        cl.setSpacing(6)

        # Card header
        ch = QHBoxLayout()
        icon_l = QLabel(p["icon"])
        icon_l.setFont(QFont("Segoe UI Emoji", 15))
        icon_l.setStyleSheet(f"color:{color};background:transparent;border:none;")
        name_l = QLabel(p["name"])
        name_l.setFont(QFont("Courier New", 10, QFont.Weight.Bold))
        name_l.setStyleSheet(f"color:{color};background:transparent;border:none;")
        impl_l = QLabel(p["impl"].split(".")[-1])
        impl_l.setFont(QFont("Courier New", 7))
        impl_l.setStyleSheet(f"color:{TEXT_DIM};background:transparent;border:none;")
        status_l = QLabel("● CONFIGURED" if has else "○ NOT SET")
        status_l.setFont(QFont("Courier New", 7, QFont.Weight.Bold))
        status_l.setStyleSheet(
            f"color:{GREEN if has else TEXT_DIM};background:transparent;border:none;"
        )
        ch.addWidget(icon_l)
        ch.addWidget(name_l)
        ch.addWidget(impl_l)
        ch.addStretch()
        ch.addWidget(status_l)
        cl.addLayout(ch)

        # Hint
        hint = QLabel(p["hint"])
        hint.setFont(QFont("Courier New", 7))
        hint.setStyleSheet(f"color:{TEXT_DIM};background:transparent;border:none;")
        hint.setWordWrap(True)
        cl.addWidget(hint)

        # Fields
        self._fields[pid] = {}
        for fname, fph, fecho in p["fields"]:
            fr = QHBoxLayout(); fr.setSpacing(6)
            fl = QLabel(fname)
            fl.setFixedWidth(130)
            fl.setFont(QFont("Courier New", 7))
            fl.setStyleSheet(f"color:{TEXT_MED};background:transparent;border:none;")
            ff = QLineEdit(str(saved.get(fname, "")))
            ff.setPlaceholderText(fph)
            ff.setFixedHeight(26)
            ff.setFont(QFont("Courier New", 8))
            if fecho:
                ff.setEchoMode(QLineEdit.EchoMode.Password)
            ff.setStyleSheet(f"""QLineEdit{{background:#000d14;color:{WHITE};
                border:1px solid {BORDER};border-radius:3px;padding:2px 6px;}}
                QLineEdit:focus{{border:1px solid {color};}}""")
            fr.addWidget(fl); fr.addWidget(ff, stretch=1)
            cl.addLayout(fr)
            self._fields[pid][fname] = ff

        # WhatsApp extra: QR pair button
        if pid == "whatsapp":
            pair_b = QPushButton("📱  Pair WhatsApp via QR")
            pair_b.setFixedHeight(26)
            pair_b.setFont(QFont("Courier New", 7, QFont.Weight.Bold))
            pair_b.setCursor(Qt.CursorShape.PointingHandCursor)
            pair_b.setStyleSheet(f"""QPushButton{{background:transparent;color:{color};
                border:1px solid {color}55;border-radius:3px;padding:0 10px;}}
                QPushButton:hover{{background:#001a0d;}}""")
            pair_b.clicked.connect(self._pair_whatsapp)
            cl.addWidget(pair_b)

        # ── Bottom action row: SAVE  +  ▸ TEST ────────────────────────────────
        btn_row = QHBoxLayout(); btn_row.setSpacing(6)

        save_btn = QPushButton("▸  SAVE")
        save_btn.setFixedHeight(26)
        save_btn.setFont(QFont("Courier New", 8, QFont.Weight.Bold))
        save_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        save_btn.setStyleSheet(f"""QPushButton{{background:transparent;color:{PRI};
            border:1px solid {PRI_DIM};border-radius:3px;padding:0 10px;}}
            QPushButton:hover{{background:#000d1f;border-color:{PRI};}}""")
        save_btn.clicked.connect(lambda _, _pid=pid: self._save_single(pid))

        test_btn = QPushButton("▸ TEST")
        test_btn.setFixedHeight(26)
        test_btn.setFont(QFont("Courier New", 8, QFont.Weight.Bold))
        test_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        test_btn.setStyleSheet(f"""QPushButton{{background:transparent;color:{color};
            border:1px solid {color}77;border-radius:3px;padding:0 10px;}}
            QPushButton:hover{{background:#0a0a0a;border-color:{color};}}""")
        test_btn.clicked.connect(lambda _, _pid=pid: self._test_platform(_pid))

        btn_row.addStretch()
        btn_row.addWidget(save_btn)
        btn_row.addWidget(test_btn)
        cl.addLayout(btn_row)

        # Test result label (inline, below buttons)
        test_lbl = QLabel("")
        test_lbl.setFont(QFont("Courier New", 7))
        test_lbl.setStyleSheet("background:transparent;border:none;")
        test_lbl.setAlignment(Qt.AlignmentFlag.AlignRight)
        test_lbl.setWordWrap(True)
        cl.addWidget(test_lbl)
        self._test_labels[pid] = test_lbl

        return card

    # ── per-card save ─────────────────────────────────────────────────────────
    def _save_single(self, pid: str):
        self._save_cfg()
        self._on_status(f"✓ {pid.capitalize()} settings saved.")

    # ── test platform connection ──────────────────────────────────────────────
    def _test_platform(self, pid: str):
        lbl = self._test_labels.get(pid)
        if lbl:
            lbl.setText(f"<span style='color:{TEXT_DIM};'>⋯ testing…</span>")

        p_meta = next((p for p in _PLATFORMS if p["id"] == pid), None)
        if not p_meta:
            return
        name = p_meta["name"]

        if pid in _NO_AUTO_TEST:
            self._test_sig.emit(
                pid,
                f"<span style='color:{TEXT_DIM};'>ℹ Cannot auto-test {name} — check your connection manually.</span>",
            )
            return

        flds = self._fields.get(pid, {})
        token = flds.get("token", QLineEdit()).text().strip()

        if not token:
            self._test_sig.emit(
                pid,
                f"<span style='color:{RED};'>✗ No token entered — fill in the token field first.</span>",
            )
            return

        def _run():
            try:
                import requests as _req
            except ImportError:
                self._test_sig.emit(
                    pid,
                    f"<span style='color:{RED};'>✗ 'requests' not installed — pip install requests</span>",
                )
                return

            try:
                if pid == "telegram":
                    r = _req.get(
                        f"https://api.telegram.org/bot{token}/getMe",
                        timeout=8,
                    )
                    data = r.json()
                    if data.get("ok"):
                        uname = data.get("result", {}).get("username", "?")
                        self._test_sig.emit(
                            pid,
                            f"<span style='color:{GREEN};'>✓ Connected as @{uname}</span>",
                        )
                    else:
                        err = data.get("description", "unknown error")
                        self._test_sig.emit(
                            pid,
                            f"<span style='color:{RED};'>✗ Invalid token: {err}</span>",
                        )

                elif pid == "discord":
                    r = _req.get(
                        "https://discord.com/api/v10/users/@me",
                        headers={"Authorization": f"Bot {token}"},
                        timeout=8,
                    )
                    if r.status_code == 200:
                        uname = r.json().get("username", "?")
                        self._test_sig.emit(
                            pid,
                            f"<span style='color:{GREEN};'>✓ Connected as @{uname}</span>",
                        )
                    else:
                        err = r.json().get("message", str(r.status_code))
                        self._test_sig.emit(
                            pid,
                            f"<span style='color:{RED};'>✗ Invalid token: {err}</span>",
                        )

                elif pid == "slack":
                    r = _req.post(
                        "https://slack.com/api/auth.test",
                        headers={"Authorization": f"Bearer {token}"},
                        timeout=8,
                    )
                    data = r.json()
                    if data.get("ok"):
                        uname = data.get("user", data.get("bot_id", "?"))
                        self._test_sig.emit(
                            pid,
                            f"<span style='color:{GREEN};'>✓ Connected as @{uname}</span>",
                        )
                    else:
                        err = data.get("error", "unknown")
                        self._test_sig.emit(
                            pid,
                            f"<span style='color:{RED};'>✗ Invalid token: {err}</span>",
                        )

                else:
                    self._test_sig.emit(
                        pid,
                        f"<span style='color:{TEXT_DIM};'>ℹ No auto-test for {pid}.</span>",
                    )

            except Exception as exc:
                self._test_sig.emit(
                    pid,
                    f"<span style='color:{RED};'>✗ Request error: {exc}</span>",
                )

        threading.Thread(target=_run, daemon=True).start()

    # ── refresh all statuses ──────────────────────────────────────────────────
    def _refresh_all(self):
        self._poll_gateway()
        self._on_status("↻ Refreshing platform statuses…")
        for p in _PLATFORMS:
            pid = p["id"]
            flds = self._fields.get(pid, {})
            token_field = flds.get("token")
            if token_field and token_field.text().strip():
                self._test_platform(pid)

    # ── actions ───────────────────────────────────────────────────────────────
    def _on_status(self, msg: str):
        if self._status_lbl:
            self._status_lbl.setText(msg)

    def _start_gateway(self):
        cfg = self._save_cfg()
        self._gw_btn.setEnabled(False)
        self._on_status("Starting gateway threads…")

        def _run():
            try:
                from agent.hermes_bridge import start_gateway

                def on_msg(channel: str, user: str, text: str):
                    try:
                        from main import handle_gateway_message
                        handle_gateway_message(channel, user, text)
                    except Exception:
                        pass

                started = start_gateway(on_message=on_msg)
                if started:
                    self._status_sig.emit(f"✓ Gateway running: {', '.join(started)}")
                else:
                    self._status_sig.emit(
                        "Gateway started — no platforms configured with valid tokens yet."
                    )
            except Exception as e:
                self._status_sig.emit(f"Error: {e}")
            finally:
                self._gw_btn.setEnabled(True)

        threading.Thread(target=_run, daemon=True).start()

    def _pair_whatsapp(self):
        self._on_status("Opening WhatsApp visual QR pairing dialog...")
        try:
            dialog = WhatsAppQRDialog(self)
            dialog.exec()
            self._on_status("Visual QR Pairing Dialog dismissed.")
        except Exception as e:
            self._on_status(f"WhatsApp pairing error: {e}")
