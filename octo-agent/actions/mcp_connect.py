"""
actions/mcp_connect.py
======================
Voice-callable MCP actions:

  mcp_connect   — connect to a named MCP server (or all configured)
  mcp_tool_call — call a specific tool on a connected MCP server
  mcp_list      — list all configured and connected MCP servers + tools

Example voice commands:
  "Connect to the filesystem MCP server"
  "Use the github MCP server to list my repositories"
  "Call the read_file tool on the filesystem server with path /Users/me/notes.txt"
"""
from __future__ import annotations

from typing import Callable


# ─────────────────────────────────────────────────────────────────────────────
def mcp_connect(
    parameters: dict,
    player=None,
    speak: Callable[[str], None] | None = None,
) -> str:
    """
    Connect to one or all MCP servers.

    parameters:
      name   – server name to connect to (optional; connects all if omitted)
      url    – HTTP endpoint (optional; adds/updates server before connecting)
      command– stdio command (optional; e.g. 'npx')
      args   – args list for stdio command (optional)
      token  – auth token / header value (optional)
    """
    def _log(msg: str):
        if player:
            try: player.write_log(msg)
            except Exception: pass

    try:
        from agent.mcp_bridge import (
            _load_config, _connect_server, list_servers, save_server,
        )
    except ImportError as e:
        return f"MCP bridge unavailable: {e}"

    name    = parameters.get("name", "").strip()
    url     = parameters.get("url", "").strip()
    command = parameters.get("command", "").strip()
    args    = parameters.get("args", [])
    token   = parameters.get("token", "").strip()

    # If URL or command given, auto-register the server first
    if url or command:
        cfg: dict = {"name": name or url or command}
        if url:
            cfg["url"] = url
            if token:
                cfg["headers"] = {"Authorization": f"Bearer {token}"}
        elif command:
            cfg["command"] = command
            cfg["args"]    = args if isinstance(args, list) else str(args).split()
        try:
            save_server(cfg)
            _log(f"[MCP] Registered server: {cfg['name']}")
        except Exception as e:
            _log(f"[MCP] Register failed: {e}")

    # Connect
    servers = _load_config()
    if not servers:
        return ("No MCP servers configured. Add one in the MCP page, "
                "or say 'connect to MCP server at http://...' with a URL.")

    targets = ([s for s in servers if s.get("name") == name] if name
               else servers)

    if not targets:
        return (f"No server named '{name}' found in config/mcp_servers.json. "
                f"Available: {', '.join(s.get('name','?') for s in servers)}")

    results = []
    for cfg in targets:
        n = cfg.get("name", "?")
        try:
            tools = _connect_server(cfg)
            tool_names = [t.get("name", "?") for t in tools[:8]]
            summary = f"✅ {n}: {len(tools)} tools — {', '.join(tool_names)}"
            if len(tools) > 8:
                summary += f" … +{len(tools)-8} more"
            results.append(summary)
            _log(f"[MCP] Connected {n}: {len(tools)} tools")
        except Exception as e:
            results.append(f"❌ {n}: {e}")
            _log(f"[MCP] Failed {n}: {e}")

    msg = "\n".join(results)
    if speak and results:
        first = results[0]
        speak(first[:120])
    return msg


# ─────────────────────────────────────────────────────────────────────────────
def mcp_tool_call(
    parameters: dict,
    player=None,
    speak: Callable[[str], None] | None = None,
) -> str:
    """
    Call a tool on a connected MCP server.

    parameters:
      server – MCP server name (required)
      tool   – tool name (required)
      **     – all other keys passed as tool arguments
    """
    def _log(msg: str):
        if player:
            try: player.write_log(msg)
            except Exception: pass

    server = parameters.get("server", "").strip()
    tool   = parameters.get("tool", "").strip()
    if not server or not tool:
        return "Please specify both 'server' and 'tool' parameters."

    # Extract tool arguments (everything except server and tool)
    tool_args = {k: v for k, v in parameters.items() if k not in ("server", "tool")}

    try:
        from agent.mcp_bridge import call_tool, _registry
        # Auto-connect if not yet connected
        if server not in _registry:
            connect_result = mcp_connect({"name": server}, player=player)
            _log(f"[MCP] Auto-connect: {connect_result[:80]}")

        _log(f"[MCP] Calling {server}/{tool}({tool_args})")
        result = call_tool(server, tool, tool_args)
        _log(f"[MCP] {server}/{tool} → {str(result)[:120]}")
        if speak:
            speak(str(result)[:200])
        return result
    except Exception as e:
        return f"[MCP] Tool call failed: {e}"


# ─────────────────────────────────────────────────────────────────────────────
def mcp_list(
    parameters: dict,
    player=None,
    speak: Callable[[str], None] | None = None,
) -> str:
    """
    List all configured and connected MCP servers with their tools.

    parameters: {} (none required)
    """
    try:
        from agent.mcp_bridge import list_servers
        servers = list_servers()
        if not servers:
            return ("No MCP servers configured. "
                    "Go to the MCP page or say 'add MCP server at <url>'.")

        lines = ["MCP Servers:"]
        for s in servers:
            status = "✅ connected" if s["connected"] else "○  offline"
            n_tools = f"({s['tools']} tools)" if s["connected"] else ""
            addr = s.get("url") or s.get("command") or "stdio"
            lines.append(f"  {status}  {s['name']}  {n_tools}  [{addr}]")

        msg = "\n".join(lines)
        if speak:
            connected = [s for s in servers if s["connected"]]
            if connected:
                speak(f"{len(connected)} MCP servers connected: "
                      f"{', '.join(s['name'] for s in connected[:3])}")
            else:
                speak("No MCP servers are currently connected.")
        return msg
    except Exception as e:
        return f"[MCP] List failed: {e}"
