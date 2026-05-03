const DEFAULT_VIEWEREX_WS = 'ws://127.0.0.1:10086/api';
const DEFAULT_MODEL_ID = 0;
const DEFAULT_DURATION_MS = 3500;

export function createViewerExRelay(options = {}) {
  const enabled = isEnabled(options.enabled ?? process.env.LIVE2D_VIEWEREX_ENABLED);
  const url = options.url ?? process.env.LIVE2D_VIEWEREX_WS ?? DEFAULT_VIEWEREX_WS;
  const modelId = Number(options.modelId ?? process.env.LIVE2D_VIEWEREX_MODEL_ID ?? DEFAULT_MODEL_ID);
  const duration = Number(options.duration ?? process.env.LIVE2D_VIEWEREX_BUBBLE_MS ?? DEFAULT_DURATION_MS);
  const textFrameColor = parseColor(options.textFrameColor ?? process.env.LIVE2D_VIEWEREX_BUBBLE_FRAME ?? '0x000000');
  const textColor = parseColor(options.textColor ?? process.env.LIVE2D_VIEWEREX_BUBBLE_TEXT ?? '0xFFFFFF');

  let socket = null;
  let connecting = false;
  let msgId = 1;
  let lastText = '';
  let lastSentAt = 0;

  return {
    enabled,
    url,
    sendAction(action) {
      if (!enabled || typeof WebSocket !== 'function') {
        return;
      }

      const text = formatBubble(action);
      if (!text) {
        return;
      }

      const now = Date.now();
      if (text === lastText && now - lastSentAt < 1000) {
        return;
      }

      lastText = text;
      lastSentAt = now;
      send({
        msg: 11000,
        msgId: msgId++,
        data: {
          id: Number.isFinite(modelId) ? modelId : DEFAULT_MODEL_ID,
          text,
          choices: [],
          textFrameColor,
          textColor,
          duration: Number.isFinite(duration) ? duration : DEFAULT_DURATION_MS
        }
      });
    }
  };

  function send(payload) {
    const body = JSON.stringify(payload);
    const openSocket = ensureSocket();

    if (openSocket?.readyState === WebSocket.OPEN) {
      openSocket.send(body);
      return;
    }

    openSocket?.addEventListener('open', () => openSocket.send(body), { once: true });
  }

  function ensureSocket() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return socket;
    }
    if (connecting) {
      return socket;
    }

    connecting = true;
    try {
      socket = new WebSocket(url);
      socket.addEventListener('open', () => {
        connecting = false;
        console.log(`viewerex relay connected ${url}`);
      });
      socket.addEventListener('close', () => {
        connecting = false;
        socket = null;
      });
      socket.addEventListener('error', () => {
        connecting = false;
      });
    } catch {
      connecting = false;
      socket = null;
    }

    return socket;
  }
}

function formatBubble(action) {
  const bubble = String(action?.bubble ?? '').trim();
  if (bubble) {
    return bubble;
  }

  const state = String(action?.state ?? '').trim();
  return state && state !== 'idle' ? state : '';
}

function parseColor(value) {
  if (typeof value === 'number') {
    return value;
  }

  const text = String(value).trim();
  if (/^0x[0-9a-f]+$/i.test(text)) {
    return Number.parseInt(text.slice(2), 16);
  }
  if (/^#[0-9a-f]{6}$/i.test(text)) {
    return Number.parseInt(text.slice(1), 16);
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0xffffff;
}

function isEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase());
}
