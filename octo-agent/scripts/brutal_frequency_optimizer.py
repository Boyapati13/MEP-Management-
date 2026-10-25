#!/usr/bin/env python3
"""
Whale Suite — BRUTAL FREQUENCY OPTIMIZER (v1.0)
================================================
Diagnoses and fixes the 1-3 trades/day bottleneck.

Core insight: The binary Markov conviction gate kills 80-95% of valid signals.
This optimizer:
  1. Tests RAW frequency (no Markov gate) to see true signal count.
  2. Tests RELAXED conviction thresholds (0.05 to 0.30 instead of 0.0).
  3. Sweeps session tolerance (how close to VAL/POC/VAH is "near").
  4. Sweeps RSI crossover aggressiveness (Relaxed vs Aggressive vs Extreme).
  5. Reports best configs that hit >= 2 trades/day with >= 45% win rate.

Target: 2-5 trades/day with >= 45% WR and PF > 1.0 on M1 execution.
"""

import os
import sys
import time
import argparse
import numpy as np
from datetime import datetime, timezone, timedelta
import MetaTrader5 as mt5

# ==============================================================================
# RSI Utilities
# ==============================================================================

def calculate_rsi(prices, period):
    n = len(prices)
    rsi = np.full(n, 50.0)
    if n <= period:
        return rsi
    deltas = np.diff(prices)
    seed = deltas[:period]
    up = seed[seed >= 0].sum() / period
    down = -seed[seed < 0].sum() / period
    if down == 0:
        rsi[period] = 100.0
    else:
        rsi[period] = 100.0 - 100.0 / (1.0 + up / down)
    for i in range(period + 1, n):
        delta = deltas[i - 1]
        upval = delta if delta > 0 else 0.0
        downval = -delta if delta < 0 else 0.0
        up = (up * (period - 1) + upval) / period
        down = (down * (period - 1) + downval) / period
        if down == 0:
            rsi[i] = 100.0
        else:
            rsi[i] = 100.0 - 100.0 / (1.0 + up / down)
    return rsi


def calculate_dynamic_rsi(closes, highs, lows, pd_val, vol_sens, point_size):
    n = len(closes)
    tr = np.zeros(n)
    tr[0] = highs[0] - lows[0]
    for i in range(1, n):
        tr[i] = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
    avg_tr = np.zeros(n)
    for i in range(n):
        start = max(0, i - pd_val + 1)
        avg_tr[i] = np.mean(tr[start:i+1])
        if avg_tr[i] == 0:
            avg_tr[i] = 1e-8
    dyn_gain = np.zeros(n)
    dyn_loss = np.zeros(n)
    rsi_history = np.full(n, 50.0)
    sum_gain = 0.0
    sum_loss = 0.0
    seed_len = min(pd_val, n - 1)
    for k in range(1, seed_len + 1):
        ch = closes[k] - closes[k-1]
        if ch > 0:
            sum_gain += ch
        else:
            sum_loss -= ch
    if seed_len > 0:
        dyn_gain[seed_len] = sum_gain / seed_len
        dyn_loss[seed_len] = sum_loss / seed_len
        if dyn_loss[seed_len] < point_size:
            rsi_history[seed_len] = 100.0
        else:
            rsi_history[seed_len] = 100.0 - (100.0 / (1.0 + dyn_gain[seed_len] / dyn_loss[seed_len]))
    for i in range(seed_len + 1, n):
        vr = tr[i] / avg_tr[i]
        alpha = (1.0 / pd_val) * (vr ** vol_sens)
        alpha = max(0.01, min(0.99, alpha))
        ch = closes[i] - closes[i-1]
        if ch > 0:
            dyn_gain[i] = alpha * ch + (1.0 - alpha) * dyn_gain[i-1]
            dyn_loss[i] = (1.0 - alpha) * dyn_loss[i-1]
        else:
            dyn_gain[i] = (1.0 - alpha) * dyn_gain[i-1]
            dyn_loss[i] = alpha * abs(ch) + (1.0 - alpha) * dyn_loss[i-1]
        if dyn_loss[i] < point_size:
            rsi_history[i] = 100.0
        else:
            rsi_history[i] = 100.0 - (100.0 / (1.0 + dyn_gain[i] / dyn_loss[i]))
    return rsi_history


