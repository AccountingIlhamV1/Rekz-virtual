/**
 * REKZ VIRTUAL — application bootstrap
 * -------------------------------------------------
 * Wires the 3D stage, the AI chat client and every UI control.
 * Chat goes to the Supabase Edge Function "rekz-chat"; no API key lives here.
 */

import { CONFIG } from './config.js';
import { AvatarStage } from './avatar.js';
import { ChatDemo } from './chat.js';
import { Controls } from './controls.js';

const $ = (id) => document.getElementById(id);

function resolveModelUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value, document.baseURI);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href;
  } catch {
    return '';
  }
}

function readModelUrl() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('model');
  if (requested) return resolveModelUrl(requested);
  return resolveModelUrl(CONFIG.avatar.modelUrl);
}

const controls = new Controls();
let modelErrorShown = false;

const chat = new ChatDemo({
  thread: $('chatThread'),
  form: $('chatForm'),
  input: $('chatInput'),
  sendBtn: $('sendBtn'),
  clearBtn: $('clearChatBtn'),
  emptyState: $('chatEmpty'),
  suggestions: document.querySelector('.chat-suggestions'),
  count: $('composerCount'),
  callbacks: {
    onUserMessage: () => {
      controls.playSound('send');
      avatar.acknowledge();
    },
    onReply: () => {
      controls.playSound('receive');
    },
    onExpression: (expression) => {
      controls.setExpression(expression, { quiet: true });
    },
  },
}).init();
controls.attachChat(chat);

const modelUrl = readModelUrl();

const avatar = new AvatarStage({
  canvas: $('avatar-canvas'),
  stage: $('stage'),
  modelUrl,
  quality: controls.state.quality,
  autoRotate: controls.state.autoRotate,
  callbacks: {
    onProgress: ({ percent = 0, title, subtitle }) => {
      controls.updateLoader({ percent, title, subtitle });
      if (percent < 100) controls.setStatus(`Memuat Rekz · ${percent}%`);
    },

    onLoadStart: () => {
      modelErrorShown = false;
      controls.hideAvatarError();
      controls.updateLoader({
        percent: 90,
        title: 'Memuat model eksternal',
        subtitle: 'MENCARI FILE GLB',
      });
      controls.setStatus('Memuat model eksternal');
    },

    onReady: (info) => {
      controls.applyAvatarInfo(info);
      controls.finishLoader();
      if (info.mode === 'external') {
        controls.hideAvatarError();
        controls.setStatus('Rekz siap · model eksternal');
      } else if (!modelErrorShown) {
        controls.hideAvatarError();
        controls.setStatus('Rekz siap · model prosedural');
      } else {
        controls.setStatus('Mode prosedural · model gagal dimuat', { warning: true });
      }
    },

    onModelError: (error) => {
      modelErrorShown = true;
      controls.showAvatarError(error);
      controls.setStatus('Mode prosedural · model gagal dimuat', { warning: true });
    },

    onFatalError: (error) => {
      controls.hideLoaderImmediately();
      controls.showAvatarError(error, { fatal: true });
      controls.setStatus('WebGL tidak tersedia', { warning: true });
    },

    onFps: (fps) => {
      controls.updateFps(fps);
    },

    onQualityChanged: (quality, preset) => {
      controls.reflectQuality(quality, preset);
    },

    onRenderError: (message) => {
      if (!message) return;
      controls.toast(message, 'error');
      controls.setStatus('Render terhenti · cek WebGL', { warning: true });
    },
  },
});

controls.attachAvatar(avatar);
controls.setStatus('Menyiapkan Rekz');

avatar.init().catch((error) => {
  // The stage reports a friendly fatal error through onFatalError.
  console.error('[Rekz] Initialisation failed:', error);
});

window.addEventListener(
  'beforeunload',
  () => {
    chat.destroy();
    controls.destroy();
    avatar.dispose();
  },
  { once: true },
);

// Handy for QA and for anyone experimenting in the browser console.
window.RekzVirtual = Object.freeze({
  avatar,
  chat,
  controls,
  config: CONFIG,
});
