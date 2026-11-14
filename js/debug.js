/**
 * REKZ VIRTUAL 0.3 — Tahap 1: diagnostik sementara
 * -------------------------------------------------
 * Hanya aktif jika alamat halaman memakai ?debug=1.
 * Tanpa ?debug=1 file ini langsung berhenti dan tidak mengubah apa pun.
 * Hanya MEMBACA data perangkat; tidak mengubah avatar, chat, atau CSS.
 * Setelah pengukuran selesai, file ini dan satu baris di index.html bisa dihapus.
 */

(function rekzDebug() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') !== '1') return;

  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = [
    'position:fixed',
    'top:8px',
    'left:8px',
    'z-index:2147483647',
    'max-width:min(340px,calc(100vw - 16px))',
    'padding:8px 10px',
    'border-radius:8px',
    'background:rgba(0,0,0,0.82)',
    'color:#9fd0ff',
    'font:11px/1.45 ui-monospace,Menlo,Consolas,monospace',
    'white-space:pre-wrap',
    'pointer-events:none',
  ].join(';');

  const text = document.createElement('div');
  box.appendChild(text);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Salin';
  copyBtn.style.cssText = [
    'margin-top:6px',
    'padding:4px 10px',
    'border:1px solid #2f7bff',
    'border-radius:6px',
    'background:#0b326f',
    'color:#fff',
    'font:11px system-ui,sans-serif',
    'pointer-events:auto',
  ].join(';');
  box.appendChild(copyBtn);

  let lastReport = '';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(lastReport);
      copyBtn.textContent = 'Tersalin';
    } catch {
      copyBtn.textContent = 'Gagal salin';
    }
    window.setTimeout(() => {
      copyBtn.textContent = 'Salin';
    }, 1500);
  });

  document.body.appendChild(box);

  // --- Hitung FPS sendiri (hanya membaca laju frame halaman) ---
  const samples = []; // FPS per 0.5 detik, simpan 10 sampel terakhir (5 detik)
  let frames = 0;
  let windowStart = performance.now();

  function tick(now) {
    frames += 1;
    const elapsed = now - windowStart;
    if (elapsed >= 500) {
      samples.push((frames * 1000) / elapsed);
      if (samples.length > 10) samples.shift();
      frames = 0;
      windowStart = now;
    }
    window.requestAnimationFrame(tick);
  }
  window.requestAnimationFrame(tick);

  const mq = (query) => (window.matchMedia(query).matches ? 'ya' : 'tidak');

  function build() {
    const vv = window.visualViewport;
    const app = window.RekzVirtual;
    const canvas = document.getElementById('avatar-canvas');
    const stage = document.getElementById('stage');

    const now = samples.length ? samples[samples.length - 1] : 0;
    const avg = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
    const low = samples.length ? Math.min(...samples) : 0;

    const lines = [
      'REKZ DEBUG',
      `Viewport CSS : ${window.innerWidth} x ${window.innerHeight}`,
      `Visual VP    : ${vv ? `${Math.round(vv.width)} x ${Math.round(vv.height)}` : 'tidak ada'}`,
      `DPR          : ${window.devicePixelRatio}`,
      `Layar        : ${screen.width} x ${screen.height}`,
      `Orientasi    : ${mq('(orientation: landscape)') === 'ya' ? 'landscape' : 'portrait'}`,
      `Pointer kasar: ${mq('(pointer: coarse)')}`,
      `Kualitas     : ${app && app.controls && app.controls.state ? app.controls.state.quality : '?'}`,
      `Stage        : ${stage ? `${stage.clientWidth} x ${stage.clientHeight}` : '?'}`,
      `Canvas buffer: ${canvas ? `${canvas.width} x ${canvas.height}` : '?'}`,
      `FPS sekarang : ${now.toFixed(1)}`,
      `FPS rata2 5s : ${avg.toFixed(1)}`,
      `FPS terendah : ${low.toFixed(1)}`,
      `CSS aktif    : lebar<=1180 ${mq('(max-width: 1180px)')} | lebar<=700 ${mq('(max-width: 700px)')}`,
      `               tinggi<=620+landscape ${mq('(max-height: 620px) and (orientation: landscape)')}`,
      `               tinggi<=720+lebar>=701 ${mq('(max-height: 720px) and (min-width: 701px)')}`,
      `Browser      : ${navigator.userAgent}`,
    ];
    return lines.join('\n');
  }

  function render() {
    lastReport = build();
    text.textContent = lastReport;
  }

  render();
  window.setInterval(render, 500);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', render, { passive: true });
  }
})();
