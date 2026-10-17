"""
TradingManager — Hierarchical Orchestrator and Martingale Execution Engine
========================================================================
Coordinates trading execution, manages open position tracking, and enforces
symbol-specific Martingale position sizing (doubling lot sizes on consecutive losses)
with persistent state and margin safety guards.
"""

import os
import json
import MetaTrader5 as mt5
from pathlib import Path
from typing import Optional

class TradingManager:
    def __init__(
        self,
        risk_manager,
        magic_number: int = 991206,
        max_martingale_multiplier: float = 16.0,
        consecutive_loss_limit: int = 4
    ):
        """
        Initialize the TradingManager with safety caps and G4 Risk Manager connection.
        """
        self.risk_manager = risk_manager
        self.magic_number = magic_number
        self.max_multiplier = max_martingale_multiplier
        self.consecutive_loss_limit = consecutive_loss_limit
        
        # State tracking: symbol maps (e.g. "EURUSD+" -> 0 consecutive losses)
        self.consecutive_losses = {}
        self.martingale_multipliers = {}
        
        # Persistence path
        self._script_dir = Path(__file__).resolve().parent
        self.state_file = self._script_dir / "live_martingale_state.json"
        
        # Load any existing state from disk
        self.load_state()

    def load_state(self):
        """Loads martingale progression states from disk to ensure persistence."""
        if self.state_file.exists():
            try:
                data = json.loads(self.state_file.read_text(encoding="utf-8"))
                self.consecutive_losses = data.get("consecutive_losses", {})
                self.martingale_multipliers = data.get("martingale_multipliers", {})
                print(f"[TradingManager] Loaded persistent Martingale state from {self.state_file.name}")
            except Exception as e:
                print(f"[TradingManager] [ERROR] Failed to load Martingale state file: {e}")
        
        # Ensure default portfolio symbols are initialized
        default_symbols = ["EURUSD+", "GBPUSD+", "NAS100", "XAUUSD+", "XAUEUR+", "BTCUSD", "CL-OIL"]
        for sym in default_symbols:
            sym_upper = sym.upper()
            if sym_upper not in self.consecutive_losses:
                self.consecutive_losses[sym_upper] = 0
            if sym_upper not in self.martingale_multipliers:
                self.martingale_multipliers[sym_upper] = 1.0

    def save_state(self):
        """Persists martingale progression states back to disk."""
        try:
            data = {
                "consecutive_losses": self.consecutive_losses,
                "martingale_multipliers": self.martingale_multipliers
            }
            self.state_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
        except Exception as e:
            print(f"[TradingManager] [ERROR] Failed to save Martingale state file: {e}")

    def update_on_trade_closed(self, symbol: str, profit: float):
        """
        Analyzes a closed trade and updates Martingale metrics.
        - Loss (profit < 0): Increment consecutive losses and double multiplier.
        - Win (profit >= 0): Reset consecutive losses and multiplier.
        """
        sym_upper = symbol.upper()
        if sym_upper not in self.consecutive_losses:
            self.consecutive_losses[sym_upper] = 0
            self.martingale_multipliers[sym_upper] = 1.0

        if profit < 0:
            self.consecutive_losses[sym_upper] += 1
            # Apply limit safety cap (e.g. limit to 4 consecutive doublings = 16.0x lot size)
            cl = min(self.consecutive_losses[sym_upper], self.consecutive_loss_limit)
            self.martingale_multipliers[sym_upper] = float(2.0 ** cl)
            print(f"[TradingManager] Loss detected for {sym_upper}! Consecutive: {self.consecutive_losses[sym_upper]}. Next lot multiplier: {self.martingale_multipliers[sym_upper]}x")
        else:
            self.consecutive_losses[sym_upper] = 0
            self.martingale_multipliers[sym_upper] = 1.0
            print(f"[TradingManager] Take Profit/Win detected for {sym_upper}. Resetting Martingale lot multiplier back to 1.0x")
            
        self.save_state()

    def get_lot_multiplier(self, symbol: str) -> float:
        """Returns the current Martingale lot multiplier for a symbol."""
        return self.martingale_multipliers.get(symbol.upper(), 1.0)

    def execute_live_order(
        self,
        symbol: str,
        order_type: int,
        entry: float,
        sl: float,
        tp: float,
        base_lot: float,
        gate: dict,
        send_telegram_alert_callback
    ) -> bool:
        """
        Applies G4 Risk Gate and Martingale calculations, validates account margin,
        and submits the transaction request (DEAL or LIMIT) to MetaTrader 5.
        """
        s_info = mt5.symbol_info(symbol)
        if s_info is None:
            print(f"[TradingManager] [ERROR] Symbol {symbol} not found on MT5")
            return False

        # Apply Martingale and G4 risk multipliers
        m_mult = self.get_lot_multiplier(symbol)
        gate_mult = gate.get("lot_mult", 1.0)
        
        # Sizing math
        final_lot = base_lot * gate_mult * m_mult
        
        # Enforce broker volume step and limits
        final_lot = max(s_info.volume_min, min(s_info.volume_max, final_lot))
        step = s_info.volume_step
        final_lot = round(final_lot / step) * step
        final_lot = max(s_info.volume_min, final_lot)
        
        # ── SAFETY GUARD: Free Margin Check ───────────────────────────────────
        account_info = mt5.account_info()
        if account_info is not None:
            free_margin = account_info.margin_free
            margin_required = mt5.order_calc_margin(order_type, symbol, final_lot, entry)
            if margin_required is not None and free_margin > 0:
                pct_required = (margin_required / free_margin) * 100.0
                if pct_required > 20.0:
                    print(f"[TradingManager] [WARNING] Blocked order for {symbol}: Required margin ${margin_required:.2f} is {pct_required:.1f}% of free margin ${free_margin:.2f} (Safety cap 20%)")
                    block_msg = (f"⚠️ *[RISK MARGIN BLOCK]*\n\n"
                                f"*Symbol:* `{symbol}`\n"
                                f"*Required Margin:* `${margin_required:.2f}` ({pct_required:.1f}% of free margin)\n"
                                f"Order rejected for account preservation.")
                    send_telegram_alert_callback(block_msg)
                    return False

        # Determine MT5 order filling modes
        filling_type = mt5.ORDER_FILLING_FOK
        filling_flags = s_info.filling_mode
        if filling_flags & mt5.SYMBOL_FILLING_FOK:
            filling_type = mt5.ORDER_FILLING_FOK
        elif filling_flags & mt5.SYMBOL_FILLING_IOC:
            filling_type = mt5.ORDER_FILLING_IOC
        else:
            filling_type = mt5.ORDER_FILLING_RETURN

        # Map order type to action (DEAL for market orders, LIMIT for pending orders)
        if order_type in [mt5.ORDER_TYPE_BUY, mt5.ORDER_TYPE_SELL]:
            action = mt5.TRADE_ACTION_DEAL
            action_desc = "MARKET"
        elif order_type in [mt5.ORDER_TYPE_BUY_LIMIT, mt5.ORDER_TYPE_SELL_LIMIT]:
            action = mt5.TRADE_ACTION_LIMIT
            action_desc = "PENDING LIMIT"
        else:
            action = mt5.TRADE_ACTION_DEAL
            action_desc = "ORDER"

        request = {
            "action": action,
            "symbol": symbol,
            "volume": final_lot,
            "type": order_type,
            "price": entry,
            "sl": sl,
            "tp": tp,
            "deviation": 20,
            "magic": self.magic_number,
            "comment": f"Octo M{m_mult:.0f}x G{gate_mult:.1f}x",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": filling_type,
        }

        print(f"[TradingManager] Submitting {action_desc} order for {symbol} (Vol={final_lot:.2f}, SL={sl:.5f}, TP={tp:.5f})...")
        res = mt5.order_send(request)
        if res and res.retcode == mt5.TRADE_RETCODE_DONE:
            deal_id = res.deal if action == mt5.TRADE_ACTION_DEAL else res.order
            print(f"[TradingManager] [SUCCESS] Order #{deal_id} executed successfully.")
            
            type_name = "BUY" if order_type == mt5.ORDER_TYPE_BUY else ("SELL" if order_type == mt5.ORDER_TYPE_SELL else ("BUY LIMIT" if order_type == mt5.ORDER_TYPE_BUY_LIMIT else "SELL LIMIT"))
            
            ai_tag = ""
            if gate:
                ai_tag = (f"\n*G4 AI ({gate['mode']}):* `{gate['bias']} "
                          f"{gate['confidence']*100:.0f}%` {gate['telegram_tag']}")
                if gate['mode'] == 'WARN':
                    ai_tag += " _(AI disagrees — check forecast)_"
                elif gate['mode'] == 'SOFT':
                    ai_tag += " _(lot halved — AI conflict)_"
            
            msg = (f"🚀 *[NEW QUANT ORDER EXECUTED]*\n\n"
                   f"*Symbol:* `{symbol}`\n*Type:* `{type_name}`\n"
                   f"*Price:* `{entry:.5f}`\n*Stop Loss:* `{sl:.5f}`\n"
                   f"*Take Profit:* `{tp:.5f}`\n*Lot Size:* `{final_lot:.2f}` (Base={base_lot:.2f}, Gate={gate_mult:.1f}x, Martingale={m_mult:.1f}x)"
                   f"{ai_tag}")
            send_telegram_alert_callback(msg)
            return True
        else:
            err = res.retcode if res else "Unknown"
            print(f"[TradingManager] [ERROR] Order placement failed on MT5. Code: {err}")
            return False
