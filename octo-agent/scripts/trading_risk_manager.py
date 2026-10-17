"""
TradingRiskManager — TimesFM G4 Gate for Octo HybridTradingBot
==============================================================
Reads the cached TimesFM signal and applies one of four configurable gate
modes before any trade is placed.  No model inference happens here — the
signal is written by timesfm_forecaster.py on a 5-minute loop.

GATE_MODE values (set in live_bot_config.json or env var GATE_MODE):
  "BLOCK"   — hard block if TFM is confident in the opposite direction
  "SOFT"    — allow trade but halve the lot size when TFM disagrees
  "WARN"    — send Telegram warning but place the full trade
  "OFF"     — disable TFM gate entirely (EA behaves as original)

Per-asset timeframe overrides are also configurable so you can test
H1 vs H4 on forex and H1 vs M15 on volume symbols.
"""

import json
import os
import numpy as np
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

# ── Config ────────────────────────────────────────────────────────────────────
_SCRIPT_DIR = Path(__file__).resolve().parent

# Signal files — written by timesfm_forecaster.py
_MT5_COMMON_FILES = Path(os.environ.get("APPDATA", "")) / \
    "MetaQuotes" / "Terminal" / "Common" / "Files"

# Gate modes: BLOCK | SOFT | WARN | OFF
GateMode = Literal["BLOCK", "SOFT", "WARN", "OFF"]

# Default per-asset timeframe to use for forecasting
DEFAULT_TF_MAP: dict[str, str] = {
    # Forex H1 engine symbols
    "EURUSD+": "H1",
    "GBPUSD+": "H1",
    # Volume / metal symbols
    "NAS100":  "H1",
    "XAUUSD+": "H1",
    "XAUEUR+": "H1",
    "BTCUSD":  "H1",
    "CL-OIL":  "H1",
}


class SymbolSpecialistAgent:
    """Base class for all Symbol-Specific Specialist Agents."""
    def __init__(self, symbol: str):
        self.symbol = symbol

    @staticmethod
    def calculate_ema(prices, period):
        prices = np.array(prices, dtype=float)
        n = len(prices)
        ema = np.zeros(n)
        if n == 0: return ema
        ema[0] = prices[0]
        alpha = 2.0 / (period + 1.0)
        for i in range(1, n):
            ema[i] = alpha * prices[i] + (1.0 - alpha) * ema[i-1]
        return ema

    @staticmethod
    def calculate_rsi(prices, period):
        prices = np.array(prices, dtype=float)
        n = len(prices)
        rsi = np.full(n, 50.0)
        if n <= period: return rsi
        deltas = np.diff(prices)
        seed = deltas[:period]
        up = seed[seed >= 0].sum() / period
        down = -seed[seed < 0].sum() / period
        if down == 0:
            rsi[period] = 100.0
        else:
            rs = up / down
            rsi[period] = 100.0 - 100.0 / (1.0 + rs)
        for i in range(period + 1, n):
            delta = deltas[i - 1]
            upval = delta if delta > 0 else 0.0
            downval = -delta if delta < 0 else 0.0
            up = (up * (period - 1) + upval) / period
            down = (down * (period - 1) + downval) / period
            if down == 0: rsi[i] = 100.0
            else: rsi[i] = 100.0 - 100.0 / (1.0 + up / down)
        return rsi

    @staticmethod
    def calculate_atr(highs, lows, closes, period):
        highs = np.array(highs, dtype=float)
        lows = np.array(lows, dtype=float)
        closes = np.array(closes, dtype=float)
        n = len(closes)
        tr = np.zeros(n)
        if n == 0: return tr
        tr[0] = highs[0] - lows[0]
        for i in range(1, n):
            tr[i] = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
        atr = np.zeros(n)
        atr[0] = tr[0]
        seed_len = min(period, n)
        atr[seed_len-1] = np.mean(tr[:seed_len])
        for i in range(seed_len, n):
            atr[i] = (atr[i-1] * (period - 1) + tr[i]) / period
        return atr

    @staticmethod
    def calculate_macd(prices, fast=12, slow=26, signal=9):
        prices = np.array(prices, dtype=float)
        ema_fast = SymbolSpecialistAgent.calculate_ema(prices, fast)
        ema_slow = SymbolSpecialistAgent.calculate_ema(prices, slow)
        macd_line = ema_fast - ema_slow
        signal_line = SymbolSpecialistAgent.calculate_ema(macd_line, signal)
        histogram = macd_line - signal_line
        return macd_line, signal_line, histogram

    @staticmethod
    def calculate_vwap(closes, volumes):
        closes = np.array(closes, dtype=float)
        volumes = np.array(volumes, dtype=float)
        n = len(closes)
        vwap = np.zeros(n)
        if n == 0 or len(volumes) < n:
            return vwap
        accum_pv = 0.0
        accum_vol = 0.0
        for i in range(n):
            accum_pv += closes[i] * volumes[i]
            accum_vol += volumes[i]
            vwap[i] = accum_pv / max(accum_vol, 1.0)
        return vwap

    @staticmethod
    def calculate_volume_profile(closes, volumes, bins_count=30):
        closes = np.array(closes, dtype=float)
        volumes = np.array(volumes, dtype=float)
        n = len(closes)
        if n == 0 or len(volumes) < n:
            return 0.0, 0.0, 0.0
        min_p = np.min(closes)
        max_p = np.max(closes)
        step = max(max_p - min_p, 1e-5) / bins_count
        
        bins = np.zeros(bins_count)
        for i in range(n):
            bn = int(np.floor((closes[i] - min_p) / step))
            bn = max(0, min(bins_count - 1, bn))
            bins[bn] += volumes[i]
            
        max_vol = -1.0
        poc_bin = 0
        for i in range(bins_count):
            if bins[i] > max_vol:
                max_vol = bins[i]
                poc_bin = i
        poc = min_p + step * poc_bin + step * 0.5
        total_vol = np.sum(bins)
        if max_vol <= 0.0 or total_vol <= 0.0:
            return poc, poc, poc
            
        target = total_vol * 0.70
        accumulated = bins[poc_bin]
        hi_idx = poc_bin
        lo_idx = poc_bin
        
        while accumulated < target:
            can_up = (hi_idx + 1 < bins_count)
            can_dn = (lo_idx - 1 >= 0)
            if not can_up and not can_dn:
                break
            up_vol = bins[hi_idx + 1] if can_up else 0.0
            dn_vol = bins[lo_idx - 1] if can_dn else 0.0
            if can_up and (not can_dn or up_vol >= dn_vol):
                hi_idx += 1
                accumulated += up_vol
            else:
                lo_idx -= 1
                accumulated += dn_vol
                
        vah = min_p + step * (hi_idx + 1)
        val = min_p + step * lo_idx
        return poc, vah, val

    def evaluate_strategy(self, direction: str, current_price: Optional[float], highs, lows, closes, open_price, asia_high, asia_low, volumes=None) -> dict:
        # Fallback to Dual Thrust breakout if open_price is available
        if open_price is not None and highs is not None and lows is not None and closes is not None and current_price is not None:
            sub_highs = np.array(highs[-5:])
            sub_lows = np.array(lows[-5:])
            sub_closes = np.array(closes[-5:])
            r1 = np.max(sub_highs) - np.min(sub_closes)
            r2 = np.max(sub_closes) - np.min(sub_lows)
            thrust_range = max(r1, r2)
            sig_up = open_price + 0.5 * thrust_range
            sig_lo = open_price - 0.5 * thrust_range
            bias = "NEUTRAL"
            if current_price > sig_up:
                bias = "BULLISH"
            elif current_price < sig_lo:
                bias = "BEARISH"
            return {"bias": bias, "reason": f"Dual Thrust Breakout check for {self.symbol} (up={sig_up:.5f}, lo={sig_lo:.5f})"}
            
        return {"bias": "NEUTRAL", "reason": "No active strategy triggers for default symbol."}


