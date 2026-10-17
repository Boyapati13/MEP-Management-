"""
Whale Suite v7.5 — Watchdog Telemetry Pipe
==========================================
Event-driven OS file-system interceptor (Tier 2 of the OCTO-Pro 3-tier architecture).

The MT5 Whale EA writes `whale_matrix_<SYMBOL>.json` files into MT5's Common Files
directory on every closed M5 bar. This service watches that directory via watchdog,
reads the payload with exponential-backoff retry on file-lock (IOError), and exposes
the latest parsed payload to the UI and multi-agent layer.

Thread-safe singleton: call start_background() once at app startup, then poll
get_latest_payload() / get_pipe_stats() from any thread.
"""

from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler as _FileSystemEventHandler
    _WATCHDOG_AVAILABLE = True
except ImportError:
    _WATCHDOG_AVAILABLE = False
    # Stub so the class definition below doesn't raise NameError
    class _FileSystemEventHandler:  # noqa: N801
        pass

# ── Config ─────────────────────────────────────────────────────────────────────
_MT5_COMMON = Path(os.environ.get("APPDATA", "")) / \
    "MetaQuotes" / "Terminal" / "Common" / "Files"

_RETRY_BASE_DELAY = 0.002   # 2 ms initial retry delay
_MAX_RETRIES      = 5       # exponential backoff up to ~64 ms total
_FILE_PREFIX      = "whale_matrix_"

# ── Singleton state ────────────────────────────────────────────────────────────
_lock            = threading.Lock()
_latest_payload: dict[str, Any] = {}
_pipe_stats: dict[str, Any] = {
    "status":          "IDLE",          # IDLE | WATCHING | ERROR
    "last_symbol":     "--",
    "last_update":     "--",
    "last_latency_ms": 0.0,
    "total_events":    0,
    "retry_count":     0,
    "errors":          0,
    "watch_path":      str(_MT5_COMMON),
}
_observer = None
_started  = False


# ── File event handler ─────────────────────────────────────────────────────────
class _WhaleMatrixHandler(_FileSystemEventHandler):
    def on_modified(self, event):
        _process_event(event.src_path)

    def on_created(self, event):
        _process_event(event.src_path)


def _process_event(src_path: str) -> None:
    fname = os.path.basename(src_path)
    if not fname.startswith(_FILE_PREFIX) or not fname.endswith(".json"):
        return

    t0 = time.perf_counter()
    delay = _RETRY_BASE_DELAY
    data = None

    for attempt in range(_MAX_RETRIES):
        try:
            with open(src_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            break
        except (IOError, json.JSONDecodeError):
            time.sleep(delay)
            delay *= 2

    latency_ms = (time.perf_counter() - t0) * 1000

    with _lock:
        if data is not None:
            _latest_payload.clear()
            _latest_payload.update(data)
            _pipe_stats["status"]          = "WATCHING"
            _pipe_stats["last_symbol"]     = data.get("symbol", fname)
            _pipe_stats["last_update"]     = datetime.now(timezone.utc).strftime("%H:%M:%S UTC")
            _pipe_stats["last_latency_ms"] = round(latency_ms, 2)
            _pipe_stats["total_events"]   += 1
        else:
            _pipe_stats["retry_count"] += 1
            _pipe_stats["errors"]      += 1
            _pipe_stats["status"]       = "ERROR"


# ── Public API ─────────────────────────────────────────────────────────────────
def start_background(watch_path: str | Path | None = None) -> None:
    """Start the watchdog observer thread. Safe to call multiple times — no-op after first call."""
    global _observer, _started

    with _lock:
        if _started:
            return
        _started = True

    if not _WATCHDOG_AVAILABLE:
        with _lock:
            _pipe_stats["status"] = "ERROR"
            _pipe_stats["last_symbol"] = "watchdog not installed"
        return

    path = Path(watch_path) if watch_path else _MT5_COMMON

    if not path.exists():
        path.mkdir(parents=True, exist_ok=True)

    with _lock:
        _pipe_stats["watch_path"] = str(path)
        _pipe_stats["status"]     = "WATCHING"

    handler   = _WhaleMatrixHandler()
    _observer = Observer()
    _observer.schedule(handler, path=str(path), recursive=False)
    _observer.daemon = True
    _observer.start()


def stop_background() -> None:
    """Stop the watchdog observer thread cleanly."""
    global _observer, _started
    if _observer is not None:
        _observer.stop()
        _observer.join()
        _observer = None
    with _lock:
        _started = False
        _pipe_stats["status"] = "IDLE"


def get_latest_payload() -> dict[str, Any]:
    """Return a copy of the most recently parsed whale telemetry payload."""
    with _lock:
        return dict(_latest_payload)


def get_pipe_stats() -> dict[str, Any]:
    """Return a copy of current pipe health statistics."""
    with _lock:
        return dict(_pipe_stats)


def inject_test_payload(symbol: str, data: dict) -> None:
    """Inject a synthetic payload for testing without needing live MT5. Thread-safe."""
    with _lock:
        _latest_payload.clear()
        _latest_payload.update(data)
        _pipe_stats["status"]          = "WATCHING"
        _pipe_stats["last_symbol"]     = symbol
        _pipe_stats["last_update"]     = datetime.now(timezone.utc).strftime("%H:%M:%S UTC")
        _pipe_stats["last_latency_ms"] = 0.0
        _pipe_stats["total_events"]   += 1


# ── Standalone run ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"[WatchdogPipe] Starting on: {_MT5_COMMON}")
    start_background()
    try:
        while True:
            time.sleep(2)
            stats = get_pipe_stats()
            print(
                f"[{stats['status']}] sym={stats['last_symbol']}  "
                f"t={stats['last_update']}  "
                f"lat={stats['last_latency_ms']}ms  "
                f"events={stats['total_events']}  errs={stats['errors']}"
            )
    except KeyboardInterrupt:
        stop_background()
        print("[WatchdogPipe] Stopped.")