def calc_poc_and_va(bins, n_bins, min_p, step):
    if n_bins <= 0 or step <= 0:
        return 0.0, 0.0, 0.0, 0
    max_vol = -1.0
    poc_bin = 0
    for i in range(n_bins):
        if bins[i] > max_vol:
            max_vol = bins[i]
            poc_bin = i
    poc = min_p + step * poc_bin + step * 0.5
    total_vol = sum(bins)
    if max_vol <= 0.0 or total_vol <= 0.0:
        return poc, poc, poc, poc_bin
    target = total_vol * 0.70
    accumulated = bins[poc_bin]
    hi_idx = poc_bin
    lo_idx = poc_bin
    while accumulated < target:
        can_up = (hi_idx + 1 < n_bins)
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
    return poc, vah, val, poc_bin


# ==============================================================================
# Markov Regime Inference
# ==============================================================================

def run_markov_inference(m15_closes, m15_times, time_target, window=15, threshold=0.001, lookback=200):
    idx_in_m15 = -1
    for j, m_time in enumerate(m15_times):
        if m_time >= time_target:
            idx_in_m15 = j - 1
            break
    required_len = lookback + window + 5
    if idx_in_m15 < required_len:
        return 0.0  # neutral
    close_sub = m15_closes[idx_in_m15 - required_len: idx_in_m15 + 1]
    returns = (close_sub[window:] - close_sub[:-window]) / (close_sub[:-window] + 1e-10)
    returns = returns[-lookback:]
    labels = np.full(len(returns), 1)
    labels[returns > threshold] = 2
    labels[returns < -threshold] = 0
    counts = np.zeros((3, 3))
    for k in range(len(labels) - 1):
        counts[labels[k], labels[k+1]] += 1
    P = np.zeros((3, 3))
    for r in range(3):
        r_sum = counts[r].sum()
        if r_sum > 0:
            P[r] = counts[r] / r_sum
        else:
            P[r, r] = 1.0
    current_state = labels[-1]
    conviction = P[current_state, 2] - P[current_state, 0]
    return float(conviction)


# ==============================================================================
# Main Optimizer
# ==============================================================================

