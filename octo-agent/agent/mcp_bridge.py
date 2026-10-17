"""
agent/mcp_bridge.py
====================
MCP (Model Context Protocol) client bridge for OCTO.

Adapted from NousResearch/hermes-agent's tools/mcp_tool.py.

Connects to external MCP servers via stdio or HTTP/SSE transport,
discovers their tools, and makes them callable from OCTO's executor.

Config: config/mcp_servers.json
Example:
{
  "servers": [
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "~/Desktop"],
      "env": {}
    },
    {
      "name": "github",
      "url": "https://mcp.github.com/sse",
      "headers": {"Authorization": "Bearer ghp_..."}
    }
  ]
}
"""
from __future__ import annotations

import json
import logging
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

_CFG_PATH = Path(__file__).resolve().parent.parent / "config" / "mcp_servers.json"

# Registry: name -> {process, tools, call_fn}
_registry: Dict[str, Dict] = {}
_lock = threading.Lock()


# ── Config ─────────────────────────────────────────────────────────────────

def _load_config() -> List[Dict]:
    if not _CFG_PATH.exists():
        return []
    try:
        return json.loads(_CFG_PATH.read_text(encoding="utf-8")).get("servers", [])
    except Exception as e:
        logger.warning("[MCP] Config read error: %s", e)
        return []


def save_server(server: Dict) -> None:
    """Add or update a server in mcp_servers.json."""
    cfg = {"servers": _load_config()}
    existing = [s for s in cfg["servers"] if s.get("name") != server.get("name")]
    existing.append(server)
    cfg["servers"] = existing
    _CFG_PATH.parent.mkdir(parents=True, exist_ok=True)
    _CFG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    logger.info("[MCP] Saved server: %s", server.get("name"))


def remove_server(name: str) -> None:
    cfg = {"servers": [s for s in _load_config() if s.get("name") != name]}
    _CFG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")


# ── HTTP/SSE transport ─────────────────────────────────────────────────────

def _http_call(url: str, tool_name: str, arguments: Dict, headers: Dict = None) -> str:
    """Call a tool on an HTTP MCP server."""
    try:
        import requests
        payload = {"method": "tools/call", "params": {"name": tool_name, "arguments": arguments}}
        r = requests.post(f"{url}/mcp", json=payload, headers=headers or {}, timeout=60)
        r.raise_for_status()
        data = r.json()
        content = data.get("result", {}).get("content", [])
        if isinstance(content, list):
            return "\n".join(c.get("text", "") for c in content if c.get("type") == "text")
        return str(content)
    except Exception as e:
        return f"[MCP HTTP Error] {e}"


def _http_list_tools(url: str, headers: Dict = None) -> List[Dict]:
    """List tools from an HTTP MCP server."""
    try:
        import requests
        payload = {"method": "tools/list", "params": {}}
        r = requests.post(f"{url}/mcp", json=payload, headers=headers or {}, timeout=30)
        r.raise_for_status()
        return r.json().get("result", {}).get("tools", [])
    except Exception as e:
        logger.warning("[MCP] HTTP list tools failed for %s: %s", url, e)
        return []


# ── Stdio transport ────────────────────────────────────────────────────────

class _StdioMcpClient:
    """Minimal stdio MCP client (JSON-RPC over stdin/stdout)."""

    def __init__(self, name: str, command: str, args: List[str],
                 env: Dict = None, cwd: str = None):
        self.name    = name
        self._id_ctr = 0
        import os
        proc_env = os.environ.copy()
        try:
            from memory.config_manager import load_proxy_keys, _PROXY_KEY_MAP
            cfg_keys = load_proxy_keys()
            for our_key, env_key in _PROXY_KEY_MAP.items():
                val = cfg_keys.get(our_key, "").strip()
                if val:
                    proc_env[env_key] = val
        except Exception as e:
            logger.warning("[MCP] Stdio Client config sync error: %s", e)
        if env:
            proc_env.update(env)
        self._proc = subprocess.Popen(
            [command] + args,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True, env=proc_env,
            cwd=cwd or None,
        )
        self._lock = threading.Lock()
        # Initialise handshake
        init_resp = self._send({
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "octo", "version": "1.0"}
            }
        })
        # Send initialized notification (no id, no response expected)
        notif = json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n"
        try:
            self._proc.stdin.write(notif)
            self._proc.stdin.flush()
        except Exception:
            pass

    def _next_id(self) -> int:
        self._id_ctr += 1
        return self._id_ctr

    def _send(self, payload: Dict) -> Dict:
        with self._lock:
            payload["jsonrpc"] = "2.0"
            if "id" not in payload:
                payload["id"] = self._next_id()
            line = json.dumps(payload) + "\n"
            self._proc.stdin.write(line)
            self._proc.stdin.flush()
            # Read until we get a response with matching id (skip notifications)
            for _ in range(20):
                raw = self._proc.stdout.readline()
                if not raw:
                    return {}
                try:
                    obj = json.loads(raw)
                    if "id" in obj and obj["id"] == payload["id"]:
                        return obj
                    # It's a notification — skip and keep reading
                except Exception:
                    continue
            return {}

    def list_tools(self) -> List[Dict]:
        resp = self._send({"method": "tools/list", "params": {}})
        return resp.get("result", {}).get("tools", [])

    def call_tool(self, name: str, arguments: Dict) -> str:
        resp = self._send({"method": "tools/call",
                           "params": {"name": name, "arguments": arguments}})
        content = resp.get("result", {}).get("content", [])
        if isinstance(content, list):
            return "\n".join(c.get("text", "") for c in content if c.get("type") == "text")
        return str(resp.get("result", resp.get("error", "No result")))

    def close(self):
        try:
            self._proc.terminate()
        except Exception:
            pass