class EURUSDSpecialistAgent(SymbolSpecialistAgent):
    """Specialist Agent for EURUSD+ with complete knowledge of Bollinger Bands W-Bottom/M-Top patterns."""
    def __init__(self):
        super().__init__("EURUSD+")

    def evaluate_strategy(self, direction: str, current_price: Optional[float], highs, lows, closes, open_price, asia_high, asia_low, volumes=None) -> dict:
        if closes is not None and current_price is not None and len(closes) >= 40:
            closes_arr = np.array(closes)
            
            # --- Strategy A: Bollinger Bands Mean Reversion with VP Value Area Confluence ---
            window = 20
            ma = np.array([np.mean(closes_arr[max(0, i-window+1):i+1]) for i in range(len(closes_arr))])
            std = np.array([np.std(closes_arr[max(0, i-window+1):i+1]) for i in range(len(closes_arr))])
            upper = ma + 2.0 * std
            lower = ma - 2.0 * std
            rsi = self.calculate_rsi(closes_arr, 14)
            
            # Calculate Volume Profile if volumes are available
            poc, vah, val = 0.0, 0.0, 0.0
            if volumes is not None and len(volumes) >= len(closes):
                poc, vah, val = self.calculate_volume_profile(closes_arr, volumes, bins_count=30)
            
            # Confluence check: price pierces lower band, RSI is oversold, and price is <= VAL (if VP is valid)
            if current_price <= lower[-1] and rsi[-1] <= 32:
                if val == 0.0 or current_price <= val:
                    return {
                        "bias": "BULLISH",
                        "reason": f"EURUSD BB Mean Reversion oversold with VP VAL confluence (price={current_price:.5f}, BB_lower={lower[-1]:.5f}, RSI={rsi[-1]:.1f}, VAL={val:.5f})"
                    }
            elif current_price >= upper[-1] and rsi[-1] >= 68:
                if vah == 0.0 or current_price >= vah:
                    return {
                        "bias": "BEARISH",
                        "reason": f"EURUSD BB Mean Reversion overbought with VP VAH confluence (price={current_price:.5f}, BB_upper={upper[-1]:.5f}, RSI={rsi[-1]:.1f}, VAH={vah:.5f})"
                    }

            # --- Strategy B: EMA Golden/Death Crossover (Trend-Following) ---
            ema9 = self.calculate_ema(closes_arr, 9)
            ema21 = self.calculate_ema(closes_arr, 21)
            
            if len(ema9) >= 2:
                # Golden Cross
                if ema9[-2] <= ema21[-2] and ema9[-1] > ema21[-1]:
                    return {
                        "bias": "BULLISH",
                        "reason": f"EURUSD EMA Golden Cross (EMA9={ema9[-1]:.5f} crossed above EMA21={ema21[-1]:.5f})"
                    }
                # Death Cross
                elif ema9[-2] >= ema21[-2] and ema9[-1] < ema21[-1]:
                    return {
                        "bias": "BEARISH",
                        "reason": f"EURUSD EMA Death Cross (EMA9={ema9[-1]:.5f} crossed below EMA21={ema21[-1]:.5f})"
                    }

        # --- Strategy C: Dual Thrust Breakout (Momentum Fallback) ---
        return super().evaluate_strategy(direction, current_price, highs, lows, closes, open_price, asia_high, asia_low, volumes)


