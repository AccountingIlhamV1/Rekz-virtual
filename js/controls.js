/**
 * REKZ VIRTUAL — interface controls, persistence and UI audio
 * -------------------------------------------------
 * Every interactive control in the prototype is wired here.
 * Audio is synthesised with WebAudio only after a user gesture;
 * nothing plays on page load.
 */

import { CONFIG, QUALITY_PRESETS, EXPRESSIONS, readStoredQuality } from './config.js';

const $ = (id) => document.getElementById(id);

const STORAGE_KEY = CONFIG.app.storageKey;

function readState() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch {
    stored = {};
  }

  return {
    sound: stored.sound !== false,
    quality: readStoredQuality(),
    autoRotate:
      typeof stored.autoRotate === 'boolean' ? stored.autoRotate : Boolean(CONFIG.avatar.autoRotate),
    showFps: stored.showFps !== false,
  };
}

class SoundEngine {
  constructor(enabled) {
    this.enabled = enabled;
    this.context = null;
    this.master = null;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.enabled) this._ensureContext();
  }

  _ensureContext() {
    if (!this.enabled) return null;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!this.context) {
      try {
        this.context = new AudioContextClass();
        this.master = this.context.createGain();
        this.master.gain.value = 0.12;
        this.master.connect(this.context.destination);
      } catch {
        this.context = null;
        return null;
      }
    }

    if (this.context.state === 'suspended') {
      this.context.resume().catch(() => {});
    }
    return this.context;
  }

  play(kind = 'tap') {
    const context = this._ensureContext();
    if (!context || !this.master) return;

    const patterns = {
      tap: [
        [760, 0, 0.045, 'sine', 0.32],
        [1120, 0.028, 0.055, 'sine', 0.17],
      ],
      send: [
        [500, 0, 0.07, 'triangle', 0.28],
        [760, 0.055, 0.09, 'sine', 0.22],
      ],
      receive: [
        [660, 0, 0.08, 'sine', 0.2],
        [940, 0.07, 0.11, 'sine', 0.14],
      ],
      success: [
        [620, 0, 0.07, 'sine', 0.2],
        [930, 0.07, 0.09, 'sine', 0.18],
        [1240, 0.15, 0.12, 'sine', 0.12],
      ],
      error: [
        [250, 0, 0.11, 'sawtooth', 0.12],
        [170, 0.1, 0.15, 'triangle', 0.1],
      ],
    };

    const notes = patterns[kind] || patterns.tap;
    const start = context.currentTime + 0.005;

    notes.forEach(([frequency, offset, duration, type, level]) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start + offset);
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(level, start + offset + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + duration);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + duration + 0.02);
    });
  }
}

