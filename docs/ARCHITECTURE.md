# Architecture

## Goals

- Keep Codex's coding loop unaffected.
- Use structured Codex hook events as the primary state source.
- Keep Live2D rendering lightweight.
- Keep copyrighted model files local and untracked.
- Allow an optional small model for presentation-only reactions.

## Processes

```text
Codex
  -> hook command
  -> bridge HTTP server
  -> EventSource stream
  -> Live2D viewer
```

## Bridge API

`POST /codex-event`

Accepts a Codex hook payload. The bridge tolerates multiple likely field names:

```json
{
  "type": "PreToolUse",
  "tool_name": "bash",
  "command": "npm test"
}
```

`GET /events`

Server-Sent Events stream for the viewer:

```json
{
  "state": "running",
  "expression": "focused",
  "motion": { "group": "Idle" },
  "bubble": "正在执行命令。",
  "source": "codex"
}
```

## State Mapping

```text
SessionStart       -> idle
UserPromptSubmit   -> listening
PreToolUse read    -> reading
PreToolUse edit    -> coding
PreToolUse shell   -> running
PermissionRequest  -> asking
PostToolUse ok     -> succeeded
PostToolUse failed -> failed
Stop               -> idle
```

## Optional Small Model

The small model is called inside `bridge/llm.mjs`. It receives only coarse event
metadata and has a short timeout. It never controls Codex, changes prompts, or
blocks the hook path.
