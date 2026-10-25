#!/usr/bin/env python3
"""
timesfm_forecaster.py
=====================
TimesFM 2.5 price-direction forecaster for the Whale / Octo trading stack.

HOW IT WORKS
------------
1. Pulls OHLCV bars from the live MT5 terminal (or from a CSV fallback).
2. Feeds the close-price series into TimesFM 2.5 (zero-shot, no training).
3. Returns a ForecastResult: direction bias, confidence, point forecast array,
   and 80 % prediction-interval bands.
4. Writes a lightweight JSON signal file so the MQL5 EA can also read the bias
   without running Python inside the EA (file-based IPC).

INTEGRATION MODES
-----------------
A) As a Python module  → import and call get_forecast(symbol, ...)
B) As a standalone CLI → py timesfm_forecaster.py --symbol EURUSD+ --horizon 12
C) As a scheduled gate → run every N minutes, write signal file, live bot reads it

USAGE INSIDE run_live_bot.py
-----------------------------
    from timesfm_forecaster import TimesFMForecaster, ForecastBias

    forecaster = TimesFMForecaster()           # loads model once
    result = forecaster.get_forecast("EURUSD+", horizon=12, context_bars=256)

    if result.bias == ForecastBias.BULL and result.confidence > 0.60:
        # allow buy
    elif result.bias == ForecastBias.BEAR and result.confidence > 0.60:
        # allow sell
    else:
        # skip — model is uncertain
"""

import sys
import os
import json
import time
import argparse
import math
from dataclasses import dataclass, field, asdict
from enum import Enum
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

# ── UTF-8 safe output (Windows cp1252 fix) ────────────────────────────────────
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# ── Optional imports (graceful degradation) ───────────────────────────────────
try:
    import numpy as np
    _NUMPY_OK = True
except ImportError:
    _NUMPY_OK = False
    print("[TimesFM] WARNING: numpy not found. Install: pip install numpy")

try:
    import timesfm
    _TIMESFM_OK = True
except ImportError:
    _TIMESFM_OK = False
    print("[TimesFM] WARNING: timesfm not installed. Run: pip install timesfm[torch]")

try:
    import torch
    _TORCH_OK = True
except ImportError:
    _TORCH_OK = False

try:
    import MetaTrader5 as mt5
    _MT5_OK = True
except ImportError:
    _MT5_OK = False
    print("[TimesFM] INFO: MetaTrader5 not available — CSV fallback mode only.")

# ── Constants ─────────────────────────────────────────────────────────────────
# Quantile index mapping (TimesFM 2.5 output):
#   index 0 = mean, 1 = q10, 2 = q20, ..., 5 = q50 (median), ..., 9 = q90
IDX_MEAN = 0
IDX_Q10  = 1   # lower bound of 80 % PI
IDX_Q90  = 9   # upper bound of 80 % PI
IDX_MED  = 5   # median (should match point_forecast)

# Signal file — write to MT5 Common Files so the EA can read it with FILE_COMMON flag
_SCRIPT_DIR = Path(__file__).resolve().parent

_MT5_COMMON_FILES = Path(os.environ.get("APPDATA", "")) / \
    "MetaQuotes" / "Terminal" / "Common" / "Files"

# Use MT5 Common Files if it exists, else fall back to script directory
SIGNAL_FILE = (_MT5_COMMON_FILES / "timesfm_signal.json"
               if _MT5_COMMON_FILES.exists()
               else _SCRIPT_DIR / "timesfm_signal.json")

# ── Data classes ──────────────────────────────────────────────────────────────
class ForecastBias(str, Enum):
    BULL    = "BULL"
    BEAR    = "BEAR"
    NEUTRAL = "NEUTRAL"

