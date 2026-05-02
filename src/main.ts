import './style.css';
import { Live2DController } from './live2d-controller';
import type { Live2DAction } from './types';

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
const bubble = document.querySelector<HTMLDivElement>('#bubble');
const status = document.querySelector<HTMLDivElement>('#status');

if (!canvas || !bubble || !status) {
  throw new Error('missing_dom_nodes');
}

const stageCanvas = canvas;
const bubbleEl = bubble;
const statusEl = status;
const bridgeUrl = new URL(import.meta.env.VITE_CODEX_LIVE2D_BRIDGE ?? 'http://127.0.0.1:47771');
const controller = new Live2DController(stageCanvas);

boot().catch((error) => {
  setStatus('model missing');
  showBubble('等待本地模型。');
  console.warn(error);
});

connectEvents();

async function boot() {
  setStatus('loading');
  await loadOptionalScript('/live2d-core/live2dcubismcore.min.js');
  try {
    const loadedPath = await controller.loadModel(getModelCandidates());
    setStatus(`model: ${loadedPath.split('/').pop() ?? loadedPath}`);
  } catch (modelError) {
    const fallbackPath = await controller.loadFallbackImage(getFallbackImageCandidates());
    setStatus(`image: ${fallbackPath.split('/').pop() ?? fallbackPath}`);
    console.warn(modelError);
  }
}

function connectEvents() {
  const source = new EventSource(new URL('/events', bridgeUrl).toString());

  source.addEventListener('action', (event) => {
    const action = JSON.parse((event as MessageEvent).data) as Live2DAction;
    applyAction(action);
  });

  source.addEventListener('error', () => {
    setStatus('bridge offline');
  });
}

function applyAction(action: Live2DAction) {
  setStatus(action.state);
  showBubble(action.bubble ?? '');
  controller.apply(action).catch(() => {
    // Rendering reactions are optional; state text remains authoritative.
  });
}

function showBubble(text: string) {
  bubbleEl.textContent = text;
  bubbleEl.classList.toggle('visible', text.trim().length > 0);
}

function setStatus(text: string) {
  statusEl.textContent = text;
}

function getModelCandidates() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('model');

  return [
    requested,
    '/models/plana-local/plana.model3.json',
    '/models/plana-local/model.model3.json',
    '/models/plana-local/runtime/plana.model3.json',
    '/models/sample/Mao/Mao.model3.json',
    '/models/sample/model.model3.json'
  ].filter(Boolean) as string[];
}

function getFallbackImageCandidates() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('image');

  return [
    requested,
    '/models/plana-local/plana.png',
    '/models/plana-local/plana.webp',
    '/models/sample/model.png'
  ].filter(Boolean) as string[];
}

async function loadOptionalScript(src: string) {
  const response = await fetch(src, { method: 'HEAD' }).catch(() => null);
  if (!response?.ok) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.append(script);
  });
}
