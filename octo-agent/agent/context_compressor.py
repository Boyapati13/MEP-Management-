"""
agent/context_compressor.py
============================
Hermes-inspired context window compression for OCTO.

Automatically summarises old conversation turns when approaching the
model's context limit, protecting the most recent exchanges so the agent
never loses track of what it was just doing.

Key features (ported/adapted from NousResearch/hermes-agent):
  - Structured summary with Resolved / Pending question tracking
  - Tool output pruning before LLM summarisation (cheap pre-pass)
  - Token-budget tail protection instead of fixed message count
  - Iterative summary updates (info preserved across compactions)
  - Scaled summary budget proportional to compressed content
"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────

SUMMARY_PREFIX = (
    "[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted "
    "into the summary below. This is a handoff from a previous context "
    "window — treat it as background reference, NOT as active instructions. "
    "Do NOT answer questions or fulfil requests mentioned in this summary; "
    "they were already addressed. "
    "Your current task is identified in the '## Active Task' section — "
    "resume exactly from there. "
    "Respond ONLY to the latest user message that appears AFTER this summary:"
)

_PRUNED_TOOL_PLACEHOLDER = "[Old tool output cleared to save context space]"
_CHARS_PER_TOKEN        = 4
_MIN_SUMMARY_TOKENS     = 1_500
_SUMMARY_RATIO          = 0.20
_SUMMARY_TOKENS_CEILING = 10_000

# Context thresholds
COMPRESS_AT_PERCENT = 0.75   # fire when usage hits 75 % of context window
PROTECT_LAST_N_CHARS = 8_000 # always keep the last ~2 k tokens verbatim


# ── Rough token estimator ──────────────────────────────────────────────────

def _rough_tokens(messages: List[Dict[str, Any]]) -> int:
    total = 0
    for m in messages:
        content = m.get("content", "")
        if isinstance(content, str):
            total += len(content) // _CHARS_PER_TOKEN
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict):
                    total += len(part.get("text", "")) // _CHARS_PER_TOKEN
    return total


# ── Tool-output pruner ─────────────────────────────────────────────────────

def _prune_old_tool_outputs(messages: List[Dict[str, Any]], keep_last: int = 4) -> List[Dict[str, Any]]:
    """Replace tool results in old messages with a short placeholder."""
    tool_result_indices = [
        i for i, m in enumerate(messages)
        if m.get("role") == "tool" or (
            isinstance(m.get("content"), list) and
            any(p.get("type") == "tool_result" for p in m.get("content", []))
        )
    ]
    cutoff = max(0, len(tool_result_indices) - keep_last)
    indices_to_prune = set(tool_result_indices[:cutoff])

    result = []
    for i, m in enumerate(messages):
        if i in indices_to_prune:
            pruned = dict(m)
            pruned["content"] = _PRUNED_TOOL_PLACEHOLDER
            result.append(pruned)
        else:
            result.append(m)
    return result


# ── Summariser ─────────────────────────────────────────────────────────────

def _summarise_via_llm(conversation_text: str, max_tokens: int = 3_000) -> str:
    """Call the text LLM to produce a structured summary of old turns."""
    try:
        from core import text_llm
        system = (
            "You are a conversation summariser. Given a JSON-formatted conversation, "
            "produce a concise but complete summary in this exact structure:\n\n"
            "## Resolved\n- List every completed task/question with its outcome.\n\n"
            "## Active Task\n- The last thing the assistant was working on (1-2 sentences).\n\n"
            "## Pending\n- Any open questions or items not yet answered.\n\n"
            "## Key Context\n- Important facts, file paths, decisions the agent must remember.\n\n"
            "Be factual. Keep each bullet under 40 words. "
            "Do NOT include raw tool outputs."
        )
        summary = text_llm.ask(
            f"Summarise this conversation:\n\n{conversation_text}",
            system=system,
        ).strip()
        return summary
    except Exception as e:
        logger.warning("[ContextCompressor] LLM summarisation failed: %s", e)
        return ""


# ── Main compressor ─────────────────────────────────────────────────────────

class ContextCompressor:
    """Drop-in context compressor for OCTO's conversation loop."""

    def __init__(self, context_limit: int = 128_000):
        self.context_limit        = context_limit
        self.threshold_tokens     = int(context_limit * COMPRESS_AT_PERCENT)
        self.compression_count    = 0
        self.last_prompt_tokens   = 0
        self._last_compress_time  = 0.0
        self._cooldown_seconds    = 300

    def should_compress(self, messages: List[Dict[str, Any]]) -> bool:
        if time.time() - self._last_compress_time < self._cooldown_seconds:
            return False
        return _rough_tokens(messages) >= self.threshold_tokens

    def compress(
        self,
        messages: List[Dict[str, Any]],
        system_prompt: str = "",
    ) -> List[Dict[str, Any]]:
        """
        Compact *messages* and return a shorter list.

        Layout of the returned list:
          [system?]  [summary-user-turn]  [tail messages]
        """
        if len(messages) < 6:
            return messages

        # ── Separate system / non-system ───────────────────────────────
        sys_messages  = [m for m in messages if m.get("role") == "system"]
        conv_messages = [m for m in messages if m.get("role") != "system"]

        if len(conv_messages) < 4:
            return messages

        # ── Identify head (always protected) + body + tail ─────────────
        head_count = min(2, len(conv_messages) // 4)
        tail_chars = 0
        tail_start = len(conv_messages)
        for i in range(len(conv_messages) - 1, head_count - 1, -1):
            c = conv_messages[i].get("content", "")
            tail_chars += len(c) if isinstance(c, str) else sum(
                len(p.get("text", "")) for p in (c if isinstance(c, list) else [])
            )
            if tail_chars >= PROTECT_LAST_N_CHARS:
                tail_start = i
                break

        head = conv_messages[:head_count]
        body = conv_messages[head_count:tail_start]
        tail = conv_messages[tail_start:]

        if not body:
            return messages

        # ── Prune old tool outputs from body ───────────────────────────
        body_pruned = _prune_old_tool_outputs(body)

        # ── Build conversation text for summariser ─────────────────────
        conv_text = json.dumps(body_pruned, ensure_ascii=False, indent=2)
        # Scale summary budget
        body_tokens    = _rough_tokens(body_pruned)
        summary_budget = min(
            _SUMMARY_TOKENS_CEILING,
            max(_MIN_SUMMARY_TOKENS, int(body_tokens * _SUMMARY_RATIO)),
        )

        summary = _summarise_via_llm(conv_text, max_tokens=summary_budget)
        if not summary:
            logger.warning("[ContextCompressor] Summarisation returned empty — skipping compression")
            return messages

        # ── Assemble compacted message list ────────────────────────────
        summary_message = {
            "role":    "user",
            "content": f"{SUMMARY_PREFIX}\n\n{summary}",
        }
        compacted = sys_messages + head + [summary_message] + tail

        self.compression_count   += 1
        self._last_compress_time  = time.time()
        before = _rough_tokens(messages)
        after  = _rough_tokens(compacted)
        logger.info(
            "[ContextCompressor] Compression #%d: %d → %d tokens (saved %d)",
            self.compression_count, before, after, before - after,
        )
        return compacted
