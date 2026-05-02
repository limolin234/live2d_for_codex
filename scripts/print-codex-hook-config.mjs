import { resolve } from 'node:path';

const hook = resolve('scripts/codex-live2d-hook.mjs');

console.log(`# Add the equivalent hook command to this project's Codex hook config.
# Exact hook config shape can vary by Codex version, so keep this as the command target:

node ${hook}

# The hook reads Codex's JSON event from stdin and POSTs it to:
# http://127.0.0.1:47771/codex-event
`);