@dataclass
class ForecastResult:
    symbol:          str
    timeframe:       str
    horizon:         int
    bias:            ForecastBias
    confidence:      float          # 0.0 – 1.0  (how lopsided the PI bands are)
    point_forecast:  list           # shape [horizon]  — median price
    lower_80:        list           # shape [horizon]  — q10 price
    upper_80:        list           # shape [horizon]  — q90 price
    last_close:      float
    expected_end:    float          # point_forecast[-1]
    pct_change:      float          # expected end vs last_close (%)
    generated_at:    str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    error:           Optional[str]  = None

    def to_dict(self) -> dict:
        d = asdict(self)
        d["bias"] = self.bias.value
        return d


# ── Core forecaster class ─────────────────────────────────────────────────────
class TimesFMForecaster:
    """
    Singleton-style wrapper around TimesFM 2.5.
    Load the model once, call get_forecast() many times.
    """

    _instance = None  # module-level singleton

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(
        self,
        max_context: int = 512,
        max_horizon: int = 60,
        per_core_batch_size: int = 8,
    ):
        if self._initialized:
            return  # already loaded

        self.max_context         = max_context
        self.max_horizon         = max_horizon
        self.per_core_batch_size = per_core_batch_size
        self.model               = None
        self._mt5_connected      = False
        self._initialized        = True

        if not _NUMPY_OK:
            raise RuntimeError("numpy is required. pip install numpy")
        if not _TIMESFM_OK:
            raise RuntimeError("timesfm is required. pip install timesfm[torch]")

        self._load_model()

    # ── Model loading ─────────────────────────────────────────────────────────
    def _load_model(self):
        print("[TimesFM] Loading TimesFM 2.5 (200M) — first call downloads ~800 MB…")
        t0 = time.time()

        if _TORCH_OK:
            torch.set_float32_matmul_precision("high")

        cfg = timesfm.ForecastConfig(
            max_context                 = self.max_context,
            max_horizon                 = self.max_horizon,
            normalize_inputs            = True,   # ALWAYS True for price data
            per_core_batch_size         = self.per_core_batch_size,
            use_continuous_quantile_head= True,   # better calibrated PIs
            force_flip_invariance       = True,
            infer_is_positive           = True,   # prices are always > 0
            fix_quantile_crossing       = True,   # monotone quantiles
        )

        self.model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(
            "google/timesfm-2.5-200m-pytorch"
        )
        self.model.compile(cfg)

        elapsed = time.time() - t0
        print(f"[TimesFM] Model ready in {elapsed:.1f}s")

    # ── MT5 data fetching ─────────────────────────────────────────────────────
    def _ensure_mt5(self) -> bool:
        if not _MT5_OK:
            return False
        if not self._mt5_connected:
            if mt5.initialize():
                self._mt5_connected = True
                print("[TimesFM] Connected to MT5 terminal.")
            else:
                # Fallback to explicit executable path launch
                import os
                exe_path = r"C:\Program Files\MetaTrader 5\terminal64.exe"
                if os.path.exists(exe_path) and mt5.initialize(path=exe_path):
                    self._mt5_connected = True
                    print("[TimesFM] Connected to MT5 terminal via self-healing path.")
                else:
                    print(f"[TimesFM] MT5 connect failed: {mt5.last_error()}")
        return self._mt5_connected

    def _fetch_mt5_closes(
        self, symbol: str, timeframe_str: str, n_bars: int
    ) -> Optional[np.ndarray]:
        """Pull close prices from live MT5 terminal."""
        TF_MAP = {
            "M1":  mt5.TIMEFRAME_M1,
            "M5":  mt5.TIMEFRAME_M5,
            "M15": mt5.TIMEFRAME_M15,
            "H1":  mt5.TIMEFRAME_H1,
            "H4":  mt5.TIMEFRAME_H4,
            "D1":  mt5.TIMEFRAME_D1,
        }
        tf = TF_MAP.get(timeframe_str.upper())
        if tf is None:
            print(f"[TimesFM] Unknown timeframe: {timeframe_str}")
            return None

        mt5.symbol_select(symbol, True)
        rates = mt5.copy_rates_from_pos(symbol, tf, 0, n_bars)
        if rates is None or len(rates) < 32:
            print(f"[TimesFM] Not enough bars for {symbol}: got {0 if rates is None else len(rates)}")
            return None

        closes = np.array([float(r["close"]) for r in rates], dtype=np.float32)
        print(f"[TimesFM] Fetched {len(closes)} {timeframe_str} bars for {symbol}")
        return closes

    def _fetch_csv_closes(self, csv_path: str) -> Optional[np.ndarray]:
        """Fallback: load closes from a CSV with a 'close' column."""
        import csv
        closes = []
        try:
            with open(csv_path, newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                # Try common column names
                close_col = None
                for name in ["close", "Close", "CLOSE", "price", "Price"]:
                    if name in reader.fieldnames:
                        close_col = name
                        break
                if close_col is None:
                    print(f"[TimesFM] CSV has no 'close' column. Columns: {reader.fieldnames}")
                    return None
                for row in reader:
                    try:
                        closes.append(float(row[close_col]))
                    except ValueError:
                        pass
        except FileNotFoundError:
            print(f"[TimesFM] CSV not found: {csv_path}")
            return None

        if len(closes) < 32:
            print(f"[TimesFM] CSV too short: {len(closes)} rows (need ≥ 32)")
            return None

        arr = np.array(closes, dtype=np.float32)
        print(f"[TimesFM] Loaded {len(arr)} rows from CSV: {csv_path}")
        return arr

    # ── Direction bias calculation ────────────────────────────────────────────
    @staticmethod
    def _calc_bias(
        last_close: float,
        point_fc:   np.ndarray,   # shape [horizon]
        lower_80:   np.ndarray,   # q10 band
        upper_80:   np.ndarray,   # q90 band
    ) -> tuple[ForecastBias, float]:
        """
        Bias = direction of point_fc end vs last_close.
        Confidence = how far the PI bands are skewed toward that direction.

        A fully symmetric PI → confidence 0.50 (neutral).
        PI bands skewed up   → confidence approaches 1.0 (bull).
        PI bands skewed down → confidence approaches 1.0 (bear).
        """
        end_price  = float(point_fc[-1])
        pct_change = (end_price - last_close) / last_close

        # PI midpoint and skew at the last forecast step
        lo = float(lower_80[-1])
        hi = float(upper_80[-1])
        mid = (lo + hi) / 2.0
        width = max(hi - lo, 1e-10)

        # How far is the PI midpoint above/below last_close, as fraction of width
        # Positive → bullish skew, negative → bearish skew
        skew = (mid - last_close) / width  # typically –0.5 … +0.5

        if abs(pct_change) < 0.0005:         # less than 0.05 % move → neutral (was 0.001)
            bias = ForecastBias.NEUTRAL
            conf = 0.50
        elif pct_change > 0:
            bias = ForecastBias.BULL
            conf = min(0.95, 0.50 + max(0.0, skew))
        else:
            bias = ForecastBias.BEAR
            conf = min(0.95, 0.50 + max(0.0, -skew))

        return bias, conf

    # ── Main forecast entrypoint ──────────────────────────────────────────────
    def get_forecast(
        self,
        symbol:        str,
        horizon:       int  = 12,
        context_bars:  int  = 256,
        timeframe:     str  = "M5",
        csv_path:      Optional[str] = None,
        write_signal:  bool = True,
    ) -> ForecastResult:
        """
        Forecast the next `horizon` bars of `symbol` on `timeframe`.

        Parameters
        ----------
        symbol       : MT5 symbol name, e.g. "EURUSD+", "XAUUSD+"
        horizon      : number of future bars to predict  (≤ max_horizon)
        context_bars : how many historical bars to use as context (≤ max_context)
        timeframe    : bar size — "M1","M5","M15","H1","H4","D1"
        csv_path     : if set, load closes from this CSV instead of MT5
        write_signal : if True, write JSON signal file to SIGNAL_FILE path

        Returns
        -------
        ForecastResult dataclass
        """
        # ── 1. Fetch closes ───────────────────────────────────────────────────
        closes: Optional[np.ndarray] = None

        if csv_path:
            closes = self._fetch_csv_closes(csv_path)
        elif self._ensure_mt5():
            closes = self._fetch_mt5_closes(symbol, timeframe, context_bars + 50)

        if closes is None:
            err = f"Could not fetch data for {symbol} ({timeframe})"
            result = ForecastResult(
                symbol=symbol, timeframe=timeframe, horizon=horizon,
                bias=ForecastBias.NEUTRAL, confidence=0.0,
                point_forecast=[], lower_80=[], upper_80=[],
                last_close=0.0, expected_end=0.0, pct_change=0.0,
                error=err,
            )
            if write_signal:
                self._write_signal(result)
            return result

        # Trim to context window — exclude the live (potentially incomplete) bar
        # Use closes[1:] to skip index-0 which is the live bar in MT5 series mode
        context = closes[1 : context_bars + 1]  # confirmed closed bars
        if len(context) < 32:
            err = f"Context too short: {len(context)} bars (need ≥ 32)"
            result = ForecastResult(
                symbol=symbol, timeframe=timeframe, horizon=horizon,
                bias=ForecastBias.NEUTRAL, confidence=0.0,
                point_forecast=[], lower_80=[], upper_80=[],
                last_close=float(context[-1]) if len(context) > 0 else 0.0,
                expected_end=0.0, pct_change=0.0, error=err,
            )
            if write_signal:
                self._write_signal(result)
            return result

        last_close = float(context[-1])
        eff_horizon = min(horizon, self.max_horizon)

        # ── 2. Run TimesFM inference ──────────────────────────────────────────
        print(f"[TimesFM] Forecasting {symbol} {timeframe} | context={len(context)} bars | horizon={eff_horizon}")
        t0 = time.time()

        point_fc, quant_fc = self.model.forecast(
            horizon = eff_horizon,
            inputs  = [context],
        )
        # point_fc  shape: (1, horizon)
        # quant_fc  shape: (1, horizon, 10)

        elapsed = time.time() - t0
        print(f"[TimesFM] Inference done in {elapsed:.2f}s")

        pf   = point_fc[0]               # shape [horizon]
        lo80 = quant_fc[0, :, IDX_Q10]   # q10 band
        hi80 = quant_fc[0, :, IDX_Q90]   # q90 band

        # Sanity check
        if np.isnan(pf).any():
            err = "TimesFM returned NaN — check input series for gaps"
            result = ForecastResult(
                symbol=symbol, timeframe=timeframe, horizon=eff_horizon,
                bias=ForecastBias.NEUTRAL, confidence=0.0,
                point_forecast=[], lower_80=[], upper_80=[],
                last_close=last_close, expected_end=0.0, pct_change=0.0,
                error=err,
            )
            if write_signal:
                self._write_signal(result)
            return result

        # ── 3. Direction bias ─────────────────────────────────────────────────
        bias, confidence = self._calc_bias(last_close, pf, lo80, hi80)

        end_price  = float(pf[-1])
        pct_change = (end_price - last_close) / last_close * 100.0

        result = ForecastResult(
            symbol        = symbol,
            timeframe     = timeframe,
            horizon       = eff_horizon,
            bias          = bias,
            confidence    = round(confidence, 4),
            point_forecast= [round(float(v), 6) for v in pf],
            lower_80      = [round(float(v), 6) for v in lo80],
            upper_80      = [round(float(v), 6) for v in hi80],
            last_close    = round(last_close, 6),
            expected_end  = round(end_price, 6),
            pct_change    = round(pct_change, 4),
        )

        print(
            f"[TimesFM] {symbol} {timeframe} | Bias={bias.value} "
            f"Conf={confidence:.2%} | {last_close:.5f} → {end_price:.5f} "
            f"({pct_change:+.3f}%)"
        )

        if write_signal:
            self._write_signal(result)

        return result

    # ── Signal file (JSON IPC for MQL5 EA) ───────────────────────────────────
    @staticmethod
    def _write_signal(result: ForecastResult, path: Path = SIGNAL_FILE):
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(result.to_dict(), f, indent=2)
            print(f"[TimesFM] Signal written → {path}")
        except Exception as e:
            print(f"[TimesFM] Failed to write signal file: {e}")

    @staticmethod
    def _write_per_symbol_signal(result: ForecastResult):
        """Writes a per-symbol signal file (timesfm_{symbol}.json) so that
        TradingRiskManager._read_signal() can find the correct forecast for each
        symbol independently. Fixes the bug where all symbols overwrote the same file.
        """
        base = (_MT5_COMMON_FILES if _MT5_COMMON_FILES.exists() else _SCRIPT_DIR)
        safe_sym = result.symbol.replace("+", "plus").replace("/", "_")
        per_sym_path = base / f"timesfm_{safe_sym}.json"
        try:
            with open(per_sym_path, "w", encoding="utf-8") as f:
                json.dump(result.to_dict(), f, indent=2)
            print(f"[TimesFM] Per-symbol signal → {per_sym_path.name}")
        except Exception as e:
            print(f"[TimesFM] Failed to write per-symbol signal for {result.symbol}: {e}")

    # ── Batch forecast for the full portfolio ─────────────────────────────────
    def forecast_portfolio(
        self,
        symbols:       list,
        horizon:       int = 12,
        context_bars:  int = 256,
        timeframe:     str = "M5",
        conf_threshold: float = 0.60,
    ) -> dict:
        """
        Forecast all symbols. Returns dict keyed by symbol.

        Example output
        --------------
        {
          "EURUSD+": ForecastResult(bias=BULL, confidence=0.73, ...),
          "XAUUSD+": ForecastResult(bias=BEAR, confidence=0.66, ...),
        }
        """
        results = {}
        for sym in symbols:
            try:
                res = self.get_forecast(
                    symbol       = sym,
                    horizon      = horizon,
                    context_bars = context_bars,
                    timeframe    = timeframe,
                    write_signal = False,   # don't overwrite with partial results
                )
                results[sym] = res
            except Exception as e:
                print(f"[TimesFM] Error forecasting {sym}: {e}")

        # Write combined signal file
        combined = {sym: res.to_dict() for sym, res in results.items()}
        try:
            combined_path = SIGNAL_FILE.parent / "timesfm_portfolio_signals.json"
            with open(combined_path, "w", encoding="utf-8") as f:
                json.dump(combined, f, indent=2)
            print(f"[TimesFM] Portfolio signals written → {combined_path}")
        except Exception as e:
            print(f"[TimesFM] Failed to write portfolio signal: {e}")

        return results


# ── Convenience gate function (drop-in for run_live_bot.py) ───────────────────
_shared_forecaster: Optional[TimesFMForecaster] = None


def get_timesfm_gate(
    symbol:         str,
    timeframe:      str   = "M5",
    horizon:        int   = 12,
    context_bars:   int   = 256,
    conf_threshold: float = 0.60,
) -> dict:
    """
    One-liner gate check. Returns dict with keys:
        allow_buy  (bool)
        allow_sell (bool)
        bias       (str)
        confidence (float)
        pct_change (float)

    Usage in run_live_bot.py:
        gate = get_timesfm_gate("EURUSD+", "H1", horizon=8)
        if buy_sig and gate["allow_buy"]:
            self.execute_live_order(...)
    """
    global _shared_forecaster
    if _shared_forecaster is None:
        _shared_forecaster = TimesFMForecaster()

    try:
        result = _shared_forecaster.get_forecast(
            symbol       = symbol,
            horizon      = horizon,
            context_bars = context_bars,
            timeframe    = timeframe,
        )
    except Exception as e:
        print(f"[TimesFM] Gate error for {symbol}: {e}")
        return {"allow_buy": True, "allow_sell": True,
                "bias": "NEUTRAL", "confidence": 0.0, "pct_change": 0.0}

    confident_bull = (result.bias == ForecastBias.BULL and result.confidence >= conf_threshold)
    confident_bear = (result.bias == ForecastBias.BEAR and result.confidence >= conf_threshold)
    neutral        = result.bias == ForecastBias.NEUTRAL or result.confidence < conf_threshold

    return {
        "allow_buy":  confident_bull or neutral,
        "allow_sell": confident_bear or neutral,
        "bias":       result.bias.value,
        "confidence": result.confidence,
        "pct_change": result.pct_change,
        "error":      result.error,
    }


# ── CLI entrypoint ────────────────────────────────────────────────────────────
def _cli():
    parser = argparse.ArgumentParser(
        description="TimesFM price-direction forecaster for MT5"
    )
    parser.add_argument("--symbol",      default="EURUSD+",  help="MT5 symbol")
    parser.add_argument("--timeframe",   default="M5",       help="M1/M5/M15/H1/H4/D1")
    parser.add_argument("--horizon",     type=int, default=12, help="Bars to forecast")
    parser.add_argument("--context",     type=int, default=256, help="Context bars")
    parser.add_argument("--csv",         default=None,       help="CSV path (no MT5 needed)")
    parser.add_argument("--threshold",   type=float, default=0.60, help="Min confidence to flag bias")
    parser.add_argument("--loop",        type=int, default=0, help="Repeat every N seconds (0=once)")
    parser.add_argument("--portfolio",   nargs="*", default=None,
                        help="Forecast multiple symbols: --portfolio EURUSD+ XAUUSD+")
    args = parser.parse_args()

    forecaster = TimesFMForecaster()

    def run_once():
        if args.portfolio:
            results = forecaster.forecast_portfolio(
                symbols      = args.portfolio,
                horizon      = args.horizon,
                context_bars = args.context,
                timeframe    = args.timeframe,
                conf_threshold = args.threshold,
            )
            print("\n=== Portfolio Forecast Summary ===")
            for sym, res in results.items():
                flag = ""
                if res.bias == ForecastBias.BULL and res.confidence >= args.threshold:
                    flag = " ← BUY BIAS"
                elif res.bias == ForecastBias.BEAR and res.confidence >= args.threshold:
                    flag = " ← SELL BIAS"
                print(f"  {sym:12s} {res.bias.value:7s} conf={res.confidence:.2%} "
                      f"move={res.pct_change:+.3f}%{flag}")
        else:
            result = forecaster.get_forecast(
                symbol       = args.symbol,
                horizon      = args.horizon,
                context_bars = args.context,
                timeframe    = args.timeframe,
                csv_path     = args.csv,
            )
            print("\n=== Forecast Result ===")
            print(f"  Symbol      : {result.symbol}")
            print(f"  Timeframe   : {result.timeframe}")
            print(f"  Horizon     : {result.horizon} bars")
            print(f"  Last close  : {result.last_close:.5f}")
            print(f"  Expected end: {result.expected_end:.5f}  ({result.pct_change:+.3f}%)")
            print(f"  Bias        : {result.bias.value}")
            print(f"  Confidence  : {result.confidence:.2%}")
            if result.error:
                print(f"  ERROR       : {result.error}")
            gate = "ALLOW BUY" if result.bias == ForecastBias.BULL and result.confidence >= args.threshold else \
                   "ALLOW SELL" if result.bias == ForecastBias.BEAR and result.confidence >= args.threshold else \
                   "NEUTRAL — trade both or skip"
            print(f"  Gate        : {gate}")

    if args.loop > 0:
        print(f"[TimesFM] Loop mode: running every {args.loop}s. Ctrl+C to stop.")
        while True:
            run_once()
            time.sleep(args.loop)
    else:
        run_once()


if __name__ == "__main__":
    _cli()
