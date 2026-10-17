"""Proxy page — Model Routing Proxy (free-claude-code) control centre with Ollama backup."""
from __future__ import annotations
import socket
import threading
from PyQt6.QtCore import pyqtSignal, Qt, QTimer
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QLineEdit, QComboBox, QFrame,
)
from PyQt6.QtGui import QFont
from .base import (
    OctoPage, PRI, PRI_DIM, PRI_GHO, ACC2, GREEN, GREEN_D, RED,
    TEXT_MED, TEXT_DIM, BORDER, BORDER_B, PANEL, PANEL2, WHITE, DARK,
)

# ─── Providers that have dedicated directories in proxy/providers/ ───────────
_PROXY_PROVIDERS = [
    # (config_key,             label,                                    masked)
    ("gemini_api_key",        "Gemini API Key (General OCTO Core)",     True),
    ("gemini_trading_api_key","Gemini Trading Suggestions Key (MT5)",   True),
    ("anthropic_auth_token",  "Anthropic Auth Token  (direct route)",  True),
    ("openrouter_api_key",    "OpenRouter API Key",                     True),
    ("deepseek_api_key",      "DeepSeek API Key  (Sonnet-tier)",        True),
    ("kimi_api_key",          "Kimi / Moonshot API Key  (Opus-tier)",   True),
    ("nvidia_nim_api_key",    "NVIDIA NIM API Key  (Opus-tier)",        True),
    ("fireworks_api_key",     "Fireworks AI API Key  (Opus-tier)",      True),
    ("zai_api_key",           "Z.ai API Key",                           True),
    ("wafer_api_key",         "Wafer API Key  (Sonnet-tier)",           True),
]

_TIERS = [
    (PRI,   "OPUS   (Pro / Ultra)",   "NVIDIA NIM  ·  Kimi Moonshot  ·  Fireworks"),
    (ACC2,  "SONNET (Standard)",      "DeepSeek  ·  Wafer  ·  OpenRouter  ·  Anthropic"),
    (GREEN, "HAIKU  (Flash / Local)", "Local Ollama  ·  llama.cpp  ·  LM Studio"),
]

# Popular Ollama models the proxy's Ollama provider can serve
_OLLAMA_MODELS = [
    ("gemma3:12b",           "Gemma 3 12B",            "Google"),
    ("gemma3:4b",            "Gemma 3 4B",             "Google"),
    ("llama3.2:latest",      "Llama 3.2",              "Meta"),
    ("llama3.1:8b",          "Llama 3.1 8B",           "Meta"),
    ("mistral:latest",       "Mistral 7B",             "Mistral AI"),
    ("mixtral:8x7b",         "Mixtral 8×7B",           "Mistral AI"),
    ("qwen2.5-coder:7b",     "Qwen 2.5 Coder 7B",      "Alibaba"),
    ("codellama:13b",        "CodeLlama 13B",          "Meta"),
    ("phi4:latest",          "Phi-4",                  "Microsoft"),
    ("deepseek-r1:8b",       "DeepSeek R1 8B",         "DeepSeek"),
]

# Keys that have no auto-test endpoint
_NO_TEST_KEYS = {"zai_api_key", "wafer_api_key"}

# Dot colours
_DOT_GREY  = "#555566"
_DOT_GREEN = "#00ff88"
_DOT_RED   = "#ff3355"


