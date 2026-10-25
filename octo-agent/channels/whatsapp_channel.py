from __future__ import annotations
import json
import logging
import asyncio
import threading
import subprocess
import sys
import os
import time
from pathlib import Path
from typing import Any
import requests

from channels.base import Channel
from channels.message_bus import InboundMessage, InboundMessageType, MessageBus, OutboundMessage

logger = logging.getLogger(__name__)

class WhatsAppChannel(Channel):
    """
    WhatsApp channel using a local Baileys Node.js bridge, fully integrated with
    OCTO's MessageBus. No Twilio or Meta Developer accounts required.
    """

    def __init__(self, bus: MessageBus, config: dict[str, Any]) -> None:
        super().__init__(name="whatsapp", bus=bus, config=config)
        self._port = int(config.get("port", 3005))
        self._running = False
        self._mep_mode = bool(os.environ.get("MEP_INGEST_URL"))
        self._process = None
        self._poll_thread = None
        
        # Session directory: default to ~/.octo/whatsapp/session
        self._session_dir = Path.home() / ".octo" / "whatsapp" / "session"
        self._session_dir.mkdir(parents=True, exist_ok=True)
        
        # WhatsApp settings
        self._allowed_users = config.get("allowed_users", "")
        # If allowed_users is empty/missing, set to * for self-chat or open mode
        if not self._allowed_users.strip():
            self._allowed_users = "*"
            
        # Determine mode based on whether allowed_users is "*" or specific list
        self._mode = "self-chat" if self._allowed_users == "*" else "bot"

    def _ensure_dependencies(self) -> bool:
        """Run npm install inside the bridge directory if node_modules is missing."""
        bridge_dir = Path(__file__).parent.parent / "scripts" / "whatsapp-bridge"
        node_modules = bridge_dir / "node_modules"
        
        if not node_modules.exists():
            logger.info("[WhatsApp] node_modules missing. Running npm install...")
            try:
                npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
                subprocess.run(
                    [npm_cmd, "install"],
                    cwd=str(bridge_dir),
                    shell=False,
                    check=True,
                    timeout=180,
                    creationflags=0x08000000 if sys.platform == "win32" else 0
                )
                logger.info("[WhatsApp] npm install completed successfully.")
                return True
            except Exception as e:
                logger.error("[WhatsApp] npm install failed: %s", e)
                return False
        return True

    async def start(self) -> None:
        if self._running:
            return
            
        if not self._mep_mode:
            logger.error("[WhatsApp] Configure MEP_INGEST_URL for the passive collector. General chat mode is not implemented by this bridge.")
            return
        logger.info("[WhatsApp] Starting Node.js Baileys bridge...")
        if not self._ensure_dependencies():
            logger.error("[WhatsApp] Missing Node.js dependencies. Channel disabled.")
            return

        bridge_script = Path(__file__).parent.parent / "scripts" / "whatsapp-bridge" / "bridge.js"
        if not bridge_script.exists():
            logger.error("[WhatsApp] Bridge script not found at %s", bridge_script)
            return

        # Prepare environment variables
        env = os.environ.copy()
        env["WHATSAPP_ALLOWED_USERS"] = self._allowed_users
        env["WHATSAPP_MODE"] = self._mode

        cmd = [
            "node",
            str(bridge_script),
            "--port", str(self._port),
            "--session", str(self._session_dir),
            "--mode", self._mode
        ]

        logger.info("[WhatsApp] Launching command: %s", " ".join(cmd))
        try:
            self._process = subprocess.Popen(
                cmd,
                env=env,
                shell=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=0x08000000 if sys.platform == "win32" else 0
            )
            self._running = True
            
            # MEP collector delivers directly from its durable queue; do not dispatch
            # untrusted site chat to the general-purpose agent.
            if self._mep_mode:
                logger.info("[WhatsApp] Passive MEP collector started; agent replies disabled.")
                return

            # Start background message polling thread
            self._poll_thread = threading.Thread(target=self._poll_messages, daemon=True, name="octo-whatsapp-poll")
            self._poll_thread.start()
            logger.info("[WhatsApp] Polling thread active on port %d", self._port)
        except Exception as e:
            logger.error("[WhatsApp] Failed to spawn bridge subprocess: %s", e)

    def _poll_messages(self) -> None:
        """Continuously polls the local Express bridge for new incoming WhatsApp messages."""
        url = f"http://127.0.0.1:{self._port}/messages"
        logger.info("[WhatsApp] Starting polling loop at %s", url)
        
        # Give Node.js bridge a few seconds to warm up
        time.sleep(3)
        
        while self._running:
            try:
                # Poll local bridge endpoint
                resp = requests.get(url, timeout=5)
                if resp.status_code == 200:
                    messages = resp.json()
                    for item in messages:
                        chat_id = item.get("chatId", "")
                        sender_id = item.get("senderId", "")
                        body = item.get("body", "").strip()
                        
                        if chat_id and body:
                            logger.info("[WhatsApp] Inbound message from %s: %s", sender_id, body[:60])
                            
                            # Construct and publish inbound message
                            inbound = self._make_inbound(
                                chat_id=chat_id,
                                user_id=sender_id,
                                text=body,
                                msg_type=InboundMessageType.CHAT
                            )
                            
                            loop = getattr(self.bus, "_loop", None) or asyncio.get_event_loop()
                            if loop and loop.is_running():
                                asyncio.run_coroutine_threadsafe(
                                    self.bus.publish_inbound(inbound),
                                    loop
                                )
                            else:
                                asyncio.run(self.bus.publish_inbound(inbound))
                else:
                    logger.debug("[WhatsApp] Poll received HTTP %d", resp.status_code)
            except requests.exceptions.ConnectionError:
                # Safe to ignore if server is starting/stopping
                pass
            except Exception as e:
                logger.error("[WhatsApp] Error polling messages: %s", e)
                
            time.sleep(1)

    async def stop(self) -> None:
        self._running = False
        if self._process:
            logger.info("[WhatsApp] Stopping bridge subprocess...")
            try:
                self._process.terminate()
                self._process.wait(timeout=3)
            except Exception:
                try:
                    self._process.kill()
                except Exception:
                    pass
            self._process = None
        logger.info("[WhatsApp] Bridge stopped.")

    async def send(self, msg: OutboundMessage) -> None:
        if self._mep_mode:
            logger.warning("[WhatsApp] Sending is disabled for the passive MEP collector.")
            return
        url = f"http://127.0.0.1:{self._port}/send"
        data = {
            "chatId": msg.chat_id,
            "message": msg.text
        }
        try:
            logger.info("[WhatsApp] Sending message to %s...", msg.chat_id)
            resp = requests.post(url, json=data, timeout=10)
            if resp.status_code == 200:
                logger.info("[WhatsApp] Message sent successfully to %s.", msg.chat_id)
            else:
                logger.error("[WhatsApp] Failed to send message (HTTP %d): %s", resp.status_code, resp.text)
        except Exception as e:
            logger.error("[WhatsApp] Send HTTP request error: %s", e)

    def pair_qr(self) -> None:
        """Starts a standalone, one-shot pairing process to print/generate the QR code."""
        logger.info("[WhatsApp] Commencing QR pairing sequence...")
        if not self._ensure_dependencies():
            logger.error("[WhatsApp] Cannot pair: dependencies failed.")
            return

        bridge_script = Path(__file__).parent.parent / "scripts" / "whatsapp-bridge" / "bridge.js"
        cmd = [
            "node",
            str(bridge_script),
            "--port", str(self._port),
            "--session", str(self._session_dir),
            "--pair-only"
        ]
        
        try:
            # Run pairing process blocking so it holds until scanned or terminated
            subprocess.run(
                cmd,
                shell=False,
                creationflags=0x08000000 if sys.platform == "win32" else 0
            )
            logger.info("[WhatsApp] QR pairing subprocess completed.")
        except Exception as e:
            logger.error("[WhatsApp] QR pairing exception: %s", e)