class XAUUSDSpecialistAgent(SymbolSpecialistAgent):
    """Specialist Agent for XAUUSD+ / XAUEUR+ with complete knowledge of Awesome Oscillator and Safe-Haven Volume Spike profiles."""
    def __init__(self, symbol: str = "XAUUSD+"):
        super().__init__(symbol)

    def evaluate_strategy(self, direction: str, current_price: Optional[float], highs, lows, closes, open_price, asia_high, asia_low, volumes=None) -> dict:
        if highs is not None and lows is not None and current_price is not None and len(highs) >= 35:
            highs_arr = np.array(highs)
            lows_arr = np.array(lows)
            median = (highs_arr + lows_arr) / 2.0
            
            # --- Strategy A: Awesome Oscillator Saucer Patterns (High Frequency) ---
            ao = []
            for i in range(33, len(median)):
                ma5 = np.mean(median[i-4:i+1])
                ma34 = np.mean(median[i-33:i+1])
                ao.append(ma5 - ma34)
            ao = np.array(ao)
            
            if len(ao) >= 3:
                # Bullish Saucer: AO > 0, ao[-2] < ao[-3], ao[-1] > ao[-2]
                if ao[-3] > 0 and ao[-2] > 0 and ao[-1] > 0:
                    if ao[-2] < ao[-3] and ao[-1] > ao[-2]:
                        return {
                            "bias": "BULLISH",
                            "reason": f"XAUUSD Awesome Oscillator Bullish Saucer (AO[-1]={ao[-1]:.4f}, AO[-2]={ao[-2]:.4f})"
                        }
                # Bearish Saucer: AO < 0, ao[-2] > ao[-3], ao[-1] < ao[-2]
                elif ao[-3] < 0 and ao[-2] < 0 and ao[-1] < 0:
                    if ao[-2] > ao[-3] and ao[-1] < ao[-2]:
                        return {
                            "bias": "BEARISH",
                            "reason": f"XAUUSD Awesome Oscillator Bearish Saucer (AO[-1]={ao[-1]:.4f}, AO[-2]={ao[-2]:.4f})"
                        }

            # --- Strategy B: MACD Histogram Momentum Crossover with Volume filter ---
            if closes is not None and len(closes) >= 35 and volumes is not None and len(volumes) >= 10:
                macd_line, signal_line, _ = self.calculate_macd(closes, 12, 26, 9)
                vol_avg = np.mean(volumes[-10:-1])
                
                if len(macd_line) >= 2:
                    # MACD Bullish crossover with volume confirmation
                    if macd_line[-2] <= signal_line[-2] and macd_line[-1] > signal_line[-1]:
                        if volumes[-1] >= vol_avg * 1.15:
                            return {
                                "bias": "BULLISH",
                                "reason": f"XAUUSD MACD Bullish Crossover (MACD={macd_line[-1]:.4f}, Sig={signal_line[-1]:.4f}, Vol_Ratio={volumes[-1]/vol_avg:.2f})"
                            }
                    # MACD Bearish crossover with volume confirmation
                    elif macd_line[-2] >= signal_line[-2] and macd_line[-1] < signal_line[-1]:
                        if volumes[-1] >= vol_avg * 1.15:
                            return {
                                "bias": "BEARISH",
                                "reason": f"XAUUSD MACD Bearish Crossover (MACD={macd_line[-1]:.4f}, Sig={signal_line[-1]:.4f}, Vol_Ratio={volumes[-1]/vol_avg:.2f})"
                            }

        # --- Strategy C: Wick Absorption & FVG Sweeps with Volume Profile Confluence ---
        if highs is not None and lows is not None and current_price is not None and len(highs) >= 5:
            # Calculate Volume Profile if volumes and closes are available
            poc, vah, val = 0.0, 0.0, 0.0
            if closes is not None and volumes is not None and len(volumes) >= len(closes):
                poc, vah, val = self.calculate_volume_profile(closes, volumes, bins_count=30)
            
            # Simple M15/H1 FVG Sweep checking
            if lows[-2] > highs[-4] and current_price <= lows[-2] and current_price >= highs[-4]:
                # Bullish FVG with Value Area Low confluence
                if val == 0.0 or current_price <= val:
                    return {
                        "bias": "BULLISH",
                        "reason": f"XAUUSD FVG Bullish Sweep with VP VAL confluence (retraced into gap: {highs[-4]:.2f}-{lows[-2]:.2f}, VAL={val:.2f})"
                    }
            elif highs[-2] < lows[-4] and current_price >= highs[-2] and current_price <= lows[-4]:
                # Bearish FVG with Value Area High confluence
                if vah == 0.0 or current_price >= vah:
                    return {
                        "bias": "BEARISH",
                        "reason": f"XAUUSD FVG Bearish Sweep with VP VAH confluence (retraced into gap: {lows[-4]:.2f}-{highs[-2]:.2f}, VAH={vah:.2f})"
                    }

        return super().evaluate_strategy(direction, current_price, highs, lows, closes, open_price, asia_high, asia_low, volumes)


class GBPUSDSpecialistAgent(SymbolSpecialistAgent):
    """Specialist Agent for GBPUSD+ with complete knowledge of London Session Range Breakouts and Dual Thrust dynamics."""
    def __init__(self):
        super().__init__("GBPUSD+")

    def evaluate_strategy(self, direction: str, current_price: Optional[float], highs, lows, closes, open_price, asia_high, asia_low, volumes=None) -> dict:
        # --- Strategy A: Volatility-Adaptive Keltner ATR Trend Rider with VP Breakout Confluence ---
        if closes is not None and highs is not None and lows is not None and current_price is not None and len(closes) >= 30:
            ema20 = self.calculate_ema(closes, 20)
            atr14 = self.calculate_atr(highs, lows, closes, 14)
            upper = ema20 + 1.5 * atr14
            lower = ema20 - 1.5 * atr14
            
            # Calculate Volume Profile if volumes are available
            poc, vah, val = 0.0, 0.0, 0.0
            if volumes is not None and len(volumes) >= len(closes):
                poc, vah, val = self.calculate_volume_profile(closes, volumes, bins_count=30)
            
            # Trend rider: close was inside upper/lower range, but current price broke outside upper/lower band with VAH/VAL breakout confirmation
            if closes[-2] < upper[-2] and current_price >= upper[-1]:
                if vah == 0.0 or current_price >= vah:
                    return {
                        "bias": "BULLISH",
                        "reason": f"GBPUSD Keltner ATR Upper Breakout with VP VAH confirmation (price={current_price:.5f}, Keltner_upper={upper[-1]:.5f}, VAH={vah:.5f})"
                    }
            elif closes[-2] > lower[-2] and current_price <= lower[-1]:
                if val == 0.0 or current_price <= val:
                    return {
                        "bias": "BEARISH",
                        "reason": f"GBPUSD Keltner ATR Lower Breakout with VP VAL confirmation (price={current_price:.5f}, Keltner_lower={lower[-1]:.5f}, VAL={val:.5f})"
                    }

        # --- Strategy B: London Session Range Breakout ---
        if current_price is not None and asia_high is not None and asia_low is not None:
            buffer = 50.0 * 0.00001
            sig_up = asia_high + buffer
            sig_lo = asia_low - buffer
            if current_price > sig_up:
                return {
                    "bias": "BULLISH",
                    "reason": f"GBPUSD London Session Range Breakout above {sig_up:.5f} (Asia_high={asia_high:.5f})"
                }
            elif current_price < sig_lo:
                return {
                    "bias": "BEARISH",
                    "reason": f"GBPUSD London Session Range Breakout below {sig_lo:.5f} (Asia_low={asia_low:.5f})"
                }

        # --- Strategy C: RSI Extreme Oversold/Overbought Rebound (Fallback) ---
        if closes is not None and len(closes) >= 20:
            rsi = self.calculate_rsi(closes, 14)
            if rsi[-1] <= 25:
                return {
                    "bias": "BULLISH",
                    "reason": f"GBPUSD RSI Extreme Oversold Rebound (RSI={rsi[-1]:.1f})"
                }
            elif rsi[-1] >= 75:
                return {
                    "bias": "BEARISH",
                    "reason": f"GBPUSD RSI Extreme Overbought Rebound (RSI={rsi[-1]:.1f})"
                }

        return super().evaluate_strategy(direction, current_price, highs, lows, closes, open_price, asia_high, asia_low, volumes)


