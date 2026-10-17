#!/usr/bin/env python3
"""
Whale Suite & Robust Plateau — Hybrid Portfolio Automated Live Trading Bot
========================================================================
1. Evaluates Stock Indices and Metals (NAS100, XAUUSD+) on the M15 Pure Volume wick-absorption engine.
2. Evaluates Forex Majors (EURUSD+, GBPUSD+) on the H1 Robust RSI & EMA Plateau (Pass 244) engine.
3. Integrates Economic News Sentinel, 1% safe Lot Sizing, breakeven trailing, and 50% partials.
"""

import sys
import os
import time
import json
import numpy as np
from datetime import datetime, timezone, timedelta
from pathlib import Path
import MetaTrader5 as mt5

# Windows cp1252 terminals can't encode emoji — reconfigure stdout/stderr to UTF-8
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from news_sentinel import NewsSentinel
from macro_sentiment_analyst import MacroSentimentAnalyst
from backtest_whale_engine import calc_poc_and_va
from trading_risk_manager import TradingRiskManager   # G4 TimesFM gate
from trading_manager import TradingManager

# ── TimesFM forecaster import (may not be available — graceful fallback) ──────
try:
    from timesfm_forecaster import TimesFMForecaster as _TFMForecaster
    _TFM_AVAILABLE = True
except ImportError:
    _TFM_AVAILABLE = False
    print("[Bot] [WARN] timesfm_forecaster not found — G4 AI gate will use cached signals only")


# === LOCAL HIGH-FIDELITY INDICATORS ==================================
def calculate_ema(prices, period):
    n = len(prices)
    ema = np.zeros(n)
    if n == 0: return ema
    ema[0] = prices[0]
    alpha = 2.0 / (period + 1.0)
    for i in range(1, n):
        ema[i] = alpha * prices[i] + (1.0 - alpha) * ema[i-1]
    return ema

def calculate_rsi(prices, period):
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

def calculate_atr(highs, lows, closes, period):
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

def calculate_macd(prices, fast=12, slow=26, signal=9):
    ema_fast = calculate_ema(prices, fast)
    ema_slow = calculate_ema(prices, slow)
    macd_line = ema_fast - ema_slow
    signal_line = calculate_ema(macd_line, signal)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram

def calculate_adx(highs, lows, closes, period=14):
    n = len(closes)
    adx = np.zeros(n)
    if n <= period * 2:
        return adx
    
    tr = np.zeros(n)
    plus_dm = np.zeros(n)
    minus_dm = np.zeros(n)
    
    for i in range(1, n):
        up_move = highs[i] - highs[i-1]
        down_move = lows[i-1] - lows[i]
        
        tr[i] = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
        
        if up_move > down_move and up_move > 0:
            plus_dm[i] = up_move
        if down_move > up_move and down_move > 0:
            minus_dm[i] = down_move
            
    atr = calculate_atr(highs, lows, closes, period)
    
    smooth_plus_dm = np.zeros(n)
    smooth_minus_dm = np.zeros(n)
    
    smooth_plus_dm[period] = plus_dm[1:period+1].sum()
    smooth_minus_dm[period] = minus_dm[1:period+1].sum()
    
    for i in range(period + 1, n):
        smooth_plus_dm[i] = smooth_plus_dm[i-1] - (smooth_plus_dm[i-1] / period) + plus_dm[i]
        smooth_minus_dm[i] = smooth_minus_dm[i-1] - (smooth_minus_dm[i-1] / period) + minus_dm[i]
        
    plus_di = 100.0 * (smooth_plus_dm / np.maximum(atr * period, 1e-10))
    minus_di = 100.0 * (smooth_minus_dm / np.maximum(atr * period, 1e-10))
    
    dx = 100.0 * (abs(plus_di - minus_di) / np.maximum(plus_di + minus_di, 1e-10))
    
    adx[period*2] = dx[period:period*2+1].mean()
    for i in range(period*2 + 1, n):
        adx[i] = (adx[i-1] * (period - 1) + dx[i]) / period
        
    return adx

def calculate_vwap(closes, volumes):
    n = len(closes)
    vwap = np.zeros(n)
    if n == 0:
        return vwap
    accum_pv = 0.0
    accum_vol = 0.0
    for i in range(n):
        accum_pv += closes[i] * volumes[i]
        accum_vol += volumes[i]
        vwap[i] = accum_pv / max(accum_vol, 1.0)
    return vwap

def find_swing_levels(highs, lows, lookback=100):
    n = len(highs)
    if n < lookback:
        return float(max(highs)), float(min(lows))
    sub_highs = highs[-lookback:]
    sub_lows = lows[-lookback:]
    return float(max(sub_highs)), float(min(sub_lows))

