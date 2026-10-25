from __future__ import annotations

import json
import math
import os
import platform
import random
import subprocess
import sys
import threading
import time
from pathlib import Path

import psutil

# Pre-import QtWebEngineWidgets to satisfy Chromium OpenGL context requirements before QCoreApplication initialization
try:
    from PyQt6.QtWebEngineWidgets import QWebEngineView
except ImportError:
    pass

from PyQt6.QtCore import (
    QEasingCurve, QMimeData, QObject, QPointF, QRectF, QSize, Qt,
    QTimer, QUrl, pyqtSignal,
)
from PyQt6.QtGui import (
    QBrush, QColor, QDragEnterEvent, QDropEvent, QFont, QFontDatabase,
    QKeySequence, QLinearGradient, QPainter, QPainterPath, QPen, QPixmap,
    QRadialGradient, QShortcut,
)
from PyQt6.QtWidgets import (
    QApplication, QFileDialog, QFrame, QHBoxLayout, QLabel, QLineEdit,
    QMainWindow, QPushButton, QScrollArea, QSizePolicy, QTextEdit,
    QVBoxLayout, QWidget, QProgressBar,
)

def _base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent

BASE_DIR   = _base_dir()
CONFIG_DIR = BASE_DIR / "config"
API_FILE   = CONFIG_DIR / "api_keys.json"

_DEFAULT_W, _DEFAULT_H = 980, 700
_MIN_W,     _MIN_H     = 820, 580
_LEFT_W  = 148
_RIGHT_W = 340

_OS = platform.system()  # "Windows" | "Darwin" | "Linux"

_DEFAULT_LIVE_MODEL = "models/gemini-2.5-flash-native-audio-latest"
_DEFAULT_TEXT_MODEL = "gemini-2.5-flash"


def _fetch_gemini_models(key: str) -> tuple[list[str], list[str]]:
    """Returns (live_models, text_models) for the given API key."""
    try:
        from google import genai
        client = genai.Client(api_key=key)
        live, text = [], []
        for m in client.models.list():
            name = m.name
            if "live" in name.lower():
                live.append(name)
            elif any(x in name.lower() for x in ("flash", "pro", "ultra")):
                text.append(name)
        return live, text
    except Exception as e:
        return [], []


class C:
    BG        = "#060b18"
    PANEL     = "#0c1225"
    PANEL2    = "#101830"
    BORDER    = "#1a2744"
    BORDER_B  = "#2a4070"
    BORDER_A  = "#2a4070"
    PRI       = "#4da6ff"
    PRI_DIM   = "#2970b8"
    PRI_GHO   = "#0d1f3a"
    ACC       = "#ff7a33"
    ACC2      = "#f0b840"
    GREEN     = "#2ddb8a"
    GREEN_D   = "#1a9960"
    RED       = "#f04060"
    MUTED_C   = "#f04060"
    TEXT      = "#c8d8f0"
    TEXT_DIM  = "#556888"
    TEXT_MED  = "#7a98c0"
    WHITE     = "#e8f0ff"
    DARK      = "#080e1c"
    BAR_BG    = "#0c1225"


FONT_UI   = "Segoe UI"
FONT_DATA = "Consolas"


def qcol(h: str, a: int = 255) -> QColor:
    c = QColor(h); c.setAlpha(a); return c

class _SysMetrics:
    def __init__(self):
        self.cpu  = 0.0
        self.mem  = 0.0
        self.net  = 0.0
        self.gpu  = -1.0
        self.tmp  = -1.0
        self._lock = threading.Lock()
        self._last_net = psutil.net_io_counters()
        self._last_net_t = time.time()
        self._running = True
        t = threading.Thread(target=self._loop, daemon=True)
        t.start()

    def _loop(self):
        while self._running:
            try:
                self._update()
            except Exception:
                pass
            time.sleep(1.5)

    def _update(self):
        cpu = psutil.cpu_percent(interval=None)
        mem = psutil.virtual_memory().percent

        nc  = psutil.net_io_counters()
        now = time.time()
        dt  = now - self._last_net_t
        if dt > 0:
            sent = (nc.bytes_sent - self._last_net.bytes_sent) / dt
            recv = (nc.bytes_recv - self._last_net.bytes_recv) / dt
            net  = (sent + recv) / (1024 * 1024)
        else:
            net = 0.0
        self._last_net   = nc
        self._last_net_t = now

        gpu = self._get_gpu()

        tmp = self._get_temp()

        with self._lock:
            self.cpu = cpu
            self.mem = mem
            self.net = net
            self.gpu = gpu
            self.tmp = tmp

    def _get_gpu(self) -> float:
        # NVIDIA
        try:
            r = subprocess.run(
                ["nvidia-smi", "--query-gpu=utilization.gpu",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=2
            )
            if r.returncode == 0:
                vals = [float(v.strip()) for v in r.stdout.strip().split("\n") if v.strip()]
                if vals:
                    return sum(vals) / len(vals)
        except Exception:
            pass

        # AMD (Linux)
        if _OS == "Linux":
            try:
                r = subprocess.run(
                    ["rocm-smi", "--showuse", "--csv"],
                    capture_output=True, text=True, timeout=2
                )
                if r.returncode == 0:
                    for line in r.stdout.strip().split("\n"):
                        parts = line.split(",")
                        if len(parts) >= 2:
                            try:
                                return float(parts[1].strip().replace("%", ""))
                            except ValueError:
                                pass
            except Exception:
                pass

            # Intel GPU (Linux)
            try:
                r = subprocess.run(
                    ["intel_gpu_top", "-J", "-s", "500"],
                    capture_output=True, text=True, timeout=1
                )
                if r.returncode == 0 and "Render/3D" in r.stdout:
                    import re
                    m = re.search(r'"busy":\s*([\d.]+)', r.stdout)
                    if m:
                        return float(m.group(1))
            except Exception:
                pass

        # macOS — powermetrics (GPU Engine)
        if _OS == "Darwin":
            try:
                r = subprocess.run(
                    ["sudo", "-n", "powermetrics", "-n", "1", "-i", "500",
                     "--samplers", "gpu_power"],
                    capture_output=True, text=True, timeout=2
                )
                if r.returncode == 0 and "GPU" in r.stdout:
                    import re
                    m = re.search(r'GPU\s+Active:\s+([\d.]+)%', r.stdout)
                    if m:
                        return float(m.group(1))
            except Exception:
                pass

        return -1.0

    def _get_temp(self) -> float:
        try:
            temps = psutil.sensors_temperatures()
            candidates = ["coretemp", "k10temp", "cpu_thermal", "acpitz",
                          "cpu-thermal", "zenpower", "it8688"]
            for name in candidates:
                if name in temps:
                    entries = temps[name]
                    if entries:
                        return entries[0].current
            for entries in temps.values():
                if entries:
                    return entries[0].current
        except Exception:
            pass
        if _OS == "Darwin":
            try:
                r = subprocess.run(
                    ["osx-cpu-temp"], capture_output=True, text=True, timeout=2
                )
                if r.returncode == 0:
                    import re
                    m = re.search(r"([\d.]+)", r.stdout)
                    if m:
                        return float(m.group(1))
            except Exception:
                pass

        if _OS == "Windows":
            try:
                r = subprocess.run(
                    ["powershell", "-Command",
                     "(Get-WmiObject MSAcpi_ThermalZoneTemperature -Namespace root/wmi).CurrentTemperature"],
                    capture_output=True, text=True, timeout=3
                )
                if r.returncode == 0 and r.stdout.strip():
                    raw = float(r.stdout.strip().split("\n")[0])
                    return (raw / 10.0) - 273.15
            except Exception:
                pass

        return -1.0

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "cpu": self.cpu,
                "mem": self.mem,
                "net": self.net,
                "gpu": self.gpu,
                "tmp": self.tmp,
            }


_metrics = _SysMetrics()

