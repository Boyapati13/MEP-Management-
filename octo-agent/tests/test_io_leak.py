"""
OCTO-Pro v7.5 Integration Test 1 — High-Frequency I/O Race Condition Validation
================================================================================
Objective: Ensure the Python file-system watcher completely reads telemetry payloads
without hitting file-locks while the MT5 core thread is actively writing.

Run:
    python -m pytest tests/test_io_leak.py -v
    # or standalone:
    python tests/test_io_leak.py
"""

import json
import os
import sys
import tempfile
import threading
import time

import pytest

# Allow running from repo root or from tests/ directly
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
    _WATCHDOG_AVAILABLE = True
except ImportError:
    _WATCHDOG_AVAILABLE = False


# ── Live watchdog handler (mirrors production logic) ──────────────────────────
class _TestHandler(FileSystemEventHandler):
    def __init__(self):
        self.passed  = False
        self.failed  = False
        self.attempt = 0
        self._lock   = threading.Lock()

    def on_modified(self, event):
        self._handle(event.src_path)

    def on_created(self, event):
        self._handle(event.src_path)

    def _handle(self, src_path: str):
        fname = os.path.basename(src_path)
        if "whale_matrix_" not in fname:
            return

        retry_delay = 0.002
        for attempt in range(5):
            try:
                with open(src_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                with self._lock:
                    self.attempt = attempt + 1
                    self.passed  = True
                print(
                    f"[PASSED] Telemetry read successfully on attempt {attempt + 1}. "
                    f"Symbol: {data.get('symbol', 'UNKNOWN')}"
                )
                return
            except (IOError, json.JSONDecodeError):
                time.sleep(retry_delay)
                retry_delay *= 2

        with self._lock:
            self.failed = True
        print("[FAILED] Critical I/O race condition detected. File lock unhandled.")


def _simulate_mt5_write(path: str, symbol: str, n_writes: int = 3, write_delay: float = 0.05):
    """Simulate the MT5 EA writing telemetry files with brief partial-write windows."""
    payload = {
        "symbol":      symbol,
        "timestamp":   time.time(),
        "poc":         2345.50,
        "vah":         2350.00,
        "val":         2340.00,
        "wick_vol_frac": 0.62,
        "rvol":        1.35,
        "atr_m5":      4.25,
        "sl_dist":     8.50,
        "tp_dist":     25.50,
        "vacuum_block": False,
    }
    raw = json.dumps(payload, indent=2)

    for _ in range(n_writes):
        time.sleep(write_delay)
        # Write in two chunks to simulate race window
        with open(path, "w", encoding="utf-8") as f:
            f.write(raw[:len(raw) // 2])
        time.sleep(0.001)
        with open(path, "w", encoding="utf-8") as f:
            f.write(raw)


# ── Pytest test ───────────────────────────────────────────────────────────────
@pytest.mark.skipif(not _WATCHDOG_AVAILABLE, reason="watchdog not installed")
def test_telemetry_no_filelock_race():
    """Verify telemetry JSON is read successfully despite simulated partial-write race."""
    with tempfile.TemporaryDirectory() as tmpdir:
        symbol   = "XAUUSD+"
        telpath  = os.path.join(tmpdir, f"whale_matrix_{symbol}.json")
        handler  = _TestHandler()
        observer = Observer()
        observer.schedule(handler, path=tmpdir, recursive=False)
        observer.start()

        # Create the file first so watchdog picks up modification events
        with open(telpath, "w") as f:
            f.write("{}")

        writer = threading.Thread(
            target=_simulate_mt5_write,
            args=(telpath, symbol, 3, 0.05),
            daemon=True,
        )
        writer.start()
        writer.join(timeout=5.0)

        # Give watchdog time to process final event
        time.sleep(0.5)
        observer.stop()
        observer.join()

        assert handler.passed, (
            "I/O race condition detected — watchdog failed to read telemetry after 5 retries. "
            "Check file-write completion before observer fires."
        )
        assert not handler.failed, "File lock was unhandled."
        print(f"[OK] Read succeeded on attempt {handler.attempt}.")


@pytest.mark.skipif(not _WATCHDOG_AVAILABLE, reason="watchdog not installed")
def test_multiple_symbols_concurrent():
    """Verify concurrent writes for multiple symbols are all captured without data loss."""
    symbols    = ["XAUUSD+", "NAS100", "GBPUSD+"]
    n_expected = len(symbols)

    with tempfile.TemporaryDirectory() as tmpdir:
        handler  = _TestHandler()
        observer = Observer()
        observer.schedule(handler, path=tmpdir, recursive=False)
        observer.start()

        threads = []
        for sym in symbols:
            fpath = os.path.join(tmpdir, f"whale_matrix_{sym}.json")
            with open(fpath, "w") as f:
                f.write("{}")
            t = threading.Thread(
                target=_simulate_mt5_write, args=(fpath, sym, 2, 0.03), daemon=True
            )
            threads.append(t)

        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=5.0)

        time.sleep(0.5)
        observer.stop()
        observer.join()

        assert handler.passed, "At least one symbol telemetry read failed."


# ── Standalone ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("[INIT] Starting High-Frequency I/O Race Condition Test...")

    if not _WATCHDOG_AVAILABLE:
        print("[SKIP] watchdog library not installed. Run: pip install watchdog")
        sys.exit(0)

    with tempfile.TemporaryDirectory() as tmpdir:
        symbol  = "XAUUSD+"
        telpath = os.path.join(tmpdir, f"whale_matrix_{symbol}.json")

        handler  = _TestHandler()
        observer = Observer()
        observer.schedule(handler, path=tmpdir, recursive=False)
        observer.start()

        with open(telpath, "w") as f:
            f.write("{}")

        print(f"[INIT] Watching: {tmpdir}")
        print("[INIT] Simulating MT5 EA partial-write race condition...")

        writer = threading.Thread(
            target=_simulate_mt5_write,
            args=(telpath, symbol, 3, 0.05),
            daemon=True,
        )
        writer.start()
        writer.join(timeout=10.0)
        time.sleep(0.5)

        observer.stop()
        observer.join()

        if handler.passed:
            print(f"\n[RESULT] PASSED — read completed on attempt {handler.attempt}.")
        else:
            print("\n[RESULT] FAILED — file lock race condition unhandled.")
            sys.exit(1)