class HybridTradingBot:
    def __init__(self, magic_number: int = 991206):
        self.magic_number = magic_number
        self.sentinel = NewsSentinel()
        self.macro_analyst = MacroSentimentAnalyst()
        self.risk_pct = 1.0  # Risk exactly 1.0% of active balance per trade
        
        # Portfolio Mappings
        self.forex_symbols = ["EURUSD+", "GBPUSD+"]
        self.volume_symbols = ["NAS100", "XAUUSD+", "BTCUSD", "BTCUSD+"]
        self.all_symbols = self.forex_symbols + self.volume_symbols
        
        # ── G4: TimesFM Risk Manager ──────────────────────────────────────────
        # gate_mode options: "BLOCK" | "SOFT" | "WARN" | "OFF"
        # Change mode at runtime: self.risk_manager.set_mode("BLOCK")
        self.risk_manager = TradingRiskManager(
            gate_mode="SOFT",        # default: halve lot when AI disagrees
            min_confidence=0.65,     # only act on ≥65% AI confidence
            max_signal_age_seconds=600,  # signal expires after 10 min
        )
        
        # ── Trading Manager (Hierarchical Orchestrator with Martingale) ───────
        self.trading_manager = TradingManager(
            risk_manager=self.risk_manager,
            magic_number=self.magic_number
        )
        # Live forecaster (loaded once — heavy model, ~800MB)
        self._tfm_forecaster = None
        if _TFM_AVAILABLE:
            try:
                self._tfm_forecaster = _TFMForecaster()
                print("[Bot] [G4] TimesFM model loaded — AI gate active")
            except Exception as e:
                print(f"[Bot] [G4] TimesFM load failed: {e} — using cached signals only")

        
        # Session configs for volume profiling
        self.sessions = {
            0: {"start": 0, "end": 8, "tol": 75, "lookback": 250, "bins": 40, "fvg_pct": 11.25, "name": "ASIA"},
            1: {"start": 8, "end": 16, "tol": 300, "lookback": 150, "bins": 30, "fvg_pct": 7.5, "name": "LONDON"},
            2: {"start": 13, "end": 21, "tol": 150, "lookback": 300, "bins": 45, "fvg_pct": 7.5, "name": "NY"}
        }
        
        self.state_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "live_bot_state.json")
        self.load_state()

        # Load Telegram and WhatsApp credentials from config/gateway.json
        self.tg_token = None
        self.tg_chat_id = None
        self.wa_enabled = False
        self.wa_allowed_users = None
        self.wa_port = 3005
        self.wa_chat_id = None
        try:
            script_dir = Path(__file__).resolve().parent
            gateway_config_path = script_dir.parent / "config" / "gateway.json"
            if gateway_config_path.exists():
                with open(gateway_config_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                    
                    # Telegram
                    tg_cfg = cfg.get("telegram", {})
                    if tg_cfg.get("enabled", False):
                        self.tg_token = tg_cfg.get("token")
                        self.tg_chat_id = tg_cfg.get("allowed_users")
                        print(f"[Bot] [Telegram] Enabled. Alerts will be sent to user '{self.tg_chat_id}'.")
                        
                    # WhatsApp
                    wa_cfg = cfg.get("whatsapp", {})
                    if wa_cfg.get("enabled", False):
                        self.wa_enabled = True
                        self.wa_allowed_users = wa_cfg.get("allowed_users")
                        self.wa_port = int(wa_cfg.get("port", 3005))
                        if self.wa_allowed_users:
                            # Split and take first user if multiple are configured
                            first_user = self.wa_allowed_users.split(",")[0].strip()
                            
                            # Check if it is a WhatsApp Channel / Newsletter link or code
                            is_newsletter = False
                            invite_code = None
                            if "whatsapp.com/channel/" in first_user or "0029Vb" in first_user:
                                is_newsletter = True
                                invite_code = first_user.split("channel/")[-1].strip() if "channel/" in first_user else first_user
                                
                            if is_newsletter and invite_code:
                                # Try resolving immediately, fallback to lazy resolution on send
                                resolved_jid = self.resolve_whatsapp_newsletter(invite_code)
                                if resolved_jid:
                                    self.wa_chat_id = resolved_jid
                                    print(f"[Bot] [WhatsApp] Enabled. Resolved Channel to JID: '{self.wa_chat_id}'.")
                                else:
                                    print(f"[Bot] [WhatsApp] Enabled. Channel code '{invite_code}' will be dynamically resolved on first alert.")
                            elif any(c.isalpha() for c in first_user):
                                # Try resolving group immediately, fallback to lazy resolution on send
                                resolved_jid = self.resolve_whatsapp_chat(first_user)
                                if resolved_jid:
                                    self.wa_chat_id = resolved_jid
                                    print(f"[Bot] [WhatsApp] Enabled. Resolved chat '{first_user}' to JID: '{self.wa_chat_id}'.")
                                else:
                                    print(f"[Bot] [WhatsApp] Enabled. Chat '{first_user}' will be dynamically resolved on first alert.")
                            else:
                                clean_num = "".join(c for c in first_user if c.isdigit())
                                if clean_num:
                                    self.wa_chat_id = f"{clean_num}@s.whatsapp.net"
                                    print(f"[Bot] [WhatsApp] Enabled. Alerts will be sent to user '{self.wa_chat_id}'.")
                                else:
                                    print(f"[Bot] [WhatsApp] [WARNING] allowed_users '{self.wa_allowed_users}' has no valid name/number. WhatsApp disabled.")
                                    self.wa_enabled = False
                        else:
                            print("[Bot] [WhatsApp] [WARNING] No allowed_users configured. WhatsApp disabled.")
                            self.wa_enabled = False
            else:
                print(f"[Bot] [Alerts] gateway.json config not found at {gateway_config_path}")
        except Exception as e:
            print(f"[Bot] [Alerts] [ERROR] Failed to load alerts config: {e}")

        # Start background WhatsApp inbound commands polling thread
        import threading
        self.wa_inbound_thread = threading.Thread(target=self._poll_whatsapp_commands, daemon=True, name="bot-wa-commands")
        self.wa_inbound_thread.start()

    def load_state(self):
        self.state = {}
        if os.path.exists(self.state_file):
            try:
                with open(self.state_file, "r") as f:
                    self.state = json.load(f)
            except Exception as e:
                print(f"[Bot] [ERROR] Failed to load state file: {e}")

    def save_state(self):
        try:
            with open(self.state_file, "w") as f:
                json.dump(self.state, f, indent=4)
        except Exception as e:
            print(f"[Bot] [ERROR] Failed to save state file: {e}")

    def send_telegram_alert(self, message: str):
        """Sends a real-time trading alert directly to the user's Telegram and WhatsApp."""
        # Always attempt to send via WhatsApp first (independent of Telegram config)
        self.send_whatsapp_alert(message)

        if not self.tg_token or not self.tg_chat_id:
            return
        
        url = f"https://api.telegram.org/bot{self.tg_token}/sendMessage"
        payload = {
            "chat_id": self.tg_chat_id,
            "text": message,
            "parse_mode": "Markdown"
        }
        try:
            import urllib.request
            import json
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=5.0) as response:
                pass
            print(f"[Bot] [Telegram] Alert successfully sent: {message[:60]}...")
        except Exception as e:
            print(f"[Bot] [Telegram] [ERROR] Failed to send alert: {e}")

    def send_whatsapp_alert(self, message: str):
        """Sends a real-time trading alert to the WhatsApp channel via the local bridge.
        Retries JID resolution on every call so a bridge-offline startup never permanently kills alerts."""
        import urllib.request
        import json as _json

        if not self.wa_enabled:
            return

        # ── Step 1: Verify bridge is alive ────────────────────────────────────
        health_url = f"http://127.0.0.1:{self.wa_port}/health"
        try:
            req = urllib.request.Request(health_url, method="GET")
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                h = _json.loads(resp.read().decode("utf-8"))
                if h.get("status") != "connected":
                    print(f"[Bot] [WhatsApp] [WARN] Bridge alive but status='{h.get('status')}' — skipping alert.")
                    return
        except Exception as e:
            print(f"[Bot] [WhatsApp] [ERROR] Bridge not reachable at port {self.wa_port}: {e}")
            return

        # ── Step 2: Resolve channel/chat JID (retry every time until success) ──
        if not self.wa_chat_id and self.wa_allowed_users:
            first_user = self.wa_allowed_users.split(",")[0].strip()
            is_newsletter = "whatsapp.com/channel/" in first_user or "0029Vb" in first_user
            invite_code = None
            if is_newsletter:
                invite_code = first_user.split("channel/")[-1].strip() if "channel/" in first_user else first_user

            if is_newsletter and invite_code:
                resolved_jid = self.resolve_whatsapp_newsletter(invite_code)
                if resolved_jid:
                    self.wa_chat_id = resolved_jid
                    print(f"[Bot] [WhatsApp] ✅ Resolved Channel '{invite_code}' → JID: '{self.wa_chat_id}'")
                else:
                    print(f"[Bot] [WhatsApp] [ERROR] Could not resolve Channel invite '{invite_code}'. Bridge connected but newsletterMetadata failed. Check channel code.")
                    return
            elif any(c.isalpha() for c in first_user):
                resolved_jid = self.resolve_whatsapp_chat(first_user)
                if resolved_jid:
                    self.wa_chat_id = resolved_jid
                    print(f"[Bot] [WhatsApp] ✅ Resolved chat '{first_user}' → JID: '{self.wa_chat_id}'")
                else:
                    print(f"[Bot] [WhatsApp] [ERROR] Could not resolve chat name '{first_user}'. Check spelling.")
                    return
            else:
                clean_num = "".join(c for c in first_user if c.isdigit())
                if clean_num:
                    self.wa_chat_id = f"{clean_num}@s.whatsapp.net"
                    print(f"[Bot] [WhatsApp] ✅ Using direct number JID: '{self.wa_chat_id}'")

        if not self.wa_chat_id:
            print("[Bot] [WhatsApp] [ERROR] wa_chat_id is not set and could not be resolved. Alert dropped.")
            return

        # ── Step 3: Send the alert ─────────────────────────────────────────────
        url = f"http://127.0.0.1:{self.wa_port}/send"
        payload = {"chatId": self.wa_chat_id, "message": message}
        try:
            req = urllib.request.Request(
                url,
                data=_json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=8.0) as response:
                resp_body = _json.loads(response.read().decode("utf-8"))
                if resp_body.get("success"):
                    print(f"[Bot] [WhatsApp] ✅ Alert sent to '{self.wa_chat_id}': {message[:80]}...")
                else:
                    print(f"[Bot] [WhatsApp] [ERROR] Bridge returned failure: {resp_body}")
                    # Reset JID so next call retries resolution in case of stale JID
                    self.wa_chat_id = None
        except Exception as e:
            print(f"[Bot] [WhatsApp] [ERROR] HTTP POST to bridge failed: {e}")
            # Reset JID so next call retries resolution
            self.wa_chat_id = None

    def resolve_whatsapp_newsletter(self, code: str) -> Optional[str]:
        """Queries the local WhatsApp bridge to resolve a newsletter/channel invite code to its JID."""
        import urllib.request
        import json as _json
        url = f"http://127.0.0.1:{self.wa_port}/resolve-newsletter/{code}"
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=15.0) as response:
                res_data = _json.loads(response.read().decode("utf-8"))
                if res_data.get("success"):
                    jid = res_data.get("metadata", {}).get("id")
                    if jid:
                        return jid
                    print(f"[Bot] [WhatsApp] [WARN] resolve-newsletter succeeded but 'id' missing in metadata: {res_data.get('metadata')}")
                else:
                    print(f"[Bot] [WhatsApp] [ERROR] resolve-newsletter returned: {res_data}")
        except Exception as e:
            print(f"[Bot] [WhatsApp] [ERROR] resolve-newsletter call failed: {e}")
        return None

    def resolve_whatsapp_chat(self, name: str) -> Optional[str]:
        """Queries the local WhatsApp bridge to resolve a chat/group name to its JID."""
        import urllib.request
        import urllib.parse
        import json as _json
        encoded_name = urllib.parse.quote(name)
        url = f"http://127.0.0.1:{self.wa_port}/resolve-chat/{encoded_name}"
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=8.0) as response:
                res_data = _json.loads(response.read().decode("utf-8"))
                if res_data.get("success"):
                    return res_data.get("jid")
                print(f"[Bot] [WhatsApp] [ERROR] resolve-chat returned: {res_data}")
        except Exception as e:
            print(f"[Bot] [WhatsApp] [ERROR] resolve-chat call failed: {e}")
        return None


    def _poll_whatsapp_commands(self):
        """Polls the local WhatsApp bridge for incoming commands from the authorized user or channel."""
        import time
        import urllib.request
        import json
        
        # Give the bridge a moment to establish connection
        time.sleep(5)
        
        url = f"http://127.0.0.1:{self.wa_port}/messages"
        print("[Bot] [WhatsApp] Inbound command polling thread active.")
        
        while True:
            if not self.wa_enabled:
                time.sleep(5)
                continue
                
            try:
                req = urllib.request.Request(url, timeout=5.0)
                with urllib.request.urlopen(req) as response:
                    if response.status == 200:
                        messages = json.loads(response.read().decode("utf-8"))
                        for item in messages:
                            sender_id = item.get("senderId", "")
                            body = item.get("body", "").strip()
                            chat_id = item.get("chatId", "")
                            
                            # Verify authorization: matches configured user or comes from target chat/channel
                            is_authorized = False
                            if self.wa_allowed_users:
                                first_user = self.wa_allowed_users.split(",")[0].strip()
                                # Check JID matches or matches raw configured number
                                clean_sender = sender_id.replace("@s.whatsapp.net", "").replace("+", "").strip()
                                clean_config = first_user.replace("+", "").strip()
                                if clean_sender in clean_config or chat_id == self.wa_chat_id or "channel" in clean_config:
                                    is_authorized = True
                            
                            if is_authorized and body:
                                print(f"[Bot] [WhatsApp] [COMMAND] Received: '{body}' from {sender_id}")
                                self.process_whatsapp_command(body, chat_id or sender_id)
            except Exception as e:
                # Silently catch network errors if bridge resets
                pass
                
            time.sleep(2)

    def process_whatsapp_command(self, text: str, target_chat: str):
        """Parses and executes user commands from WhatsApp, sending the response back."""
        import urllib.request
        import urllib.parse
        import json
        
        cmd = text.strip().lower()
        parts = cmd.split()
        if not parts:
            return
            
        action = parts[0]
        response_msg = ""
        
        # 1. HELP / MENU COMMAND
        if action in ["help", "menu", "commands"]:
            response_msg = (
                "⚕ *[OCTO UNIFIED INTERACTIVE COMMANDS]*\n"
                "────────────────────────────\n"
                "You can control OCTO directly from WhatsApp using these commands:\n\n"
                "📈 *Trading Commands:*\n"
                "• `buy <symbol> [lots]` - Open a market BUY position\n"
                "  _Example: buy eurusd 0.02_\n"
                "• `sell <symbol> [lots]` - Open a market SELL position\n"
                "  _Example: sell gold 0.05_\n"
                "• `close <symbol>` - Close active trades on a symbol\n"
                "• `close all` - Close ALL active trades immediately\n\n"
                "📊 *Query Commands:*\n"
                "• `status` / `balance` - Check account balance, equity, and open positions\n"
                "• `sentiment` / `news` - Check geopolitical threat index and macro calendar\n\n"
                "⚙️ *General Personal Assistant Tasks:*\n"
                "• Simply type **ANY general query or task request**! The bot will execute it using the monolithic LangGraph super-agent and reply back directly.\n"
                "  _Example: search for the latest tech news_ or _write a quick python function to calculate Fibonacci_\n\n"
                "ℹ️ _Note: Trade actions use configured dynamic stops and G4 Risk filters._"
            )
            
        # 2. STATUS / ACCOUNT COMMAND
        elif action in ["status", "balance", "account", "positions"]:
            try:
                import MetaTrader5 as mt5
                acc = mt5.account_info()
                if acc is None:
                    response_msg = "❌ *[ERROR]*: Failed to retrieve MT5 account information. Check MT5 connection."
                else:
                    # open positions
                    positions = mt5.positions_get()
                    pos_count = len(positions) if positions is not None else 0
                    pos_text = ""
                    total_pnl = 0.0
                    if pos_count > 0:
                        pos_text = "\n*Open Positions:*\n"
                        for p in positions:
                            total_pnl += p.profit
                            type_name = "BUY" if p.type == mt5.POSITION_TYPE_BUY else "SELL"
                            pos_text += f"• `#{p.ticket}` {p.symbol} {type_name} {p.volume:.2f} Lots (Profit: `{p.profit:+.2f} EUR`)\n"
                    else:
                        pos_text = "\n*Open Positions:* None active."
                        
                    response_msg = (
                        f"📊 *[OCTO-PRO STATUS REPORT]*\n"
                        f"────────────────────────────\n"
                        f"• *Account:* `{acc.login}`\n"
                        f"• *Broker:* `{acc.company}`\n"
                        f"• *Balance:* `{acc.balance:.2f} EUR`\n"
                        f"• *Equity:* `{acc.equity:.2f} EUR`\n"
                        f"• *Free Margin:* `{acc.margin_free:.2f} EUR`\n"
                        f"• *Active Trades:* `{pos_count}` (PnL: `{total_pnl:+.2f} EUR`)\n"
                        f"{pos_text}"
                    )
            except Exception as e:
                response_msg = f"❌ *[ERROR]*: Exception retrieving status: {e}"
                
        # 3. SENTIMENT / NEWS COMMAND
        elif action in ["sentiment", "news", "threats"]:
            try:
                res = self.sentinel.check_risk_status("XAUUSD+")
                events_text = ""
                if res.get("events"):
                    events_text = "\n*Red-Folder Events Today:*\n"
                    for idx, ev in enumerate(res["events"]):
                        events_text += f"{idx+1}. [{ev['date']} @ {ev['time']}] *{ev['currency']}* - {ev['event']}\n"
                else:
                    events_text = "\n*Red-Folder Events Today:* None scheduled."
                    
                response_msg = (
                    f"📰 *[MACRO SENTIMENT & THREAT INDEX]*\n"
                    f"────────────────────────────\n"
                    f"• *Geopolitical Threat:* `{res['geopolitical_risk']}`\n"
                    f"• *Gold Bias:* `{res['macro_bias']}`\n"
                    f"• *Shield Status:* `ARMED` (Auto-blocks trades 20m before Red-Folders)\n"
                    f"{events_text}"
                )
            except Exception as e:
                response_msg = f"❌ *[ERROR]*: Exception retrieving sentiment: {e}"
                
        # 4. BUY / SELL COMMANDS
        elif action in ["buy", "sell"]:
            if len(parts) < 2:
                response_msg = "❌ *[INVALID FORMAT]*: Specify symbol. Example: `buy eurusd`"
            else:
                raw_symbol = parts[1].upper()
                symbol = raw_symbol
                if raw_symbol in ["EURUSD", "GBPUSD", "XAUUSD"]:
                    symbol = raw_symbol + "+"
                    
                lot_size = 0.01  # safe default
                if len(parts) >= 3:
                    try:
                        lot_size = float(parts[2])
                    except ValueError:
                        pass
                        
                order_type = mt5.ORDER_TYPE_BUY if action == "buy" else mt5.ORDER_TYPE_SELL
                
                # Fetch price
                tick = mt5.symbol_info_tick(symbol)
                if tick is None:
                    response_msg = f"❌ *[ERROR]*: Symbol `{symbol}` not found or no quote available."
                else:
                    entry = tick.ask if action == "buy" else tick.bid
                    
                    # Calculate dynamic TP/SL fallback using configured stops
                    stop_points = 300
                    target_points = 600
                    
                    if "XAU" in symbol:
                        stop_points = 500
                        target_points = 1000
                    elif "NAS" in symbol:
                        stop_points = 800
                        target_points = 1600
                        
                    point = mt5.symbol_info(symbol).point
                    sl = entry - (stop_points * point) if action == "buy" else entry + (stop_points * point)
                    tp = entry + (target_points * point) if action == "buy" else entry - (target_points * point)
                    
                    print(f"[Bot] [WhatsApp] [TRADE] Placing interactive {action.upper()} order for {symbol}...")
                    
                    manual_gate = {
                        "mode": "MANUAL_WHATSAPP",
                        "bias": "BULLISH" if action == "buy" else "BEARISH",
                        "confidence": 1.0,
                        "lot_mult": 1.0,
                        "telegram_tag": "💬 *[MANUAL OVERRIDE]*"
                    }
                    
                    success = self.trading_manager.execute_live_order(
                        symbol=symbol,
                        order_type=order_type,
                        entry=entry,
                        sl=sl,
                        tp=tp,
                        base_lot=lot_size,
                        gate=manual_gate,
                        send_telegram_alert_callback=self.send_telegram_alert
                    )
                    if success:
                        response_msg = f"✅ *[TRADE PLACED]*: Successfully opened interactive `{action.upper()}` position on `{symbol}` ({lot_size:.2f} Lots)."
                    else:
                        response_msg = f"❌ *[TRADE FAILED]*: Order rejected by MT5 or Trading Risk Guard."
                        
        # 5. CLOSE COMMAND
        elif action == "close":
            if len(parts) < 2:
                response_msg = "❌ *[INVALID FORMAT]*: Specify symbol or 'all'. Example: `close eurusd`"
            else:
                target = parts[1].upper()
                positions = mt5.positions_get()
                closed_count = 0
                
                if positions is not None and len(positions) > 0:
                    for p in positions:
                        if target == "ALL" or target in p.symbol.upper():
                            close_type = mt5.ORDER_TYPE_SELL if p.type == mt5.POSITION_TYPE_BUY else mt5.ORDER_TYPE_BUY
                            close_price = mt5.symbol_info_tick(p.symbol).bid if p.type == mt5.POSITION_TYPE_BUY else mt5.symbol_info_tick(p.symbol).ask
                            
                            req = {
                                "action": mt5.TRADE_ACTION_DEAL,
                                "symbol": p.symbol,
                                "volume": p.volume,
                                "type": close_type,
                                "position": p.ticket,
                                "price": close_price,
                                "deviation": 20,
                                "magic": self.magic_number,
                                "comment": "WhatsApp Close",
                                "type_time": mt5.ORDER_TIME_GTC,
                                "type_filling": mt5.ORDER_FILLING_FOK
                            }
                            res = mt5.order_send(req)
                            if res and res.retcode == mt5.TRADE_RETCODE_DONE:
                                closed_count += 1
                                
                    if closed_count > 0:
                        response_msg = f"✅ *[CLOSED SUCCESSFULLY]*: Closed `{closed_count}` active positions matching `{target}`."
                    else:
                        response_msg = f"ℹ️ *[INFO]*: No active positions found matching `{target}`."
                else:
                    response_msg = "ℹ️ *[INFO]*: No active positions to close."
                    
        else:
            # Route general queries directly to the monolithic personal assistant agent (DeerFlow LangGraph)
            print(f"[Bot] [WhatsApp] [ASSISTANT] Routing general task query to DeerFlow: '{text}'...")
            try:
                # Send a quick "thinking" status update to WhatsApp so the user knows it's being worked on
                url = f"http://127.0.0.1:{self.wa_port}/send"
                status_payload = {
                    "chatId": target_chat,
                    "message": "⚙ *[OCTO ASSISTANT]*: Processing your task via LangGraph... 🧠"
                }
                try:
                    status_req = urllib.request.Request(
                        url,
                        data=json.dumps(status_payload).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST"
                    )
                    with urllib.request.urlopen(status_req, timeout=3.0) as _:
                        pass
                except Exception:
                    pass
                
                # Import deerflow_bridge dynamically
                import deerflow_bridge
                
                # Execute general query using the monolithic LangGraph client
                # We use the sender's JID or group JID as the session ID to maintain persistent conversation history!
                session_id = target_chat.replace("@s.whatsapp.net", "").replace("@newsletter", "").strip()
                ans = deerflow_bridge.chat(text, session_id=session_id)
                
                response_msg = f"🧠 *[OCTO ASSISTANT RESPONSE]*\n────────────────────────────\n{ans}"
            except Exception as e:
                response_msg = f"❌ *[OCTO ASSISTANT ERROR]*: Failed to process task: {e}"
            
        # Send response back to the target WhatsApp group/chat/channel
        if response_msg:
            url = f"http://127.0.0.1:{self.wa_port}/send"
            payload = {
                "chatId": target_chat,
                "message": response_msg
            }
            try:
                req = urllib.request.Request(
                    url,
                    data=json.dumps(payload).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                with urllib.request.urlopen(req, timeout=5.0) as response:
                    pass
            except Exception as e:
                print(f"[Bot] [WhatsApp] Failed to send command reply: {e}")

    def execute_live_order(self, symbol: str, order_type: int, entry: float, sl: float, tp: float, lot: float, gate: dict = None):
        """Executes a live market order (BUY or SELL) on MetaTrader 5."""
        s_info = mt5.symbol_info(symbol)
        if s_info is None:
            return
            
        filling_type = mt5.ORDER_FILLING_FOK
        filling_flags = s_info.filling_mode
        if filling_flags & mt5.SYMBOL_FILLING_FOK:
            filling_type = mt5.ORDER_FILLING_FOK
        elif filling_flags & mt5.SYMBOL_FILLING_IOC:
            filling_type = mt5.ORDER_FILLING_IOC
        else:
            filling_type = mt5.ORDER_FILLING_RETURN

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": lot,
            "type": order_type,
            "price": entry,
            "sl": sl,
            "tp": tp,
            "deviation": 20,
            "magic": self.magic_number,
            "comment": "Plateau Market Order",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": filling_type,
        }
        
        print(f"[Bot] Executing live MARKET order for {symbol} (Type={order_type}, Lot={lot:.2f}, Price={entry:.5f})...")
        res = mt5.order_send(request)
        if res and res.retcode == mt5.TRADE_RETCODE_DONE:
            print(f"[Bot] [SUCCESS] Market order #{res.deal} executed successfully.")
            type_name = "BUY" if order_type == mt5.ORDER_TYPE_BUY else "SELL"
            # Build G4 AI tag for Telegram
            ai_tag = ""
            if gate:
                ai_tag = (f"\n*G4 AI ({gate['mode']}):* `{gate['bias']} "
                          f"{gate['confidence']*100:.0f}%` {gate['telegram_tag']}")
                if gate['mode'] == 'WARN':
                    ai_tag += " _(AI disagrees — check forecast)_"
                elif gate['mode'] == 'SOFT':
                    ai_tag += " _(lot halved — AI conflict)_"
            msg = (f"\U0001f680 *[NEW MARKET ORDER EXECUTED]*\n\n"
                   f"*Symbol:* `{symbol}`\n*Type:* `{type_name}`\n"
                   f"*Price:* `{entry:.5f}`\n*Stop Loss:* `{sl:.5f}`\n"
                   f"*Take Profit:* `{tp:.5f}`\n*Lot Size:* `{lot:.2f}`"
                   f"{ai_tag}")
            self.send_telegram_alert(msg)
        else:
            err = res.retcode if res else "Unknown"
            print(f"[Bot] [ERROR] Market order failed. Code: {err}")

    def initialize_mt5(self) -> bool:
        if not mt5.initialize():
            exe_path = r"C:\Program Files\MetaTrader 5\terminal64.exe"
            import os
            if os.path.exists(exe_path) and mt5.initialize(path=exe_path):
                pass
            else:
                print(f"[Bot] [ERROR] MT5 connection failed: {mt5.last_error()}")
                return False
        
        # Select all symbols
        for sym in self.all_symbols:
            mt5.symbol_select(sym, True)
            
        print("[Bot] [SUCCESS] Hybrid portfolio bot connected to live MT5 terminal.")
        return True

    def detect_broker_offset(self, symbol: str) -> int:
        tick = mt5.symbol_info_tick(symbol)
        if tick:
            server_time = tick.time
            utc_time = int(datetime.now(timezone.utc).timestamp())
            if abs(utc_time - server_time) > 3 * 3600:
                return 3
            return round((server_time - utc_time) / 3600.0)
        return 3

    def get_malta_hour(self, offset: int) -> int:
        """Returns the LOCAL session hour adjusted for broker server offset vs Malta UTC+2.
        
        Malta is UTC+2. If broker offset=3 (UTC+3), we subtract 1 to convert broker
        server hours back to Malta session hours for correct session gating.
        """
        utc_time = datetime.now(timezone.utc)
        malta_time = utc_time + timedelta(hours=2)  # Malta is always UTC+2 (EET)
        return malta_time.hour

    def check_active_positions(self, symbol: str) -> bool:
        positions = mt5.positions_get(symbol=symbol, magic=self.magic_number)
        return len(positions) > 0 if positions is not None else False

    def check_pending_orders(self, symbol: str) -> bool:
        orders = mt5.orders_get(symbol=symbol, magic=self.magic_number)
        return len(orders) > 0 if orders is not None else False

    def get_asia_session_range(self, symbol: str) -> tuple[Optional[float], Optional[float]]:
        # Fetch last 96 completed M15 candles (24 hours of data)
        rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M15, 1, 96)
        if rates is None or len(rates) == 0:
            return None, None
            
        asia_highs = []
        asia_lows = []
        
        # Iterate backwards to find the most recent completed or active Asia session
        in_session = False
        for r in reversed(rates):
            bar_utc = datetime.fromtimestamp(int(r["time"]), tz=timezone.utc)
            bar_malta = bar_utc + timedelta(hours=2) # Malta is UTC+2
            is_asia = (0 <= bar_malta.hour < 8)
            
            if is_asia:
                in_session = True
                asia_highs.append(float(r["high"]))
                asia_lows.append(float(r["low"]))
            elif in_session:
                # We were in Asia session and now we exited it (moving backwards in time)
                # So we have captured the entire most recent Asia session!
                break
                
        if len(asia_highs) == 0:
            return None, None
            
        return max(asia_highs), min(asia_lows)


    def calculate_lot_size(self, symbol: str, risk_amount: float, sl_dist_points: float) -> float:
        s_info = mt5.symbol_info(symbol)
        if s_info is None:
            return 0.01
        trade_size = s_info.trade_contract_size
        point = s_info.point
        sl_dist_price = sl_dist_points * point
        if sl_dist_price <= 0:
            return 0.01
        lot = risk_amount / (trade_size * sl_dist_price)
        lot = max(s_info.volume_min, min(s_info.volume_max, lot))
        step = s_info.volume_step
        lot = round(lot / step) * step
        return max(0.01, lot)

    def manage_active_positions(self):
        """Monitors active trades: takes 50% partial profit at 1:1 R:R and adjusts Stop Loss to breakeven."""
        positions = mt5.positions_get(magic=self.magic_number)
        if positions is None:
            return
            
        active_tickets = {str(p.ticket) for p in positions}
        state_tickets = list(self.state.keys())
        state_changed = False
        
        # Clean up tracked tickets that are no longer active
        for t_str in state_tickets:
            if t_str.isdigit() and t_str not in active_tickets:
                closed_data = self.state[t_str]
                if isinstance(closed_data, dict):
                    symbol = closed_data.get("symbol", "GOLD")
                    print(f"[Bot] [INFO] Position #{t_str} has been closed by market. Removing from tracking state.")
                    
                    history_deal = ""
                    try:
                        from_time = datetime.now() - timedelta(hours=1)
                        history = mt5.history_deals_get(from_date=from_time)
                        if history:
                            for d in history:
                                if d.position_id == int(t_str):
                                    profit = d.profit
                                    comment = d.comment
                                    is_sl = "sl" in comment.lower() or (profit < 0)
                                    is_tp = "tp" in comment.lower() or (profit > closed_data.get("initial_lot", 0.1) * 10)
                                    status_msg = "🔴 Stop Loss Hit" if profit < 0 else "🟢 Take Profit Hit"
                                    history_deal = f"\n*Status:* `{status_msg}`\n*PnL:* `${profit:.2f}`"
                                    
                                    # Update hierarchical TradingManager Martingale progression on trade closed!
                                    self.trading_manager.update_on_trade_closed(symbol, profit)
                                    break
                    except Exception as e:
                        print(f"[Bot] Failed to inspect closed position history: {e}")
                        
                    msg = f"📉 *[TRADE CLOSED]*\n\n*Symbol:* `{symbol}`\n*Position:* `#{t_str}`{history_deal}"
                    self.send_telegram_alert(msg)
                    
                    del self.state[t_str]
                    state_changed = True
                
        # Audit each active position
        for p in positions:
            t_str = str(p.ticket)
            symbol = p.symbol
            s_info = mt5.symbol_info(symbol)
            if s_info is None:
                continue
                
            point = s_info.point
            current_price = p.price_current
            open_price = p.price_open
            
            if t_str not in self.state:
                self.state[t_str] = {
                    "symbol": symbol,
                    "entry_price": open_price,
                    "initial_sl": p.sl,
                    "initial_tp": p.tp,
                    "initial_lot": p.volume,
                    "partial_taken": False,
                    "sl_to_50pct": False,   # Stage 1: SL moved to +50% profit at 1:1 R:R
                    "sl_to_be": False       # Stage 2: SL moved to full breakeven at 1.5:1 R:R
                }
                state_changed = True
                
            trade_data = self.state[t_str]
            initial_sl = trade_data["initial_sl"]
            
            if not initial_sl or initial_sl <= 0:
                continue
                
            sl_distance = abs(open_price - initial_sl)
            if sl_distance <= 0:
                continue
                
            is_buy = (p.type == mt5.POSITION_TYPE_BUY)
            profit_distance = (current_price - open_price) if is_buy else (open_price - current_price)
            
            # ── Stage 1: Price reaches 1:1 R:R → move SL to lock 50% profit ──────────
            if profit_distance >= sl_distance and not trade_data["sl_to_50pct"]:
                new_sl_50 = open_price + (sl_distance * 0.5) if is_buy else open_price - (sl_distance * 0.5)
                request = {
                    "action": mt5.TRADE_ACTION_SLTP,
                    "position": p.ticket,
                    "sl": new_sl_50,
                    "tp": p.tp,
                }
                print(f"[Bot] [INFO] #{p.ticket} ({symbol}) reached 1:1 R:R. Trailing SL to lock 50% profit...")
                res = mt5.order_send(request)
                if res and res.retcode == mt5.TRADE_RETCODE_DONE:
                    trade_data["sl_to_50pct"] = True
                    state_changed = True
                    print(f"[Bot] [SUCCESS] SL moved to +50% profit for #{p.ticket} → {new_sl_50:.5f}")
                    msg = (f"🛡️ *[SL STAGE 1: +50% PROFIT LOCKED]*\n\n"
                           f"*Symbol:* `{symbol}`\n*Position:* `#{p.ticket}`\n"
                           f"*New SL:* `{new_sl_50:.5f}` (Trade is now risk-free + 50% banked!)")
                    self.send_telegram_alert(msg)
                else:
                    err = res.retcode if res else "Unknown"
                    print(f"[Bot] [ERROR] Stage 1 SL trail failed: {err}")

            # ── Stage 2: Price reaches 1.5:1 R:R → move SL to full breakeven ─────────
            if profit_distance >= sl_distance * 1.5 and not trade_data["sl_to_be"]:
                new_sl_be = open_price  # Full breakeven — no loss possible
                request = {
                    "action": mt5.TRADE_ACTION_SLTP,
                    "position": p.ticket,
                    "sl": new_sl_be,
                    "tp": p.tp,
                }
                print(f"[Bot] [INFO] #{p.ticket} ({symbol}) reached 1.5:1 R:R. Moving SL to full breakeven...")
                res = mt5.order_send(request)
                if res and res.retcode == mt5.TRADE_RETCODE_DONE:
                    trade_data["sl_to_be"] = True
                    state_changed = True
                    print(f"[Bot] [SUCCESS] SL moved to full breakeven (0 risk) for #{p.ticket}")
                    msg = (f"🛡️ *[SL STAGE 2: FULL BREAKEVEN]*\n\n"
                           f"*Symbol:* `{symbol}`\n*Position:* `#{p.ticket}`\n"
                           f"*SL:* `{new_sl_be:.5f}` (Zero risk — riding free!)")
                    self.send_telegram_alert(msg)
                else:
                    err = res.retcode if res else "Unknown"
                    print(f"[Bot] [ERROR] Stage 2 SL trail failed: {err}")

            # ── Partial Close: 50% at 1:1 R:R (only when SL stage 1 is confirmed) ───
            if profit_distance >= sl_distance and trade_data["sl_to_50pct"] and not trade_data["partial_taken"] and p.volume > s_info.volume_min:
                    half_vol = p.volume * 0.5
                    step = s_info.volume_step
                    half_vol = round(half_vol / step) * step
                    half_vol = max(s_info.volume_min, half_vol)
                    
                    if half_vol < p.volume:
                        close_type = mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY
                        close_price = s_info.bid if is_buy else s_info.ask
                        
                        filling_type = mt5.ORDER_FILLING_FOK
                        filling_flags = s_info.filling_mode
                        if filling_flags & mt5.SYMBOL_FILLING_FOK:
                            filling_type = mt5.ORDER_FILLING_FOK
                        elif filling_flags & mt5.SYMBOL_FILLING_IOC:
                            filling_type = mt5.ORDER_FILLING_IOC
                        else:
                            filling_type = mt5.ORDER_FILLING_RETURN

                        request = {
                            "action": mt5.TRADE_ACTION_DEAL,
                            "symbol": symbol,
                            "volume": half_vol,
                            "type": close_type,
                            "position": p.ticket,
                            "price": close_price,
                            "deviation": 20,
                            "magic": self.magic_number,
                            "comment": "Portfolio Partial Close",
                            "type_time": mt5.ORDER_TIME_GTC,
                            "type_filling": filling_type,
                        }
                        
                        print(f"[Bot] [INFO] Position #{p.ticket} ({symbol}) reached 1:1 R:R. Closing 50% partial profit...")
                        res = mt5.order_send(request)
                        if res and res.retcode == mt5.TRADE_RETCODE_DONE:
                            trade_data["partial_taken"] = True
                            state_changed = True
                            print(f"[Bot] [SUCCESS] Closed 50% partial for #{p.ticket}.")
                            msg = f"💰 *[PARTIAL PROFIT CLOSED]*\n\n*Symbol:* `{symbol}`\n*Position:* `#{p.ticket}`\n*Closed Volume:* `{half_vol:.2f}` lots\n*Price:* `{close_price:.5f}`\n(50% profit banked!)"
                            self.send_telegram_alert(msg)
                        else:
                            err = res.retcode if res else "Unknown"
                            print(f"[Bot] [ERROR] Failed to close partial: {err}")
                            
        if state_changed:
            self.save_state()

    def manage_pending_limit_orders(self):
        """Auto-cancels pending volume matrix limit orders if the session has ended or price hit target TP first."""
        orders = mt5.orders_get(magic=self.magic_number)
        if orders is None:
            return
            
        for o in orders:
            symbol = o.symbol
            # Skip if this is a market order or not under volume engine
            if symbol not in self.volume_symbols:
                continue
                
            tick = mt5.symbol_info_tick(symbol)
            if tick is None:
                continue
                
            current_price = tick.last if tick.last > 0 else tick.bid
            
            # Retrieve active session limits
            offset = self.detect_broker_offset(symbol)
            malta_hour = self.get_malta_hour(offset)
            
            active_s = None
            for s_idx, p in self.sessions.items():
                is_in = False
                if p["start"] <= p["end"]:
                    is_in = (malta_hour >= p["start"] and malta_hour < p["end"])
                else:
                    is_in = (malta_hour >= p["start"] or malta_hour < p["end"])
                if is_in:
                    active_s = p
                    break
                    
            cancel_order = False
            # Cancel if session ended
            if active_s is None:
                cancel_order = True
            else:
                # Cancel if price already hit Take Profit before execution
                is_buy_limit = (o.type == mt5.ORDER_TYPE_BUY_LIMIT)
                if is_buy_limit and current_price >= o.tp:
                    cancel_order = True
                elif not is_buy_limit and current_price <= o.tp:
                    cancel_order = True
                    
            if cancel_order:
                request = {
                    "action": mt5.TRADE_ACTION_REMOVE,
                    "order": o.ticket,
                }
                print(f"[Bot] [INFO] Canceling orphaned volume limit order #{o.ticket} on {symbol} (Target hit or session closed)...")
                mt5.order_send(request)

    def refresh_macro_sentiment(self):
        """Runs the live geopolitical macro sentiment crawler to update current risk biases."""
        try:
            print("[Bot] [Senior Quant] Querying live macroeconomic and geopolitical risk feeds...")
            self.macro_analyst.analyze()
        except Exception as e:
            print(f"[Bot] [Senior Quant] [ERROR] Geopolitical crawler failed: {e}")

    def refresh_timesfm_forecasts(self):
        """Run TimesFM inference for all watchlist symbols. Calls forecast_portfolio() so
        each symbol gets its own per-symbol signal file (timesfm_{symbol}.json), which
        is what trading_risk_manager._read_signal() looks for. This fixes the bug where
        all symbols were overwriting the same timesfm_signal.json file.
        """
        if self._tfm_forecaster is None:
            return   # model not loaded — rely on cached signal files
        print("[Bot] [G4] Refreshing TimesFM forecasts for full portfolio...")
        # Forex symbols use H1 (256 bars = ~10 days of context)
        # Volume/metal symbols use M15 (128 bars = ~32 hours of context)
        tf_context_map = {
            "EURUSD+": ("H1",  256),
            "GBPUSD+": ("H1",  256),
            "NAS100":  ("M15", 128),
            "XAUUSD+": ("M15", 128),
        }
        for symbol in self.all_symbols:
            tf, ctx = tf_context_map.get(symbol, ("H1", 256))
            try:
                result = self._tfm_forecaster.get_forecast(
                    symbol=symbol, timeframe=tf, horizon=8,
                    context_bars=ctx, write_signal=True
                )
                # Also write per-symbol file so risk manager can find it by symbol name
                self._tfm_forecaster._write_per_symbol_signal(result)
                print(f"[Bot] [G4] {symbol} → {result.bias.value} {result.confidence:.0%} ({tf})")
            except Exception as e:
                print(f"[Bot] [G4] Forecast error for {symbol}: {e}")
        print("[Bot] [G4] Portfolio forecasts updated — all per-symbol files written.")

    def auto_tune_parameters(self):
        """Executes the daily parameter optimization sweep for all active symbols to adapt to shifting market conditions."""
        print("[Bot] [Adaptive AI] Triggering automated daily parameter optimization sweep...")
        try:
            from whale_markov_pure_volume_optimizer import WhaleMarkovPureVolumeOptimizer, summarize_simulation
            import MetaTrader5 as mt5
        except ImportError as e:
            print(f"[Bot] [Adaptive AI] [ERROR] Failed to import optimizer modules: {e}")
            return
            
        symbols_to_tune = ["GBPUSD+", "EURUSD+", "XAUUSD+"]
        
        for symbol in symbols_to_tune:
            print(f"[Bot] [Adaptive AI] Re-optimizing parameters for {symbol}...")
            opt = WhaleMarkovPureVolumeOptimizer(symbol=symbol, m5_candle_count=5000)
            
            opt.broker_gmt_offset = self.detect_broker_offset(symbol)
            s_info = mt5.symbol_info(symbol)
            if s_info is None:
                alt = symbol.replace("+", "")
                s_info = mt5.symbol_info(alt)
                if s_info: opt.symbol = alt
            opt.point_size = s_info.point if s_info else 0.00001
            
            # Copy rates
            m5_rates = mt5.copy_rates_from_pos(opt.symbol, mt5.TIMEFRAME_M5, 0, opt.candle_count + 500)
            m15_rates = mt5.copy_rates_from_pos(opt.symbol, mt5.TIMEFRAME_M15, 0, int(opt.candle_count / 3) + 1000)
            d1_rates = mt5.copy_rates_from_pos(opt.symbol, mt5.TIMEFRAME_D1, 0, int(opt.candle_count / 200) + 100)
            
            if m5_rates is None or m15_rates is None or d1_rates is None:
                print(f"[Bot] [Adaptive AI] [Warning] Failed to copy rates for {symbol}. Skipping auto-tune.")
                continue
                
            opt.m15_closes = np.array([float(x["close"]) for x in m15_rates])
            opt.m15_times = [datetime.fromtimestamp(int(x["time"]), tz=timezone.utc) for x in m15_rates]
            
            opt.m5_candles = []
            for r in m5_rates:
                opt.m5_candles.append({
                    "time": datetime.fromtimestamp(int(r["time"]), tz=timezone.utc),
                    "open": float(r["open"]), "high": float(r["high"]), "low": float(r["low"]), "close": float(r["close"]), "volume": int(r["tick_volume"])
                })
                
            t_start = opt.m5_candles[0]["time"]
            t_end = opt.m5_candles[-1]["time"] + timedelta(minutes=5)
            
            d1_times = [datetime.fromtimestamp(int(x["time"]), tz=timezone.utc).date() for x in d1_rates]
            opt.d1_high_cache = {d1_times[j]: float(d1_rates[j]["high"]) for j in range(len(d1_rates))}
            opt.d1_low_cache = {d1_times[j]: float(d1_rates[j]["low"]) for j in range(len(d1_rates))}
            
            m1_rates = mt5.copy_rates_range(opt.symbol, mt5.TIMEFRAME_M1, t_start, t_end)
            if m1_rates is None or len(m1_rates) == 0:
                print(f"[Bot] [Adaptive AI] [Warning] Failed to load M1 ticks for {symbol}. Skipping.")
                continue
                
            opt.m1_groups = {}
            for r in m1_rates:
                m1_t = datetime.fromtimestamp(int(r["time"]), tz=timezone.utc)
                m5_t = m1_t - timedelta(minutes=m1_t.minute % 5, seconds=m1_t.second)
                if m5_t not in opt.m1_groups:
                     opt.m1_groups[m5_t] = []
                opt.m1_groups[m5_t].append({
                     "time": m1_t, "open": float(r["open"]), "high": float(r["high"]), "low": float(r["low"]), "close": float(r["close"]), "volume": int(r["tick_volume"])
                })
                 
            opt.m5_candles = opt.m5_candles[-opt.candle_count:]
             
            base_signals = opt.precalculate_pure_volume_signals()
            if len(base_signals) < 5:
                print(f"[Bot] [Adaptive AI] [Warning] Too few breakout signals ({len(base_signals)}) for {symbol}. Skipping auto-tune.")
                continue
                 
            markov_windows = [10, 15, 20, 25]
            markov_thresholds = [0.0005, 0.001, 0.0015, 0.002, 0.003]
            markov_hedge_thresholds = [0.10, 0.15, 0.20]
             
            best_wr = 0.0
            best_params = {}
             
            for w in markov_windows:
                for t in markov_thresholds:
                    for h in markov_hedge_thresholds:
                        res = opt.run_simulation_fast(base_signals, use_markov_filter=True, use_markov_hedging=True, markov_window=w, markov_threshold=t, markov_hedge_threshold=h)
                        summ = summarize_simulation(res, opt.initial_balance)
                         
                        trades_per_day = summ["trades"] / 17.0
                        if trades_per_day >= 0.5:
                            wr = summ["win_rate"]
                            is_better = False
                            if wr > best_wr:
                                is_better = True
                            elif abs(wr - best_wr) < 0.01 and summ["profit_factor"] > best_params.get("pf", 0.0):
                                is_better = True
                                 
                            if is_better:
                                best_wr = wr
                                best_params = {
                                    "window": w, "threshold": t, "hedge_threshold": h, "win_rate": wr, "pf": summ["profit_factor"], "pnl_pct": summ["net_profit_pct"], "trades": summ["trades"]
                                }
                                 
            if best_params:
                print(f"[Bot] [Adaptive AI] [SUCCESS] Optimized {symbol}: Window={best_params['window']}, Threshold={best_params['threshold']:.4f}, Hedge={best_params['hedge_threshold']:.2f}")
                 
                cfg_data = {
                    "last_updated": datetime.now(timezone.utc).isoformat(),
                    "symbol": symbol,
                    "window": best_params["window"],
                    "threshold": best_params["threshold"],
                    "hedge_threshold": best_params["hedge_threshold"],
                    "win_rate": best_params["win_rate"],
                    "pf": best_params["pf"],
                    "net_profit_pct": best_params["pnl_pct"]
                }
                 
                local_cfg_path = Path(__file__).resolve().parent / "config" / f"optimal_parameters_{symbol}.json"
                local_cfg_path.parent.mkdir(parents=True, exist_ok=True)
                try:
                    local_cfg_path.write_text(json.dumps(cfg_data, indent=4), encoding="utf-8")
                except Exception:
                    pass
                     
                common_dir = Path(os.environ.get("APPDATA", "")) / "MetaQuotes" / "Terminal" / "Common" / "Files"
                if common_dir.exists():
                    common_cfg_path = common_dir / f"optimal_parameters_{symbol}.json"
                    try:
                        common_cfg_path.write_text(json.dumps(cfg_data, indent=4), encoding="utf-8")
                    except Exception:
                        pass
                         
                msg = (f"\U0001f3af *[ADAPTIVE AI: PARAMETER RE-OPTIMIZED]*\n\n"
                       f"*Symbol:* `{symbol}`\n"
                       f"*New Optimal Window:* `{best_params['window']} bars`\n"
                       f"*New Optimal Threshold:* `{best_params['threshold']:.4f}`\n"
                       f"*New Optimal Hedge:* `{best_params['hedge_threshold']:.2f}`\n"
                       f"*Expected Win Rate:* `{best_params['win_rate']:.2f}%`\n"
                       f"*Historical Profit Factor:* `{best_params['pf']:.2f}`\n"
                       f"_(Adaptive parameter hot-loaded cleanly!)_")
                self.send_telegram_alert(msg)
                 
        self.state["last_tuning_time"] = datetime.now(timezone.utc).isoformat()
        self.save_state()
        print("[Bot] [Adaptive AI] Dynamic parameter self-tuning completed.")

    def evaluate_live_market(self):
        self.manage_active_positions()
        self.manage_pending_limit_orders()
        
        acc_info = mt5.account_info()
        if not acc_info:
            return
        balance = acc_info.balance
        risk_cash = balance * (self.risk_pct / 100.0)
        
        # === A. EVALUATE FOREX MAJOR (Robust H1 RSI & EMA Plateau) ==========
        for symbol in self.forex_symbols:
            if self.check_active_positions(symbol):
                continue
                
            # Check News Shield
            news = self.sentinel.check_risk_status(symbol)
            if news["status"] == "THREAT_DETECTED":
                continue
                
            rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_H1, 0, 200)
            if rates is None or len(rates) < 150:
                continue
                
            closes = np.array([float(x["close"]) for x in rates])
            highs = np.array([float(x["high"]) for x in rates])
            lows = np.array([float(x["low"]) for x in rates])
            volumes = np.array([float(x["tick_volume"]) for x in rates])
            
            s_info = mt5.symbol_info(symbol)
            point = s_info.point
            
            # Calculate Indicators
            ema25 = calculate_ema(closes, 25)
            ema135 = calculate_ema(closes, 135)
            rsi14 = calculate_rsi(closes, 14)
            atr14 = calculate_atr(highs, lows, closes, 14)
            
            # Calculate new advanced indicators
            macd_line, signal_line, macd_hist = calculate_macd(closes, 12, 26, 9)
            adx = calculate_adx(highs, lows, closes, 14)
            
            # Checks completed bar 1 indices
            ema25_1 = ema25[-2]
            ema135_1 = ema135[-2]
            rsi_1 = rsi14[-2]
            rsi_2 = rsi14[-3]
            atr_1 = atr14[-2]
            
            macd_l1 = macd_line[-2]
            macd_s1 = signal_line[-2]
            macd_h1 = macd_hist[-2]
            adx_1 = adx[-2] if len(adx) > 28 else 0.0
            
            # Confluence Logic
            macd_buy_align = (macd_l1 > macd_s1) or (macd_h1 > 0.0)
            macd_sell_align = (macd_l1 < macd_s1) or (macd_h1 < 0.0)
            
            # Trend strength filter
            # ADX lower bound (>= 20) confirms a real trend exists before entry
            # ADX upper bound (>= 30) confirms we are not fighting an extreme trend
            has_trend = (adx_1 >= 20.0)             # Min trend strength needed
            strong_trend = (adx_1 >= 30.0)           # Strong trend (may block counter-trend)
            major_bull = (closes[-2] > ema135_1)
            major_bear = (closes[-2] < ema135_1)
            
            buy_trend_ok  = has_trend and not (strong_trend and major_bear)
            sell_trend_ok = has_trend and not (strong_trend and major_bull)
            
            buy_sig  = (ema25_1 > ema135_1) and (rsi_2 <= 40.0 and rsi_1 > 40.0) and macd_buy_align  and buy_trend_ok
            sell_sig = (ema25_1 < ema135_1) and (rsi_2 >= 60.0 and rsi_1 < 60.0) and macd_sell_align and sell_trend_ok
            
            # In live, check if we already traded this H1 bar time to prevent double entries
            last_bar_time = int(rates[-2]["time"])
            state_key = f"last_forex_bar_{symbol}"
            
            if state_key in self.state and self.state[state_key] == last_bar_time:
                # Already processed bar open
                continue
                
            if buy_sig or sell_sig:
                direction = "BUY" if buy_sig else "SELL"
                entry = s_info.ask if buy_sig else s_info.bid
                sl_dist_points = (4.0 * atr_1) / point
                
                if sl_dist_points > 0:
                    lot = self.calculate_lot_size(symbol, risk_cash, sl_dist_points)
                    sl = entry - (4.0 * atr_1) if buy_sig else entry + (4.0 * atr_1)
                    # TP = 5x ATR → gives 1.25:1 R:R. Minimum floor enforced at 1.5:1
                    raw_tp = entry + (5.0 * atr_1) if buy_sig else entry - (5.0 * atr_1)
                    min_tp = entry + (sl_dist_points * point * 1.5) if buy_sig else entry - (sl_dist_points * point * 1.5)
                    tp = max(raw_tp, min_tp) if buy_sig else min(raw_tp, min_tp)
                    
                    order_type = mt5.ORDER_TYPE_BUY if buy_sig else mt5.ORDER_TYPE_SELL

                    # Fetch daily open and Asia range for breakout verification
                    daily_open = None
                    d1_rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_D1, 0, 1)
                    if d1_rates is not None and len(d1_rates) > 0:
                        daily_open = float(d1_rates[0]["open"])
                        
                    asia_high, asia_low = self.get_asia_session_range(symbol)

                    # === G4: TimesFM AI direction gate ===
                    gate = self.risk_manager.evaluate(
                        symbol=symbol,
                        direction=direction,
                        current_price=entry,
                        highs=highs,
                        lows=lows,
                        closes=closes,
                        open_price=daily_open,
                        asia_high=asia_high,
                        asia_low=asia_low,
                        volumes=volumes
                    )
                    print(f"[Bot] [G4] {symbol} {direction}: {gate['reason']}")

                    if gate["mode"] == "WARN" and gate["allow"] and gate["confidence"] >= self.risk_manager.min_conf:
                        # Send Telegram warning before placing
                        warn_msg = (f"\u26a0\ufe0f *[G4 AI WARNING — {self.risk_manager.gate_mode}]*\n"
                                    f"*Symbol:* `{symbol}`\n"
                                    f"*Signal:* `{direction}` vs TFM `{gate['bias']}` "
                                    f"{gate['confidence']*100:.0f}%\n"
                                    f"Trade will be placed — AI disagrees.")
                        self.send_telegram_alert(warn_msg)

                    if gate["allow"]:
                        # Delegate order placement and Martingale scaling to the hierarchically superior TradingManager!
                        success = self.trading_manager.execute_live_order(
                            symbol=symbol,
                            order_type=order_type,
                            entry=entry,
                            sl=sl,
                            tp=tp,
                            base_lot=lot,
                            gate=gate,
                            send_telegram_alert_callback=self.send_telegram_alert
                        )
                        if success:
                            self.state[state_key] = last_bar_time
                            self.save_state()
                    else:
                        block_msg = (f"\U0001f6ab *[G4 TRADE BLOCKED — {self.risk_manager.gate_mode}]*\n"
                                     f"*Symbol:* `{symbol}`\n"
                                     f"*Signal:* `{direction}` vs TFM `{gate['bias']}` "
                                     f"{gate['confidence']*100:.0f}%")
                        self.send_telegram_alert(block_msg)
                        print(f"[Bot] [G4] Trade BLOCKED for {symbol}.")

                    
        # === B. EVALUATE STOCK INDEX / METAL (M15 Pure Volume Matrix) ======
        for symbol in self.volume_symbols:
            if self.check_active_positions(symbol) or self.check_pending_orders(symbol):
                continue
                
            # Check News Shield
            news = self.sentinel.check_risk_status(symbol)
            if news["status"] == "THREAT_DETECTED":
                continue
                
            # Copy rates
            rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M15, 0, 350)
            if rates is None or len(rates) < 310:
                continue
                
            sig_bar = rates[-2]  # bar 1 completed candle
            sig_time = datetime.fromtimestamp(int(sig_bar["time"]), tz=timezone.utc)
            
            offset = self.detect_broker_offset(symbol)
            sig_malta_hour = self.get_malta_hour(offset)
            
            # Find active session
            active_s = None
            active_s_idx = None
            for s_idx, p in self.sessions.items():
                is_in = False
                if p["start"] <= p["end"]:
                    is_in = (sig_malta_hour >= p["start"] and sig_malta_hour < p["end"])
                else:
                    is_in = (sig_malta_hour >= p["start"] or sig_malta_hour < p["end"])
                if is_in:
                    active_s = p
                    active_s_idx = s_idx
                    break
                    
            if active_s is None:
                continue
                
            # Fetch micro-timeframe M1 rates for the completed bar 1 (15 M1 bars)
            bar1_start = sig_time
            bar1_end = sig_time + timedelta(minutes=15)
            m1_rates = mt5.copy_rates_range(symbol, mt5.TIMEFRAME_M1, bar1_start, bar1_end)
            if m1_rates is None or len(m1_rates) == 0:
                continue
                
            s_info = mt5.symbol_info(symbol)
            point = s_info.point
            
            bodyMax = max(float(sig_bar["open"]), float(sig_bar["close"]))
            bodyMin = min(float(sig_bar["open"]), float(sig_bar["close"]))
            
            lower_wick_vol = 0.0
            upper_wick_vol = 0.0
            total_m1_vol = 0.0
            
            for r in m1_rates:
                m1_close = float(r["close"])
                m1_vol = float(r["tick_volume"])
                total_m1_vol += m1_vol
                if m1_close > bodyMax:
                    upper_wick_vol += m1_vol
                if m1_close < bodyMin:
                    lower_wick_vol += m1_vol
                    
            if total_m1_vol <= 0.0:
                total_m1_vol = 1.0
                
            lower_wick_vol_ratio = lower_wick_vol / total_m1_vol
            upper_wick_vol_ratio = upper_wick_vol / total_m1_vol
            wick_vol_concentration = (lower_wick_vol + upper_wick_vol) / total_m1_vol
            
            # VSA checks
            lowerWickVsaRejection   = (lower_wick_vol_ratio  >= 0.25)
            upperWickVsaRejection   = (upper_wick_vol_ratio  >= 0.25)
            institutionalAbsorption = (wick_vol_concentration >= 0.35)
            
            # FVG Proximity Gate — use the optimized fvg_pct session parameter
            # A valid FVG signal requires the bar body to be at least fvg_pct% of bar range
            bar_range = float(sig_bar["high"]) - float(sig_bar["low"])
            bar_body  = bodyMax - bodyMin
            fvg_body_pct = (bar_body / bar_range * 100.0) if bar_range > 0 else 0.0
            fvgBodyValid  = (fvg_body_pct >= active_s["fvg_pct"])
            
            # Volume Spike Confirmation
            sum_vol = 0.0
            vol_cnt = 0
            for v in range(1, 11):
                sum_vol += float(rates[-2 - v]["tick_volume"])
                vol_cnt += 1
            avg_vol = sum_vol / vol_cnt if vol_cnt > 0 else 1.0
            isHighVolumeCandle = (float(sig_bar["tick_volume"]) >= avg_vol * 1.2)
            
            # Volume Profile
            lookback_rates = rates[-active_s["lookback"] - 1 : -1]
            closes = np.array([float(x["close"]) for x in lookback_rates])
            vols = np.array([float(x["tick_volume"]) for x in lookback_rates])
            highs_m15 = np.array([float(x["high"]) for x in lookback_rates])
            lows_m15 = np.array([float(x["low"]) for x in lookback_rates])
            
            min_p = min(closes)
            max_p = max(closes)
            step = max(max_p - min_p, point * 10) / active_s["bins"]
            
            bins = np.zeros(active_s["bins"])
            for sc in lookback_rates:
                bn = int(np.floor((float(sc["close"]) - min_p) / step))
                bn = max(0, min(active_s["bins"] - 1, bn))
                bins[bn] += float(sc["tick_volume"])
                
            poc, vah, val, poc_bin = calc_poc_and_va(bins, active_s["bins"], min_p, step)
            
            # Calculate new advanced indicators
            vwap = calculate_vwap(closes, vols)
            vwap_val = vwap[-1]
            swing_high, swing_low = find_swing_levels(highs_m15, lows_m15, 100)
            
            # Proximity
            tol_price = active_s["tol"] * point
            lowNearValOrPoc = (abs(float(sig_bar["low"]) - val) <= tol_price) or (abs(float(sig_bar["low"]) - poc) <= tol_price)
            highNearVahOrPoc = (abs(float(sig_bar["high"]) - vah) <= tol_price) or (abs(float(sig_bar["high"]) - poc) <= tol_price)
            
            # PDH/PDL sweeps (completed daily bar 1)
            d1_rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_D1, 1, 1)
            pdh = float(d1_rates[0]["high"]) if d1_rates is not None else float(sig_bar["high"])
            pdl = float(d1_rates[0]["low"]) if d1_rates is not None else float(sig_bar["low"])
            
            sweepsPdl = (abs(float(sig_bar["low"]) - pdl) <= tol_price)
            sweepsPdh = (abs(float(sig_bar["high"]) - pdh) <= tol_price)
            
            # VWAP Gating
            buy_vwap_ok = (float(sig_bar["close"]) < vwap_val)
            sell_vwap_ok = (float(sig_bar["close"]) > vwap_val)
            
            buy_sig  = (lowNearValOrPoc and sweepsPdl and lowerWickVsaRejection
                        and institutionalAbsorption and isHighVolumeCandle
                        and buy_vwap_ok and fvgBodyValid)
            sell_sig = (highNearVahOrPoc and sweepsPdh and upperWickVsaRejection
                        and institutionalAbsorption and isHighVolumeCandle
                        and sell_vwap_ok and fvgBodyValid)
            
            # In live, check if we already placed order for this specific M15 bar
            last_m15_time = int(sig_bar["time"])
            state_key = f"last_m15_bar_{symbol}"
            
            if state_key in self.state and self.state[state_key] == last_m15_time:
                continue
                
            if buy_sig or sell_sig:
                direction = "BUY" if buy_sig else "SELL"
                if buy_sig:
                    lower_wick_size = bodyMin - float(sig_bar["low"])
                    entry_limit     = bodyMin - (lower_wick_size * 0.50)
                    sl              = float(sig_bar["low"]) - (20 * point)
                    sl_dist_points  = (entry_limit - sl) / point
                    # TP: use VAH or swing high but enforce a minimum 2:1 R:R floor
                    raw_tp          = min(vah, swing_high)
                    min_tp_floor    = entry_limit + (sl_dist_points * point * 2.0)
                    tp              = max(raw_tp, min_tp_floor)
                    order_type      = mt5.ORDER_TYPE_BUY_LIMIT
                else:
                    upper_wick_size = float(sig_bar["high"]) - bodyMax
                    entry_limit     = bodyMax + (upper_wick_size * 0.50)
                    sl              = float(sig_bar["high"]) + (20 * point)
                    sl_dist_points  = (sl - entry_limit) / point
                    # TP: use VAL or swing low but enforce a minimum 2:1 R:R floor
                    raw_tp          = max(val, swing_low)
                    min_tp_floor    = entry_limit - (sl_dist_points * point * 2.0)
                    tp              = min(raw_tp, min_tp_floor)
                    order_type      = mt5.ORDER_TYPE_SELL_LIMIT
                    
                if sl_dist_points > 0:
                    lot = self.calculate_lot_size(symbol, risk_amount=risk_cash, sl_dist_points=sl_dist_points)
                    # Cap max lot for high-volatility volume symbols (NAS100, Gold) — never exceed 2% balance equivalent
                    max_safe_lot = self.calculate_lot_size(symbol, risk_amount=balance * 0.02, sl_dist_points=sl_dist_points)
                    lot = min(lot, max_safe_lot)

                    # Fetch daily open and Asia range for breakout verification
                    daily_open = None
                    d1_rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_D1, 0, 1)
                    if d1_rates is not None and len(d1_rates) > 0:
                        daily_open = float(d1_rates[0]["open"])
                        
                    asia_high, asia_low = self.get_asia_session_range(symbol)

                    # === G4: TimesFM AI direction gate ===
                    gate = self.risk_manager.evaluate(
                        symbol=symbol,
                        direction=direction,
                        current_price=entry_limit,
                        highs=highs_m15,
                        lows=lows_m15,
                        closes=closes,
                        open_price=daily_open,
                        asia_high=asia_high,
                        asia_low=asia_low,
                        volumes=vols
                    )
                    print(f"[Bot] [G4] {symbol} {direction}: {gate['reason']}")

                    if gate["mode"] == "WARN" and gate["allow"] and gate["confidence"] >= self.risk_manager.min_conf:
                        warn_msg = (f"\u26a0\ufe0f *[G4 AI WARNING — {self.risk_manager.gate_mode}]*\n"
                                    f"*Symbol:* `{symbol}`\n"
                                    f"*Signal:* `{direction}` vs TFM `{gate['bias']}` "
                                    f"{gate['confidence']*100:.0f}%\n"
                                    f"Limit order placed — AI disagrees.")
                        self.send_telegram_alert(warn_msg)

                    if not gate["allow"]:
                        block_msg = (f"\U0001f6ab *[G4 TRADE BLOCKED — {self.risk_manager.gate_mode}]*\n"
                                     f"*Symbol:* `{symbol}`\n"
                                     f"*Signal:* `{direction}` vs TFM `{gate['bias']}` "
                                     f"{gate['confidence']*100:.0f}%")
                        self.send_telegram_alert(block_msg)
                        print(f"[Bot] [G4] Limit order BLOCKED for {symbol}.")
                        continue

                    # Delegate pending LIMIT order execution and Martingale progression to the hierarchical TradingManager!
                    success = self.trading_manager.execute_live_order(
                        symbol=symbol,
                        order_type=order_type,
                        entry=entry_limit,
                        sl=sl,
                        tp=tp,
                        base_lot=lot,
                        gate=gate,
                        send_telegram_alert_callback=self.send_telegram_alert
                    )
                    if success:
                        self.state[state_key] = last_m15_time
                        self.save_state()