class HudCanvas(QWidget):
    def __init__(self, face_path: str, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_OpaquePaintEvent)
        self.setMinimumSize(300, 300)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)

        self.muted    = False
        self.speaking = False
        self.state    = "INITIALISING"

        self._tick       = 0
        self._scale      = 1.0
        self._tgt_scale  = 1.0
        self._halo       = 55.0
        self._tgt_halo   = 55.0
        self._last_t     = time.time()
        self._scan       = 0.0
        self._scan2      = 180.0
        self._rings      = [0.0, 120.0, 240.0]
        self._pulses: list[float] = [0.0, 50.0, 100.0]
        self._blink      = True
        self._blink_tick = 0
        self._particles: list[list[float]] = []
        self._face_px: QPixmap | None = None

        # 3D Avatar GLB integration using local WebGL page
        try:
            from PyQt6.QtWebEngineWidgets import QWebEngineView
            from PyQt6.QtWebEngineCore import QWebEngineSettings
            self.web_view = QWebEngineView(self)
            self.web_view.setStyleSheet("background: transparent !important; background-color: transparent !important; border: none;")
            self.web_view.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
            
            # Apply transparent color to page background and ensure it persists across page loading events
            self.web_view.page().setBackgroundColor(QColor(Qt.GlobalColor.transparent))
            self.web_view.loadStarted.connect(lambda: self.web_view.page().setBackgroundColor(QColor(Qt.GlobalColor.transparent)))
            self.web_view.loadFinished.connect(lambda: self.web_view.page().setBackgroundColor(QColor(Qt.GlobalColor.transparent)))
            
            settings = self.web_view.settings()
            settings.setAttribute(QWebEngineSettings.WebAttribute.WebGLEnabled, True)
            settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)
            settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)
            
            # Load local WebGL HTML page
            web_avatar_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "web_avatar"))
            local_html = os.path.join(web_avatar_dir, "index.html")
            
            # Clean up old temporary avatar models to avoid disk bloating
            try:
                for f in os.listdir(web_avatar_dir):
                    if f.startswith("avatar_temp_") and f.endswith(".glb"):
                        try:
                            os.remove(os.path.join(web_avatar_dir, f))
                        except Exception:
                            pass
            except Exception:
                pass
                
            # Create a unique filename for the active run to completely bypass QWebEngineView filesystem cache
            ts = int(time.time())
            temp_name = f"avatar_temp_{ts}.glb"
            temp_path = os.path.join(web_avatar_dir, temp_name)
            
            # Copy the active model (model (3).glb) to the unique temp path
            import shutil
            source_model = os.path.abspath(os.path.join(os.path.dirname(__file__), "model (3).glb"))
            if not os.path.exists(source_model):
                source_model = os.path.abspath(os.path.join(os.path.dirname(__file__), "model.glb"))
            if not os.path.exists(source_model):
                source_model = os.path.abspath(os.path.join(os.path.dirname(__file__), "avatar.glb"))
            
            try:
                shutil.copy2(source_model, temp_path)
                print(f"[HUD] Synced premium model to unique runtime file: {temp_name}")
            except Exception as copy_err:
                print(f"[HUD] Unique runtime file sync failed, falling back: {copy_err}")
                temp_name = "avatar.glb"
                
            url = QUrl.fromLocalFile(local_html)
            url.setQuery(f"model={temp_name}&t={ts}")
            try:
                self.web_view.page().profile().clearHttpCache()
            except Exception:
                pass
            self.web_view.setUrl(url)
            print("[HUD] 3D WebGL Avatar Engine connected.")
        except Exception as e:
            print(f"[HUD] 3D WebGL rendering bypassed: {e}")
            self.web_view = None
            self._load_face(face_path)

        self._tmr = QTimer(self)
        self._tmr.timeout.connect(self._step)
        self._tmr.start(16)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        if getattr(self, "web_view", None):
            # Center the 3D model exactly inside the central holographic ring
            W, H = self.width(), self.height()
            fw = min(W, H)
            fsz = int(fw * 0.60 * self._scale)
            cx, cy = W / 2, H / 2
            self.web_view.setGeometry(
                int(cx - fsz / 2),
                int(cy - fsz / 2),
                fsz,
                fsz
            )

    def _load_face(self, path: str):
        try:
            from PIL import Image, ImageDraw
            import io
            img = Image.open(path).convert("RGBA")
            sz  = min(img.size)
            img = img.resize((sz, sz), Image.LANCZOS)
            mk  = Image.new("L", (sz, sz), 0)
            ImageDraw.Draw(mk).ellipse((2, 2, sz - 2, sz - 2), fill=255)
            img.putalpha(mk)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            px = QPixmap(); px.loadFromData(buf.getvalue())
            self._face_px = px
        except Exception:
            self._face_px = None

    def _step(self):
        self._tick += 1
        
        # CPU/GPU Composition Throttle: When the hardware-accelerated 3D WebGL Solar System
        # is active, the Chromium process manages high-framerate rendering independently.
        # Throttling the 2D parent canvas repaints to ~5 FPS (every 12 ticks) completely
        # eliminates inter-process layout composition overhead, making the entire application super fast.
        if getattr(self, "web_view", None) and self.web_view:
            if self._tick % 12 != 0:
                return

        now = time.time()
        if now - self._last_t > (0.12 if self.speaking else 0.5):
            if self.speaking:
                self._tgt_scale = random.uniform(1.06, 1.14)
                self._tgt_halo  = random.uniform(145, 190)
            elif self.muted:
                self._tgt_scale = random.uniform(0.998, 1.002)
                self._tgt_halo  = random.uniform(15, 28)
            else:
                self._tgt_scale = random.uniform(1.001, 1.008)
                self._tgt_halo  = random.uniform(48, 68)
            self._last_t = now

        sp = 0.38 if self.speaking else 0.15
        self._scale += (self._tgt_scale - self._scale) * sp
        self._halo  += (self._tgt_halo  - self._halo)  * sp

        speeds = [1.3, -0.9, 2.0] if self.speaking else [0.55, -0.35, 0.9]
        for i, spd in enumerate(speeds):
            self._rings[i] = (self._rings[i] + spd) % 360

        self._scan  = (self._scan  + (3.0 if self.speaking else 1.3)) % 360
        self._scan2 = (self._scan2 + (-2.0 if self.speaking else -0.75)) % 360

        fw  = min(self.width(), self.height())
        lim = fw * 0.74
        spd = 4.2 if self.speaking else 2.0
        self._pulses = [r + spd for r in self._pulses if r + spd < lim]
        if len(self._pulses) < 3 and random.random() < (0.07 if self.speaking else 0.025):
            self._pulses.append(0.0)

        if self.speaking and random.random() < 0.28:
            cx, cy = self.width() / 2, self.height() / 2
            ang = random.uniform(0, 2 * math.pi)
            r_s = fw * 0.28
            self._particles.append([
                cx + math.cos(ang) * r_s, cy + math.sin(ang) * r_s,
                math.cos(ang) * random.uniform(0.9, 2.4),
                math.sin(ang) * random.uniform(0.9, 2.4) - 0.4, 1.0,
            ])
        self._particles = [
            [p[0]+p[2], p[1]+p[3], p[2]*0.97, p[3]*0.97, p[4]-0.028]
            for p in self._particles if p[4] > 0
        ]

        self._blink_tick += 1
        if self._blink_tick >= 38:
            self._blink = not self._blink
            self._blink_tick = 0
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)

        W, H = self.width(), self.height()
        cx, cy = W / 2, H / 2
        fw = min(W, H)

        # Cache static graphics to completely eliminate CPU-heavy vector loops from the 60 FPS refresh cycle
        if not hasattr(self, "_cached_static_hud") or self._cached_static_hud is None or self._cached_static_hud.size() != self.size():
            self._cached_static_hud = QPixmap(self.size())
            self._cached_static_hud.fill(Qt.GlobalColor.transparent)
            cp = QPainter(self._cached_static_hud)
            cp.setRenderHint(QPainter.RenderHint.Antialiasing)

            # Draw primary application panel background
            cp.fillRect(self.rect(), qcol(C.BG))

            # Draw background grid dots once
            cp.setPen(QPen(qcol(C.PRI_GHO), 1))
            for x in range(0, W, 48):
                for y in range(0, H, 48):
                    cp.drawPoint(x, y)

            # Draw outer radial coordinate ticks once
            t_out, t_in = fw * 0.497, fw * 0.474
            cp.setPen(QPen(qcol(C.PRI, 140), 1))
            for deg in range(0, 360, 10):
                rad = math.radians(deg)
                inn = t_in if deg % 30 == 0 else t_in + 6
                cp.drawLine(
                    QPointF(cx + t_out * math.cos(rad), cy - t_out * math.sin(rad)),
                    QPointF(cx + inn  * math.cos(rad), cy - inn  * math.sin(rad)),
                )

            # Draw HUD chassis corner brackets once
            bl = 24
            bc = qcol(C.PRI, 210)
            hl, hr = cx - fw // 2, cx + fw // 2
            ht, hb = cy - fw // 2, cy + fw // 2
            cp.setPen(QPen(bc, 2))
            for bx, by, dx, dy in [(hl,ht,1,1),(hr,ht,-1,1),(hl,hb,1,-1),(hr,hb,-1,-1)]:
                cp.drawLine(QPointF(bx, by), QPointF(bx + dx * bl, by))
                cp.drawLine(QPointF(bx, by), QPointF(bx, by + dy * bl))

            cp.end()

        # Render static cached backdrop instantly
        p.drawPixmap(0, 0, self._cached_static_hud)

        r_face = fw * 0.31

        # Dynamic halo glow (optimized concentric rings from 10 to 4 for highly-fluid drawing cycles)
        for i in range(4):
            r   = r_face * (1.8 - i * 0.15)
            frc = 1.0 - i / 4
            a   = max(0, min(255, int(self._halo * 0.085 * frc)))
            col = qcol(C.MUTED_C if self.muted else C.PRI, a)
            p.setPen(QPen(col, 1.5)); p.setBrush(Qt.BrushStyle.NoBrush)
            p.drawEllipse(QRectF(cx - r, cy - r, r * 2, r * 2))

        # Dynamic pulse rings
        for pr in self._pulses:
            a   = max(0, int(230 * (1.0 - pr / (fw * 0.74))))
            col = qcol(C.MUTED_C if self.muted else C.PRI, a)
            p.setPen(QPen(col, 1.5)); p.setBrush(Qt.BrushStyle.NoBrush)
            p.drawEllipse(QRectF(cx - pr, cy - pr, pr * 2, pr * 2))

        # Dynamic spinning arc rings
        for idx, (r_frac, w_r, arc_l, gap) in enumerate(
            [(0.48, 3, 115, 78), (0.40, 2, 78, 55), (0.32, 1, 56, 40)]
        ):
            ring_r = fw * r_frac
            base   = self._rings[idx]
            a_val  = max(0, min(255, int(self._halo * (1.0 - idx * 0.18))))
            col    = qcol(C.MUTED_C if self.muted else C.PRI, a_val)
            p.setPen(QPen(col, w_r)); p.setBrush(Qt.BrushStyle.NoBrush)
            angle = base
            rect  = QRectF(cx - ring_r, cy - ring_r, ring_r * 2, ring_r * 2)
            while angle < base + 360:
                p.drawArc(rect, int(angle * 16), int(arc_l * 16))
                angle += arc_l + gap

        # Dynamic sweeps and scanner sweeps
        sr = fw * 0.50
        sa = min(255, int(self._halo * 1.5))
        ex = 75 if self.speaking else 44
        p.setPen(QPen(qcol(C.MUTED_C if self.muted else C.PRI, sa), 2.5))
        p.setBrush(Qt.BrushStyle.NoBrush)
        srect = QRectF(cx - sr, cy - sr, sr * 2, sr * 2)
        p.drawArc(srect, int(self._scan * 16), int(ex * 16))
        p.setPen(QPen(qcol(C.ACC, sa // 2), 1.5))
        p.drawArc(srect, int(self._scan2 * 16), int(ex * 16))

        # Dynamic telemetry crosshairs
        ch_r, gap_h = fw * 0.51, fw * 0.16
        p.setPen(QPen(qcol(C.PRI, int(self._halo * 0.5)), 1))
        p.drawLine(QPointF(cx - ch_r, cy), QPointF(cx - gap_h, cy))
        p.drawLine(QPointF(cx + gap_h, cy), QPointF(cx + ch_r, cy))
        p.drawLine(QPointF(cx, cy - ch_r), QPointF(cx, cy - gap_h))
        p.drawLine(QPointF(cx, cy + gap_h), QPointF(cx, cy + ch_r))

        # face
        if self._face_px and not getattr(self, "web_view", None):
            fsz    = int(fw * 0.62 * self._scale)
            scaled = self._face_px.scaled(
                fsz, fsz,
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            p.drawPixmap(int(cx - fsz / 2), int(cy - fsz / 2), scaled)
        elif not getattr(self, "web_view", None):
            orb_r = int(fw * 0.27 * self._scale)
            oc    = (200, 0, 50) if self.muted else (0, 60, 110)
            for i in range(8, 0, -1):
                r2  = int(orb_r * i / 8)
                frc = i / 8
                a   = max(0, min(255, int(self._halo * 1.1 * frc)))
                p.setBrush(QBrush(QColor(int(oc[0]*frc), int(oc[1]*frc), int(oc[2]*frc), a)))
                p.setPen(Qt.PenStyle.NoPen)
                p.drawEllipse(QRectF(cx - r2, cy - r2, r2 * 2, r2 * 2))
            p.setPen(QPen(qcol(C.PRI, min(255, int(self._halo * 2))), 1))
            p.setFont(QFont(FONT_UI, 13, QFont.Weight.Bold))
            p.drawText(QRectF(cx - 80, cy - 14, 160, 28),
                       Qt.AlignmentFlag.AlignCenter, "OCTO")

        # particles
        for pt in self._particles:
            a = max(0, min(255, int(pt[4] * 255)))
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(QBrush(qcol(C.PRI, a)))
            p.drawEllipse(QPointF(pt[0], pt[1]), 2.5, 2.5)

        # status text
        sy = cy + fw * 0.40
        if self.muted:
            txt, col = "⊘  MUTED",     qcol(C.MUTED_C)
        elif self.speaking:
            txt, col = "●  SPEAKING",  qcol(C.ACC)
        elif self.state == "THINKING":
            sym = "◈" if self._blink else "◇"
            txt, col = f"{sym}  THINKING",   qcol(C.ACC2)
        elif self.state == "PROCESSING":
            sym = "▷" if self._blink else "▶"
            txt, col = f"{sym}  PROCESSING", qcol(C.ACC2)
        elif self.state == "LISTENING":
            sym = "●" if self._blink else "○"
            txt, col = f"{sym}  LISTENING",  qcol(C.GREEN)
        else:
            sym = "●" if self._blink else "○"
            txt, col = f"{sym}  {self.state}", qcol(C.PRI)

        p.setPen(QPen(col, 1))
        p.setFont(QFont(FONT_UI, 10, QFont.Weight.Bold))
        p.drawText(QRectF(0, sy, W, 26), Qt.AlignmentFlag.AlignCenter, txt)

        # waveform
        wy = sy + 30
        N, bw = 36, 8
        wx0 = (W - N * bw) / 2
        for i in range(N):
            if self.muted:
                hgt, cl = 2, qcol(C.MUTED_C)
            elif self.speaking:
                hgt = random.randint(3, 20)
                cl  = qcol(C.PRI) if hgt > 12 else qcol(C.PRI_DIM)
            else:
                hgt = int(3 + 2 * math.sin(self._tick * 0.09 + i * 0.6))
                cl  = qcol(C.BORDER_B)
            p.fillRect(QRectF(wx0 + i * bw, wy + 20 - hgt, bw - 1, hgt), cl)

class MetricBar(QWidget):

    def __init__(self, label: str, color: str = C.PRI, parent=None):
        super().__init__(parent)
        self._label = label
        self._color = color
        self._value = 0.0       # 0–100
        self._text  = "--"
        self.setFixedHeight(38)
        self.setMinimumWidth(80)

    def set_value(self, pct: float, text: str):
        self._value = max(0.0, min(100.0, pct))
        self._text  = text
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        W, H = self.width(), self.height()

        p.setBrush(QBrush(qcol(C.PANEL2)))
        p.setPen(QPen(qcol(C.BORDER), 1))
        p.drawRoundedRect(QRectF(1, 1, W - 2, H - 2), 6, 6)

        bar_h   = 4
        bar_y   = H - bar_h - 5
        bar_w   = W - 16
        bar_x   = 8
        fill_w  = int(bar_w * self._value / 100)

        p.setBrush(QBrush(qcol(C.BAR_BG)))
        p.setPen(Qt.PenStyle.NoPen)
        p.drawRoundedRect(QRectF(bar_x, bar_y, bar_w, bar_h), 2, 2)

        if self._value > 85:
            bar_col = qcol(C.RED)
        elif self._value > 65:
            bar_col = qcol(C.ACC)
        else:
            bar_col = qcol(self._color)

        if fill_w > 0:
            p.setBrush(QBrush(bar_col))
            p.drawRoundedRect(QRectF(bar_x, bar_y, fill_w, bar_h), 2, 2)

        p.setFont(QFont(FONT_UI, 8, QFont.Weight.Bold))
        p.setPen(QPen(qcol(C.TEXT_DIM), 1))
        p.drawText(QRectF(8, 4, W - 16, 14), Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter, self._label)

        p.setFont(QFont(FONT_DATA, 9, QFont.Weight.Bold))
        p.setPen(QPen(bar_col if self._text != "--" else qcol(C.TEXT_DIM), 1))
        p.drawText(QRectF(0, 4, W - 8, 16), Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter, self._text)

class LogWidget(QTextEdit):
    _sig = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setReadOnly(True)
        self.setFont(QFont(FONT_DATA, 9))
        self.setStyleSheet(f"""
            QTextEdit {{
                background: {C.PANEL};
                color: {C.TEXT};
                border: 1px solid {C.BORDER};
                border-radius: 6px;
                padding: 6px;
                selection-background-color: {C.PRI_GHO};
            }}
            QScrollBar:vertical {{
                background: {C.BG};
                width: 6px;
                border: none;
                border-radius: 3px;
            }}
            QScrollBar::handle:vertical {{
                background: {C.BORDER_B};
                border-radius: 3px;
                min-height: 20px;
            }}
        """)
        self._queue: list[str] = []
        self._typing  = False
        self._text    = ""
        self._pos     = 0
        self._tag     = "sys"
        self._tmr = QTimer(self)
        self._tmr.timeout.connect(self._step)
        self._sig.connect(self._enqueue)

    def append_log(self, text: str):
        self._sig.emit(text)

    def _enqueue(self, text: str):
        self._queue.append(text)
        if not self._typing:
            self._next()

    def _next(self):
        if not self._queue:
            self._typing = False
            return
        self._typing = True
        self._text   = self._queue.pop(0)
        self._pos    = 0
        tl = self._text.lower()
        if   tl.startswith("you:"):    self._tag = "you"
        elif tl.startswith("OCTO:"): self._tag = "ai"
        elif tl.startswith("file:"):   self._tag = "file"
        elif "err" in tl:              self._tag = "err"
        else:                          self._tag = "sys"
        self._tmr.start(6)

    def _step(self):
        if self._pos < len(self._text):
            ch  = self._text[self._pos]
            cur = self.textCursor()
            fmt = cur.charFormat()
            col = {
                "you":  qcol(C.WHITE),
                "ai":   qcol(C.PRI),
                "err":  qcol(C.RED),
                "file": qcol(C.GREEN),
                "sys":  qcol(C.ACC2),
            }.get(self._tag, qcol(C.TEXT))
            fmt.setForeground(QBrush(col))
            cur.movePosition(cur.MoveOperation.End)
            cur.insertText(ch, fmt)
            self.setTextCursor(cur)
            self.ensureCursorVisible()
            self._pos += 1
        else:
            self._tmr.stop()
            cur = self.textCursor()
            cur.movePosition(cur.MoveOperation.End)
            cur.insertText("\n")
            self.setTextCursor(cur)
            self.ensureCursorVisible()
            QTimer.singleShot(20, self._next)

_FILE_ICONS = {
    "image":   ("🖼", "#00d4ff"), "video":   ("🎬", "#ff6b00"),
    "audio":   ("🎵", "#cc44ff"), "pdf":     ("📄", "#ff4444"),
    "word":    ("📝", "#4488ff"), "excel":   ("📊", "#44bb44"),
    "code":    ("💻", "#ffcc00"), "archive": ("📦", "#ff8844"),
    "pptx":    ("📊", "#ff6622"), "text":    ("📃", "#aaaaaa"),
    "data":    ("🔧", "#88ddff"), "unknown": ("📎", "#888888"),
}
_EXT_TO_CAT = {
    **dict.fromkeys(["jpg","jpeg","png","gif","webp","bmp","tiff","svg","ico"], "image"),
    **dict.fromkeys(["mp4","avi","mov","mkv","wmv","flv","webm","m4v"],         "video"),
    **dict.fromkeys(["mp3","wav","ogg","m4a","aac","flac","wma","opus"],        "audio"),
    **dict.fromkeys(["pdf"],                                                     "pdf"),
    **dict.fromkeys(["doc","docx"],                                              "word"),
    **dict.fromkeys(["xls","xlsx","ods"],                                        "excel"),
    **dict.fromkeys(["ppt","pptx"],                                              "pptx"),
    **dict.fromkeys(["py","js","ts","jsx","tsx","html","css","java","c","cpp",
                     "cs","go","rs","rb","php","swift","kt","sh","sql","lua"],   "code"),
    **dict.fromkeys(["zip","rar","tar","gz","7z","bz2","xz"],                   "archive"),
    **dict.fromkeys(["txt","md","rst","log"],                                    "text"),
    **dict.fromkeys(["csv","tsv","json","xml"],                                  "data"),
}

def _file_category(path: Path) -> str:
    return _EXT_TO_CAT.get(path.suffix.lower().lstrip("."), "unknown")

def _fmt_size(size: int) -> str:
    if   size < 1024:    return f"{size} B"
    elif size < 1024**2: return f"{size/1024:.1f} KB"
    elif size < 1024**3: return f"{size/1024**2:.1f} MB"
    else:                return f"{size/1024**3:.1f} GB"


class FileDropZone(QWidget):
    file_selected = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAcceptDrops(True)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setFixedHeight(100)
        self._current_file: str | None = None
        self._hovering  = False
        self._drag_over = False
        self._dash_offset = 0.0
        self._anim_tmr = QTimer(self)
        self._anim_tmr.timeout.connect(self._animate)
        self._anim_tmr.start(40)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        self._canvas = _DropCanvas(self)
        layout.addWidget(self._canvas)

    def _animate(self):
        self._dash_offset = (self._dash_offset + 0.8) % 20
        self._canvas.update()

    def dragEnterEvent(self, e: QDragEnterEvent):
        if e.mimeData().hasUrls():
            e.acceptProposedAction()
            self._drag_over = True; self._canvas.update()

    def dragLeaveEvent(self, e):
        self._drag_over = False; self._canvas.update()

    def dropEvent(self, e: QDropEvent):
        self._drag_over = False
        urls = e.mimeData().urls()
        if urls:
            path = urls[0].toLocalFile()
            if Path(path).is_file():
                self._set_file(path)
        self._canvas.update()

    def mousePressEvent(self, e):
        if e.button() == Qt.MouseButton.LeftButton:
            self._browse()

    def enterEvent(self, e):
        self._hovering = True; self._canvas.update()

    def leaveEvent(self, e):
        self._hovering = False; self._canvas.update()

    def current_file(self) -> str | None:
        return self._current_file

    def clear_file(self):
        self._current_file = None; self._canvas.update()

    def _browse(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Select a file for OCTO", str(Path.home()),
            "All Files (*.*);;"
            "Images (*.jpg *.jpeg *.png *.gif *.webp *.bmp *.svg);;"
            "Documents (*.pdf *.docx *.txt *.md *.pptx);;"
            "Data (*.csv *.xlsx *.json *.xml);;"
            "Code (*.py *.js *.ts *.html *.css *.java *.cpp *.go);;"
            "Audio (*.mp3 *.wav *.ogg *.m4a *.aac *.flac);;"
            "Video (*.mp4 *.avi *.mov *.mkv *.wmv *.webm);;"
            "Archives (*.zip *.rar *.tar *.gz *.7z)",
        )
        if path:
            self._set_file(path)

    def _set_file(self, path: str):
        self._current_file = path
        self._canvas.update()
        self.file_selected.emit(path)


class _DropCanvas(QWidget):
    def __init__(self, zone: FileDropZone):
        super().__init__(zone)
        self._z = zone

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        z    = self._z
        W, H = self.width(), self.height()
        pad  = 6
        rect = QRectF(pad, pad, W - pad * 2, H - pad * 2)

        bg_col = qcol("rgba(77, 166, 255, 0.08)" if z._drag_over else ("rgba(77, 166, 255, 0.03)" if z._hovering else C.PANEL))
        p.setBrush(QBrush(bg_col)); p.setPen(Qt.PenStyle.NoPen)
        p.drawRoundedRect(rect, 8, 8)

        if z._current_file:   border_col = qcol(C.GREEN, 200)
        elif z._drag_over:    border_col = qcol(C.PRI, 230)
        elif z._hovering:     border_col = qcol(C.BORDER_B, 200)
        else:                 border_col = qcol(C.BORDER, 140)

        pen = QPen(border_col, 1.5, Qt.PenStyle.DashLine)
        pen.setDashOffset(z._dash_offset)
        p.setPen(pen); p.setBrush(Qt.BrushStyle.NoBrush)
        p.drawRoundedRect(rect, 8, 8)

        if z._current_file:   self._paint_file(p, W, H)
        elif z._drag_over:    self._paint_drag_over(p, W, H)
        else:                 self._paint_idle(p, W, H, z._hovering)

    def _paint_idle(self, p, W, H, hover):
        cx, cy = W / 2, H / 2
        col = qcol(C.PRI_DIM if not hover else C.PRI)
        p.setPen(QPen(col, 2)); p.setBrush(Qt.BrushStyle.NoBrush)
        p.drawLine(QPointF(cx, cy - 14), QPointF(cx, cy + 4))
        p.drawLine(QPointF(cx - 8, cy - 6), QPointF(cx, cy - 14))
        p.drawLine(QPointF(cx + 8, cy - 6), QPointF(cx, cy - 14))
        p.drawLine(QPointF(cx - 14, cy + 4), QPointF(cx + 14, cy + 4))
        p.setFont(QFont(FONT_UI, 8))
        p.setPen(QPen(qcol(C.PRI_DIM if not hover else C.TEXT), 1))
        p.drawText(QRectF(0, cy + 8, W, 16), Qt.AlignmentFlag.AlignCenter,
                   "Drop file here  or  Click to Browse")
        p.setFont(QFont(FONT_UI, 7))
        p.setPen(QPen(qcol(C.TEXT_DIM), 1))
        p.drawText(QRectF(0, cy + 24, W, 14), Qt.AlignmentFlag.AlignCenter,
                   "Images · Video · Audio · PDF · Docs · Code · Data")

    def _paint_drag_over(self, p, W, H):
        cx, cy = W / 2, H / 2
        p.setFont(QFont(FONT_UI, 16))
        p.setPen(QPen(qcol(C.PRI), 1))
        p.drawText(QRectF(0, cy - 24, W, 32), Qt.AlignmentFlag.AlignCenter, "⬇")
        p.setFont(QFont(FONT_UI, 8, QFont.Weight.Bold))
        p.setPen(QPen(qcol(C.PRI), 1))
        p.drawText(QRectF(0, cy + 12, W, 16), Qt.AlignmentFlag.AlignCenter, "Release to load")

    def _paint_file(self, p, W, H):
        path = Path(self._z._current_file)
        cat  = _file_category(path)
        icon, icon_col = _FILE_ICONS.get(cat, _FILE_ICONS["unknown"])
        size_str = _fmt_size(path.stat().st_size)
        ext_str  = path.suffix.upper().lstrip(".") or "FILE"

        block_x, block_w = 10, 60
        p.setFont(QFont("Segoe UI Emoji", 22) if _OS == "Windows" else QFont("Arial", 22))
        p.setPen(QPen(qcol(icon_col), 1))
        p.drawText(QRectF(block_x, 0, block_w, H), Qt.AlignmentFlag.AlignCenter, icon)

        tx = block_x + block_w + 6
        tw = W - tx - 38

        p.setFont(QFont(FONT_UI, 8, QFont.Weight.Bold))
        p.setPen(QPen(qcol(C.WHITE), 1))
        name = path.name if len(path.name) <= 34 else path.name[:31] + "..."
        p.drawText(QRectF(tx, H * 0.18, tw, 16),
                   Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter, name)

        p.setFont(QFont(FONT_DATA, 7))
        p.setPen(QPen(qcol(C.TEXT_DIM), 1))
        p.drawText(QRectF(tx, H * 0.18 + 18, tw, 14),
                   Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
                   f"{ext_str}  ·  {size_str}")

        p.setFont(QFont(FONT_DATA, 6))
        p.setPen(QPen(qcol("#1e5c6a"), 1))
        par = str(path.parent)
        if len(par) > 42: par = "..." + par[-41:]
        p.drawText(QRectF(tx, H * 0.18 + 34, tw, 12),
                   Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter, par)

        p.setFont(QFont(FONT_UI, 9, QFont.Weight.Bold))
        p.setPen(QPen(qcol(C.RED, 180), 1))
        p.drawText(QRectF(W - 34, 0, 28, H), Qt.AlignmentFlag.AlignCenter, "✕")

    def mousePressEvent(self, e):
        z = self._z
        if z._current_file and e.pos().x() > self.width() - 34:
            z.clear_file()
        else:
            z.mousePressEvent(e)


class SetupOverlay(QWidget):
    done = pyqtSignal(str, str)   # key, os_name

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setStyleSheet(f"""
            SetupOverlay {{
                background: rgba(6, 11, 24, 250);
                border: 1px solid {C.BORDER_B};
                border-radius: 10px;
            }}
        """)

        detected = {"darwin": "mac", "windows": "windows"}.get(
            _OS.lower(), "linux"
        )
        self._sel_os = detected

        layout = QVBoxLayout(self)
        layout.setContentsMargins(32, 26, 32, 26)
        layout.setSpacing(10)

        def _lbl(txt, font_size=9, bold=False, color=C.PRI,
                 align=Qt.AlignmentFlag.AlignCenter):
            w = QLabel(txt)
            w.setAlignment(align)
            w.setFont(QFont(FONT_UI, int(font_size),
                            QFont.Weight.Bold if bold else QFont.Weight.Normal))
            w.setStyleSheet(f"color: {color}; background: transparent;")
            return w

        layout.addWidget(_lbl("◈  INITIALISATION REQUIRED", 12, True))
        layout.addWidget(_lbl("Configure OCTO before first boot.", 8, color=C.TEXT_DIM))
        layout.addSpacing(4)

        sep = QFrame(); sep.setFrameShape(QFrame.Shape.HLine)
        sep.setStyleSheet(f"color: {C.BORDER}; margin: 2px 0;"); layout.addWidget(sep)
        layout.addSpacing(2)

        layout.addWidget(_lbl("GEMINI API KEY", 7, color=C.TEXT_DIM,
                               align=Qt.AlignmentFlag.AlignLeft))
        self._key_input = QLineEdit()
        self._key_input.setEchoMode(QLineEdit.EchoMode.Password)
        self._key_input.setPlaceholderText("AIza...")
        self._key_input.setFont(QFont(FONT_UI, 9))
        self._key_input.setFixedHeight(32)
        self._key_input.setStyleSheet(f"""
            QLineEdit {{
                background: {C.DARK}; color: {C.WHITE};
                border: 1px solid {C.BORDER}; border-radius: 6px; padding: 4px 10px;
            }}
            QLineEdit:focus {{ border: 1px solid {C.PRI}; background: #0a1428; }}
        """)
        layout.addWidget(self._key_input)
        layout.addSpacing(8)

        sep2 = QFrame(); sep2.setFrameShape(QFrame.Shape.HLine)
        sep2.setStyleSheet(f"color: {C.BORDER}; margin: 2px 0;"); layout.addWidget(sep2)
        layout.addSpacing(2)

        layout.addWidget(_lbl("OPERATING SYSTEM", 7, color=C.TEXT_DIM,
                               align=Qt.AlignmentFlag.AlignLeft))
        det_name = {"windows": "Windows", "mac": "macOS", "linux": "Linux"}[detected]
        layout.addWidget(_lbl(f"Auto-detected: {det_name}", 8, color=C.ACC2,
                               align=Qt.AlignmentFlag.AlignLeft))

        os_row = QHBoxLayout(); os_row.setSpacing(6)
        self._os_btns: dict[str, QPushButton] = {}
        for key, label in [("windows","⊞  Windows"),("mac","🍎  macOS"),("linux","🐧  Linux")]:
            btn = QPushButton(label)
            btn.setFont(QFont(FONT_UI, 8, QFont.Weight.Bold))
            btn.setFixedHeight(32)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.clicked.connect(lambda _, k=key: self._sel(k))
            os_row.addWidget(btn)
            self._os_btns[key] = btn
        layout.addLayout(os_row)
        self._sel(detected)
        layout.addSpacing(10)

        init_btn = QPushButton("▸  INITIALISE SYSTEMS")
        init_btn.setFont(QFont(FONT_UI, 9, QFont.Weight.Bold))
        init_btn.setFixedHeight(36)
        init_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        init_btn.setStyleSheet(f"""
            QPushButton {{
                background: {C.PRI_GHO}; color: {C.PRI};
                border: 1px solid {C.PRI_DIM}; border-radius: 6px;
            }}
            QPushButton:hover {{
                background: rgba(77, 166, 255, 0.15); border: 1px solid {C.PRI};
            }}
            QPushButton:pressed {{
                background: rgba(77, 166, 255, 0.25);
            }}
        """)
        init_btn.clicked.connect(self._submit)
        layout.addWidget(init_btn)

    def _sel(self, key: str):
        self._sel_os = key
        pal = {
            "windows": (C.PRI, "rgba(77, 166, 255, 0.15)"),
            "mac":     (C.ACC2, "rgba(240, 184, 64, 0.15)"),
            "linux":   (C.GREEN, "rgba(45, 219, 138, 0.15)")
        }
        for k, btn in self._os_btns.items():
            if k == key:
                fg, bg = pal[k]
                btn.setStyleSheet(f"""
                    QPushButton {{
                        background: {bg}; color: {fg};
                        border: 1px solid {fg}; border-radius: 6px; font-weight: bold;
                    }}
                """)
            else:
                btn.setStyleSheet(f"""
                    QPushButton {{
                        background: {C.DARK}; color: {C.TEXT_DIM};
                        border: 1px solid {C.BORDER}; border-radius: 6px;
                    }}
                    QPushButton:hover {{ color: {C.TEXT}; border: 1px solid {C.BORDER_B}; }}
                """)

    def _submit(self):
        key = self._key_input.text().strip()
        if not key:
            self._key_input.setStyleSheet(
                self._key_input.styleSheet() +
                f" QLineEdit {{ border: 1px solid {C.RED}; }}"
            )
            return
        self.done.emit(key, self._sel_os)


# ---------------------------------------------------------------------------
# Settings overlay — accessible any time via the ⚙ button in the header
# ---------------------------------------------------------------------------
class SettingsOverlay(QWidget):
    saved = pyqtSignal()

    _TEXT_MODELS = [
        ("gemini-2.5-flash  (recommended)",   "gemini-2.5-flash"),
        ("gemini-3.1-pro-preview  (paid)",    "gemini-3.1-pro-preview"),
        ("gemini-3.1-pro-customtools  (paid)","gemini-3.1-pro-preview-customtools"),
        ("Auto  (Gemini → Ollama)",           "auto"),
        ("Ollama only  (local)",              "ollama"),
    ]

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setStyleSheet(f"""
            SettingsOverlay {{
                background: rgba(6, 11, 24, 250);
                border: 1px solid {C.BORDER_B};
                border-radius: 10px;
            }}
        """)
        self._cfg = self._load_cfg()
        self._build_ui()

    # ── helpers ──────────────────────────────────────────────────────────────
    @staticmethod
    def _load_cfg() -> dict:
        try:
            return json.loads(API_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}

    @staticmethod
    def _save_cfg(data: dict):
        import os as _os
        _os.makedirs(CONFIG_DIR, exist_ok=True)
        API_FILE.write_text(json.dumps(data, indent=4), encoding="utf-8")

    @staticmethod
    def _fetch_ollama_models(base_url: str) -> list[str]:
        # Try CLI first
        try:
            import subprocess, sys
            flags = 0x08000000 if sys.platform == "win32" else 0
            out = subprocess.check_output(
                ["ollama", "list"], text=True, timeout=6, creationflags=flags,
            )
            models = [l.split()[0] for l in out.strip().splitlines()[1:] if l.split()]
            if models:
                return models
        except Exception:
            pass
        # Fallback REST
        try:
            import requests
            r = requests.get(f"{base_url.rstrip('/')}/api/tags", timeout=4)
            r.raise_for_status()
            return [m["name"] for m in r.json().get("models", [])]
        except Exception:
            return []

    @staticmethod
    def _load_gw_cfg() -> dict:
        from pathlib import Path as _P
        p = _P(__file__).resolve().parent / "config" / "gateway.json"
        try:
            return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
        except Exception:
            return {}

    @staticmethod
    def _save_gw_cfg(data: dict):
        from pathlib import Path as _P
        p = _P(__file__).resolve().parent / "config" / "gateway.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data, indent=4), encoding="utf-8")

    @staticmethod
    def _lbl(txt, size=9, bold=False, color=C.PRI,
             align=Qt.AlignmentFlag.AlignLeft):
        w = QLabel(txt); w.setAlignment(align)
        w.setFont(QFont(FONT_UI, int(size),
                        QFont.Weight.Bold if bold else QFont.Weight.Normal))
        w.setStyleSheet(f"color: {color}; background: transparent;")
        return w

    @staticmethod
    def _sep():
        s = QFrame(); s.setFrameShape(QFrame.Shape.HLine)
        s.setStyleSheet(f"color: {C.BORDER}; margin: 2px 0;"); return s

    @staticmethod
    def _field(ph="", echo=False, val=""):
        f = QLineEdit(val); f.setPlaceholderText(ph)
        f.setFont(QFont(FONT_UI, 9)); f.setFixedHeight(28)
        if echo: f.setEchoMode(QLineEdit.EchoMode.Password)
        f.setStyleSheet(f"""
            QLineEdit {{
                background: {C.DARK}; color: {C.WHITE};
                border: 1px solid {C.BORDER}; border-radius: 6px; padding: 2px 7px;
            }}
            QLineEdit:focus {{ border: 1px solid {C.PRI}; background: #0a1428; }}""")
        return f

    # ── build ─────────────────────────────────────────────────────────────────
    def _build_ai_panel(self, cfg: dict):
        self._ai_panel = QWidget(); self._ai_panel.setStyleSheet("background:transparent;")
        ai = QVBoxLayout(self._ai_panel); ai.setContentsMargins(0,4,0,0); ai.setSpacing(5)

        ai.addWidget(self._lbl("GEMINI API KEY", 8, color=C.TEXT_DIM))
        self._key_f = self._field("AIza...", echo=True, val=cfg.get("gemini_api_key", ""))
        ai.addWidget(self._key_f)

        gm_row = QHBoxLayout(); gm_row.setSpacing(6)
        self._gm_detect_btn = QPushButton("⟳  Detect Gemini Models")
        self._gm_detect_btn.setFont(QFont(FONT_UI, 8)); self._gm_detect_btn.setFixedHeight(26)
        self._gm_detect_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._gm_detect_btn.setStyleSheet(f"""
            QPushButton {{
                background: {C.DARK}; color: {C.ACC2};
                border: 1px solid {C.BORDER}; border-radius: 6px; padding: 0 8px;
            }}
            QPushButton:hover {{
                border: 1px solid {C.ACC2};
                background: rgba(240, 184, 64, 0.08);
            }}""")
        self._gm_detect_btn.clicked.connect(self._detect_gemini_models)
        self._gm_detect_lbl = QLabel("")
        self._gm_detect_lbl.setFont(QFont(FONT_UI, 7))
        self._gm_detect_lbl.setStyleSheet("color:#3a6070;background:transparent;")
        gm_row.addWidget(self._gm_detect_btn); gm_row.addWidget(self._gm_detect_lbl, stretch=1)
        ai.addLayout(gm_row)

        ai.addWidget(self._sep())
        ai.addWidget(self._lbl("VOICE MODEL  (Gemini Live — real-time audio)", 8, color=C.TEXT_DIM))
        self._live_model_f = self._field(_DEFAULT_LIVE_MODEL, val=cfg.get("live_model", _DEFAULT_LIVE_MODEL))
        ai.addWidget(self._live_model_f)

        ai.addWidget(self._sep())
        ai.addWidget(self._lbl("TEXT MODEL  (agents · chat · code · vision)", 8, color=C.TEXT_DIM))
        btn_row = QHBoxLayout(); btn_row.setSpacing(4)
        self._model_btns: dict[str, QPushButton] = {}
        cur_model = cfg.get("text_llm_provider", "auto")
        for label, key in self._TEXT_MODELS:
            b = QPushButton(label); b.setFont(QFont(FONT_UI, 8)); b.setFixedHeight(26)
            b.setCursor(Qt.CursorShape.PointingHandCursor)
            b.clicked.connect(lambda _, k=key: self._sel_model(k))
            btn_row.addWidget(b); self._model_btns[key] = b
        ai.addLayout(btn_row)
        self._sel_model(cur_model)

        ai.addWidget(self._sep())
        ai.addWidget(self._lbl("LOCAL AI — OLLAMA", 8, color=C.TEXT_DIM))
        url_row = QHBoxLayout(); url_row.setSpacing(6)
        self._ollama_url_f = self._field("http://localhost:11434",
                                    val=cfg.get("ollama_base_url", "http://localhost:11434"))
        det = QPushButton("⟳ Detect"); det.setFont(QFont(FONT_UI, 8)); det.setFixedHeight(28)
        det.setCursor(Qt.CursorShape.PointingHandCursor)
        det.setStyleSheet(f"""
            QPushButton {{
                background: {C.DARK}; color: {C.ACC2};
                border: 1px solid {C.BORDER}; border-radius: 6px; padding: 0 6px;
            }}
            QPushButton:hover {{
                border: 1px solid {C.ACC2};
                background: rgba(240, 184, 64, 0.08);
            }}""")
        det.clicked.connect(self._detect_models)
        url_row.addWidget(self._ollama_url_f, stretch=3); url_row.addWidget(det)
        ai.addLayout(url_row)
        self._ollama_mod_f = self._field("auto  (e.g. gemma3, llama3.2...)", val=cfg.get("ollama_model",""))
        ai.addWidget(self._ollama_mod_f)
        self._detected_lbl = self._lbl("", 7, color=C.GREEN)
        ai.addWidget(self._detected_lbl)
        ai.addStretch()

    def _build_gw_panel(self, gw_cfg: dict):
        self._gw_panel = QWidget(); self._gw_panel.setStyleSheet("background:transparent;")
        gw = QVBoxLayout(self._gw_panel); gw.setContentsMargins(0,4,0,0); gw.setSpacing(4)

        scroll_w = QScrollArea(); scroll_w.setWidgetResizable(True)
        scroll_w.setStyleSheet(f"QScrollArea{{background:transparent;border:none;}}")
        inner = QWidget(); inner.setStyleSheet("background:transparent;")
        inner_lay = QVBoxLayout(inner); inner_lay.setContentsMargins(0,0,6,0); inner_lay.setSpacing(4)

        def _gw_section(title: str, color=C.ACC):
            l = QLabel(f"◈  {title}")
            l.setFont(QFont(FONT_UI, 8, QFont.Weight.Bold))
            l.setStyleSheet(f"color:{color};background:transparent;")
            return l

        def _gw_field(ph="", val="", echo=False):
            f = QLineEdit(val); f.setPlaceholderText(ph)
            f.setFont(QFont(FONT_UI, 8)); f.setFixedHeight(26)
            if echo: f.setEchoMode(QLineEdit.EchoMode.Password)
            f.setStyleSheet(f"""
                QLineEdit {{
                    background: {C.DARK}; color: {C.WHITE};
                    border: 1px solid {C.BORDER}; border-radius: 6px; padding: 2px 6px;
                }}
                QLineEdit:focus {{ border: 1px solid {C.PRI}; background: #0a1428; }}""")
            return f

        self._gw_fields: dict = {}

        def _platform_block(key: str, title: str, fields: list, hint: str = ""):
            p = gw_cfg.get(key, {})
            inner_lay.addWidget(_gw_section(title))
            if hint:
                h = QLabel(hint); h.setFont(QFont(FONT_UI, 7))
                h.setStyleSheet(f"color:{C.TEXT_DIM};background:transparent;")
                inner_lay.addWidget(h)
            self._gw_fields[key] = {}
            for fname, fph, fecho in fields:
                row = QHBoxLayout(); row.setSpacing(4)
                lbl = QLabel(fname); lbl.setFixedWidth(90)
                lbl.setFont(QFont(FONT_UI, 7))
                lbl.setStyleSheet(f"color:{C.TEXT_MED};background:transparent;")
                row.addWidget(lbl)
                f = _gw_field(fph, val=str(p.get(fname, "")), echo=fecho)
                row.addWidget(f)
                self._gw_fields[key][fname] = f
                inner_lay.addLayout(row)
            inner_lay.addSpacing(2)

        _platform_block("telegram",  "TELEGRAM",
            [("token","Bot token from @BotFather",True),
              ("allowed_users","Your numeric user IDs  (comma-separated)",False)],
            "Get token: Telegram → @BotFather → /newbot   |   Get ID: @userinfobot")

        inner_lay.addWidget(self._sep())
        _platform_block("discord",   "DISCORD",
            [("token","Bot token from discord.com/developers",True),
              ("allowed_users","Your Discord user IDs  (comma-separated)",False)],
            "Portal → New App → Bot → Reset Token  |  Enable Message Content Intent")

        inner_lay.addWidget(self._sep())
        _platform_block("slack",     "SLACK",
            [("token","Bot token  xoxb-...",True),
              ("api_key","App-level token  xapp-...",True),
              ("allowed_users","Slack member IDs  (comma-separated)",False)],
            "api.slack.com/apps → OAuth & Permissions  |  Settings → Socket Mode → xapp token")

        inner_lay.addWidget(self._sep())
        _platform_block("whatsapp",  "WHATSAPP",
            [("allowed_users","Phone numbers  (no +, e.g. 15551234567)",False)],
            "Run 'octo gateway pair whatsapp' to scan QR code from your phone")

        inner_lay.addWidget(self._sep())
        _platform_block("dingtalk",  "DINGTALK",
            [("webhook","Group webhook URL  (from DingTalk robot settings)",True),
              ("secret","Signing secret  (optional)",True)],
            "DingTalk group → Settings → Robots → Add a robot → Copy webhook URL")

        inner_lay.addWidget(self._sep())
        _platform_block("feishu",    "FEISHU / LARK",
            [("app_id","App ID  (from open.feishu.cn)",True),
              ("app_secret","App Secret",True),
              ("allowed_users","User open-IDs  (comma-separated)",False)],
            "Feishu Open Platform → Create App → Event Subscription → configure bot")

        inner_lay.addStretch()
        scroll_w.setWidget(inner)
        gw.addWidget(scroll_w, stretch=1)

        gw_status_row = QHBoxLayout(); gw_status_row.setSpacing(6)
        self._gw_status_lbl = QLabel("Gateway: not running")
        self._gw_status_lbl.setFont(QFont(FONT_UI, 8))
        self._gw_status_lbl.setStyleSheet(f"color:{C.TEXT_DIM};background:transparent;")
        start_gw = QPushButton("▸  START GATEWAY")
        start_gw.setFixedHeight(28); start_gw.setFont(QFont(FONT_UI, 8, QFont.Weight.Bold))
        start_gw.setCursor(Qt.CursorShape.PointingHandCursor)
        start_gw.setStyleSheet(f"""
            QPushButton {{
                background: transparent; color: {C.GREEN};
                border: 1px solid {C.GREEN_D}; border-radius: 6px;
            }}
            QPushButton:hover {{
                background: rgba(45, 219, 138, 0.12); border: 1px solid {C.GREEN};
            }}""")
        start_gw.clicked.connect(self._start_gateway)
        gw_status_row.addWidget(self._gw_status_lbl, stretch=1)
        gw_status_row.addWidget(start_gw)
        gw.addLayout(gw_status_row)

    def _build_proxy_panel(self, cfg: dict):
        """Panel for model proxy provider API keys — synced to ~/.fcc/.env."""
        self._proxy_panel = QWidget(); self._proxy_panel.setStyleSheet("background:transparent;")
        pp = QVBoxLayout(self._proxy_panel); pp.setContentsMargins(0,4,0,0); pp.setSpacing(5)

        pp.addWidget(self._lbl("MODEL ROUTING PROXY", 9, bold=True, color=C.PRI))
        pp.addWidget(self._lbl(
            "Keys saved here are synced to ~/.fcc/.env and used by the embedded model proxy.",
            7, color=C.TEXT_DIM))
        pp.addWidget(self._sep())

        _PROXY_PROVIDERS = [
            ("ANTHROPIC_AUTH_TOKEN",  "anthropic_auth_token",  "Anthropic Auth Token  (optional, for direct routing)", True),
            ("OPENROUTER_API_KEY",    "openrouter_api_key",    "OpenRouter API Key", True),
            ("DEEPSEEK_API_KEY",      "deepseek_api_key",      "DeepSeek API Key", True),
            ("KIMI_API_KEY",          "kimi_api_key",          "Kimi API Key  (Moonshot)", True),
            ("NVIDIA_NIM_API_KEY",    "nvidia_nim_api_key",    "NVIDIA NIM API Key  (Opus-tier routing)", True),
            ("FIREWORKS_API_KEY",     "fireworks_api_key",     "Fireworks AI API Key", True),
            ("ZAI_API_KEY",           "zai_api_key",           "Z.ai API Key", True),
            ("WAFER_API_KEY",         "wafer_api_key",         "Wafer API Key", True),
        ]

        try:
            from memory.config_manager import load_proxy_keys
            proxy_cfg = load_proxy_keys()
        except Exception:
            proxy_cfg = {}

        self._proxy_fields: dict[str, QLineEdit] = {}
        for env_key, our_key, label, echo in _PROXY_PROVIDERS:
            row = QHBoxLayout(); row.setSpacing(6)
            lbl = QLabel(label); lbl.setFixedWidth(260)
            lbl.setFont(QFont(FONT_UI, 7))
            lbl.setStyleSheet(f"color:{C.TEXT_MED};background:transparent;")
            f = self._field(f"Leave blank if unused", echo=echo,
                            val=proxy_cfg.get(our_key, ""))
            row.addWidget(lbl); row.addWidget(f, stretch=1)
            pp.addLayout(row)
            self._proxy_fields[our_key] = f

        pp.addWidget(self._sep())
        pp.addWidget(self._lbl("ROUTING TIERS", 8, bold=True, color=C.TEXT_DIM))
        tiers = [
            (C.PRI,   "Opus   (Pro/Ultra)",   "NVIDIA NIM · Kimi · Fireworks"),
            (C.ACC2,  "Sonnet (Standard)",     "DeepSeek · Wafer · OpenRouter"),
            (C.GREEN, "Haiku  (Flash)",        "Local Ollama · llama.cpp · LM Studio"),
        ]
        for col, tier, backends in tiers:
            row = QHBoxLayout(); row.setSpacing(8)
            row.addWidget(self._lbl(tier, 7, bold=True, color=col))
            row.addWidget(self._lbl(backends, 7, color=C.TEXT_DIM), stretch=1)
            pp.addLayout(row)

        pp.addStretch()

    def _build_header_and_tabs(self, root: QVBoxLayout):
        root.addWidget(self._lbl("⚙  OCTO SETTINGS", 12, True, C.PRI,
                            Qt.AlignmentFlag.AlignCenter))
        root.addWidget(self._lbl(
            "Gear = AI core config only.  Use nav pages for Proxy & Gateway.",
            7, color=C.TEXT_DIM, align=Qt.AlignmentFlag.AlignCenter))

        # Settings has only the AI tab now — Proxy/Gateway live in their own nav pages
        root.addWidget(self._sep())

    def _build_footer(self, root: QVBoxLayout):
        # Only AI panel shown — proxy/gateway duplication removed
        root.addWidget(self._ai_panel, stretch=1)

        root.addWidget(self._sep())
        btn_row2 = QHBoxLayout(); btn_row2.setSpacing(8)
        close_btn = QPushButton("✕  Close")
        close_btn.setFont(QFont(FONT_UI, 9)); close_btn.setFixedHeight(32)
        close_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        close_btn.setStyleSheet(f"""
            QPushButton {{
                background: transparent; color: {C.TEXT_DIM};
                border: 1px solid {C.BORDER}; border-radius: 6px;
            }}
            QPushButton:hover {{
                color: {C.TEXT}; border: 1px solid {C.BORDER_B};
                background: rgba(122, 152, 192, 0.08);
            }}""")
        close_btn.clicked.connect(self.hide)
        save_btn = QPushButton("▸  SAVE SETTINGS")
        save_btn.setFont(QFont(FONT_UI, 9, QFont.Weight.Bold)); save_btn.setFixedHeight(32)
        save_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        save_btn.setStyleSheet(f"""
            QPushButton {{
                background: {C.PRI_GHO}; color: {C.PRI};
                border: 1px solid {C.PRI_DIM}; border-radius: 6px;
            }}
            QPushButton:hover {{
                background: rgba(77, 166, 255, 0.15); border: 1px solid {C.PRI};
            }}""")
        save_btn.clicked.connect(self._save)
        btn_row2.addWidget(close_btn); btn_row2.addWidget(save_btn, stretch=1)
        root.addLayout(btn_row2)

    def _build_ui(self):
        cfg    = self._cfg
        gw_cfg = self._load_gw_cfg()

        root = QVBoxLayout(self)
        root.setContentsMargins(24, 16, 24, 16)
        root.setSpacing(6)

        self._build_header_and_tabs(root)

        self._build_ai_panel(cfg)

        self._build_proxy_panel(cfg)

        self._build_gw_panel(gw_cfg)

        self._build_footer(root)

    def _switch_stab(self, name: str):
        """No-op — AI-only gear overlay, no tabs needed."""
        pass

    # ── interactions ──────────────────────────────────────────────────────────
    def _sel_model(self, key: str):
        self._sel_model_key = key
        for k, btn in self._model_btns.items():
            if k == key:
                btn.setStyleSheet(f"""
                    QPushButton {{
                        background: {C.PRI}; color: #001a22;
                        border: none; border-radius: 6px; font-weight: bold;
                    }}
                """)
            else:
                btn.setStyleSheet(f"""
                    QPushButton {{
                        background: {C.DARK}; color: {C.TEXT_DIM};
                        border: 1px solid {C.BORDER}; border-radius: 6px;
                    }}
                    QPushButton:hover {{ color: {C.TEXT}; border: 1px solid {C.BORDER_B}; }}
                """)

    def _detect_models(self):
        url = self._ollama_url_f.text().strip() or "http://localhost:11434"
        models = self._fetch_ollama_models(url)
        if models:
            self._detected_lbl.setText("Found: " + "  ·  ".join(models[:6]))
            # pre-fill model field with best match
            prefer = ["gemma3", "gemma2", "llama3.2", "llama3", "mistral", "phi3"]
            for p in prefer:
                for m in models:
                    if m.startswith(p.split(":")[0]):
                        if not self._ollama_mod_f.text().strip():
                            self._ollama_mod_f.setText(m)
                        break
        else:
            self._detected_lbl.setText("No models found — is Ollama running?")
            self._detected_lbl.setStyleSheet(f"color: {C.ACC}; background: transparent;")

    def _save(self):
        # ── AI settings ──
        cfg = self._load_cfg()
        cfg["gemini_api_key"]    = self._key_f.text().strip()
        cfg["live_model"]        = self._live_model_f.text().strip() or _DEFAULT_LIVE_MODEL
        cfg["ollama_base_url"]   = self._ollama_url_f.text().strip() or "http://localhost:11434"
        cfg["ollama_model"]      = self._ollama_mod_f.text().strip()
        cfg["text_llm_provider"] = getattr(self, "_sel_model_key", "gemini-2.5-flash")
        self._save_cfg(cfg)

        # ── Sync Gemini key + proxy keys via unified config_manager ──
        try:
            from memory.config_manager import save_api_keys, sync_proxy_env
            save_api_keys(cfg["gemini_api_key"])
            sync_proxy_env()
        except Exception as e:
            print(f"[OCTO] Config sync: {e}")

        # ── Gateway settings ──
        gw: dict = {}
        for platform, fields in getattr(self, "_gw_fields", {}).items():
            vals = {fname: f.text().strip() for fname, f in fields.items() if f.text().strip()}
            if vals:
                vals["enabled"] = True
                gw[platform] = vals
        if gw:
            try:
                from memory.config_manager import save_gateway_config
                save_gateway_config(gw)
            except Exception as e:
                print(f"[OCTO] Gateway save: {e}")

        # ── Proxy provider keys ──
        proxy_keys = {k: f.text().strip() for k, f in getattr(self, "_proxy_fields", {}).items()}
        if any(proxy_keys.values()):
            try:
                from memory.config_manager import save_proxy_keys
                save_proxy_keys(proxy_keys)
            except Exception as e:
                print(f"[OCTO] Proxy key save: {e}")

        self.saved.emit()
        self.hide()

    def _start_gateway(self):
        import threading
        # Save first
        self._save()
        self._gw_status_lbl.setText("Gateway: starting...")
        self._gw_status_lbl.setStyleSheet(f"color:{C.ACC2};background:transparent;")

        def _run():
            try:
                from agent.hermes_bridge import start_gateway, gateway_status
                started = start_gateway()
                status  = gateway_status()
                if started:
                    msg = f"Gateway running: {', '.join(started)}"
                    col = C.GREEN
                else:
                    msg = "Gateway up (no platforms configured with tokens)"
                    col = C.ACC2
                self._gw_status_lbl.setText(msg)
                self._gw_status_lbl.setStyleSheet(f"color:{col};background:transparent;")
            except Exception as e:
                self._gw_status_lbl.setText(f"Error: {e}")
                self._gw_status_lbl.setStyleSheet(f"color:{C.RED};background:transparent;")

        threading.Thread(target=_run, daemon=True).start()

    def _detect_gemini_models(self):
        key = self._key_f.text().strip()
        if not key:
            self._gm_detect_lbl.setText("Enter API key first.")
            return
        self._gm_detect_btn.setText("Detecting...")
        self._gm_detect_btn.setEnabled(False)
        QApplication.processEvents()

        import threading
        def _run():
            live, text = _fetch_gemini_models(key)
            def _apply():
                self._gm_detect_btn.setText("⟳  Detect Gemini Models")
                self._gm_detect_btn.setEnabled(True)
                if live:
                    self._live_model_f.setText(live[0])
                    self._gm_detect_lbl.setText(
                        "Live: " + "  ·  ".join(live[:3]) +
                        ("  |  Text: " + ", ".join(text[:3]) if text else "")
                    )
                    self._gm_detect_lbl.setStyleSheet(f"color: {C.GREEN}; background: transparent;")
                else:
                    self._gm_detect_lbl.setText("No models found — check key")
                    self._gm_detect_lbl.setStyleSheet(f"color: {C.ACC}; background: transparent;")
            QTimer.singleShot(0, _apply)
        threading.Thread(target=_run, daemon=True).start()


# ── ChatWidget ────────────────────────────────────────────────────────────────
class ChatWidget(QWidget):
    """Persistent text chat panel backed by text_llm."""
    _resp_sig = pyqtSignal(str)
    _err_sig  = pyqtSignal(str)

    def __init__(self, system: str = "", parent=None):
        super().__init__(parent)
        self._system  = system
        self._history: list[dict] = []
        self._waiting = False
        self._mode_global = False
        self._live_context = ""  # injected by Mt5Page on every refresh

        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        self._display = QTextEdit()
        self._display.setReadOnly(True)
        self._display.setFont(QFont(FONT_UI, 9))
        self._display.setStyleSheet(f"""
            QTextEdit {{
                background: {C.PANEL}; color: {C.TEXT};
                border: 1px solid {C.BORDER}; border-radius: 6px; padding: 6px;
            }}
            QScrollBar:vertical {{
                background: {C.BG}; width: 6px; border: none; border-radius: 3px;
            }}
            QScrollBar::handle:vertical {{
                background: {C.BORDER_B}; border-radius: 3px; min-height: 15px;
            }}
        """)
        lay.addWidget(self._display)

        # Mode selector row
        mode_lay = QHBoxLayout()
        mode_lay.setContentsMargins(0, 4, 0, 4)
        mode_lay.setSpacing(6)
        
        self._mode_btn = QPushButton("◈ MODE: DEDICATED (RISK DESK)")
        self._mode_btn.setFont(QFont(FONT_UI, 7, QFont.Weight.Bold))
        self._mode_btn.setFixedHeight(18)
        self._mode_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._mode_btn.clicked.connect(self._toggle_mode)
        
        mode_lay.addWidget(self._mode_btn)
        mode_lay.addStretch()
        lay.addLayout(mode_lay)

        # Input & Send row
        input_lay = QHBoxLayout()
        input_lay.setContentsMargins(0, 0, 0, 0)
        input_lay.setSpacing(4)

        self._input = QLineEdit()
        self._input.setPlaceholderText("Type technical message to Risk Desk...")
        self._input.setFont(QFont(FONT_UI, 9))
        self._input.setFixedHeight(28)
        self._input.setStyleSheet(f"""
            QLineEdit {{
                background: {C.PANEL}; color: {C.WHITE};
                border: 1px solid {C.BORDER}; border-radius: 6px; padding: 3px 8px;
            }}
            QLineEdit:focus {{ border: 1px solid {C.PRI}; background: #0a1428; }}
        """)
        self._input.returnPressed.connect(self._on_send_clicked)
        input_lay.addWidget(self._input, stretch=1)

        self._send_btn = QPushButton("SEND")
        self._send_btn.setFont(QFont(FONT_UI, 8, QFont.Weight.Bold))
        self._send_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._send_btn.setFixedHeight(28)
        self._send_btn.setFixedWidth(54)
        self._send_btn.setStyleSheet(f"""
            QPushButton {{
                background: {C.PRI_GHO}; color: {C.PRI};
                border: 1px solid {C.BORDER}; border-radius: 6px;
            }}
            QPushButton:hover {{
                background: rgba(77, 166, 255, 0.15); color: {C.WHITE};
                border-color: {C.PRI};
            }}
        """)
        self._send_btn.clicked.connect(self._on_send_clicked)
        input_lay.addWidget(self._send_btn)

        lay.addLayout(input_lay)

        self._resp_sig.connect(self._on_response)
        self._err_sig.connect(self._on_error)
        
        self._update_mode_ui()

    def _toggle_mode(self):
        self._mode_global = not self._mode_global
        self._update_mode_ui()

    def _update_mode_ui(self):
        if self._mode_global:
            self._mode_btn.setText("◈ MODE: GLOBAL SYSTEM (OCTO)")
            self._mode_btn.setStyleSheet(f"""
                QPushButton {{
                    background: {C.PRI_GHO}; color: {C.PRI};
                    border: 1px solid {C.BORDER}; border-radius: 4px; padding: 0 6px;
                }}
                QPushButton:hover {{
                    border-color: {C.PRI}; background: rgba(77, 166, 255, 0.08);
                }}
            """)
            self._input.setPlaceholderText("Type general task or question to OCTO...")
        else:
            self._mode_btn.setText("◈ MODE: DEDICATED (RISK DESK)")
            self._mode_btn.setStyleSheet(f"""
                QPushButton {{
                    background: rgba(255, 122, 51, 0.08); color: {C.ACC};
                    border: 1px solid rgba(255, 122, 51, 0.2); border-radius: 4px; padding: 0 6px;
                }}
                QPushButton:hover {{
                    border-color: {C.ACC}; background: rgba(255, 122, 51, 0.15);
                }}
            """)
            self._input.setPlaceholderText("Type technical message to Risk Desk...")

    def _on_send_clicked(self):
        text = self._input.text().strip()
        if not text:
            return
        self._input.clear()
        self.send(text)

    def send(self, text: str):
        if self._waiting:
            return
        
        if self._mode_global:
            main_win = None
            for w in QApplication.topLevelWidgets():
                if w.__class__.__name__ == "MainWindow":
                    main_win = w
                    break
            if main_win and main_win.on_text_command:
                import html as _h
                self._append(f'<div style="font-family:\'{FONT_UI}\';color:{C.PRI};margin:3px 0;padding:2px 4px;"><b>You (Global):</b> {_h.escape(text)}</div>')
                self._append(f'<div style="font-family:\'{FONT_UI}\';color:{C.TEXT_DIM};margin:3px 0;padding:2px 4px;font-style:italic;">Sent command to global coordinator...</div>')
                threading.Thread(target=main_win.on_text_command, args=(text,), daemon=True).start()
                main_win._log.append_log(f"You (from Risk Desk Chat): {text}")
                self._scroll_bottom()
                return
            else:
                self._append(f'<div style="font-family:\'{FONT_UI}\';color:{C.RED};margin:3px 0;padding:2px 4px;">ERR: Global assistant is not active or available.</div>')
                self._scroll_bottom()
                return

        # Dedicated Risk Desk mode
        self._waiting = True
        import html as _h
        self._append(f'<div style="font-family:\'{FONT_UI}\';color:{C.ACC2};margin:3px 0;padding:2px 4px;"><b>You:</b> {_h.escape(text)}</div>')
        self._history.append({"role": "user", "content": text})
        self._append(f'<div style="font-family:\'{FONT_UI}\';color:{C.TEXT_DIM};margin:3px 0;padding:2px 4px;font-style:italic;">OCTO: thinking...</div>')
        threading.Thread(target=self._fetch, args=(text,), daemon=True).start()

    def update_live_context(self, portfolio: dict, prices: list | None = None):
        """Called by Mt5Page on every MT5 data refresh to inject live position/account state
        AND the latest Volume Profile data from the background VP service.
        This ensures OCTO answers questions like 'should I close NAS100?' or 'what is the POC?'
        without asking the user for data it already has."""
        try:
            acc = portfolio.get("account", {})
            bal = acc.get("balance", 0.0)
            eq  = acc.get("equity", 0.0)
            fp  = acc.get("floating_profit", 0.0)
            cur = acc.get("currency", "USD")
            ml  = acc.get("margin_level", 0.0)
            broker = acc.get("broker", "?")
            login  = acc.get("account_id", "?")

            lines = [
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
                "⚡ LIVE MT5 ACCOUNT SNAPSHOT (auto-refreshed every 5s)",
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
                f"Account: {login} | Broker: {broker}",
                f"Balance: {cur} {bal:,.2f} | Equity: {cur} {eq:,.2f}",
                f"Floating P&L: {fp:+.2f} {cur} | Margin Level: {ml:.1f}%",
                "",
                "OPEN POSITIONS:"
            ]
            positions = portfolio.get("positions", [])
            if not positions:
                lines.append("  (No open positions)")
            else:
                for pos in positions:
                    sym      = pos.get("symbol", "?")
                    p_type   = pos.get("type", "?")
                    vol      = pos.get("volume", 0)
                    o_price  = pos.get("open_price", 0)
                    c_price  = pos.get("current_price", 0)
                    profit   = pos.get("profit", 0)
                    sl       = pos.get("sl", 0) or pos.get("stop_loss", 0) or 0
                    tp       = pos.get("tp", 0) or pos.get("take_profit", 0) or 0
                    ticket   = pos.get("ticket", "?")
                    swap     = pos.get("swap", 0)
                    lines.append(
                        f"  [{p_type}] {sym} | Lot: {vol:.2f} | Ticket: #{ticket}\n"
                        f"    Entry: {o_price} → Current: {c_price}\n"
                        f"    P&L: {profit:+.2f} {cur} | SL: {sl or 'NOT SET'} | TP: {tp or 'NOT SET'} | Swap: {swap:.2f}"
                    )

            if prices:
                lines.append("")
                lines.append("LIVE WATCHLIST PRICES:")
                for p in prices:
                    if not p.get("error"):
                        lines.append(
                            f"  {p.get('symbol','?')} — Bid: {p.get('bid', 0):.5f} | Ask: {p.get('ask', 0):.5f} | Spread: {p.get('spread_points', 0):.1f} pts"
                        )

            # ── Inject Volume Profile data from background VP service ──────────
            try:
                import json as _json
                from pathlib import Path as _Path
                _vp_path = _Path(__file__).resolve().parent / "scripts" / "volume_profile_live.json"
                if _vp_path.exists():
                    with open(_vp_path, "r", encoding="utf-8") as _f:
                        _vp_data = _json.load(_f)
                    _syms = _vp_data.get("symbols", {})
                    _gen  = _vp_data.get("generated_at", "unknown")
                    if _syms:
                        lines.append("")
                        lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
                        lines.append(f"📊 LIVE VOLUME PROFILE & WHALE ENGINE DATA (as of {_gen})")
                        lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
                        for _sk, _sv in _syms.items():
                            if "error" in _sv:
                                continue
                            _whale = _sv.get("whale", {})
                            _fvgs  = _sv.get("fvg_recent", [])
                            _vol   = _sv.get("volume", {})
                            fvg_str = ""
                            if _fvgs:
                                last_fvg = _fvgs[-1]
                                fvg_str = (f" | FVG({last_fvg['type']}): "
                                           f"{last_fvg['bottom']}–{last_fvg['top']}")
                            lines.append(
                                f"\n  [{_sk}] {_sv.get('timeframe','M15')} | Price: {_sv.get('current_price','?')}"
                                f"\n    POC: {_sv.get('poc','?')} | VAH: {_sv.get('vah','?')} | VAL: {_sv.get('val','?')}"
                                f"\n    Bias: {_sv.get('bias','?')}"
                                f"\n    PDH: {_sv.get('pdh','?')} | PDL: {_sv.get('pdl','?')}"
                                f" | Near PDH: {_sv.get('near_pdh',False)} | Near PDL: {_sv.get('near_pdl',False)}"
                                f"\n    Whale α={_whale.get('dynamic_alpha','?')} VR={_whale.get('volatility_ratio_vr','?')} → {_whale.get('state','?')}"
                                f"\n    Volume: Last={_vol.get('last_bar','?')} Avg10={_vol.get('avg_10bar','?')} "
                                f"Ratio={_vol.get('ratio_vs_avg','?')}x Spike={_vol.get('high_volume_spike',False)}"
                                f"{fvg_str}"
                            )
            except Exception:
                pass  # VP service may not be running yet — degrade gracefully

            lines.append("")
            lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
            lines.append("INSTRUCTION: Use ALL the above live data to answer trading questions.")
            lines.append("NEVER ask the user for position data, POC, VAH/VAL, or price data you already have above.")
            lines.append("Give direct, numerical, data-driven answers. Do not say you 'cannot access live data'.")
            lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
            self._live_context = "\n".join(lines)
        except Exception:
            self._live_context = ""


    def _fetch(self, text: str):
        try:
            from core import text_llm
            ctx = "\n".join(
                f"{'User' if m['role']=='user' else 'OCTO'}: {m['content']}"
                for m in self._history[-10:]
            )
            # Prepend live MT5 snapshot so OCTO never needs to ask for position data
            live_block = f"\n\n{self._live_context}" if self._live_context else ""
            sys_p = self._system + live_block + (f"\n\nConversation history:\n{ctx}" if len(self._history) > 1 else "")
            response = text_llm.ask(text, system=sys_p)
            self._history.append({"role": "assistant", "content": response})
            self._resp_sig.emit(response)
        except Exception as e:
            self._err_sig.emit(str(e))

    def _on_response(self, text: str):
        self._waiting = False
        self._remove_thinking()
        self._append(
            f'<div style="font-family:\'{FONT_UI}\';color:{C.PRI};margin:4px 0;padding:2px 4px;line-height:14px;"><b>OCTO:</b> {self._fmt(text)}</div>'
        )
        self._scroll_bottom()

    def _on_error(self, text: str):
        self._waiting = False
        self._remove_thinking()
        import html as _h
        self._append(f'<div style="font-family:\'{FONT_UI}\';color:{C.RED};margin:4px 0;padding:2px 4px;">ERR: {_h.escape(text)}</div>')

    def _remove_thinking(self):
        html = self._display.toHtml()
        idx = html.rfind("thinking")
        if idx != -1:
            s = html.rfind("<div", 0, idx)
            e = html.find("</div>", idx) + 6
            if s != -1 and e > s:
                self._display.setHtml(html[:s] + html[e:])

    def _append(self, html: str):
        cur = self._display.textCursor()
        cur.movePosition(cur.MoveOperation.End)
        self._display.setTextCursor(cur)
        self._display.insertHtml(html + "<br>")

    def _scroll_bottom(self):
        self._display.verticalScrollBar().setValue(
            self._display.verticalScrollBar().maximum()
        )

    @staticmethod
    def _fmt(text: str) -> str:
        import re, html as _h
        text = _h.escape(text)
        text = re.sub(
            r'```(\w*)\n?(.*?)```',
            f'<pre style="background:{C.DARK};color:{C.GREEN};padding:6px;'
            f'border:1px solid {C.BORDER};border-radius:6px;font-family:\'{FONT_DATA}\';'
            f'font-size:8pt;white-space:pre-wrap;margin:4px 0;">\\2</pre>',
            text, flags=re.DOTALL,
        )
        text = re.sub(
            r'`([^`\n]+)`',
            f'<code style="background:{C.DARK};color:{C.GREEN};padding:2px 4px;'
            f'border:1px solid {C.BORDER};border-radius:4px;font-family:\'{FONT_DATA}\';'
            f'font-size:8.5pt;">\\1</code>',
            text,
        )
        text = text.replace("\n", "<br>")
        return text


# ── ProjectWidget ─────────────────────────────────────────────────────────────
class ProjectWidget(QWidget):
    """Live agent_task queue viewer with auto-refresh."""

    _STATUS_COLOR = {
        "pending":   C.ACC2,
        "running":   C.PRI,
        "completed": C.GREEN,
        "failed":    C.RED,
        "cancelled": C.TEXT_DIM,
    }

    def __init__(self, parent=None):
        super().__init__(parent)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(3)

        hdr = QHBoxLayout()
        ttl = QLabel("ACTIVE PROJECTS")
        ttl.setFont(QFont(FONT_UI, 8, QFont.Weight.Bold))
        ttl.setStyleSheet(f"color: {C.TEXT_MED}; background: transparent; letter-spacing: 0.5px;")
        hdr.addWidget(ttl)
        hdr.addStretch()
        ref = QPushButton("↺")
        ref.setFixedSize(20, 18)
        ref.setFont(QFont(FONT_UI, 9))
        ref.setCursor(Qt.CursorShape.PointingHandCursor)
        ref.setStyleSheet(f"""
            QPushButton {{
                background: transparent; color: {C.PRI_DIM};
                border: 1px solid {C.BORDER}; border-radius: 4px;
            }}
            QPushButton:hover {{ color: {C.PRI}; border-color: {C.PRI}; background: rgba(77, 166, 255, 0.08); }}
        """)
        ref.clicked.connect(self.refresh)
        hdr.addWidget(ref)
        lay.addLayout(hdr)

        self._display = QTextEdit()
        self._display.setReadOnly(True)
        self._display.setFont(QFont(FONT_UI, 9))
        self._display.setStyleSheet(f"""
            QTextEdit {{
                background: {C.PANEL}; color: {C.TEXT};
                border: 1px solid {C.BORDER}; border-radius: 6px; padding: 6px;
            }}
        """)
        lay.addWidget(self._display)

        self._tmr = QTimer(self)
        self._tmr.timeout.connect(self.refresh)
        self._tmr.start(2000)
        self.refresh()

    def refresh(self):
        import html as _h
        rows = []

        # ── Agent tasks ──────────────────────────────────────────────────
        try:
            from agent.task_queue import get_queue
            tasks = list(reversed(get_queue().get_all_statuses()))
        except Exception:
            tasks = []

        if tasks:
            rows.append(f'<div style="color:{C.PRI};margin:4px 0 2px 0;font-weight:bold;">◈ OCTO TASKS</div>')
        for t in tasks:
            col  = self._STATUS_COLOR.get(t["status"], C.WHITE)
            goal = _h.escape(t["goal"][:50])
            rows.append(
                f'<div style="margin:2px 0;">'
                f'<span style="color:{col};font-weight:bold;">[{t["status"].upper()[:4]}]</span> '
                f'<span style="color:{C.TEXT_MED};">#{t["task_id"]}</span> '
                f'<span style="color:{C.WHITE};">{goal}</span>'
                f'</div>'
            )

        # ── Cron jobs ────────────────────────────────────────────────────
        try:
            from agent.hermes_bridge import list_cron_jobs
            crons = list_cron_jobs()
        except Exception:
            crons = []

        if crons:
            rows.append(f'<div style="color:{C.PRI};margin:6px 0 2px 0;font-weight:bold;">⏰ OCTO SCHEDULER</div>')
        for c in crons:
            enabled = c.get("enabled", True)
            col     = C.GREEN if enabled else C.TEXT_DIM
            label   = _h.escape((c.get("label") or c.get("prompt", ""))[:48])
            sched   = _h.escape(c.get("schedule", ""))
            cid     = str(c.get("id", ""))[:8]
            rows.append(
                f'<div style="margin:2px 0;">'
                f'<span style="color:{col};font-weight:bold;">{"✓" if enabled else "⏸"}</span> '
                f'<span style="color:{C.ACC2};">{sched}</span> '
                f'<span style="color:{C.WHITE};">{label}</span> '
                f'<span style="color:{C.TEXT_DIM};">#{cid}</span>'
                f'</div>'
            )

        # ── Skills ───────────────────────────────────────────────────────
        try:
            from agent.hermes_bridge import list_skills
            skills = list_skills()
        except Exception:
            skills = []

        if skills:
            rows.append(f'<div style="color:{C.PRI};margin:6px 0 2px 0;font-weight:bold;">📚 OCTO CAPABILITIES</div>')
            for s in skills[:8]:
                name = _h.escape(str(s.get("name", s) if isinstance(s, dict) else s))
                rows.append(f'<div style="margin:2px 0;color:{C.TEXT_MED};">• {name}</div>')

        if not rows:
            rows = [
                f'<div style="color:{C.TEXT_DIM};">No projects yet.<br><br>'
                f'<span style="color:{C.TEXT_MED};">Try saying:</span><br>'
                f'"Research X and save to file" → agent task<br>'
                f'"Every morning at 9am summarize the news" → cron job</div>'
            ]

        self._display.setHtml(
            f'<div style="font-family:\'{FONT_UI}\';font-size:11px;line-height:14px;">{"".join(rows)}</div>'
        )


class MainWindow(QMainWindow):
    _log_sig        = pyqtSignal(str)
    _state_sig      = pyqtSignal(str)
    _show_setup_sig = pyqtSignal()
    _mt5_hud_sig    = pyqtSignal(dict)
    _amplitude_sig  = pyqtSignal(float)

    def __init__(self, face_path: str):
        super().__init__()
        self.setWindowTitle("OCTO — OCTO")
        self.setMinimumSize(_MIN_W, _MIN_H)
        self.resize(_DEFAULT_W, _DEFAULT_H)

        screen = QApplication.primaryScreen().availableGeometry()
        self.move(
            (screen.width()  - _DEFAULT_W) // 2,
            (screen.height() - _DEFAULT_H) // 2,
        )

        self.on_text_command  = None
        self._muted           = False
        self._current_file: str | None = None

        central = QWidget()
        central.setStyleSheet(f"background: {C.BG};")
        self.setCentralWidget(central)

        root = QVBoxLayout(central)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        root.addWidget(self._build_header())

        body = QHBoxLayout()
        body.setContentsMargins(0, 0, 0, 0)
        body.setSpacing(0)

        self._left_panel = self._build_left_panel()
        body.addWidget(self._left_panel, stretch=0)

        # ── Center: stacked pages ──────────────────────────────────────────
        from PyQt6.QtWidgets import QStackedWidget
        self._center_stack = QStackedWidget()
        self._center_stack.setStyleSheet(f"background: {C.BG};")

        # Page 0 — HOME (HUD)
        self.hud = HudCanvas(face_path)
        self.hud.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self._center_stack.addWidget(self.hud)

        # Pages 1-5 — feature pages (lazy imported)
        self._pages: dict[str, QWidget] = {}
        from ui_pages.memory_page    import MemoryPage
        from ui_pages.scheduler_page import SchedulerPage
        from ui_pages.gateway_page   import GatewayPage
        from ui_pages.tools_page     import ToolsPage
        from ui_pages.mcp_page       import McpPage
        from ui_pages.skills_page    import SkillsPage
        from ui_pages.proxy_page     import ProxyPage
        from ui_pages.project_page   import ProjectPage
        from ui_pages.mt5_page       import Mt5Page

        for name, cls in [("proxy",     ProxyPage),
                           ("memory",    MemoryPage),
                           ("skills",    SkillsPage),
                           ("scheduler", SchedulerPage),
                           ("gateway",   GatewayPage),
                           ("tools",     ToolsPage),
                           ("mcp",       McpPage),
                           ("projects",  ProjectPage),
                           ("mt5",       Mt5Page)]:
            p = cls()
            self._pages[name] = p
            self._center_stack.addWidget(p)

        body.addWidget(self._center_stack, stretch=5)

        self._right_panel = self._build_right_panel()
        body.addWidget(self._right_panel, stretch=0)

        root.addLayout(body, stretch=1)
        root.addWidget(self._build_footer())

        self._clock_tmr = QTimer(self)
        self._clock_tmr.timeout.connect(self._tick_clock)
        self._clock_tmr.start(1000)
        self._tick_clock()

        # Metrik güncelleme timer'ı
        self._metric_tmr = QTimer(self)
        self._metric_tmr.timeout.connect(self._update_metrics)
        self._metric_tmr.start(2000)
        self._update_metrics()

        self._log_sig.connect(self._log.append_log)
        self._state_sig.connect(self._apply_state)
        self._show_setup_sig.connect(self._show_setup)
        self._mt5_hud_sig.connect(self._on_mt5_hud_updated)
        self._amplitude_sig.connect(self._handle_amplitude)

        self._overlay: SetupOverlay | None = None
        self._settings_overlay: SettingsOverlay | None = None
        self._ready = self._check_config()
        if not self._ready:
            self._show_setup()

        sc_mute = QShortcut(QKeySequence("F4"), self)
        sc_mute.activated.connect(self._toggle_mute)
        sc_full = QShortcut(QKeySequence("F11"), self)
        sc_full.activated.connect(self._toggle_fullscreen)

    def _handle_amplitude(self, amp: float):
        try:
            if getattr(self.hud, "web_view", None):
                self.hud.web_view.page().runJavaScript(f"window.setMouthOpen({amp});")
        except Exception:
            pass

    def _toggle_fullscreen(self):
        if self.isFullScreen():
            self.showNormal()
        else:
            self.showFullScreen()

    def _show_settings(self):
        # Always rebuild so it reflects the latest saved config
        if self._settings_overlay is not None:
            self._settings_overlay.deleteLater()
        self._settings_overlay = SettingsOverlay(self.centralWidget())
        self._settings_overlay.saved.connect(self._on_settings_saved)
        cw = self.centralWidget()
        ow, oh = 700, 580
        self._settings_overlay.setGeometry(
            (cw.width()  - ow) // 2,
            (cw.height() - oh) // 2,
            ow, oh,
        )
        self._settings_overlay.show()
        self._settings_overlay.raise_()
        # Auto-focus the key field so user can type right away
        self._settings_overlay._key_f.setFocus()
        self._settings_overlay._key_f.selectAll()

    def _on_settings_saved(self):
        was_ready   = self._ready
        self._ready = self._check_config()
        if self._ready and not was_ready:
            self._log.append_log("SYS: API key saved. OCTO connecting...")
        else:
            self._log.append_log("SYS: Settings saved.")

    def resizeEvent(self, event):
        super().resizeEvent(event)
        cw = self.centralWidget()
        if self._overlay and self._overlay.isVisible():
            ow, oh = 480, 520
            self._overlay.setGeometry(
                (cw.width()  - ow) // 2,
                (cw.height() - oh) // 2,
                ow, oh,
            )
        if self._settings_overlay and self._settings_overlay.isVisible():
            ow, oh = 700, 580
            self._settings_overlay.setGeometry(
                (cw.width()  - ow) // 2,
                (cw.height() - oh) // 2,
                ow, oh,
            )

    def _on_mt5_hud_updated(self, data: dict):
        online = data.get("online", False)
        if online:
            self._mt5_hud_status.setText("● ONLINE")
            self._mt5_hud_status.setStyleSheet(f"color: {C.GREEN}; background: transparent; font-weight: bold;")
            balance = data.get("balance", 0.0)
            pnl = data.get("pnl", 0.0)
            positions = data.get("positions", 0)
            self._mt5_hud_bal.setText(f"Balance: ${balance:,.2f}")
            self._mt5_hud_pnl.setText(f"PnL: ${pnl:,.2f}")
            pnl_col = C.GREEN if pnl >= 0 else C.RED
            self._mt5_hud_pnl.setStyleSheet(f"color: {pnl_col}; background: transparent; font-weight: bold;")
            self._mt5_hud_positions.setText(f"{positions} Positions")
            
            # Dynamic coordinate data injection to the WebGL polar Grid HUD
            active_trades = data.get("active_trades", [])
            if getattr(self, "web_view", None) and self.web_view:
                import json
                js_code = f"if (window.updateActiveTrades) window.updateActiveTrades({json.dumps(active_trades)});"
                self.web_view.page().runJavaScript(js_code)
        else:
            self._mt5_hud_status.setText("● OFFLINE")
            self._mt5_hud_status.setStyleSheet(f"color: {C.RED}; background: transparent; font-weight: bold;")
            self._mt5_hud_bal.setText("Balance: --")
            self._mt5_hud_pnl.setText("PnL: --")
            self._mt5_hud_pnl.setStyleSheet(f"color: {C.TEXT_DIM}; background: transparent;")
            self._mt5_hud_positions.setText("0 Positions")
            if getattr(self, "web_view", None) and self.web_view:
                self.web_view.page().runJavaScript("if (window.updateActiveTrades) window.updateActiveTrades([]);")

    def _update_metrics(self):
        """Spawns background thread to poll MT5 and updates the HUD card."""
        import threading
        def _run():
            try:
                import os
                import MetaTrader5 as mt5
                if not mt5.initialize():
                    # Fallback to explicit executable path launch
                    exe_path = r"C:\Program Files\MetaTrader 5\terminal64.exe"
                    if os.path.exists(exe_path):
                        if not mt5.initialize(path=exe_path):
                            self._mt5_hud_sig.emit({"online": False})
                            return
                    else:
                        self._mt5_hud_sig.emit({"online": False})
                        return
                acc = mt5.account_info()
                if not acc:
                    self._mt5_hud_sig.emit({"online": False})
                    return
                pos = mt5.positions_get()
                pos_count = len(pos) if pos else 0
                active_trades = []
                if pos:
                    for p in pos:
                        active_trades.append({
                            "symbol": p.symbol,
                            "type": "BUY" if p.type == 0 else "SELL"
                        })
                self._mt5_hud_sig.emit({
                    "online": True,
                    "balance": acc.balance,
                    "pnl": acc.profit,
                    "positions": pos_count,
                    "active_trades": active_trades
                })
            except Exception as e:
                self._mt5_hud_sig.emit({"online": False, "error": str(e)})

        threading.Thread(target=_run, daemon=True, name="octo-mt5-hud").start()



    def _build_header(self) -> QWidget:
        w = QWidget()
        w.setFixedHeight(54)
        w.setStyleSheet(f"background: {C.DARK}; border-bottom: 1px solid {C.BORDER_B};")
        lay = QHBoxLayout(w)
        lay.setContentsMargins(16, 0, 16, 0)

        def _badge(txt, color=C.TEXT_MED):
            l = QLabel(txt)
            l.setFont(QFont(FONT_UI, 8))
            l.setStyleSheet(f"color: {color}; background: transparent; letter-spacing: 0.5px;")
            return l

        lay.addWidget(_badge("OCTO", C.PRI_DIM))

        settings_btn = QPushButton("⚙")
        settings_btn.setFont(QFont(FONT_UI, 13))
        settings_btn.setFixedSize(34, 34)
        settings_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        settings_btn.setToolTip("Settings")
        settings_btn.setStyleSheet(f"""
            QPushButton {{
                background: transparent; color: {C.PRI_DIM};
                border: 1px solid {C.BORDER}; border-radius: 6px;
            }}
            QPushButton:hover {{
                color: {C.PRI}; border: 1px solid {C.PRI};
                background: rgba(77, 166, 255, 0.08);
            }}
        """)
        settings_btn.clicked.connect(self._show_settings)
        lay.addWidget(settings_btn)

        lay.addStretch()

        mid = QVBoxLayout(); mid.setSpacing(1)
        title = QLabel("OCTO")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setFont(QFont(FONT_UI, 16, QFont.Weight.Bold))
        title.setStyleSheet(f"color: {C.PRI}; background: transparent; letter-spacing: 1.5px;")
        mid.addWidget(title)
        sub = QLabel("Just A Rather Very Intelligent System")
        sub.setAlignment(Qt.AlignmentFlag.AlignCenter)
        sub.setFont(QFont(FONT_UI, 7))
        sub.setStyleSheet(f"color: {C.PRI_DIM}; background: transparent; letter-spacing: 0.5px;")
        mid.addWidget(sub)
        lay.addLayout(mid)
        lay.addStretch()

        right_col = QVBoxLayout(); right_col.setSpacing(2)
        self._clock_lbl = QLabel("00:00:00")
        self._clock_lbl.setFont(QFont(FONT_DATA, 14, QFont.Weight.Bold))
        self._clock_lbl.setStyleSheet(f"color: {C.PRI}; background: transparent;")
        self._clock_lbl.setAlignment(Qt.AlignmentFlag.AlignRight)
        right_col.addWidget(self._clock_lbl)
        self._date_lbl = QLabel("")
        self._date_lbl.setFont(QFont(FONT_UI, 8))
        self._date_lbl.setStyleSheet(f"color: {C.TEXT_DIM}; background: transparent;")
        self._date_lbl.setAlignment(Qt.AlignmentFlag.AlignRight)
        right_col.addWidget(self._date_lbl)
        lay.addLayout(right_col)
        return w

    def _tick_clock(self):
        self._clock_lbl.setText(time.strftime("%H:%M:%S"))
        self._date_lbl.setText(time.strftime("%a %d %b %Y"))

    def _poll_services(self):
        """Service status labels removed — no-op."""
        pass

    def _navigate(self, page: str):
        """Switch center to named page, or HOME (HUD) if page == 'home'."""
        for name, btn in self._nav_btns.items():
            btn.setChecked(name == page)
        if page == "home":
            self._center_stack.setCurrentIndex(0)
        else:
            page_order = ["proxy", "memory", "skills", "scheduler",
                          "gateway", "tools", "mcp", "projects", "mt5"]
            if page in page_order:
                self._center_stack.setCurrentIndex(page_order.index(page) + 1)

    def _build_left_panel(self) -> QWidget:
        w = QWidget()
        w.setFixedWidth(_LEFT_W)
        w.setStyleSheet(f"background: {C.DARK}; border-right: 1px solid {C.BORDER};")
        lay = QVBoxLayout(w)
        lay.setContentsMargins(8, 10, 8, 10)
        lay.setSpacing(4)

        # ── Navigation ────────────────────────────────────────────────────────
        nav_hdr = QLabel("◈ NAVIGATION")
        nav_hdr.setFont(QFont(FONT_UI, 8, QFont.Weight.Bold))
        nav_hdr.setStyleSheet(f"color: {C.PRI}; background: transparent; "
                              f"border-bottom: 1px solid {C.BORDER}; padding-bottom: 5px; letter-spacing: 0.5px;")
        lay.addWidget(nav_hdr)
        lay.addSpacing(3)

        _NAV_SS = f"""
            QPushButton {{
                background: transparent; color: {C.TEXT_DIM};
                border: 1px solid {C.BORDER}; border-radius: 6px;
                font-family: '{FONT_UI}'; font-size: 9px; font-weight: bold;
                padding: 4px 8px; text-align: left;
            }}
            QPushButton:checked {{
                background: {C.PRI_GHO}; color: {C.PRI};
                border: 1px solid {C.PRI};
            }}
            QPushButton:hover:!checked {{
                color: {C.TEXT_MED}; border: 1px solid {C.BORDER_B};
                background: rgba(77, 166, 255, 0.04);
            }}
        """

        _NAV_ITEMS = [
            ("home",      "🏠  HOME"),
            ("proxy",     "⚡  PROXY"),
            ("memory",    "💾  MEMORY"),
            ("skills",    "📚  CAPABILITIES"),
            ("scheduler", "⏰  SCHEDULER"),
            ("gateway",   "🌐  GATEWAY"),
            ("tools",     "🔧  TOOLS"),
            ("mcp",       "🔌  MCP"),
            ("projects",  "🗂  PROJECTS"),
            ("mt5",       "📊  METATRADER 5"),
        ]

        self._nav_btns: dict[str, QPushButton] = {}
        for key, label in _NAV_ITEMS:
            btn = QPushButton(label)
            btn.setCheckable(True)
            btn.setChecked(key == "home")
            btn.setFixedHeight(28)
            btn.setStyleSheet(_NAV_SS)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.clicked.connect(lambda _, k=key: self._navigate(k))
            lay.addWidget(btn)
            self._nav_btns[key] = btn

        lay.addStretch()
        return w
    def _build_right_panel(self) -> QWidget:
        w = QWidget()
        w.setFixedWidth(_RIGHT_W)
        w.setStyleSheet(f"background: {C.DARK}; border-left: 1px solid {C.BORDER};")
        lay = QVBoxLayout(w)
        lay.setContentsMargins(8, 10, 8, 10)
        lay.setSpacing(6)

        def _sec(txt):
            l = QLabel(f"▸ {txt}")
            l.setFont(QFont(FONT_UI, 7, QFont.Weight.Bold))
            l.setStyleSheet(f"color: {C.TEXT_MED}; background: transparent; letter-spacing: 0.5px;")
            return l

        _TAB_SS = f"""
            QPushButton {{
                background: transparent; color: {C.TEXT_DIM};
                border: 1px solid {C.BORDER}; border-radius: 6px;
                font-family: '{FONT_UI}'; font-size: 8px; font-weight: bold;
                padding: 2px 4px;
            }}
            QPushButton:checked {{
                background: {C.PRI_GHO}; color: {C.PRI};
                border: 1px solid {C.PRI};
            }}
            QPushButton:hover:!checked {{
                color: {C.TEXT_MED}; border: 1px solid {C.BORDER_B};
            }}
        """

        # ── LOG panel — always visible ──
        self._active_tab = "LOG"
        self._tab_btns: dict[str, QPushButton] = {}
        log_hdr = QHBoxLayout()
        log_title = QLabel("ACTIVITY LOG")
        log_title.setFont(QFont(FONT_UI, 8, QFont.Weight.Bold))
        log_title.setStyleSheet(f"color: {C.TEXT_DIM}; background: transparent; letter-spacing: 0.5px;")
        log_hdr.addWidget(log_title)
        log_hdr.addStretch()
        lay.addLayout(log_hdr)

        self._log = LogWidget()
        lay.addWidget(self._log, stretch=1)

        sep = QFrame(); sep.setFrameShape(QFrame.Shape.HLine)
        sep.setStyleSheet(f"color: {C.BORDER}; margin: 2px 0;")
        lay.addWidget(sep)

        lay.addWidget(_sec("FILE UPLOAD"))
        self._drop_zone = FileDropZone()
        self._drop_zone.file_selected.connect(self._on_file_selected)
        lay.addWidget(self._drop_zone)

        self._file_hint = QLabel("No file loaded — drop or click above to upload")
        self._file_hint.setFont(QFont(FONT_UI, 7))
        self._file_hint.setStyleSheet(f"color: {C.TEXT_MED}; background: transparent;")
        self._file_hint.setWordWrap(True)
        lay.addWidget(self._file_hint)

        # MT5 ACCOUNT METRICS CARD
        lay.addWidget(_sec("METATRADER 5 ACCOUNT"))
        self._mt5_hud_w = QFrame()
        self._mt5_hud_w.setFrameShape(QFrame.Shape.StyledPanel)
        self._mt5_hud_w.setStyleSheet(f"""
            QFrame {{
                background: {C.PANEL};
                border: 1px solid {C.BORDER};
                border-radius: 6px;
                padding: 6px;
            }}
        """)
        mt5_hud_lay = QVBoxLayout(self._mt5_hud_w)
        mt5_hud_lay.setContentsMargins(6, 6, 6, 6)
        mt5_hud_lay.setSpacing(4)

        status_row = QHBoxLayout()
        self._mt5_hud_status = QLabel("● OFFLINE")
        self._mt5_hud_status.setFont(QFont(FONT_UI, 8, QFont.Weight.Bold))
        self._mt5_hud_status.setStyleSheet(f"color: {C.RED}; background: transparent;")
        status_row.addWidget(self._mt5_hud_status)
        status_row.addStretch()
        self._mt5_hud_positions = QLabel("0 Positions")
        self._mt5_hud_positions.setFont(QFont(FONT_DATA, 8))
        self._mt5_hud_positions.setStyleSheet(f"color: {C.TEXT_DIM}; background: transparent;")
        status_row.addWidget(self._mt5_hud_positions)
        mt5_hud_lay.addLayout(status_row)

        metrics_row = QHBoxLayout()
        self._mt5_hud_bal = QLabel("Balance: --")
        self._mt5_hud_bal.setFont(QFont(FONT_DATA, 9, QFont.Weight.Bold))
        self._mt5_hud_bal.setStyleSheet(f"color: {C.WHITE}; background: transparent;")
        metrics_row.addWidget(self._mt5_hud_bal)
        metrics_row.addStretch()
        self._mt5_hud_pnl = QLabel("PnL: --")
        self._mt5_hud_pnl.setFont(QFont(FONT_DATA, 9, QFont.Weight.Bold))
        self._mt5_hud_pnl.setStyleSheet(f"color: {C.TEXT_DIM}; background: transparent;")
        metrics_row.addWidget(self._mt5_hud_pnl)
        mt5_hud_lay.addLayout(metrics_row)

        lay.addWidget(self._mt5_hud_w)

        sep2 = QFrame(); sep2.setFrameShape(QFrame.Shape.HLine)
        sep2.setStyleSheet(f"color: {C.BORDER}; margin: 2px 0;")
        lay.addWidget(sep2)

        lay.addWidget(_sec("COMMAND INPUT"))
        lay.addLayout(self._build_input_row())

        self._mute_btn = QPushButton("🎙  MICROPHONE ACTIVE")
        self._mute_btn.setFixedHeight(30)
        self._mute_btn.setFont(QFont(FONT_UI, 8, QFont.Weight.Bold))
        self._mute_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._mute_btn.clicked.connect(self._toggle_mute)
        self._style_mute_btn()
        lay.addWidget(self._mute_btn)

        fs_btn = QPushButton("⛶  FULLSCREEN  [F11]")
        fs_btn.setFixedHeight(26)
        fs_btn.setFont(QFont(FONT_UI, 8))
        fs_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        fs_btn.setStyleSheet(f"""
            QPushButton {{
                background: transparent; color: {C.TEXT_MED};
                border: 1px solid {C.BORDER}; border-radius: 6px;
            }}
            QPushButton:hover {{
                color: {C.PRI}; border: 1px solid {C.BORDER_B};
                background: rgba(77, 166, 255, 0.04);
            }}
        """)
        fs_btn.clicked.connect(self._toggle_fullscreen)
        lay.addWidget(fs_btn)

        return w

    def _switch_tab(self, name: str):
        """No-op placeholder — tabs removed, only LOG panel active."""
        pass

    def _build_input_row(self) -> QHBoxLayout:
        row = QHBoxLayout(); row.setSpacing(5)
        self._input = QLineEdit()
        self._input.setPlaceholderText("Type a command or question...")
        self._input.setFont(QFont(FONT_UI, 9))
        self._input.setFixedHeight(30)
        self._input.setStyleSheet(f"""
            QLineEdit {{
                background: {C.DARK}; color: {C.WHITE};
                border: 1px solid {C.BORDER}; border-radius: 6px; padding: 3px 7px;
            }}
            QLineEdit:focus {{ border: 1px solid {C.PRI}; background: #0a1428; }}
        """)
        self._input.returnPressed.connect(self._send)
        row.addWidget(self._input)

        send = QPushButton("▸")
        send.setFixedSize(30, 30)
        send.setFont(QFont(FONT_UI, 11, QFont.Weight.Bold))
        send.setCursor(Qt.CursorShape.PointingHandCursor)
        send.setStyleSheet(f"""
            QPushButton {{
                background: {C.PANEL}; color: {C.PRI};
                border: 1px solid {C.PRI_DIM}; border-radius: 6px;
            }}
            QPushButton:hover {{ background: {C.PRI_GHO}; border: 1px solid {C.PRI}; }}
        """)
        send.clicked.connect(self._send)
        row.addWidget(send)
        return row

    def _build_footer(self) -> QWidget:
        w = QWidget()
        w.setFixedHeight(22)
        w.setStyleSheet(f"background: {C.DARK}; border-top: 1px solid {C.BORDER};")
        lay = QHBoxLayout(w); lay.setContentsMargins(14, 0, 14, 0)

        def _fl(txt, color=C.TEXT_MED):
            l = QLabel(txt); l.setFont(QFont(FONT_UI, 7))
            l.setStyleSheet(f"color: {color}; background: transparent; letter-spacing: 0.5px;")
            return l

        lay.addWidget(_fl("[F4] Mute  ·  [F11] Fullscreen"))
        lay.addStretch()
        lay.addWidget(_fl("OCTO  ·  AI ASSISTANT  ·  CLASSIFIED"))
        lay.addStretch()
        lay.addWidget(_fl("© BOYAPATI", C.PRI_DIM))
        return w

    def _on_file_selected(self, path: str):
        self._current_file = path
        p    = Path(path)
        cat  = _file_category(p)
        icon, _ = _FILE_ICONS.get(cat, _FILE_ICONS["unknown"])
        size = _fmt_size(p.stat().st_size)
        self._file_hint.setText(f"{icon}  {p.name}  ·  {size}  ·  Tell OCTO what to do with it")
        self._log.append_log(f"FILE: {p.name} ({size}) loaded")
        if self.on_text_command:
            msg = (
                f"[FILE_UPLOADED] path={path} | name={p.name} | "
                f"type={p.suffix.lstrip('.')} | size={size} | "
                f"Briefly tell the user you can see the file '{p.name}' "
                f"({size}) has been uploaded and ask what they'd like to do with it."
            )
            threading.Thread(target=self.on_text_command, args=(msg,), daemon=True).start()

    def _toggle_mute(self):
        self._muted = not self._muted
        self.hud.muted = self._muted
        self._style_mute_btn()
        if self._muted:
            self._apply_state("MUTED")
            self._log.append_log("SYS: Microphone muted.")
        else:
            self._apply_state("LISTENING")
            self._log.append_log("SYS: Microphone active.")

    def _style_mute_btn(self):
        if self._muted:
            self._mute_btn.setText("🔇  MICROPHONE MUTED")
            self._mute_btn.setStyleSheet(f"""
                QPushButton {{
                    background: rgba(240, 64, 96, 0.1); color: {C.MUTED_C};
                    border: 1px solid {C.MUTED_C}; border-radius: 6px;
                }}
            """)
        else:
            self._mute_btn.setText("🎙  MICROPHONE ACTIVE")
            self._mute_btn.setStyleSheet(f"""
                QPushButton {{
                    background: rgba(45, 219, 138, 0.08); color: {C.GREEN};
                    border: 1px solid {C.GREEN}; border-radius: 6px;
                }}
                QPushButton:hover {{ background: rgba(45, 219, 138, 0.15); }}
            """)

    def _send(self):
        txt = self._input.text().strip()
        if not txt: return
        self._input.clear()
        self._log.append_log(f"You: {txt}")
        if self.on_text_command:
            threading.Thread(target=self.on_text_command, args=(txt,), daemon=True).start()

    def _apply_state(self, state: str):
        self.hud.state    = state
        self.hud.speaking = (state == "SPEAKING")

    def _check_config(self) -> bool:
        if not API_FILE.exists(): return False
        try:
            d    = json.loads(API_FILE.read_text(encoding="utf-8"))
            key  = d.get("gemini_api_key", "")
            invalid = ("", "YOUR_GEMINI_API_KEY_HERE", "YOUR_NEW_GEMINI_API_KEY_HERE")
            return key not in invalid and bool(d.get("os_system"))
        except Exception:
            return False

    def _show_setup(self):
        ov = SetupOverlay(self.centralWidget())
        cw = self.centralWidget()
        ow, oh = 480, 380
        ov.setGeometry(
            (cw.width()  - ow) // 2,
            (cw.height() - oh) // 2,
            ow, oh,
        )
        ov.done.connect(self._on_setup_done)
        ov.show()
        self._overlay = ov

    def _on_setup_done(self, key: str, os_name: str):
        os.makedirs(CONFIG_DIR, exist_ok=True)
        API_FILE.write_text(
            json.dumps({
                "gemini_api_key":    key,
                "os_system":         os_name,
                "ollama_base_url":   "http://localhost:11434",
                "ollama_model":      "",
                "text_llm_provider": "gemini-2.5-flash",
                "live_model":        _DEFAULT_LIVE_MODEL,
            }, indent=4),
            encoding="utf-8",
        )
        self._ready = True
        if self._overlay:
            self._overlay.hide()
            self._overlay = None
        self._apply_state("LISTENING")
        self._log.append_log("SYS: API key saved. OCTO connecting...")

class _RootShim:
    def __init__(self, app: QApplication):
        self._app = app
    def mainloop(self):
        self._app.exec()
    def protocol(self, *_):
        pass


class OctoUI:
    def __init__(self, face_path: str, size=None):
        self._app = QApplication.instance() or QApplication(sys.argv)
        self._app.setStyle("Fusion")
        self._win = MainWindow(face_path)
        self._win.show()
        self.root = _RootShim(self._app)

    @property
    def muted(self) -> bool:
        return self._win._muted

    @muted.setter
    def muted(self, v: bool):
        if v != self._win._muted:
            self._win._toggle_mute()

    @property
    def current_file(self) -> str | None:
        return self._win._drop_zone.current_file()

    @property
    def on_text_command(self):
        return self._win.on_text_command

    @on_text_command.setter
    def on_text_command(self, cb):
        self._win.on_text_command = cb

    def set_state(self, state: str):
        self._win._state_sig.emit(state)

    def write_log(self, text: str):
        self._win._log_sig.emit(text)

    def wait_for_api_key(self):
        while not self._win._ready:
            time.sleep(0.1)

    def show_setup(self):
        self._win._ready = False
        self._win._show_setup_sig.emit()

    def start_speaking(self):
        self.set_state("SPEAKING")

    def stop_speaking(self):
        if not self.muted:
            self.set_state("LISTENING")

    def set_amplitude(self, amplitude: float):
        self._win._amplitude_sig.emit(amplitude)