class NAS100SpecialistAgent(SymbolSpecialistAgent):
    """Specialist Agent for NAS100 with complete knowledge of volume profiles and PDH/PDL sweeps."""
    def __init__(self):
        super().__init__("NAS100")

    def evaluate_strategy(self, direction: str, current_price: Optional[float], highs, lows, closes, open_price, asia_high, asia_low, volumes=None) -> dict:
        # --- Strategy A: Dynamic Session VWAP Sweeps with Volume Profile Confluence ---
        if closes is not None and volumes is not None and current_price is not None and len(closes) >= 30 and len(volumes) >= len(closes):
            closes_arr = np.array(closes)
            vols_arr = np.array(volumes)
            vwap = self.calculate_vwap(closes_arr, vols_arr)
            
            # Standard deviation of prices relative to VWAP
            vwap_std = np.std(closes_arr - vwap)
            upper_band = vwap[-1] + 1.5 * vwap_std
            lower_band = vwap[-1] - 1.5 * vwap_std
            
            # Calculate Volume Profile
            poc, vah, val = self.calculate_volume_profile(closes_arr, vols_arr, bins_count=30)
            
            if current_price <= lower_band and current_price <= val:
                return {
                    "bias": "BULLISH",
                    "reason": f"NAS100 VWAP Sweep Deviation Oversold with VP VAL confluence (price={current_price:.2f}, VWAP_lower={lower_band:.2f}, VAL={val:.2f})"
                }
            elif current_price >= upper_band and current_price >= vah:
                return {
                    "bias": "BEARISH",
                    "reason": f"NAS100 VWAP Sweep Deviation Overbought with VP VAH confluence (price={current_price:.2f}, VWAP_upper={upper_band:.2f}, VAH={vah:.2f})"
                }

        # --- Strategy B: Fair Value Gap (FVG) Proximity Sweeps ---
        if highs is not None and lows is not None and current_price is not None and len(highs) >= 5:
            # Bullish FVG
            if lows[-2] > highs[-4]:
                if current_price <= lows[-2] and current_price >= highs[-4]:
                    return {
                        "bias": "BULLISH",
                        "reason": f"NAS100 FVG Bullish Proximity Sweep (gap: {highs[-4]:.2f} - {lows[-2]:.2f})"
                    }
            # Bearish FVG
            elif highs[-2] < lows[-4]:
                if current_price >= highs[-2] and current_price <= lows[-4]:
                    return {
                        "bias": "BEARISH",
                        "reason": f"NAS100 FVG Bearish Proximity Sweep (gap: {lows[-4]:.2f} - {highs[-2]:.2f})"
                    }

        # --- Strategy C: Dual Thrust Breakout (Index Momentum) ---
        if open_price is not None and highs is not None and lows is not None and closes is not None and current_price is not None:
            sub_highs = np.array(highs[-5:])
            sub_lows = np.array(lows[-5:])
            sub_closes = np.array(closes[-5:])
            r1 = np.max(sub_highs) - np.min(sub_closes)
            r2 = np.max(sub_closes) - np.min(sub_lows)
            thrust_range = max(r1, r2)
            sig_up = open_price + 0.4 * thrust_range
            sig_lo = open_price - 0.6 * thrust_range
            if current_price > sig_up:
                return {"bias": "BULLISH", "reason": f"NAS100 Dual Thrust Index Breakout above {sig_up:.2f}"}
            elif current_price < sig_lo:
                return {"bias": "BEARISH", "reason": f"NAS100 Dual Thrust Index Breakout below {sig_lo:.2f}"}

        return {"bias": "NEUTRAL", "reason": "NAS100 price consolidating within dynamic value bands."}


