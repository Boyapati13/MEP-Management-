"""
OCTO-Pro Central Risk Manager — Convex Portfolio Allocation Solver
==================================================================
Implements the Mean-CVaR (Conditional Value-at-Risk) portfolio optimization
described in OCTO-Pro v7.5.

Objective (Rockafellar-Uryasev formulation):
    min  ζ + 1/(S·(1-β)) · Σ z_s
    s.t. z_s ≥ -r_s·ω - ζ   ∀s
         z_s ≥ 0             ∀s
         Σ ω_i = 1
         ω_i ≥ 0

Where:
    ω     — portfolio weight vector (maps to lot-size scaling per symbol)
    β     — CVaR confidence level (default 0.95)
    S     — number of scenarios (rows in the return matrix)
    r_s   — scenario return vector for scenario s
    ζ     — VaR variable (Value-at-Risk threshold)
    z_s   — excess-loss auxiliary variables

Usage:
    solver = CvxpyRiskSolver(beta=0.95)
    result = solver.solve(trade_intents)
    # result["weights"]    — dict[symbol -> allocation weight]
    # result["cvar"]       — portfolio CVaR estimate
    # result["var"]        — portfolio VaR (ζ*)
    # result["lot_scales"] — dict[symbol -> lot multiplier in [0.1, 2.0]]
    # result["status"]     — "OPTIMAL" | "INFEASIBLE" | "DEGRADED" | "ERROR"
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Any

import numpy as np

try:
    import cvxpy as cp
    _CVXPY_AVAILABLE = True
except ImportError:
    _CVXPY_AVAILABLE = False

# ── Config ─────────────────────────────────────────────────────────────────────
DEFAULT_BETA          = 0.95     # CVaR confidence level
N_SCENARIOS           = 500      # Monte Carlo scenario count
MAX_SINGLE_WEIGHT     = 0.45     # No single symbol > 45% of risk budget
MIN_SINGLE_WEIGHT     = 0.0      # Long-only (no shorts at position sizing level)
MAX_LOT_SCALE         = 2.0      # Maximum lot multiplier vs. base sizing
MIN_LOT_SCALE         = 0.10     # Minimum lot multiplier (risk floor)
LATENCY_TARGET_MS     = 150.0    # Production execution budget

_result_lock = threading.Lock()
_last_result: dict[str, Any] = {}


# ── Solver ─────────────────────────────────────────────────────────────────────
class CvxpyRiskSolver:
    """
    Thread-safe Mean-CVaR portfolio allocation solver.
    Each call to .solve() runs synchronously; wrap in a thread for UI use.
    """

    def __init__(self, beta: float = DEFAULT_BETA, n_scenarios: int = N_SCENARIOS):
        self.beta        = beta
        self.n_scenarios = n_scenarios

    # ── Public ────────────────────────────────────────────────────────────────
    def solve(self, trade_intents: list[dict]) -> dict[str, Any]:
        """
        Solve the Mean-CVaR allocation problem.

        Args:
            trade_intents: list of dicts, each with keys:
                symbol       — e.g. "XAUUSD+"
                direction    — "BUY" | "SELL"
                base_lot     — float, base lot size before scaling
                signal_str   — float in [0,1], specialist confidence
                expected_ret — float, expected bar return (optional; estimated if absent)
                vol_est      — float, estimated return volatility (optional)

        Returns:
            dict with keys: weights, cvar, var, lot_scales, status, latency_ms, timestamp
        """
        t0 = time.perf_counter()

        if not trade_intents:
            return self._empty_result("NO_INTENTS", t0)

        symbols = [i["symbol"] for i in trade_intents]
        n       = len(symbols)

        # ── Build scenario return matrix R (S × n) ────────────────────────────
        R = self._build_scenario_matrix(trade_intents)

        if not _CVXPY_AVAILABLE:
            return self._fallback_equal_weight(symbols, R, t0)

        # ── CVXPY Mean-CVaR problem ───────────────────────────────────────────
        try:
            omega = cp.Variable(n, name="omega")
            zeta  = cp.Variable(name="zeta")         # VaR variable
            z     = cp.Variable(self.n_scenarios, name="z")  # excess-loss

            S    = self.n_scenarios
            beta = self.beta

            portfolio_returns = R @ omega  # shape (S,)

            constraints = [
                z >= -portfolio_returns - zeta,
                z >= 0,
                cp.sum(omega) == 1,
                omega >= MIN_SINGLE_WEIGHT,
                omega <= MAX_SINGLE_WEIGHT,
            ]

            cvar_objective = zeta + (1.0 / (S * (1.0 - beta))) * cp.sum(z)

            # Mean-CVaR: maximise return - λ·CVaR
            # λ=1 gives equal weight to return vs tail risk
            mean_ret = (1.0 / S) * cp.sum(portfolio_returns)
            objective = cp.Minimize(cvar_objective - 0.5 * mean_ret)

            prob = cp.Problem(objective, constraints)
            prob.solve(solver=cp.ECOS, warm_start=True)

            latency_ms = (time.perf_counter() - t0) * 1000

            if prob.status not in (cp.OPTIMAL, cp.OPTIMAL_INACCURATE):
                return self._fallback_equal_weight(symbols, R, t0, status="INFEASIBLE")

            weights_arr  = np.clip(omega.value, 0.0, 1.0)
            weights_arr /= weights_arr.sum() + 1e-12
            cvar_val     = float(zeta.value + (1.0 / (S * (1.0 - beta))) *
                                  np.sum(np.maximum(-R @ weights_arr - float(zeta.value), 0.0)))
            var_val      = float(zeta.value)

            result = self._package_result(
                symbols, weights_arr, trade_intents,
                cvar_val, var_val, latency_ms,
                "OPTIMAL" if prob.status == cp.OPTIMAL else "DEGRADED",
            )

        except Exception as exc:
            result = self._fallback_equal_weight(symbols, R, t0, status=f"ERROR:{exc}")

        with _result_lock:
            _last_result.clear()
            _last_result.update(result)

        return result

    # ── Helpers ───────────────────────────────────────────────────────────────
    def _build_scenario_matrix(self, intents: list[dict]) -> np.ndarray:
        """
        Build (S × n) return matrix.
        Uses provided vol_est / expected_ret when available, otherwise
        falls back to a signal-scaled normal distribution.
        """
        S = self.n_scenarios
        n = len(intents)
        rng = np.random.default_rng(seed=42)
        R   = np.zeros((S, n))

        for j, intent in enumerate(intents):
            mu  = float(intent.get("expected_ret", 0.0005 * intent.get("signal_str", 0.5)))
            sig = float(intent.get("vol_est",      0.002))
            direction_sign = 1.0 if intent.get("direction", "BUY") == "BUY" else -1.0
            R[:, j] = direction_sign * rng.normal(mu, sig, S)

        return R

    def _package_result(
        self,
        symbols: list[str],
        weights: np.ndarray,
        intents: list[dict],
        cvar: float,
        var: float,
        latency_ms: float,
        status: str,
    ) -> dict[str, Any]:
        lot_scales = {}
        for sym, w, intent in zip(symbols, weights, intents):
            raw_scale = float(w) * len(symbols)
            lot_scales[sym] = round(float(np.clip(raw_scale, MIN_LOT_SCALE, MAX_LOT_SCALE)), 4)

        return {
            "weights":    {s: round(float(w), 6) for s, w in zip(symbols, weights)},
            "cvar":       round(cvar, 6),
            "var":        round(var, 6),
            "lot_scales": lot_scales,
            "status":     status,
            "latency_ms": round(latency_ms, 2),
            "timestamp":  datetime.now(timezone.utc).strftime("%H:%M:%S UTC"),
            "beta":       self.beta,
            "n_assets":   len(symbols),
        }

    def _fallback_equal_weight(
        self,
        symbols: list[str],
        R: np.ndarray,
        t0: float,
        status: str = "DEGRADED",
    ) -> dict[str, Any]:
        n       = len(symbols)
        weights = np.full(n, 1.0 / n)
        port_r  = R @ weights
        S       = self.n_scenarios
        beta    = self.beta
        sorted_r = np.sort(port_r)
        var_val  = float(-np.quantile(sorted_r, 1 - beta))
        tail     = sorted_r[sorted_r < -var_val]
        cvar_val = float(-tail.mean()) if len(tail) > 0 else var_val
        latency_ms = (time.perf_counter() - t0) * 1000
        return self._package_result(symbols, weights, [], cvar_val, var_val, latency_ms, status)

    @staticmethod
    def _empty_result(status: str, t0: float) -> dict[str, Any]:
        return {
            "weights":    {},
            "cvar":       0.0,
            "var":        0.0,
            "lot_scales": {},
            "status":     status,
            "latency_ms": round((time.perf_counter() - t0) * 1000, 2),
            "timestamp":  datetime.now(timezone.utc).strftime("%H:%M:%S UTC"),
            "beta":       DEFAULT_BETA,
            "n_assets":   0,
        }


# ── Module-level convenience ───────────────────────────────────────────────────
_solver = CvxpyRiskSolver()


def solve_portfolio(trade_intents: list[dict]) -> dict[str, Any]:
    """Module-level shortcut — uses the shared solver instance."""
    return _solver.solve(trade_intents)


def get_last_result() -> dict[str, Any]:
    """Return the most recently computed result without re-solving."""
    with _result_lock:
        return dict(_last_result)


# ── Standalone demo ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    intents = [
        {"symbol": "XAUUSD+", "direction": "BUY",  "base_lot": 0.01, "signal_str": 0.80, "vol_est": 0.003},
        {"symbol": "NAS100",  "direction": "BUY",  "base_lot": 0.02, "signal_str": 0.65, "vol_est": 0.005},
        {"symbol": "GBPUSD+", "direction": "SELL", "base_lot": 0.01, "signal_str": 0.55, "vol_est": 0.002},
    ]
    result = solve_portfolio(intents)
    print("\n── CVXPY Mean-CVaR Result ──────────────────────────────────")
    for k, v in result.items():
        print(f"  {k:15s}: {v}")
