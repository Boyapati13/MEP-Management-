"""
TimesFM 2.5 Forecaster Action — OCTO Integration
=================================================
Wires the real TimesFM engine into the OCTO voice assistant.
Called by main.py when user says "forecast gold", "what does AI say about EURUSD", etc.

Falls back to reading cached signal files if the model is not loaded
so OCTO can always answer instantly without model inference delay.
"""

import os
import json
from pathlib import Path
from datetime import datetime, timezone

# ── Signal file paths ──────────────────────────────────────────────────────────
_SCRIPT_DIR = Path(__file__).resolve().parent.parent / "scripts"
_MT5_COMMON = Path(os.environ.get("APPDATA", "")) / \
    "MetaQuotes" / "Terminal" / "Common" / "Files"


def _get_signal_base() -> Path:
    return _MT5_COMMON if _MT5_COMMON.exists() else _SCRIPT_DIR


def _read_cached_signal(symbol: str) -> dict | None:
    """Read the latest TimesFM signal for a symbol from the signal files."""
    base = _get_signal_base()

    # Try portfolio file first
    portfolio_file = base / "timesfm_portfolio_signals.json"
    if portfolio_file.exists():
        try:
            data = json.loads(portfolio_file.read_text(encoding="utf-8"))
            if isinstance(data, dict) and symbol.upper() in data:
                return data[symbol.upper()]
            if isinstance(data, list):
                match = next((s for s in data
                              if s.get("symbol", "").upper() == symbol.upper()), None)
                if match:
                    return match
        except Exception:
            pass

    # Try per-symbol file
    safe = symbol.replace("+", "plus").replace("/", "_")
    sym_file = base / f"timesfm_{safe}.json"
    if sym_file.exists():
        try:
            return json.loads(sym_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    # Try the single signal file (last-written symbol)
    single_file = base / "timesfm_signal.json"
    if single_file.exists():
        try:
            d = json.loads(single_file.read_text(encoding="utf-8"))
            if d.get("symbol", "").upper() == symbol.upper():
                return d
        except Exception:
            pass

    return None


def _format_signal(sig: dict, symbol: str) -> str:
    """Format a signal dict into a spoken/readable response."""
    bias       = sig.get("bias", "NEUTRAL")
    conf       = float(sig.get("confidence", 0.0)) * 100
    pct        = float(sig.get("pct_change", 0.0))
    tf         = sig.get("timeframe", "H1")
    horizon    = sig.get("horizon", 8)
    last_p     = sig.get("last_close", 0.0)
    end_p      = sig.get("expected_end_price", 0.0)
    gen_at     = sig.get("generated_at", "")[:16].replace("T", " ")

    direction_word = (
        "bullish" if bias == "BULL" else
        "bearish" if bias == "BEAR" else "neutral"
    )

    age_note = ""
    if gen_at:
        try:
            ts = datetime.strptime(gen_at, "%Y-%m-%d %H:%M")
            ts = ts.replace(tzinfo=timezone.utc)
            age_s = (datetime.now(timezone.utc) - ts).total_seconds()
            age_min = int(age_s / 60)
            age_note = f" (forecast from {age_min} minutes ago)"
        except Exception:
            pass

    return (
        f"TimesFM forecast for {symbol} on the {tf} timeframe{age_note}: "
        f"the model is *{direction_word}* with {conf:.0f}% confidence. "
        f"Over the next {horizon} bars it expects price to move from "
        f"{last_p:.5f} to approximately {end_p:.5f}, "
        f"a change of {pct:+.3f}%."
    )


def timesfm_action(
    parameters: dict,
    player=None,
    session_memory=None,
) -> str:
    """
    OCTO TimesFM action.

    Parameters:
      symbol    : str  — trading symbol (e.g. EURUSD+, XAUUSD+, NAS100)
      mode      : str  — "cached" (default) | "fresh" (triggers new inference)
      horizon   : int  — forecast horizon bars (default 8)
      portfolio : bool — if True, return summary for all watchlist symbols
    """
    symbol    = parameters.get("symbol", "").strip()
    mode      = parameters.get("mode", "cached").lower()
    horizon   = int(parameters.get("horizon", 8))
    portfolio = bool(parameters.get("portfolio", False))

    # ── Portfolio mode: show all symbols ──────────────────────────────────────
    if portfolio or not symbol:
        watchlist_path = Path(__file__).resolve().parent.parent / "config" / "watchlist.json"
        try:
            watchlist = json.loads(watchlist_path.read_text(encoding="utf-8"))
        except Exception:
            watchlist = ["EURUSD+", "GBPUSD+", "XAUUSD+", "NAS100"]

        lines = []
        for sym in watchlist:
            sig = _read_cached_signal(sym)
            if sig:
                bias = sig.get("bias", "NEUTRAL")
                conf = float(sig.get("confidence", 0.0)) * 100
                pct  = float(sig.get("pct_change", 0.0))
                arrow = "▲" if bias == "BULL" else ("▼" if bias == "BEAR" else "➡")
                lines.append(f"{arrow} {sym}: {bias} {conf:.0f}% | {pct:+.3f}%")
            else:
                lines.append(f"  {sym}: No forecast available")

        result = "Portfolio AI Forecast:\n" + "\n".join(lines)
        _log(result, player)
        return result

    # ── Single symbol ─────────────────────────────────────────────────────────
    if not symbol:
        msg = "Sir, please tell me which symbol to forecast (e.g. EURUSD, gold, NAS100)."
        _log(msg, player)
        return msg

    # Map common names
    symbol_map = {
        "gold": "XAUUSD+", "xauusd": "XAUUSD+", "eurusd": "EURUSD+",
        "gbpusd": "GBPUSD+", "nas100": "NAS100", "nasdaq": "NAS100",
        "btc": "BTCUSD", "bitcoin": "BTCUSD", "oil": "CL-OIL",
    }
    symbol = symbol_map.get(symbol.lower(), symbol)

    # ── Fresh mode: run inference now ─────────────────────────────────────────
    if mode == "fresh":
        try:
            _log(f"Running fresh TimesFM inference for {symbol}...", player)
            # Import here to avoid loading model at module import time
            import sys
            scripts_path = str(Path(__file__).resolve().parent.parent / "scripts")
            if scripts_path not in sys.path:
                sys.path.insert(0, scripts_path)
            from timesfm_forecaster import TimesFMForecaster
            tfm = TimesFMForecaster()
            result_sig = tfm.get_forecast(
                symbol=symbol, timeframe="H1", horizon=horizon,
                context_bars=256, write_signal=True
            )
            if result_sig:
                msg = _format_signal(result_sig, symbol)
                _log(msg, player)
                return msg
        except Exception as e:
            _log(f"Fresh inference failed: {e} — falling back to cached signal.", player)

    # ── Cached mode (default) ─────────────────────────────────────────────────
    sig = _read_cached_signal(symbol)
    if sig is None:
        msg = (f"Sir, I don't have a TimesFM forecast for {symbol} yet. "
               f"Run the forecaster first: "
               f"py timesfm_forecaster.py --symbol {symbol} --timeframe H1 --horizon 8")
        _log(msg, player)
        return msg

    if sig.get("error"):
        msg = f"The forecast for {symbol} returned an error: {sig['error']}"
        _log(msg, player)
        return msg

    msg = _format_signal(sig, symbol)
    _log(msg, player)
    return msg


def _log(message: str, player=None) -> None:
    print(f"[TimesFM] {message}")
    if player:
        try:
            player.write_log(f"OCTO: {message}")
        except Exception:
            pass
