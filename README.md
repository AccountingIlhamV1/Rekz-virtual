# REKZ VIRTUAL — 0.2.3

Ruang digital interaktif dengan karakter 3D laki-laki bernama **Rekz**, panel
ekspresi, kontrol kamera, pengaturan render, dan chat AI. Frontend dibuat dengan
**HTML5, CSS3, dan JavaScript ES Modules** serta Three.js dari CDN. Chat dikirim ke
Supabase Edge Function `rekz-chat` (Gemini). Tidak ada API key atau data verifikasi
di browser; mode (General/Papa) selalu diputuskan server.

> **Status UI mengikuti server:** label mode berasal dari respons server, dan badge
> AI menunjukkan koneksi nyata (`AI SIAP` → `AI TERHUBUNG` / `AI TERPUTUS`).

---

## Fitur

- Karakter **3D penuh** yang dibangun secara prosedural dengan Three.js: tubuh,
  seragam putih-navy, rambut hitam berantakan, mata safir, dan rig wajah.
- Idle animation, auto-blink, respons gerakan kepala terhadap pointer, dan lima
  ekspresi (neutral, happy, sad, angry, surprised).
- Orbit kamera dengan drag, zoom dengan scroll/pinch, tombol orbit dan zoom,
  auto-rotate, serta reset framing.
- Dukungan model **GLB eksternal** dengan progres pemuatan, normalisasi tinggi,
  animasi idle, deteksi morph target, fallback, dan penanganan error. Ekspresi
  hanya diaktifkan jika model benar-benar mendukungnya.
- Chat AI berbahasa Indonesia dengan kepribadian Rekz, timestamp,
  typing indicator, saran pertanyaan, batas input, dan riwayat dalam sesi.
- Label mode dan status AI yang mengikuti respons server di header dan kepala chat.
- Suara UI sintetis berbasis WebAudio, tidak pernah autoplay, dan bisa dimatikan.
- Tiga preset kualitas render (Low/Medium/High), penghitung FPS, mode layar penuh,
  panel pengaturan, reset aplikasi, dan penyimpanan preferensi di `localStorage`.
- Reponsive untuk ponsel Android (termasuk Samsung A05), tablet, dan desktop.
  Di layar sempit, panel avatar berubah menjadi bottom sheet dan kualitas awal
  otomatis memilih Low.

## Struktur proyek

```text
rekz-virtual/
├─ index.html
├─ README.md
├─ .nojekyll
├─ css/
│  └─ style.css
├─ js/
│  ├─ main.js          # bootstrap + wiring
│  ├─ config.js        # konfigurasi pusat
│  ├─ avatar.js        # scene, karakter prosedural, GLB, animasi
│  ├─ chat.js          # klien chat AI (Edge Function rekz-chat)
│  └─ controls.js      # tombol, pengaturan, audio, persistensi
└─ assets/
   ├─ favicon.svg
   ├─ models/          # opsional: taruh rekz.glb di sini
   ├─ textures/        # opsional: tekstur eksternal
   └─ audio/           # opsional: file audio kustom
```

## Menjalankan secara lokal

ES Modules dan import map tidak dapat dijalankan dengan membuka `index.html`
langsung dari `file://` di sebagian besar browser. Gunakan static server apa pun
dari dalam folder `rekz-virtual`, misalnya:

```bash
python -m http.server 8000
```

Lalu buka `http://localhost:8000`.

Alternatif:

- VS Code + ekstensi **Live Server**.
- `npx serve .` bila Node.js tersedia.
- PowerShell static server milik Anda sendiri.
- Atau langsung unggah ke GitHub Pages.

Koneksi internet diperlukan saat pertama kali memuat untuk mengambil Three.js
dan Google Fonts dari CDN.

## Deploy ke GitHub Pages

1. Buat repositori GitHub baru.
2. Unggah **isi folder `rekz-virtual`** ke root repositori (bukan folder
   pembungkusnya). Pastikan `index.html`, `js/`, `css/`, dan `assets/` berada di
   root.
3. Buka **Settings → Pages**.
4. Pilih **Deploy from a branch**, branch `main`, folder `/ (root)`.
5. Simpan dan tunggu beberapa saat. `.nojekyll` sudah disertakan agar aset tidak
   diproses Jekyll.

Semua path dibuat relatif, sehingga tetap bekerja pada URL subpath seperti
`https://username.github.io/nama-repo/`. Jika Anda menempatkan proyek di dalam
subfolder repositori, unggah juga subfolder tersebut dan sesuaikan URL-nya.

### Parameter URL opsional

| Parameter | Contoh | Fungsi |
| --- | --- | --- |
| `quality` | `?quality=low` | Memaksa kualitas awal: `low`, `medium`, `high`. |
| `model` | `?model=assets/models/rekz.glb` | Memuat model GLB kustom. |

Parameter `quality` di URL diprioritaskan di atas preferensi tersimpan. Pengaturan
lain disimpan di `localStorage` dengan key `rekz-virtual:v1`.

## Mengganti karakter dengan GLB

Secara bawaan `CONFIG.avatar.modelUrl` kosong, sehingga karakter prosedural
digunakan. Untuk memakai model sendiri:

1. Letakkan file di `assets/models/rekz.glb`.
2. Ubah `js/config.js`:

   ```js
   avatar: {
     modelUrl: './assets/models/rekz.glb',
     // ...
   }
   ```

   Atau gunakan `?model=assets/models/rekz.glb`.

