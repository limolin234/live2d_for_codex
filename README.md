# Codex Live2D

Lightweight Live2D status sidecar for Codex.

Codex keeps working normally. Project-level hooks write structured status events
to a local queue, a bridge process converts them into presentation states, and a
browser viewer drives Live2D expressions, motions, and short bubbles.

```text
Codex hooks
  -> .codex-live2d/events.jsonl
  -> bridge/server.mjs
  -> browser Live2D viewer
```

## What Is Included

- Project-level Codex hook config in `.codex/`.
- A fire-and-forget hook script at `scripts/codex-live2d-hook.mjs`.
- A local bridge at `bridge/server.mjs`.
- A Vite + Pixi + Live2D viewer in `src/`.
- A real Live2D sample model at `public/models/sample/Mao/`.
- Local-only ignored folders for Plana assets and Cubism Core runtime.

## Install

```bash
npm install
```

The project uses `pixi-live2d-display@0.4.x`, which expects Pixi v6. Do not
upgrade Pixi to v7 unless the Live2D integration is updated too.

## Required Local Runtime

Cubism 3/4 models need `live2dcubismcore.min.js`.

For local use, put it here:

```text
public/live2d-core/live2dcubismcore.min.js
```

This file is ignored by git. In this workspace it has already been downloaded
for local testing.

## Start

One-command start, with the bridge and viewer launched together:

```bash
npm run app
```

For a less browser-like window, use Chrome/Chromium app mode:

```bash
npm run window
```

You can still run pieces separately for debugging:

```bash
npm run dev:bridge
npm run dev:viewer -- --port 5173
```

Open the sample Live2D model manually if needed:

```text
http://127.0.0.1:5173/?model=/models/sample/Mao/Mao.model3.json
```

If the browser cached an old bundle, force refresh or add a query parameter:

```text
http://127.0.0.1:5173/?model=/models/sample/Mao/Mao.model3.json&t=1
```

## Test Status Changes

Send a full fake Codex event sequence:

```bash
npm run hook:test
```

Or send one event through the same hook path Codex uses:

```bash
printf '%s' '{"type":"PreToolUse","tool_name":"bash","command":"npm test"}' \
  | node scripts/codex-live2d-hook.mjs
```

Check bridge state:

```bash
curl -s http://127.0.0.1:47771/state
```

## Codex Hook Setup

This repo is configured with project-level hooks:

```text
.codex/config.toml
.codex/hooks.json
```

The hook commands call the unified entry and pass the hook name explicitly, for example:

```bash
node $(git rev-parse --show-toplevel)/scripts/codex-live2d.mjs hook PreToolUse
```

The hook writes to:

```text
.codex-live2d/events.jsonl
```

The bridge polls this queue. This avoids relying on localhost network access
from inside Codex's command sandbox.

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

For the included Mao model, these map to existing expression and motion names:

```text
idle       -> exp_01 + Idle[0]
listening  -> exp_02 + TapBody[0]
reading    -> exp_03 + Idle[1]
coding     -> exp_04 + TapBody[1]
running    -> exp_04 + TapBody[2]
asking     -> exp_06 + TapBody[3]
succeeded  -> exp_08 + TapBody[4]
failed     -> exp_07 + TapBody[5]
```

## Local Plana Assets

Put local Plana files under:

```text
public/models/plana-local/
```

This directory is ignored by git. If you have a Cubism model, use:

```text
public/models/plana-local/plana.model3.json
```

Then open:

```text
http://127.0.0.1:5173/?model=/models/plana-local/plana.model3.json
```

If no Live2D model exists, the viewer can fall back to a local static image:

```text
public/models/plana-local/plana.png
```

Open it explicitly with:

```text
http://127.0.0.1:5173/?image=/models/plana-local/plana.png
```

Do not commit copyrighted game assets to this repository.

## Optional Small Model

The bridge has an optional OpenAI-compatible presentation model path. It is off
by default and never feeds back into Codex.

```bash
LIVE2D_LLM_ENABLED=1
LIVE2D_LLM_BASE_URL=https://api.openai.com/v1
LIVE2D_LLM_MODEL=gpt-4.1-mini
LIVE2D_LLM_API_KEY=...
npm run dev:bridge
```

The small model only receives coarse state:

```json
{
  "state": "running",
  "eventType": "PreToolUse",
  "tool": "bash"
}
```

It can polish expression, motion, and bubble text. Timeout/failure falls back to
the deterministic rule mapping.

## Troubleshooting

If the page is gray:

1. Confirm the files are served:

   ```bash
   curl -I http://127.0.0.1:5173/models/sample/Mao/Mao.model3.json
   curl -I http://127.0.0.1:5173/live2d-core/live2dcubismcore.min.js
   ```

2. Confirm Pixi is v6:

   ```bash
   npm ls pixi.js
   ```

3. Rebuild and restart:

   ```bash
   npm run build
   npm run dev:bridge
   npm run dev:viewer -- --port 5173
   ```

4. Open browser DevTools Console and check the first red error.

If the status does not change:

```bash
ls -la .codex-live2d
curl -s http://127.0.0.1:47771/health
```

If port 47771 or 5173 is already in use:

```bash
ss -ltnp 'sport = :47771'
ss -ltnp 'sport = :5173'
```

Stop the old process, then restart the bridge/viewer.
