"""Slack channel for OCTO gateway (Socket Mode — no public IP needed)."""
from __future__ import annotations
import logging
import threading
from typing import Set

from .base import BaseChannel

logger = logging.getLogger(__name__)


class SlackChannel(BaseChannel):
    """
    Slack Socket Mode channel.

    Config keys:
        token         – Bot OAuth token (xoxb-…)
        api_key       – App-level token (xapp-…) for Socket Mode
        allowed_users – List of allowed Slack user IDs (empty = all)
    """

    def __init__(self, config: dict):
        super().__init__("slack", config)
        self._bot_token  = config.get("token", "")
        self._app_token  = config.get("api_key", "")
        allowed = config.get("allowed_users", [])
        if isinstance(allowed, str):
            allowed_list = [u.strip() for u in allowed.split(",") if u.strip()]
        elif isinstance(allowed, (list, tuple, set)):
            allowed_list = [str(u).strip() for u in allowed if u]
        else:
            allowed_list = [str(allowed).strip()] if allowed else []
        self._allowed: Set[str] = set(allowed_list)
        self._web_client = None

    def start(self) -> None:
        if not self._bot_token or not self._app_token:
            logger.warning("[Slack] Tokens not configured — channel disabled")
            return
        self._running = True
        self._thread  = threading.Thread(target=self._run, daemon=True, name="octo-slack")
        self._thread.start()
        logger.info("[Slack] Channel starting (Socket Mode)")

    def _run(self) -> None:
        try:
            from slack_sdk import WebClient
            from slack_sdk.socket_mode import SocketModeClient
            from slack_sdk.socket_mode.response import SocketModeResponse
            from slack_sdk.socket_mode.request import SocketModeRequest

            self._web_client = WebClient(token=self._bot_token)
            socket_client    = SocketModeClient(
                app_token=self._app_token,
                web_client=self._web_client,
            )

            def handle(client, req: SocketModeRequest):
                if req.type == "events_api":
                    client.send_socket_mode_response(SocketModeResponse(envelope_id=req.envelope_id))
                    event = req.payload.get("event", {})
                    if event.get("type") == "message" and "bot_id" not in event:
                        user_id = event.get("user", "")
                        text    = event.get("text", "").strip()
                        if text and user_id:
                            if not self._allowed or user_id in self._allowed:
                                self._emit(user_id, text)

            socket_client.socket_mode_request_listeners.append(handle)
            socket_client.connect()
            import time
            while self._running:
                time.sleep(1)
        except ImportError:
            logger.error("[Slack] slack-sdk not installed — run: pip install slack-sdk")
        except Exception as e:
            logger.error("[Slack] Error: %s", e)

    def send(self, user_id: str, text: str) -> None:
        try:
            if self._web_client:
                self._web_client.chat_postMessage(channel=user_id, text=text[:3000])
        except Exception as e:
            logger.error("[Slack] Send failed: %s", e)
