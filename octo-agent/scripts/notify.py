import asyncio
import sys
from pathlib import Path

# Add root to sys.path
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from channels.service import ChannelService
from channels.message_bus import OutboundMessage

async def send_notification():
    print("Starting ChannelService...")
    service = ChannelService()
    await service.start()
    
    telegram = service.get_channel("telegram")
    if telegram:
        # get the first allowed user to send the notification to
        allowed_users = telegram.config.get("allowed_users", "")
        chat_id = allowed_users.split(",")[0].strip() if isinstance(allowed_users, str) else str(allowed_users[0])
        
        if chat_id:
            text = (
                "🚀 *Autonomous Update Complete*\n\n"
                "Phase 1 Reconnaissance and Phase 2 Gap Analysis identified a missing algorithmic trading capability.\n"
                "Phase 3 completed: `timesfm_forecaster.py` action and `TimesFM Forecasting` skill were created and validated via TDD.\n"
                "System is fully self-updated without touching core monolith files."
            )
            msg = OutboundMessage(channel_name="telegram", chat_id=chat_id, thread_id="system_update", text=text)
            print(f"Sending notification to chat_id: {chat_id}")
            await telegram.send(msg)
            print("Telegram notification sent successfully via ChannelService.")
        else:
            print("No allowed_users configured for Telegram.")
    else:
        print("Telegram channel not enabled or failed to start.")
        
    await service.stop()
    print("ChannelService stopped.")

if __name__ == "__main__":
    asyncio.run(send_notification())
