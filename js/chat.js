/**
 * REKZ VIRTUAL 0.2 — chat client (General Mode)
 * -------------------------------------------------
 * Mengirim percakapan ke Supabase Edge Function "rekz-chat" dan
 * menampilkan balasan AI. Tidak ada API key di file ini.
 * Nama kelas "ChatDemo" dipertahankan agar main.js tidak perlu diubah.
 */

import { CONFIG } from './config.js';

const GREETING =
  'Yo. Aku Rekz. Kamu datang tepat waktu — aku baru saja kehabisan hal menarik untuk dipikirkan. Mau mulai dari apa?';

const ERROR_NETWORK = 'Koneksi ke server gagal. Cek internetmu lalu coba kirim lagi.';
const ERROR_TIMEOUT = 'Server terlalu lama menjawab. Coba kirim lagi sebentar lagi.';
const ERROR_GENERIC = 'Rekz sedang tidak bisa menjawab. Coba lagi sebentar.';

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
    this.history = [];
    this.busy = false;
    this.sessionToken = 0;
    this.controller = null;
    this.typingEl = null;
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

    this._onInput();
    // Sapaan awal hanya tampilan lokal; tidak masuk riwayat yang dikirim ke AI.
    this._appendMessage('rekz', GREETING);
    return this;
  }

  destroy() {
    this.form.removeEventListener('submit', this._boundSubmit);
    this.input.removeEventListener('input', this._boundInput);
    this.input.removeEventListener('keydown', this._boundKeydown);
    this.sessionToken += 1;
    if (this.controller) this.controller.abort();
    this.controller = null;
    this._removeTyping();
  }

  clear({ focus = true } = {}) {
    this.sessionToken += 1;
    if (this.controller) this.controller.abort();
    this.controller = null;
    this.history = [];
    this.busy = false;
    this._removeTyping();
    this.thread.replaceChildren();
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

    this.input.value = '';
    this._appendMessage('user', text);
    this.history.push({ role: 'user', text });
    this.cb.onUserMessage?.(text);
    this._setBusy(true);
    this._request(this.sessionToken);
  }

  async _request(token) {
    this._showTyping();
    const controller = new AbortController();
    this.controller = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CONFIG.api.timeoutMs);

    let reply = '';
    let errorText = '';

    try {
      const response = await fetch(CONFIG.api.chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: this.history.slice(-this.maxHistory) }),
        signal: controller.signal,
      });

      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        errorText = (data && typeof data.error === 'string' && data.error) || ERROR_GENERIC;
      } else if (!data || typeof data.reply !== 'string' || !data.reply.trim()) {
        errorText = 'Rekz memberi jawaban kosong. Coba kalimat lain.';
      } else {
        reply = data.reply.trim();
      }
    } catch (error) {
      if (token !== this.sessionToken) return; // percakapan sudah dibersihkan
      errorText = timedOut ? ERROR_TIMEOUT : ERROR_NETWORK;
    } finally {
      window.clearTimeout(timer);
    }

    // Jika percakapan dibersihkan saat menunggu, abaikan hasilnya.
    if (token !== this.sessionToken) return;
    this.controller = null;
    this._removeTyping();

    if (reply) {
      this.history.push({ role: 'rekz', text: reply });
      this._appendMessage('rekz', reply);
      this.cb.onReply?.({ text: reply });
    } else {
      // Pesan gagal dikeluarkan dari riwayat agar tidak menumpuk.
      if (this.history.length && this.history[this.history.length - 1].role === 'user') {
        this.history.pop();
      }
      this._appendMessage('rekz', `⚠ ${errorText}`);
      this.cb.onError?.(errorText);
    }

    this._setBusy(false);
    this.input.focus({ preventScroll: true });
  }

  _appendMessage(role, text) {
    if (this.emptyState) this.emptyState.hidden = true;
    const now = new Date();
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