export class Controls {
  constructor() {
    this.state = readState();
    this.sound = new SoundEngine(this.state.sound);
    this.avatar = null;
    this.chat = null;
    this.avatarInfo = null;
    this.currentExpression = 'neutral';
    this.fps = 0;
    this._fatalError = false;
    this._drawerOpen = false;
    this._resetArmed = false;
    this._resetTimer = null;
    this._loaderTimer = null;

    this._cacheDom();
    this._bind();

    this._syncSound();
    this._syncAutoRotate();
    this._syncFps();
    this.reflectQuality(this.state.quality, QUALITY_PRESETS[this.state.quality]);
    this.setAvatarPending();

    this._drawerMedia = window.matchMedia('(max-width: 1180px)');
    this._onDrawerMediaChange = (event) => {
      if (!event.matches) this._closeDrawer({ restoreFocus: false });
    };
    if (this._drawerMedia.addEventListener) {
      this._drawerMedia.addEventListener('change', this._onDrawerMediaChange);
    } else {
      this._drawerMedia.addListener(this._onDrawerMediaChange);
    }

    this._onFullscreenChange = () => this._syncFullscreen();
    document.addEventListener('fullscreenchange', this._onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', this._onFullscreenChange);

    this._onKeydown = (event) => {
      if (event.key === 'Escape' && this._drawerOpen) {
        this._closeDrawer();
      }
    };
    document.addEventListener('keydown', this._onKeydown);

    this._onGlobalPointerDown = (event) => {
      if (!this.state.sound) return;
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest('button');
      if (!button || button.disabled) return;
      if (button.id === 'sendBtn') return;
      this.sound.play('tap');
    };
    document.addEventListener('pointerdown', this._onGlobalPointerDown, { passive: true });
  }

  _cacheDom() {
    this.dom = {
      app: $('app'),
      stage: $('stage'),
      avatarLoading: $('avatarLoading'),
      loaderTitle: $('loaderTitle'),
      loaderSub: $('loaderSub'),
      loaderBarFill: $('loaderBarFill'),
      loaderPct: $('loaderPct'),
      avatarError: $('avatarError'),
      avatarErrorTitle: $('avatarErrorTitle'),
      avatarErrorMessage: $('avatarErrorMessage'),
      retryAvatarBtn: $('retryAvatarBtn'),
      dismissAvatarError: $('dismissAvatarError'),
      soundBtn: $('soundBtn'),
      settingsBtn: $('settingsBtn'),
      fullscreenBtn: $('fullscreenBtn'),
      settingsDialog: $('settingsDialog'),
      closeSettingsBtn: $('closeSettingsBtn'),
      doneSettingsBtn: $('doneSettingsBtn'),
      openSettingsBtn: $('openSettingsBtn'),
      settingsSoundSwitch: $('settingsSoundSwitch'),
      settingsAutoRotate: $('settingsAutoRotate'),
      settingsFpsSwitch: $('settingsFpsSwitch'),
      settingsFullscreenBtn: $('settingsFullscreenBtn'),
      settingsFullscreenLabel: $('settingsFullscreenLabel'),
      settingsClearChatBtn: $('settingsClearChatBtn'),
      settingsResetCameraBtn: $('settingsResetCameraBtn'),
      resetAppBtn: $('resetAppBtn'),
      resetAppLabel: $('resetAppLabel'),
      resetAppHint: $('resetAppHint'),
      clearChatBtn: $('clearChatBtn'),
      autoRotateSwitch: $('autoRotateSwitch'),
      fpsSwitch: $('fpsSwitch'),
      qualityQuick: $('qualityQuick'),
      qualitySettings: $('qualitySettings'),
      qualityBadge: $('qualityBadge'),
      renderPresetLabel: $('renderPresetLabel'),
      renderHint: $('renderHint'),
      settingsRenderValue: $('settingsRenderValue'),
      settingsQualityHint: $('settingsQualityHint'),
      fpsReadout: $('fpsReadout'),
      fpsRail: $('fpsRail'),
      quickRotateBtn: $('quickRotateBtn'),
      rotateBadge: $('rotateBadge'),
      avatarDrawerBtn: $('avatarDrawerBtn'),
      avatarRail: $('avatarRail'),
      sheetBackdrop: $('sheetBackdrop'),
      expressionStatus: $('expressionStatus'),
      expressionHint: $('expressionHint'),
      expressionGrid: $('expressionGrid'),
      settingsModelInfo: $('settingsModelInfo'),
      settingsExpressionInfo: $('settingsExpressionInfo'),
      idleFeature: $('idleFeature'),
      blinkFeature: $('blinkFeature'),
      modelFeature: $('modelFeature'),
      statusDot: $('statusDot'),
      statusLabel: $('statusLabel'),
      toastStack: $('toastStack'),
      chatInput: $('chatInput'),
    };

    this.expressionButtons = Array.from(document.querySelectorAll('[data-expression]'));
    this.qualityButtons = Array.from(document.querySelectorAll('[data-quality]'));
    this.cameraButtons = Array.from(document.querySelectorAll('[data-camera]'));
    this.quickButtons = Array.from(document.querySelectorAll('.stage__quick [data-action]'));
    this.soundOnIcons = Array.from(document.querySelectorAll('[data-sound-on]'));
    this.soundOffIcons = Array.from(document.querySelectorAll('[data-sound-off]'));
    this.fullscreenOnIcons = Array.from(document.querySelectorAll('[data-fullscreen-on]'));
    this.fullscreenOffIcons = Array.from(document.querySelectorAll('[data-fullscreen-off]'));
  }

  _bind() {
    this.dom.soundBtn?.addEventListener('click', () => this.setSound(!this.state.sound));
    this.dom.settingsSoundSwitch?.addEventListener('click', () => this.setSound(!this.state.sound));

    this.dom.quickRotateBtn?.addEventListener('click', () => this.toggleAutoRotate());
    this.dom.autoRotateSwitch?.addEventListener('click', () => this.toggleAutoRotate());
    this.dom.settingsAutoRotate?.addEventListener('click', () => this.toggleAutoRotate());

    this.dom.fpsSwitch?.addEventListener('click', () => this.setFpsVisible(!this.state.showFps));
    this.dom.settingsFpsSwitch?.addEventListener('click', () => this.setFpsVisible(!this.state.showFps));

    this.dom.fullscreenBtn?.addEventListener('click', () => this.toggleFullscreen());
    this.dom.settingsFullscreenBtn?.addEventListener('click', () => {
      this.closeSettings();
      this.toggleFullscreen();
    });

    this.qualityButtons.forEach((button) => {
      button.addEventListener('click', () => {
        this.setQuality(button.dataset.quality);
      });
    });

    this.expressionButtons.forEach((button) => {
      button.addEventListener('click', () => {
        this.setExpression(button.dataset.expression);
      });
    });

    this.cameraButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.camera;
        if (!this.avatar || !this.avatar.ready) {
          this.toast('Avatar belum siap untuk kontrol kamera.');
          return;
        }
        this.avatar.stepCamera(action);
        if (action === 'reset') this.toast('Kamera dikembalikan ke framing awal.');
      });
    });

    this.quickButtons.forEach((button) => {
      if (button.id === 'quickRotateBtn') return;
      button.addEventListener('click', () => {
        const action = button.dataset.action;
        if (action === 'reset-camera') {
          this.resetCamera();
          return;
        }
        if (!this.avatar || !this.avatar.ready) {
          this.toast('Avatar belum siap untuk kontrol kamera.');
          return;
        }
        this.avatar.stepCamera(action);
      });
    });

    this.dom.settingsBtn?.addEventListener('click', () => this.openSettings());
    this.dom.openSettingsBtn?.addEventListener('click', () => this.openSettings());
    this.dom.closeSettingsBtn?.addEventListener('click', () => this.closeSettings());
    this.dom.doneSettingsBtn?.addEventListener('click', () => this.closeSettings());
    this.dom.settingsDialog?.addEventListener('click', (event) => {
      const dialog = this.dom.settingsDialog;
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const outside =
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom;
      if (outside) this.closeSettings();
    });
    this.dom.settingsDialog?.addEventListener('cancel', () => this._resetResetButton());

    this.dom.clearChatBtn?.addEventListener('click', () => this.clearChat());
    this.dom.settingsClearChatBtn?.addEventListener('click', () => {
      this.closeSettings();
      this.clearChat();
    });

    this.dom.settingsResetCameraBtn?.addEventListener('click', () => {
      this.closeSettings();
      this.resetCamera();
    });

    this.dom.resetAppBtn?.addEventListener('click', () => this._handleResetApp());

    this.dom.avatarDrawerBtn?.addEventListener('click', () => {
      if (this._drawerOpen) this._closeDrawer();
      else this._openDrawer();
    });
    this.dom.avatarRail
      ?.querySelector('[data-close-avatar]')
      ?.addEventListener('click', () => this._closeDrawer());
    this.dom.sheetBackdrop?.addEventListener('click', () => this._closeDrawer());

    this.dom.retryAvatarBtn?.addEventListener('click', () => this._retryAvatar());
    this.dom.dismissAvatarError?.addEventListener('click', () => this.hideAvatarError());
  }

  attachAvatar(avatar) {
    this.avatar = avatar;
    if (avatar) {
      avatar.setAutoRotate(this.state.autoRotate);
      this.reflectQuality(this.state.quality, QUALITY_PRESETS[this.state.quality]);
    }
  }

  attachChat(chat) {
    this.chat = chat;
  }

  playSound(name) {
    if (!this.state.sound) return;
    this.sound.play(name);
  }

  setStatus(label, { warning = false } = {}) {
    if (this.dom.statusLabel) this.dom.statusLabel.textContent = label;
    this.dom.statusDot?.classList.toggle('is-warning', warning);
  }

  setAvatarPending() {
    this.expressionButtons.forEach((button) => {
      button.disabled = true;
      button.classList.add('is-unavailable');
      button.classList.remove('is-active');
      button.setAttribute('aria-pressed', 'false');
      button.title = 'Menunggu model selesai dimuat';
    });
    if (this.dom.expressionStatus) this.dom.expressionStatus.textContent = 'MEMUAT';
    if (this.dom.expressionHint) {
      this.dom.expressionHint.textContent = 'Menunggu model 3D selesai dimuat.';
    }
    this._setFeature(this.dom.idleFeature, 'Memuat', null);
    this._setFeature(this.dom.blinkFeature, 'Memuat', null);
    this._setFeature(this.dom.modelFeature, 'MEMUAT', null);
    if (this.dom.settingsModelInfo) this.dom.settingsModelInfo.textContent = 'Memuat…';
    if (this.dom.settingsExpressionInfo) this.dom.settingsExpressionInfo.textContent = 'Memuat…';
  }

  applyAvatarInfo(info) {
    if (!info) return;
    this.avatarInfo = info;
    const features = info.features || {};
    const support = features.expressions || {};
    const expressionCount = Object.values(support).filter(Boolean).length;

    this.expressionButtons.forEach((button) => {
      const id = button.dataset.expression;
      const supported = Boolean(support[id]);
      button.disabled = !supported;
      button.classList.toggle('is-unavailable', !supported);
      button.setAttribute('aria-disabled', String(!supported));
      button.title = supported ? '' : 'Tidak tersedia pada model 3D ini';
    });

    if (!support[this.currentExpression]) {
      this.currentExpression = EXPRESSIONS.map((item) => item.id).find((id) => support[id]) || null;
    }
    this._paintExpressions();

    if (this.dom.expressionStatus) {
      this.dom.expressionStatus.textContent = `${expressionCount} / 5`;
    }
    if (this.dom.expressionHint) {
      this.dom.expressionHint.textContent =
        features.expressionNote || 'Ekspresi mengikuti kemampuan model yang sedang aktif.';
    }
    if (this.dom.settingsExpressionInfo) {
      this.dom.settingsExpressionInfo.textContent = `${expressionCount} / 5`;
    }

    this._setFeature(this.dom.idleFeature, features.idleLabel || 'Aktif', Boolean(features.idle));
    this._setFeature(this.dom.blinkFeature, features.blinkLabel || 'Aktif', Boolean(features.blink));

    const sourceShort = info.mode === 'procedural' ? 'Prosedural' : 'GLB eksternal';
    this._setFeature(this.dom.modelFeature, sourceShort, null);
    if (this.dom.modelFeature) this.dom.modelFeature.title = info.sourceLabel || '';
    if (this.dom.settingsModelInfo) {
      this.dom.settingsModelInfo.textContent = info.sourceLabel || 'Prosedural Three.js';
      this.dom.settingsModelInfo.title = info.modelUrl || info.sourceLabel || '';
    }
  }

  _paintExpressions() {
    this.expressionButtons.forEach((button) => {
      const active = button.dataset.expression === this.currentExpression;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  _setFeature(element, label, active) {
    if (!element) return;
    element.textContent = label;
    element.classList.remove('is-on', 'is-off');
    if (active === true) element.classList.add('is-on');
    if (active === false) element.classList.add('is-off');
  }

  setExpression(id, { quiet = false } = {}) {
    if (!id) return false;
    if (!this.avatar || !this.avatar.ready) {
      if (!quiet) this.toast('Avatar belum siap. Tunggu hingga pemuatan selesai.');
      return false;
    }
    if (!this.avatarInfo?.features?.expressions?.[id]) {
      if (!quiet) {
        const label = EXPRESSIONS.find((item) => item.id === id)?.label || id;
        this.toast(`Ekspresi ${label} tidak tersedia pada model ini.`, 'error');
      }
      return false;
    }

    const applied = this.avatar.setExpression(id);
    if (!applied) {
      if (!quiet) this.toast('Ekspresi gagal diterapkan.', 'error');
      return false;
    }

    this.currentExpression = id;
    this._paintExpressions();
    return true;
  }

  toggleAutoRotate() {
    this.setAutoRotate(!this.state.autoRotate);
  }

  setAutoRotate(enabled, { announce = true, save = true } = {}) {
    this.state.autoRotate = Boolean(enabled);
    this.avatar?.setAutoRotate(this.state.autoRotate);
    this._syncAutoRotate();
    if (save) this._persist();
    if (announce) {
      this.toast(this.state.autoRotate ? 'Auto rotate aktif.' : 'Auto rotate dimatikan.');
    }
    return this.state.autoRotate;
  }

  _syncAutoRotate() {
    const checked = this.state.autoRotate;
    [this.dom.autoRotateSwitch, this.dom.settingsAutoRotate].forEach((control) => {
      control?.setAttribute('aria-checked', String(checked));
    });
    if (this.dom.quickRotateBtn) {
      this.dom.quickRotateBtn.classList.toggle('is-active', checked);
      this.dom.quickRotateBtn.setAttribute('aria-pressed', String(checked));
      this.dom.quickRotateBtn.setAttribute(
        'aria-label',
        checked ? 'Nonaktifkan auto rotate' : 'Aktifkan auto rotate',
      );
    }
    this.dom.rotateBadge?.classList.toggle('is-off', !checked);
    if (this.dom.rotateBadge) {
      this.dom.rotateBadge.title = checked
        ? 'Kamera berputar otomatis'
        : 'Auto rotate nonaktif';
    }
  }

  setFpsVisible(enabled, { announce = true, save = true } = {}) {
    this.state.showFps = Boolean(enabled);
    this._syncFps();
    if (save) this._persist();
    if (announce) {
      this.toast(this.state.showFps ? 'Penghitung FPS ditampilkan.' : 'Penghitung FPS disembunyikan.');
    }
    return this.state.showFps;
  }

  _syncFps() {
    const show = this.state.showFps;
    [this.dom.fpsSwitch, this.dom.settingsFpsSwitch].forEach((control) => {
      control?.setAttribute('aria-checked', String(show));
    });
    if (this.dom.fpsReadout) this.dom.fpsReadout.hidden = !show;
    if (this.dom.fpsRail) {
      if (!show) this.dom.fpsRail.textContent = 'OFF';
      else this.dom.fpsRail.textContent = this.fps ? `${this.fps} FPS` : '-- FPS';
    }
    if (show && this.dom.fpsReadout) {
      const strong = this.dom.fpsReadout.querySelector('strong');
      if (strong) strong.textContent = this.fps ? String(this.fps) : '--';
    }
  }

  updateFps(fps) {
    this.fps = Math.max(0, Math.round(Number(fps) || 0));
    if (!this.state.showFps) return;
    if (this.dom.fpsReadout) {
      const strong = this.dom.fpsReadout.querySelector('strong');
      if (strong) strong.textContent = String(this.fps);
    }
    if (this.dom.fpsRail) this.dom.fpsRail.textContent = `${this.fps} FPS`;
  }

  reflectQuality(quality, preset) {
    const resolved = preset || QUALITY_PRESETS[quality];
    if (!resolved) return;
    this.state.quality = quality;
    this.qualityButtons.forEach((button) => {
      const active = button.dataset.quality === quality;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    const shortLabels = { low: 'LOW', medium: 'MED', high: 'HIGH' };
    if (this.dom.qualityBadge) {
      this.dom.qualityBadge.textContent = shortLabels[quality] || resolved.label.toUpperCase();
    }
    if (this.dom.renderPresetLabel) this.dom.renderPresetLabel.textContent = resolved.label.toUpperCase();
    if (this.dom.renderHint) this.dom.renderHint.textContent = resolved.description;
    if (this.dom.settingsRenderValue) {
      this.dom.settingsRenderValue.textContent = resolved.label.toUpperCase();
    }
    if (this.dom.settingsQualityHint) this.dom.settingsQualityHint.textContent = resolved.description;
  }

  setQuality(quality, { announce = true } = {}) {
    const preset = QUALITY_PRESETS[quality];
    if (!preset) return;
    const changed = this.state.quality !== quality;
    this.state.quality = quality;
    this.reflectQuality(quality, preset);
    this.avatar?.setQuality(quality);
    this._persist();
    if (announce) {
      this.toast(changed ? `Kualitas render: ${preset.label}.` : `Kualitas render sudah ${preset.label}.`);
    }
  }

  setSound(enabled, { announce = true, save = true } = {}) {
    this.state.sound = Boolean(enabled);
    this.sound.setEnabled(this.state.sound);
    this._syncSound();
    if (save) this._persist();
    if (this.state.sound) this.sound.play('success');
    if (announce) {
      this.toast(this.state.sound ? 'Efek suara antarmuka aktif.' : 'Efek suara antarmuka dimatikan.');
    }
    return this.state.sound;
  }

  _syncSound() {
    const enabled = this.state.sound;
    if (this.dom.soundBtn) {
      this.dom.soundBtn.setAttribute('aria-pressed', String(enabled));
      this.dom.soundBtn.setAttribute('aria-label', enabled ? 'Matikan efek suara' : 'Nyalakan efek suara');
    }
    this.soundOnIcons.forEach((icon) => {
      icon.hidden = !enabled;
    });
    this.soundOffIcons.forEach((icon) => {
      icon.hidden = enabled;
    });
    this.dom.settingsSoundSwitch?.setAttribute('aria-checked', String(enabled));
  }

  async toggleFullscreen() {
    const active = Boolean(document.fullscreenElement);
    try {
      if (active) {
        await document.exitFullscreen();
      } else if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else {
        throw new Error('Fullscreen API unavailable');
      }
    } catch {
      this.toast('Layar penuh tidak didukung pada browser atau perangkat ini.', 'error');
    }
    this._syncFullscreen();
  }

  _syncFullscreen() {
    const active = Boolean(document.fullscreenElement);
    if (this.dom.fullscreenBtn) {
      this.dom.fullscreenBtn.setAttribute('aria-pressed', String(active));
      this.dom.fullscreenBtn.setAttribute(
        'aria-label',
        active ? 'Keluar dari mode layar penuh' : 'Masuk mode layar penuh',
      );
    }
    this.fullscreenOnIcons.forEach((icon) => {
      icon.hidden = active;
    });
    this.fullscreenOffIcons.forEach((icon) => {
      icon.hidden = !active;
    });
    if (this.dom.settingsFullscreenLabel) {
      this.dom.settingsFullscreenLabel.textContent = active
        ? 'Keluar layar penuh'
        : 'Masuk layar penuh';
    }
  }

  openSettings() {
    this._closeDrawer({ restoreFocus: false });
    const dialog = this.dom.settingsDialog;
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    } else {
      dialog.setAttribute('open', '');
    }
  }

  closeSettings() {
    const dialog = this.dom.settingsDialog;
    if (!dialog || !dialog.open) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    this._resetResetButton();
  }

  _openDrawer() {
    if (!this._drawerMedia.matches) return;
    this._drawerOpen = true;
    this.dom.avatarRail?.classList.add('is-open');
    if (this.dom.sheetBackdrop) this.dom.sheetBackdrop.hidden = false;
    this.dom.avatarDrawerBtn?.setAttribute('aria-expanded', 'true');
    this.dom.avatarDrawerBtn?.setAttribute('aria-label', 'Tutup kontrol avatar');
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => {
      this.dom.avatarRail
        ?.querySelector('[data-close-avatar]')
        ?.focus({ preventScroll: true });
    });
  }

  _closeDrawer({ restoreFocus = true } = {}) {
    if (!this._drawerOpen) {
      if (this.dom.sheetBackdrop) this.dom.sheetBackdrop.hidden = true;
      return;
    }
    this._drawerOpen = false;
    this.dom.avatarRail?.classList.remove('is-open');
    if (this.dom.sheetBackdrop) this.dom.sheetBackdrop.hidden = true;
    this.dom.avatarDrawerBtn?.setAttribute('aria-expanded', 'false');
    this.dom.avatarDrawerBtn?.setAttribute('aria-label', 'Buka kontrol avatar');
    document.body.style.overflow = '';
    if (restoreFocus) {
      this.dom.avatarDrawerBtn?.focus({ preventScroll: true });
    }
  }

  resetCamera() {
    if (!this.avatar || !this.avatar.ready) {
      this.toast('Avatar belum siap untuk reset kamera.');
      return;
    }
    this.avatar.resetCamera();
    this.toast('Kamera dikembalikan ke framing awal.');
  }

  clearChat() {
    if (!this.chat) return;
    this.chat.clear();
    this.toast('Tampilan dibersihkan. Riwayat tetap tersimpan.');
  }

  updateLoader({ percent = 0, title, subtitle } = {}) {
    const loading = this.dom.avatarLoading;
    if (!loading) return;
    window.clearTimeout(this._loaderTimer);
    loading.hidden = false;
    loading.classList.remove('is-hidden');
    this.dom.stage?.setAttribute('aria-busy', 'true');

    const value = Math.max(0, Math.min(100, Math.round(percent)));
    if (title && this.dom.loaderTitle) this.dom.loaderTitle.textContent = title;
    if (subtitle && this.dom.loaderSub) this.dom.loaderSub.textContent = subtitle;
    if (this.dom.loaderBarFill) this.dom.loaderBarFill.style.width = `${value}%`;
    if (this.dom.loaderPct) this.dom.loaderPct.textContent = `${value}%`;
  }

  finishLoader({ title = 'Rekz siap', subtitle = 'SELAMAT DATANG DI CHAMBER' } = {}) {
    const loading = this.dom.avatarLoading;
    if (!loading) return;
    if (this.dom.loaderTitle) this.dom.loaderTitle.textContent = title;
    if (this.dom.loaderSub) this.dom.loaderSub.textContent = subtitle;
    if (this.dom.loaderBarFill) this.dom.loaderBarFill.style.width = '100%';
    if (this.dom.loaderPct) this.dom.loaderPct.textContent = '100%';
    this.dom.stage?.setAttribute('aria-busy', 'false');
    loading.classList.add('is-hidden');
    window.clearTimeout(this._loaderTimer);
    this._loaderTimer = window.setTimeout(() => {
      loading.hidden = true;
    }, 680);
  }

  hideLoaderImmediately() {
    window.clearTimeout(this._loaderTimer);
    if (this.dom.avatarLoading) {
      this.dom.avatarLoading.classList.add('is-hidden');
      this.dom.avatarLoading.hidden = true;
    }
    this.dom.stage?.setAttribute('aria-busy', 'false');
  }

  showAvatarError(error, { fatal = false, toast = true } = {}) {
    this._fatalError = Boolean(fatal);
    if (this.dom.avatarError) this.dom.avatarError.hidden = false;
    if (this.dom.avatarErrorTitle) {
      this.dom.avatarErrorTitle.textContent = error?.title || 'Model 3D gagal dimuat';
    }
    if (this.dom.avatarErrorMessage) {
      this.dom.avatarErrorMessage.textContent =
        error?.message || 'Placeholder prosedural tetap ditampilkan.';
    }
    if (this.dom.retryAvatarBtn) {
      this.dom.retryAvatarBtn.textContent = fatal ? 'Muat ulang' : 'Coba lagi';
    }
    if (toast) this.toast(error?.title || 'Terjadi kesalahan pada panggung 3D.', 'error');
  }

  hideAvatarError() {
    if (this.dom.avatarError) this.dom.avatarError.hidden = true;
    this._fatalError = false;
  }

  async _retryAvatar() {
    if (this._fatalError) {
      window.location.reload();
      return;
    }
    if (!this.avatar) return;
    if (!this.avatar.modelUrl) {
      this.hideAvatarError();
      this.toast('Tidak ada model eksternal. Mode prosedural tetap aktif.');
      return;
    }
    this.hideAvatarError();
    this.updateLoader({
      percent: 88,
      title: 'Memuat ulang model',
      subtitle: 'MENGULANG PERMINTAAN GLB',
    });
    try {
      const info = await this.avatar.retryModel();
      if (info) this.applyAvatarInfo(info);
    } catch {
      this.showAvatarError({
        title: 'Model eksternal gagal dimuat',
        message: 'Permintaan ulang tidak berhasil. Placeholder prosedural tetap ditampilkan.',
      });
    }
  }

  async _handleResetApp() {
    if (!this._resetArmed) {
      this._resetArmed = true;
      this.dom.resetAppBtn?.classList.add('is-armed');
      if (this.dom.resetAppLabel) this.dom.resetAppLabel.textContent = 'Klik lagi untuk konfirmasi';
      if (this.dom.resetAppHint) {
        this.dom.resetAppHint.textContent = 'Pengaturan lokal akan dihapus dan halaman dimuat ulang.';
      }
      window.clearTimeout(this._resetTimer);
      this._resetTimer = window.setTimeout(() => this._resetResetButton(), 4200);
      return;
    }

    this._resetResetButton();
    try {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Storage can be unavailable. */
    }
    this.closeSettings();
    this.toast('Pengaturan lokal dihapus. Memuat ulang aplikasi…');
    const url = new URL(window.location.href);
    url.searchParams.delete('quality');
    url.searchParams.delete('model');
    window.setTimeout(() => {
      window.location.replace(url.href);
    }, 620);
  }

  _resetResetButton() {
    window.clearTimeout(this._resetTimer);
    this._resetArmed = false;
    this.dom.resetAppBtn?.classList.remove('is-armed');
    if (this.dom.resetAppLabel) this.dom.resetAppLabel.textContent = 'Reset aplikasi';
    if (this.dom.resetAppHint) {
      this.dom.resetAppHint.textContent = 'Pulihkan seluruh pengaturan dan muat ulang.';
    }
  }

  toast(message, type = 'info', duration = CONFIG.ui.toastDuration) {
    const stack = this.dom.toastStack;
    if (!stack || !message) return;
    while (stack.children.length >= 3) {
      stack.firstElementChild?.remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast${type === 'error' ? ' toast--error' : ''}`;
    toast.textContent = message;
    stack.append(toast);

    window.setTimeout(() => {
      toast.classList.add('is-leaving');
      window.setTimeout(() => toast.remove(), 280);
    }, Math.max(900, duration));
  }

  _persist() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          sound: this.state.sound,
          quality: this.state.quality,
          autoRotate: this.state.autoRotate,
          showFps: this.state.showFps,
        }),
      );
    } catch {
      /* Private mode / blocked storage is non-fatal. */
    }
  }

  destroy() {
    document.removeEventListener('pointerdown', this._onGlobalPointerDown);
    document.removeEventListener('keydown', this._onKeydown);
    document.removeEventListener('fullscreenchange', this._onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', this._onFullscreenChange);
    if (this._drawerMedia?.removeEventListener) {
      this._drawerMedia.removeEventListener('change', this._onDrawerMediaChange);
    } else {
      this._drawerMedia?.removeListener(this._onDrawerMediaChange);
    }
    window.clearTimeout(this._loaderTimer);
    window.clearTimeout(this._resetTimer);
    this._closeDrawer({ restoreFocus: false });
  }
}
