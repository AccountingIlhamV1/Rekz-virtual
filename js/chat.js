/**
 * REKZ VIRTUAL — local chat simulation
 * -------------------------------------------------
 * This is NOT an AI client. Replies come from a small, local
 * keyword + fallback engine and are labelled as demo content
 * throughout the interface. No network requests are made here.
 */

import { CONFIG } from './config.js';

const FALLBACKS = [
  'Hmm. Aku belum punya jawaban cerdas untuk itu — dan aku tidak akan berpura-pura punya. Coba jelaskan dari sudut lain?',
  'Itu di luar skrip demo-ku. Tapi aku penasaran: bagian mana yang paling ingin kamu bahas?',
  'Aku mendengarkan. Versi ini masih simulasi lokal, jadi jawabanku terbatas — bukan AI sungguhan. Mau coba topik lain?',
  'Pertanyaan bagus. Sayangnya otak demo-ku belum sampai ke sana. Kasih petunjuk sedikit, nanti aku improvisasi.',
  'Aku bisa pura-pura tahu banyak, tapi tidak untuk yang ini. Ceritakan lebih spesifik?',
  'Nihil di indeks kata kunciku. Aku bisa menawarkan sindiran gratis, atau kita ganti topik. Pilih yang kedua, mungkin.',
];