class BrutalFrequencyOptimizer:
    def __init__(self, symbol: str, m1_candle_count: int = 12000, balance: float = 10000.0):
        self.symbol = symbol.upper()
        self.candle_count = m1_candle_count
        self.initial_balance = balance
        self.broker_gmt_offset = 3
        self.point_size = 0.00001
        self.m1_candles = []
        self.m15_closes = np.array([])
        self.m15_times = []
        self.h1_rsi_cache = {}
        self.sessions = {
            0: {"start": 0,  "end": 8,  "bins": 30, "name": "ASIA"},
            1: {"start": 8,  "end": 16, "bins": 30, "name": "LONDON"},
            2: {"start": 13, "end": 21, "bins": 30, "name": "NY"},
        }

    def detect_broker_offset(self) -> int:
        tick = mt5.symbol_info_tick(self.symbol)
        if tick:
            server_time = tick.time
            utc_time = int(time.time())
            if abs(utc_time - server_time) > 3 * 3600:
                return 3
            return round((server_time - utc_time) / 3600.0)
        return 3

    def connect_and_fetch(self) -> bool:
        if not mt5.initialize():
            exe_path = r"C:\Program Files\MetaTrader 5\terminal64.exe"
            if os.path.exists(exe_path) and mt5.initialize(path=exe_path):
                pass
            else:
                print(f"[ERROR] MT5 init failed: {mt5.last_error()}")
                return False
        self.broker_gmt_offset = self.detect_broker_offset()
        s_info = mt5.symbol_info(self.symbol)
        if s_info is None:
            alt = self.symbol.replace("+", "")
            s_info = mt5.symbol_info(alt)
            if s_info:
                self.symbol = alt
            else:
                print(f"[ERROR] Symbol {self.symbol} not found.")
                return False
        self.point_size = s_info.point
        mt5.symbol_select(self.symbol, True)

        print(f"  [Fetch] Downloading {self.candle_count} M1 bars...")
        m1_rates = mt5.copy_rates_from_pos(self.symbol, mt5.TIMEFRAME_M1, 0, self.candle_count + 1500)
        m15_rates = mt5.copy_rates_from_pos(self.symbol, mt5.TIMEFRAME_M15, 0, int(self.candle_count / 15) + 600)
        h1_rates = mt5.copy_rates_from_pos(self.symbol, mt5.TIMEFRAME_H1, 0, int(self.candle_count / 60) + 200)

        if m1_rates is None or len(m1_rates) == 0:
            print("[ERROR] M1 download failed.")
            return False
        if m15_rates is None or len(m15_rates) == 0:
            print("[ERROR] M15 download failed.")
            return False
        if h1_rates is None or len(h1_rates) == 0:
            print("[ERROR] H1 download failed.")
            return False

        self.m1_candles = []
        for r in m1_rates:
            self.m1_candles.append({
                "time": datetime.fromtimestamp(int(r["time"]), tz=timezone.utc),
                "open": float(r["open"]),
                "high": float(r["high"]),
                "low": float(r["low"]),
                "close": float(r["close"]),
                "volume": int(r["tick_volume"]),
            })

        self.m15_closes = np.array([float(x["close"]) for x in m15_rates])
        self.m15_times = [datetime.fromtimestamp(int(x["time"]), tz=timezone.utc) for x in m15_rates]

        # H1 RSI cache (for trend filter)
        h1_closes = np.array([float(x["close"]) for x in h1_rates])
        h1_times = [datetime.fromtimestamp(int(x["time"]), tz=timezone.utc) for x in h1_rates]
        rsi_vals = calculate_rsi(h1_closes, 14)
        self.h1_rsi_cache = {h1_times[j]: rsi_vals[j] for j in range(len(h1_times))}

        print(f"  [Loaded] {len(self.m1_candles)} M1 | {len(self.m15_closes)} M15 | {len(h1_rates)} H1")

        # Pre-cache session flags
        print("  [Caching] Pre-calculating session flags...")
        for sc in self.m1_candles:
            gmt = sc["time"] - timedelta(hours=self.broker_gmt_offset)
            malta_h = (gmt + timedelta(hours=2)).hour
            sc["malta_hour"] = malta_h
            sc["in_session"] = {}
            for s_idx, p in self.sessions.items():
                in_s = (malta_h >= p["start"] and malta_h < p["end"]) if p["start"] <= p["end"] else (malta_h >= p["start"] or malta_h < p["end"])
                sc["in_session"][s_idx] = in_s

        return True

    def run_sweep(self):
        closes = np.array([c["close"] for c in self.m1_candles])
        highs = np.array([c["high"] for c in self.m1_candles])
        lows = np.array([c["low"] for c in self.m1_candles])

        # Pre-compute Dynamic RSI for multiple period configs
        print("\n  [Computing] Pre-computing Dynamic RSI arrays...")
        dyn_rsi_cache = {}
        for pd_val in [9, 14, 20]:
            dyn_rsi_cache[pd_val] = calculate_dynamic_rsi(closes, highs, lows, pd_val, 1.2, self.point_size)
        print(f"  [Done] Dynamic RSI computed for periods: {list(dyn_rsi_cache.keys())}")

        # Calculate approximate trading days in window
        if self.m1_candles:
            t_first = self.m1_candles[300]["time"]
            t_last = self.m1_candles[-1]["time"]
            trading_days = max(1.0, (t_last - t_first).total_seconds() / 86400.0 * (5/7))
        else:
            trading_days = 10.0

        # -----------------------------------------------------------------------
        # CONFIG SPACE — full sweep
        # -----------------------------------------------------------------------
        rsi_configs = [
            {"pd": 9,  "bull": 40.0, "bear": 60.0, "name": "Extreme"},
            {"pd": 9,  "bull": 45.0, "bear": 55.0, "name": "Aggressive-Fast"},
            {"pd": 14, "bull": 45.0, "bear": 55.0, "name": "Relaxed"},
            {"pd": 14, "bull": 50.0, "bear": 50.0, "name": "Pure-Crossover"},
            {"pd": 20, "bull": 45.0, "bear": 55.0, "name": "Slow-Relaxed"},
        ]
        tol_mults = [0.5, 1.0, 1.5, 2.0, 3.0]  # proximity to VAL/POC/VAH shelf
        lookback_bars = [30, 60, 90]            # Volume profile lookback in M1 bars (0.5h, 1h, 1.5h)

        # Markov modes — key is conviction_min required to allow trade
        markov_modes = [
            {"name": "OFF",       "use_markov": False, "conv_min": 0.0},
            {"name": "VERY_SOFT", "use_markov": True,  "conv_min": 0.05},
            {"name": "SOFT",      "use_markov": True,  "conv_min": 0.10},
            {"name": "MEDIUM",    "use_markov": True,  "conv_min": 0.20},
            {"name": "STRICT",    "use_markov": True,  "conv_min": 0.30},
        ]

        # Markov M15 parameters
        markov_params_list = [
            {"window": 10, "threshold": 0.001},
            {"window": 15, "threshold": 0.001},
            {"window": 20, "threshold": 0.002},
        ]

        n_total = len(self.m1_candles)
        is_start = 300

        print(f"\n  [Sweep] Trading window: ~{trading_days:.1f} active days")
        print(f"  [Sweep] RSI configs: {len(rsi_configs)} | Tol mults: {len(tol_mults)} | Markov modes: {len(markov_modes)}")
        total_configs = len(rsi_configs) * len(tol_mults) * len(lookback_bars) * len(markov_modes) * len(markov_params_list)
        print(f"  [Sweep] Total configurations to test: {total_configs}")
        print("  [Sweep] Running sweep...\n")

        results = []
        t0 = time.time()
        cfg_n = 0

        # Pre-compute M15 Markov cache for all parameter sets
        print("  [Markov] Pre-caching M15 conviction values...")
        markov_conv_cache = {}
        for mp in markov_params_list:
            key = (mp["window"], mp["threshold"])
            markov_conv_cache[key] = {}
            for c in self.m1_candles[is_start:]:
                m15_t = datetime(c["time"].year, c["time"].month, c["time"].day,
                                 c["time"].hour, (c["time"].minute // 15) * 15, tzinfo=timezone.utc)
                if m15_t not in markov_conv_cache[key]:
                    conv = run_markov_inference(
                        self.m15_closes, self.m15_times, m15_t,
                        window=mp["window"], threshold=mp["threshold"]
                    )
                    markov_conv_cache[key][m15_t] = conv
        print(f"  [Markov] Cache built. ({time.time() - t0:.1f}s elapsed)\n")

        t_sweep = time.time()
        for rsi_cfg in rsi_configs:
            dyn_rsi = dyn_rsi_cache[rsi_cfg["pd"]]

            for tol in tol_mults:
                for lb in lookback_bars:
                    # Pre-build base signals for this RSI/tol/lb combination
                    base_signals = []
                    for i in range(is_start, n_total):
                        c = self.m1_candles[i]
                        prev_h = c["time"] - timedelta(hours=1)
                        h1_key = datetime(prev_h.year, prev_h.month, prev_h.day, prev_h.hour, tzinfo=timezone.utc)
                        h1_rsi = self.h1_rsi_cache.get(h1_key, 50.0)
                        htf_bull = (h1_rsi > 50.0)
                        htf_bear = (h1_rsi < 50.0)

                        for s_idx, p in self.sessions.items():
                            if not c["in_session"][s_idx]:
                                continue

                            g_rsi_bull = (dyn_rsi[i] >= rsi_cfg["bull"])
                            g_rsi_bear = (dyn_rsi[i] <= rsi_cfg["bear"])

                            # Volume profile lookback
                            lb_window = self.m1_candles[max(0, i - lb): i]
                            if len(lb_window) < 15:
                                continue
                            vp_closes = np.array([x["close"] for x in lb_window])
                            min_p = vp_closes.min()
                            max_p = vp_closes.max()
                            step = max(max_p - min_p, self.point_size * 10) / p["bins"]
                            bins = np.zeros(p["bins"])
                            for x in lb_window:
                                bn = int((x["close"] - min_p) / step)
                                bn = max(0, min(p["bins"] - 1, bn))
                                bins[bn] += x["volume"]
                            poc, vah, val, _ = calc_poc_and_va(bins, p["bins"], min_p, step)

                            tol_price = tol * self.point_size * 50  # 50 points base
                            cl = c["close"]
                            op = c["open"]
                            near_val = abs(cl - val) <= tol_price
                            near_poc = abs(cl - poc) <= tol_price
                            near_vah = abs(cl - vah) <= tol_price

                            g_loc_bull = (near_val or near_poc) and (cl > op)
                            g_loc_bear = (near_vah or near_poc) and (cl < op)

                            buy_sig = g_loc_bull and htf_bull and g_rsi_bull
                            sell_sig = g_loc_bear and htf_bear and g_rsi_bear

                            if buy_sig:
                                sl = val - self.point_size * 30
                                dist = max(cl - sl, self.point_size * 5)
                                base_signals.append({"idx": i, "type": "BUY", "time": c["time"],
                                                     "price": cl, "sl": sl, "tp": cl + dist * 2.5})
                                break
                            elif sell_sig:
                                sl = vah + self.point_size * 30
                                dist = max(sl - cl, self.point_size * 5)
                                base_signals.append({"idx": i, "type": "SELL", "time": c["time"],
                                                     "price": cl, "sl": sl, "tp": cl - dist * 2.5})
                                break

                    raw_count = len(base_signals)
                    if raw_count == 0:
                        continue
                    raw_per_day = raw_count / trading_days

                    # Now run simulations for each Markov mode × Markov params
                    for mm in markov_modes:
                        for mp in markov_params_list:
                            # Skip Markov param sweep when Markov is OFF
                            if not mm["use_markov"] and (mp["window"] != markov_params_list[0]["window"]):
                                continue

                            cfg_n += 1
                            mk_key = (mp["window"], mp["threshold"])
                            conv_cache = markov_conv_cache[mk_key]

                            balance = self.initial_balance
                            active_trade = None
                            trades = []
                            sig_map = {s["idx"]: s for s in base_signals}

                            for i in range(is_start, n_total):
                                bar = self.m1_candles[i]
                                bt = bar["time"]
                                m15_t = datetime(bt.year, bt.month, bt.day, bt.hour,
                                                 (bt.minute // 15) * 15, tzinfo=timezone.utc)
                                conviction = conv_cache.get(m15_t, 0.0)

                                if active_trade:
                                    h, l = bar["high"], bar["low"]
                                    if active_trade["type"] == "BUY":
                                        if l <= active_trade["sl"]:
                                            pnl = -100.0
                                            balance += pnl
                                            trades.append({"result": "LOSS", "pnl": pnl})
                                            active_trade = None
                                        elif h >= active_trade["tp"]:
                                            pnl = 250.0
                                            balance += pnl
                                            trades.append({"result": "WIN", "pnl": pnl})
                                            active_trade = None
                                    else:
                                        if h >= active_trade["sl"]:
                                            pnl = -100.0
                                            balance += pnl
                                            trades.append({"result": "LOSS", "pnl": pnl})
                                            active_trade = None
                                        elif l <= active_trade["tp"]:
                                            pnl = 250.0
                                            balance += pnl
                                            trades.append({"result": "WIN", "pnl": pnl})
                                            active_trade = None
                                    continue

                                sig = sig_map.get(i)
                                if sig:
                                    allow = True
                                    if mm["use_markov"]:
                                        if sig["type"] == "BUY" and conviction < mm["conv_min"]:
                                            allow = False
                                        if sig["type"] == "SELL" and conviction > -mm["conv_min"]:
                                            allow = False
                                    if allow:
                                        active_trade = {
                                            "type": sig["type"],
                                            "sl": sig["sl"],
                                            "tp": sig["tp"],
                                        }

                            # Summarise
                            n_trades = len(trades)
                            if n_trades == 0:
                                continue
                            wins = [t for t in trades if t["result"] == "WIN"]
                            losses = [t for t in trades if t["result"] == "LOSS"]
                            wr = len(wins) / n_trades * 100.0
                            gp = sum(t["pnl"] for t in wins)
                            gl = abs(sum(t["pnl"] for t in losses))
                            pf = gp / gl if gl > 0 else gp
                            net_pct = (balance - self.initial_balance) / self.initial_balance * 100.0
                            tpd = n_trades / trading_days

                            results.append({
                                "rsi_name": rsi_cfg["name"],
                                "rsi_pd": rsi_cfg["pd"],
                                "bull": rsi_cfg["bull"],
                                "bear": rsi_cfg["bear"],
                                "tol": tol,
                                "lb": lb,
                                "markov_mode": mm["name"],
                                "use_markov": mm["use_markov"],
                                "conv_min": mm["conv_min"],
                                "mw": mp["window"],
                                "mt": mp["threshold"],
                                "raw_per_day": raw_per_day,
                                "trades": n_trades,
                                "tpd": tpd,
                                "wr": wr,
                                "pf": pf,
                                "net_pct": net_pct,
                            })

        elapsed = time.time() - t_sweep
        print(f"  [Done] Sweep complete in {elapsed:.1f}s. Total configs: {cfg_n}")
        return results, trading_days

    def report(self, results, trading_days):
        if not results:
            print("\n[WARNING] No valid configurations found. Try increasing --candles.")
            return

        # Sort criteria: WR >= 45% AND tpd >= 1.5, then by PF desc
        qualified = [r for r in results if r["wr"] >= 45.0 and r["tpd"] >= 1.5 and r["pf"] >= 1.0]
        qualified.sort(key=lambda x: (-x["wr"], -x["pf"]))

        # Fallback: WR >= 40% AND tpd >= 1.0
        if not qualified:
            print("\n[INFO] No configs hit WR >= 45% + TPD >= 1.5. Relaxing to WR >= 40% + TPD >= 1.0...")
            qualified = [r for r in results if r["wr"] >= 40.0 and r["tpd"] >= 1.0]
            qualified.sort(key=lambda x: (-x["wr"], -x["pf"]))

        # Fallback: highest WR regardless
        if not qualified:
            print("[INFO] Still empty. Showing top 10 by WR...")
            qualified = sorted(results, key=lambda x: -x["wr"])[:10]

        print("\n" + "=" * 70)
        print(f"   BRUTAL FREQUENCY OPTIMIZER — TOP RESULTS FOR {self.symbol}")
        print("=" * 70)
        print(f"   Trading days in window: ~{trading_days:.1f}")
        print()
        for rank, r in enumerate(qualified[:10], 1):
            print(f"  #{rank}  [{r['markov_mode']}]  {r['rsi_name']} | Tol={r['tol']}x | LB={r['lb']}bars")
            print(f"       WR={r['wr']:.1f}% | PF={r['pf']:.2f} | TPD={r['tpd']:.2f} | Net={r['net_pct']:+.2f}%")
            print(f"       Raw signals/day={r['raw_per_day']:.1f} | Mkov W={r['mw']} T={r['mt']:.4f} Conv>={r['conv_min']:.2f}")
            print()

        # Diagnostic: show raw signal frequency without any Markov
        raw_only = [r for r in results if not r["use_markov"]]
        if raw_only:
            best_raw = max(raw_only, key=lambda x: x["raw_per_day"])
            print(f"  📊 DIAGNOSTIC: Max raw signals WITHOUT Markov gate: {best_raw['raw_per_day']:.1f}/day")
            print(f"     Config: {best_raw['rsi_name']} | Tol={best_raw['tol']}x | LB={best_raw['lb']}bars")
            print(f"     WR={best_raw['wr']:.1f}% | TPD={best_raw['tpd']:.2f} | PF={best_raw['pf']:.2f}")
            print()

        # Save best result
        best = qualified[0] if qualified else sorted(results, key=lambda x: -x["wr"])[0]
        report_path = f"C:\\Users\\Tenders\\octo\\optimal_scalping_manager_{self.symbol}.md"
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(f"# Brutal Frequency Optimizer Report: {self.symbol}\n\n")
            f.write(f"Generated on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}.\n\n")
            f.write("## 🏆 Best High-Frequency Setup Found\n\n")
            f.write(f"| Parameter | Value |\n")
            f.write(f"| :--- | :--- |\n")
            f.write(f"| **RSI Config** | `{best['rsi_name']}` (period {best['rsi_pd']}) |\n")
            f.write(f"| **Bull Crossover** | `{best['bull']}` |\n")
            f.write(f"| **Bear Crossover** | `{best['bear']}` |\n")
            f.write(f"| **Tolerance Multiplier** | `{best['tol']}x` (×50 points) |\n")
            f.write(f"| **Volume Profile Lookback** | `{best['lb']}` M1 bars |\n")
            f.write(f"| **Markov Mode** | `{best['markov_mode']}` |\n")
            if best["use_markov"]:
                f.write(f"| **Markov Window** | `{best['mw']}` bars |\n")
                f.write(f"| **Markov Threshold** | `{best['mt']:.4f}` ({best['mt']*100:.3f}%) |\n")
                f.write(f"| **Min Conviction** | `{best['conv_min']:.2f}` |\n")
            f.write(f"\n## 📈 Performance Summary\n")
            f.write(f"- **Win Rate:** `{best['wr']:.2f}%`\n")
            f.write(f"- **Profit Factor:** `{best['pf']:.2f}`\n")
            f.write(f"- **Avg Trades/Day:** `{best['tpd']:.2f}`\n")
            f.write(f"- **Raw Signals/Day:** `{best['raw_per_day']:.1f}` (before any gating)\n")
            f.write(f"- **Net Return PnL:** `{best['net_pct']:+.2f}%`\n")
            f.write(f"- **Total Trades:** `{best['trades']}`\n")
            f.write(f"\n## 🔑 Key Insights\n")
            f.write(f"1. The raw volume-profile + RSI engine generates **{best['raw_per_day']:.1f} signals/day**.\n")
            f.write(f"2. The Markov gate in `{best['markov_mode']}` mode allows through **{best['tpd']:.2f} trades/day**.\n")
            if best["use_markov"]:
                kill_rate = 1.0 - (best['tpd'] / max(best['raw_per_day'], 0.001))
                f.write(f"3. Signal kill rate: **{kill_rate*100:.1f}%** — reducing this further will raise frequency.\n")
            else:
                f.write(f"3. No Markov gate applied — all volume-profile signals are passed through directly.\n")

        print(f"  [Saved] Report written to: {report_path}")
        print("=" * 70)


def main():
    parser = argparse.ArgumentParser(description="Brutal High-Frequency Parameter Optimizer")
    parser.add_argument("--symbol", type=str, default="EURUSD+", help="MT5 Symbol")
    parser.add_argument("--candles", type=int, default=12000, help="M1 candle count")
    args = parser.parse_args()

    print("\n" + "=" * 70)
    print("        BRUTAL FREQUENCY OPTIMIZER — OCTO TRADING SUITE")
    print("=" * 70)
    print(f"  Symbol : {args.symbol}")
    print(f"  Candles: {args.candles} M1 bars")
    print()

    opt = BrutalFrequencyOptimizer(symbol=args.symbol, m1_candle_count=args.candles)
    if not opt.connect_and_fetch():
        mt5.shutdown()
        return

    results, trading_days = opt.run_sweep()
    opt.report(results, trading_days)
    mt5.shutdown()


if __name__ == "__main__":
    main()
