"""API layer for Claude Code Proxy."""

# Lazy imports to prevent premature loading of dependencies before path shims are set up.
def __getattr__(name):
    if name == "create_app":
        from .app import create_app
        return create_app
    if name in ("MessagesRequest", "MessagesResponse", "TokenCountRequest", "TokenCountResponse"):
        from .models import MessagesRequest, MessagesResponse, TokenCountRequest, TokenCountResponse
        if name == "MessagesRequest": return MessagesRequest
        if name == "MessagesResponse": return MessagesResponse
        if name == "TokenCountRequest": return TokenCountRequest
        if name == "TokenCountResponse": return TokenCountResponse
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
    "MessagesRequest",
    "MessagesResponse",
    "TokenCountRequest",
    "TokenCountResponse",
    "create_app",
]
