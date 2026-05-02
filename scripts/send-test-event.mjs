const host = process.env.CODEX_LIVE2D_HOST ?? '127.0.0.1';
const port = Number(process.env.CODEX_LIVE2D_PORT ?? 47771);
const events = [
  { type: 'SessionStart' },
  { type: 'UserPromptSubmit' },
  { type: 'PreToolUse', tool_name: 'Read' },
  { type: 'PreToolUse', tool_name: 'apply_patch' },
  { type: 'PreToolUse', tool_name: 'bash', command: 'npm test' },
  { type: 'PostToolUse', tool_name: 'bash', status: 1 },
  { type: 'PermissionRequest' },
  { type: 'PostToolUse', tool_name: 'bash', status: 0 },
  { type: 'Stop' }
];

for (const event of events) {
  await fetch(`http://${host}:${port}/codex-event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event)
  });
  await sleep(900);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
