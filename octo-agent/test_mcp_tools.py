import asyncio
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Import the tools from our new MCP server
try:
    from octo_mcp_server import octo_dev_agent, octo_deep_research
except Exception as e:
    print(f"Failed to import MCP server: {e}")
    sys.exit(1)

async def test_dev_agent():
    print("\n--- Testing octo_dev_agent ---")
    try:
        # Give it a very simple task that should finish quickly
        result = await octo_dev_agent(
            description="A python script that just prints 'Hello MCP'", 
            language="python", 
            project_name="Test_MCP_Hello"
        )
        print("Result:")
        print(result)
    except Exception as e:
        print(f"Error testing dev_agent: {e}")

async def test_deep_research():
    print("\n--- Testing octo_deep_research ---")
    try:
        # Give it a simple topic to avoid massive web scraping
        result = await octo_deep_research(topic="What is the capital of France?")
        print("Result:")
        print(result[:500] + "..." if len(result) > 500 else result)
    except Exception as e:
        print(f"Error testing deep_research: {e}")

async def main():
    print("Starting tests...")
    await test_dev_agent()
    await test_deep_research()
    print("\nTests finished.")

if __name__ == "__main__":
    asyncio.run(main())
