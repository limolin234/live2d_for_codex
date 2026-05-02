import { createServer, request as httpRequest } from 'node:http';
import { appendFile, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { initialState, eventToAction } from '../bridge/state.mjs';
import { polishAction } from '../bridge/llm.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const host = process.env.CODEX_LIVE2D_HOST ?? '127.0.0.1';
const bridgePort = Number(process.env.CODEX_LIVE2D_PORT ?? 47771);
const viewerPort = Number(process.env.CODEX_LIVE2D_VIEWER_PORT ?? 5173);
const queueDir = process.env.CODEX_LIVE2D_QUEUE_DIR ?? join(rootDir, '.codex-live2d');
const queueFile = join(queueDir, 'events.jsonl');
const command = process.argv[2] ?? 'app';

if (command === 'hook') {
  await runHook(process.argv[3]);
} else if (command === 'bridge') {
  runBridge();
} else if (command === 'app' || command === 'window') {
  await runApp({ windowed: command === 'window' || process.argv.includes('--window') });
} else if (command === 'open') {
  openViewer({ windowed: process.argv.includes('--window') });
} else {
  printHelp();
  process.exitCode = 1;
}

async function runHook(eventName) {
  const input = await readStdin();
  let payload;

  try {
    payload = input.trim() ? JSON.parse(input) : {};
  } catch {
    payload = { raw: input.slice(0, 1024) };
  }

  if (eventName && !payload.type && !payload.event && !payload.hook_event_name) {
    payload.type = eventName;
  }

  if (!payload.type && !payload.event && !payload.hook_event_name) {
    payload.type = 'Unknown';
  }

  await appendQueuedEvent(payload);
  postJson(payload).catch(() => {
    // Network delivery is best-effort. The file queue is the reliable path.
  });
}

async function appendQueuedEvent(value) {
  try {
    await mkdir(queueDir, { recursive: true });
    await appendFile(queueFile, `${JSON.stringify({ ...value, queuedAt: Date.now() })}\n`);
  } catch {
    // Hooks must never disturb Codex.
  }
}

function postJson(value) {
  return new Promise((resolveDone) => {
    const body = JSON.stringify(value);
    const req = httpRequest(
      {
        host,
        port: bridgePort,
        path: '/codex-event',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body)
        },
        timeout: Number(process.env.CODEX_LIVE2D_HOOK_TIMEOUT_MS ?? 80)
      },
      (res) => {
        res.resume();
        res.on('end', resolveDone);
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolveDone();
    });
    req.on('error', resolveDone);
    req.end(body);
  });
}

function runBridge() {
  const clients = new Set();
  let currentAction = initialState();
  let lastBroadcastAt = 0;
  let idleTimer = null;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${bridgePort}`}`);

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
        return sendJson(response, 202, { ok: true, action: next });
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

  server.listen(bridgePort, host, () => {
    console.log(`codex-live2d bridge listening on http://${host}:${bridgePort}`);
    console.log(`codex-live2d queue ${queueFile}`);
    startQueuePoller();
  });

  function updateAction(action) {
    const previousState = currentAction.state;
    const previousEventType = currentAction.eventType;
    const now = Date.now();
    const minimumIntervalMs = Number(process.env.CODEX_LIVE2D_MIN_INTERVAL_MS ?? 250);
    currentAction = action;
    scheduleIdleReset(action);

    const isMeaningfulChange = action.state !== previousState || action.eventType !== previousEventType || action.state === 'asking';
    if (!isMeaningfulChange && now - lastBroadcastAt < minimumIntervalMs) {
      return;
    }

    lastBroadcastAt = now;
    const payload = `event: action\ndata: ${JSON.stringify(action)}\n\n`;
    for (const client of clients) {
      client.write(payload);
    }
    console.log(`[${new Date(action.ts ?? now).toLocaleTimeString()}] ${action.eventType ?? 'event'} -> ${action.state}${action.tool ? ` (${action.tool})` : ''}`);
  }

  function scheduleIdleReset(action) {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }

    if (action.state === 'idle' || action.state === 'asking') {
      return;
    }

    idleTimer = setTimeout(() => {
      updateAction({
        ...initialState(),
        source: 'bridge',
        eventType: 'AutoIdle'
      });
    }, Number(process.env.CODEX_LIVE2D_IDLE_RESET_MS ?? 12000));
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
        if (!line.trim()) continue;
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
}

async function runApp({ windowed }) {
  const children = [];
  const bridge = spawn(process.execPath, [fileURLToPath(import.meta.url), 'bridge'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env
  });
  children.push(bridge);

  const viteBin = join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
  const viewer = spawn(viteBin, ['--host', host, '--port', String(viewerPort)], {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, VITE_CODEX_LIVE2D_BRIDGE: `http://${host}:${bridgePort}` },
    shell: process.platform === 'win32'
  });
  children.push(viewer);

  const shutdown = () => {
    for (const child of children) child.kill('SIGTERM');
  };
  process.on('SIGINT', () => {
    shutdown();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    shutdown();
    process.exit(143);
  });
  process.on('exit', shutdown);

  await waitForUrl(`http://${host}:${viewerPort}`, 10000).catch(() => {});
  openViewer({ windowed });
  console.log(`codex-live2d viewer http://${host}:${viewerPort}/?model=/models/sample/Mao/Mao.model3.json`);
}

function openViewer({ windowed }) {
  const url = `http://${host}:${viewerPort}/?model=/models/sample/Mao/Mao.model3.json`;
  const chrome = findChrome();

  if (windowed && chrome) {
    spawn(chrome, [`--app=${url}`, '--new-window'], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(opener, args, { detached: true, stdio: 'ignore' }).unref();
}

function findChrome() {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : process.platform === 'win32'
      ? ['chrome.exe', 'msedge.exe']
      : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];

  for (const candidate of candidates) {
    if (candidate.includes('/') && existsSync(candidate)) return candidate;
    const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [candidate], { encoding: 'utf8' });
    if (result.status === 0) return result.stdout.split(/\r?\n/)[0].trim();
  }
  return null;
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await fetch(url).then((r) => r.ok).catch(() => false);
    if (ok) return;
    await sleep(200);
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
    if (raw.length > 64 * 1024) throw new Error('request_too_large');
  }
  return raw.trim() ? JSON.parse(raw) : {};
}

async function readStdin() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > 64 * 1024) break;
  }
  return raw;
}

function sleep(ms) {
  return new Promise((resolveDone) => setTimeout(resolveDone, ms));
}

function printHelp() {
  console.log(`Usage:
  node scripts/codex-live2d.mjs app [--window]   Start bridge + viewer + open UI
  node scripts/codex-live2d.mjs window           Same as app --window
  node scripts/codex-live2d.mjs bridge           Start bridge only
  node scripts/codex-live2d.mjs hook <EventName> Codex hook entry
`);
}
