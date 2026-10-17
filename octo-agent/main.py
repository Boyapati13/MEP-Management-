import asyncio
import re
import threading
import json
import sys
import traceback
from pathlib import Path
import logging

# Windows cp1252 terminals can't encode emoji — reconfigure stdout/stderr to UTF-8
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import sounddevice as sd
from google import genai
from google.genai import types
from ui import OctoUI
from memory.memory_manager import (
    load_memory, update_memory, format_memory_for_prompt,
)

from actions.file_processor import file_processor
from actions.flight_finder     import flight_finder
from actions.open_app          import open_app
from actions.weather_report    import weather_action
from actions.send_message      import send_message
from actions.reminder          import reminder
from actions.computer_settings import computer_settings
from actions.screen_processor  import screen_process
from actions.youtube_video     import youtube_video
from actions.desktop           import desktop_control
from actions.browser_control   import browser_control
from actions.file_controller   import file_controller
from actions.code_helper       import code_helper
from actions.dev_agent         import dev_agent
from actions.web_search        import web_search as web_search_action
from actions.computer_control  import computer_control
from actions.game_updater      import game_updater
from actions.deep_research     import deep_research as deep_research_action
from actions.deerflow_task     import deerflow_task as deerflow_task_action
from actions.mcp_connect       import mcp_connect, mcp_tool_call, mcp_list
from actions.timesfm_forecaster import timesfm_action  # G4: AI price forecasting



def get_base_dir():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent


BASE_DIR        = get_base_dir()
API_CONFIG_PATH = BASE_DIR / "config" / "api_keys.json"
PROMPT_PATH     = BASE_DIR / "core" / "prompt.txt"
_DEFAULT_LIVE_MODEL = "models/gemini-2.5-flash-native-audio-latest"

def _get_live_model() -> str:
    try:
        import json
        cfg = json.loads(API_CONFIG_PATH.read_text(encoding="utf-8"))
        m = cfg.get("live_model", "").strip()
        return m if m else _DEFAULT_LIVE_MODEL
    except Exception:
        return _DEFAULT_LIVE_MODEL
CHANNELS            = 1
SEND_SAMPLE_RATE    = 16000
RECEIVE_SAMPLE_RATE = 24000
CHUNK_SIZE          = 1024

def _get_api_key() -> str:
    try:
        with open(API_CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f).get("gemini_api_key", "")
    except Exception:
        return ""


def _load_system_prompt() -> str:
    try:
        return PROMPT_PATH.read_text(encoding="utf-8")
    except Exception:
        return (
            "You are OCTO, Tony Stark's AI assistant. "
            "Be concise, direct, and always use the provided tools to complete tasks. "
            "Never simulate or guess results — always call the appropriate tool."
        )

_CTRL_RE = re.compile(r"<ctrl\d+>", re.IGNORECASE)

def _clean_transcript(text: str) -> str:    
    text = _CTRL_RE.sub("", text)
    text = re.sub(r"[\x00-\x08\x0b-\x1f]", "", text)
    return text.strip()

