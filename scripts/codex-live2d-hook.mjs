import { mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

const host = process.env.CODEX_LIVE2D_HOST ?? '127.0.0.1';
const port = Number(process.env.CODEX_LIVE2D_PORT ?? 47771);
const timeoutMs = Number(process.env.CODEX_LIVE2D_HOOK_TIMEOUT_MS ?? 80);
const queueDir = process.env.CODEX_LIVE2D_QUEUE_DIR ?? join(process.cwd(), '.codex-live2d');
const queueFile = join(queueDir, 'events.jsonl');

const input = await readStdin();
let payload;

try {
  payload = input.trim() ? JSON.parse(input) : {};
} catch {
  payload = { type: process.argv[2] ?? 'unknown', raw: input.slice(0, 1024) };
}

if (process.argv[2] && !payload.type && !payload.event && !payload.hook_event_name) {
  payload.type = process.argv[2];
}

await appendEvent(payload);
postJson(payload).catch(() => {
  // Network delivery is best-effort. The file queue is the reliable path.
});

async function appendEvent(value) {
  try {
    await mkdir(queueDir, { recursive: true });
    await appendFile(queueFile, `${JSON.stringify({ ...value, queuedAt: Date.now() })}\n`);
  } catch {
    // Hooks must never disturb Codex.
  }
}

function postJson(value) {
  return new Promise((resolve) => {
    const body = JSON.stringify(value);
    const req = request(
      {
        host,
        port,
        path: '/codex-event',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body)
        },
        timeout: timeoutMs
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve();
    });
    req.on('error', resolve);
    req.end(body);
  });
}

async function readStdin() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > 64 * 1024) {
      break;
    }
  }
  return raw;
}
