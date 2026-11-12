/**
 * REKZ VIRTUAL — central configuration
 * -------------------------------------------------
 * This file is intentionally dependency-free so it can be edited
 * without touching the rest of the application.
 */

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
const smallScreen = window.matchMedia('(max-width: 700px)').matches;

export const CONFIG = Object.freeze({
  app: {
    name: 'Rekz Virtual',
    version: '0.2.0',
    build: 'CHAMBER 01 / AI CHAT',
    storageKey: 'rekz-virtual:v1',
  },

  avatar: {
    /**
     * To use a real GLB character, place it in assets/models/ and set
     * this to './assets/models/rekz.glb' (or pass ?model=<url> in the URL).
     * Leave empty to use the fully rendered Three.js placeholder.
     */
    modelUrl: '',
    targetHeight: 1.85,
    autoRotate: !reducedMotion,
    autoRotateSpeed: 0.55,
    reducedMotion,
    minDistance: 1.9,
    maxDistance: 5.6,
    defaultDistance: 3.5,
    fov: 34,
    defaultQuality: smallScreen || coarsePointer ? 'low' : 'medium',
  },

  api: {
    /** Supabase Edge Function "rekz-chat" (General Mode, tanpa login). */
    chatUrl: 'https://xkqndsraohbvzkktobxt.supabase.co/functions/v1/rekz-chat',
    timeoutMs: 30000,
  },

  chat: {
    maxInputLength: 500,
    maxMessages: 120,
    maxHistory: 12,
  },

  ui: {
    toastDuration: 3400,
    blinkMinDelay: 2800,
    blinkMaxDelay: 6200,
  },
});

export const QUALITY_PRESETS = Object.freeze({
  low: {
    label: 'Low',
    maxDpr: 1,
    shadows: false,
    shadowMapSize: 512,
    particles: 36,
    environmentIntensity: 0.3,
    description: 'DPR 1 · tanpa bayangan · partikel minimal',
  },
  medium: {
    label: 'Medium',
    maxDpr: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    particles: 110,
    environmentIntensity: 0.42,
    description: 'DPR 1.5 · bayangan 1024 · seimbang',
  },
  high: {
    label: 'High',
    maxDpr: 2,
    shadows: true,
    shadowMapSize: 2048,
    particles: 190,
    environmentIntensity: 0.55,
    description: 'DPR 2 · bayangan 2048 · kualitas maksimal',
  },
});

export const EXPRESSIONS = Object.freeze([
  { id: 'neutral', label: 'Neutral' },
  { id: 'happy', label: 'Happy' },
  { id: 'sad', label: 'Sad' },
  { id: 'angry', label: 'Angry' },
  { id: 'surprised', label: 'Surprised' },
]);

/** Resolve a URL relative to the site root, safe for GitHub Pages subpaths. */
export function assetUrl(path) {
  return new URL(path, document.baseURI).href;
}

/** Read an allowed quality value from the URL or storage, if present. */
export function readStoredQuality() {
  const urlQuality = new URLSearchParams(window.location.search).get('quality');
  if (urlQuality && QUALITY_PRESETS[urlQuality]) return urlQuality;

  try {
    const stored = JSON.parse(localStorage.getItem(CONFIG.app.storageKey) || '{}');
    if (stored.quality && QUALITY_PRESETS[stored.quality]) return stored.quality;
  } catch {
    /* Storage can be unavailable in private modes. */
  }

  return CONFIG.avatar.defaultQuality;
}
