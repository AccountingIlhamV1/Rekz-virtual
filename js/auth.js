/**
 * REKZ VIRTUAL 0.2.2 — login akun (Supabase Auth, email + password)
 * -------------------------------------------------
 * Tanpa library. Hanya memakai kunci PUBLIK (publishable key).
 * Password tidak pernah disimpan; yang disimpan hanya token sesi.
 * Peran/mode TIDAK ditentukan di sini: server yang memutuskan.
 */

import { CONFIG } from './config.js';

const KEY = 'rekz.auth.v1';
const listeners = new Set();
let session = null;
let refreshing = null;

function load() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.refresh_token === 'string' && typeof parsed.access_token === 'string') {
        session = parsed;
      }
    }
  } catch {
    session = null;
  }
}

function save() {
  try {
    if (session) window.localStorage.setItem(KEY, JSON.stringify(session));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* penyimpanan tidak tersedia: sesi hanya hidup di memori */
  }
}

export function isLoggedIn() {
  return Boolean(session && session.refresh_token);
}

export function getEmail() {
  return (session && session.email) || '';
}

export function onAuthChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function emit() {
  listeners.forEach((callback) => {
    try {
      callback(isLoggedIn());
    } catch {
      /* abaikan */
    }
  });
  updateUI();
}

async function authPost(path, body, accessToken) {
  const headers = {
    'Content-Type': 'application/json',
    apikey: CONFIG.auth.publishableKey,
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${CONFIG.auth.url}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { ok: response.ok, status: response.status, body: data };
}

function setSession(data) {
  const expiresAt = data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600);
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
    email: (data.user && data.user.email) || (session && session.email) || '',
  };
  save();
}

export function clearSession() {
  session = null;
  save();
  emit();
}

async function refresh() {
  if (!session || !session.refresh_token) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const result = await authPost('/auth/v1/token?grant_type=refresh_token', {
          refresh_token: session.refresh_token,
        });
        if (result.ok && result.body && result.body.access_token) {
          setSession(result.body);
          emit();
          return true;
        }
        if (result.status === 400 || result.status === 401 || result.status === 403) clearSession();
        return false;
      } catch {
        return false; // jaringan bermasalah: jangan hapus sesi
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

/** Token akses yang masih berlaku (diperpanjang otomatis), atau null. */
export async function getAccessToken() {
  if (!session) return null;
  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at - now > 60) return session.access_token;
  const ok = await refresh();
  return ok && session ? session.access_token : null;
}

export async function login(email, password) {
  try {
    const result = await authPost('/auth/v1/token?grant_type=password', { email, password });
    if (result.ok && result.body && result.body.access_token) {
      setSession(result.body);
      emit();
      return { ok: true };
    }
    if (result.status === 429) return { ok: false, message: 'Terlalu banyak percobaan. Coba lagi nanti.' };
    if (result.status === 400 || result.status === 401) return { ok: false, message: 'Email atau password salah.' };
    return { ok: false, message: 'Gagal masuk. Coba lagi sebentar.' };
  } catch {
    return { ok: false, message: 'Tidak bisa terhubung ke server.' };
  }
}

export async function logout() {
  const token = session && session.access_token;
  clearSession();
  if (token) {
    try {
      await authPost('/auth/v1/logout', {}, token);
    } catch {
      /* token sudah dihapus di perangkat ini */
    }
  }
}

/* ---------- UI di dalam Menu ---------- */

let ui = null;

function bindUI() {
  const el = (id) => document.getElementById(id);
  ui = {
    form: el('authForm'),
    email: el('authEmail'),
    password: el('authPassword'),
    status: el('authStatus'),
    message: el('authMessage'),
    loginBtn: el('authLoginBtn'),
    logoutBtn: el('authLogoutBtn'),
    fields: el('authFields'),
  };
  if (!ui.form) return;

  ui.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = ui.email.value.trim();
    const password = ui.password.value;
    if (!email || !password) {
      ui.message.textContent = 'Isi email dan password.';
      return;
    }
    ui.loginBtn.disabled = true;
    ui.message.textContent = 'Memeriksa...';
    const result = await login(email, password);
    ui.password.value = '';
    ui.loginBtn.disabled = false;
    ui.message.textContent = result.ok ? 'Berhasil masuk. Ketik "Hay Rekz, ini Papa Ilham." di chat.' : result.message;
  });

  ui.logoutBtn.addEventListener('click', async () => {
    ui.logoutBtn.disabled = true;
    await logout();
    ui.logoutBtn.disabled = false;
    ui.message.textContent = 'Sudah keluar.';
  });

  updateUI();
}

function updateUI() {
  if (!ui || !ui.form) return;
  const loggedIn = isLoggedIn();
  ui.status.textContent = loggedIn ? 'MASUK' : 'BELUM MASUK';
  ui.fields.hidden = loggedIn;
  ui.loginBtn.hidden = loggedIn;
  ui.logoutBtn.hidden = !loggedIn;
  if (loggedIn) ui.email.value = '';
}

load();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindUI);
else bindUI();