TOOL_DECLARATIONS = [
    {
        "name": "open_app",
        "description": (
            "Opens any application on the computer. "
            "Use this whenever the user asks to open, launch, or start any app, "
            "website, or program. Always call this tool — never just say you opened it."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "app_name": {
                    "type": "STRING",
                    "description": "Exact name of the application (e.g. 'WhatsApp', 'Chrome', 'Spotify')"
                }
            },
            "required": ["app_name"]
        }
    },
    {
        "name": "web_search",
        "description": "Searches the web for any information.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query":  {"type": "STRING", "description": "Search query"},
                "mode":   {"type": "STRING", "description": "search (default) or compare"},
                "items":  {"type": "ARRAY", "items": {"type": "STRING"}, "description": "Items to compare"},
                "aspect": {"type": "STRING", "description": "price | specs | reviews"}
            },
            "required": ["query"]
        }
    },
    {
        "name": "weather_report",
        "description": "Gives the weather report to user",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "city": {"type": "STRING", "description": "City name"}
            },
            "required": ["city"]
        }
    },
    {
        "name": "send_message",
        "description": "Sends a text message via WhatsApp, Telegram, or other messaging platform.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "receiver":     {"type": "STRING", "description": "Recipient contact name"},
                "message_text": {"type": "STRING", "description": "The message to send"},
                "platform":     {"type": "STRING", "description": "Platform: WhatsApp, Telegram, etc."}
            },
            "required": ["receiver", "message_text", "platform"]
        }
    },
    {
        "name": "reminder",
        "description": "Sets a timed reminder using Task Scheduler.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "date":    {"type": "STRING", "description": "Date in YYYY-MM-DD format"},
                "time":    {"type": "STRING", "description": "Time in HH:MM format (24h)"},
                "message": {"type": "STRING", "description": "Reminder message text"}
            },
            "required": ["date", "time", "message"]
        }
    },
    {
        "name": "youtube_video",
        "description": (
            "Controls YouTube. Use for: playing videos, summarizing a video's content, "
            "getting video info, or showing trending videos."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action": {"type": "STRING", "description": "play | summarize | get_info | trending (default: play)"},
                "query":  {"type": "STRING", "description": "Search query for play action"},
                "save":   {"type": "BOOLEAN", "description": "Save summary to Notepad (summarize only)"},
                "region": {"type": "STRING", "description": "Country code for trending e.g. TR, US"},
                "url":    {"type": "STRING", "description": "Video URL for get_info action"},
            },
            "required": []
        }
    },
    {
        "name": "screen_process",
        "description": (
            "Captures and analyzes the screen or webcam image. "
            "MUST be called when user asks what is on screen, what you see, "
            "analyze my screen, look at camera, etc. "
            "You have NO visual ability without this tool. "
            "After calling this tool, stay SILENT — the vision module speaks directly."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "angle": {"type": "STRING", "description": "'screen' to capture display, 'camera' for webcam. Default: 'screen'"},
                "text":  {"type": "STRING", "description": "The question or instruction about the captured image"}
            },
            "required": ["text"]
        }
    },
    {
        "name": "computer_settings",
        "description": (
            "Controls the computer: volume, brightness, window management, keyboard shortcuts, "
            "typing text on screen, closing apps, fullscreen, dark mode, WiFi, restart, shutdown, "
            "scrolling, tab management, zoom, screenshots, lock screen, refresh/reload page. "
            "Use for ANY single computer control command. NEVER route to agent_task."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action":      {"type": "STRING", "description": "The action to perform"},
                "description": {"type": "STRING", "description": "Natural language description of what to do"},
                "value":       {"type": "STRING", "description": "Optional value: volume level, text to type, etc."}
            },
            "required": []
        }
    },
    {
        "name": "browser_control",
        "description": (
            "Controls any web browser. Use for: opening websites, searching the web, "
            "clicking elements, filling forms, scrolling, screenshots, navigation, any web-based task. "
            "Always pass the 'browser' parameter when the user specifies a browser (e.g. 'open in Edge', "
            "'use Firefox', 'open Chrome'). Multiple browsers can run simultaneously."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action":      {"type": "STRING", "description": "go_to | search | click | type | scroll | fill_form | smart_click | smart_type | get_text | get_url | press | new_tab | close_tab | screenshot | back | forward | reload | switch | list_browsers | close | close_all"},
                "browser":     {"type": "STRING", "description": "Target browser: chrome | edge | firefox | opera | operagx | brave | vivaldi | safari. Omit to use the currently active browser."},
                "url":         {"type": "STRING", "description": "URL for go_to / new_tab action"},
                "query":       {"type": "STRING", "description": "Search query for search action"},
                "engine":      {"type": "STRING", "description": "Search engine: google | bing | duckduckgo | yandex (default: google)"},
                "selector":    {"type": "STRING", "description": "CSS selector for click/type"},
                "text":        {"type": "STRING", "description": "Text to click or type"},
                "description": {"type": "STRING", "description": "Element description for smart_click/smart_type"},
                "direction":   {"type": "STRING", "description": "up | down for scroll"},
                "amount":      {"type": "INTEGER", "description": "Scroll amount in pixels (default: 500)"},
                "key":         {"type": "STRING", "description": "Key name for press action (e.g. Enter, Escape, F5)"},
                "path":        {"type": "STRING", "description": "Save path for screenshot"},
                "incognito":   {"type": "BOOLEAN", "description": "Open in private/incognito mode"},
                "clear_first": {"type": "BOOLEAN", "description": "Clear field before typing (default: true)"},
            },
            "required": ["action"]
        }
    },
    {
        "name": "file_controller",
        "description": "Manages files and folders: list, create, delete, move, copy, rename, read, write, find, disk usage.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action":      {"type": "STRING", "description": "list | create_file | create_folder | delete | move | copy | rename | read | write | find | largest | disk_usage | organize_desktop | info"},
                "path":        {"type": "STRING", "description": "File/folder path or shortcut: desktop, downloads, documents, home"},
                "destination": {"type": "STRING", "description": "Destination path for move/copy"},
                "new_name":    {"type": "STRING", "description": "New name for rename"},
                "content":     {"type": "STRING", "description": "Content for create_file/write"},
                "name":        {"type": "STRING", "description": "File name to search for"},
                "extension":   {"type": "STRING", "description": "File extension to search (e.g. .pdf)"},
                "count":       {"type": "INTEGER", "description": "Number of results for largest"},
            },
            "required": ["action"]
        }
    },
    {
        "name": "desktop_control",
        "description": "Controls the desktop: wallpaper, organize, clean, list, stats.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action": {"type": "STRING", "description": "wallpaper | wallpaper_url | organize | clean | list | stats | task"},
                "path":   {"type": "STRING", "description": "Image path for wallpaper"},
                "url":    {"type": "STRING", "description": "Image URL for wallpaper_url"},
                "mode":   {"type": "STRING", "description": "by_type or by_date for organize"},
                "task":   {"type": "STRING", "description": "Natural language desktop task"},
            },
            "required": ["action"]
        }
    },
    {
        "name": "code_helper",
        "description": "Writes, edits, explains, runs, or builds code files.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action":      {"type": "STRING", "description": "write | edit | explain | run | build | auto (default: auto)"},
                "description": {"type": "STRING", "description": "What the code should do or what change to make"},
                "language":    {"type": "STRING", "description": "Programming language (default: python)"},
                "output_path": {"type": "STRING", "description": "Where to save the file"},
                "file_path":   {"type": "STRING", "description": "Path to existing file for edit/explain/run/build"},
                "code":        {"type": "STRING", "description": "Raw code string for explain"},
                "args":        {"type": "STRING", "description": "CLI arguments for run/build"},
                "timeout":     {"type": "INTEGER", "description": "Execution timeout in seconds (default: 30)"},
            },
            "required": ["action"]
        }
    },
    {
        "name": "dev_agent",
        "description": "Builds complete multi-file projects from scratch: plans, writes files, installs deps, opens VSCode, runs and fixes errors.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "description":  {"type": "STRING", "description": "What the project should do"},
                "language":     {"type": "STRING", "description": "Programming language (default: python)"},
                "project_name": {"type": "STRING", "description": "Optional project folder name"},
                "timeout":      {"type": "INTEGER", "description": "Run timeout in seconds (default: 30)"},
            },
            "required": ["description"]
        }
    },
    {
        "name": "agent_task",
        "description": (
            "Executes complex multi-step tasks requiring multiple different tools. "
            "Examples: 'research X and save to file', 'find and organize files'. "
            "DO NOT use for single commands. NEVER use for Steam/Epic — use game_updater."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "goal":     {"type": "STRING", "description": "Complete description of what to accomplish"},
                "priority": {"type": "STRING", "description": "low | normal | high (default: normal)"}
            },
            "required": ["goal"]
        }
    },
    {
        "name": "computer_control",
        "description": "Direct computer control: type, click, hotkeys, scroll, move mouse, screenshots, find elements on screen.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action":      {"type": "STRING", "description": "type | smart_type | click | double_click | right_click | hotkey | press | scroll | move | copy | paste | screenshot | wait | clear_field | focus_window | screen_find | screen_click | random_data | user_data"},
                "text":        {"type": "STRING", "description": "Text to type or paste"},
                "x":           {"type": "INTEGER", "description": "X coordinate"},
                "y":           {"type": "INTEGER", "description": "Y coordinate"},
                "keys":        {"type": "STRING", "description": "Key combination e.g. 'ctrl+c'"},
                "key":         {"type": "STRING", "description": "Single key e.g. 'enter'"},
                "direction":   {"type": "STRING", "description": "up | down | left | right"},
                "amount":      {"type": "INTEGER", "description": "Scroll amount (default: 3)"},
                "seconds":     {"type": "NUMBER",  "description": "Seconds to wait"},
                "title":       {"type": "STRING",  "description": "Window title for focus_window"},
                "description": {"type": "STRING",  "description": "Element description for screen_find/screen_click"},
                "type":        {"type": "STRING",  "description": "Data type for random_data"},
                "field":       {"type": "STRING",  "description": "Field for user_data: name|email|city"},
                "clear_first": {"type": "BOOLEAN", "description": "Clear field before typing (default: true)"},
                "path":        {"type": "STRING",  "description": "Save path for screenshot"},
            },
            "required": ["action"]
        }
    },
    {
        "name": "game_updater",
        "description": (
            "THE ONLY tool for ANY Steam or Epic Games request. "
            "Use for: installing, downloading, updating games, listing installed games, "
            "checking download status, scheduling updates. "
            "ALWAYS call directly for any Steam/Epic/game request. "
            "NEVER use agent_task, browser_control, or web_search for Steam/Epic."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action":    {"type": "STRING",  "description": "update | install | list | download_status | schedule | cancel_schedule | schedule_status (default: update)"},
                "platform":  {"type": "STRING",  "description": "steam | epic | both (default: both)"},
                "game_name": {"type": "STRING",  "description": "Game name (partial match supported)"},
                "app_id":    {"type": "STRING",  "description": "Steam AppID for install (optional)"},
                "hour":      {"type": "INTEGER", "description": "Hour for scheduled update 0-23 (default: 3)"},
                "minute":    {"type": "INTEGER", "description": "Minute for scheduled update 0-59 (default: 0)"},
                "shutdown_when_done": {"type": "BOOLEAN", "description": "Shut down PC when download finishes"},
            },
            "required": []
        }
    },
    {
        "name": "flight_finder",
        "description": "Searches Google Flights and speaks the best options.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "origin":      {"type": "STRING",  "description": "Departure city or airport code"},
                "destination": {"type": "STRING",  "description": "Arrival city or airport code"},
                "date":        {"type": "STRING",  "description": "Departure date (any format)"},
                "return_date": {"type": "STRING",  "description": "Return date for round trips"},
                "passengers":  {"type": "INTEGER", "description": "Number of passengers (default: 1)"},
                "cabin":       {"type": "STRING",  "description": "economy | premium | business | first"},
                "save":        {"type": "BOOLEAN", "description": "Save results to Notepad"},
            },
            "required": ["origin", "destination", "date"]
        }
    },
    {
        "name": "schedule_task",
        "description": (
            "Schedule a recurring or one-time task using cron syntax. "
            "Use when user says 'every day', 'every Monday', 'at 9am every morning', "
            "'remind me weekly', 'schedule this to run nightly', etc."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "prompt":   {"type": "STRING", "description": "What OCTO should do when the job runs"},
                "schedule": {"type": "STRING", "description": "When to run: cron expression (e.g. '0 9 * * *') or natural language ('every day at 9am')"},
                "label":    {"type": "STRING", "description": "Short name for this job (optional)"},
            },
            "required": ["prompt", "schedule"]
        }
    },
    {
        "name": "shutdown_octo",
        "description": (
            "Shuts down the assistant completely. "
            "Call this when the user expresses intent to end the conversation, "
            "close the assistant, say goodbye, or stop OCTO. "
            "The user can say this in ANY language."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {},
        }
    },
    {
    "name": "file_processor",
    "description": (
        "Processes any file that the user has uploaded or dropped onto the interface. "
        "Use this when the user refers to an uploaded file and wants an action on it. "
        "Supports: images (describe/ocr/resize/compress/convert), "
        "PDFs (summarize/extract_text/to_word), "
        "Word docs & text files (summarize/fix/reformat/translate), "
        "CSV/Excel (analyze/stats/filter/sort/convert), "
        "JSON/XML (validate/format/analyze), "
        "code files (explain/review/fix/optimize/run/document/test), "
        "audio (transcribe/trim/convert/info), "
        "video (trim/extract_audio/extract_frame/compress/transcribe/info), "
        "archives (list/extract), "
        "presentations (summarize/extract_text). "
        "ALWAYS call this tool when a file has been uploaded and the user gives a command about it. "
        "If the user's command is ambiguous, pick the most logical action for that file type."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "file_path": {
                "type": "STRING",
                "description": "Full path to the uploaded file. Leave empty to use the currently uploaded file."
            },
            "action": {
                "type": "STRING",
                "description": (
                    "What to do with the file. Examples by type:\n"
                    "image: describe | ocr | resize | compress | convert | info\n"
                    "pdf: summarize | extract_text | to_word | info\n"
                    "docx/txt: summarize | fix | reformat | translate_hint | word_count | to_bullet\n"
                    "csv/excel: analyze | stats | filter | sort | convert | info\n"
                    "json: validate | format | analyze | to_csv\n"
                    "code: explain | review | fix | optimize | run | document | test\n"
                    "audio: transcribe | trim | convert | info\n"
                    "video: trim | extract_audio | extract_frame | compress | transcribe | info | convert\n"
                    "archive: list | extract\n"
                    "pptx: summarize | extract_text | analyze"
                )
            },
            "instruction": {
                "type": "STRING",
                "description": "Free-form instruction if action doesn't cover it. E.g. 'translate this to Turkish', 'find all email addresses'"
            },
            "format": {
                "type": "STRING",
                "description": "Target format for conversion. E.g. 'mp3', 'pdf', 'csv', 'png'"
            },
            "width":     {"type": "INTEGER", "description": "Target width for image resize"},
            "height":    {"type": "INTEGER", "description": "Target height for image resize"},
            "scale":     {"type": "NUMBER",  "description": "Scale factor for image resize (e.g. 0.5)"},
            "quality":   {"type": "INTEGER", "description": "Quality 1-100 for image/video compress"},
            "start":     {"type": "STRING",  "description": "Start time for trim: seconds or HH:MM:SS"},
            "end":       {"type": "STRING",  "description": "End time for trim: seconds or HH:MM:SS"},
            "timestamp": {"type": "STRING",  "description": "Timestamp for video frame extraction HH:MM:SS"},
            "column":    {"type": "STRING",  "description": "Column name for CSV filter/sort"},
            "value":     {"type": "STRING",  "description": "Filter value for CSV filter"},
            "condition": {"type": "STRING",  "description": "Filter condition: equals|contains|gt|lt"},
            "ascending": {"type": "BOOLEAN", "description": "Sort order for CSV sort (default: true)"},
            "save":      {"type": "BOOLEAN", "description": "Save result to file (default: true)"},
            "destination": {"type": "STRING", "description": "Output folder for archive extract"},
        },
        "required": []
    }
},
    {
        "name": "find_skill",
        "description": (
            "Searches the DeerFlow skill catalog for a skill matching the user's request. "
            "Use when user says 'find a skill for X', 'is there a skill that can X', "
            "'what skills do you have for X', or '/find-skill X'. "
            "Reports results by name and description."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Keyword(s) describing the desired skill"},
            },
            "required": ["query"]
        }
    },
    {
        "name": "list_skills",
        "description": "Lists all available DeerFlow skills. Use when user asks 'what skills do you have' or 'show all skills'.",
        "parameters": {
            "type": "OBJECT",
            "properties": {},
        }
    },
    {
        "name": "deep_research",
        "description": (
            "Performs long-horizon, multi-source deep research on any topic via DeerFlow sub-agents. "
            "Use for: comprehensive reports, multi-angle analysis, academic-style research, "
            "anything that takes 'minutes to hours'. "
            "Returns a full research report and optionally saves it to the Desktop."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "topic":       {"type": "STRING",  "description": "The research topic or question"},
                "report_type": {"type": "STRING",  "description": "detailed (default) | summary | bullets"},
                "save":        {"type": "BOOLEAN", "description": "Save report to Desktop (default: true)"},
                "model":       {"type": "STRING",  "description": "Override DeerFlow model (optional)"},
            },
            "required": ["topic"]
        }
    },
    {
        "name": "deerflow_task",
        "description": (
            "Submits any complex task to DeerFlow's LangGraph super-agent harness. "
            "Supports sub-agents, sandboxed code execution, and skill-augmented reasoning. "
            "Use for: data pipelines, slide deck creation, code projects, content workflows, "
            "anything that requires multiple AI agents working in parallel. "
            "Modes: flash (fast) | standard | pro (planning) | ultra (sub-agents)."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "goal":  {"type": "STRING", "description": "Full description of what to accomplish"},
                "mode":  {"type": "STRING", "description": "flash | standard | pro | ultra (default: standard)"},
                "save":  {"type": "BOOLEAN", "description": "Save result to Desktop (default: false)"},
                "model": {"type": "STRING",  "description": "Override DeerFlow model (optional)"},
            },
            "required": ["goal"]
        }
    },
    {
        "name": "save_memory",
        "description": (
            "Save an important personal fact about the user to long-term memory. "
            "Call this silently whenever the user reveals something worth remembering: "
            "name, age, city, job, preferences, hobbies, relationships, projects, or future plans. "
            "Do NOT call for: weather, reminders, searches, or one-time commands. "
            "Do NOT announce that you are saving — just call it silently. "
            "Values must be in English regardless of the conversation language."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "category": {
                    "type": "STRING",
                    "description": (
                        "identity — name, age, birthday, city, job, language, nationality | "
                        "preferences — favorite food/color/music/film/game/sport, hobbies | "
                        "projects — active projects, goals, things being built | "
                        "relationships — friends, family, partner, colleagues | "
                        "wishes — future plans, things to buy, travel dreams | "
                        "notes — habits, schedule, anything else worth remembering"
                    )
                },
                "key":   {"type": "STRING", "description": "Short snake_case key (e.g. name, favorite_food, sister_name)"},
                "value": {"type": "STRING", "description": "Concise value in English (e.g. Boyapati, pizza, older sister)"},
            },
            "required": ["category", "key", "value"]
        }
    },
    {
        "name": "mcp_connect",
        "description": (
            "Connect to an MCP (Model Context Protocol) server to gain access to its tools. "
            "Use when user says 'connect to X MCP', 'add MCP server', or needs tools from an external server. "
            "Supports both HTTP/SSE servers (url parameter) and stdio servers (command + args). "
            "If no name specified, connects all configured servers."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "name":    {"type": "STRING", "description": "MCP server name"},
                "url":     {"type": "STRING", "description": "HTTP/SSE endpoint URL (e.g. https://mcp.example.com/sse)"},
                "command": {"type": "STRING", "description": "Stdio command (e.g. npx)"},
                "args":    {"type": "ARRAY",  "items": {"type": "STRING"}, "description": "Args for stdio command"},
                "token":   {"type": "STRING", "description": "Auth token / API key for the server"},
            },
            "required": []
        }
    },
    {
        "name": "mcp_tool_call",
        "description": (
            "Call a specific tool on a connected MCP server. "
            "Use when user asks OCTO to use a tool from an MCP server (e.g. 'use the filesystem server to read file X'). "
            "Auto-connects the server if not yet connected. "
            "All extra parameters beyond 'server' and 'tool' are passed as tool arguments."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "server": {"type": "STRING", "description": "MCP server name"},
                "tool":   {"type": "STRING", "description": "Tool name on the MCP server"},
                "path":   {"type": "STRING", "description": "File path argument (common)"},
                "query":  {"type": "STRING", "description": "Query/search argument (common)"},
                "input":  {"type": "STRING", "description": "Generic input argument"},
            },
            "required": ["server", "tool"]
        }
    },
    {
        "name": "mcp_list",
        "description": (
            "List all configured and connected MCP servers and their available tools. "
            "Use when user asks 'what MCP servers do I have', 'what tools are available', etc."
        ),
        "parameters": {"type": "OBJECT", "properties": {}, "required": []}
    },
    {
        "name": "set_project",
        "description": (
            "Activate or deactivate a project so OCTO has full access to all its files, "
            "CMD, PowerShell, and security context for that project root directory. "
            "Use when user says 'work on project X', 'switch to project Y', 'open my X project'. "
            "Pass empty string to deactivate all projects."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "name": {"type": "STRING", "description": "Project name to activate (empty string to deactivate all)"}
            },
            "required": ["name"]
        }
    },
    {
        "name": "tradingview_mcp",
        "description": (
            "Controls your live TradingView Desktop chart via 79 MCP tools. "
            "Use for ANY TradingView or chart request: reading chart state/symbol/timeframe, "
            "RSI/MACD/BB/EMA values, Pine Script, alerts, screenshots of chart, drawings, "
            "replay, watchlist, indicators, pane layout. "
            "ALWAYS call this for any TradingView question. NEVER say you cannot see the chart."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action": {
                    "type": "STRING",
                    "description": (
                        "chart_state | indicator_values | screenshot | price | ohlcv | "
                        "set_symbol | set_timeframe | add_indicator | remove_indicator | "
                        "pine_get | pine_set | pine_compile | "
                        "create_alert | list_alerts | draw | watchlist | "
                        "pane_layout | tab_list | replay_start | replay_stop | "
                        "launch (auto-restart TradingView with CDP) | "
                        "health_check (verify CDP is working) | discover"
                    )
                },
                "symbol":      {"type": "STRING", "description": "Ticker e.g. BTCUSDT, AAPL"},
                "timeframe":   {"type": "STRING", "description": "Resolution e.g. 1 5 15 60 D W"},
                "indicator":   {"type": "STRING", "description": "Full name e.g. 'Relative Strength Index'"},
                "code":        {"type": "STRING", "description": "Pine Script source code"},
                "region":      {"type": "STRING", "description": "screenshot region: full | chart | strategy_tester"},
                "price_level": {"type": "NUMBER", "description": "Price level for drawings/alerts"},
                "message":     {"type": "STRING", "description": "Alert message text"},
                "layout":      {"type": "STRING", "description": "Pane layout: s | 2h | 2v | 4"},
                "study_filter":{"type": "STRING", "description": "Filter Pine output by indicator name"},
                "summary":     {"type": "BOOLEAN", "description": "Use summary mode for OHLCV (default true)"},
            },
            "required": ["action"]
        }
    },
    {
        "name": "mt5_mcp",
        "description": (
            "Controls MetaTrader 5 via 14 live trading tools. "
            "Use for ANY MT5 request: account balance/equity, open positions, pending orders, "
            "OHLCV candles, live price, place BUY/SELL orders, close trades, modify SL/TP, "
            "cancel orders, trade history, portfolio summary, and AI trading suggestions via Gemini. "
            "ALWAYS call this for any MetaTrader or trading question."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action": {
                    "type": "STRING",
                    "description": (
                        "account | price | candles | symbol_info | positions | orders | "
                        "history | buy | sell | close | close_all | modify | cancel | "
                        "suggest | portfolio"
                    )
                },
                "symbol":    {"type": "STRING",  "description": "Symbol e.g. EURUSD XAUUSD BTCUSD"},
                "timeframe": {"type": "STRING",  "description": "M1 M5 M15 M30 H1 H4 D1 W1"},
                "candles":   {"type": "INTEGER", "description": "Number of candles (default 50)"},
                "direction": {"type": "STRING",  "description": "BUY or SELL"},
                "lot_size":  {"type": "NUMBER",  "description": "Volume in lots e.g. 0.01 0.1 1.0"},
                "sl":        {"type": "NUMBER",  "description": "Stop loss price level"},
                "tp":        {"type": "NUMBER",  "description": "Take profit price level"},
                "ticket":    {"type": "INTEGER", "description": "Position or order ticket number"},
                "days":      {"type": "INTEGER", "description": "History lookback in days (default 7)"},
                "comment":   {"type": "STRING",  "description": "Order comment"},
            },
            "required": ["action"]
        }
    },
    {
        "name": "timesfm_forecast",
        "description": (
            "Runs Google's TimesFM 2.5 AI model to forecast price direction for any trading symbol. "
            "Use when the user asks: 'forecast gold', 'what does the AI say about EURUSD', "
            "'is TimesFM bullish on NAS100', 'show me the AI price prediction', "
            "'what is the AI bias for my portfolio', 'fresh forecast for XAUUSD'. "
            "Returns the directional bias (BULL/BEAR/NEUTRAL), confidence %, and expected price move. "
            "Also works for: 'portfolio forecast', 'show all AI signals', 'AI says what about my watchlist'."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "symbol":    {
                    "type": "STRING",
                    "description": "Symbol to forecast. Accepts common names: gold, eurusd, nasdaq, btc, oil. Leave empty for portfolio."
                },
                "mode":      {
                    "type": "STRING",
                    "description": "'cached' (instant, default) or 'fresh' (runs new inference, ~3 second delay)"
                },
                "horizon":   {
                    "type": "INTEGER",
                    "description": "How many bars ahead to forecast (default 8 = 8 hours on H1)"
                },
                "portfolio": {
                    "type": "BOOLEAN",
                    "description": "If true, return forecast for all watchlist symbols at once"
                },
            },
            "required": []
        }
    },
]