# ── Registry ───────────────────────────────────────────────────────────────

def start_all() -> Dict[str, List[Dict]]:
    """Start all auto_start+enabled MCP servers; returns {name: [tools]}."""
    servers = _load_config()
    result  = {}
    for cfg in servers:
        name = cfg.get("name", "unnamed")
        # Only auto-start servers flagged as auto_start (or no flag at all for backwards compat)
        if not cfg.get("enabled", True):
            continue
        try:
            tools = _connect_server(cfg)
            result[name] = tools
            logger.info("[MCP] Connected: %s (%d tools)", name, len(tools))
        except Exception as e:
            logger.warning("[MCP] Failed to connect %s: %s", name, e)
    return result


def _connect_server(cfg: Dict) -> List[Dict]:
    name    = cfg.get("name", "unnamed")
    url     = cfg.get("url")
    command = cfg.get("command")
    args    = cfg.get("args", [])
    cwd     = cfg.get("cwd")
    headers = cfg.get("headers", {})
    env     = cfg.get("env", {})

    with _lock:
        if name in _registry:
            return _registry[name]["tools"]

        if url:
            tools   = _http_list_tools(url, headers)
            call_fn = lambda tn, kw: _http_call(url, tn, kw, headers)  # noqa: E731
            client  = None
        elif command:
            client  = _StdioMcpClient(name, command, args, env, cwd)
            tools   = client.list_tools()
            call_fn = client.call_tool
        else:
            raise ValueError("Server needs 'url' or 'command'")

        _registry[name] = {"client": client, "tools": tools, "call_fn": call_fn,
                           "cfg": cfg}
        return tools


def call_tool(server_name: str, tool_name: str, arguments: Dict) -> str:
    """Call a tool on a registered MCP server."""
    with _lock:
        entry = _registry.get(server_name)
    if not entry:
        # Auto-connect if configured but not connected yet
        try:
            cfgs = _load_config()
            cfg  = next((c for c in cfgs if c.get("name") == server_name), None)
            if cfg and cfg.get("enabled", True):
                _connect_server(cfg)
                with _lock:
                    entry = _registry.get(server_name)
        except Exception as e:
            logger.warning("[MCP] Auto-connect failed for %s: %s", server_name, e)

    if not entry:
        return f"[MCP] Server '{server_name}' not connected."
    try:
        return entry["call_fn"](tool_name, arguments)
    except Exception as e:
        return f"[MCP] Tool call failed: {e}"


def get_all_tools() -> List[Dict]:
    """Return all tools from all connected servers (with server_name injected)."""
    tools = []
    with _lock:
        for name, entry in _registry.items():
            for t in entry.get("tools", []):
                tools.append({**t, "mcp_server": name})
    return tools


def list_servers() -> List[Dict]:
    """Return status of all configured servers."""
    cfgs   = _load_config()
    result = []
    with _lock:
        for cfg in cfgs:
            name   = cfg.get("name", "unnamed")
            connected = name in _registry
            n_tools   = len(_registry[name]["tools"]) if connected else 0
            result.append({"name": name, "connected": connected, "tools": n_tools,
                           "url": cfg.get("url"), "command": cfg.get("command")})
    return result


def stop_all():
    with _lock:
        for name, entry in _registry.items():
            client = entry.get("client")
            if client:
                try:
                    client.close()
                except Exception:
                    pass
        _registry.clear()


# ── Additional helpers called by UI pages ─────────────────────────────────────

def reload_servers() -> None:
    """Hot-reload MCP servers from mcp_servers.json after config change."""
    global _started
    _started = False
    try:
        start_all()
    except Exception as e:
        logger.debug("MCP reload: %s", e)


_enabled_toolsets: set | None = None

def set_enabled_toolsets(toolsets: set) -> None:
    """Filter which toolsets are active (called by ToolsPage)."""
    global _enabled_toolsets
    _enabled_toolsets = set(toolsets)


def get_enabled_toolsets() -> set | None:
    return _enabled_toolsets
