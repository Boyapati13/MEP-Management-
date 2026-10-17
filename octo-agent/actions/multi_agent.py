import json
import logging
import os
import uuid
from typing import Callable, Optional

# Instead of re-inventing the wheel and hitting `DeerFlowClient` path depth errors,
# we use the robust HTTP endpoints provided in deerflow_bridge if the gateway is running.
# If the gateway is not running, we try the embedded client directly, but proxy it securely.
from deerflow_bridge import is_http_running, _http_stream, get_or_create_thread, _get_embedded_client, _get_mapped_tools_and_skills

log = logging.getLogger(__name__)

def multi_agent_loop(
    parameters: dict,
    on_progress: Optional[Callable[[str], None]] = None,
    player=None,
    speak=None,
) -> str:
    """
    Executes a task iteratively using the full multi-agent structure.
    It hooks into DeerFlow's LangGraph backend (either via HTTP gateway or embedded),
    allowing it to plan, code, use MCP tools, execute shell commands, and verify logic.
    """
    p = parameters or {}
    task = p.get("task", "").strip()
    working_dir = p.get("working_dir", "").strip()
    session_id = p.get("session_id", "default")
    model = p.get("model", "auto")

    # Map UI selection if necessary
    if model == "deerflow/auto":
        model = "gemini-2.5-flash"


    if not task:
        return "No task provided."

    thread_id = get_or_create_thread(session_id)

    # If a working dir is provided, wrap the prompt to give the agent context.
    context_task = task
    if working_dir:
        context_task = f"[Context: You are operating in project directory {working_dir}]\n{task}"

    if on_progress:
        on_progress("Initializing multi-agent swarm...\n")

    t, s, d = _get_mapped_tools_and_skills()

    # If this is an Ollama model, we inject it into DeerFlow's config so it doesn't fail validation
    _injected_config = False
    try:
        if model.startswith("ollama/"):
            from deerflow.config import get_app_config
            from deerflow.config.app_config import push_current_app_config, ModelConfig

            cfg = get_app_config()
            # Copy models to not mutate singleton
            new_models = list(cfg.models)
            model_name = model.split("ollama/")[-1]

            # Check if it already exists
            if not any(m.name == model for m in new_models):
                new_model = ModelConfig(
                    name=model,
                    display_name=f"Ollama {model_name}",
                    use="deerflow.models.patched_openai:PatchedChatOpenAI",
                    model=model_name,
                    api_key="ollama",
                    base_url="http://localhost:11434/v1",
                    max_tokens=8192
                )
                new_models.append(new_model)
                # Create a copy of the config with the new models
                new_cfg = cfg.model_copy(update={"models": new_models})
                push_current_app_config(new_cfg)
                _injected_config = True
    except Exception as e:
        log.warning(f"Failed to inject dynamic ollama model config: {e}")

    if is_http_running():
        try:
            if on_progress:
                on_progress("[Using Gateway LangGraph Orchestration]\n")
                
            payload = {
                "message": context_task,
                "thread_id": thread_id,
                "subagent_enabled": d,
                "available_tools": list(t),
                "available_skills": list(s)
            }
            if model != "auto":
                payload["model"] = model
                
            chunks_dict = {}
            last_id = ""
            for raw_chunk in _http_stream("/chat", payload, timeout=120):
                # parse SSE lines
                if raw_chunk.startswith("data: "):
                    try:
                        data = json.loads(raw_chunk[6:])
                        if data.get("type") == "ai":
                            msg_id = data.get("id") or ""
                            delta = data.get("content", "")
                            if delta:
                                chunks_dict.setdefault(msg_id, []).append(delta)
                                last_id = msg_id
                                if on_progress:
                                    on_progress(delta)
                    except json.JSONDecodeError:
                        pass
            
            final_output = "".join(chunks_dict.get(last_id, ()))
            return final_output if final_output else "Task completed (no output)."
        except Exception as e:
            log.error(f"Multi-agent HTTP execution failed: {e}")
            if on_progress:
                on_progress(f"\n[Gateway Error] {e}. Falling back to embedded...\n")

    # FALLBACK: Embedded client
    client = _get_embedded_client()
    if not client:
        # If client couldn't be loaded, we must clean up the injected config
        if _injected_config:
            try:
                from deerflow.config.app_config import pop_current_app_config
                pop_current_app_config()
            except Exception:
                pass

    if client:
        try:
            if on_progress:
                on_progress("[Using Embedded LangGraph Orchestration]\n")

            chunks_dict = {}
            last_id = ""
            for event in client.stream(context_task, thread_id=thread_id, subagent_enabled=d, available_tools=t, available_skills=s):
                if event.type == "messages-tuple" and event.data.get("type") == "ai":
                    msg_id = event.data.get("id") or ""
                    delta = event.data.get("content", "")
                    if delta:
                        chunks_dict.setdefault(msg_id, []).append(delta)
                        last_id = msg_id
                        if on_progress:
                            on_progress(delta)

            final_output = "".join(chunks_dict.get(last_id, ()))
            if _injected_config:
                try:
                    from deerflow.config.app_config import pop_current_app_config
                    pop_current_app_config()
                except Exception:
                    pass
            return final_output if final_output else "Task completed (no output)."
        except Exception as e:
            if _injected_config:
                try:
                    from deerflow.config.app_config import pop_current_app_config
                    pop_current_app_config()
                except Exception:
                    pass
            err_msg = f"Multi-agent embedded execution failed: {e}"
            log.error(err_msg)
            if on_progress:
                on_progress(f"\n[Error] {err_msg}\n")
            return err_msg

    # TOTAL FALLBACK
    err_msg = "Multi-agent framework (DeerFlow Gateway/Embedded) is completely unavailable. Please start the gateway."
    if on_progress:
        on_progress(f"\n[Error] {err_msg}\n")
    return err_msg