class BTCUSDSpecialistAgent(SymbolSpecialistAgent):
    """Specialist Agent for BTCUSD and BTCUSD+ using M15 Pure Volume VSA and risk-on trend proxies (NAS100 tracking)."""
    def __init__(self, symbol: str = "BTCUSD"):
        super().__init__(symbol)

    def evaluate_strategy(self, direction: str, current_price: Optional[float], highs, lows, closes, open_price, asia_high, asia_low, volumes=None) -> dict:
        # --- Strategy A: M15 Pure Volume VSA (Volume Spread Analysis) ---
        if closes is not None and volumes is not None and current_price is not None and len(closes) >= 20 and len(volumes) >= len(closes):
            closes_arr = np.array(closes)
            vols_arr = np.array(volumes, dtype=float)
            highs_arr = np.array(highs)
            lows_arr = np.array(lows)
            
            # Average volume over the last 20 periods
            avg_volume = np.mean(vols_arr[-20:])
            # Spread (High - Low)
            spread = highs_arr[-1] - lows_arr[-1]
            avg_spread = np.mean(highs_arr[-20:] - lows_arr[-20:])
            
            # Check for high-volume absorption (e.g. Pin Bar / Wick Absorption)
            is_high_volume = vols_arr[-1] > 1.5 * avg_volume
            is_high_spread = spread > 1.2 * avg_spread
            
            # Position of the close relative to bar high/low
            bar_height = highs_arr[-1] - lows_arr[-1]
            close_pos = (closes_arr[-1] - lows_arr[-1]) / (bar_height if bar_height > 0 else 1.0)
            
            if is_high_volume:
                # Bullish wick absorption: price closed in upper 30% of high-volume bar
                if close_pos >= 0.7:
                    return {
                        "bias": "BULLISH",
                        "reason": f"BTCUSD VSA Bullish Volume Absorption (volume={vols_arr[-1]:.0f} > {avg_volume:.0f} avg, close_pos={close_pos:.2f})"
                    }
                # Bearish wick absorption: price closed in lower 30% of high-volume bar
                elif close_pos <= 0.3:
                    return {
                        "bias": "BEARISH",
                        "reason": f"BTCUSD VSA Bearish Volume Absorption (volume={vols_arr[-1]:.0f} > {avg_volume:.0f} avg, close_pos={close_pos:.2f})"
                    }

        # --- Strategy B: Risk-On Trend Proxy (9/21 EMA Crossover) ---
        if closes is not None and len(closes) >= 21:
            ema9 = self.calculate_ema(closes, 9)
            ema21 = self.calculate_ema(closes, 21)
            
            if ema9[-1] > ema21[-1]:
                return {
                    "bias": "BULLISH",
                    "reason": f"BTCUSD Risk-On Proxy Trend (EMA9={ema9[-1]:.2f} > EMA21={ema21[-1]:.2f})"
                }
            elif ema9[-1] < ema21[-1]:
                return {
                    "bias": "BEARISH",
                    "reason": f"BTCUSD Risk-Off Proxy Trend (EMA9={ema9[-1]:.2f} < EMA21={ema21[-1]:.2f})"
                }

        # --- Strategy C: Dual Thrust Breakout ---
        return super().evaluate_strategy(direction, current_price, highs, lows, closes, open_price, asia_high, asia_low, volumes)