Model dinormalisasi ke tinggi `1.85` unit dan diletakkan di atas lantai. Klip idle
dipilih dari nama yang mengandung `idle`, `breath`, `stand`, atau `loop`. Jika tidak
ada klip, karakter tetap mendapat sway halus.

Pemetaan morph target yang dikenali:

| Ekspresi | Contoh nama morph |
| --- | --- |
| Happy | `happy`, `smile`, `joy`, `grin`, `mouthSmile` |
| Sad | `sad`, `frown`, `cry`, `browInnerUp`, `mouthFrown` |
| Angry | `angry`, `mad`, `rage`, `browDown` |
| Surprised | `surprised`, `shock`, `eyeWide`, `jawOpen` |
| Blink | `blink`, `eyeBlink`, `eyesClosed` |

Bila GLB tidak memiliki morph target emosi, semua tombol ekspresi dinonaktifkan
dan diberi status **0 / 5** atau sesuai jumlah yang tersedia. Ini disengaja: tidak
ada ekspresi palsu yang dipaksakan pada model yang tidak mendukungnya. Detail
persyaratan ada di `assets/models/README.md`.

## Kontrol

| Area | Kontrol |
| --- | --- |
| Panggung | Drag untuk orbit, scroll/pinch untuk zoom, tombol quick untuk auto-rotate, zoom, dan reset. |
| Panel avatar | Lima tombol ekspresi, status idle/blink/sumber model. |
| Panel kamera | Orbit kiri/kanan, zoom in/out, reset kamera. |
| Header | Panel avatar (mobile), suara, pengaturan, layar penuh. |
| Pengaturan | Kualitas render, auto-rotate, FPS, suara, layar penuh, hapus chat, reset kamera, reset aplikasi. |
| Chat | Enter untuk kirim, Shift+Enter untuk baris baru; chip saran; hapus riwayat. |

## Konfigurasi

Semua pengaturan utama ada di `js/config.js`:

- `avatar.modelUrl`, `targetHeight`, `autoRotate`, `autoRotateSpeed`, jarak kamera,
  dan FOV.
- `chat.typingDelayMin/Max`, batas input, dan batas pesan.
- `ui.toastDuration`, interval kedip.
- `QUALITY_PRESETS` untuk DPR, bayangan, partikel, dan environment intensity.
- `EXPRESSIONS` untuk label ekspresi.

Tombol **Reset aplikasi** menghapus preferensi lokal dan memuat ulang halaman.
Chat hanya tersimpan di memori sesi; memuat ulang halaman akan memulai percakapan
baru.

## Catatan & batasan yang disengaja

- **Chat memakai AI lewat server Rekz.** Browser hanya mengirim pesan; kunci dan
  verifikasi ada di server. Balasan AI bisa keliru.
- **Preferensi tampilan** disimpan di browser (`localStorage`).
- **Tidak ada autoplay audio.** Bunyi baru aktif setelah interaksi pengguna.
- **Riwayat chat tidak persisten.** Halaman dimuat ulang = sesi baru.
- **Foto/avatar bukan gambar 2D.** Karakter bawaan adalah mesh Three.js nyata.
- **Fullscreen** mengandalkan Fullscreen API; browser yang tidak mendukung akan
  menampilkan pesan yang jujur, bukan tombol palsu.
- **Model eksternal** harus dapat diakses dengan CORS yang benar. Path relatif
  lebih aman untuk GitHub Pages.
- **Kualitas Low** mematikan bayangan dan menurunkan DPR/partikel; karakter tetap
  dirender penuh.

## QA checklist

- [ ] Halaman dimuat tanpa error konsol di Chrome desktop dan Android.
- [ ] Canvas 3D tetap di dalam panggung pada 360×800, tablet, dan desktop.
- [ ] Drag, scroll/pinch, zoom, orbit, dan reset kamera bekerja.
- [ ] Auto-rotate bisa dinyalakan/dimatikan dari tiga lokasi kontrol.
- [ ] Lima ekspresi mengubah wajah karakter prosedural.
- [ ] Chat mengirim pesan, menampilkan typing indicator, timestamp, dan balasan.
- [ ] Header dan kepala chat menampilkan mode yang sama (General/Papa); badge AI berubah ke `AI TERHUBUNG` setelah balasan pertama dan `AI TERPUTUS` saat server gagal.
- [ ] Suara tidak aktif sebelum gesture pertama; toggle suara menyimpan preferensi.
- [ ] Kualitas Low/Medium/High mengubah bayangan/DPR tanpa mematahkan layout.
- [ ] FPS tampil/hilang sesuai switch.
- [ ] Fullscreen masuk/keluar dan ikon tersinkron.
- [ ] Panel avatar mobile membuka bottom sheet, menutup lewat backdrop/Escape.
- [ ] Dialog pengaturan dapat dibuka/ditutup dan semua aksinya bekerja.
- [ ] `?model=assets/models/missing.glb` menampilkan error + fallback prosedural.
- [ ] Reset aplikasi menghapus preferensi lalu memuat ulang.

## Teknologi & kredit

- [Three.js](https://threejs.org/) r0.169.0 (MIT), dimuat via jsDelivr dengan
  import map: `GLTFLoader`, `OrbitControls`, `RoomEnvironment`.
- Font **Manrope** dan **Space Grotesk** dari Google Fonts.
- Karakter, tekstur prosedural, ikon SVG, dan antarmuka dibuat khusus untuk
  prototype ini. Tidak ada aset model atau audio pihak ketiga yang disertakan.

**REKZ VIRTUAL 0.2.3**