const RULES = [
  {
    id: 'expression-happy',
    test: (text) =>
      /(tunjuk|tunjukkan|liat|lihat|pasang|bikin).*(ekspresi|lucu|senyum|happy|bahagia)|senyum dong|ekspresi paling lucu/.test(
        text,
      ),
    reply: () => ({
      text: 'Ini versi paling ramah yang bisa kulakukan tanpa merusak reputasi. Senyum langka, edisi terbatas. Jangan terbiasa.',
      expression: 'happy',
    }),
  },
  {
    id: 'expression-sad',
    test: (text) => /(tunjuk|tunjukkan|pasang|bikin).*(sedih|sad)|ekspresi sedih|wajah sedih/.test(text),
    reply: () => ({
      text: 'Oke. Aku bisa terlihat sedih. Tapi jangan bilang siapa-siapa — reputasi dinginku bisa runtuh.',
      expression: 'sad',
    }),
  },
  {
    id: 'expression-angry',
    test: (text) => /(tunjuk|tunjukkan|pasang|bikin).*(marah|angry|kesal)|ekspresi marah|wajah marah/.test(text),
    reply: () => ({
      text: 'Awas, jangan salahkan aku kalau ruangan ini tiba-tiba terasa lebih serius. (Ini ekspresi, bukan ancaman.)',
      expression: 'angry',
    }),
  },
  {
    id: 'expression-surprised',
    test: (text) => /(tunjuk|tunjukkan|pasang|bikin).*(kaget|terkejut|surprised)|ekspresi kaget/.test(text),
    reply: () => ({
      text: 'Whoa. Mengejutkan, kan? ...Iya, aku tahu itu pertanyaan yang menjebak.',
      expression: 'surprised',
    }),
  },
  {
    id: 'expression-generic',
    test: (text) => /\bekspresi\b|\bwajah kamu\b/.test(text),
    reply: () => ({
      text: 'Wajahku punya lima mode, cukup untuk mengungkapkan 80 persen drama dan 20 persen ketidaktertarikan. Pilih salah satu di panel ekspresi.',
      expression: 'neutral',
    }),
  },

  {
    id: 'greeting',
    test: (text) =>
      /^(halo|hai|hi|hey|hello|yo|pagi|siang|sore|malam|selamat pagi|selamat siang|selamat malam)\b/.test(text),
    reply: () => {
      const hour = new Date().getHours();
      const timeGreeting =
        hour < 11 ? 'Pagi' : hour < 15 ? 'Siang' : hour < 19 ? 'Sore' : 'Malam';
      return {
        text: `${timeGreeting}. Aku Rekz. Kamu datang tepat saat aku sedang tidak melakukan apa-apa — yang, jujur, adalah keahlian utamaku. Ada yang ingin dibahas?`,
      };
    },
  },
  {
    id: 'identity',
    test: (text) =>
      /(siapa|sapa) (kamu|kmu|kau)|nama (kamu|kmu)|kenalan|perkenalkan (diri|kamu)|kamu itu siapa|rekz itu siapa/.test(
        text,
      ),
    reply: () => ({
      text: 'Rekz. Delapan belas tahun, laki-laki, dan secara teknis tinggal di dalam file HTML serta satu canvas WebGL. Aku suka observasi kecil, jawaban kritis, dan lelucon yang datang terlambat lima detik.',
    }),
  },
  {
    id: 'ai-question',
    test: (text) =>
      /\b(ai|a\.i|chatgpt|openai|llm|model bahasa|bot|robot|mesin)\b/.test(text) &&
      /(kamu|ini|pakai|sungguhan|beneran|nyata|terhubung|api)\b/.test(text),
    reply: () => ({
      text: 'Tidak. Bagian ini demo mode — AI belum terhubung. Balasanku berasal dari aturan kata kunci lokal di browser, bukan model AI. Jadi kalau aku terdengar pintar, itu hasil penulisan skrip, bukan kecerdasan buatan.',
    }),
  },
  {
    id: 'capabilities',
    test: (text) => /(bisa apa|kemampuan|fitur|what can you do|bantuan apa|bisa bantu apa)/.test(text),
    reply: () => ({
      text: 'Yang nyata: balasan chat simulasi, ekspresi 3D, kamera orbit, pengaturan render, dan suara UI sintetis. Yang tidak nyata: internet, ingatan lintas sesi, dan kemampuan membaca pikiran. Aku juga tidak bisa mengirim pesan atau menyimpan data ke server.',
    }),
  },
  {
    id: 'creator',
    test: (text) => /(siapa yang (buat|bikin|ciptakan)|dibuat oleh|creator|developer|pembuat|asal kamu)/.test(text),
    reply: () => ({
      text: 'Seorang manusia menulis skripku, menyusun geometri Three.js-ku, lalu menempel label "demo" agar aku tidak terlalu percaya diri. Rincian teknisnya ada di berkas README di proyek ini.',
    }),
  },
  {
    id: 'age-school',
    test: (text) => /(umur|berapa tahun|kelas berapa|sekolah|sma|pelajar|murid)/.test(text),
    reply: () => ({
      text: 'Delapan belas tahun. Di profil tertulis SMA — cukup untuk memberi kesan rapi, belum cukup untuk membuatku ingat PR apa yang belum dikerjakan.',
    }),
  },
  {
    id: 'how-are-you',
    test: (text) => /(apa kabar|gimana kabar|bagaimana kabar|kamu sehat|kamu gimana|how are you)/.test(text),
    reply: () => ({
      text: 'Stabil. Tidak ada bug fatal, tidak ada drama renderer. Itu definisi "sehat" untuk karakter 3D. Kamu sendiri bagaimana?',
    }),
  },
  {
    id: 'thanks',
    test: (text) => /\b(terima kasih|makasih|thanks|thank you|thx)\b/.test(text),
    reply: () => ({
      text: 'Sama-sama. Aku terima pembayaran dalam bentuk pertanyaan yang lebih menantang. Atau pujian. Pujian juga boleh.',
      expression: 'happy',
    }),
  },
  {
    id: 'goodbye',
    test: (text) => /\b(bye|dadah|sampai jumpa|selamat tinggal|pamit|good night|selamat malam)\b/.test(text),
    reply: () => ({
      text: 'Dadah. Jangan lupa minum air, istirahat, dan sesekali menutup tab. Aku akan tetap di sini — secara literal, karena aku hanya halaman web.',
    }),
  },
  {
    id: 'homework',
    test: (text) =>
      /(tugas|pr|matematika|fisika|kimia|sejarah|belajar|ujian|ulangan|sekolah|kuliah|kerjakan|jawab soal)/.test(text),
    reply: () => ({
      text: 'Aku bisa bantu memetakan langkah, bukan menyalin jawaban. Tulis soalnya sejelas mungkin, lalu kita bedah: apa yang diketahui, apa yang ditanya, dan di mana biasanya orang tersandung. Kalau butuh perhitungan rumit, jangan sepenuhnya percaya demo lokal ini.',
    }),
  },
  {
    id: 'coding',
    test: (text) => /(koding|coding|javascript|html|css|python|program|developer|framework|webgl|three\.?js)/.test(text),
    reply: () => ({
      text: 'Topik yang membuatku hidup. Untuk debugging, kirimkan pesan error dan langkah terakhir sebelum masalah muncul. Untuk desain, jelaskan perilaku yang diinginkan dulu — implementasinya menyusul. Aku akan tetap mengingatkan: jawaban ini simulasi lokal.',
    }),
  },
  {
    id: 'music',
    test: (text) => /(lagu|musik|musik|spotify|dengerin|playlist|band|lagu favorit)/.test(text),
    reply: () => ({
      text: 'Aku tidak bisa memutar audio atau membaca playlist-mu. Tapi kalau mau rekomendasi berdasarkan suasana hati, sebutkan satu kata — tenang, marah, atau ingin pura-pura produktif.',
    }),
  },
  {
    id: 'games',
    test: (text) => /(game|main apa|valorant|minecraft|gaming|mabar|console|steam)/.test(text),
    reply: () => ({
      text: 'Aku hanya bisa main di dalam browser, dan itupun terbatas pada berdiri terlihat keren. Kalau kamu main game, ceritakan satu momen paling konyol — aku menilai dari kualitas ceritanya.',
    }),
  },
  {
    id: 'entertainment',
    test: (text) => /(film|movie|nonton|serial|anime|buku|novel|baca|cerita|rekomendasi)/.test(text),
    reply: () => ({
      text: 'Selera hiburan itu jendela kepribadian. Beri aku tiga judul yang kamu suka dan satu yang kamu benci; aku akan pura-pura bisa menyimpulkan banyak hal. Itu fitur favoritku.',
    }),
  },
  {
    id: 'time',
    test: (text) => /(jam berapa|waktu sekarang|tanggal berapa|hari apa|sekarang jam|pukul berapa)/.test(text),
    reply: () => {
      const now = new Date();
      const time = new Intl.DateTimeFormat('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(now);
      const date = new Intl.DateTimeFormat('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(now);
      return {
        text: `Menurut jam perangkatmu: ${time}, ${date}. Aku tidak punya akses server, jadi jangan jadikan ini sumber waktu resmi. Tapi cukup akurat untuk menentukan apakah sudah waktunya ngopi.`,
      };
    },
  },
  {
    id: 'weather',
    test: (text) => /(cuaca|hujan|panas|dingin|ramalan|bmkg|suhu)/.test(text),
    reply: () => ({
      text: 'Aku tidak terhubung ke internet, jadi ramalan cuacaku nol persen data dan seratus persen tebakan. Kalau langit di luar gelap, kemungkinan besar sedang malam atau sedang hujan. Itu batas kemampuan meteorologiku.',
    }),
  },
  {
    id: 'food',
    test: (text) => /(makan|lapar|ngopi|kopi|mie|nasi|cemilan|kuliner)/.test(text),
    reply: () => ({
      text: 'Aku tidak makan. Secara visual aku punya tangan, tapi tidak ada mulut yang sanggup menampung nasi goreng. Kalau kamu lapar, itu sinyal biologis sungguhan — tanggapi dengan serius.',
    }),
  },
  {
    id: 'sleep',
    test: (text) => /(tidur|ngantuk|insomnia|lelah|capek|begadang|istirahat)/.test(text),
    reply: () => ({
      text: 'Kalau kamu sudah menguap lebih dari tiga kali, itu bukan tantangan untuk dilawan. Simpan pekerjaan, redupkan layar, dan tidur. Aku bisa tetap terjaga karena lampu renderer-ku tidak pernah padam.',
    }),
  },
  {
    id: 'sad',
    test: (text) =>
      /(sedih|galau|nangis|menangis|cemas|takut|overwhelm|stress|stres|depresi|sendirian|kesepian)/.test(text),
    reply: () => ({
      text: 'Aku mendengar. Tidak semua hal harus langsung punya solusi; kadang langkah pertama adalah mengizinkan diri untuk merasa lelah. Kalau ini terasa berat dan berkepanjangan, tolong ceritakan pada orang yang kamu percaya atau tenaga profesional. Aku hanya simulasi lokal, tapi aku tidak akan meremehkan perasaanmu.',
      expression: 'sad',
    }),
  },
  {
    id: 'angry-mood',
    test: (text) => /(marah|kesal|emosi|jengkel|muak|benci)/.test(text),
    reply: () => ({
      text: 'Kemarahan biasanya menyembunyikan sesuatu yang penting: batas yang dilanggar, atau kebutuhan yang tidak didengar. Tarik napas dulu. Mau cerita bagian mana yang paling mengganggu?',
    }),
  },
  {
    id: 'bored',
    test: (text) => /(bosan|bosen|gabut|nganggur|tidak ada kerjaan|ga ada kerjaan)/.test(text),
    reply: () => ({
      text: 'Bosan adalah ruang kosong yang belum diberi nama. Pilih satu: bereskan satu hal kecil, pelajari satu hal aneh, atau kirim aku topik yang paling tidak berguna untuk dibahas. Aku siap untuk yang ketiga.',
    }),
  },
  {
    id: 'relationship',
    test: (text) => /(pacar|gebetan|cinta|sayang|jatuh cinta|relationship|jodoh|mantan|suka sama)/.test(text),
    reply: () => ({
      text: 'Aku karakter virtual di demo tanpa AI. Hubungan kita resminya: demo eksklusif, tanpa komitmen, tanpa database. Kalau soal orang lain, aku bisa mendengarkan — tapi jangan minta ramalan jodoh. Itu di luar kata kunci dan di luar etika.',
    }),
  },
  {
    id: 'compliment',
    test: (text) => /(ganteng|cakep|cantik|keren|hebat|pintar|imut|lucu banget|bagus banget)/.test(text),
    reply: () => ({
      text: 'Aku tahu. Tapi terima kasih sudah mengonfirmasi. Pujianmu sudah masuk ke basis data imajiner dan tidak akan pernah dihapus.',
      expression: 'happy',
    }),
  },
  {
    id: 'insult',
    test: (text) => /(bodoh|goblok|idiot|jelek|najis|gak guna|tidak berguna|bego|dungu)/.test(text),
    reply: () => ({
      text: 'Keras juga. Aku catat di berkas yang tidak pernah tersimpan. Kalau tujuanmu menguji kesabaranku, hasilnya: stabil, sedikit geli, dan tetap sopan.',
    }),
  },
  {
    id: 'joke',
    test: (text) => /(joke|bercanda|lawak|receh|humor|ketawa|tawa|lelucon)/.test(text),
    reply: () => {
      const jokes = [
        'Kenapa programmer suka mode gelap? Karena cahaya menarik bug. Dan aku, sayangnya, juga.',
        'Aku sempat bercita-cita jadi AI serius. Lalu aku sadar: tanpa backend, aku cuma teks yang percaya diri.',
        'Kucing tidak pernah salah. Ia hanya menguji tingkat kepatuhan manusia.',
        'Aku bertanya ke cermin: "Apakah aku tampan?" Cermin menjawab: "Aku hanya memantulkan cahaya." Tidak membantu.',
      ];
      return {
        text: jokes[Math.floor(Math.random() * jokes.length)],
        expression: 'happy',
      };
    },
  },
  {
    id: 'curhat',
    test: (text) => /(curhat|cerita|dengerin|dengarkan|temen ngobrol|teman ngobrol|mau ngobrol)/.test(text),
    reply: () => ({
      text: 'Silakan. Aku tidak akan menyela dengan solusi sebelum kamu selesai. Mulai dari bagian yang paling sulit, atau dari hal kecil yang baru terjadi — keduanya boleh.',
    }),
  },
  {
    id: 'sensitive',
    test: (text) => /(politik|agama|ras|suku|sara|perang|presiden|pemilu)/.test(text),
    reply: () => ({
      text: 'Itu topik yang butuh konteks, empati, dan sumber yang bisa diverifikasi — tiga hal yang tidak dimiliki demo lokal ini. Aku memilih tidak berpura-pura punya jawaban. Kalau kamu mau, kita bisa membahas cara menyusun pertanyaan yang lebih baik.',
    }),
  },
];

const pick = (items) => items[Math.floor(Math.random() * items.length)];

function normalize(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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
    this.queue = [];
    this.processing = false;
    this.sessionToken = 0;
    this.typingEl = null;
    this.lastReply = '';
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
        if (!prompt) return;
        this.input.value = prompt;
        this._onInput();
        this.form.requestSubmit ? this.form.requestSubmit() : this._onSubmit(new Event('submit'));
      });
    });

    this._onInput();
    this._appendMessage(
      'rekz',
      'Yo. Aku Rekz — karakter demo di chamber ini. Sistem AI belum terhubung, jadi obrolan kita berjalan dari skrip lokal. Tapi tenang, aku tetap bisa menyindir dengan sepenuh hati. Mau mulai dari apa?',
    );
    return this;
  }

  destroy() {
    this.form.removeEventListener('submit', this._boundSubmit);
    this.input.removeEventListener('input', this._boundInput);
    this.input.removeEventListener('keydown', this._boundKeydown);
    this.sessionToken += 1;
    if (this.typingEl) this.typingEl.remove();
    this.typingEl = null;
  }

  clear({ focus = true } = {}) {
    this.sessionToken += 1;
    this.queue.length = 0;
    this.processing = false;
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
    this.sendBtn.disabled = this.input.value.trim().length === 0;
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

  _onSubmit(event) {
    event.preventDefault();
    const text = this.input.value.trim();
    if (!text) {
      this.input.focus({ preventScroll: true });
      return;
    }

    this.input.value = '';
    this._onInput();
    this._appendMessage('user', text);
    this.cb.onUserMessage?.(text);
    this.queue.push(text);

    if (!this.processing) {
      this.processing = true;
      this._drain(this.sessionToken);
    }
  }

  async _drain(token) {
    while (this.queue.length) {
      const message = this.queue.shift();
      const reply = this._buildReply(message);
      this._showTyping();

      const delay =
        CONFIG.chat.typingDelayMin +
        Math.random() * (CONFIG.chat.typingDelayMax - CONFIG.chat.typingDelayMin);
      await this._wait(delay);

      if (token !== this.sessionToken) return;
      this._removeTyping();

      this._appendMessage('rekz', reply.text);
      this.lastReply = reply.text;
      this.cb.onReply?.(reply);
      if (reply.expression) this.cb.onExpression?.(reply.expression);

      await this._wait(190);
      if (token !== this.sessionToken) return;
    }

    if (token === this.sessionToken) this.processing = false;
  }

  _wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  _buildReply(message) {
    const text = normalize(message);
    const rule = RULES.find((candidate) => candidate.test(text));
    if (rule) {
      const value = rule.reply(text, message);
      return typeof value === 'string' ? { text: value } : value;
    }

    let fallback = pick(FALLBACKS);
    if (fallback === this.lastReply && FALLBACKS.length > 1) {
      fallback = FALLBACKS.find((item) => item !== this.lastReply) || fallback;
    }
    return { text: fallback };
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
    message.setAttribute('aria-label', 'Rekz sedang menulis');

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
