import sys
import asyncio
from pathlib import Path

# Ensure the octo directory is in the python path
BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

try:
    from mcp.server.fastmcp import FastMCP
except ImportError:
    print("mcp package is not installed. Please run: pip install mcp")
    sys.exit(1)

# Create the MCP server
mcp = FastMCP("OCTO-Pro")

@mcp.tool()
async def octo_deerflow_task(goal: str, mode: str = "standard") -> str:
    """
    Submits an arbitrary long-horizon task to DeerFlow's LangGraph super-agent.
    
    Args:
        goal: What the agent should accomplish (e.g., "Research the latest async python patterns").
        mode: Execution mode. Options: "flash" (fast), "standard" (balanced), "pro" (planning), "ultra" (full sub-agent orchestration).
    """
    try:
        from actions.deerflow_task import deerflow_task
        
        result = deerflow_task({
            "goal": goal,
            "mode": mode,
            "save": False
        })
        return str(result)
    except Exception as e:
        return f"Error executing DeerFlow task: {str(e)}"

@mcp.tool()
async def octo_dev_agent(description: str, language: str = "python", project_name: str = "OCTO_Project") -> str:
    """
    Instructs OCTO's dev_agent to autonomously plan, write, install dependencies, and self-heal a complete coding project.
    
    Args:
        description: Detailed description of the project you want to build.
        language: Programming language (default: "python").
        project_name: A folder name for the project (no spaces).
    """
    try:
        from actions.dev_agent import dev_agent
        
        result = dev_agent({
            "description": description,
            "language": language,
            "project_name": project_name,
            "timeout": 30
        })
        return str(result)
    except Exception as e:
        return f"Error executing dev_agent: {str(e)}"

@mcp.tool()
async def octo_deep_research(topic: str) -> str:
    """
    Triggers OCTO's deep web-crawling and synthesis module for extensive research tasks.
    
    Args:
        topic: The specific topic to research deeply.
    """
    try:
        from actions.deep_research import deep_research
        
        result = deep_research({
            "topic": topic,
            "report_type": "detailed",
            "save": False
        })
        return str(result)
    except Exception as e:
        return f"Error executing deep research: {str(e)}"

@mcp.tool()
async def octo_timesfm_forecast(symbol: str = "", mode: str = "cached", horizon: int = 8) -> str:
    """
    Queries or runs Google's TimesFM 2.5 AI model to forecast price direction for a symbol.
    If symbol is empty, returns a summary of the portfolio's cached forecasts.
    
    Args:
        symbol: The symbol to forecast (e.g. 'EURUSD+', 'XAUUSD+', 'NAS100').
        mode: Forecast mode: 'cached' (default, instant) or 'fresh' (runs new inference).
        horizon: Horizon in bars (default 8).
    """
    try:
        from actions.timesfm_forecaster import timesfm_action
        result = timesfm_action({
            "symbol": symbol,
            "mode": mode,
            "horizon": horizon,
            "portfolio": not symbol
        })
        return result
    except Exception as e:
        return f"Error executing TimesFM forecast: {str(e)}"

@mcp.tool()
async def octo_risk_manager_status() -> str:
    """
    Returns the current status and configurations of the G4 TimesFM Trading Risk Manager.
    Includes active gate mode, minimum confidence threshold, signal age, and watchlist.
    """
    try:
        import os
        scripts_path = str(BASE_DIR / "scripts")
        if scripts_path not in sys.path:
            sys.path.insert(0, scripts_path)
            
        from trading_risk_manager import TradingRiskManager
        rm = TradingRiskManager()
        
        summary = (
            "### 🛡️ G4 TimesFM Trading Risk Manager Status\n"
            f"- **Gate Mode**: `{rm.gate_mode}`\n"
            f"- **Minimum Confidence**: `{rm.min_conf * 100:.0f}%`\n"
            f"- **Max Signal Age**: `{rm.max_age} seconds`\n\n"
            "**Watchlist & Timeframes**:\n"
        )
        for sym, tf in rm.tf_map.items():
            summary += f"- **{sym}**: `{tf}`\n"
            
        return summary
    except Exception as e:
        return f"Error retrieving risk manager status: {str(e)}"

@mcp.tool()
async def octo_risk_manager_set_config(gate_mode: str = None, min_confidence: float = None) -> str:
    """
    Updates the configuration for the G4 TimesFM Trading Risk Manager dynamically.
    Updates the live_bot_config.json which is hot-reloaded by the live bot.
    
    Args:
        gate_mode: New gate mode to apply ('BLOCK', 'SOFT', 'WARN', 'OFF').
        min_confidence: New minimum AI confidence threshold (e.g. 0.65 for 65%).
    """
    try:
        import os
        scripts_path = str(BASE_DIR / "scripts")
        if scripts_path not in sys.path:
            sys.path.insert(0, scripts_path)
            
        from trading_risk_manager import TradingRiskManager
        rm = TradingRiskManager()
        
        updated = []
        if gate_mode is not None:
            gm = gate_mode.upper()
            if gm in ["BLOCK", "SOFT", "WARN", "OFF"]:
                rm.gate_mode = gm
                updated.append(f"gate_mode = {gm}")
            else:
                return f"Error: Invalid gate mode '{gate_mode}'. Must be one of BLOCK, SOFT, WARN, OFF."
                
        if min_confidence is not None:
            if 0.0 <= min_confidence <= 1.0:
                rm.min_conf = float(min_confidence)
                updated.append(f"min_confidence = {min_confidence:.2f}")
            else:
                return f"Error: min_confidence must be between 0.0 and 1.0."
                
        if updated:
            rm.save_config()
            return f"Success! Updated: {', '.join(updated)}. Live bot will hot-reload settings."
        else:
            return "No updates specified."
    except Exception as e:
        return f"Error updating risk manager config: {str(e)}"

if __name__ == "__main__":
    mcp.run(transport="stdio")
