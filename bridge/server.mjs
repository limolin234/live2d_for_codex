import { createServer } from 'node:http';
import { readFile, rename, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { initialState, eventToAction } from './state.mjs';
import { polishAction } from './llm.mjs';

const host = process.env.CODEX_LIVE2D_HOST ?? '127.0.0.1';
const port = Number(process.env.CODEX_LIVE2D_PORT ?? 47771);
const queueDir = process.env.CODEX_LIVE2D_QUEUE_DIR ?? join(process.cwd(), '.codex-live2d');
const queueFile = join(queueDir, 'events.jsonl');
const clients = new Set();
let currentAction = initialState();
let lastBroadcastAt = 0;

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`);

  if (request.method === 'GET' && url.pathname === '/health') {
    return sendJson(response, 200, { ok: true, currentAction });
  }

  if (request.method === 'GET' && url.pathname === '/state') {
    return sendJson(response, 200, currentAction);
  }

  if (request.method === 'GET' && url.pathname === '/events') {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'access-control-allow-origin': '*'
    });
    response.write(`event: action\ndata: ${JSON.stringify(currentAction)}\n\n`);
    clients.add(response);
    request.on('close', () => clients.delete(response));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/codex-event') {
    try {
      const body = await readJson(request);
      const next = await polishAction(eventToAction(body));
      updateAction(next);
      return sendJson(response, 202, { ok: true });
    } catch (error) {
      return sendJson(response, 400, { ok: false, error: String(error?.message ?? error) });
    }
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type'
    });
    response.end();
    return;
  }

  sendJson(response, 404, { ok: false, error: 'not_found' });
});

server.listen(port, host, () => {
  console.log(`codex-live2d bridge listening on http://${host}:${port}`);
  console.log(`codex-live2d queue ${queueFile}`);
  startQueuePoller();
});

function updateAction(action) {
  const now = Date.now();
  const minimumIntervalMs = Number(process.env.CODEX_LIVE2D_MIN_INTERVAL_MS ?? 250);
  currentAction = action;

  if (now - lastBroadcastAt < minimumIntervalMs && action.state !== 'asking') {
    return;
  }

  lastBroadcastAt = now;
  const payload = `event: action\ndata: ${JSON.stringify(action)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*'
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 64 * 1024) {
      throw new Error('request_too_large');
    }
  }
  return raw.trim() ? JSON.parse(raw) : {};
}

function startQueuePoller() {
  mkdir(queueDir, { recursive: true }).catch(() => {});
  setInterval(() => {
    drainQueue().catch(() => {});
  }, Number(process.env.CODEX_LIVE2D_QUEUE_INTERVAL_MS ?? 250));
}

async function drainQueue() {
  const processingFile = `${queueFile}.${process.pid}.processing`;

  try {
    await rename(queueFile, processingFile);
  } catch {
    return;
  }

  try {
    const raw = await readFile(processingFile, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) {
        continue;
      }

      try {
        const event = JSON.parse(line);
        const next = await polishAction(eventToAction(event));
        updateAction(next);
      } catch {
        // Drop malformed queued events.
      }
    }
  } finally {
    await rm(processingFile, { force: true });
  }
}