def main():
    print("=" * 60)
    print("   Whale Pure Volume & Robust H1 Plateau Bot Deployed")
    print("=" * 60)
    
    bot = HybridTradingBot()
    
    # ── Start Live Volume Profile Background Service ───────────────────────────
    try:
        from volume_profile_service import start_background as _vp_start
        _vp_start()
        print("[Bot] [VP Service] Live Volume Profile engine started (30s refresh cycle)")
    except Exception as _vp_err:
        print(f"[Bot] [VP Service] WARNING: Could not start VP service: {_vp_err}")
    
    # 24/7 Resilient Reconnection Loop
    print("[Bot] Production loop started. Entering persistent 24/7 state machine...")
    print(f"[Bot] [G4] Gate mode: {bot.risk_manager.gate_mode} | "
          f"Min confidence: {bot.risk_manager.min_conf*100:.0f}%")
    print("[Bot] [G4] To change mode: bot.risk_manager.set_mode('BLOCK') etc.")

    
    try:
        while True:
            # 1. Ensure MT5 is active and connected
            mt5_connected = False
            try:
                info = mt5.terminal_info()
                if info is not None:
                    mt5_connected = True
            except Exception:
                pass
                
            if not mt5_connected:
                print("[Bot] [Warning] MT5 terminal not connected. Attempting clean initialization...")
                mt5.shutdown() # shutdown any stale connection
                time.sleep(2)
                if bot.initialize_mt5():
                    print("[Bot] [SUCCESS] Re-established connection to MetaTrader 5.")
                else:
                    print("[Bot] [Error] Failed to connect to MetaTrader 5. Retrying in 10 seconds...")
                    time.sleep(10)
                    continue

            # 1.5 Automated Dynamic Re-Optimization Check (24-Hour Adaptive AI loop)
            should_tune = False
            last_tune_str = bot.state.get("last_tuning_time", "")
            if not last_tune_str:
                should_tune = True
            else:
                try:
                    last_tune_dt = datetime.fromisoformat(last_tune_str)
                    elapsed = datetime.now(timezone.utc) - last_tune_dt
                    if elapsed.total_seconds() >= 86400:  # 24 Hours
                        should_tune = True
                except Exception:
                    should_tune = True
                    
            if should_tune:
                try:
                    bot.auto_tune_parameters()
                except Exception as e:
                    print(f"[Bot] [Adaptive AI] [ERROR] Automated parameter tuning failed: {e}")

            # 2. Execute a single production cycle with safety guards
            try:
                # Refresh macroeconomic & geopolitical risk indicators
                bot.refresh_macro_sentiment()
                # Refresh TimesFM forecasts at the start of every 5-min cycle
                bot.refresh_timesfm_forecasts()
                
                # Double check connection is still active before evaluating live markets
                if mt5.terminal_info() is not None:
                    bot.evaluate_live_market()
                    print(f"[Bot] Cycle complete ({datetime.now().strftime('%H:%M:%S')}). Waiting 300 seconds...")
                    time.sleep(300)
                else:
                    print("[Bot] [Warning] Connection dropped during cycle. Re-evaluating next iteration...")
                    time.sleep(5)
            except KeyboardInterrupt:
                raise KeyboardInterrupt
            except Exception as e:
                import traceback
                print(f"[Bot] [ERROR] Exception caught during production cycle: {e}")
                traceback.print_exc()
                print("[Bot] State machine recovering. Sleeping 10 seconds before next attempt...")
                time.sleep(10)
                
    except KeyboardInterrupt:
        print("[Bot] Exiting program clean via KeyboardInterrupt.")
    finally:
        mt5.shutdown()
        print("=" * 60)

if __name__ == "__main__":
    main()
