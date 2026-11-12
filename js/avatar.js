/**
 * REKZ VIRTUAL — 3D avatar stage
 * -------------------------------------------------
 * Renders a fully procedural Three.js character (not a 2D stand-in)
 * and can swap it for an external GLB/GLTF model at runtime.
 *
 * External model support:
 *   - GLTFLoader with real progress + error handling
 *   - automatic height / ground normalisation
 *   - idle clips played through AnimationMixer
 *   - expressions and blinking only when the GLB exposes matching
 *     morph targets. No fake facial simulation is applied to GLBs.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CONFIG, QUALITY_PRESETS } from './config.js';

const TAU = Math.PI * 2;

const COLORS = {
  skin: 0xe7bda2,
  skinShade: 0xd7a68b,
  skinLight: 0xf0ccb4,
  hair: 0x0a0c12,
  hairLight: 0x151c29,
  shirt: 0xf1f5fb,
  shirtShade: 0xdde5f0,
  navy: 0x0a1c37,
  navyLight: 0x12305a,
  navyDark: 0x061327,
  trousers: 0x091a31,
  shoe: 0x040810,
  sole: 0x141922,
  metal: 0xd7e3f2,
  sapphire: 0x2f7bff,
  lip: 0x8f5058,
  mouthInner: 0x2a0d13,
  tongue: 0xb75c67,
};

const EXPRESSION_POSES = {
  neutral: { browLift: 0, browTilt: 0.035, eyeOpen: 1, headTilt: -0.012, headPitch: 0.006, mouth: 'neutral' },
  happy: { browLift: 0.007, browTilt: 0.1, eyeOpen: 0.79, headTilt: 0.032, headPitch: -0.015, mouth: 'happy' },
  sad: { browLift: 0.002, browTilt: -0.15, eyeOpen: 0.84, headTilt: -0.045, headPitch: 0.062, mouth: 'sad' },
  angry: { browLift: -0.004, browTilt: 0.26, eyeOpen: 0.63, headTilt: -0.006, headPitch: 0.035, mouth: 'angry' },
  surprised: { browLift: 0.012, browTilt: -0.03, eyeOpen: 1.17, headTilt: 0.002, headPitch: -0.033, mouth: 'surprised' },
};

const MORPH_GROUPS = {
  happy: ['happy', 'smile', 'joy', 'fun', 'grin', 'laugh', 'cheeksquint', 'mouthsmile'],
  sad: ['sad', 'sorrow', 'frown', 'cry', 'mourn', 'browinnerup', 'mouthfrown', 'browsad'],
  angry: ['angry', 'anger', 'mad', 'rage', 'browdown', 'browangry'],
  surprised: ['surprised', 'surprise', 'shock', 'wow', 'eyewide', 'jawopen', 'mouthopen'],
  blink: ['blink', 'eyeblink', 'eyesclosed', 'eyeclose', 'blinkleft', 'blinkright'],
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const damp = (current, target, lambda, dt) => THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function normalizeKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function makeTexture(size, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  paint(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function makeRadialTexture(stops) {
  return makeTexture(512, (ctx, size) => {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  });
}

function makeAlphaFadeTexture() {
  return makeTexture(512, (ctx, size) => {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.04, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.58, '#f2f2f2');
    gradient.addColorStop(0.84, '#555555');
    gradient.addColorStop(1, '#000000');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  });
}

function makeIrisTexture() {
  return makeTexture(256, (ctx, size) => {
    const center = size / 2;
    const gradient = ctx.createRadialGradient(center, center * 0.82, 5, center, center, center);
    gradient.addColorStop(0, '#a7dcff');
    gradient.addColorStop(0.2, '#5fb0ff');
    gradient.addColorStop(0.48, '#1f70eb');
    gradient.addColorStop(0.78, '#0a3a96');
    gradient.addColorStop(0.94, '#052258');
    gradient.addColorStop(1, '#010b22');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(center, center, center - 1, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = '#c5e8ff';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 46; i += 1) {
      const angle = (i / 46) * TAU;
      const start = center * 0.24;
      const end = center * 0.83;
      ctx.beginPath();
      ctx.moveTo(center + Math.cos(angle) * start, center + Math.sin(angle) * start);
      ctx.lineTo(center + Math.cos(angle) * end, center + Math.sin(angle) * end);
      ctx.stroke();
    }

    ctx.globalAlpha = 0.82;
    ctx.strokeStyle = '#010918';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(center, center, center - 5, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
}

function makeHairLockGeometry(options) {
  const {
    length = 0.12,
    width = 0.03,
    depth = 0.015,
    bendX = 0,
    bendZ = 0,
    twist = 0,
    segments = 7,
    radial = 6,
  } = options;

  const positions = [];
  const indices = [];

  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const taper = Math.pow(1 - t, 0.72) * (0.9 + 0.1 * Math.sin(t * Math.PI));
    const w = Math.max(width * taper, 0.0008);
    const d = Math.max(depth * taper, 0.0007);
    const cx = bendX * t * t;
    const cz = bendZ * t * t;
    const cy = -length * t;

    for (let j = 0; j < radial; j += 1) {
      const angle = (j / radial) * TAU + twist * t;
      positions.push(cx + Math.cos(angle) * w, cy, cz + Math.sin(angle) * d);
    }
  }

  for (let i = 0; i < segments; i += 1) {
    for (let j = 0; j < radial; j += 1) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + ((j + 1) % radial);
      indices.push(a, b, c, b, d, c);
    }
  }

  const tipIndex = positions.length / 3;
  positions.push(bendX, -length, bendZ);
  const lastRing = segments * radial;
  for (let j = 0; j < radial; j += 1) {
    const a = lastRing + j;
    const b = lastRing + ((j + 1) % radial);
    indices.push(a, b, tipIndex);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeMouthGeometry(points, radius = 0.0026) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  return new THREE.TubeGeometry(curve, 28, radius, 5, false);
}

export class AvatarStage {
  constructor({ canvas, stage, callbacks = {}, modelUrl = '', quality = 'medium', autoRotate = CONFIG.avatar.autoRotate }) {
    this.canvas = canvas;
    this.stage = stage;
    this.cb = callbacks;
    this.modelUrl = modelUrl;
    this.quality = QUALITY_PRESETS[quality] ? quality : 'medium';
    this.autoRotateState = autoRotate;
    this.mode = 'procedural';
    this.ready = false;
    this.disposed = false;
    this.contextLost = false;

    this.scene = null;
    this.renderer = null;
    this.camera = null;
    this.controls = null;
    this.characterRoot = null;
    this.proceduralRoot = null;
    this.externalRoot = null;
    this.rig = null;
    this.mixer = null;
    this.idleAction = null;
    this.idleClipName = '';
    this.morphEntries = { happy: [], sad: [], angry: [], surprised: [], blink: [] };
    this.expressionSupport = { neutral: false, happy: false, sad: false, angry: false, surprised: false };
    this.expression = 'neutral';
    this.currentPose = { ...EXPRESSION_POSES.neutral };
    this.pointer = { x: 0, y: 0 };
    this.time = 0;
    this.clock = null;
    this.blinkTimer = 3;
    this.blinkProgress = 0;
    this.blinking = false;
    this.cameraTween = null;
    this.frameCount = 0;
    this.fpsTimestamp = 0;
    this.lastFps = 0;
    this.lastModelError = null;
    this.activeQuality = null;
    this.reactionAt = -10;
    this.animationFrame = null;
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return this.info;
    this._initialized = true;
    const started = performance.now();

    this._progress(4, 'Menyiapkan renderer', 'MENGINISIALISASI WEBGL');
    await nextFrame();

    try {
      this._setupRenderer();
      this._setupScene();
      await nextFrame();

      this._progress(20, 'Membangun chamber', 'MENYIAPKAN CAHAYA DAN LATAR');
      this._setupLightsAndEnvironment();
      this._buildStageSet();
      await nextFrame();

      this._progress(42, 'Membangun Rekz', 'MERAKIT GEOMETRI TUBUH DAN WAJAH');
      await nextFrame();
      this._buildProceduralAvatar();
      this._progress(74, 'Menyiapkan rig', 'IDLE, KEDIP, DAN EKSPRESI');
      await nextFrame();

      this.setQuality(this.quality);
      this._startLoop();
      this.renderer.compile(this.scene, this.camera);
      this._progress(87, 'Menghangatkan shader', 'MENGOPTIMALKAN RENDER');
      await nextFrame();

      if (this.modelUrl) {
        this._progress(90, 'Memuat model eksternal', 'MENCARI FILE GLB');
        await this._loadExternalModel(this.modelUrl);
      }

      this._progress(100, 'Rekz siap', 'SELAMAT DATANG DI CHAMBER');
      const minimumVisibleTime = 620;
      const elapsed = performance.now() - started;
      if (elapsed < minimumVisibleTime) {
        await new Promise((resolve) => setTimeout(resolve, minimumVisibleTime - elapsed));
      }
      this._finaliseReady();
      return this.info;
    } catch (error) {
      console.error('[RekzAvatar] Fatal initialisation error:', error);
      this.cb.onFatalError?.({
        title: 'WebGL tidak dapat dimulai',
        message: 'Perangkat atau browser ini tidak berhasil membuat konteks 3D. Coba Chrome terbaru atau aktifkan akselerasi hardware.',
      });
      throw error;
    }
  }

  _progress(percent, title, subtitle) {
    this.cb.onProgress?.({
      percent: clamp(Math.round(percent), 0, 100),
      title,
      subtitle,
    });
  }

  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.quality !== 'low',
      alpha: true,
      powerPreference: 'high-performance',
      stencil: false,
    });

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.canvas.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault();
        this.contextLost = true;
        this.cb.onRenderError?.('Konteks WebGL hilang. Muat ulang halaman untuk memulihkan panggung 3D.');
      },
      false,
    );

    this.canvas.addEventListener(
      'webglcontextrestored',
      () => {
        this.contextLost = false;
        this.cb.onRenderError?.('');
      },
      false,
    );
  }

  _setupScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x030811, 0.042);

    this.camera = new THREE.PerspectiveCamera(CONFIG.avatar.fov, 1, 0.1, 60);
    this.cameraHome = {
      target: new THREE.Vector3(0, 0.98, 0),
      spherical: new THREE.Spherical(CONFIG.avatar.defaultDistance, Math.PI / 2 - 0.02, 0.07),
    };
    this.camera.position.copy(this.cameraHome.target).add(new THREE.Vector3().setFromSpherical(this.cameraHome.spherical));

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.copy(this.cameraHome.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.52;
    this.controls.zoomSpeed = 0.72;
    this.controls.minDistance = CONFIG.avatar.minDistance;
    this.controls.maxDistance = CONFIG.avatar.maxDistance;
    this.controls.minPolarAngle = 0.82;
    this.controls.maxPolarAngle = 1.78;
    this.controls.autoRotate = this.autoRotateState;
    this.controls.autoRotateSpeed = CONFIG.avatar.autoRotateSpeed;

    this._onControlStart = () => {
      this.cameraTween = null;
      this.controls.autoRotate = false;
    };
    this._onControlEnd = () => {
      this.controls.autoRotate = this.autoRotateState;
    };
    this.controls.addEventListener('start', this._onControlStart);
    this.controls.addEventListener('end', this._onControlEnd);
    this.controls.update();

    this.characterRoot = new THREE.Group();
    this.characterRoot.name = 'RekzSubject';
    this.scene.add(this.characterRoot);

    this.clock = new THREE.Clock();

    this._onPointerMove = (event) => {
      const rect = this.stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.pointer.x = clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
      this.pointer.y = clamp(((event.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
    };
    this._onPointerLeave = () => {
      this.pointer.x = 0;
      this.pointer.y = 0;
    };

    this.stage.addEventListener('pointermove', this._onPointerMove, { passive: true });
    this.stage.addEventListener('pointerleave', this._onPointerLeave, { passive: true });

    this.resizeObserver = new ResizeObserver(() => this._resize());
    this.resizeObserver.observe(this.stage);
    window.addEventListener('resize', () => this._resize(), { passive: true });
  }

  _setupLightsAndEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environmentTarget = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environmentTarget.texture;
    this.scene.environmentIntensity = QUALITY_PRESETS[this.quality].environmentIntensity;
    pmrem.dispose();
    room.dispose?.();

    this.hemi = new THREE.HemisphereLight(0x92beff, 0x020409, 0.46);
    this.scene.add(this.hemi);

    this.keyLight = new THREE.DirectionalLight(0xfff2df, 2.35);
    this.keyLight.position.set(2.7, 4.1, 3.4);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.left = -2.2;
    this.keyLight.shadow.camera.right = 2.2;
    this.keyLight.shadow.camera.top = 2.7;
    this.keyLight.shadow.camera.bottom = -1.1;
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 10;
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.normalBias = 0.018;
    this.keyLight.shadow.radius = 3;
    this.scene.add(this.keyLight);

    this.fillLight = new THREE.DirectionalLight(0x7bafff, 1.1);
    this.fillLight.position.set(-2.8, 1.9, 2.5);
    this.scene.add(this.fillLight);

    this.rimLight = new THREE.DirectionalLight(0x377cff, 3.1);
    this.rimLight.position.set(-1.9, 2.5, -2.7);
    this.scene.add(this.rimLight);

    this.bounceLight = new THREE.PointLight(0x2c69d2, 3.2, 4.5, 2);
    this.bounceLight.position.set(0, 0.5, 1.2);
    this.scene.add(this.bounceLight);
  }

  _buildStageSet() {
    this.stageSet = new THREE.Group();
    this.stageSet.name = 'ChamberEnvironment';
    this.scene.add(this.stageSet);

    const glowTexture = makeRadialTexture([
      [0, 'rgba(125, 181, 255, 0.85)'],
      [0.22, 'rgba(51, 121, 236, 0.44)'],
      [0.55, 'rgba(17, 59, 130, 0.13)'],
      [1, 'rgba(3, 8, 17, 0)'],
    ]);

    this.haloMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0x9fc9ff,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.halo = new THREE.Sprite(this.haloMaterial);
    this.halo.position.set(0, 1.22, -1.7);
    this.halo.scale.set(4.4, 4.4, 1);
    this.stageSet.add(this.halo);

    const glowSmallTexture = makeRadialTexture([
      [0, 'rgba(255, 255, 255, 0.6)'],
      [0.28, 'rgba(130, 183, 255, 0.22)'],
      [1, 'rgba(10, 28, 60, 0)'],
    ]);
    this.innerHaloMaterial = new THREE.SpriteMaterial({
      map: glowSmallTexture,
      color: 0xc9e2ff,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.innerHalo = new THREE.Sprite(this.innerHaloMaterial);
    this.innerHalo.position.set(0, 1.3, -1.2);
    this.innerHalo.scale.set(1.65, 1.65, 1);
    this.stageSet.add(this.innerHalo);

    const arcMaterial = new THREE.MeshBasicMaterial({
      color: 0x4c93ff,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.arcOuter = new THREE.Mesh(new THREE.TorusGeometry(1.63, 0.0035, 6, 180, Math.PI * 1.18), arcMaterial);
    this.arcOuter.position.set(0, 1.1, -1.05);
    this.arcOuter.rotation.z = 0.62;
    this.stageSet.add(this.arcOuter);

    this.arcInner = new THREE.Mesh(
      new THREE.TorusGeometry(1.23, 0.0025, 6, 180, Math.PI * 1.34),
      arcMaterial.clone(),
    );
    this.arcInner.material.opacity = 0.16;
    this.arcInner.position.set(0, 1.08, -1.02);
    this.arcInner.rotation.z = -1.15;
    this.stageSet.add(this.arcInner);

    const fadeTexture = makeAlphaFadeTexture();
    const floorMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x081624,
      roughness: 0.31,
      metalness: 0.38,
      clearcoat: 0.7,
      clearcoatRoughness: 0.2,
      transparent: true,
      alphaMap: fadeTexture,
      envMapIntensity: 0.7,
      depthWrite: true,
    });
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(3.4, 96), floorMaterial);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.006;
    this.floor.receiveShadow = true;
    this.stageSet.add(this.floor);

    this.floorRings = new THREE.Group();
    [0.52, 0.78, 1.08, 1.48, 2.05, 2.75].forEach((radius, index) => {
      const opacity = 0.28 - index * 0.032;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius - 0.0025, radius + 0.0025, 160),
        new THREE.MeshBasicMaterial({
          color: index === 0 ? 0x6eacff : 0x2f72d0,
          transparent: true,
          opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          fog: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.002 + index * 0.0001;
      this.floorRings.add(ring);
    });
    this.stageSet.add(this.floorRings);

    this.discGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.35, 1.35),
      new THREE.MeshBasicMaterial({
        map: glowTexture,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.discGlow.rotation.x = -Math.PI / 2;
    this.discGlow.position.y = 0.004;
    this.stageSet.add(this.discGlow);

    const contactTexture = makeRadialTexture([
      [0, 'rgba(0, 0, 0, 0.72)'],
      [0.42, 'rgba(0, 0, 0, 0.42)'],
      [1, 'rgba(0, 0, 0, 0)'],
    ]);
    this.contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.25, 0.85),
      new THREE.MeshBasicMaterial({
        map: contactTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.72,
        fog: false,
      }),
    );
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.set(0, 0.006, 0.02);
    this.stageSet.add(this.contactShadow);

    const particleCount = 190;
    const positions = new Float32Array(particleCount * 3);
    this.particleSeeds = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i += 1) {
      const angle = Math.random() * TAU;
      const radius = 0.35 + Math.random() * 1.9;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = 0.12 + Math.random() * 2.3;
      positions[i * 3 + 2] = Math.sin(angle) * radius - 0.2;
      this.particleSeeds[i] = Math.random() * TAU;
    }
    this.dustGeometry = new THREE.BufferGeometry();
    this.dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.dustMaterial = new THREE.PointsMaterial({
      color: 0x8fc2ff,
      size: 0.011,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.dust = new THREE.Points(this.dustGeometry, this.dustMaterial);
    this.stageSet.add(this.dust);
  }

  _createMaterials() {
    const skin = new THREE.MeshPhysicalMaterial({
      color: COLORS.skin,
      roughness: 0.6,
      metalness: 0,
      clearcoat: 0.07,
      clearcoatRoughness: 0.65,
      sheen: 0.18,
      sheenRoughness: 0.8,
      sheenColor: new THREE.Color(0xffd8c4),
    });
    const skinShade = new THREE.MeshStandardMaterial({ color: COLORS.skinShade, roughness: 0.72 });
    const hair = new THREE.MeshPhysicalMaterial({
      color: COLORS.hair,
      roughness: 0.36,
      metalness: 0.08,
      clearcoat: 0.3,
      clearcoatRoughness: 0.3,
    });
    const hairLight = new THREE.MeshPhysicalMaterial({
      color: COLORS.hairLight,
      roughness: 0.42,
      metalness: 0.05,
      clearcoat: 0.22,
      clearcoatRoughness: 0.38,
    });
    const shirt = new THREE.MeshStandardMaterial({ color: COLORS.shirt, roughness: 0.68, metalness: 0.02 });
    const shirtShade = new THREE.MeshStandardMaterial({ color: COLORS.shirtShade, roughness: 0.7 });
    const navy = new THREE.MeshPhysicalMaterial({
      color: COLORS.navy,
      roughness: 0.5,
      metalness: 0.03,
      clearcoat: 0.12,
      clearcoatRoughness: 0.5,
    });
    const navyLight = new THREE.MeshStandardMaterial({ color: COLORS.navyLight, roughness: 0.48, metalness: 0.04 });
    const navyDark = new THREE.MeshPhysicalMaterial({
      color: COLORS.navyDark,
      roughness: 0.42,
      metalness: 0.06,
      clearcoat: 0.18,
    });
    const trousers = new THREE.MeshStandardMaterial({ color: COLORS.trousers, roughness: 0.62, metalness: 0.02 });
    const shoe = new THREE.MeshPhysicalMaterial({
      color: COLORS.shoe,
      roughness: 0.3,
      metalness: 0.18,
      clearcoat: 0.65,
      clearcoatRoughness: 0.22,
    });
    const sole = new THREE.MeshStandardMaterial({ color: COLORS.sole, roughness: 0.72 });
    const metal = new THREE.MeshStandardMaterial({ color: COLORS.metal, roughness: 0.24, metalness: 0.9 });
    const sapphire = new THREE.MeshStandardMaterial({
      color: COLORS.sapphire,
      emissive: 0x123f95,
      emissiveIntensity: 0.85,
      roughness: 0.28,
      metalness: 0.42,
    });
    const eyeWhite = new THREE.MeshPhysicalMaterial({
      color: 0xf9fbff,
      roughness: 0.16,
      clearcoat: 0.9,
      clearcoatRoughness: 0.08,
    });
    const iris = new THREE.MeshStandardMaterial({
      map: makeIrisTexture(),
      color: 0xffffff,
      emissive: 0x0a2d70,
      emissiveIntensity: 0.52,
      roughness: 0.3,
      metalness: 0.08,
    });
    const pupil = new THREE.MeshBasicMaterial({ color: 0x030711 });
    const highlight = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lash = new THREE.MeshStandardMaterial({ color: 0x080b11, roughness: 0.55 });
    const lip = new THREE.MeshStandardMaterial({ color: COLORS.lip, roughness: 0.5 });
    const mouthInner = new THREE.MeshStandardMaterial({ color: COLORS.mouthInner, roughness: 0.8 });
    const tongue = new THREE.MeshStandardMaterial({ color: COLORS.tongue, roughness: 0.65 });

    this.materials = {
      skin,
      skinShade,
      hair,
      hairLight,
      shirt,
      shirtShade,
      navy,
      navyLight,
      navyDark,
      trousers,
      shoe,
      sole,
      metal,
      sapphire,
      eyeWhite,
      iris,
      pupil,
      highlight,
      lash,
      lip,
      mouthInner,
      tongue,
    };
    return this.materials;
  }

  _buildProceduralAvatar() {
    const mats = this._createMaterials();
    this.proceduralRoot = new THREE.Group();
    this.proceduralRoot.name = 'ProceduralRekz';
    this.characterRoot.add(this.proceduralRoot);

    this.rig = {
      isProcedural: true,
      eyes: [],
      brows: [],
      mouthVariants: {},
      openMouth: null,
      headGroup: null,
      torsoGroup: null,
      arms: [],
      blinkAmount: 0,
    };

    this._buildLegs(this.proceduralRoot, mats);
    this._buildTorso(this.proceduralRoot, mats);
    this._buildHead(this.proceduralRoot, mats);
    this._buildExpressionMeshes();

    this.features = {
      idle: true,
      blink: true,
      expressions: { neutral: true, happy: true, sad: true, angry: true, surprised: true },
    };
    this.expression = 'neutral';
    this._setMouth('neutral');
    this.mode = 'procedural';
  }

  _mesh(geometry, material, { cast = true, receive = false } = {}) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    return mesh;
  }

  _buildLegs(root, mats) {
    const legsGroup = new THREE.Group();
    legsGroup.name = 'Legs';
    root.add(legsGroup);

    const pelvis = this._mesh(new THREE.SphereGeometry(1, 36, 24), mats.trousers);
    pelvis.scale.set(0.153, 0.105, 0.108);
    pelvis.position.y = 0.935;
    legsGroup.add(pelvis);

    const flyLine = this._mesh(new THREE.BoxGeometry(0.004, 0.115, 0.003), mats.navyDark, { cast: false });
    flyLine.position.set(0, 0.945, 0.101);
    legsGroup.add(flyLine);

    const belt = this._mesh(new THREE.CylinderGeometry(0.143, 0.145, 0.038, 40), mats.navyDark);
    belt.scale.z = 0.79;
    belt.position.y = 0.977;
    legsGroup.add(belt);

    const beltLine = this._mesh(new THREE.CylinderGeometry(0.146, 0.146, 0.004, 40), mats.navyLight, { cast: false });
    beltLine.scale.z = 0.79;
    beltLine.position.y = 0.961;
    legsGroup.add(beltLine);

    const buckle = this._mesh(new THREE.BoxGeometry(0.042, 0.028, 0.008), mats.metal);
    buckle.position.set(0, 0.978, 0.118);
    legsGroup.add(buckle);

    const buckleInner = this._mesh(new THREE.BoxGeometry(0.026, 0.014, 0.0025), mats.navyDark, { cast: false });
    buckleInner.position.set(0, 0.978, 0.123);
    legsGroup.add(buckleInner);

    [-0.075, 0, 0.075].forEach((x) => {
      const loop = this._mesh(new THREE.BoxGeometry(0.014, 0.042, 0.006), mats.trousers, { cast: false });
      loop.position.set(x, 0.975, 0.109);
      legsGroup.add(loop);
    });

    [-1, 1].forEach((side) => {
      const leg = new THREE.Group();
      leg.position.set(side * 0.075, 0, 0);
      legsGroup.add(leg);

      const thigh = this._mesh(new THREE.CylinderGeometry(0.073, 0.059, 0.43, 28), mats.trousers);
      thigh.position.y = 0.725;
      leg.add(thigh);

      const knee = this._mesh(new THREE.SphereGeometry(0.06, 24, 16), mats.trousers);
      knee.position.y = 0.515;
      knee.scale.z = 1.02;
      leg.add(knee);

      const calf = this._mesh(new THREE.CylinderGeometry(0.058, 0.043, 0.38, 28), mats.trousers);
      calf.position.y = 0.323;
      leg.add(calf);

      const crease = this._mesh(new THREE.BoxGeometry(0.0075, 0.33, 0.0025), mats.navyLight, { cast: false });
      crease.position.set(0, 0.735, 0.071);
      leg.add(crease);

      const calfCrease = this._mesh(new THREE.BoxGeometry(0.006, 0.26, 0.0022), mats.navyLight, { cast: false });
      calfCrease.position.set(0, 0.32, 0.057);
      leg.add(calfCrease);

      const cuff = this._mesh(new THREE.CylinderGeometry(0.045, 0.046, 0.04, 24), mats.trousers);
      cuff.position.y = 0.15;
      leg.add(cuff);

      const sock = this._mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.075, 20), mats.navyDark);
      sock.position.y = 0.12;
      leg.add(sock);

      const shoeGroup = new THREE.Group();
      shoeGroup.position.set(0, 0, 0.018);
      shoeGroup.rotation.y = side * 0.055;
      leg.add(shoeGroup);

      const sole = this._mesh(new THREE.BoxGeometry(0.146, 0.025, 0.268), mats.sole);
      sole.position.set(0, 0.018, 0.04);
      shoeGroup.add(sole);

      const midsole = this._mesh(new THREE.BoxGeometry(0.151, 0.004, 0.272), mats.sapphire, { cast: false });
      midsole.position.set(0, 0.033, 0.04);
      shoeGroup.add(midsole);

      const upper = this._mesh(new THREE.SphereGeometry(1, 32, 20), mats.shoe);
      upper.scale.set(0.071, 0.05, 0.133);
      upper.position.set(0, 0.068, 0.044);
      shoeGroup.add(upper);

      const toe = this._mesh(new THREE.SphereGeometry(1, 24, 16), mats.shoe);
      toe.scale.set(0.064, 0.035, 0.068);
      toe.position.set(0, 0.054, 0.135);
      shoeGroup.add(toe);

      const heel = this._mesh(new THREE.BoxGeometry(0.132, 0.056, 0.07), mats.shoe);
      heel.position.set(0, 0.061, -0.046);
      shoeGroup.add(heel);

      for (let i = 0; i < 3; i += 1) {
        const lace = this._mesh(new THREE.BoxGeometry(0.062, 0.0035, 0.008), mats.metal, { cast: false });
        lace.position.set(0, 0.104 + i * 0.011, 0.076 + i * 0.022);
        shoeGroup.add(lace);
      }

      const sideLine = this._mesh(new THREE.BoxGeometry(0.004, 0.022, 0.15), mats.navyLight, { cast: false });
      sideLine.position.set(side * 0.068, 0.064, 0.038);
      shoeGroup.add(sideLine);
    });
  }

  _buildTorso(root, mats) {
    const torsoGroup = new THREE.Group();
    torsoGroup.name = 'Torso';
    root.add(torsoGroup);
    this.rig.torsoGroup = torsoGroup;

    const shirtProfile = [
      [0.135, 0.925],
      [0.146, 0.975],
      [0.141, 1.045],
      [0.149, 1.13],
      [0.168, 1.235],
      [0.186, 1.32],
      [0.19, 1.38],
      [0.176, 1.425],
      [0.129, 1.455],
      [0.078, 1.472],
    ].map(([x, y]) => new THREE.Vector2(x, y));

    const shirtMesh = this._mesh(new THREE.LatheGeometry(shirtProfile, 56), mats.shirt);
    shirtMesh.scale.z = 0.73;
    torsoGroup.add(shirtMesh);

    const blazerProfile = [
      [0.148, 0.918],
      [0.159, 0.966],
      [0.154, 1.045],
      [0.162, 1.13],
      [0.182, 1.235],
      [0.201, 1.32],
      [0.205, 1.372],
      [0.191, 1.43],
      [0.136, 1.463],
      [0.087, 1.485],
    ].map(([x, y]) => new THREE.Vector2(x, y));

    const blazerGap = 0.56;
    const blazerMat = mats.navy.clone();
    blazerMat.side = THREE.DoubleSide;
    const blazerShell = this._mesh(
      new THREE.LatheGeometry(blazerProfile, 60, blazerGap / 2, TAU - blazerGap),
      blazerMat,
    );
    blazerShell.scale.z = 0.73;
    torsoGroup.add(blazerShell);

    const shoulderSeamMaterial = mats.navyDark;

    [-1, 1].forEach((side) => {
      const shoulderCap = this._mesh(new THREE.SphereGeometry(1, 28, 20), mats.navy);
      shoulderCap.scale.set(0.078, 0.073, 0.085);
      shoulderCap.position.set(side * 0.177, 1.352, 0.006);
      torsoGroup.add(shoulderCap);

      const seam = this._mesh(new THREE.TorusGeometry(0.058, 0.004, 6, 24, Math.PI), shoulderSeamMaterial, { cast: false });
      seam.position.set(side * 0.195, 1.345, 0.008);
      seam.rotation.y = Math.PI / 2;
      seam.rotation.z = Math.PI / 2;
      torsoGroup.add(seam);

      const armGroup = new THREE.Group();
      armGroup.position.set(side * 0.188, 1.345, 0.006);
      armGroup.rotation.z = side * 0.075;
      armGroup.rotation.x = -0.025;
      torsoGroup.add(armGroup);

      const upperSleeve = this._mesh(new THREE.CapsuleGeometry(0.054, 0.205, 8, 18), mats.navy);
      upperSleeve.position.y = -0.128;
      armGroup.add(upperSleeve);

      const forearmGroup = new THREE.Group();
      forearmGroup.position.y = -0.252;
      forearmGroup.rotation.x = -0.075;
      armGroup.add(forearmGroup);

      const lowerSleeve = this._mesh(new THREE.CapsuleGeometry(0.046, 0.168, 8, 18), mats.navy);
      lowerSleeve.position.y = -0.112;
      forearmGroup.add(lowerSleeve);

      const blazerCuff = this._mesh(new THREE.CylinderGeometry(0.0475, 0.0485, 0.025, 22), mats.navyDark);
      blazerCuff.position.y = -0.218;
      forearmGroup.add(blazerCuff);

      const shirtCuff = this._mesh(new THREE.CylinderGeometry(0.0425, 0.0435, 0.018, 22), mats.shirt);
      shirtCuff.position.y = -0.24;
      forearmGroup.add(shirtCuff);

      const handGroup = new THREE.Group();
      handGroup.position.set(0, -0.262, 0.004);
      forearmGroup.add(handGroup);

      const palm = this._mesh(new THREE.SphereGeometry(1, 24, 18), mats.skin);
      palm.scale.set(0.033, 0.058, 0.025);
      palm.position.y = -0.045;
      handGroup.add(palm);

      const knuckle = this._mesh(new THREE.SphereGeometry(1, 20, 14), mats.skin);
      knuckle.scale.set(0.03, 0.022, 0.022);
      knuckle.position.y = -0.088;
      handGroup.add(knuckle);

      for (let i = 0; i < 4; i += 1) {
        const finger = this._mesh(new THREE.CapsuleGeometry(0.0066, 0.042 - Math.abs(i - 1.5) * 0.004, 4, 7), mats.skin);
        finger.position.set((i - 1.5) * 0.0125, -0.126, 0.002);
        finger.rotation.x = -0.07;
        finger.rotation.z = (i - 1.5) * -0.035;
        handGroup.add(finger);
      }

      const thumb = this._mesh(new THREE.CapsuleGeometry(0.0072, 0.034, 4, 7), mats.skin);
      thumb.position.set(side * 0.032, -0.063, 0.014);
      thumb.rotation.z = side * 0.58;
      thumb.rotation.x = -0.18;
      handGroup.add(thumb);

      this.rig.arms.push({
        group: armGroup,
        forearm: forearmGroup,
        hand: handGroup,
        baseZ: armGroup.rotation.z,
        baseX: armGroup.rotation.x,
        side,
      });
    });

    const collarBand = this._mesh(new THREE.CylinderGeometry(0.081, 0.087, 0.055, 40, 1, true), mats.navyDark);
    collarBand.position.y = 1.462;
    collarBand.scale.z = 0.9;
    collarBand.material = mats.navyDark;
    torsoGroup.add(collarBand);

    const shirtBand = this._mesh(new THREE.CylinderGeometry(0.07, 0.076, 0.03, 32, 1, true), mats.shirt);
    shirtBand.position.y = 1.447;
    shirtBand.scale.z = 0.9;
    torsoGroup.add(shirtBand);

    [-1, 1].forEach((side) => {
      const flap = this._mesh(new THREE.BoxGeometry(0.064, 0.017, 0.04), mats.shirt);
      flap.position.set(side * 0.036, 1.437, 0.108);
      flap.rotation.set(-0.28, side * 0.23, side * 0.38);
      torsoGroup.add(flap);

      const lapelShape = new THREE.Shape();
      lapelShape.moveTo(side * 0.009, 0.495);
      lapelShape.lineTo(side * 0.099, 0.465);
      lapelShape.lineTo(side * 0.078, 0.268);
      lapelShape.lineTo(side * 0.023, 0.36);
      lapelShape.closePath();
      const lapelGeometry = new THREE.ExtrudeGeometry(lapelShape, {
        depth: 0.011,
        bevelEnabled: true,
        bevelThickness: 0.002,
        bevelSize: 0.002,
        bevelSegments: 2,
        steps: 1,
      });
      const lapel = this._mesh(lapelGeometry, mats.navyDark);
      lapel.position.set(0, 0.95, 0.122);
      lapel.rotation.x = -0.18;
      torsoGroup.add(lapel);
    });

    const tieKnot = this._mesh(new THREE.SphereGeometry(1, 20, 16), mats.navyDark);
    tieKnot.scale.set(0.031, 0.026, 0.017);
    tieKnot.position.set(0, 1.422, 0.129);
    torsoGroup.add(tieKnot);

    const tieShape = new THREE.Shape();
    tieShape.moveTo(-0.024, 0);
    tieShape.lineTo(0.024, 0);
    tieShape.lineTo(0.018, -0.205);
    tieShape.lineTo(0, -0.248);
    tieShape.lineTo(-0.018, -0.205);
    tieShape.closePath();
    const tieGeometry = new THREE.ExtrudeGeometry(tieShape, {
      depth: 0.007,
      bevelEnabled: true,
      bevelThickness: 0.0015,
      bevelSize: 0.0018,
      bevelSegments: 1,
      steps: 1,
    });
    const tie = this._mesh(tieGeometry, mats.navyDark);
    tie.position.set(0, 1.405, 0.127);
    tie.rotation.x = -0.055;
    torsoGroup.add(tie);

    const tiePin = this._mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.003, 16), mats.metal);
    tiePin.position.set(0, 1.322, 0.146);
    tiePin.rotation.x = Math.PI / 2;
    torsoGroup.add(tiePin);

    [1.142, 1.075].forEach((y, index) => {
      const button = this._mesh(new THREE.SphereGeometry(0.0052, 14, 10), mats.shirtShade, { cast: false });
      button.position.set(index === 0 ? 0.014 : -0.01, y, 0.132);
      torsoGroup.add(button);
    });

    [1.21, 1.13].forEach((y) => {
      const button = this._mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.004, 16), mats.metal);
      button.position.set(0.054, y, 0.134);
      button.rotation.x = Math.PI / 2;
      torsoGroup.add(button);
    });

    const emblemBack = this._mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.004, 24), mats.metal);
    emblemBack.position.set(0.112, 1.308, 0.106);
    emblemBack.rotation.set(Math.PI / 2, 0, -0.34);
    torsoGroup.add(emblemBack);

    const emblemGem = this._mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.003, 20), mats.sapphire);
    emblemGem.position.set(0.118, 1.309, 0.113);
    emblemGem.rotation.set(Math.PI / 2, 0, -0.34);
    torsoGroup.add(emblemGem);

    const pocketSeam = this._mesh(new THREE.BoxGeometry(0.062, 0.0025, 0.002), mats.navyLight, { cast: false });
    pocketSeam.position.set(-0.106, 1.225, 0.139);
    pocketSeam.rotation.z = 0.08;
    torsoGroup.add(pocketSeam);
  }

  _buildHead(root, mats) {
    const headGroup = new THREE.Group();
    headGroup.name = 'Head';
    headGroup.position.set(0, 1.665, 0);
    headGroup.rotation.z = -0.012;
    root.add(headGroup);
    this.rig.headGroup = headGroup;
    this.rig.headBaseY = headGroup.position.y;
    this.rig.headBaseRotZ = headGroup.rotation.z;

    const neck = this._mesh(new THREE.CylinderGeometry(0.054, 0.065, 0.15, 28), mats.skin);
    neck.position.y = -0.17;
    headGroup.add(neck);

    const headGeometry = new THREE.SphereGeometry(1, 72, 56);
    const position = headGeometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      let x = position.getX(i);
      let y = position.getY(i);
      let z = position.getZ(i);

      const jawRaw = clamp((0.08 - y) / 1.08, 0, 1);
      const jaw = jawRaw * jawRaw * (3 - 2 * jawRaw);
      const cheekRaw = clamp((0.32 - Math.abs(y)) / 0.5, 0, 1);
      const cheek = cheekRaw * cheekRaw * (3 - 2 * cheekRaw);

      x *= 1 - 0.26 * jaw;
      z *= 1 - 0.1 * jaw;
      if (z > 0) {
        z += 0.065 * jaw * (1 - Math.abs(x)) + 0.012 * cheek * (1 - Math.abs(y));
        z *= 0.985;
      } else {
        z *= 0.95;
      }
      x *= 1 + 0.012 * cheek;

      position.setXYZ(i, x, y, z);
    }
    headGeometry.computeVertexNormals();

    const headMesh = this._mesh(headGeometry, mats.skin);
    headMesh.scale.set(0.118, 0.157, 0.126);
    headGroup.add(headMesh);

    [-1, 1].forEach((side) => {
      const ear = this._mesh(new THREE.SphereGeometry(1, 28, 20), mats.skin);
      ear.scale.set(0.016, 0.033, 0.012);
      ear.position.set(side * 0.116, 0.002, -0.004);
      ear.rotation.y = side * -0.2;
      headGroup.add(ear);

      const innerEar = this._mesh(new THREE.SphereGeometry(1, 20, 14), mats.skinShade);
      innerEar.scale.set(0.007, 0.019, 0.005);
      innerEar.position.set(side * 0.123, 0.002, 0.0);
      innerEar.rotation.y = side * -0.2;
      innerEar.castShadow = false;
      headGroup.add(innerEar);
    });

    this._buildEyes(headGroup, mats);
    this._buildBrows(headGroup, mats);

    const noseBridge = this._mesh(new THREE.SphereGeometry(1, 20, 16), mats.skin);
    noseBridge.scale.set(0.011, 0.039, 0.012);
    noseBridge.position.set(0, -0.016, 0.115);
    headGroup.add(noseBridge);

    const noseTip = this._mesh(new THREE.SphereGeometry(1, 20, 16), mats.skin);
    noseTip.scale.set(0.014, 0.014, 0.018);
    noseTip.position.set(0, -0.047, 0.122);
    headGroup.add(noseTip);

    const noseShadow = this._mesh(new THREE.PlaneGeometry(0.035, 0.008), mats.skinShade, { cast: false });
    noseShadow.position.set(0, -0.058, 0.124);
    noseShadow.material = mats.skinShade.clone();
    noseShadow.material.transparent = true;
    noseShadow.material.opacity = 0.24;
    noseShadow.material.depthWrite = false;
    headGroup.add(noseShadow);

    this._buildHair(headGroup, mats);
  }

  _buildEyes(headGroup, mats) {
    const sphereGeometry = new THREE.SphereGeometry(1, 32, 24);
    const irisGeometry = new THREE.CircleGeometry(0.0157, 36);
    const pupilGeometry = new THREE.CircleGeometry(0.0071, 26);
    const glintGeometry = new THREE.CircleGeometry(0.0041, 20);
    const smallGlintGeometry = new THREE.CircleGeometry(0.0019, 14);

    [-1, 1].forEach((side) => {
      const eye = new THREE.Group();
      eye.position.set(side * 0.0505, 0.002, 0.1045);
      eye.rotation.y = side * 0.19;
      eye.rotation.z = side * 0.038;
      headGroup.add(eye);

      const sclera = this._mesh(sphereGeometry, mats.eyeWhite, { cast: false });
      sclera.scale.set(0.0335, 0.0235, 0.013);
      eye.add(sclera);

      const iris = new THREE.Mesh(irisGeometry, mats.iris);
      iris.position.z = 0.0121;
      iris.scale.y = 1.06;
      eye.add(iris);

      const pupil = new THREE.Mesh(pupilGeometry, mats.pupil);
      pupil.position.z = 0.0127;
      eye.add(pupil);

      const glint = new THREE.Mesh(glintGeometry, mats.highlight);
      glint.position.set(-0.0052, 0.0072, 0.0131);
      eye.add(glint);

      const smallGlint = new THREE.Mesh(smallGlintGeometry, mats.highlight);
      smallGlint.position.set(0.0064, -0.0047, 0.0132);
      eye.add(smallGlint);

      const lashCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.0335, 0.0145, 0.0108),
        new THREE.Vector3(-0.006, 0.025, 0.0128),
        new THREE.Vector3(0.032, 0.0175, 0.0107),
      ]);
      const lash = this._mesh(new THREE.TubeGeometry(lashCurve, 22, 0.0027, 5, false), mats.lash, { cast: false });
      eye.add(lash);

      const lowerLine = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.024, -0.0148, 0.0108),
        new THREE.Vector3(0, -0.0182, 0.012),
        new THREE.Vector3(0.023, -0.0144, 0.0106),
      ]);
      const lowerLash = this._mesh(new THREE.TubeGeometry(lowerLine, 16, 0.0011, 4, false), mats.lash, { cast: false });
      lowerLash.material = mats.lash.clone();
      lowerLash.material.transparent = true;
      lowerLash.material.opacity = 0.34;
      eye.add(lowerLash);

      this.rig.eyes.push({
        group: eye,
        baseScaleX: 1,
        baseScaleY: 1,
        side,
      });
    });
  }

  _buildBrows(headGroup, mats) {
    const browGeometry = new THREE.CapsuleGeometry(0.0054, 0.041, 5, 10);
    [-1, 1].forEach((side) => {
      const brow = this._mesh(browGeometry, mats.hair, { cast: false });
      brow.position.set(side * 0.051, 0.0615, 0.115);
      brow.rotation.y = side * 0.2;
      brow.rotation.z = Math.PI / 2 + side * 0.055;
      headGroup.add(brow);
      this.rig.brows.push({
        mesh: brow,
        baseY: brow.position.y,
        baseRotZ: brow.rotation.z,
        side,
      });
    });
  }

  _buildHair(headGroup, mats) {
    const cap = this._mesh(
      new THREE.SphereGeometry(1, 56, 36, 0, TAU, 0, 1.19),
      mats.hair,
    );
    cap.scale.set(0.1245, 0.162, 0.131);
    cap.position.set(0, 0.009, -0.004);
    headGroup.add(cap);

    const backShell = this._mesh(
      new THREE.SphereGeometry(1, 56, 40, Math.PI, Math.PI, 0, 2.16),
      mats.hair,
    );
    backShell.scale.set(0.1215, 0.161, 0.129);
    backShell.position.set(0, 0.004, -0.002);
    headGroup.add(backShell);

    const fringe = [
      { root: [-0.089, 0.052, 0.05], rot: [-0.02, -0.22, -0.46], len: 0.14, w: 0.026, d: 0.013, bendX: -0.008, bendZ: 0.012 },
      { root: [-0.067, 0.078, 0.074], rot: [-0.14, -0.18, -0.28], len: 0.108, w: 0.029, d: 0.014, bendX: -0.011, bendZ: 0.018 },
      { root: [-0.041, 0.094, 0.091], rot: [-0.23, -0.13, -0.14], len: 0.092, w: 0.03, d: 0.015, bendX: -0.006, bendZ: 0.02, light: true },
      { root: [-0.015, 0.103, 0.1], rot: [-0.3, -0.05, -0.04], len: 0.079, w: 0.027, d: 0.014, bendX: -0.003, bendZ: 0.021 },
      { root: [0.016, 0.103, 0.1], rot: [-0.29, 0.05, 0.02], len: 0.088, w: 0.027, d: 0.014, bendX: 0.004, bendZ: 0.022 },
      { root: [0.041, 0.095, 0.091], rot: [-0.22, 0.13, 0.14], len: 0.101, w: 0.03, d: 0.015, bendX: 0.008, bendZ: 0.019 },
      { root: [0.067, 0.078, 0.074], rot: [-0.14, 0.19, 0.29], len: 0.116, w: 0.03, d: 0.014, bendX: 0.011, bendZ: 0.017, light: true },
      { root: [0.089, 0.052, 0.05], rot: [-0.02, 0.23, 0.47], len: 0.138, w: 0.026, d: 0.013, bendX: 0.007, bendZ: 0.011 },
      { root: [-0.02, 0.093, 0.097], rot: [-0.36, -0.07, -0.18], len: 0.072, w: 0.017, d: 0.01, bendX: -0.004, bendZ: 0.016 },
      { root: [0.056, 0.062, 0.072], rot: [0.03, 0.24, 0.3], len: 0.102, w: 0.02, d: 0.011, bendX: 0.009, bendZ: 0.015 },
    ];

    const back = [
      { root: [0, 0.106, -0.056], rot: [0.3, 0, 0.02], len: 0.183, w: 0.048, d: 0.022, bendZ: -0.027, light: true },
      { root: [-0.06, 0.084, -0.067], rot: [0.24, 0.06, -0.25], len: 0.165, w: 0.037, d: 0.018, bendX: -0.012, bendZ: -0.02 },
      { root: [0.06, 0.084, -0.067], rot: [0.24, -0.06, 0.25], len: 0.165, w: 0.037, d: 0.018, bendX: 0.012, bendZ: -0.02 },
      { root: [-0.1, 0.035, -0.027], rot: [0.12, 0.06, -0.42], len: 0.142, w: 0.029, d: 0.014, bendX: -0.01, bendZ: -0.01 },
      { root: [0.1, 0.035, -0.027], rot: [0.12, -0.06, 0.42], len: 0.142, w: 0.029, d: 0.014, bendX: 0.01, bendZ: -0.01 },
      { root: [-0.042, 0.018, -0.101], rot: [0.18, 0.02, -0.08], len: 0.108, w: 0.03, d: 0.014, bendZ: -0.015 },
      { root: [0.044, 0.012, -0.101], rot: [0.18, -0.02, 0.1], len: 0.1, w: 0.029, d: 0.014, bendZ: -0.014 },
      { root: [-0.082, -0.012, -0.063], rot: [0.2, 0.08, -0.22], len: 0.085, w: 0.024, d: 0.012 },
      { root: [0.082, -0.012, -0.063], rot: [0.2, -0.08, 0.22], len: 0.085, w: 0.024, d: 0.012 },
    ];

    const details = [
      { root: [-0.105, 0.06, 0.024], rot: [-0.02, -0.12, -0.46], len: 0.128, w: 0.024, d: 0.012, bendZ: 0.008 },
      { root: [0.105, 0.06, 0.024], rot: [-0.02, 0.12, 0.46], len: 0.128, w: 0.024, d: 0.012, bendZ: 0.008 },
      { root: [-0.111, 0.036, 0.044], rot: [-0.04, 0.06, -0.08], len: 0.073, w: 0.014, d: 0.008 },
      { root: [0.111, 0.036, 0.044], rot: [-0.04, -0.06, 0.08], len: 0.073, w: 0.014, d: 0.008 },
      { root: [-0.02, 0.141, 0.002], rot: [1.87, 0.22, -0.28], len: 0.078, w: 0.031, d: 0.015, bendX: -0.012, bendZ: 0.012, light: true },
      { root: [0.045, 0.137, -0.016], rot: [2.03, -0.22, 0.27], len: 0.066, w: 0.024, d: 0.012, bendX: 0.006 },
    ];

    [...fringe, ...back, ...details].forEach((config) => {
      const geometry = makeHairLockGeometry({
        length: config.len,
        width: config.w,
        depth: config.d,
        bendX: config.bendX || 0,
        bendZ: config.bendZ || 0,
        twist: config.twist || 0,
        segments: 8,
        radial: 6,
      });
      const lock = this._mesh(geometry, config.light ? mats.hairLight : mats.hair);
      lock.position.set(config.root[0], config.root[1], config.root[2]);
      lock.rotation.order = 'YXZ';
      lock.rotation.set(config.rot[0], config.rot[1], config.rot[2]);
      headGroup.add(lock);
    });
  }

  _buildExpressionMeshes() {
    const { headGroup } = this.rig;
    const mats = this.materials;
    const mouthGroup = new THREE.Group();
    mouthGroup.name = 'Mouth';
    headGroup.add(mouthGroup);
    this.rig.mouthGroup = mouthGroup;

    const mouthShapes = {
      neutral: [
        [-0.026, -0.084, 0.112],
        [-0.003, -0.081, 0.1175],
        [0.028, -0.087, 0.1115],
      ],
      happy: [
        [-0.032, -0.078, 0.1105],
        [-0.012, -0.088, 0.1165],
        [0.013, -0.089, 0.117],
        [0.033, -0.077, 0.1105],
      ],
      sad: [
        [-0.028, -0.087, 0.111],
        [-0.009, -0.076, 0.117],
        [0.01, -0.076, 0.117],
        [0.029, -0.088, 0.1105],
      ],
      angry: [
        [-0.024, -0.09, 0.111],
        [-0.006, -0.081, 0.116],
        [0.007, -0.081, 0.116],
        [0.025, -0.091, 0.1105],
      ],
    };

    Object.entries(mouthShapes).forEach(([name, points]) => {
      const mesh = new THREE.Mesh(makeMouthGeometry(points, name === 'angry' ? 0.0024 : 0.0026), mats.lip);
      mesh.name = `Mouth_${name}`;
      mesh.castShadow = false;
      mesh.visible = false;
      mouthGroup.add(mesh);
      this.rig.mouthVariants[name] = mesh;
    });

    const openMouth = new THREE.Group();
    openMouth.name = 'MouthOpen';
    openMouth.position.set(0, -0.083, 0.1115);
    openMouth.visible = false;
    mouthGroup.add(openMouth);

    const cavity = this._mesh(new THREE.SphereGeometry(1, 24, 16), mats.mouthInner, { cast: false });
    cavity.scale.set(0.0225, 0.0305, 0.0125);
    openMouth.add(cavity);

    const teeth = this._mesh(new THREE.BoxGeometry(0.026, 0.0048, 0.003), mats.shirt, { cast: false });
    teeth.position.set(0, 0.015, 0.0095);
    openMouth.add(teeth);

    const tongue = this._mesh(new THREE.SphereGeometry(1, 18, 12), mats.tongue, { cast: false });
    tongue.scale.set(0.0135, 0.008, 0.006);
    tongue.position.set(0, -0.014, 0.0095);
    openMouth.add(tongue);

    this.rig.openMouth = openMouth;
    this.rig.openMouthScale = 0;
  }

  _setMouth(name) {
    if (!this.rig) return;
    const isSurprised = name === 'surprised';
    Object.entries(this.rig.mouthVariants).forEach(([key, mesh]) => {
      mesh.visible = !isSurprised && key === name;
    });
    if (this.rig.openMouth) {
      this.rig.openMouth.visible = isSurprised;
      this.rig.openMouthTarget = isSurprised ? 1 : 0;
      if (!isSurprised) this.rig.openMouth.scale.setScalar(0.001);
    }
  }

  setExpression(id) {
    if (!this.expressionSupport[id]) return false;
    if (this.expression === id) return true;
    this.expression = id;

    if (this.mode === 'procedural' && this.rig) {
      this._setMouth(id);
    } else {
      this._applyMorphExpression(id);
    }
    return true;
  }

  _applyMorphExpression(id) {
    const groupsToReset = ['happy', 'sad', 'angry', 'surprised'];
    groupsToReset.forEach((group) => {
      this.morphEntries[group].forEach((entry) => {
        entry.target = group === id ? 1 : 0;
      });
    });
    if (id === 'neutral') {
      groupsToReset.forEach((group) => {
        this.morphEntries[group].forEach((entry) => {
          entry.target = 0;
        });
      });
    }
  }

  _buildMorphSupport(model) {
    this.morphEntries = { happy: [], sad: [], angry: [], surprised: [], blink: [] };
    const seen = new Set();

    model.traverse((node) => {
      if (!node.isMesh || !node.morphTargetDictionary || !node.morphTargetInfluences) return;
      Object.entries(node.morphTargetDictionary).forEach(([rawName, index]) => {
        const name = normalizeKey(rawName);
        ['happy', 'sad', 'angry', 'surprised', 'blink'].forEach((group) => {
          const matched = MORPH_GROUPS[group].some((token) => name.includes(token));
          if (!matched) return;
          const key = `${node.uuid}:${index}:${group}`;
          if (seen.has(key)) return;
          seen.add(key);
          this.morphEntries[group].push({
            mesh: node,
            index,
            current: node.morphTargetInfluences[index] || 0,
            target: 0,
          });
        });
      });
    });

    const anyEmotion =
      this.morphEntries.happy.length ||
      this.morphEntries.sad.length ||
      this.morphEntries.angry.length ||
      this.morphEntries.surprised.length;

    this.expressionSupport = {
      neutral: Boolean(anyEmotion),
      happy: this.morphEntries.happy.length > 0,
      sad: this.morphEntries.sad.length > 0,
      angry: this.morphEntries.angry.length > 0,
      surprised: this.morphEntries.surprised.length > 0,
    };

    this.expression = 'neutral';
    this._applyMorphExpression('neutral');
  }

  _updateBlink(dt) {
    const canBlink = this.mode === 'procedural' || this.morphEntries.blink.length > 0;
    if (!canBlink) {
      this.blinkAmount = 0;
      return;
    }

    if (!this.blinking) {
      this.blinkTimer -= dt;
      this.blinkAmount = damp(this.blinkAmount, 0, 18, dt);
      if (this.blinkTimer <= 0) {
        this.blinking = true;
        this.blinkProgress = 0;
      }
      return;
    }

    this.blinkProgress += dt / 0.17;
    if (this.blinkProgress >= 1) {
      this.blinking = false;
      this.blinkAmount = 0;
      this.blinkTimer = CONFIG.ui.blinkMinDelay / 1000 + Math.random() * ((CONFIG.ui.blinkMaxDelay - CONFIG.ui.blinkMinDelay) / 1000);
    } else {
      this.blinkAmount = Math.sin(this.blinkProgress * Math.PI);
    }

    if (this.morphEntries.blink.length) {
      this.morphEntries.blink.forEach((entry) => {
        entry.mesh.morphTargetInfluences[entry.index] = this.blinkAmount;
      });
    }
  }

  _animateProcedural(dt) {
    const rig = this.rig;
    if (!rig) return;

    const pose = EXPRESSION_POSES[this.expression] || EXPRESSION_POSES.neutral;
    Object.keys(this.currentPose).forEach((key) => {
      if (typeof pose[key] === 'number') {
        this.currentPose[key] = damp(this.currentPose[key], pose[key], 9, dt);
      }
    });

    const t = this.time;
    const pointerYaw = this.pointer.x * 0.12;
    const pointerPitch = this.pointer.y * 0.035;
    const nodElapsed = t - this.reactionAt;
    const nod = nodElapsed >= 0 && nodElapsed < 0.55 ? Math.sin((nodElapsed / 0.55) * Math.PI) * 0.045 : 0;

    if (rig.headGroup) {
      const head = rig.headGroup;
      const targetYaw = pointerYaw + Math.sin(t * 0.24) * 0.015;
      const targetPitch = this.currentPose.headPitch + pointerPitch + nod + Math.sin(t * 0.31) * 0.006;
      const targetTilt = this.currentPose.headTilt + Math.sin(t * 0.37) * 0.006;
      head.rotation.y = damp(head.rotation.y, targetYaw, 4.5, dt);
      head.rotation.x = damp(head.rotation.x, targetPitch, 4.5, dt);
      head.rotation.z = damp(head.rotation.z, targetTilt, 4, dt);
      head.position.y = rig.headBaseY + Math.sin(t * 1.25) * 0.0012;
    }

    if (rig.brows.length) {
      rig.brows.forEach((brow) => {
        brow.mesh.position.y = damp(brow.mesh.position.y, brow.baseY + this.currentPose.browLift, 12, dt);
        const targetRotation = brow.baseRotZ + brow.side * this.currentPose.browTilt;
        brow.mesh.rotation.z = damp(brow.mesh.rotation.z, targetRotation, 12, dt);
      });
    }

    if (rig.eyes.length) {
      rig.eyes.forEach((eye) => {
        const wide = this.currentPose.eyeOpen;
        const targetScaleY = wide * (1 - this.blinkAmount * 0.88);
        eye.group.scale.x = damp(eye.group.scale.x, 1 + (wide - 1) * 0.09, 10, dt);
        eye.group.scale.y = damp(eye.group.scale.y, clamp(targetScaleY, 0.06, 1.3), 22, dt);
        eye.group.rotation.y = damp(eye.group.rotation.y, eye.side * 0.19 + this.pointer.x * 0.022, 5, dt);
      });
    }

    if (rig.openMouth) {
      const target = rig.openMouthTarget || 0;
      rig.openMouthScale = damp(rig.openMouthScale, target, 14, dt);
      const scale = Math.max(0.001, rig.openMouthScale);
      rig.openMouth.scale.set(scale, scale, scale);
      rig.openMouth.visible = rig.openMouthScale > 0.015;
    }

    if (rig.torsoGroup) {
      const breath = Math.sin(t * 1.32);
      rig.torsoGroup.scale.set(1 + breath * 0.0012, 1 + breath * 0.0022, 1 + breath * 0.0012);
    }

    if (rig.arms.length) {
      rig.arms.forEach((arm, index) => {
        arm.group.rotation.z = arm.baseZ + Math.sin(t * 1.05 + index * 1.9) * 0.007;
        arm.forearm.rotation.x = -0.075 + Math.sin(t * 0.87 + index) * 0.008;
      });
    }

    this.characterRoot.rotation.y = Math.sin(t * 0.2) * 0.005;
  }

  _animateExternal(dt) {
    if (this.mixer) this.mixer.update(dt);

    if (this.externalRoot) {
      const baseY = this.externalRoot.userData.groundY ?? this.externalRoot.position.y;
      this.externalRoot.position.y = baseY + Math.sin(this.time * 1.1) * 0.0014;
      this.externalRoot.rotation.y = Math.sin(this.time * 0.17) * 0.004;
    }

    const emotionGroups = ['happy', 'sad', 'angry', 'surprised'];
    emotionGroups.forEach((group) => {
      this.morphEntries[group].forEach((entry) => {
        entry.current = damp(entry.current, entry.target, 10, dt);
        entry.mesh.morphTargetInfluences[entry.index] = entry.current;
      });
    });
  }

  _animateEnvironment(dt) {
    const t = this.time;
    if (this.haloMaterial) this.haloMaterial.opacity = 0.3 + Math.sin(t * 0.5) * 0.035;
    if (this.innerHaloMaterial) this.innerHaloMaterial.opacity = 0.19 + Math.sin(t * 0.73 + 1) * 0.025;
    if (this.innerHalo) {
      const pulse = 1 + Math.sin(t * 0.46) * 0.025;
      this.innerHalo.scale.set(1.65 * pulse, 1.65 * pulse, 1);
    }
    if (this.arcOuter) this.arcOuter.rotation.z += dt * 0.012;
    if (this.arcInner) this.arcInner.rotation.z -= dt * 0.008;
    if (this.dust) this.dust.rotation.y += dt * 0.008;
    if (this.discGlow && this.discGlow.material) {
      this.discGlow.material.opacity = 0.3 + Math.sin(t * 0.65) * 0.03;
    }
  }

  _animateScene(dt) {
    this._updateBlink(dt);
    if (this.mode === 'procedural' && this.rig) {
      this._animateProcedural(dt);
    } else {
      this._animateExternal(dt);
    }
    this._animateEnvironment(dt);
  }

  _startLoop() {
    if (this.animationFrame) return;
    this.clock.start();
    this.fpsElapsed = 0;

    const loop = () => {
      if (this.disposed) return;
      this.animationFrame = requestAnimationFrame(loop);
      if (this.contextLost || document.hidden) return;

      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.time += dt;

      if (this.cameraTween) this._updateCameraTween(dt);
      if (this.controls) this.controls.update();

      this._animateScene(dt);
      this.renderer.render(this.scene, this.camera);

      this.frameCount += 1;
      this.fpsElapsed += dt;
      if (this.fpsElapsed >= 0.5) {
        const fps = Math.round(this.frameCount / this.fpsElapsed);
        this.frameCount = 0;
        this.fpsElapsed = 0;
        if (fps !== this.lastFps) {
          this.lastFps = fps;
          this.cb.onFps?.(fps);
        }
      }
    };

    this.animationFrame = requestAnimationFrame(loop);
  }

  _resize() {
    if (!this.renderer || !this.camera || !this.stage) return;
    const width = this.stage.clientWidth;
    const height = this.stage.clientHeight;
    if (!width || !height) return;
    const preset = QUALITY_PRESETS[this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.maxDpr));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setQuality(quality) {
    const preset = QUALITY_PRESETS[quality];
    if (!preset) return;
    this.quality = quality;
    this.activeQuality = preset;

    if (this.renderer) {
      this.renderer.shadowMap.enabled = preset.shadows;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.maxDpr));
      this.renderer.setSize(this.stage.clientWidth, this.stage.clientHeight, false);
    }

    if (this.keyLight) {
      this.keyLight.castShadow = preset.shadows;
      this.keyLight.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      if (this.keyLight.shadow.map) {
        this.keyLight.shadow.map.dispose();
        this.keyLight.shadow.map = null;
      }
    }

    if (this.floor) this.floor.receiveShadow = preset.shadows;
    if (this.scene) this.scene.environmentIntensity = preset.environmentIntensity;
    if (this.dustGeometry) this.dustGeometry.setDrawRange(0, preset.particles);

    if (this.scene) {
      this.scene.traverse((node) => {
        if (!node.isMesh) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => {
          if (material) material.needsUpdate = true;
        });
      });
    }

    if (this.renderer) this.renderer.shadowMap.needsUpdate = true;
    this._resize();
    this.cb.onQualityChanged?.(quality, preset);
  }

  setAutoRotate(enabled) {
    this.autoRotateState = Boolean(enabled);
    if (this.controls) this.controls.autoRotate = this.autoRotateState;
  }

  resetCamera() {
    if (!this.controls) return;
    this._beginCameraTween({
      radius: this.cameraHome.spherical.radius,
      phi: this.cameraHome.spherical.phi,
      theta: this.cameraHome.spherical.theta,
    });
  }

  stepCamera(action) {
    if (!this.controls) return;
    if (action === 'reset') {
      this.resetCamera();
      return;
    }

    const offset = this.camera.position.clone().sub(this.controls.target);
    const current = new THREE.Spherical().setFromVector3(offset);
    const goal = {
      radius: current.radius,
      phi: current.phi,
      theta: current.theta,
    };

    if (action === 'rotate-left') goal.theta += Math.PI / 9;
    if (action === 'rotate-right') goal.theta -= Math.PI / 9;
    if (action === 'zoom-in') goal.radius = clamp(current.radius * 0.86, this.controls.minDistance, this.controls.maxDistance);
    if (action === 'zoom-out') goal.radius = clamp(current.radius * 1.16, this.controls.minDistance, this.controls.maxDistance);

    this._beginCameraTween(goal);
  }

  _beginCameraTween(goal) {
    if (!this.camera || !this.controls) return;
    const current = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    this.cameraTween = {
      elapsed: 0,
      duration: 0.58,
      from: { radius: current.radius, phi: current.phi, theta: current.theta },
      to: goal,
      autoWasOn: this.controls.autoRotate,
    };
    this.controls.autoRotate = false;
  }

  _updateCameraTween(dt) {
    const tween = this.cameraTween;
    if (!tween) return;
    tween.elapsed += dt;
    const linear = clamp(tween.elapsed / tween.duration, 0, 1);
    const progress = easeOutCubic(linear);
    const thetaDelta = Math.atan2(
      Math.sin(tween.to.theta - tween.from.theta),
      Math.cos(tween.to.theta - tween.from.theta),
    );
    const spherical = new THREE.Spherical(
      THREE.MathUtils.lerp(tween.from.radius, tween.to.radius, progress),
      THREE.MathUtils.lerp(tween.from.phi, tween.to.phi, progress),
      tween.from.theta + thetaDelta * progress,
    );
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));

    if (linear >= 1) {
      this.cameraTween = null;
      if (this.controls) this.controls.autoRotate = this.autoRotateState;
    }
  }

  acknowledge() {
    this.reactionAt = this.time;
  }

  async retryModel() {
    if (!this.modelUrl) return this.info;
    this.lastModelError = null;
    this.cb.onLoadStart?.();
    await this._loadExternalModel(this.modelUrl);
    this.info = this._buildInfo();
    this.cb.onReady?.(this.info);
    return this.info;
  }

  async _loadExternalModel(url) {
    this.cb.onLoadStart?.();
    let absoluteUrl;
    try {
      absoluteUrl = new URL(url, document.baseURI).href;
    } catch {
      absoluteUrl = url;
    }

    const loader = new GLTFLoader();
    return new Promise((resolve) => {
      loader.load(
        absoluteUrl,
        (gltf) => {
          if (this.disposed) {
            resolve(false);
            return;
          }
          try {
            this._applyExternalModel(gltf, absoluteUrl);
            this.lastModelError = null;
            this._progress(98, 'Model eksternal siap', 'MENERAPKAN MATERIAL DAN RIG');
            resolve(true);
          } catch (error) {
            console.error('[RekzAvatar] Failed to apply external model:', error);
            this._registerModelError(error, url);
            resolve(false);
          }
        },
        (event) => {
          if (!event.total) return;
          const fraction = clamp(event.loaded / event.total, 0, 1);
          this._progress(90 + fraction * 8, 'Memuat model GLB', `${Math.round(fraction * 100)}% DARI FILE`);
        },
        (error) => {
          console.warn('[RekzAvatar] External model request failed:', error);
          this._registerModelError(error, url);
          resolve(false);
        },
      );
    });
  }

  _registerModelError(error, url) {
    let filename = url;
    try {
      filename = decodeURIComponent(new URL(url, document.baseURI).pathname.split('/').pop() || url);
    } catch {
      /* Keep the raw path. */
    }
    const detail = error?.message ? ` ${String(error.message).slice(0, 120)}` : '';
    const fallback = this.proceduralRoot
      ? 'Placeholder 3D prosedural tetap ditampilkan.'
      : 'Model sebelumnya tetap ditampilkan.';
    this.lastModelError = {
      title: 'Model eksternal gagal dimuat',
      message: `File "${filename}" tidak dapat dimuat.${detail} ${fallback} Periksa path, format GLB, dan pengaturan CORS.`,
    };
    this.cb.onModelError?.(this.lastModelError);
  }

  _applyExternalModel(gltf, absoluteUrl) {
    const model = gltf.scene;
    if (!model) throw new Error('GLB tidak berisi scene yang valid.');

    model.updateMatrixWorld(true);
    const originalBox = new THREE.Box3().setFromObject(model);
    const size = originalBox.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y <= 0.001) throw new Error('Ukuran model tidak valid.');

    const scale = CONFIG.avatar.targetHeight / size.y;
    model.scale.multiplyScalar(scale);
    model.updateMatrixWorld(true);
    const scaledBox = new THREE.Box3().setFromObject(model);
    const center = scaledBox.getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.name = 'ExternalRekzPivot';
    pivot.add(model);
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= scaledBox.min.y;
    pivot.updateMatrixWorld(true);
    pivot.userData.groundY = 0;

    let meshCount = 0;
    model.traverse((node) => {
      if (!node.isMesh) return;
      meshCount += 1;
      node.castShadow = true;
      node.receiveShadow = true;
      node.frustumCulled = false;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => {
        if (!material) return;
        if ('envMapIntensity' in material) material.envMapIntensity = 0.8;
        material.needsUpdate = true;
      });
    });
    if (!meshCount) throw new Error('Model tidak memiliki mesh yang dapat dirender.');

    if (this.proceduralRoot) {
      this.characterRoot.remove(this.proceduralRoot);
      this._disposeObject(this.proceduralRoot);
      this.proceduralRoot = null;
      this.rig = null;
    }
    if (this.externalRoot) {
      this.characterRoot.remove(this.externalRoot);
      this._disposeObject(this.externalRoot);
    }
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }

    this.externalRoot = pivot;
    this.characterRoot.add(pivot);
    this.mode = 'external';
    this.modelUrl = absoluteUrl;
    this.idleAction = null;
    this.idleClipName = '';

    const clips = gltf.animations || [];
    const idleClip =
      clips.find((clip) => /idle/i.test(clip.name)) ||
      clips.find((clip) => /breath|stand|loop/i.test(clip.name)) ||
      null;

    if (idleClip) {
      this.mixer = new THREE.AnimationMixer(model);
      this.idleAction = this.mixer.clipAction(idleClip);
      this.idleAction.setLoop(THREE.LoopRepeat, Infinity);
      this.idleAction.play();
      this.idleClipName = idleClip.name;
    }

    this._buildMorphSupport(model);
    this._setMouth?.('neutral');
    this.expression = 'neutral';
    this.setQuality(this.quality);
  }

  _buildInfo() {
    const isProcedural = this.mode === 'procedural';
    const expressionMap = isProcedural
      ? { neutral: true, happy: true, sad: true, angry: true, surprised: true }
      : { ...this.expressionSupport };
    const expressionCount = Object.values(expressionMap).filter(Boolean).length;
    const canBlink = isProcedural || this.morphEntries.blink.length > 0;

    let sourceLabel = 'Prosedural Three.js';
    if (!isProcedural) {
      try {
        sourceLabel = decodeURIComponent(new URL(this.modelUrl, document.baseURI).pathname.split('/').pop() || 'Model GLB');
      } catch {
        sourceLabel = 'Model GLB eksternal';
      }
    }

    return {
      mode: this.mode,
      sourceLabel,
      modelUrl: isProcedural ? '' : this.modelUrl,
      features: {
        idle: true,
        idleLabel: isProcedural ? 'Aktif' : this.idleClipName ? 'Aktif' : 'Sway ringan',
        idleClip: this.idleClipName,
        blink: canBlink,
        blinkLabel: canBlink ? 'Aktif' : 'Belum tersedia',
        expressions: expressionMap,
        expressionCount,
        expressionLabel: expressionCount > 0 ? `${expressionCount} / 5` : 'Belum tersedia',
        expressionNote: isProcedural
          ? 'Rig wajah prosedural aktif. Ekspresi dirender langsung pada geometri 3D.'
          : expressionCount > 0
            ? 'Ekspresi mengikuti morph target yang tersedia pada model GLB ini.'
            : 'Model GLB ini tidak memiliki morph target emosi. Ekspresi dinonaktifkan, tanpa simulasi palsu.',
      },
    };
  }

  _finaliseReady() {
    if (this.mode === 'procedural' && this.rig) this._setMouth(this.expression);
    this.ready = true;
    this.info = this._buildInfo();
    this.stage.setAttribute('aria-busy', 'false');
    this.cb.onReady?.(this.info);
  }

  getInfo() {
    return this.info || this._buildInfo();
  }

  _disposeObject(root) {
    if (!root) return;
    const materials = new Set();
    root.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      const nodeMaterials = Array.isArray(node.material) ? node.material : [node.material];
      nodeMaterials.forEach((material) => {
        if (material) materials.add(material);
      });
    });
    materials.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value && value.isTexture) value.dispose();
      });
      material.dispose();
    });
  }

  dispose() {
    this.disposed = true;
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.resizeObserver?.disconnect();
    this.stage?.removeEventListener('pointermove', this._onPointerMove);
    this.stage?.removeEventListener('pointerleave', this._onPointerLeave);
    if (this.controls) {
      this.controls.removeEventListener('start', this._onControlStart);
      this.controls.removeEventListener('end', this._onControlEnd);
      this.controls.dispose();
    }
    if (this.renderer) {
      this._disposeObject(this.scene);
      this.environmentTarget?.dispose();
      this.renderer.dispose();
    }
  }
}








