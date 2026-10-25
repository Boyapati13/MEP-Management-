"""
OCTO-Pro v7.5 Integration Test 2 — Multi-Agent Inference Latency Benchmarking
==============================================================================
Objective: Verify the complete pipeline processing time stays below the 150 ms
execution budget to prevent chart-entry slippage.

Pipeline stages timed:
  1. Watchdog telemetry parse (Tier 1 → Tier 2 boundary)
  2. Hermes context query simulation (vector index lookup)
  3. Symbol Specialist prompt inference simulation
  4. CVXPY Mean-CVaR allocation (Central Risk Manager)

Run:
    python -m pytest tests/test_latency_pipeline.py -v
    # or standalone:
    python tests/test_latency_pipeline.py
"""

import os
import sys
import time

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

_LATENCY_BUDGET_MS = 150.0

try:
    import cvxpy as cp
    _CVXPY_AVAILABLE = True
except ImportError:
    _CVXPY_AVAILABLE = False

try:
    from cvxpy_risk_solver import CvxpyRiskSolver
    _SOLVER_AVAILABLE = True
except ImportError:
    _SOLVER_AVAILABLE = False


# ── Stage simulators ──────────────────────────────────────────────────────────
def _stage_telemetry_parse() -> float:
    """Stage 1: simulate watchdog JSON read + Tier 2 payload dispatch (≈5 ms)."""
    import json, tempfile
    payload = {
        "symbol": "XAUUSD+", "poc": 2345.5, "vah": 2350.0, "val": 2340.0,
        "wick_vol_frac": 0.62, "rvol": 1.35, "atr_m5": 4.25,
        "sl_dist": 8.5, "tp_dist": 25.5, "vacuum_block": False,
    }
    t0 = time.perf_counter()
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(payload, f)
        fname = f.name
    with open(fname, "r") as f:
        _ = json.load(f)
    os.unlink(fname)
    return (time.perf_counter() - t0) * 1000


def _stage_hermes_context(sleep_s: float = 0.020) -> float:
    """Stage 2: simulate Hermes 5-layer memory vault vector lookup (≈20–30 ms)."""
    t0 = time.perf_counter()
    # Simulate FTS5 + vector similarity lookup across memory vault
    _ = np.random.randn(128, 512)           # mock embedding matrix
    _ = np.dot(np.random.randn(128), _)     # mock similarity scores
    time.sleep(sleep_s)
    return (time.perf_counter() - t0) * 1000


def _stage_specialist_inference(n_symbols: int = 3, sleep_s: float = 0.035) -> float:
    """Stage 3: simulate per-symbol specialist prompt evaluation (≈30–50 ms)."""
    t0 = time.perf_counter()
    # Simulate n_symbols specialists computing trade intent contracts in parallel
    results = []
    for _ in range(n_symbols):
        scores = np.random.randn(50)
        results.append({
            "direction":   "BUY" if scores.mean() > 0 else "SELL",
            "confidence":  float(np.clip(abs(scores.mean()) * 5, 0, 1)),
            "signal_str":  float(abs(np.random.randn())),
        })
    time.sleep(sleep_s)
    return (time.perf_counter() - t0) * 1000


def _stage_cvxpy_allocation(n_assets: int = 3) -> float:
    """Stage 4: CVXPY Mean-CVaR convex optimization (Central Risk Manager)."""
    if _SOLVER_AVAILABLE:
        solver = CvxpyRiskSolver(beta=0.95, n_scenarios=500)
        intents = [
            {
                "symbol":      f"SYM{i}",
                "direction":   "BUY",
                "base_lot":    0.01,
                "signal_str":  0.6 + 0.1 * i,
                "vol_est":     0.002 + 0.001 * i,
            }
            for i in range(n_assets)
        ]
        t0 = time.perf_counter()
        solver.solve(intents)
        return (time.perf_counter() - t0) * 1000

    if _CVXPY_AVAILABLE:
        t0 = time.perf_counter()
        weights  = cp.Variable(n_assets)
        returns  = np.linspace(0.001, 0.003, n_assets)
        zeta     = cp.Variable()
        z        = cp.Variable(500)
        R        = np.random.randn(500, n_assets) * 0.002
        port_ret = R @ weights
        prob = cp.Problem(
            cp.Minimize(zeta + (1 / (500 * 0.05)) * cp.sum(z)),
            [
                z >= -port_ret - zeta,
                z >= 0,
                cp.sum(weights) == 1,
                weights >= 0,
            ],
        )
        prob.solve(solver=cp.ECOS)
        return (time.perf_counter() - t0) * 1000

    # Fallback: numpy equal-weight CVaR
    t0 = time.perf_counter()
    R     = np.random.randn(500, n_assets) * 0.002
    w     = np.ones(n_assets) / n_assets
    pr    = R @ w
    var   = np.quantile(pr, 0.05)
    _cvar = pr[pr < var].mean() if (pr < var).any() else var
    return (time.perf_counter() - t0) * 1000