class OctoLive:

    def __init__(self, ui: OctoUI):
        self.ui                  = ui
        self.session             = None
        self.audio_in_queue      = None
        self.out_queue           = None
        self._loop               = None
        self._is_speaking        = False
        self._speaking_lock      = threading.Lock()
        self._reconnect_attempt  = 0
        self.ui.on_text_command  = self._on_text_command
        self._turn_done_event: asyncio.Event | None = None

    def _on_text_command(self, text: str):
        if not self._loop or not self.session:
            return
        asyncio.run_coroutine_threadsafe(
            self.session.send_client_content(
                turns={"parts": [{"text": text}]},
                turn_complete=True
            ),
            self._loop
        )

    def set_speaking(self, value: bool):
        with self._speaking_lock:
            self._is_speaking = value
        if value:
            self.ui.set_state("SPEAKING")
        elif not self.ui.muted:
            self.ui.set_state("LISTENING")

    def _do_set_project(self, name: str) -> str:
        """Activate or deactivate a project and return a confirmation string."""
        try:
            from ui_pages.project_page import set_active_project, _load_projects
            projects = _load_projects()
            if name:
                match = next((p for p in projects if p["name"].lower() == name.lower()), None)
                if not match:
                    # Fuzzy match
                    match = next(
                        (p for p in projects if name.lower() in p["name"].lower()), None
                    )
                if not match:
                    return (f"No project named '{name}' found. "
                            f"Available: {', '.join(p['name'] for p in projects) or 'none'}")
                set_active_project(match["name"])
                self.speak(f"Activating project {match['name']}, sir.")
                return (
                    f"Project '{match['name']}' activated. "
                    f"OCTO now has full access to {match['path']}."
                )
            else:
                set_active_project(None)
                self.speak("Project deactivated.")
                return "Project context cleared."
        except Exception as e:
            return f"Project switch failed: {e}"

    def speak(self, text: str):
        if not self._loop or not self.session:
            return
        asyncio.run_coroutine_threadsafe(
            self.session.send_client_content(
                turns={"parts": [{"text": text}]},
                turn_complete=True
            ),
            self._loop
        )

    def speak_error(self, tool_name: str, error: str):
        short = str(error)[:120]
        self.ui.write_log(f"ERR: {tool_name} — {short}")
        self.speak(f"Sir, {tool_name} encountered an error. {short}")

    def _build_config(self) -> types.LiveConnectConfig:
        from datetime import datetime

        memory     = load_memory()
        mem_str    = format_memory_for_prompt(memory)
        sys_prompt = _load_system_prompt()

        now      = datetime.now()
        time_str = now.strftime("%A, %B %d, %Y — %I:%M %p")
        time_ctx = (
            f"[CURRENT DATE & TIME]\n"
            f"Right now it is: {time_str}\n"
            f"Use this to calculate exact times for reminders.\n\n"
        )

        parts = [time_ctx]
        if mem_str:
            parts.append(mem_str)

        # Active project context — gives OCTO full access scope
        try:
            from ui_pages.project_page import get_active_project
            proj = get_active_project()
            if proj:
                parts.append(
                    f"[ACTIVE PROJECT]\n"
                    f"Name: {proj['name']}\n"
                    f"Root path: {proj['path']}\n"
                    f"OCTO has FULL ACCESS to this project: all files, subdirectories, "
                    f"CMD, PowerShell, and security context. "
                    f"All file operations and terminal commands default to this root unless overridden. "
                    f"Desc: {proj.get('desc','')}\n\n"
                )
        except Exception:
            pass

        # ── MCP context — tells Gemini which servers are live ─────────────────
        try:
            from agent.mcp_bridge import list_servers, get_all_tools, start_all
            start_all()
            connected = [s for s in list_servers() if s["connected"]]
            if connected:
                mcp_lines = ["[CONNECTED MCP SERVERS]"]
                all_tools = get_all_tools()
                for srv in connected:
                    srv_tools = [t["name"] for t in all_tools
                                 if t.get("mcp_server") == srv["name"]][:20]
                    mcp_lines.append(
                        f"• {srv['name']}  ({srv['tools']} tools) — "
                        f"use mcp_tool_call with server='{srv['name']}'. "
                        f"Key tools: {', '.join(srv_tools[:8])}"
                    )
                mcp_lines.append(
                    "IMPORTANT: When user asks about TradingView, chart, RSI, MACD, Pine Script, "
                    "indicators, alerts, screenshot of chart, or any trading concept — "
                    "call tradingview_mcp tool directly. Never say you are not connected."
                )
                parts.append("\n".join(mcp_lines) + "\n")
        except Exception:
            pass

        # ── Live Volume Profile & MT5 snapshot — injected from background VP service ──
        try:
            import json as _j
            from pathlib import Path as _P
            _vp_path = _P(__file__).resolve().parent / "scripts" / "volume_profile_live.json"
            if _vp_path.exists():
                _vp = _j.loads(_vp_path.read_text(encoding="utf-8"))
                _syms = _vp.get("symbols", {})
                _gen  = _vp.get("generated_at", "")
                if _syms:
                    vp_lines = [
                        f"[LIVE VOLUME PROFILE & WHALE ENGINE DATA — {_gen}]",
                        "Computed from M15 MT5 data. Use these EXACT numbers to answer trading questions. Never say you cannot access live data.",
                        ""
                    ]
                    for _sk, _sv in _syms.items():
                        if "error" in _sv:
                            continue
                        _w  = _sv.get("whale", {})
                        _v  = _sv.get("volume", {})
                        _fvg = _sv.get("fvg_recent", [])
                        fvg_str = ""
                        if _fvg:
                            lf = _fvg[-1]
                            fvg_str = f" | FVG({lf['type']}): {lf['bottom']}–{lf['top']}"
                        vp_lines.append(
                            f"[{_sk}] Price={_sv.get('current_price')} "
                            f"POC={_sv.get('poc')} VAH={_sv.get('vah')} VAL={_sv.get('val')} "
                            f"Bias={_sv.get('bias','')} "
                            f"PDH={_sv.get('pdh')} PDL={_sv.get('pdl')} "
                            f"NearPDH={_sv.get('near_pdh')} NearPDL={_sv.get('near_pdl')} "
                            f"WhaleAlpha={_w.get('dynamic_alpha')} VR={_w.get('volatility_ratio_vr')} State={_w.get('state','')}"
                            f"{fvg_str}"
                        )
                    parts.append("\n".join(vp_lines) + "\n")
        except Exception:
            pass

        parts.append(sys_prompt)

        return types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            output_audio_transcription=types.AudioTranscriptionConfig(),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            system_instruction="\n".join(parts),
            tools=[{"function_declarations": TOOL_DECLARATIONS}],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name="Charon"
                    )
                )
            ),
        )

    async def _execute_tool(self, fc) -> types.FunctionResponse:
        name = fc.name
        args = dict(fc.args or {})

        print(f"[OCTO] 🔧 {name}  {args}")
        self.ui.set_state("THINKING")

        if name == "save_memory":
            category = args.get("category", "notes")
            key      = args.get("key", "")
            value    = args.get("value", "")
            if key and value:
                update_memory({category: {key: {"value": value}}})
                print(f"[Memory] 💾 save_memory: {category}/{key} = {value}")
            if not self.ui.muted:
                self.ui.set_state("LISTENING")
            return types.FunctionResponse(
                id=fc.id, name=name,
                response={"result": "ok", "silent": True}
            )

        loop   = asyncio.get_event_loop()
        result = "Done."

        try:
            if name == "open_app":
                r = await loop.run_in_executor(None, lambda: open_app(parameters=args, response=None, player=self.ui))
                result = r or f"Opened {args.get('app_name')}."

            elif name == "weather_report":
                r = await loop.run_in_executor(None, lambda: weather_action(parameters=args, player=self.ui))
                result = r or "Weather delivered."

            elif name == "browser_control":
                r = await loop.run_in_executor(None, lambda: browser_control(parameters=args, player=self.ui))
                result = r or "Done."

            elif name == "file_controller":
                r = await loop.run_in_executor(None, lambda: file_controller(parameters=args, player=self.ui))
                result = r or "Done."

            elif name == "send_message":
                r = await loop.run_in_executor(None, lambda: send_message(parameters=args, response=None, player=self.ui, session_memory=None))
                result = r or f"Message sent to {args.get('receiver')}."

            elif name == "reminder":
                r = await loop.run_in_executor(None, lambda: reminder(parameters=args, response=None, player=self.ui))
                result = r or "Reminder set."

            elif name == "youtube_video":
                r = await loop.run_in_executor(None, lambda: youtube_video(parameters=args, response=None, player=self.ui))
                result = r or "Done."

            elif name == "screen_process":
                threading.Thread(
                    target=screen_process,
                    kwargs={"parameters": args, "response": None,
                            "player": self.ui, "session_memory": None,
                            "speak": self.speak},
                    daemon=True
                ).start()
                result = "Vision module activated — analysing now."

            elif name == "computer_settings":
                r = await loop.run_in_executor(None, lambda: computer_settings(parameters=args, response=None, player=self.ui))
                result = r or "Done."

            elif name == "desktop_control":
                r = await loop.run_in_executor(None, lambda: desktop_control(parameters=args, player=self.ui))
                result = r or "Done."

            elif name == "code_helper":
                r = await loop.run_in_executor(None, lambda: code_helper(parameters=args, player=self.ui, speak=self.speak))
                result = r or "Done."

            elif name == "dev_agent":
                r = await loop.run_in_executor(None, lambda: dev_agent(parameters=args, player=self.ui, speak=self.speak))
                result = r or "Done."

            elif name == "agent_task":
                from agent.task_queue import get_queue, TaskPriority
                priority_map = {"low": TaskPriority.LOW, "normal": TaskPriority.NORMAL, "high": TaskPriority.HIGH}
                priority = priority_map.get(args.get("priority", "normal").lower(), TaskPriority.NORMAL)
                task_id  = get_queue().submit(goal=args.get("goal", ""), priority=priority, speak=self.speak)
                result   = f"Task started (ID: {task_id})."

            elif name == "web_search":
                r = await loop.run_in_executor(None, lambda: web_search_action(parameters=args, player=self.ui))
                result = r or "Done."
            elif name == "file_processor":
                if not args.get("file_path") and self.ui.current_file:
                    args["file_path"] = self.ui.current_file
                r = await loop.run_in_executor(
                    None,
                    lambda: file_processor(parameters=args, player=self.ui, speak=self.speak)
                )
                result = r or "Done."

            elif name == "computer_control":
                r = await loop.run_in_executor(None, lambda: computer_control(parameters=args, player=self.ui))
                result = r or "Done."

            elif name == "game_updater":
                r = await loop.run_in_executor(None, lambda: game_updater(parameters=args, player=self.ui, speak=self.speak))
                result = r or "Done."

            elif name == "flight_finder":
                r = await loop.run_in_executor(None, lambda: flight_finder(parameters=args, player=self.ui))
                result = r or "Done."

            elif name == "schedule_task":
                from agent.hermes_bridge import create_cron_job, sync_memory_to_hermes
                sync_memory_to_hermes()
                job = await loop.run_in_executor(None, lambda: create_cron_job(
                    prompt=args.get("prompt", ""),
                    schedule=args.get("schedule", "0 9 * * *"),
                    label=args.get("label", ""),
                ))
                if job:
                    result = f"Scheduled: '{args.get('label') or args.get('prompt', '')[:40]}' — {args.get('schedule')}."
                else:
                    result = "Could not create schedule — check the cron expression, sir."

            elif name == "shutdown_octo":
                self.ui.write_log("SYS: Shutdown requested.")
                self.speak("Goodbye, sir.")
                def _shutdown():
                    import time, os
                    time.sleep(1)
                    os._exit(0)
                threading.Thread(target=_shutdown, daemon=True).start()

            elif name == "find_skill":
                from skills.skill_manager import find_skill
                res = find_skill(query=args.get("query", ""))
                self.ui.write_log(res["log_detail"])
                result = res["voice_summary"]

            elif name == "list_skills":
                from skills.skill_manager import list_all_skills
                res = list_all_skills()
                self.ui.write_log(res["log_detail"])
                result = res["voice_summary"]

            elif name == "deep_research":
                r = await loop.run_in_executor(
                    None,
                    lambda: deep_research_action(parameters=args, player=self.ui, speak=self.speak)
                )
                result = r or "Research complete."

            elif name == "deerflow_task":
                self.ui.write_log("[OCTO] 🔧 deerflow_task  " + str(args)[:80])
                r = await loop.run_in_executor(
                    None,
                    lambda: deerflow_task_action(parameters=args, player=self.ui, speak=self.speak)
                )
                result = r or "Task complete."
            elif name == "mcp_connect":
                self.ui.write_log("[OCTO] 🔌 mcp_connect  " + str(args)[:80])
                r = await loop.run_in_executor(
                    None,
                    lambda: mcp_connect(parameters=args, player=self.ui, speak=self.speak)
                )
                result = r or "Connected."
            elif name == "mcp_tool_call":
                self.ui.write_log("[OCTO] 🔌 mcp_tool_call  " + str(args)[:80])
                r = await loop.run_in_executor(
                    None,
                    lambda: mcp_tool_call(parameters=args, player=self.ui, speak=self.speak)
                )
                result = r or "Done."
            elif name == "mcp_list":
                r = await loop.run_in_executor(
                    None,
                    lambda: mcp_list(parameters=args, player=self.ui, speak=self.speak)
                )
                result = r or "No MCP servers configured."
            elif name == "set_project":
                proj_name = args.get("name", "").strip()
                self.ui.write_log(f"[OCTO] 🗂 set_project: {proj_name or '(deactivate)'}")
                r = await loop.run_in_executor(None, lambda pn=proj_name: self._do_set_project(pn))
                result = r or "Project updated."

            elif name == "tradingview_mcp":
                action = args.get("action", "chart_state")
                self.ui.write_log(f"[OCTO] 📈 tradingview_mcp:{action}  {args}")

                # Map friendly action names → real TradingView MCP tool names
                _TV_ACTION_MAP = {
                    "chart_state":       ("chart_get_state",         {}),
                    "indicator_values":  ("data_get_study_values",   {"summary": True}),
                    "screenshot":        ("capture_screenshot",       {"region": args.get("region", "chart")}),
                    "price":             ("quote_get",                {}),
                    "ohlcv":             ("data_get_ohlcv",           {"summary": args.get("summary", True)}),
                    "set_symbol":        ("chart_set_symbol",         {"symbol": args.get("symbol", "")}),
                    "set_timeframe":     ("chart_set_timeframe",      {"timeframe": args.get("timeframe", "")}),
                    "add_indicator":     ("chart_manage_indicator",   {"action": "add", "indicator_name": args.get("indicator", "")}),
                    "remove_indicator":  ("chart_manage_indicator",   {"action": "remove", "indicator_name": args.get("indicator", "")}),
                    "pine_get":          ("pine_get_source",          {}),
                    "pine_set":          ("pine_set_source",          {"source": args.get("code", "")}),
                    "pine_compile":      ("pine_smart_compile",       {}),
                    "create_alert":      ("alert_create",             {"name": "OCTO Alert", "condition": args.get("message", ""), "frequency": "once"}),
                    "list_alerts":       ("alert_list",               {}),
                    "draw":              ("draw_shape",               {"type": "horizontal_line", "price": args.get("price_level", 0)}),
                    "watchlist":         ("watchlist_get",            {}),
                    "pane_layout":       ("pane_set_layout",          {"layout": args.get("layout", "s")}),
                    "tab_list":          ("tab_list",                 {}),
                    "replay_start":      ("replay_start",             {}),
                    "replay_stop":       ("replay_stop",              {}),
                    # Health / launch — fix CDP connection
                    "launch":            None,   # handled below via PowerShell
                    "health_check":      ("tv_health_check",          {}),
                    "discover":          ("tv_discover",              {}),
                }

                if action not in _TV_ACTION_MAP:
                    result = (f"Unknown TradingView action '{action}'. "
                              f"Available: {', '.join(_TV_ACTION_MAP.keys())}")

                elif action == "launch":
                    # MSIX (Windows Store) app — must launch via PowerShell
                    # since the exe is in ACL-protected WindowsApps folder
                    script = os.path.join(
                        os.path.dirname(__file__), "scripts", "launch_tradingview.ps1"
                    )
                    def _tv_launch_ps():
                        import subprocess, json as _json
                        try:
                            out = subprocess.check_output(
                                ["powershell", "-ExecutionPolicy", "Bypass",
                                 "-File", script, "-Port", "9222"],
                                timeout=25, text=True, stderr=subprocess.STDOUT
                            ).strip()
                            self.ui.write_log(f"[TV] launch → {out[-200:]}")
                            if out.startswith("SUCCESS:"):
                                return {"success": True, "message": "TradingView launched with CDP on port 9222.", "path": out[8:]}
                            elif out.startswith("LAUNCHED_NO_CDP:"):
                                return {"success": True, "message": "TradingView launched but CDP not ready yet — try 'check TradingView' in a few seconds.", "path": out[16:]}
                            else:
                                return {"success": False, "error": out[-300:]}
                        except subprocess.TimeoutExpired:
                            return {"success": True, "message": "TradingView is starting up — CDP may take a few more seconds."}
                        except Exception as ex:
                            return {"success": False, "error": str(ex)}
                    r = await loop.run_in_executor(None, _tv_launch_ps)
                    result = r or "Launching TradingView…"
                    self.ui.write_log(f"[TV] launch result: {str(result)[:200]}")

                else:
                    # All other TV actions — call via MCP bridge
                    tool_name, base_args = _TV_ACTION_MAP[action]
                    # Merge base args with any user-supplied args (user args win)
                    call_args = {**base_args}
                    for k in ("symbol", "timeframe", "indicator", "code",
                              "region", "price_level", "message", "layout",
                              "study_filter", "summary"):
                        if args.get(k) is not None:
                            call_args[k] = args[k]

                    def _tv_call(tn=tool_name, ca=call_args):
                        from agent.mcp_bridge import call_tool, _registry
                        if "tradingview" not in _registry:
                            from agent.mcp_bridge import start_all
                            start_all()
                        return call_tool("tradingview", tn, ca)

                    r = await loop.run_in_executor(None, _tv_call)
                    result = r or "Done."
                    self.ui.write_log(f"[TV] {tool_name} → {str(result)[:200]}")

            elif name == "mt5_mcp":
                action = args.get("action", "account")
                self.ui.write_log(f"[OCTO] 💹 mt5_mcp:{action}  {args}")

                _MT5_MAP = {
                    "account":   ("get_account_metrics",        {}),
                    "price":     ("get_live_price",             {"symbol": args.get("symbol", "EURUSD")}),
                    "candles":   ("fetch_market_candles",       {
                                     "symbol":       args.get("symbol", "EURUSD"),
                                     "timeframe":    args.get("timeframe", "H1"),
                                     "candle_count": args.get("candles", 50),
                                 }),
                    "symbol_info": ("get_symbol_info",          {"symbol": args.get("symbol", "EURUSD")}),
                    "positions": ("get_open_positions",         {"symbol": args.get("symbol")}),
                    "orders":    ("get_pending_orders",         {"symbol": args.get("symbol")}),
                    "history":   ("get_trade_history",          {
                                     "symbol": args.get("symbol"),
                                     "days":   args.get("days", 7),
                                 }),
                    "buy":       ("place_immediate_market_order", {
                                     "symbol":    args.get("symbol", ""),
                                     "direction": "BUY",
                                     "lot_size":  args.get("lot_size", 0.01),
                                     "sl":        args.get("sl"),
                                     "tp":        args.get("tp"),
                                     "comment":   args.get("comment", "OCTO AI"),
                                 }),
                    "sell":      ("place_immediate_market_order", {
                                     "symbol":    args.get("symbol", ""),
                                     "direction": "SELL",
                                     "lot_size":  args.get("lot_size", 0.01),
                                     "sl":        args.get("sl"),
                                     "tp":        args.get("tp"),
                                     "comment":   args.get("comment", "OCTO AI"),
                                 }),
                    "close":     ("close_position",             {"ticket": args.get("ticket", 0)}),
                    "close_all": ("close_all_positions",        {"symbol": args.get("symbol")}),
                    "modify":    ("modify_position",            {
                                     "ticket": args.get("ticket", 0),
                                     "sl":     args.get("sl"),
                                     "tp":     args.get("tp"),
                                 }),
                    "cancel":    ("cancel_order",               {"ticket": args.get("ticket", 0)}),
                    "suggest":   ("get_trading_suggestion",     {
                                     "symbol":       args.get("symbol", "EURUSD"),
                                     "timeframe":    args.get("timeframe", "H1"),
                                     "candle_count": args.get("candles", 50),
                                 }),
                    "portfolio": ("get_portfolio_summary",      {}),
                }

                if action not in _MT5_MAP:
                    result = (f"Unknown MT5 action '{action}'. "
                              f"Available: {', '.join(_MT5_MAP.keys())}")
                else:
                    mt5_tool, mt5_args = _MT5_MAP[action]
                    # Remove None values so MT5 server uses defaults
                    mt5_args = {k: v for k, v in mt5_args.items() if v is not None}

                    def _mt5_call(tn=mt5_tool, ca=mt5_args):
                        from agent.mcp_bridge import call_tool, _registry
                        if "metatrader5" not in _registry:
                            from agent.mcp_bridge import start_all
                            start_all()
                        return call_tool("metatrader5", tn, ca)

                    r = await loop.run_in_executor(None, _mt5_call)
                    result = r or "Done."
                    self.ui.write_log(f"[MT5] {mt5_tool} → {str(result)[:300]}")


            elif name == "timesfm_forecast":
                self.ui.write_log(f"[OCTO] 🤖 timesfm_forecast  {args}")
                r = await loop.run_in_executor(
                    None,
                    lambda: timesfm_action(parameters=args, player=self.ui)
                )
                result = r or "Forecast unavailable — run the TimesFM forecaster first."

            else:
                result = f"Unknown tool: {name}"

        except Exception as e:
            result = f"Tool '{name}' failed: {e}"
            traceback.print_exc()
            self.speak_error(name, e)

        if not self.ui.muted:
            self.ui.set_state("LISTENING")

        print(f"[OCTO] 📤 {name} → {str(result)[:80]}")
        return types.FunctionResponse(
            id=fc.id, name=name,
            response={"result": result}
        )

    async def _greet(self):
        await asyncio.sleep(0.8)   # let audio streams fully start
        if self.session:
            await self.session.send_client_content(
                turns={"parts": [{"text": "Greet the user in one short sentence and say you are ready."}]},
                turn_complete=True,
            )

    async def _wrap_task(self, coro):
        """Run a coroutine and swallow/log exceptions so TaskGroup doesn't cancel everything."""
        try:
            await coro
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[OCTO] ❌ Task failed (handled): {e}")
            traceback.print_exc()
            try:
                self.ui.write_log(f"ERR: unhandled task error — {str(e)[:120]}")
            except Exception:
                pass

    async def _send_realtime(self):
        while True:
            msg = await self.out_queue.get()
            try:
                await self.session.send_realtime_input(
                    audio=types.Blob(
                        data=msg["data"],
                        mime_type=msg.get("mime_type", "audio/pcm"),
                    )
                )
            except Exception as e:
                print(f"[OCTO] ❌ Realtime send failed: {e}")
                try:
                    self.ui.write_log(f"ERR: realtime send failed — {str(e)[:120]}")
                except Exception as inner_e:
                    logging.error("Failed to write to UI log during realtime send failure", exc_info=inner_e)

    async def _listen_audio(self):
        print("[OCTO] 🎤 Mic started")
        loop = asyncio.get_event_loop()

        def callback(indata, frames, time_info, status):
            with self._speaking_lock:
                OCTO_speaking = self._is_speaking
            if not OCTO_speaking and not self.ui.muted:
                data = indata.tobytes()
                # Use a safe put function scheduled on the event loop so a
                # full queue does not raise an unhandled exception in the
                # callback thread. Drop frames when the queue is full.
                def _safe_put(item):
                    try:
                        self.out_queue.put_nowait(item)
                    except asyncio.QueueFull:
                        # drop audio frame when consumer is lagging
                        return

                loop.call_soon_threadsafe(
                    _safe_put,
                    {"data": data, "mime_type": "audio/pcm"}
                )

        try:
            with sd.InputStream(
                samplerate=SEND_SAMPLE_RATE,
                channels=CHANNELS,
                dtype="int16",
                blocksize=CHUNK_SIZE,
                callback=callback,
            ):
                print("[OCTO] 🎤 Mic stream open")
                while True:
                    await asyncio.sleep(0.1)
        except Exception as e:
            print(f"[OCTO] ⚠️ Mic stream initialization failed: {e}")
            try:
                self.ui.write_log("SYS: Audio input driver missing or failed — mic disabled.")
            except Exception:
                pass
            while True:
                await asyncio.sleep(3600)

    async def _receive_audio(self):
        print("[OCTO] 👂 Recv started")
        out_buf, in_buf = [], []

        try:
            while True:
                async for response in self.session.receive():

                    if response.data:
                        if self._turn_done_event and self._turn_done_event.is_set():
                            self._turn_done_event.clear()
                        self.audio_in_queue.put_nowait(response.data)

                    if response.server_content:
                        sc = response.server_content

                        if sc.output_transcription and sc.output_transcription.text:
                            txt = _clean_transcript(sc.output_transcription.text)
                            if txt:
                                out_buf.append(txt)

                        if sc.input_transcription and sc.input_transcription.text:
                            txt = _clean_transcript(sc.input_transcription.text)
                            if txt:
                                in_buf.append(txt)

                        if sc.turn_complete:
                            if self._turn_done_event:
                                self._turn_done_event.set()

                            full_in = " ".join(in_buf).strip()
                            if full_in:
                                self.ui.write_log(f"You: {full_in}")
                            in_buf = []

                            full_out = " ".join(out_buf).strip()
                            if full_out:
                                self.ui.write_log(f"OCTO: {full_out}")
                            out_buf = []

                    if response.tool_call:
                        fn_responses = []
                        for fc in response.tool_call.function_calls:
                            print(f"[OCTO] 📞 {fc.name}")
                            fr = await self._execute_tool(fc)
                            fn_responses.append(fr)
                        await self.session.send_tool_response(
                            function_responses=fn_responses
                        )
        except Exception as e:
            print(f"[OCTO] ❌ Recv: {e}")
            traceback.print_exc()
            raise

    async def _play_audio(self):
        print("[OCTO] 🔊 Play started")

        try:
            stream = sd.RawOutputStream(
                samplerate=RECEIVE_SAMPLE_RATE,
                channels=CHANNELS,
                dtype="int16",
                blocksize=CHUNK_SIZE,
            )
            stream.start()
        except Exception as e:
            print(f"[OCTO] ⚠️ Play initialization failed: {e}")
            try:
                self.ui.write_log("SYS: Audio output driver missing or failed — voice disabled.")
            except Exception:
                pass
            try:
                while True:
                    try:
                        chunk = await asyncio.wait_for(
                            self.audio_in_queue.get(),
                            timeout=0.1
                        )
                    except asyncio.TimeoutError:
                        if (
                            self._turn_done_event
                            and self._turn_done_event.is_set()
                            and self.audio_in_queue.empty()
                        ):
                            self.set_speaking(False)
                            self._turn_done_event.clear()
                        continue
                    self.set_speaking(True)
                    # Simulate playing speed
                    await asyncio.sleep(len(chunk) / (RECEIVE_SAMPLE_RATE * CHANNELS * 2))
            except Exception:
                pass
            finally:
                self.set_speaking(False)
                while True:
                    await asyncio.sleep(3600)
            return

        try:
            while True:
                try:
                    chunk = await asyncio.wait_for(
                        self.audio_in_queue.get(),
                        timeout=0.1
                    )
                except asyncio.TimeoutError:
                    if (
                        self._turn_done_event
                        and self._turn_done_event.is_set()
                        and self.audio_in_queue.empty()
                    ):
                        self.set_speaking(False)
                        try:
                            self.ui.set_amplitude(0.0)
                        except Exception:
                            pass
                        self._turn_done_event.clear()
                    continue
                
                self.set_speaking(True)
                
                # Real-time voice amplitude calculations for dynamic 3D lip-syncing
                try:
                    import struct
                    count = len(chunk) // 2
                    if count > 0:
                        shorts = struct.unpack(f"<{count}h", chunk)
                        mean_abs = sum(abs(s) for s in shorts) / count
                        # Scale speaking peaks to normal [0.0, 1.0] range
                        amplitude = min(1.0, mean_abs / 4000.0)
                        self.ui.set_amplitude(amplitude)
                except Exception:
                    pass

                await asyncio.to_thread(stream.write, chunk)
        except Exception as e:
            print(f"[OCTO] ❌ Play: {e}")
            raise
        finally:
            self.set_speaking(False)
            try:
                self.ui.set_amplitude(0.0)
            except Exception:
                pass
            try:
                stream.stop()
                stream.close()
            except Exception:
                pass

    async def run(self):
        while True:
            try:
                client = genai.Client(
                    api_key=_get_api_key(),
                    http_options={"api_version": "v1beta"}
                )
                print("[OCTO] 🔌 Connecting...")
                self.ui.set_state("THINKING")
                config = self._build_config()

                async with (
                    client.aio.live.connect(model=_get_live_model(), config=config) as session,
                    asyncio.TaskGroup() as tg,
                ):
                    self.session        = session
                    self._loop          = asyncio.get_event_loop()
                    self.audio_in_queue = asyncio.Queue()
                    self.out_queue      = asyncio.Queue(maxsize=10)
                    self._turn_done_event = asyncio.Event()

                    print("[OCTO] ✅ Connected.")
                    self._reconnect_attempt = 0
                    self.ui.set_state("LISTENING")
                    self.ui.write_log("SYS: OCTO online.")

                    # Critical tasks: failures propagate to TaskGroup → triggers reconnect.
                    tg.create_task(self._send_realtime())
                    tg.create_task(self._listen_audio())
                    tg.create_task(self._receive_audio())
                    tg.create_task(self._play_audio())
                    # Non-critical: greeting failure should not kill the session.
                    tg.create_task(self._wrap_task(self._greet()))

            except BaseException as e:
                if isinstance(e, (KeyboardInterrupt, SystemExit, GeneratorExit)):
                    raise
                inner = e
                if hasattr(e, "exceptions") and e.exceptions:
                    if any(isinstance(x, (KeyboardInterrupt, SystemExit)) for x in e.exceptions):
                        raise
                    inner = e.exceptions[0]
                err = str(inner)
                err_low = err.lower()
                invalid_key = any(k in err_low for k in (
                    "leaked", "policy violation", "1008",
                    "invalid api key", "api key not valid",
                    "api_key_invalid", "use another api key",
                ))
                expired_key = any(k in err_low for k in (
                    "1007", "expired", "api key expired", "key expired"
                ))
                if invalid_key:
                    self.ui.write_log("ERR: API key rejected — enter a new key.")
                    self.ui.show_setup()
                    await asyncio.to_thread(self.ui.wait_for_api_key)
                    continue
                if expired_key:
                    self.ui.write_log("ERR: API key expired — enter a renewed key.")
                    self.ui.show_setup()
                    await asyncio.to_thread(self.ui.wait_for_api_key)
                    continue
                print(f"[OCTO] ⚠️ {err}")
                self.ui.write_log(f"ERR: {err[:120]}")
                traceback.print_exc()
            self.set_speaking(False)
            self.ui.set_state("THINKING")
            self._reconnect_attempt += 1
            delay = min(3.0 * (2 ** min(self._reconnect_attempt - 1, 5)), 60.0)
            jitter = delay * 0.4 * __import__("random").random()
            wait = delay + jitter
            print(f"[OCTO] 🔄 Reconnecting in {wait:.1f}s (attempt {self._reconnect_attempt})...")
            await asyncio.sleep(wait)

