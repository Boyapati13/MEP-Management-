"""Telegram channel for OCTO gateway."""
from __future__ import annotations
import logging
import threading
import time
from typing import Any, Set

from .base import BaseChannel

logger = logging.getLogger(__name__)


class TelegramChannel(BaseChannel):
    """
    Telegram bot channel using long-polling (no webhook needed).

    Config keys:
        token         – Bot token from @BotFather
        allowed_users – List of allowed Telegram user IDs (empty = all)
    """

    def __init__(self, config: dict):
        super().__init__("telegram", config)
        self._token         = config.get("token", "")
        allowed = config.get("allowed_users", [])
        if isinstance(allowed, str):
            allowed_list = [u.strip() for u in allowed.split(",") if u.strip()]
        elif isinstance(allowed, (list, tuple, set)):
            allowed_list = [str(u).strip() for u in allowed if u]
        else:
            allowed_list = [str(allowed).strip()] if allowed else []
        self._allowed: Set[str] = set(allowed_list)
        self._offset        = 0
        self._bot           = None

    def start(self) -> None:
        if not self._token:
            logger.warning("[Telegram] No token configured — channel disabled")
            return
        self._running = True
        self._thread  = threading.Thread(target=self._poll_loop, daemon=True, name="octo-telegram")
        self._thread.start()
        logger.info("[Telegram] Channel started")

    def _poll_loop(self) -> None:
        while self._running:
            try:
                updates = self._get_updates()
                for upd in updates:
                    self._handle(upd)
            except Exception as e:
                logger.error("[Telegram] Poll error: %s", e)
                time.sleep(5)

    def _get_updates(self) -> list:
        import requests
        url  = f"https://api.telegram.org/bot{self._token}/getUpdates"
        resp = requests.get(url, params={"offset": self._offset, "timeout": 30}, timeout=35)
        resp.raise_for_status()
        data = resp.json()
        updates = data.get("result", [])
        if updates:
            self._offset = updates[-1]["update_id"] + 1
        return updates

    def _handle(self, upd: dict) -> None:
        msg = upd.get("message", {})
        if not msg:
            return
        user_id = str(msg.get("from", {}).get("id", ""))
        text    = msg.get("text", "").strip()
        if not text or not user_id:
            return
        if self._allowed and user_id not in self._allowed:
            logger.debug("[Telegram] Ignored message from %s (not in allowed list)", user_id)
            return
        self._emit(user_id, text)

    def send(self, user_id: str, text: str) -> None:
        try:
            import requests
            # Telegram messages max 4096 chars
            for chunk in _split(text, 4096):
                requests.post(
                    f"https://api.telegram.org/bot{self._token}/sendMessage",
                    json={"chat_id": user_id, "text": chunk, "parse_mode": "Markdown"},
                    timeout=30,
                )
        except Exception as e:
            logger.error("[Telegram] Send failed: %s", e)


def _split(text: str, max_len: int) -> list:
    if len(text) <= max_len:
        return [text]
    return [text[i:i+max_len] for i in range(0, len(text), max_len)]
