import { resolve } from 'node:path';

const entry = resolve('scripts/codex-live2d.mjs');

console.log(`# Add equivalent commands to this project's Codex hook config.
# Pass the Codex hook name explicitly so status mapping works even when stdin
# does not include a type field.

node ${entry} hook PreToolUse
node ${entry} hook PostToolUse
node ${entry} hook UserPromptSubmit
node ${entry} hook PermissionRequest

# The hook reads Codex's JSON event from stdin, writes .codex-live2d/events.jsonl,
# and best-effort POSTs to:
# http://127.0.0.1:47771/codex-event
`);