class TradingRiskManager:
    """
    Evaluates a proposed trade against the TimesFM directional forecast,
    macroeconomic sentiment crawler output, and senior quantitative strategies
    (Dual Thrust Range Breakouts & London Breakouts) from open-source quant bases.

    Usage:
        rm = TradingRiskManager(gate_mode="SOFT", min_confidence=0.65)
        gate = rm.evaluate("EURUSD+", "BUY")
        if gate["allow"]:
            lot = base_lot * gate["lot_mult"]
            execute_order(..., lot)
    """

    def __init__(
        self,
        gate_mode: GateMode = "SOFT",
        min_confidence: float = 0.65,
        max_signal_age_seconds: int = 900,   # 15 min (extended from 600 to survive model inference)
        tf_map: Optional[dict] = None,
        dual_thrust_param: float = 0.5,      # default trigger multiplier
        dual_thrust_rg: int = 5,             # lookback period in bars
    ):
        self.gate_mode   = gate_mode.upper()
        self.min_conf    = min_confidence
        self.max_age     = max_signal_age_seconds
        self.tf_map      = tf_map or DEFAULT_TF_MAP
        self.dt_param    = dual_thrust_param
        self.dt_rg       = dual_thrust_rg
        self._cache: dict[str, dict] = {}   # in-memory signal cache
        
        # Initialize specialist agents for each symbol under Risk Manager
        self.specialists = {
            "EURUSD+": EURUSDSpecialistAgent(),
            "XAUUSD+": XAUUSDSpecialistAgent("XAUUSD+"),
            "XAUEUR+": XAUUSDSpecialistAgent("XAUEUR+"),
            "GBPUSD+": GBPUSDSpecialistAgent(),
            "NAS100":  NAS100SpecialistAgent(),
            "BTCUSD":  BTCUSDSpecialistAgent("BTCUSD"),
            "BTCUSD+": BTCUSDSpecialistAgent("BTCUSD+"),
        }
        self.default_specialist = SymbolSpecialistAgent("GENERIC")
        
        self.load_config()  # Load saved settings if available

    # ── Configuration Persistence ─────────────────────────────────────────────

    def load_config(self):
        """Loads configuration from live_bot_config.json if it exists."""
        config_path = _SCRIPT_DIR.parent / "config" / "live_bot_config.json"
        if config_path.exists():
            try:
                data = json.loads(config_path.read_text(encoding="utf-8"))
                if "gate_mode" in data:
                    self.gate_mode = data["gate_mode"].upper()
                if "min_confidence" in data:
                    self.min_conf = float(data["min_confidence"])
                if "max_signal_age_seconds" in data:
                    self.max_age = int(data["max_signal_age_seconds"])
                if "tf_map" in data:
                    self.tf_map = data["tf_map"]
            except Exception as e:
                print(f"[RiskMgr] [ERROR] Failed to load config from {config_path}: {e}")

    def save_config(self):
        """Saves current configuration to live_bot_config.json."""
        config_path = _SCRIPT_DIR.parent / "config" / "live_bot_config.json"
        try:
            data = {
                "gate_mode": self.gate_mode,
                "min_confidence": self.min_conf,
                "max_signal_age_seconds": self.max_age,
                "tf_map": self.tf_map
            }
            config_path.parent.mkdir(parents=True, exist_ok=True)
            config_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        except Exception as e:
            print(f"[RiskMgr] [ERROR] Failed to save config to {config_path}: {e}")

    # ── Public API ────────────────────────────────────────────────────────────

    # ── Quantitative Breakout Strategies ──────────────────────────────────────

    def calculate_dual_thrust_levels(
        self,
        open_price: float,
        highs: list[float] | np.ndarray,
        lows: list[float] | np.ndarray,
        closes: list[float] | np.ndarray,
        rg: Optional[int] = None,
        param: Optional[float] = None
    ) -> tuple[float, float]:
        """
        Computes the Dual Thrust opening range breakout triggers using NumPy.
        Formula:
            range1 = Max(Highs[N]) - Min(Closes[N])
            range2 = Max(Closes[N]) - Min(Lows[N])
            thrust_range = Max(range1, range2)
            upper_trigger = open_price + param * thrust_range
            lower_trigger = open_price - (1 - param) * thrust_range
        """
        lookback = rg if rg is not None else self.dt_rg
        p_val = param if param is not None else self.dt_param
        
        if len(closes) < lookback:
            return 0.0, 0.0

        sub_highs = np.array(highs[-lookback:])
        sub_lows = np.array(lows[-lookback:])
        sub_closes = np.array(closes[-lookback:])

        r1 = np.max(sub_highs) - np.min(sub_closes)
        r2 = np.max(sub_closes) - np.min(sub_lows)
        thrust_range = max(r1, r2)

        sig_up = open_price + p_val * thrust_range
        sig_lo = open_price - (1.0 - p_val) * thrust_range
        return sig_up, sig_lo

    def calculate_london_breakout_levels(
        self,
        asia_high: float,
        asia_low: float,
        threshold_points: float = 50.0,
        point_size: float = 0.00001
    ) -> tuple[float, float]:
        """
        Computes London Session Breakout triggers.
        Returns (sig_up, sig_lo) based on Asia Session High/Low buffer.
        """
        buffer = threshold_points * point_size
        sig_up = asia_high + buffer
        sig_lo = asia_low - buffer
        return sig_up, sig_lo

    def calculate_bollinger_bands_w_pattern(
        self,
        closes: list[float] | np.ndarray
    ) -> str:
        """
        Extracts the Double Bottom 'W' (and Double Top 'M') pattern from
        the Bollinger Bands Pattern Recognition quant base.
        """
        closes = np.array(closes)
        if len(closes) < 40:
            return "NEUTRAL"
            
        # Calculate Bollinger Bands (window=20, std=2)
        window = 20
        ma = np.array([np.mean(closes[max(0, i-window+1):i+1]) for i in range(len(closes))])
        std = np.array([np.std(closes[max(0, i-window+1):i+1]) for i in range(len(closes))])
        upper = ma + 2 * std
        lower = ma - 2 * std
        
        # We look back 20 bars to find nodes for bottom W shape
        # Nodes:
        # l (first peak), k (first low), j (mid peak), m (second low), i (current bar breakout)
        # Condition 4 (breakout i): Current close above upper band
        if closes[-1] > upper[-1]:
            # Let's search backwards for the other nodes
            # Node m (second bottom near lower band, m < k price)
            for m in range(len(closes)-2, len(closes)-15, -1):
                if abs(closes[m] - lower[m]) < 1.5 * std[m]: # near lower band
                    # Node j (mid peak near middle band)
                    for j in range(m-1, m-15, -1):
                        if closes[j] > ma[j]: # above middle band
                            # Node k (first bottom near lower band)
                            for k in range(j-1, j-15, -1):
                                if abs(closes[k] - lower[k]) < 1.5 * std[k] and closes[m] > closes[k]: # higher low (m > k)
                                    return "BULLISH"
                                    
        # Condition for M Top (Bearish Breakdown)
        elif closes[-1] < lower[-1]:
            for m in range(len(closes)-2, len(closes)-15, -1):
                if abs(closes[m] - upper[m]) < 1.5 * std[m]: # near upper band
                    for j in range(m-1, m-15, -1):
                        if closes[j] < ma[j]: # below middle band
                            for k in range(j-1, j-15, -1):
                                if abs(closes[k] - upper[k]) < 1.5 * std[k] and closes[m] < closes[k]: # lower high (m < k)
                                    return "BEARISH"
                                    
        return "NEUTRAL"

    def calculate_awesome_oscillator(
        self,
        highs: list[float] | np.ndarray,
        lows: list[float] | np.ndarray
    ) -> str:
        """
        Awesome Oscillator (AO) calculation based on the awesome oscillator quant base.
        Compares 5-period SMA and 34-period SMA of median prices.
        """
        highs = np.array(highs)
        lows = np.array(lows)
        if len(highs) < 35:
            return "NEUTRAL"
            
        median = (highs + lows) / 2.0
        # Calculate 5 and 34 SMAs
        ao = []
        for i in range(33, len(median)):
            ma5 = np.mean(median[i-4:i+1])
            ma34 = np.mean(median[i-33:i+1])
            ao.append(ma5 - ma34)
            
        if len(ao) < 2:
            return "NEUTRAL"
            
        # Bullish cross or green bar saucer
        if ao[-1] > 0 and ao[-2] <= 0:
            return "BULLISH"
        elif ao[-1] < 0 and ao[-2] >= 0:
            return "BEARISH"
            
        return "NEUTRAL"

    # ── Public API ────────────────────────────────────────────────────────────

    def evaluate(
        self,
        symbol: str,
        direction: str,
        current_price: Optional[float] = None,
        highs: Optional[list[float]] = None,
        lows: Optional[list[float]] = None,
        closes: Optional[list[float]] = None,
        open_price: Optional[float] = None,
        asia_high: Optional[float] = None,
        asia_low: Optional[float] = None,
        volumes: Optional[list[float]] = None,
    ) -> dict:
        """
        Evaluate whether to allow/modify a proposed trade based on technical forecasts,
        senior quantitative macro geopolitical risk sentiment gating, and advanced
        breakout confirmations (Dual Thrust & London Session models).
        """
        self.load_config()  # Dynamic hot-reload of config!
        direction = direction.upper()
        symbol_upper = symbol.upper()

        # ── 1. Geopolitical & Macro Risk Assessment ──────────────────────────
        macro_sentiment_file = _SCRIPT_DIR / "macro_sentiment.json"
        common_sentiment_file = _MT5_COMMON_FILES / "macro_sentiment.json" if _MT5_COMMON_FILES.exists() else None
        
        sentiment_data = None
        if macro_sentiment_file.exists():
            try:
                sentiment_data = json.loads(macro_sentiment_file.read_text(encoding="utf-8"))
            except Exception:
                pass
        if sentiment_data is None and common_sentiment_file and common_sentiment_file.exists():
            try:
                sentiment_data = json.loads(common_sentiment_file.read_text(encoding="utf-8"))
            except Exception:
                pass

        macro_conflict = False
        macro_risk = "LOW"
        macro_bias = "NEUTRAL"
        
        if sentiment_data:
            # ── Staleness Guard: discard macro data older than 4 hours ──────────
            generated_at = sentiment_data.get("generated_at", "")
            if generated_at:
                try:
                    from datetime import timezone as _tz
                    gen_ts = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
                    age_hours = (datetime.now(_tz.utc) - gen_ts).total_seconds() / 3600.0
                    if age_hours > 4.0:
                        print(f"[RiskMgr] [WARN] macro_sentiment.json is {age_hours:.1f}h old — ignoring stale data")
                        sentiment_data = None
                except Exception:
                    pass

        if sentiment_data:
            macro_risk = sentiment_data.get("geopolitical_risk", "LOW")
            raw_bias = sentiment_data.get("macro_bias", {})
            # Direct lookup first; then proxy fallback for symbols not in crawler output
            _proxy_map = {
                "XAUEUR+": "XAUUSD+",  # Gold priced in EUR — same safe-haven bias as XAUUSD+
                "BTCUSD":  "NAS100",   # BTC tracks risk-on/risk-off similar to Nasdaq
                "CL-OIL":  "XAUUSD+",  # Crude oil — energy geopolitical risk proxy
            }
            macro_bias = raw_bias.get(
                symbol_upper,
                raw_bias.get(_proxy_map.get(symbol_upper, ""), "NEUTRAL")
            ).upper()
            
            if macro_risk in ["HIGH", "CRITICAL"]:
                if direction == "BUY" and macro_bias == "BEARISH":
                    macro_conflict = True
                elif direction == "SELL" and macro_bias == "BULLISH":
                    macro_conflict = True

        # ── 2. Quant Specialist Agent Delegation Layer ───────────────────────
        spec_agent = self.specialists.get(symbol_upper, self.default_specialist)
        spec_eval = spec_agent.evaluate_strategy(
            direction, current_price, highs, lows, closes, open_price, asia_high, asia_low, volumes=volumes
        )
        
        quant_alignment = False
        quant_conflict = False
        quant_details = []
        
        if spec_eval["bias"] != "NEUTRAL":
            quant_details.append(f"SpecialistAgent={spec_eval['bias']} ({spec_eval['reason']})")
            if (direction == "BUY" and spec_eval["bias"] == "BULLISH") or (direction == "SELL" and spec_eval["bias"] == "BEARISH"):
                quant_alignment = True
            else:
                quant_conflict = True

        # ── 3. Handle G4 TimesFM Gate ──────────────────────────────────────────
        if self.gate_mode == "OFF":
            if macro_conflict and macro_risk == "CRITICAL":
                # Even if G4 gate is OFF, a CRITICAL macro conflict triggers a SOFT lot-halving for safety
                return {
                    "allow": True, "lot_mult": 0.5, "bias": macro_bias, "confidence": 1.0,
                    "mode": "MACRO_SOFT", "reason": f"CRITICAL macro bias is {macro_bias} conflict",
                    "telegram_tag": "⚠️"
                }
            return self._allow(direction, "NEUTRAL", 0.0, "G4 gate is OFF")

        # Check technical TimesFM signal
        signal = self._read_signal(symbol)
        
        # Base decision on TimesFM
        allow = True
        lot_mult = 1.0
        tfm_bias = "NEUTRAL"
        tfm_conf = 0.0
        reason = "No G4 or macro signals active — gate open"
        tag = "➖"
        mode_used = "ALLOW"

        if signal is not None:
            tfm_bias   = signal.get("bias", "NEUTRAL").upper()
            tfm_conf   = float(signal.get("confidence", 0.0))
            
            tfm_conflicts = (
                (direction == "BUY"  and tfm_bias == "BEAR") or
                (direction == "SELL" and tfm_bias == "BULL")
            )
            tfm_aligns = (
                (direction == "BUY"  and tfm_bias == "BULL") or
                (direction == "SELL" and tfm_bias == "BEAR")
            )
            
            tfm_high_conf = tfm_conf >= self.min_conf
            
            if tfm_conflicts and tfm_high_conf:
                reason = f"TFM says {tfm_bias} {tfm_conf*100:.0f}% but signal is {direction}"
                if self.gate_mode == "BLOCK":
                    allow = False
                    lot_mult = 0.0
                    mode_used = "BLOCK"
                    tag = "🚫"
                elif self.gate_mode == "SOFT":
                    lot_mult = 0.5
                    mode_used = "SOFT"
                    tag = "⚠️"
                elif self.gate_mode == "WARN":
                    mode_used = "WARN"
                    tag = "⚠️"
            elif tfm_aligns:
                tag = "✅"
                reason = f"TFM {tfm_bias} {tfm_conf*100:.0f}% ALIGNED"

        # ── 4. Overlay Macro Risk Gate Decision ───────────────────────────────
        if macro_conflict:
            macro_reason = f"Senior Quant Macro Alert: Geopolitical risk is {macro_risk} with contrary {macro_bias} bias"
            if self.gate_mode == "BLOCK":
                allow = False
                lot_mult = 0.0
                reason = f"{macro_reason} | {reason}"
                mode_used = "MACRO_BLOCK"
                tag = "🚫"
            elif self.gate_mode == "SOFT" or self.gate_mode == "WARN":
                lot_mult = 0.5 if self.gate_mode == "SOFT" else lot_mult
                reason = f"{macro_reason} | {reason}"
                mode_used = "MACRO_SOFT" if self.gate_mode == "SOFT" else "MACRO_WARN"
                tag = "⚠️"

        # ── 5. Overlay Quant Strategy Validation & Sizing Boost ──────────────
        if quant_alignment and allow:
            # Multi-strategy confirmation! Increase sizing or ease restriction!
            lot_mult = min(2.0, lot_mult * 1.25)
            reason = f"{reason} | Quant confirmed: {', '.join(quant_details)}"
            if mode_used == "ALLOW":
                mode_used = "BOOSTED"
                tag = "🚀"
        elif quant_conflict:
            # Breakout is active in the opposite direction!
            lot_mult = max(0.0, lot_mult * 0.5)
            reason = f"{reason} | Quant CONFLICT: {', '.join(quant_details)}"
            if self.gate_mode == "BLOCK":
                allow = False
                lot_mult = 0.0
                mode_used = "QUANT_BLOCK"
                tag = "🚫"
            else:
                mode_used = "QUANT_SOFT"
                tag = "⚠️"

        return {
            "allow": allow,
            "lot_mult": lot_mult,
            "bias": tfm_bias if tfm_bias != "NEUTRAL" else macro_bias,
            "confidence": tfm_conf if tfm_conf > 0.0 else (1.0 if macro_conflict else 0.5),
            "mode": mode_used,
            "reason": reason,
            "telegram_tag": tag
        }

    def set_mode(self, mode: GateMode):
        """Hot-swap gate mode and save config."""
        self.gate_mode = mode.upper()
        self.save_config()
        print(f"[RiskMgr] Gate mode changed to {self.gate_mode} and config saved.")

    def get_forecast_summary(self, symbol: str) -> str:
        """Returns a human-readable one-liner for OCTO / Telegram."""
        sig = self._read_signal(symbol)
        if sig is None:
            return f"{symbol}: No forecast available (signal file missing)"
        bias = sig.get("bias", "NEUTRAL")
        conf = float(sig.get("confidence", 0.0)) * 100
        pct  = float(sig.get("pct_change", 0.0))
        tf   = sig.get("timeframe", "?")
        end  = sig.get("expected_end_price", 0.0)
        arrow = "⬆️" if bias == "BULL" else ("⬇️" if bias == "BEAR" else "➡️")
        return (f"{arrow} *{symbol}* [{tf}] → `{bias}` "
                f"{conf:.0f}% conf | Δ`{pct:+.3f}%` | Target `{end:.5f}`")

    def get_all_summaries(self, symbols: list[str]) -> str:
        """Multi-symbol summary for OCTO voice response."""
        lines = [self.get_forecast_summary(s) for s in symbols]
        return "\n".join(lines)

    # ── Signal file reader ────────────────────────────────────────────────────

    def _read_signal(self, symbol: str) -> Optional[dict]:
        """
        Read the cached TimesFM signal for a symbol.
        Looks in MT5 Common Files first, then the script directory.
        Returns None if file is missing, stale, or has an error.
        """
        # Build file path (portfolio mode writes per-symbol portfolio file)
        portfolio_path = self._signal_path("portfolio")
        symbol_path    = self._signal_path(symbol)

        data = None

        # Try portfolio file first (written by --portfolio mode or forecast_portfolio())
        if portfolio_path.exists():
            try:
                all_sigs = json.loads(portfolio_path.read_text(encoding="utf-8"))
                # Portfolio file is a dict keyed by symbol (e.g. {"EURUSD+": {...}, ...})
                if isinstance(all_sigs, dict):
                    if symbol in all_sigs:
                        data = all_sigs[symbol]
                    else:
                        # Symbol not yet in portfolio file (model still running) — fallback below
                        pass
                elif isinstance(all_sigs, list):
                    data = next((s for s in all_sigs if s.get("symbol") == symbol), None)
            except Exception:
                pass

        # Fall back to per-symbol file
        if data is None and symbol_path.exists():
            try:
                data = json.loads(symbol_path.read_text(encoding="utf-8"))
            except Exception:
                pass

        # Fall back to the single timesfm_signal.json
        if data is None:
            single_path = self._signal_path(None)
            if single_path.exists():
                try:
                    d = json.loads(single_path.read_text(encoding="utf-8"))
                    if d.get("symbol", "").upper() == symbol.upper():
                        data = d
                except Exception:
                    pass

        if data is None:
            return None

        # Stale check
        ts = data.get("generated_at", "")
        if ts:
            try:
                # Parse ISO-8601 with or without timezone
                ts_clean = ts[:19].replace("T", " ")
                sig_time = datetime.strptime(ts_clean, "%Y-%m-%d %H:%M:%S")
                sig_time = sig_time.replace(tzinfo=timezone.utc)
                age = (datetime.now(timezone.utc) - sig_time).total_seconds()
                if age > self.max_age:
                    print(f"[RiskMgr] {symbol} signal stale ({age:.0f}s) — gate open")
                    return None
            except Exception:
                pass  # can't parse timestamp, allow through

        # Error check
        if data.get("error"):
            return None

        return data

    def _signal_path(self, symbol: Optional[str]) -> Path:
        """Determine signal file path, preferring MT5 common files."""
        base = _MT5_COMMON_FILES if _MT5_COMMON_FILES.exists() else _SCRIPT_DIR
        if symbol is None:
            return base / "timesfm_signal.json"
        if symbol == "portfolio":
            return base / "timesfm_portfolio_signals.json"
        safe = symbol.replace("+", "plus").replace("/", "_")
        return base / f"timesfm_{safe}.json"

    # ── Gate helpers ──────────────────────────────────────────────────────────

    @staticmethod
    def _allow(direction, bias, conf, reason, tag="✅") -> dict:
        return {
            "allow": True, "lot_mult": 1.0,
            "bias": bias, "confidence": conf,
            "mode": "ALLOW", "reason": reason,
            "telegram_tag": tag,
        }

    @staticmethod
    def _block(direction, bias, conf, reason) -> dict:
        return {
            "allow": False, "lot_mult": 0.0,
            "bias": bias, "confidence": conf,
            "mode": "BLOCK", "reason": f"BLOCKED — {reason}",
            "telegram_tag": "🚫",
        }

    @staticmethod
    def _soft(direction, bias, conf, reason) -> dict:
        return {
            "allow": True, "lot_mult": 0.5,
            "bias": bias, "confidence": conf,
            "mode": "SOFT", "reason": f"SOFT — {reason}",
            "telegram_tag": "⚠️",
        }

    @staticmethod
    def _warn(direction, bias, conf, reason) -> dict:
        return {
            "allow": True, "lot_mult": 1.0,
            "bias": bias, "confidence": conf,
            "mode": "WARN", "reason": f"WARN — {reason}",
            "telegram_tag": "⚠️",
        }
