"""Discord channel for OCTO gateway."""
from __future__ import annotations
import logging
import threading
from typing import Set

from .base import BaseChannel

logger = logging.getLogger(__name__)


class DiscordChannel(BaseChannel):
    """
    Discord DM / mentions channel.

    Config keys:
        token         – Bot token from Discord Developer Portal
        allowed_users – List of allowed Discord user IDs (empty = all)
    """

    def __init__(self, config: dict):
        super().__init__("discord", config)
        self._token        = config.get("token", "")
        allowed = config.get("allowed_users", [])
        if isinstance(allowed, str):
            allowed_list = [u.strip() for u in allowed.split(",") if u.strip()]
        elif isinstance(allowed, (list, tuple, set)):
            allowed_list = [str(u).strip() for u in allowed if u]
        else:
            allowed_list = [str(allowed).strip()] if allowed else []
        self._allowed: Set[str] = set(allowed_list)
        self._client       = None

    def start(self) -> None:
        if not self._token:
            logger.warning("[Discord] No token configured — channel disabled")
            return
        self._running = True
        self._thread  = threading.Thread(target=self._run_bot, daemon=True, name="octo-discord")
        self._thread.start()
        logger.info("[Discord] Channel starting")

    def _run_bot(self) -> None:
        try:
            import discord

            intents = discord.Intents.default()
            intents.message_content = True
            client = discord.Client(intents=intents)
            self._client = client

            @client.event
            async def on_ready():
                logger.info("[Discord] Bot ready as %s", client.user)

            @client.event
            async def on_message(message):
                if message.author == client.user:
                    return
                user_id = str(message.author.id)
                if self._allowed and user_id not in self._allowed:
                    return
                text = message.content.strip()
                if text:
                    self._emit(user_id, text)
                    # Store channel for replies
                    if not hasattr(self, "_channels"):
                        self._channels = {}
                    self._channels[user_id] = message.channel

            client.run(self._token)
        except ImportError:
            logger.error("[Discord] 'discord.py' not installed — run: pip install discord.py")
        except Exception as e:
            logger.error("[Discord] Bot error: %s", e)

    def send(self, user_id: str, text: str) -> None:
        try:
            if not self._client:
                return
            channel = getattr(self, "_channels", {}).get(user_id)
            if channel:
                import asyncio
                asyncio.run_coroutine_threadsafe(
                    channel.send(text[:2000]), self._client.loop
                )
        except Exception as e:
            logger.error("[Discord] Send failed: %s", e)