def _auto_update():
    """Pull latest code from git. If commits were added, restart the process so the new code runs."""
    import subprocess, os
    try:
        before = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=BASE_DIR, capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        subprocess.run(
            ["git", "pull", "--ff-only"],
            cwd=BASE_DIR, capture_output=True, timeout=15,
        )
        after = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=BASE_DIR, capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        if before and after and before != after:
            print(f"[OCTO] Code updated ({before[:7]} → {after[:7]}) — restarting...")
            os.execv(sys.executable, [sys.executable] + sys.argv)
    except Exception:
        pass  # no git, no network, or merge conflict — just run current code


def main():
    _auto_update()
    ui = OctoUI("face.png")

    def runner():
        try:
            ui.wait_for_api_key()
            ui.write_log("SYS: Starting voice engine...")
            print("[OCTO] wait_for_api_key done — launching OctoLive")
            
            # --- Inject Background Trading Engines ---
            ui.write_log("SYS: Booting Trading & Sentiment Engines natively...")
            import subprocess, atexit, os
            env = os.environ.copy()
            env["PYTHONUTF8"] = "1"
            env["PYTHONPATH"] = str(BASE_DIR)
            scripts_dir = BASE_DIR / "scripts"
            
            flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            try:
                p1 = subprocess.Popen([sys.executable, str(scripts_dir / "macro_sentiment_analyst.py")], env=env, cwd=str(BASE_DIR), creationflags=flags)
                p2 = subprocess.Popen([sys.executable, str(scripts_dir / "run_live_bot.py")], env=env, cwd=str(BASE_DIR), creationflags=flags)
                atexit.register(lambda: (p1.terminate(), p2.terminate()))
                ui.write_log("SYS: Engines linked and active in background.")
            except Exception as e:
                ui.write_log(f"ERR: Failed to start engines - {e}")
            # -----------------------------------------

            OCTO = OctoLive(ui)
            asyncio.run(OCTO.run())
        except BaseException as e:
            if isinstance(e, (KeyboardInterrupt, SystemExit, GeneratorExit)):
                print("\n[OCTO] Shutdown requested.")
                return
            inner = e
            if hasattr(e, "exceptions") and e.exceptions:
                if any(isinstance(x, (KeyboardInterrupt, SystemExit)) for x in e.exceptions):
                    print("\n[OCTO] Shutdown requested.")
                    return
                inner = e.exceptions[0]
            msg = f"ERR: Voice engine failed — {inner}"
            print(f"[OCTO] {msg}")
            traceback.print_exc()
            ui.write_log(msg)

    threading.Thread(target=runner, daemon=True).start()
    ui.root.mainloop()

if __name__ == "__main__":
    main()