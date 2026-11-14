/**
 * REKZ VIRTUAL 0.2.4 — chat client (General Mode + Papa Mode)
 * -------------------------------------------------
 * Mengirim percakapan ke Supabase Edge Function "rekz-chat" dan
 * menampilkan balasan AI. Tidak ada API key di file ini.
 * Nama kelas "ChatDemo" dipertahankan agar main.js tidak perlu diubah.
 *
 * Dua riwayat yang benar-benar terpisah:
 *  - General: disimpan di localStorage perangkat ini, hanya riwayat General yang dikirim ke server.
 *  - Papa: TIDAK pernah disimpan di browser. Disimpan server (tabel chat_messages) dan dimuat
 *    lewat aksi "history" hanya saat server menyatakan Papa Mode aktif. Mode selalu dari server.
 * Pertukaran verifikasi (pemicu, pertanyaan, jawaban tanggal lahir) bersifat "ephemeral":
 * tidak pernah disimpan.
 */

import { CONFIG } from './config.js';
import { getAccessToken, clearSession, onAuthChange, isLoggedIn } from './auth.js';

const GREETING =
  'Yo. Aku Rekz. Kamu datang tepat waktu — aku baru saja kehabisan hal menarik untuk dipikirkan. Mau mulai dari apa?';

const ERROR_NETWORK = 'Koneksi ke server gagal. Cek internetmu lalu coba kirim lagi.';
const ERROR_TIMEOUT = 'Server terlalu lama menjawab. Coba kirim lagi sebentar lagi.';
const ERROR_GENERIC = 'Rekz sedang tidak bisa menjawab. Coba lagi sebentar.';
const ERROR_SESSION = 'Sesi login berakhir. Masuk lagi lewat Menu.';
const PAPA_GREETING = 'Yo, Pa. Papa Mode nyala. Lanjut dari mana?';
const NOTICE_EXPIRED =
  'Masa aktif Papa Mode sudah habis. Riwayat Papa tetap tersimpan; verifikasi lagi untuk melanjutkan.';
const NOTICE_EXPIRED_UNSENT =
  'Masa aktif Papa Mode sudah habis, jadi pesan tadi tidak dikirim. Riwayat Papa tetap tersimpan.';
const NOTICE_NOT_SAVED = 'Pesan terakhir belum tersimpan di riwayat Papa.';
const NOTICE_LOAD_FAILED = 'Riwayat Papa belum berhasil dimuat. Pesan baru tetap akan disimpan.';

const GENERAL_KEY = 'rekz-virtual:chat:general:v1';
const HISTORY_TIMEOUT_MS = 15000;

function formatTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function escapeLineBreaks(text) {
  return String(text).replace(/\r\n/g, '\n');
}

export class ChatDemo {
  constructor({
    thread,
    form,
    input,
    sendBtn,
    clearBtn,
    emptyState,
    suggestions,
    count,
    callbacks = {},
  }) {
    this.thread = thread;
    this.form = form;
    this.input = input;
    this.sendBtn = sendBtn;
    this.clearBtn = clearBtn;
    this.emptyState = emptyState;
    this.suggestions = suggestions;
    this.count = count;
    this.cb = callbacks;

    this.maxLength = CONFIG.chat.maxInputLength;
    this.maxMessages = CONFIG.chat.maxMessages;
    this.maxHistory = CONFIG.chat.maxHistory;
    // Dua ruang riwayat terpisah. Papa hanya cache memori dari server dan dikosongkan saat keluar.
    this.stores = { general: [], papa: [] };
    this.mode = 'general';
    this.papaExpiresAt = 0;
    this._expiryTimer = null;
    this._wasLoggedIn = false;
    this._syncSeq = 0;
    this.busy = false;
    this.sessionToken = 0;
    this.controller = null;
    this.typingEl = null;
    this.modeLabel = document.getElementById('chatModeLabel');
    this.modeMeta = document.getElementById('modeMeta');
    this.aiBadge = document.getElementById('aiBadge');
    this.aiBadgeText = document.getElementById('aiBadgeText');
    this._unsubAuth = null;
    this.suggestionButtons = suggestions
      ? Array.from(suggestions.querySelectorAll('[data-prompt]'))
      : [];

    this._boundSubmit = (event) => this._onSubmit(event);
    this._boundInput = () => this._onInput();
    this._boundKeydown = (event) => this._onKeydown(event);
  }