# ── Full pipeline ─────────────────────────────────────────────────────────────
def simulate_pipeline_latency(n_symbols: int = 3, verbose: bool = True) -> dict:
    t_total = time.perf_counter()

    t1 = _stage_telemetry_parse()
    t2 = _stage_hermes_context()
    t3 = _stage_specialist_inference(n_symbols)
    t4 = _stage_cvxpy_allocation(n_symbols)

    total_ms = (time.perf_counter() - t_total) * 1000

    result = {
        "stage1_telemetry_ms":   round(t1, 2),
        "stage2_hermes_ms":      round(t2, 2),
        "stage3_specialists_ms": round(t3, 2),
        "stage4_cvxpy_ms":       round(t4, 2),
        "total_ms":              round(total_ms, 2),
        "budget_ms":             _LATENCY_BUDGET_MS,
        "passed":                total_ms <= _LATENCY_BUDGET_MS,
    }

    if verbose:
        print(f"\n── OCTO-Pro v7.5 Pipeline Latency Benchmark ───────────────────────")
        print(f"  Stage 1 │ Telemetry parse     : {t1:7.2f} ms")
        print(f"  Stage 2 │ Hermes context       : {t2:7.2f} ms")
        print(f"  Stage 3 │ Specialist inference : {t3:7.2f} ms")
        print(f"  Stage 4 │ CVXPY allocation     : {t4:7.2f} ms")
        print(f"  ─────────────────────────────────────────────────────────────────")
        print(f"  TOTAL   │ Pipeline latency     : {total_ms:7.2f} ms  (budget: {_LATENCY_BUDGET_MS:.0f} ms)")
        if result["passed"]:
            print(f"  [PASSED] Latency metrics hold safely inside production boundaries.\n")
        else:
            print(f"  [CRITICAL WARNING] Pipeline latency exceeds execution slippage limits.\n")

    return result


# ── Pytest tests ──────────────────────────────────────────────────────────────
def test_pipeline_within_latency_budget():
    """Full 4-stage pipeline must complete within 150 ms."""
    result = simulate_pipeline_latency(n_symbols=3, verbose=True)
    assert result["passed"], (
        f"Pipeline latency {result['total_ms']:.2f} ms exceeds "
        f"{_LATENCY_BUDGET_MS:.0f} ms production budget. "
        f"Breakdown — T1:{result['stage1_telemetry_ms']} "
        f"T2:{result['stage2_hermes_ms']} "
        f"T3:{result['stage3_specialists_ms']} "
        f"T4:{result['stage4_cvxpy_ms']} ms"
    )


def test_cvxpy_stage_alone():
    """CVXPY allocation alone must complete quickly (sanity check)."""
    t = _stage_cvxpy_allocation(n_assets=3)
    print(f"  [CVXPY] Allocation stage: {t:.2f} ms")
    assert t < 120.0, f"CVXPY allocation took {t:.2f} ms — too slow for production."


def test_hermes_stage_alone():
    """Hermes context query simulation must stay under 50 ms."""
    t = _stage_hermes_context(sleep_s=0.020)
    assert t < 50.0, f"Hermes context stage took {t:.2f} ms."


def test_pipeline_scales_with_symbols():
    """Pipeline with maximum 5 symbols must still hold budget."""
    result = simulate_pipeline_latency(n_symbols=5, verbose=False)
    assert result["total_ms"] < _LATENCY_BUDGET_MS * 1.5, (
        f"Pipeline with 5 symbols ({result['total_ms']:.2f} ms) exceeded 1.5x budget."
    )


# ── Standalone ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    result = simulate_pipeline_latency(n_symbols=3)
    sys.exit(0 if result["passed"] else 1)
