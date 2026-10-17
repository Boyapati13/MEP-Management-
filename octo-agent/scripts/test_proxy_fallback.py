import sys
import os
import asyncio

# Add project root to sys.path to resolve imports cleanly
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.settings import get_settings
from proxy.services import ClaudeProxyService
from proxy.models.anthropic import MessagesRequest, Message
from providers.base import BaseProvider
from providers.exceptions import ProviderError

class FailingProvider(BaseProvider):
    """Mocks a failing cloud API provider to simulate network/API outages."""
    def preflight_stream(self, request, thinking_enabled=False):
        raise ProviderError("Simulated primary cloud API outage (500 Internal Server Error)")
    
    async def stream_response(self, request, input_tokens=0, request_id=None, thinking_enabled=False):
        raise ProviderError("Simulated primary cloud API outage")

def test_fallback():
    print("=" * 60)
    print("       TESTING MODEL PROXY OLLAMA LOCAL FALLBACK")
    print("=" * 60)
    
    settings = get_settings()
    # Explicitly configure the local Ollama server address
    settings.ollama_base_url = "http://127.0.0.1:11434"
    
    # provider_getter that returns a failing cloud provider or the real Ollama provider
    def mock_provider_getter(provider_type):
        if provider_type == "ollama":
            from providers.registry import ProviderRegistry
            reg = ProviderRegistry({})
            return reg.get("ollama", settings)
        else:
            return FailingProvider()

    service = ClaudeProxyService(
        settings=settings,
        provider_getter=mock_provider_getter,
        token_counter=lambda *args, **kwargs: 10
    )
    
    # Construct an incoming request targeting a cloud model
    req = MessagesRequest(
        model="nvidia_nim/deepseek-ai/DeepSeek-V3",
        messages=[Message(role="user", content="Hello, write a 1-sentence greeting.")],
        max_tokens=15
    )
    
    print("[Test] Dispatched request targeting Nvidia NIM (DeepSeek-V3)...")
    try:
        response = service.create_message(req)
        print("[Test] [SUCCESS] Interceptor successfully caught failure and triggered failover!")
        print(f"[Test] Stream response headers: {response.headers}")
        print(f"[Test] Stream response media type: {response.media_type}")
    except Exception as e:
        print(f"[Test] [FAIL] Fallover failed and raised exception: {e}")
    print("=" * 60)

if __name__ == "__main__":
    test_fallback()