  init() {
    this.input.maxLength = this.maxLength;
    this.form.addEventListener('submit', this._boundSubmit);
    this.input.addEventListener('input', this._boundInput);
    this.input.addEventListener('keydown', this._boundKeydown);
    this.suggestionButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const prompt = button.dataset.prompt;
        if (!prompt || this.busy) return;
        this.input.value = prompt;
        this._onInput();
        this.form.requestSubmit ? this.form.requestSubmit() : this._onSubmit(new Event('submit'));
      });
    });

    this._wasLoggedIn = isLoggedIn();
    this._unsubAuth = onAuthChange((loggedIn) => this._onAuth(loggedIn));
    this._onInput();
    this._loadGeneral();
    this._setMode('general');
    // Sapaan awal hanya tampilan lokal; tidak masuk riwayat yang dikirim ke AI.
    this._renderThread();
    // Jika sudah login dan masa aktif Papa Mode masih berlaku, server akan menyatakannya.
    if (this._wasLoggedIn) this.syncPapa();
    return this;
  }

  /** Riwayat mode yang sedang tampil (untuk debugging di konsol). */
  get history() {
    return this.stores[this.mode];
  }

  destroy() {
    this.form.removeEventListener('submit', this._boundSubmit);
    this.input.removeEventListener('input', this._boundInput);
    this.input.removeEventListener('keydown', this._boundKeydown);
    this.sessionToken += 1;
    if (this.controller) this.controller.abort();
    this.controller = null;
    if (this._unsubAuth) this._unsubAuth();
    window.clearTimeout(this._expiryTimer);
    this._removeTyping();
  }

  /** Satu-satunya penggerak label mode (header + kepala chat). Nilai selalu dari server. */
  _setMode(mode) {
    const papa = mode === 'papa';
    if (this.modeLabel) {
      this.modeLabel.textContent = papa ? 'Teman virtual · Papa Mode' : 'Teman virtual · General Mode';
      this.modeLabel.classList.toggle('is-papa', papa);
    }
    if (this.modeMeta) {
      this.modeMeta.textContent = papa ? 'PAPA MODE' : 'GENERAL MODE';
      this.modeMeta.classList.toggle('is-papa', papa);
    }
  }

  /** Status koneksi AI nyata: "online" setelah server menjawab, "offline" jika jaringan/server gagal. */
  _setAi(state) {
    if (!this.aiBadge || !this.aiBadgeText) return;
    const online = state === 'online';
    const offline = state === 'offline';
    this.aiBadgeText.textContent = online ? 'AI TERHUBUNG' : offline ? 'AI TERPUTUS' : 'AI SIAP';
    this.aiBadge.classList.toggle('is-online', online);
    this.aiBadge.classList.toggle('is-offline', offline);
  }

  /**
   * Mengosongkan TAMPILAN saja. Riwayat tetap tersimpan (General di perangkat ini, Papa di server)
   * dan akan tampil lagi setelah muat ulang atau pergantian mode.
   */
  clear({ focus = true } = {}) {
    this.thread.replaceChildren();
    this.typingEl = null;
    if (this.busy) this._showTyping();
    if (this.emptyState) this.emptyState.hidden = false;
    this._onInput();
    if (focus) this.input.focus({ preventScroll: true });
    this.cb.onCleared?.();
  }

  focusInput() {
    this.input.focus({ preventScroll: true });
  }

  _onInput() {
    const value = this.input.value;
    if (value.length > this.maxLength) {
      this.input.value = value.slice(0, this.maxLength);
    }
    const length = this.input.value.length;
    this.sendBtn.disabled = this.busy || this.input.value.trim().length === 0;
    if (this.count) {
      this.count.textContent = `${length}/${this.maxLength}`;
      this.count.classList.toggle('is-visible', length > 0);
    }
    this.input.style.height = 'auto';
    const maxHeight = window.matchMedia('(max-width: 700px)').matches ? 68 : 78;
    this.input.style.height = `${Math.min(this.input.scrollHeight, maxHeight)}px`;
  }

  _onKeydown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    this.form.requestSubmit ? this.form.requestSubmit() : this._onSubmit(new Event('submit'));
  }

  _setBusy(value) {
    this.busy = value;
    this.form.classList.toggle('is-busy', value);
    this.form.setAttribute('aria-busy', value ? 'true' : 'false');
    this._onInput();
  }

  _onSubmit(event) {
    event.preventDefault();
    // Cegah pengiriman ganda selama request masih berjalan.
    if (this.busy) return;

    const text = this.input.value.trim();
    if (!text) {
      this.input.focus({ preventScroll: true });
      return;
    }

    // Masa aktif Papa Mode habis di sisi klien: jangan kirim pesan Papa sebagai General.
    if (this.mode === 'papa' && this.papaExpiresAt && Date.now() >= this.papaExpiresAt) {
      this._leavePapa();
      this._notice(NOTICE_EXPIRED_UNSENT);
      return; // teks tetap di kotak input
    }

    this.input.value = '';
    const sentMode = this.mode;
    const entry = { role: 'user', text, t: Date.now(), pending: true };
    this._push(sentMode, entry);
    this._appendMessage('user', text);
    this.cb.onUserMessage?.(text);
    this._setBusy(true);
    this._request(this.sessionToken, sentMode, entry);
  }

  /* ---------- penyimpanan dua riwayat ---------- */

  _push(modeKey, entry) {
    const list = this.stores[modeKey];
    list.push(entry);
    while (list.length > this.maxMessages) list.shift();
  }

  _drop(modeKey, entry) {
    const list = this.stores[modeKey];
    const index = list.indexOf(entry);
    if (index >= 0) list.splice(index, 1);
  }

  /** Riwayat General di localStorage. Tidak pernah menyimpan pesan ephemeral/verifikasi atau yang belum dijawab. */
  _saveGeneral() {
    try {
      const data = this.stores.general
        .filter((e) => !e.ephemeral && !e.pending)
        .slice(-this.maxMessages)
        .map((e) => ({ role: e.role, text: e.text, t: e.t }));
      window.localStorage.setItem(GENERAL_KEY, JSON.stringify(data));
    } catch {
      /* penyimpanan tidak tersedia: riwayat General hanya hidup di memori */
    }
  }

  _loadGeneral() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(GENERAL_KEY) || '[]');
      if (!Array.isArray(raw)) return;
      this.stores.general = raw
        .filter((e) => e && (e.role === 'user' || e.role === 'rekz') && typeof e.text === 'string' && e.text.trim())
        .slice(-this.maxMessages)
        .map((e) => ({ role: e.role, text: e.text, t: Number(e.t) || Date.now() }));
    } catch {
      this.stores.general = [];
    }
  }

  /** Menggambar ulang thread dari riwayat mode aktif. Tidak mengubah data apa pun. */
  _renderThread() {
    this._removeTyping();
    this.thread.replaceChildren();
    const list = this.stores[this.mode];
    if (this.mode === 'general') this._appendMessage('rekz', GREETING);
    else if (!list.length) this._appendMessage('rekz', PAPA_GREETING);
    list.forEach((e) => this._appendMessage(e.role, e.text, { time: e.t }));
    if (this.busy) this._showTyping();
  }

  _switchView(modeKey) {
    this.mode = modeKey;
    this._setMode(modeKey);
    this._renderThread();
  }

  /** Pesan sistem lokal: hanya tampilan, tidak masuk riwayat mana pun. */
  _notice(text) {
    this._appendMessage('rekz', `⚠ ${text}`);
  }

  /* ---------- Papa Mode ---------- */

  _onAuth(loggedIn) {
    const was = this._wasLoggedIn;
    this._wasLoggedIn = loggedIn;
    if (!loggedIn) {
      this._leavePapa();
      return;
    }
    if (!was) this.syncPapa();
  }

  /** Keluar dari Papa Mode di klien: kosongkan cache memori Papa dan kembali ke General. Data server tidak disentuh. */
  _leavePapa() {
    this._syncSeq += 1;
    window.clearTimeout(this._expiryTimer);
    this.papaExpiresAt = 0;
    this.stores.papa = [];
    if (this.mode === 'papa') this._switchView('general');
  }

  _scheduleExpiry() {
    window.clearTimeout(this._expiryTimer);
    if (!this.papaExpiresAt) return;
    const delay = Math.max(0, this.papaExpiresAt - Date.now());
    this._expiryTimer = window.setTimeout(() => this._onExpiry(), Math.min(delay + 250, 2147000000));
  }

  _onExpiry() {
    if (this.mode !== 'papa') return;
    this._leavePapa();
    this._notice(NOTICE_EXPIRED);
  }

  /** Tanya server apakah Papa Mode aktif dan, jika ya, ambil riwayat Papa. Tidak melempar error. */
  async _fetchPapa() {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), HISTORY_TIMEOUT_MS);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) return { ok: false };
      const response = await fetch(CONFIG.api.chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action: 'history' }),
        signal: controller.signal,
      });
      if (response.status === 401) {
        clearSession();
        return { ok: false };
      }
      if (!response.ok) return { ok: false };
      const data = await response.json();
      if (!data || (data.mode !== 'papa' && data.mode !== 'general')) return { ok: false };
      if (data.mode === 'general') return { ok: true, mode: 'general' };
      const messages = (Array.isArray(data.messages) ? data.messages : [])
        .filter((m) => m && typeof m.text === 'string' && m.text.trim())
        .map((m) => ({
          role: m.role === 'user' ? 'user' : 'rekz',
          text: m.text,
          t: Date.parse(m.created_at) || Date.now(),
        }));
      return { ok: true, mode: 'papa', messages, expires: Date.parse(data.papa_expires_at) || 0 };
    } catch {
      return { ok: false };
    } finally {
      window.clearTimeout(timer);
    }
  }

  /** Dipanggil saat halaman dibuka atau setelah login: masuk Papa Mode hanya jika server menyatakannya aktif. */
  async syncPapa() {
    if (!isLoggedIn() || this.busy) return;
    const seq = (this._syncSeq += 1);
    const result = await this._fetchPapa();
    if (seq !== this._syncSeq || !isLoggedIn() || this.busy) return;
    if (!result.ok) return;
    if (result.mode === 'papa') {
      this.stores.papa = result.messages.slice(-this.maxMessages);
      this.papaExpiresAt = result.expires;
      this._switchView('papa');
      this._scheduleExpiry();
    } else if (this.mode === 'papa') {
      this._leavePapa();
    }
  }

  /** Masuk Papa Mode setelah server menyatakannya. Mengembalikan true jika riwayat Papa berhasil dimuat. */
  async _enterPapa(expires) {
    const result = await this._fetchPapa();
    const loaded = result.ok && result.mode === 'papa';
    this.stores.papa = loaded ? result.messages.slice(-this.maxMessages) : [];
    this.papaExpiresAt = (loaded && result.expires) || expires || 0;
    this._syncSeq += 1;
    this._switchView('papa');
    this._scheduleExpiry();
    if (!loaded) this._notice(NOTICE_LOAD_FAILED);
    return loaded;
  }

  async _request(token, sentMode, entry) {
    this._showTyping();
    const controller = new AbortController();
    this.controller = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CONFIG.api.timeoutMs);

    let result = null;
    let errorText = '';
    let sessionExpired = false;

    try {
      // Token hanya ada jika Papa sudah masuk; server yang memutuskan mode.
      let accessToken = null;
      try {
        accessToken = await getAccessToken();
      } catch {
        accessToken = null;
      }
      const headers = { 'Content-Type': 'application/json' };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      // Papa: hanya pesan baru yang dikirim; server memakai riwayat Papa dari database.
      // General: hanya riwayat General yang dikirim, tidak pernah ada isi Papa.
      const messages =
        sentMode === 'papa'
          ? [{ role: 'user', text: entry.text }]
          : this.stores.general.slice(-this.maxHistory).map(({ role, text }) => ({ role, text }));

      const response = await fetch(CONFIG.api.chatUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ messages }),
        signal: controller.signal,
      });
      this._setAi(response.status >= 500 ? 'offline' : 'online');

      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        if (response.status === 401 && accessToken) {
          sessionExpired = true; // token ditolak server: paksa masuk ulang
          errorText = ERROR_SESSION;
        } else {
          errorText = (data && typeof data.error === 'string' && data.error) || ERROR_GENERIC;
        }
      } else if (!data || typeof data.reply !== 'string' || !data.reply.trim()) {
        errorText = 'Rekz memberi jawaban kosong. Coba kalimat lain.';
      } else {
        result = {
          reply: data.reply.trim(),
          mode: data.mode === 'papa' ? 'papa' : 'general',
          ephemeral: data.ephemeral === true,
          expires: typeof data.papa_expires_at === 'string' ? Date.parse(data.papa_expires_at) || 0 : 0,
          persisted: data.persisted !== false,
        };
      }
    } catch (error) {
      if (token !== this.sessionToken) return; // komponen sudah dihancurkan
      this._setAi('offline');
      errorText = timedOut ? ERROR_TIMEOUT : ERROR_NETWORK;
    } finally {
      window.clearTimeout(timer);
    }

    if (token !== this.sessionToken) return;
    this.controller = null;
    this._removeTyping();

    if (sentMode === 'papa' && this.mode !== 'papa') {
      // Papa Mode sudah ditinggalkan selama menunggu (keluar atau habis): hasilnya dibuang, tidak ditampilkan.
      this._drop('papa', entry);
    } else if (result) {
      await this._handleReply(result, sentMode, entry);
    } else {
      // Pesan gagal dikeluarkan dari riwayat agar tidak menumpuk.
      this._drop(sentMode, entry);
      if (sessionExpired) {
        clearSession();
        this._notice(errorText);
      } else {
        this._appendMessage('rekz', `⚠ ${errorText}`);
      }
      this.cb.onError?.(errorText);
    }

    this._setBusy(false);
    this.input.focus({ preventScroll: true });
  }

  /** Menempatkan pertukaran pesan ke riwayat yang benar berdasarkan mode dari SERVER. */
  async _handleReply(result, sentMode, entry) {
    const { reply, mode: serverMode, ephemeral, expires, persisted } = result;
    const replyEntry = { role: 'rekz', text: reply, t: Date.now() };
    if (ephemeral) {
      entry.ephemeral = true;
      replyEntry.ephemeral = true;
    }
    delete entry.pending;

    // Server menyatakan Papa tetapi sesi login sudah tidak ada di klien: buang.
    if (serverMode === 'papa' && !isLoggedIn()) {
      this._drop(sentMode, entry);
      this._notice(ERROR_SESSION);
      return;
    }

    if (sentMode === 'general' && serverMode === 'general') {
      this._push('general', replyEntry);
      this._appendMessage('rekz', reply);
      this._saveGeneral();
      this.cb.onReply?.({ text: reply });
      return;
    }

    if (sentMode === 'general' && serverMode === 'papa') {
      // Pesan ini milik Papa Mode: keluarkan dari General (jangan pernah tersimpan di perangkat).
      this._drop('general', entry);
      if (ephemeral) {
        // Verifikasi berhasil: bersihkan semua jejak verifikasi dari General, lalu buka riwayat Papa.
        this.stores.general = this.stores.general.filter((e) => !e.ephemeral);
        this._saveGeneral();
        await this._enterPapa(expires);
        this._push('papa', replyEntry);
        this._appendMessage('rekz', reply);
        this.cb.onReply?.({ text: reply });
        return;
      }
      // Tampilan klien tertinggal dari server (Papa Mode sudah aktif): pindahkan ke ruang Papa.
      this._saveGeneral();
      const loaded = await this._enterPapa(expires);
      if (!loaded || !persisted) {
        entry.t = entry.t || Date.now();
        this._push('papa', entry);
        this._push('papa', replyEntry);
        this._renderThread();
        if (!persisted) this._notice(NOTICE_NOT_SAVED);
      }
      this.cb.onReply?.({ text: reply });
      return;
    }

    if (sentMode === 'papa' && serverMode === 'papa') {
      this._push('papa', replyEntry);
      if (expires) {
        this.papaExpiresAt = expires;
        this._scheduleExpiry();
      }
      this._appendMessage('rekz', reply);
      if (!persisted) this._notice(NOTICE_NOT_SAVED);
      this.cb.onReply?.({ text: reply });
      return;
    }

    // sentMode === 'papa' && serverMode === 'general': masa aktif sudah habis di server.
    // Pesan Papa tidak boleh masuk riwayat General; balasan General dibuang.
    this._drop('papa', entry);
    this._leavePapa();
    this._notice(NOTICE_EXPIRED_UNSENT);
  }

  _appendMessage(role, text, { time: at } = {}) {
    if (this.emptyState) this.emptyState.hidden = true;
    const now = at ? new Date(at) : new Date();
    const message = document.createElement('article');
    message.className = `message message--${role}`;

    const meta = document.createElement('div');
    meta.className = 'message__meta';
    const author = document.createElement('span');
    author.textContent = role === 'user' ? 'KAMU' : 'REKZ';
    const time = document.createElement('time');
    time.dateTime = now.toISOString();
    time.textContent = formatTime(now);
    meta.append(author, time);

    const bubble = document.createElement('div');
    bubble.className = 'message__bubble';
    bubble.textContent = escapeLineBreaks(text);

    message.append(meta, bubble);
    this.thread.append(message);
    this._trimHistory();
    this._scrollToBottom();
    return message;
  }

  _showTyping() {
    if (this.typingEl || !this.thread) return;
    if (this.emptyState) this.emptyState.hidden = true;
    const now = new Date();
    const message = document.createElement('article');
    message.className = 'message message--rekz is-typing';
    message.setAttribute('aria-label', 'Rekz sedang berpikir');

    const meta = document.createElement('div');
    meta.className = 'message__meta';
    const author = document.createElement('span');
    author.textContent = 'REKZ';
    const time = document.createElement('time');
    time.dateTime = now.toISOString();
    time.textContent = formatTime(now);
    meta.append(author, time);

    const bubble = document.createElement('div');
    bubble.className = 'message__bubble typing-bubble';
    for (let i = 0; i < 3; i += 1) {
      bubble.append(document.createElement('span'));
    }

    message.append(meta, bubble);
    this.thread.append(message);
    this.typingEl = message;
    this._scrollToBottom();
  }

  _removeTyping() {
    if (!this.typingEl) return;
    this.typingEl.remove();
    this.typingEl = null;
  }

  _trimHistory() {
    const messages = Array.from(this.thread.querySelectorAll('.message:not(.is-typing)'));
    const excess = messages.length - this.maxMessages;
    if (excess > 0) {
      messages.slice(0, excess).forEach((message) => message.remove());
    }
  }

  _scrollToBottom() {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.requestAnimationFrame(() => {
      this.thread.scrollTo({
        top: this.thread.scrollHeight,
        behavior: reduced ? 'auto' : 'smooth',
      });
    });
  }
}