class ProxyPage(OctoPage):
    _status_sig   = pyqtSignal(str)
    _ollama_sig   = pyqtSignal(list)    # fires with list[str] of discovered model tags
    _validate_sig = pyqtSignal(str, str)  # (key_name, result)  "ok:..." | "err:..."

    def __init__(self, parent=None):
        super().__init__(parent)
        self._status_sig.connect(self._on_status)
        self._ollama_sig.connect(self._on_ollama_models)
        self._validate_sig.connect(self._on_validate_result)
        self._fields: dict[str, QLineEdit] = {}
        self._key_dots: dict[str, QLabel] = {}
        self._status_lbl: QLabel | None = None
        self._ollama_url_f: QLineEdit | None = None
        self._ollama_model_cb: QComboBox | None = None
        self._live_models: list[str] = []
        self._cfg = self._load_cfg()
        self._build()

        # Port health monitor
        self._port_timer = QTimer(self)
        self._port_timer.timeout.connect(self._check_proxy_port)
        self._port_timer.start(3000)
        self._check_proxy_port()

    # ── persistence ──────────────────────────────────────────────────────────
    def _load_cfg(self) -> dict:
        try:
            from memory.config_manager import load_proxy_keys, load_api_keys
            data = {**load_proxy_keys(), **load_api_keys()}
            return data
        except Exception:
            return {}

    def _do_save_all(self):
        try:
            self._save_cfg()
            self._on_status("✓ Proxy keys and Ollama settings saved.")
        except Exception as e:
            self._on_status(f"✕ Save failed: {e}")

    def _save_cfg(self) -> None:
        keys = {k: f.text().strip() for k, f in self._fields.items()}
        if hasattr(self, "_trading_model_cb") and self._trading_model_cb:
            keys["gemini_trading_model"] = self._trading_model_cb.currentText().strip()
        try:
            from memory.config_manager import save_proxy_keys, sync_proxy_env
            save_proxy_keys(keys)
            sync_proxy_env()
            
            # Hot-reload proxy settings if in-process
            try:
                from proxy.config_fcc.settings import get_settings
                get_settings.cache_clear()
            except Exception:
                pass
            try:
                from config.settings import get_settings
                get_settings.cache_clear()
            except Exception:
                pass
        except Exception as e:
            print(f"[OCTO] Proxy save error: {e}")
            raise

        # Save ollama URL + selected model
        if self._ollama_url_f:
            url = self._ollama_url_f.text().strip() or "http://localhost:11434"
            try:
                from memory.config_manager import _load_json, _save_json, CONFIG_FILE
                data = _load_json(CONFIG_FILE, {})
                data["ollama_base_url"] = url
                if self._ollama_model_cb and self._ollama_model_cb.currentText():
                    txt = self._ollama_model_cb.currentText()
                    if "  [" in txt:
                        txt = txt.split("  [")[0]
                    data["ollama_model"] = txt
                _save_json(CONFIG_FILE, data)
            except Exception as e:
                print(f"[OCTO] Ollama cfg save: {e}")
                raise

    # ── port health ───────────────────────────────────────────────────────────
    def _check_proxy_port(self):
        is_up = False
        try:
            with socket.create_connection(("127.0.0.1", 8082), timeout=0.5):
                is_up = True
        except OSError:
            pass

        if is_up:
            self._proxy_status.setText("● ACTIVE  [127.0.0.1:8082]")
            self._proxy_status.setStyleSheet(
                f"color:{GREEN};background:transparent;font-weight:bold;"
            )
        else:
            self._proxy_status.setText("○ OFFLINE")
            self._proxy_status.setStyleSheet(
                f"color:{TEXT_DIM};background:transparent;"
            )

    # ── Ollama discovery ──────────────────────────────────────────────────────
    def _discover_ollama(self):
        url = (self._ollama_url_f.text().strip()
               if self._ollama_url_f else "") or "http://localhost:11434"
        self._status_sig.emit(f"Scanning {url} for Ollama models…")
        def _run():
            try:
                import requests
                r = requests.get(f"{url}/api/tags", timeout=5)
                if r.ok:
                    tags = [m["name"] for m in r.json().get("models", [])]
                    self._ollama_sig.emit(tags)
                else:
                    self._ollama_sig.emit([])
                    self._status_sig.emit("Ollama not reachable — start Ollama first.")
            except Exception as e:
                self._ollama_sig.emit([])
                self._status_sig.emit(f"Ollama: {e}")
        threading.Thread(target=_run, daemon=True).start()

    def _on_ollama_models(self, models: list[str]):
        if not self._ollama_model_cb:
            return
        self._live_models = models
        self._ollama_model_cb.clear()
        self._ollama_model_cb.addItem("— select model —")
        for m in models:
            self._ollama_model_cb.addItem(m)
        # Restore previously saved selection
        saved = self._cfg.get("ollama_model", "")
        if saved:
            idx = self._ollama_model_cb.findText(saved)
            if idx >= 0:
                self._ollama_model_cb.setCurrentIndex(idx)
        if models:
            self._status_sig.emit(f"Discovered {len(models)} Ollama model(s).")
        else:
            self._status_sig.emit("No Ollama models found — try 'ollama pull gemma3:4b'.")

    # ── validate result handler (main thread) ─────────────────────────────────
    def _on_validate_result(self, key_name: str, result: str):
        dot = self._key_dots.get(key_name)
        if not dot:
            return
        if result.startswith("ok:"):
            detail = result[3:]
            dot.setText("●")
            dot.setStyleSheet(
                f"color:{_DOT_GREEN};background:transparent;border:none;font-weight:bold;"
            )
            msg = f"✓ {key_name}: connected"
            if detail:
                msg += f" ({detail})"
            self._on_status(msg)
        elif result.startswith("err:"):
            detail = result[4:]
            dot.setText("●")
            dot.setStyleSheet(
                f"color:{_DOT_RED};background:transparent;border:none;font-weight:bold;"
            )
            self._on_status(f"✗ {key_name}: {detail}")
        else:
            dot.setText("?")
            dot.setStyleSheet(
                f"color:{_DOT_GREY};background:transparent;border:none;"
            )

    # ── validate key in background thread ────────────────────────────────────
    def _validate_key(self, key_name: str, value: str):
        # Reset dot to spinning state
        dot = self._key_dots.get(key_name)
        if dot:
            dot.setText("⋯")
            dot.setStyleSheet(
                f"color:{TEXT_DIM};background:transparent;border:none;"
            )

        if not value:
            self._validate_sig.emit(key_name, "err:No key entered")
            return

        if key_name in _NO_TEST_KEYS:
            self._validate_sig.emit(
                key_name, "err:No test endpoint — save and test via proxy"
            )
            return

        def _run():
            try:
                import requests as _req
            except ImportError:
                self._validate_sig.emit(key_name, "err:'requests' not installed")
                return

            try:
                if key_name in ("gemini_api_key", "gemini_trading_api_key"):
                    r = _req.get(
                        f"https://generativelanguage.googleapis.com/v1beta/models?key={value}",
                        timeout=8
                    )
                    if r.status_code == 200:
                        self._validate_sig.emit(key_name, "ok:Gemini API")
                    else:
                        self._validate_sig.emit(key_name, f"err:HTTP {r.status_code}")

                elif key_name == "anthropic_auth_token":
                    payload = {
                        "model": "claude-3-haiku-20240307",
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "hi"}],
                    }
                    r = _req.post(
                        "https://api.anthropic.com/v1/messages",
                        headers={
                            "x-api-key": value,
                            "anthropic-version": "2023-06-01",
                            "content-type": "application/json",
                        },
                        json=payload,
                        timeout=10,
                    )
                    if r.status_code == 401:
                        self._validate_sig.emit(key_name, "err:Unauthorized (401)")
                    else:
                        self._validate_sig.emit(key_name, "ok:Anthropic API")

                elif key_name == "openrouter_api_key":
                    r = _req.get(
                        "https://openrouter.ai/api/v1/auth/key",
                        headers={"Authorization": f"Bearer {value}"},
                        timeout=8,
                    )
                    if r.status_code == 200:
                        data = r.json()
                        label = data.get("data", {}).get("label", "")
                        self._validate_sig.emit(key_name, f"ok:{label}")
                    else:
                        self._validate_sig.emit(
                            key_name, f"err:HTTP {r.status_code}"
                        )

                elif key_name == "deepseek_api_key":
                    r = _req.get(
                        "https://api.deepseek.com/user/balance",
                        headers={"Authorization": f"Bearer {value}"},
                        timeout=8,
                    )
                    if r.status_code == 401:
                        self._validate_sig.emit(key_name, "err:Unauthorized (401)")
                    else:
                        self._validate_sig.emit(key_name, "ok:DeepSeek API")

                elif key_name == "kimi_api_key":
                    r = _req.get(
                        "https://api.moonshot.cn/v1/models",
                        headers={"Authorization": f"Bearer {value}"},
                        timeout=8,
                    )
                    if r.status_code == 200:
                        self._validate_sig.emit(key_name, "ok:Moonshot API")
                    else:
                        self._validate_sig.emit(
                            key_name, f"err:HTTP {r.status_code}"
                        )

                elif key_name == "nvidia_nim_api_key":
                    r = _req.get(
                        "https://integrate.api.nvidia.com/v1/models",
                        headers={"Authorization": f"Bearer {value}"},
                        timeout=8,
                    )
                    if r.status_code == 200:
                        self._validate_sig.emit(key_name, "ok:NVIDIA NIM API")
                    else:
                        self._validate_sig.emit(
                            key_name, f"err:HTTP {r.status_code}"
                        )

                elif key_name == "fireworks_api_key":
                    r = _req.get(
                        "https://api.fireworks.ai/inference/v1/models",
                        headers={"Authorization": f"Bearer {value}"},
                        timeout=8,
                    )
                    if r.status_code == 200:
                        self._validate_sig.emit(key_name, "ok:Fireworks API")
                    else:
                        self._validate_sig.emit(
                            key_name, f"err:HTTP {r.status_code}"
                        )

                else:
                    self._validate_sig.emit(key_name, "err:Unknown provider")

            except Exception as exc:
                self._validate_sig.emit(key_name, f"err:{exc}")

        threading.Thread(target=_run, daemon=True).start()

    # ── build ─────────────────────────────────────────────────────────────────
    def _build(self):
        lay = self.page_layout()

        # Header
        hdr = QHBoxLayout()
        hdr.addWidget(self.lbl("◈  MODEL ROUTING PROXY", 11, bold=True, color=PRI))
        hdr.addStretch()
        self._proxy_status = self.lbl("○ CHECKING", 7, color=TEXT_DIM)
        hdr.addWidget(self._proxy_status)
        lay.addLayout(hdr)

        self._status_lbl = self.lbl(
            "The embedded free-claude-code proxy intercepts Anthropic-format requests and routes "
            "them to the best available backend. Add keys below — the proxy picks the cheapest active tier.",
            7, color=TEXT_DIM, wrap=True,
        )
        lay.addWidget(self._status_lbl)
        lay.addWidget(self.sep())

        # ── Routing tiers ──
        lay.addWidget(self.lbl("ROUTING TIERS", 8, bold=True, color=ACC2))
        for col, tier, backends in _TIERS:
            row = QHBoxLayout(); row.setSpacing(10)
            t = QLabel(f"  {tier}")
            t.setFont(QFont("Courier New", 8, QFont.Weight.Bold))
            t.setStyleSheet(f"color:{col};background:transparent;min-width:180px;")
            b = QLabel(backends)
            b.setFont(QFont("Courier New", 7))
            b.setStyleSheet(f"color:{TEXT_MED};background:transparent;")
            row.addWidget(t); row.addWidget(b, stretch=1)
            lay.addLayout(row)
        lay.addWidget(self.sep())

        # ── API Keys ──
        lay.addWidget(self.lbl("PROVIDER API KEYS  (synced to ~/.fcc/.env)", 8, bold=True, color=PRI))
        lay.addWidget(self.lbl(
            "Add at least one key. Leave others blank. The proxy auto-selects based on availability.",
            7, color=TEXT_DIM, wrap=True))

        for key_name, label_text, is_pwd in _PROXY_PROVIDERS:
            saved_val = self._cfg.get(key_name, "")
            row = QHBoxLayout(); row.setSpacing(6)

            lbl = QLabel(label_text)
            lbl.setFont(QFont("Courier New", 7))
            lbl.setFixedWidth(260)
            lbl.setStyleSheet(f"color:{TEXT_MED};background:transparent;border:none;")

            f = QLineEdit(saved_val)
            f.setPlaceholderText("Leave blank if unused")
            f.setFixedHeight(26)
            f.setFont(QFont("Courier New", 8))
            if is_pwd:
                f.setEchoMode(QLineEdit.EchoMode.Password)
            f.setStyleSheet(f"""QLineEdit{{background:#000d14;color:{WHITE};
                border:1px solid {BORDER};border-radius:3px;padding:2px 6px;}}
                QLineEdit:focus{{border:1px solid {PRI};}}""")

            # ✓ Test button
            test_btn = QPushButton("✓ Test")
            test_btn.setFixedHeight(22)
            test_btn.setFixedWidth(52)
            test_btn.setFont(QFont("Courier New", 7, QFont.Weight.Bold))
            test_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            test_btn.setStyleSheet(f"""QPushButton{{background:transparent;color:{ACC2};
                border:1px solid {ACC2}55;border-radius:3px;padding:0 4px;}}
                QPushButton:hover{{background:#0a0a1a;border-color:{ACC2};}}""")
            # capture key_name and field in closure
            test_btn.clicked.connect(
                lambda _, kn=key_name, fld=f: self._validate_key(kn, fld.text().strip())
            )

            # Status dot
            dot = QLabel("?")
            dot.setFixedWidth(14)
            dot.setFont(QFont("Courier New", 9, QFont.Weight.Bold))
            dot.setAlignment(Qt.AlignmentFlag.AlignCenter)
            dot.setStyleSheet(
                f"color:{_DOT_GREY};background:transparent;border:none;"
            )
            self._key_dots[key_name] = dot

            row.addWidget(lbl)
            row.addWidget(f, stretch=1)
            row.addWidget(test_btn)
            row.addWidget(dot)
            lay.addLayout(row)
            self._fields[key_name] = f

            if key_name == "gemini_trading_api_key":
                model_row = QHBoxLayout(); model_row.setSpacing(6)
                model_lbl = QLabel("Gemini Trading Suggestions Model")
                model_lbl.setFont(QFont("Courier New", 7))
                model_lbl.setFixedWidth(260)
                model_lbl.setStyleSheet(f"color:{TEXT_MED};background:transparent;border:none;")

                self._trading_model_cb = QComboBox()
                self._trading_model_cb.setFixedHeight(26)
                self._trading_model_cb.setEditable(True)
                self._trading_model_cb.setFont(QFont("Courier New", 8))
                self._trading_model_cb.setStyleSheet(f"""
                    QComboBox{{background:#000d14;color:{WHITE};border:1px solid {BORDER};
                        border-radius:3px;padding:2px 6px;}}
                    QComboBox::drop-down{{border:none;}}
                    QComboBox QAbstractItemView{{background:{PANEL};color:{WHITE};border:1px solid {BORDER};}}
                    QComboBox:focus{{border:1px solid {PRI};}}
                """)

                models = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-flash", "gemini-1.5-pro"]
                for m in models:
                    self._trading_model_cb.addItem(m)

                saved_model = self._cfg.get("gemini_trading_model", "gemini-3.5-flash")
                if saved_model:
                    idx = self._trading_model_cb.findText(saved_model)
                    if idx >= 0:
                        self._trading_model_cb.setCurrentIndex(idx)
                    else:
                        self._trading_model_cb.setCurrentText(saved_model)

                placeholder_btn = QLabel("")
                placeholder_btn.setFixedWidth(52)
                placeholder_dot = QLabel("")
                placeholder_dot.setFixedWidth(14)

                model_row.addWidget(model_lbl)
                model_row.addWidget(self._trading_model_cb, stretch=1)
                model_row.addWidget(placeholder_btn)
                model_row.addWidget(placeholder_dot)
                lay.addLayout(model_row)

        lay.addWidget(self.sep())

        # ── Ollama / Local Model Backup ──
        lay.addWidget(self.lbl("OLLAMA — LOCAL MODEL BACKUP  (Haiku tier)", 8, bold=True, color=GREEN))
        lay.addWidget(self.lbl(
            "Ollama lets you run Gemma, Llama, Mistral, DeepSeek and more entirely on your machine — "
            "no API key required. Install Ollama, then click Detect.",
            7, color=TEXT_DIM, wrap=True))

        url_row = QHBoxLayout(); url_row.setSpacing(6)
        url_lbl = QLabel("Ollama URL")
        url_lbl.setFont(QFont("Courier New", 7))
        url_lbl.setFixedWidth(80)
        url_lbl.setStyleSheet(f"color:{TEXT_MED};background:transparent;border:none;")
        saved_url = self._cfg.get("ollama_base_url", "http://localhost:11434")
        self._ollama_url_f = QLineEdit(saved_url)
        self._ollama_url_f.setFixedHeight(26)
        self._ollama_url_f.setFont(QFont("Courier New", 8))
        self._ollama_url_f.setStyleSheet(f"""QLineEdit{{background:#000d14;color:{WHITE};
            border:1px solid {BORDER};border-radius:3px;padding:2px 6px;}}
            QLineEdit:focus{{border:1px solid {GREEN};}}""")
        detect_b = QPushButton("⟳  Detect Models")
        detect_b.setFixedHeight(26)
        detect_b.setFont(QFont("Courier New", 7, QFont.Weight.Bold))
        detect_b.setCursor(Qt.CursorShape.PointingHandCursor)
        detect_b.setStyleSheet(f"""QPushButton{{background:transparent;color:{GREEN};
            border:1px solid {GREEN_D};border-radius:3px;padding:0 8px;}}
            QPushButton:hover{{background:#001a0d;border-color:{GREEN};}}""")
        detect_b.clicked.connect(self._discover_ollama)
        url_row.addWidget(url_lbl); url_row.addWidget(self._ollama_url_f, stretch=1)
        url_row.addWidget(detect_b)
        lay.addLayout(url_row)

        model_row = QHBoxLayout(); model_row.setSpacing(6)
        model_lbl = QLabel("Backup Model")
        model_lbl.setFont(QFont("Courier New", 7))
        model_lbl.setFixedWidth(80)
        model_lbl.setStyleSheet(f"color:{TEXT_MED};background:transparent;border:none;")
        self._ollama_model_cb = QComboBox()
        self._ollama_model_cb.setFixedHeight(26)
        self._ollama_model_cb.setFont(QFont("Courier New", 8))
        self._ollama_model_cb.setStyleSheet(f"""
            QComboBox{{background:#000d14;color:{WHITE};border:1px solid {BORDER};
                border-radius:3px;padding:2px 6px;}}
            QComboBox::drop-down{{border:none;}}
            QComboBox QAbstractItemView{{background:{PANEL};color:{WHITE};border:1px solid {BORDER};}}
            QComboBox:focus{{border:1px solid {GREEN};}}
        """)
        # Pre-populate with common models + previously saved
        self._ollama_model_cb.addItem("— detect or type a model name —")
        for tag, name, vendor in _OLLAMA_MODELS:
            self._ollama_model_cb.addItem(f"{tag}  [{vendor}]")
        saved_model = self._cfg.get("ollama_model", "")
        if saved_model:
            idx = self._ollama_model_cb.findText(saved_model, Qt.MatchFlag.MatchStartsWith)
            if idx >= 0:
                self._ollama_model_cb.setCurrentIndex(idx)
        model_row.addWidget(model_lbl)
        model_row.addWidget(self._ollama_model_cb, stretch=1)
        lay.addLayout(model_row)

        # Popular model quick-pull grid
        lay.addWidget(self.lbl("QUICK INSTALL MODELS  (click to copy pull command)", 7, color=TEXT_DIM))
        grid_row: list[QWidget] = []
        for tag, name, vendor in _OLLAMA_MODELS[:8]:
            chip = QPushButton(f"{name}")
            chip.setFixedHeight(22)
            chip.setFont(QFont("Courier New", 7))
            chip.setCursor(Qt.CursorShape.PointingHandCursor)
            chip.setToolTip(f"ollama pull {tag}")
            chip.setStyleSheet(f"""QPushButton{{background:{PANEL2};color:{GREEN};
                border:1px solid {BORDER};border-radius:3px;padding:0 6px;}}
                QPushButton:hover{{border-color:{GREEN};background:#001a0d;}}""")
            chip.clicked.connect(lambda _, t=tag: self._copy_pull_cmd(t))
            grid_row.append(chip)

        for i in range(0, len(grid_row), 4):
            hr = QHBoxLayout(); hr.setSpacing(4)
            for w in grid_row[i:i+4]:
                hr.addWidget(w, stretch=1)
            if len(grid_row[i:i+4]) < 4:
                hr.addStretch()
            lay.addLayout(hr)

        lay.addWidget(self.sep())
        save_row = QHBoxLayout()
        save_b = self.btn("▸  SAVE && SYNC ALL SETTINGS", color=PRI, height=34)
        save_b.clicked.connect(self._do_save_all)
        save_row.addStretch(); save_row.addWidget(save_b)
        lay.addLayout(save_row)
        lay.addStretch()

    # ── actions ───────────────────────────────────────────────────────────────
    def _on_status(self, msg: str):
        if self._status_lbl:
            self._status_lbl.setText(msg)

    def _copy_pull_cmd(self, tag: str):
        """Copy 'ollama pull <tag>' to the clipboard."""
        try:
            from PyQt6.QtWidgets import QApplication
            QApplication.clipboard().setText(f"ollama pull {tag}")
            self._on_status(f"Copied: ollama pull {tag} — paste into your terminal.")
        except Exception:
            pass
