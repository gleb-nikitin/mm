---
name: summarize-event
description: Low-latency shallow extraction for high-volume chat/chain messages.
---

# Skill: Summarize Event

Use this for "Stupid Jobs" (Local/Fast LLMs) to pre-process raw events before they reach the Lib.

## Input
- A raw chat or chain message (potentially long).

## Output
Produce a JSON object with the following fields:

1. `short_summary`: Max 50 characters. One-line gist (e.g., "Discussed dispatcher race condition").
2. `medium_summary`: 1-2 sentences. Captures the core decision or outcome.
3. `tags`: Array of 3-5 keywords (e.g., ["dispatcher", "bug", "ac-vtx"]).
4. `signal`: A score from 0.0 to 1.0. 
   - 0.1 = Noise/Chitchat.
   - 0.9 = Critical decision/Soul-signal.

## Rules
- **Speed over Depth**: Do not try to synthesize with the rest of the wiki. Just look at this one message.
- **No Hallucination**: If the message is empty or purely mechanical logs with no human reasoning, set signal to 0.0.
- **Strict JSON**: Output ONLY the JSON object.
