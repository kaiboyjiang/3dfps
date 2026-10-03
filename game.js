import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPONS, buildWeaponModel } from './weapons.js';

const ARENA = 30;
const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.4;
const WALK_SPEED = 6;
const SPRINT_SPEED = 9.5;
const JUMP_SPEED = 8.2;
const GRAVITY = 20;
const MAX_HEALTH = 100;
const BASE_FOV = 75;
const SWITCH_TIME = 0.45;
const ENEMY_RADIUS = 0.45;
const ENEMY_EYE = 1.72;
const CEIL = 7;
const DOOR_W = 4;
const DOOR_H = 3.6;

const COLORS = {
  fog: 0x0a1222,
  gun: 0x2a2f36,
};

// Team 1 is the player's boarding party, team -1 the ship's defenders.
const TEAM_STYLE = {
  1: {
    armor: 0xdfe6ee, suit: 0x2c3b52, plate: 0x2f7fe0, helmet: 0xeef2f6, under: 0x1d2633, boots: 0x222831, glow: 0x38c8ff, bolt: 0x4fc3ff,
  },
  [-1]: {
    armor: 0x3b3236, suit: 0x1c1a1e, plate: 0xc8302a, helmet: 0x2a2326, under: 0x141214, boots: 0x191719, glow: 0xff3a2a, bolt: 0xff5a3a,
  },
};

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(COLORS.fog, 0.006);

const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);

// Space backdrop seen through the hull windows.
const NOISE_GLSL = `
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.02 + 7.1; a *= 0.5; }
    return v;
  }`;
const starDir = new THREE.Vector3(0.6, 0.18, -0.78).normalize();
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(300, 48, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { starDir: { value: starDir } },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `
      uniform vec3 starDir;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = vec3(0.004, 0.006, 0.016);
        float n = fbm(d * 2.2);
        float m = fbm(d * 4.5 + 11.0);
        col += vec3(0.32, 0.08, 0.42) * pow(smoothstep(0.42, 0.85, n), 1.5) * 0.55;
        col += vec3(0.04, 0.22, 0.42) * pow(smoothstep(0.45, 0.9, m), 1.5) * 0.5;
        vec3 c = floor(d * 220.0);
        vec3 f = fract(d * 220.0) - 0.5;
        float star = step(0.975, hash(c)) * smoothstep(0.32, 0.0, length(f)) * (0.6 + 3.0 * hash(c + 3.7));
        col += star * mix(vec3(1.0, 0.82, 0.65), vec3(0.7, 0.85, 1.0), hash(c + 9.1));
        float s = max(dot(d, starDir), 0.0);
        col += vec3(1.0, 0.92, 0.8) * (pow(s, 3000.0) * 80.0 + pow(s, 60.0) * 0.6 + pow(s, 8.0) * 0.05);
        gl_FragColor = vec4(col, 1.0);
      }`,
  }),
);
sky.frustumCulled = false;
scene.add(sky);

const planet = new THREE.Mesh(
  new THREE.SphereGeometry(70, 64, 32),
  new THREE.ShaderMaterial({
    fog: false,
    uniforms: { lightDir: { value: new THREE.Vector3(0.8, 0.3, 0.5).normalize() } },
    vertexShader: `
      varying vec3 vN, vP, vW;
      void main() {
        vP = position;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform vec3 lightDir;
      varying vec3 vN, vP, vW;
      ${NOISE_GLSL}
      void main() {
        vec3 p = normalize(vP);
        float n = fbm(p * 3.0);
        float bands = sin(p.y * 22.0 + n * 7.0) * 0.5 + 0.5;
        vec3 col = mix(vec3(0.62, 0.32, 0.18), vec3(0.95, 0.78, 0.56), bands);
        col = mix(col, vec3(0.35, 0.14, 0.1), smoothstep(0.55, 0.75, fbm(p * 7.0 + 3.0)) * 0.5);
        vec3 N = normalize(vN);
        float l = max(dot(N, lightDir), 0.0);
        float rim = pow(1.0 - max(dot(N, normalize(cameraPosition - vW)), 0.0), 3.0);
        col = col * (0.02 + l * 1.4) + vec3(0.35, 0.55, 1.0) * rim * (0.08 + l);
        gl_FragColor = vec4(col, 1.0);
      }`,
  }),
);
planet.position.set(-50, -20, -240);
scene.add(planet);

// Lighting environment: a generic lit ship interior with ceiling light strips.
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(new THREE.Mesh(
  new THREE.SphereGeometry(10, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = mix(vec3(0.05, 0.06, 0.08), vec3(0.42, 0.47, 0.55), smoothstep(-0.5, 0.7, d.y));
        float strips = smoothstep(0.9, 0.98, abs(sin(atan(d.z, d.x) * 5.0))) * smoothstep(0.55, 0.85, d.y);
        col += vec3(2.4, 2.6, 2.9) * strips;
        col += vec3(0.1, 0.5, 0.8) * smoothstep(0.2, 0.0, abs(d.y + 0.05)) * 0.4;
        gl_FragColor = vec4(col, 1.0);
      }`,
  }),
));
const envMap = pmrem.fromScene(envScene, 0.03).texture;
scene.environment = envMap;
scene.environmentIntensity = 0.8;

scene.add(new THREE.HemisphereLight(0xb8ccff, 0x3a404c, 0.7));
const sun = new THREE.DirectionalLight(0xe8f0ff, 2.2);
sun.position.set(14, 45, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.03;
Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 120 });
scene.add(sun);
for (const [x, y, z, color, intensity] of [
  [0, 3.5, 3, 0x38d8ff, 60], [0, 5.5, -20, 0x7fb0ff, 30], [0, 5.5, 24, 0xffe0b0, 30],
  [19.5, 5, 3, 0xffa040, 30], [-19.5, 5, 3, 0xdce8ff, 25],
]) {
  const light = new THREE.PointLight(color, intensity, 20, 1.6);
  light.position.set(x, y, z);
  scene.add(light);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  weaponCamera.aspect = camera.aspect;
  weaponCamera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Materials ----------
const texLoader = new THREE.TextureLoader();
const maxAniso = renderer.capabilities.getMaxAnisotropy();

const texCache = new Map();

function loadTex(file, srgb) {
  if (texCache.has(file)) return texCache.get(file);
  const tex = texLoader.load(file);
  texCache.set(file, tex);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Poly Haven PBR set: diffuse, OpenGL normal, and packed AO/roughness/metal.
function pbrMaterial(name, opts = {}) {
  const arm = loadTex(`assets/textures/${name}_arm.jpg`, false);
  return new THREE.MeshStandardMaterial({
    map: loadTex(`assets/textures/${name}_diff.jpg`, true),
    normalMap: loadTex(`assets/textures/${name}_nor.jpg`, false),
    aoMap: arm,
    roughnessMap: arm,
    metalnessMap: arm,
    metalness: 1,
    ...opts,
  });
}

const panelTex = canvasTexture(512, (g, s) => {
  g.fillStyle = '#c9d0d8';
  g.fillRect(0, 0, s, s);
  const h = s / 2;
  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 2; px++) {
      const x0 = px * h;
      const y0 = py * h;
      g.fillStyle = `rgb(${(190 + Math.random() * 20) | 0},${(198 + Math.random() * 20) | 0},${(208 + Math.random() * 20) | 0})`;
      g.fillRect(x0 + 6, y0 + 6, h - 12, h - 12);
      g.fillStyle = 'rgba(40,50,60,0.16)';
      g.fillRect(x0 + 30, y0 + 40, h - 60, h - 80);
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 2;
      g.strokeRect(x0 + 30, y0 + 40, h - 60, h - 80);
      g.fillStyle = '#5a6470';
      for (const [bx, by] of [[14, 14], [h - 14, 14], [14, h - 14], [h - 14, h - 14]]) {
        g.beginPath();
        g.arc(x0 + bx, y0 + by, 3.5, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  g.fillStyle = '#3a424c';
  g.fillRect(0, 0, s, 4);
  g.fillRect(0, h - 2, s, 4);
  g.fillRect(0, 0, 4, s);
  g.fillRect(h - 2, 0, 4, s);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(30,35,40,${Math.random() * 0.08})`;
    g.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 12, 2 + Math.random() * 12);
  }
});

const MATS = {
  floor: pbrMaterial('metal_plate', { color: 0xa4adb8 }),
  hull: new THREE.MeshStandardMaterial({
    map: panelTex,
    normalMap: loadTex('assets/textures/metal_plate_nor.jpg', false),
    normalScale: new THREE.Vector2(0.3, 0.3),
    roughness: 0.45,
    metalness: 0.35,
  }),
  ceiling: pbrMaterial('metal_plate', { color: 0x6c7480 }),
  metal: pbrMaterial('metal_plate'),
  rust: pbrMaterial('rusty_metal_02'),
  corrugated: pbrMaterial('corrugated_iron', { color: 0xb8c2cc, metalnessMap: null, metalness: 0.5 }),
  crates: [0xc8d0da, 0xff8a3c, 0x3cc8d8].map((color) => pbrMaterial('metal_plate', { color, metalnessMap: null, metalness: 0.25 })),
};

// Box with UVs scaled to world size so textures keep a constant texel density on every face.
function worldBox(w, h, d, metresPerTile) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const spans = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let i = 0; i < uv.count; i++) {
    const [su, sv] = spans[Math.floor(i / 4)];
    uv.setXY(i, uv.getX(i) * su / metresPerTile, uv.getY(i) * sv / metresPerTile);
  }
  return geo;
}

// ---------- World ----------
const solids = [];      // { min: Vector3, max: Vector3 }
const worldMeshes = []; // meshes that block bullets

const floorGeo = new THREE.PlaneGeometry(ARENA * 2 + 2, ARENA * 2 + 2);
floorGeo.attributes.uv.array.forEach((v, i, a) => { a[i] = v * (ARENA * 2 + 2) / 2; });
const floor = new THREE.Mesh(floorGeo, MATS.floor);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
worldMeshes.push(floor);

const ceilGeo = new THREE.PlaneGeometry(ARENA * 2 + 2, ARENA * 2 + 2);
ceilGeo.attributes.uv.array.forEach((v, i, a) => { a[i] = v * (ARENA * 2 + 2) / 3; });
const ceiling = new THREE.Mesh(ceilGeo, MATS.ceiling);
ceiling.rotation.x = Math.PI / 2;
ceiling.position.y = CEIL;
ceiling.receiveShadow = true;
scene.add(ceiling);
worldMeshes.push(ceiling);

// ---------- Static detail, batched into one mesh per material ----------
const decorBatches = new Map();
const decorMatrix = new THREE.Matrix4();
const decorEuler = new THREE.Euler();
const decorQuat = new THREE.Quaternion();
const decorPos = new THREE.Vector3();
const decorScale = new THREE.Vector3();

function decoMatrix(material, geo, matrix) {
  if (!decorBatches.has(material)) decorBatches.set(material, []);
  decorBatches.get(material).push(geo.clone().applyMatrix4(matrix));
}

function deco(material, geo, x, y, z, rot = [0, 0, 0], scale = [1, 1, 1]) {
  decorEuler.set(rot[0], rot[1], rot[2], rot[3] || 'XYZ');
  decorMatrix.compose(decorPos.set(x, y, z), decorQuat.setFromEuler(decorEuler), decorScale.set(scale[0], scale[1], scale[2]));
  decoMatrix(material, geo, decorMatrix);
}

function finalizeDecor() {
  for (const [material, geos] of decorBatches) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), material);
    const { cast = true, shoot = true } = material.userData;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (shoot) worldMeshes.push(mesh);
    for (const g of geos) g.dispose();
  }
  decorBatches.clear();
}

function solidOnly(x, z, w, h, d, y = 0) {
  solids.push({
    min: new THREE.Vector3(x - w / 2, y, z - d / 2),
    max: new THREE.Vector3(x + w / 2, y + h, z + d / 2),
  });
}

// Deterministic layout randomness so the arena looks the same every visit.
let seed = 1337;
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function canvasTexture(size, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}

function decalMaterial(map, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    map, alphaTest: 0.5, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...opts,
  });
  m.userData = { cast: false };
  return m;
}

function textTexture(lines, { fg = '#ffffff', bg = null, font = 'bold 90px Impact, Arial Black, sans-serif', w = 512, h = 256 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
  }
  g.fillStyle = fg;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((line, i) => g.fillText(line, w / 2, h * (i + 1) / (lines.length + 1)));
  // Weathering: knock random specks out of the paint.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < w * h / 60; i++) {
    g.globalAlpha = Math.random();
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

const wornTex = canvasTexture(256, (g, s) => {
  g.fillStyle = '#fff';
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#000';
  for (let i = 0; i < 900; i++) {
    g.globalAlpha = 0.3 + Math.random() * 0.7;
    g.beginPath();
    g.arc(Math.random() * s, Math.random() * s, 0.5 + Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
}, false);

const hazardTex = canvasTexture(128, (g, s) => {
  g.fillStyle = '#ffc61a';
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#15161a';
  for (let i = -2; i < 3; i++) {
    g.beginPath();
    g.moveTo(i * s / 2, s);
    g.lineTo(i * s / 2 + s / 4, s);
    g.lineTo(i * s / 2 + s / 4 + s, 0);
    g.lineTo(i * s / 2 + s, 0);
    g.fill();
  }
});

const grateTex = canvasTexture(128, (g, s) => {
  g.fillStyle = '#5b5f63';
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#0b0c0d';
  for (let i = 12; i < s - 8; i += 10) g.fillRect(10, i, s - 20, 5);
  g.strokeStyle = '#3a3d40';
  g.lineWidth = 6;
  g.strokeRect(3, 3, s - 6, s - 6);
});

function stdMat(color, roughness, metalness = 0, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

function noShadow(material) {
  material.userData = { cast: false };
  return material;
}

function scenery(material) {
  material.userData = { cast: false, shoot: false };
  return material;
}

const glowMat = (color, intensity = 3) => noShadow(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity }));

const screenMats = ['#38e1ff', '#ffb43a', '#3dff9a'].map((c) => noShadow(new THREE.MeshStandardMaterial({
  color: 0x000000,
  emissive: 0xffffff,
  emissiveIntensity: 1.4,
  roughness: 0.15,
  metalness: 0.5,
  emissiveMap: canvasTexture(256, (g, s) => {
    g.fillStyle = '#04080c';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = c;
    g.fillStyle = c;
    g.lineWidth = 2;
    g.strokeRect(8, 8, s - 16, s - 16);
    for (let i = 0; i < 6; i++) {
      g.globalAlpha = 0.5 + Math.random() * 0.5;
      g.fillRect(20, 30 + i * 18, 20 + Math.random() * 90, 8);
    }
    g.globalAlpha = 1;
    g.beginPath();
    for (let x = 0; x < 100; x++) {
      const y = 205 - 30 * Math.sin(x * 0.15) - Math.random() * 12;
      if (x) g.lineTo(140 + x, y);
      else g.moveTo(140, y);
    }
    g.stroke();
    for (const r of [40, 22]) {
      g.beginPath();
      g.arc(190, 80, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(190, 80);
    g.lineTo(222, 56);
    g.stroke();
    g.globalAlpha = 0.6;
    for (let i = 0; i < 5; i++) g.fillRect(20, 160 + i * 14, 40 + Math.random() * 60, 3);
  }),
})));

function signMat(text, color) {
  const tex = textTexture([text], { font: 'bold 130px "Segoe UI", Arial, sans-serif', w: 1024, h: 256 });
  return noShadow(new THREE.MeshStandardMaterial({
    color: 0x000000, map: tex, emissive: color, emissiveMap: tex, emissiveIntensity: 2, alphaTest: 0.4, roughness: 0.4,
  }));
}

const DMAT = {
  hull: MATS.hull,
  metal: MATS.metal,
  rust: MATS.rust,
  corrugated: MATS.corrugated,
  dark: stdMat(0x262b33, 0.45, 0.7),
  trim: stdMat(0x7a8390, 0.3, 0.9),
  white: stdMat(0xe4e9ef, 0.35, 0.2),
  hazard: stdMat(0xffffff, 0.6, 0, { map: hazardTex }),
  pipe: stdMat(0x9aa3ae, 0.3, 0.9),
  pipeRed: stdMat(0xc8323a, 0.4, 0.4),
  pipeBlue: stdMat(0x2f6fd0, 0.4, 0.4),
  ceilTrim: noShadow(stdMat(0x5a626d, 0.4, 0.8)),
  ceilDark: noShadow(stdMat(0x1c2026, 0.5, 0.6)),
  ceilPipe: noShadow(stdMat(0x8d96a1, 0.3, 0.9)),
  cockpit: stdMat(0x0d1a2a, 0.08, 0.9),
  light: glowMat(0xe6f4ff, 4),
  cyan: glowMat(0x38e1ff, 4),
  red: glowMat(0xff3040, 3),
  amber: glowMat(0xffa630, 3),
  green: glowMat(0x3dff9a, 3),
  core: glowMat(0x5fe8ff, 7),
  glass: noShadow(stdMat(0x8fd0ff, 0.05, 0.9, { transparent: true, opacity: 0.16, depthWrite: false })),
  shield: scenery(new THREE.MeshBasicMaterial({
    color: 0x3aa8ff, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  })),
  paintYellow: decalMaterial(null, { color: 0xffc81e, alphaMap: wornTex, roughness: 0.75 }),
  paintWhite: decalMaterial(null, { color: 0xf2f2f2, alphaMap: wornTex, roughness: 0.75 }),
  seam: noShadow(stdMat(0x2b2c2d, 0.95, 0, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })),
  grate: noShadow(stdMat(0xffffff, 0.45, 0.8, { map: grateTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
};
const CRATE_LABELS = [
  decalMaterial(textTexture(['ZERO-G', 'FRAGILE'], { fg: '#141414', font: 'bold 80px Impact, Arial Black, sans-serif' })),
  decalMaterial(textTexture(['PLASMA', 'CELLS'], { fg: '#141414', font: 'bold 80px Impact, Arial Black, sans-serif' })),
  decalMaterial(textTexture(['CARGO 07-B'], { fg: '#141414', font: 'bold 84px Impact, Arial Black, sans-serif' })),
];
const SIGNS = {
  hangar: signMat('HANGAR', 0xffd27a),
  cargo: signMat('CARGO BAY  A', 0x8fd8ff),
  reactor: signMat('REACTOR  B', 0x8fd8ff),
  bridge: signMat('BRIDGE  C', 0xff8a7a),
  engineering: signMat('ENGINEERING', 0xffb45a),
};

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 24),
  cylLow: new THREE.CylinderGeometry(1, 1, 1, 10),
  plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  wallPlane: new THREE.PlaneGeometry(1, 1),
  rib: new THREE.TorusGeometry(1, 0.05, 6, 32).rotateX(Math.PI / 2),
};

// Box helper: centre (x, y, z), size (w, h, d) and optional yaw, with world-scaled UVs.
function box(material, x, y, z, w, h, d, ry = 0, tile = 1) {
  deco(material, worldBox(w, h, d, tile), x, y, z, [0, ry, 0]);
}

// Decorated box that also blocks movement.
function block(material, x, z, w, h, d, y = 0, tile = 2) {
  box(material, x, y + h / 2, z, w, h, d, 0, tile);
  solidOnly(x, z, w, h, d, y);
}

function sign(material, x, y, z, ry, w = 2.8, h = 0.7) {
  deco(material, G.wallPlane, x, y, z, [0, ry, 0], [w, h, 1]);
}

// Wall frames: t runs along the wall, d is distance inward from its inner face; local +Z faces the arena.
const WALLS = [
  { ry: 0, at: (t, d) => [t, -ARENA + d] },
  { ry: Math.PI, at: (t, d) => [-t, ARENA - d] },
  { ry: Math.PI / 2, at: (t, d) => [-ARENA + d, -t] },
  { ry: -Math.PI / 2, at: (t, d) => [ARENA - d, t] },
];

function wallBox(wall, material, t, d, y, w, h, depth, tile = 1) {
  const [x, z] = wall.at(t, d);
  box(material, x, y, z, w, h, depth, wall.ry, tile);
}

function wallPart(wall, material, geo, t, d, y, rot = [0, 0, 0], scale = [1, 1, 1]) {
  const [x, z] = wall.at(t, d);
  decorEuler.set(rot[0], rot[1], rot[2]);
  const local = new THREE.Matrix4().compose(decorPos.set(0, 0, 0), decorQuat.setFromEuler(decorEuler), decorScale.set(...scale));
  const world = new THREE.Matrix4().makeRotationY(wall.ry).setPosition(x, y, z).multiply(local);
  decoMatrix(material, geo, world);
}

// ----- Outer hull with window openings [t0, t1] -----
function hullWall(wall, openings, { low = 1.5, high = 5.2, pane = DMAT.glass } = {}) {
  const L = ARENA * 2 + 2;
  if (low > 0) wallBox(wall, DMAT.hull, 0, -0.5, low / 2, L, low, 1, 4);
  wallBox(wall, DMAT.hull, 0, -0.5, (high + CEIL) / 2, L, CEIL - high, 1, 4);
  let t = -L / 2;
  for (const [a, b] of [...openings, [L / 2, L / 2]]) {
    if (a > t) wallBox(wall, DMAT.hull, (t + a) / 2, -0.5, (low + high) / 2, a - t, high - low, 1, 4);
    t = b;
  }
  const h = high - low;
  const cy = (low + high) / 2;
  for (const [a, b] of openings) {
    const c = (a + b) / 2;
    const w = b - a;
    wallPart(wall, pane, G.wallPlane, c, -0.45, cy, [0, 0, 0], [w, h, 1]);
    if (low > 0) {
      wallBox(wall, DMAT.trim, c, 0.06, low - 0.06, w + 0.4, 0.14, 0.3);
      wallBox(wall, DMAT.cyan, c, 0.22, low + 0.02, w, 0.03, 0.03);
    }
    wallBox(wall, DMAT.trim, c, 0.06, high + 0.06, w + 0.4, 0.14, 0.3);
    for (const s of [a - 0.1, b + 0.1]) wallBox(wall, DMAT.trim, s, 0.06, cy, 0.22, h + 0.2, 0.3);
    const n = Math.max(1, Math.round(w / 3.5));
    for (let i = 1; i < n; i++) wallBox(wall, DMAT.dark, a + (w * i) / n, -0.3, cy, 0.14, h, 0.14);
  }
}

// Ribs, conduits and wall furniture, kept clear of the [t0, t1] ranges in `avoid`.
function hullDetails(wall, avoid) {
  const L = ARENA * 2;
  const clear = (t, m) => !avoid.some(([a, b]) => t > a - m && t < b + m);
  wallBox(wall, DMAT.dark, 0, 0.06, 0.15, L, 0.3, 0.12, 2);
  wallBox(wall, DMAT.trim, 0, 0.12, CEIL - 0.35, L, 0.3, 0.24, 2);
  wallBox(wall, DMAT.cyan, 0, 0.245, CEIL - 0.35, L, 0.03, 0.01);
  wallPart(wall, DMAT.pipe, G.cylLow, 0, 0.35, CEIL - 0.85, [0, 0, Math.PI / 2], [0.09, L, 0.09]);
  wallPart(wall, DMAT.pipeBlue, G.cylLow, 0, 0.3, CEIL - 1.15, [0, 0, Math.PI / 2], [0.06, L, 0.06]);
  for (let t = -ARENA + 3; t < ARENA - 1; t += 6) {
    if (!clear(t, 0.5)) continue;
    wallBox(wall, DMAT.trim, t, 0.15, CEIL / 2, 0.5, CEIL, 0.3, 2);
    wallBox(wall, DMAT.dark, t, 0.31, CEIL / 2 - 0.3, 0.22, CEIL - 1.6, 0.04);
    wallBox(wall, DMAT.light, t, 0.335, 2.6, 0.06, 1.4, 0.02);
    for (const y of [0.5, CEIL - 1.6]) wallBox(wall, DMAT.dark, t, 0.33, y, 0.36, 0.12, 0.05);
  }
  for (let t = -ARENA + 6; t < ARENA - 2; t += 6) {
    if (!clear(t, 1.6)) continue;
    const r = rand();
    if (r < 0.35) {
      wallBox(wall, DMAT.dark, t, 0.04, 0.9, 1.2, 0.7, 0.08);
      for (let i = 0; i < 5; i++) wallBox(wall, DMAT.trim, t, 0.09, 0.66 + i * 0.12, 1.1, 0.03, 0.04);
    } else if (r < 0.65) {
      wallBox(wall, DMAT.dark, t, 0.05, 2.2, 1.5, 0.95, 0.1);
      wallPart(wall, screenMats[Math.floor(rand() * 3)], G.wallPlane, t, 0.105, 2.2, [0, 0, 0], [1.36, 0.82, 1]);
    } else {
      wallBox(wall, DMAT.white, t, 0.3, 1.1, 1.3, 2.2, 0.6);
      wallBox(wall, DMAT.dark, t, 0.61, 1.1, 0.02, 2.0, 0.02);
      wallBox(wall, DMAT.amber, t - 0.3, 0.61, 1.7, 0.08, 0.04, 0.02);
      wallBox(wall, DMAT.green, t + 0.3, 0.61, 1.7, 0.08, 0.04, 0.02);
      const [x, z] = wall.at(t, 0.3);
      const alongX = Math.abs(Math.sin(wall.ry)) < 0.5;
      solidOnly(x, z, alongX ? 1.3 : 0.6, 2.2, alongX ? 0.6 : 1.3);
    }
  }
}

// ----- Interior bulkheads with doorways centred at `doors` -----
function bulkhead(alongX, fixed, from, to, doors) {
  const T = 0.8;
  const at = (t) => (alongX ? [t, fixed] : [fixed, t]);
  const dims = (len, th) => (alongX ? [len, th] : [th, len]);
  const segs = [];
  let t = from;
  for (const c of doors) {
    segs.push([t, c - DOOR_W / 2]);
    t = c + DOOR_W / 2;
  }
  segs.push([t, to]);
  for (const [a, b] of segs) {
    if (b - a < 0.05) continue;
    const [x, z] = at((a + b) / 2);
    const [w, d] = dims(b - a, T);
    block(DMAT.hull, x, z, w, CEIL, d, 0, 4);
    const [bw, bd] = dims(b - a, T + 0.12);
    box(DMAT.dark, x, 0.15, z, bw, 0.3, bd);
    const [tw, td] = dims(b - a, T + 0.24);
    box(DMAT.trim, x, CEIL - 0.35, z, tw, 0.3, td);
    if (b - a > 1) {
      const [lw, ld] = dims(b - a - 0.6, T + 0.03);
      box(DMAT.cyan, x, 1.2, z, lw, 0.03, ld);
    }
    for (let r = a + 3; r < b - 1.5; r += 4) {
      const [rx, rz] = at(r);
      const [rw, rd] = dims(0.4, T + 0.2);
      box(DMAT.trim, rx, CEIL / 2, rz, rw, CEIL, rd);
    }
  }
  for (const c of doors) {
    const [x, z] = at(c);
    const [hw, hd] = dims(DOOR_W, T);
    block(DMAT.hull, x, z, hw, CEIL - DOOR_H, hd, DOOR_H, 4);
    for (const s of [-1, 1]) {
      const [px, pz] = at(c + s * (DOOR_W / 2 + 0.2));
      const [pw, pd] = dims(0.5, T + 0.4);
      box(DMAT.trim, px, DOOR_H / 2, pz, pw, DOOR_H, pd);
      const [sw, sd] = dims(0.52, T + 0.42);
      box(DMAT.hazard, px, 0.6, pz, sw, 1.0, sd, 0, 0.5);
      const [gx, gz] = at(c + s * (DOOR_W / 2 - 0.02));
      const [gw, gd] = dims(0.06, T + 0.44);
      box(DMAT.cyan, gx, 2.3, gz, gw, 1.6, gd);
    }
    const [lw, ld] = dims(DOOR_W + 0.9, T + 0.4);
    box(DMAT.trim, x, DOOR_H + 0.2, z, lw, 0.4, ld);
    const [aw, ad] = dims(DOOR_W * 0.7, T + 0.44);
    box(DMAT.amber, x, DOOR_H + 0.08, z, aw, 0.05, ad);
    const [fw, fd] = dims(DOOR_W, T + 0.6);
    box(DMAT.dark, x, 0.01, z, fw, 0.02, fd);
  }
}

function ceilingDetails() {
  for (let z = -27; z <= 27; z += 6) box(DMAT.ceilTrim, 0, CEIL - 0.2, z, ARENA * 2, 0.4, 0.4);
  for (const x of [-20, 0, 20]) {
    for (let z = -24; z <= 24; z += 6) {
      if (x === 0 && Math.abs(z - 3) < 3) continue;
      box(DMAT.ceilDark, x, CEIL - 0.04, z, 3.0, 0.08, 0.9);
      box(DMAT.light, x, CEIL - 0.09, z, 2.6, 0.04, 0.55);
    }
  }
  for (const x of [-10.5, 10.5]) {
    deco(DMAT.ceilPipe, G.cylLow, x, CEIL - 0.7, 0, [Math.PI / 2, 0, 0], [0.14, ARENA * 2, 0.14]);
    deco(DMAT.ceilPipe, G.cylLow, x + 0.4, CEIL - 0.75, 0, [Math.PI / 2, 0, 0], [0.08, ARENA * 2, 0.08]);
  }
}

function floorDetails() {
  for (let v = -28; v <= 28; v += 4) {
    deco(DMAT.seam, G.plane, v, 0.003, 0, [0, 0, 0], [0.04, 1, ARENA * 2]);
    deco(DMAT.seam, G.plane, 0, 0.003, v, [0, 0, 0], [ARENA * 2, 1, 0.04]);
  }
  const grates = (x, z, n, alongX) => {
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * 1.2;
      deco(DMAT.grate, G.plane, x + (alongX ? o : 0), 0.005, z + (alongX ? 0 : o), [0, 0, 0], [1.1, 1, 1.1]);
    }
  };
  grates(0, 19.2, 9, true);
  grates(19.5, 3, 9, false);
  grates(0, -13.2, 5, true);
  grates(-26, -20, 6, false);
  grates(26, -20, 6, false);
  for (let x = -11; x <= 11; x += 2) box(DMAT.cyan, x, 0.015, 28.6, 0.5, 0.03, 0.12);
  for (const z of [20.5, 28]) deco(DMAT.paintYellow, G.plane, 0, 0.004, z, [0, 0, 0], [56, 1, 0.12]);
  for (const s of [-1, 1]) {
    deco(DMAT.paintWhite, G.plane, -19.5 + s * 5.2, 0.004, 24.5, [0, 0, 0], [0.15, 1, 7]);
    deco(DMAT.paintWhite, G.plane, -19.5, 0.004, 24.5 + s * 3.5, [0, 0, 0], [10.4, 1, 0.15]);
  }
}

// ----- Props -----
function crate(x, z, s, y = 0) {
  const k = Math.floor(rand() * 3);
  const e = s * 0.08;
  box(MATS.crates[k], x, y + s / 2, z, s * 0.94, s * 0.94, s * 0.94, 0, s);
  solidOnly(x, z, s, s, s, y);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) box(DMAT.dark, x + sx * (s / 2 - e / 2), y + s / 2, z + sz * (s / 2 - e / 2), e, s, e);
  }
  for (const yy of [y + e / 2, y + s - e / 2]) {
    for (const sz of [-1, 1]) box(DMAT.dark, x, yy, z + sz * (s / 2 - e / 2), s, e, e);
    for (const sx of [-1, 1]) box(DMAT.dark, x + sx * (s / 2 - e / 2), yy, z, e, e, s);
  }
  box(k === 1 ? DMAT.cyan : DMAT.amber, x, y + s * 0.78, z, s * 0.6, s * 0.03, s * 0.95);
  for (const sz of [-1, 1]) {
    deco(CRATE_LABELS[k], G.wallPlane, x, y + s * 0.42, z + sz * (s * 0.47 + 0.004), [0, sz > 0 ? 0 : Math.PI, 0], [s * 0.6, s * 0.3, 1]);
  }
}

// Wall-standing console; front (screen side) faces local +Z rotated by ry.
function consoleAt(x, z, ry, w = 1.6, screen = 0) {
  const at = (lx, lz) => [x + lx * Math.cos(ry) + lz * Math.sin(ry), z - lx * Math.sin(ry) + lz * Math.cos(ry)];
  box(DMAT.dark, x, 0.45, z, w, 0.9, 0.7, ry);
  const [dx, dz] = at(0, 0.08);
  deco(DMAT.white, G.box, dx, 0.97, dz, [-0.35, ry, 0, 'YXZ'], [w + 0.1, 0.08, 0.8]);
  const [bx, bz] = at(0, 0.3);
  deco(DMAT.amber, G.box, bx, 0.99, bz, [-0.35, ry, 0, 'YXZ'], [w * 0.6, 0.03, 0.05]);
  const [mx, mz] = at(0, -0.28);
  box(DMAT.dark, mx, 1.4, mz, w * 0.92, 0.62, 0.06, ry);
  const [sx, sz] = at(0, -0.245);
  deco(screenMats[screen], G.wallPlane, sx, 1.4, sz, [0, ry, 0], [w * 0.85, 0.54, 1]);
  const hw = Math.abs((w / 2) * Math.cos(ry)) + Math.abs(0.4 * Math.sin(ry));
  const hd = Math.abs((w / 2) * Math.sin(ry)) + Math.abs(0.4 * Math.cos(ry));
  solidOnly(x, z, hw * 2, 1.1, hd * 2);
}

const consoleFacing = (x, z, tx, tz, screen) => consoleAt(x, z, Math.atan2(tx - x, tz - z), 1.6, screen);

function barrier(x, z, len, alongX) {
  const [w, d] = alongX ? [len, 0.6] : [0.6, len];
  block(DMAT.hull, x, z, w, 1.15, d, 0, 2);
  box(DMAT.dark, x, 0.15, z, w + 0.06, 0.3, d + 0.06);
  box(DMAT.trim, x, 1.18, z, w + 0.04, 0.08, d + 0.04);
  box(DMAT.hazard, x, 0.6, z, w + 0.02, 0.18, d + 0.02, 0, 0.5);
  box(DMAT.cyan, x, 1.225, z, alongX ? len - 0.3 : 0.06, 0.02, alongX ? 0.06 : len - 0.3);
}

function reactor(x, z) {
  solidOnly(x, z, 3, CEIL, 3);
  deco(DMAT.dark, G.cyl, x, 0.4, z, [0, 0, 0], [2.0, 0.8, 2.0]);
  deco(DMAT.trim, G.cyl, x, 0.9, z, [0, 0, 0], [1.6, 0.2, 1.6]);
  deco(DMAT.core, G.cyl, x, CEIL / 2, z, [0, 0, 0], [0.7, CEIL - 1.6, 0.7]);
  deco(DMAT.glass, G.cyl, x, CEIL / 2, z, [0, 0, 0], [1.05, CEIL - 1.6, 1.05]);
  for (let y = 1.4; y < CEIL - 1; y += 0.9) deco(DMAT.trim, G.rib, x, y, z, [0, 0, 0], [1.1, 2, 1.1]);
  for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    box(DMAT.trim, x + sx * 1.3, CEIL / 2, z + sz * 1.3, 0.25, CEIL, 0.25);
    box(DMAT.dark, x + sx * 2.6, 0.06, z + sz * 2.6, sx ? 2.2 : 0.5, 0.12, sz ? 2.2 : 0.5);
    box(DMAT.cyan, x + sx * 2.6, 0.125, z + sz * 2.6, sx ? 2.2 : 0.08, 0.01, sz ? 2.2 : 0.08);
  }
  deco(DMAT.dark, G.cyl, x, CEIL - 0.4, z, [0, 0, 0], [1.8, 0.8, 1.8]);
  deco(DMAT.amber, G.cylLow, x, CEIL - 0.85, z, [0, 0, 0], [1.81, 0.05, 1.81]);
}

function generator(x, z, alongX) {
  const [w, d] = alongX ? [3.2, 2] : [2, 3.2];
  block(DMAT.rust, x, z, w, 2.4, d, 0, 2);
  box(DMAT.dark, x, 2.5, z, w - 0.3, 0.2, d - 0.3);
  box(DMAT.hazard, x, 0.15, z, w + 0.04, 0.3, d + 0.04, 0, 0.5);
  for (let i = 0; i < 4; i++) {
    box(DMAT.amber, x, 0.8 + i * 0.3, z, alongX ? w * 0.5 : w + 0.02, 0.06, alongX ? d + 0.02 : d * 0.5);
  }
  for (const o of [-0.6, 0.6]) {
    const px = x + (alongX ? o : 0);
    const pz = z + (alongX ? 0 : o);
    deco(DMAT.pipeRed, G.cylLow, px, (2.4 + CEIL) / 2, pz, [0, 0, 0], [0.12, CEIL - 2.4, 0.12]);
  }
}

function tank(x, z, r = 0.8, h = 3.2) {
  solidOnly(x, z, r * 2, h, r * 2);
  deco(DMAT.pipeBlue, G.cyl, x, h / 2, z, [0, 0, 0], [r, h, r]);
  deco(DMAT.dark, G.cyl, x, 0.15, z, [0, 0, 0], [r + 0.08, 0.3, r + 0.08]);
  deco(DMAT.dark, G.cyl, x, h + 0.1, z, [0, 0, 0], [r * 0.8, 0.2, r * 0.8]);
  for (const y of [0.9, 2.2]) deco(DMAT.trim, G.rib, x, y, z, [0, 0, 0], [r + 0.02, 1, r + 0.02]);
  deco(DMAT.green, G.cylLow, x, 1.55, z, [0, 0, 0], [r + 0.01, 0.08, r + 0.01]);
  deco(DMAT.pipe, G.cylLow, x, (h + CEIL) / 2, z, [0, 0, 0], [0.15, CEIL - h, 0.15]);
}

// Docked dropship, nose towards +X.
function shuttle(cx, cz) {
  const L = 8;
  const W = 3.4;
  solidOnly(cx, cz, L, 2.9, W);
  solidOnly(cx - 0.8, cz, 3, 0.16, W + 4.4, 2.42);
  box(DMAT.white, cx - 0.4, 1.75, cz, L - 1.6, 1.9, W);
  deco(DMAT.white, G.box, cx + L / 2 - 1.1, 1.55, cz, [0, 0, -0.35], [2.2, 1.4, W * 0.9]);
  deco(DMAT.cockpit, G.box, cx + L / 2 - 1.0, 2.15, cz, [0, 0, -0.6], [1.3, 0.06, W * 0.7]);
  box(DMAT.pipeBlue, cx - 0.4, 1.35, cz, L - 1.58, 0.18, W + 0.02);
  box(DMAT.dark, cx - 0.4, 2.72, cz, L - 2.4, 0.12, W - 0.6);
  for (const s of [-1, 1]) {
    deco(DMAT.dark, G.cyl, cx - L / 2 + 0.2, 1.7, cz + s * 0.9, [0, 0, Math.PI / 2], [0.55, 1.4, 0.55]);
    deco(DMAT.cyan, G.cyl, cx - L / 2 - 0.51, 1.7, cz + s * 0.9, [0, 0, Math.PI / 2], [0.45, 0.04, 0.45]);
    box(DMAT.dark, cx + 0.8, 1.7, cz + s * (W / 2 + 0.005), 1.6, 1.3, 0.02);
    box(DMAT.hazard, cx + 0.8, 2.42, cz + s * (W / 2 + 0.01), 1.6, 0.1, 0.02, 0, 0.5);
    box(s > 0 ? DMAT.green : DMAT.red, cx - 0.8, 2.5, cz + s * (W / 2 + 2.2), 0.3, 0.12, 0.12);
    for (const fx of [-2.5, 2]) {
      box(DMAT.dark, cx + fx, 0.4, cz + s * 1.2, 0.2, 0.8, 0.2);
      box(DMAT.trim, cx + fx, 0.04, cz + s * 1.2, 0.6, 0.08, 0.6);
    }
  }
  box(DMAT.trim, cx - 0.8, 2.5, cz, 3, 0.15, W + 4.4);
}

// ----- Layout: hangar (south), cargo bay A (west), reactor B (centre), engineering (east), bridge C (north) -----
const SIDE_WINDOWS = {
  west: [[-27, -20], [-14, -6], [-2, 6], [14, 22]],
  east: [[-26, -18], [-6, 2], [6, 14], [20, 27]],
};
hullWall(WALLS[0], [[-14, 14]], { low: 1.2, high: 6.0 });
hullWall(WALLS[1], [[-12, 12]], { low: 0, high: 5.8, pane: DMAT.shield });
hullWall(WALLS[2], SIDE_WINDOWS.west);
hullWall(WALLS[3], SIDE_WINDOWS.east);
solidOnly(0, -ARENA - 0.5, ARENA * 2 + 2, CEIL, 1);
solidOnly(0, ARENA + 0.5, ARENA * 2 + 2, CEIL, 1);
solidOnly(-ARENA - 0.5, 0, 1, CEIL, ARENA * 2);
solidOnly(ARENA + 0.5, 0, 1, CEIL, ARENA * 2);
const pad = (list, m) => list.map(([a, b]) => [a - m, b + m]);
hullDetails(WALLS[0], [[-14.4, 14.4]]);
hullDetails(WALLS[1], [[-12.4, 12.4]]);
hullDetails(WALLS[2], [...pad(SIDE_WINDOWS.west, 0.4), [-17.6, -16.4], [10.4, 11.6]]);
hullDetails(WALLS[3], [...pad(SIDE_WINDOWS.east, 0.4), [16.4, 17.6], [-11.6, -10.4]]);
wallBox(WALLS[1], DMAT.hazard, 0, 0.1, 6.0, 25, 0.3, 0.2, 0.6);
for (const t of [-12.4, 12.4]) wallBox(WALLS[1], DMAT.hazard, t, 0.1, 2.9, 0.3, 5.8, 0.2, 0.6);

bulkhead(true, 17, -ARENA, ARENA, [-20, 0, 20]);
bulkhead(true, -11, -ARENA, ARENA, [-18, 0, 18]);
bulkhead(false, -9, -10.6, 16.6, [-4, 10]);
bulkhead(false, 9, -10.6, 16.6, [-2, 8]);

const SIGN_Y = DOOR_H + 1.1;
[[-20, SIGNS.cargo], [0, SIGNS.reactor], [20, SIGNS.engineering]].forEach(([x, m]) => {
  sign(m, x, SIGN_Y, 17.42, 0);
  sign(SIGNS.hangar, x, SIGN_Y, 16.58, Math.PI);
});
[[-18, SIGNS.cargo], [0, SIGNS.reactor], [18, SIGNS.engineering]].forEach(([x, m]) => {
  sign(SIGNS.bridge, x, SIGN_Y, -10.58, 0);
  sign(m, x, SIGN_Y, -11.42, Math.PI);
});
for (const z of [-4, 10]) {
  sign(SIGNS.cargo, -8.58, SIGN_Y, z, Math.PI / 2);
  sign(SIGNS.reactor, -9.42, SIGN_Y, z, -Math.PI / 2);
}
for (const z of [-2, 8]) {
  sign(SIGNS.engineering, 8.58, SIGN_Y, z, -Math.PI / 2);
  sign(SIGNS.reactor, 9.42, SIGN_Y, z, Math.PI / 2);
}

// Hangar
shuttle(-19.5, 24.5);
for (const [x, z, s, y = 0] of [
  [17, 21.5, 1.6], [18.7, 21.5, 1.6], [17.8, 21.5, 1.4, 1.6], [24, 26.5, 2], [21.8, 27, 1.4], [9, 28, 1.4], [-9, 28, 1.4], [26.5, 20, 1.2],
]) crate(x, z, s, y);
// Cargo bay
for (const [x, z, s, y = 0] of [
  [-25.5, 9, 2], [-23.3, 9.3, 1.4], [-25.5, 9, 1.4, 2], [-13.5, -3, 1.6], [-15.2, -3, 1.6], [-14.3, -3, 1.4, 1.6],
  [-26, -5, 1.8], [-24, -6.5, 1.2], [-13.5, 10.5, 1.4], [-19.5, 12.5, 1.6], [-27.5, 2, 1.4], [-19.5, -7, 1.6], [-12, 4, 1.2],
]) crate(x, z, s, y);
// Reactor room
reactor(0, 3);
barrier(-5.5, 3, 3, false);
barrier(5.5, 3, 3, false);
barrier(0, -4.5, 3.5, true);
barrier(0, 10.5, 3.5, true);
for (const [x, z] of [[-6.5, -8.5], [6.5, -8.5], [-6.5, 14.5], [6.5, 14.5]]) consoleFacing(x, z, 0, 3, 0);
// Engineering
generator(17, 10, true);
generator(23, -4, false);
tank(14, -7);
tank(26.5, 12.5);
tank(26.5, 9.6, 0.7, 2.8);
tank(27, -8, 0.9, 3.6);
crate(20.5, 14.5, 1.4);
crate(13, 2.5, 1.6);
barrier(20, 4, 3, true);
consoleFacing(13, 13, 17, 10, 1);
// Bridge
for (const x of [-9, 9]) {
  block(DMAT.hull, x, -20, 1.4, CEIL, 1.4, 0, 2);
  box(DMAT.trim, x, 0.2, -20, 1.6, 0.4, 1.6);
  box(DMAT.trim, x, CEIL - 0.3, -20, 1.6, 0.6, 1.6);
  box(DMAT.cyan, x, 2.5, -20, 1.44, 0.04, 1.44);
}
solidOnly(0, -20, 1.4, 1.0, 1.4);
deco(DMAT.dark, G.cyl, 0, 0.5, -20, [0, 0, 0], [0.7, 1.0, 0.7]);
deco(DMAT.cyan, G.cylLow, 0, 1.02, -20, [0, 0, 0], [0.62, 0.04, 0.62]);
barrier(-5, -14.5, 3, true);
barrier(5, -14.5, 3, true);
for (const [x, s] of [[-10, 0], [-5, 2], [5, 2], [10, 0]]) consoleAt(x, -27.5, 0, 1.6, s);
consoleFacing(-3.8, -23.2, 0, -20, 0);
consoleFacing(3.8, -23.2, 0, -20, 1);
for (const [x, z, s] of [[-22, -17, 1.6], [-24, -16.5, 1.2], [22, -17, 1.6], [24, -16.5, 1.2], [-15, -25, 1.4], [15, -25, 1.4], [-27.5, -13.5, 1.4], [27.5, -13.5, 1.4]]) {
  crate(x, z, s);
}

ceilingDetails();
floorDetails();
finalizeDecor();

// Animated set dressing.
const spinners = [];
{
  const holoMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x38e1ff).multiplyScalar(1.6), wireframe: true, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const hull = new THREE.OctahedronGeometry(0.5, 1).scale(0.45, 0.22, 1.2);
  const wings = new THREE.BoxGeometry(1.1, 0.03, 0.4).translate(0, 0, 0.2);
  const holo = new THREE.Mesh(mergeGeometries([hull.toNonIndexed(), wings.toNonIndexed()]), holoMat);
  holo.position.set(0, 1.75, -20);
  scene.add(holo);
  spinners.push({ mesh: holo, speed: 0.6 });
  const ringMat = holoMat.clone();
  ringMat.opacity = 0.35;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.01, 4, 48).rotateX(Math.PI / 2), ringMat);
  ring.position.set(0, 1.3, -20);
  scene.add(ring);
}

// ---------- Collision helpers ----------
function circleOverlapsBox(x, z, r, b) {
  const cx = Math.max(b.min.x, Math.min(x, b.max.x));
  const cz = Math.max(b.min.z, Math.min(z, b.max.z));
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < r * r;
}

// Push a circle (pos.x, pos.z) out of every solid overlapping the vertical span [y0, y1].
function pushOut(pos, r, y0, y1) {
  for (const b of solids) {
    if (b.max.y <= y0 + 0.01 || b.min.y >= y1) continue;
    const cx = Math.max(b.min.x, Math.min(pos.x, b.max.x));
    const cz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
    let dx = pos.x - cx;
    let dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      pos.x = cx + (dx / d) * r;
      pos.z = cz + (dz / d) * r;
    } else {
      // Centre is inside the box: push along the axis of least penetration.
      const pen = [
        [pos.x - b.min.x + r, -1, 0],
        [b.max.x - pos.x + r, 1, 0],
        [pos.z - b.min.z + r, 0, -1],
        [b.max.z - pos.z + r, 0, 1],
      ].sort((a, c) => a[0] - c[0])[0];
      pos.x += pen[1] * pen[0];
      pos.z += pen[2] * pen[0];
    }
  }
}

function groundHeight(x, z, r, feet) {
  let h = 0;
  for (const b of solids) {
    if (b.max.y <= feet + 0.05 && b.max.y > h && circleOverlapsBox(x, z, r * 0.9, b)) h = b.max.y;
  }
  return h;
}

// ---------- Navigation grid (A*) ----------
const NAV_SIZE = ARENA * 2;
const navBlocked = new Uint8Array(NAV_SIZE * NAV_SIZE);
const cellCenter = (i) => -ARENA + i + 0.5;
const toCell = (v) => Math.max(0, Math.min(NAV_SIZE - 1, Math.floor(v + ARENA)));

for (let iz = 0; iz < NAV_SIZE; iz++) {
  for (let ix = 0; ix < NAV_SIZE; ix++) {
    const x = cellCenter(ix);
    const z = cellCenter(iz);
    navBlocked[iz * NAV_SIZE + ix] = solids.some((b) => b.min.y < 2.3 && circleOverlapsBox(x, z, ENEMY_RADIUS + 0.1, b)) ? 1 : 0;
  }
}

function nearestOpenCell(ix, iz) {
  if (!navBlocked[iz * NAV_SIZE + ix]) return iz * NAV_SIZE + ix;
  for (let r = 1; r < 6; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = ix + dx;
        const z = iz + dz;
        if (x < 0 || z < 0 || x >= NAV_SIZE || z >= NAV_SIZE) continue;
        if (!navBlocked[z * NAV_SIZE + x]) return z * NAV_SIZE + x;
      }
    }
  }
  return -1;
}

const navG = new Float32Array(NAV_SIZE * NAV_SIZE);
const navFrom = new Int32Array(NAV_SIZE * NAV_SIZE);
const navStamp = new Uint32Array(NAV_SIZE * NAV_SIZE);
const navClosed = new Uint32Array(NAV_SIZE * NAV_SIZE);
let navSearch = 0;
const NEIGHBORS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

// Returns a list of {x, z} waypoints from (sx, sz) to (tx, tz), or null.
function findPath(sx, sz, tx, tz) {
  const start = nearestOpenCell(toCell(sx), toCell(sz));
  const goal = nearestOpenCell(toCell(tx), toCell(tz));
  if (start < 0 || goal < 0) return null;
  navSearch++;
  const gx = goal % NAV_SIZE;
  const gz = Math.floor(goal / NAV_SIZE);
  const h = (i) => {
    const dx = Math.abs((i % NAV_SIZE) - gx);
    const dz = Math.abs(Math.floor(i / NAV_SIZE) - gz);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  // Binary heap of [f, index]
  const heap = [[h(start), start]];
  navG[start] = 0;
  navFrom[start] = -1;
  navStamp[start] = navSearch;
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  while (heap.length) {
    const [, cur] = pop();
    if (navClosed[cur] === navSearch) continue;
    navClosed[cur] = navSearch;
    if (cur === goal) break;
    const cx = cur % NAV_SIZE;
    const cz = Math.floor(cur / NAV_SIZE);
    for (const [dx, dz, cost] of NEIGHBORS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= NAV_SIZE || nz >= NAV_SIZE) continue;
      const n = nz * NAV_SIZE + nx;
      if (navBlocked[n]) continue;
      if (dx && dz && (navBlocked[cz * NAV_SIZE + nx] || navBlocked[nz * NAV_SIZE + cx])) continue;
      const g = navG[cur] + cost;
      if (navStamp[n] === navSearch && g >= navG[n]) continue;
      navStamp[n] = navSearch;
      navG[n] = g;
      navFrom[n] = cur;
      push([g + h(n), n]);
    }
  }
  if (navClosed[goal] !== navSearch) return null;
  const path = [];
  for (let i = goal; i !== start && i >= 0; i = navFrom[i]) {
    path.push({ x: cellCenter(i % NAV_SIZE), z: cellCenter(Math.floor(i / NAV_SIZE)) });
  }
  path.reverse();
  return path;
}

const raycaster = new THREE.Raycaster();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

function slab(o, d, mn, mx, range) {
  if (Math.abs(d) < 1e-9) return o >= mn && o <= mx;
  let a = (mn - o) / d;
  let b = (mx - o) / d;
  if (a > b) {
    const t = a;
    a = b;
    b = t;
  }
  if (a > range[0]) range[0] = a;
  if (b < range[1]) range[1] = b;
  return range[0] <= range[1];
}

// True if the segment passes through any collision box (bot line of sight).
const segRange = [0, 1];
function segmentBlocked(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  for (const b of solids) {
    segRange[0] = 0;
    segRange[1] = 1;
    if (slab(from.x, dx, b.min.x, b.max.x, segRange) && slab(from.y, dy, b.min.y, b.max.y, segRange)
      && slab(from.z, dz, b.min.z, b.max.z, segRange)) return true;
  }
  return false;
}

// ---------- Audio ----------
let audio = null;
let noiseBuffer = null;

function initAudio() {
  if (audio) return;
  audio = new (window.AudioContext || window.webkitAudioContext)();
  noiseBuffer = audio.createBuffer(1, audio.sampleRate * 0.4, audio.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

function playNoise(volume, freq, duration) {
  if (!audio) return;
  const src = audio.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = freq;
  const gain = audio.createGain();
  const t = audio.currentTime;
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  src.connect(filter).connect(gain).connect(audio.destination);
  src.start(t);
  src.stop(t + duration);
}

function playTone(volume, f0, f1, duration, type = 'sine') {
  if (!audio) return;
  const osc = audio.createOscillator();
  osc.type = type;
  const gain = audio.createGain();
  const t = audio.currentTime;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + duration);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + duration);
}

const later = (ms, fn) => setTimeout(fn, ms);
const click = (vol = 0.1, freq = 3200) => playNoise(vol, freq, 0.035);

const sfx = {
  shot: (s) => { playNoise(s.vol * 0.7, s.freq, s.dur * 0.6); playTone(s.vol * 0.7, s.tone, s.toneEnd, s.dur, 'sawtooth'); },
  pump: () => { later(200, () => click(0.14, 2200)); later(420, () => click(0.16, 2600)); },
  bolt: () => { later(250, () => click(0.1, 3000)); later(420, () => click(0.12, 2400)); later(650, () => click(0.12, 2600)); later(850, () => click(0.1, 3000)); },
  magOut: () => click(0.1, 2000),
  magIn: () => click(0.14, 2800),
  rack: () => { click(0.12, 3000); later(90, () => click(0.12, 2400)); },
  shellIn: () => playTone(0.08, 700, 480, 0.05, 'square'),
  switch: () => { click(0.08, 1800); later(120, () => click(0.06, 2600)); },
  botShot: (dist, team) => {
    const v = Math.max(0.02, 0.2 - dist * 0.005);
    playNoise(v * 0.5, 3000, 0.08);
    playTone(v, team === 1 ? 1500 : 900, team === 1 ? 400 : 200, 0.12, 'sawtooth');
  },
  capture: () => { playTone(0.12, 660, 660, 0.12); later(130, () => playTone(0.12, 880, 880, 0.12)); later(260, () => playTone(0.14, 1320, 1320, 0.2)); },
  lost: () => { playTone(0.12, 520, 520, 0.15); later(170, () => playTone(0.12, 390, 390, 0.25, 'triangle')); },
  hit: () => playTone(0.12, 900, 600, 0.06, 'square'),
  kill: () => playTone(0.15, 500, 120, 0.25, 'sawtooth'),
  hurt: () => playTone(0.3, 140, 60, 0.2, 'sine'),
  empty: () => playTone(0.06, 1200, 1100, 0.03, 'square'),
  pickup: () => { playTone(0.12, 520, 780, 0.12); setTimeout(() => playTone(0.12, 780, 1040, 0.12), 90); },
};

// ---------- Weapons ----------
// The viewmodel lives in its own scene so it never clips into walls.
const gunMat = new THREE.MeshStandardMaterial({ color: COLORS.gun, roughness: 0.45, metalness: 0.8 });
const weaponScene = new THREE.Scene();
weaponScene.environment = envMap;
weaponScene.environmentIntensity = 0.45;
const weaponCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 10);
weaponScene.add(new THREE.HemisphereLight(0xb8ccff, 0x30343c, 0.45));
const vmKey = new THREE.DirectionalLight(0xe8f0ff, 2.2);
vmKey.position.set(-1, 2, 1.5);
weaponScene.add(vmKey);
const vmRim = new THREE.DirectionalLight(0xcfe2ff, 0.9);
vmRim.position.set(1.5, 0.6, -1);
weaponScene.add(vmRim);
const viewmodel = new THREE.Group();
weaponScene.add(viewmodel);

const flash = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }),
);
flash.rotation.y = Math.PI;
flash.visible = false;
const flashLight = new THREE.PointLight(0xffc98a, 0, 1.5);
const worldFlash = new THREE.PointLight(0xffc98a, 0, 10);
scene.add(worldFlash);

const WHITE = new THREE.Color(0xffffff);
const arsenal = WEAPONS.map((def) => {
  const model = buildWeaponModel(def);
  model.group.visible = false;
  viewmodel.add(model.group);
  model.glowBase = model.glow ? model.glow.emissiveIntensity : 0;
  return { def, model, mag: def.magSize, reserve: def.reserve };
});

function equip(index) {
  const w = arsenal[index];
  for (const a of arsenal) a.model.group.visible = a === w;
  w.model.group.add(flash, flashLight);
  flash.position.copy(w.model.muzzle);
  flash.position.z -= 0.01;
  flash.scale.setScalar(w.def.flash * 2);
  flashLight.position.copy(w.model.muzzle);
  const tint = new THREE.Color(w.def.color);
  flash.material.color.copy(tint).lerp(WHITE, 0.35);
  flashLight.color.copy(tint);
  worldFlash.color.copy(tint);
  player.current = index;
  player.ejectAt = 0;
  resetParts(w);
}

function resetParts(w) {
  for (const part of Object.values(w.model.parts)) {
    part.position.copy(part.userData.rest);
    part.rotation.copy(part.userData.restRot);
  }
  if (w.model.parts.shell) w.model.parts.shell.visible = false;
  if (w.model.parts.mag) w.model.parts.mag.visible = true;
}

// ---------- Effects ----------
const effects = [];
const puffTex = canvasTexture(64, (g, s) => {
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
});

function spawnSprite(point, color, size, life, vel, extra = {}) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color, transparent: true, depthWrite: false, ...extra.mat }));
  sprite.position.copy(point);
  sprite.scale.setScalar(size);
  scene.add(sprite);
  effects.push({ mesh: sprite, life, max: life, base: size, vel, ...extra.fx });
}

function spawnImpact(point, color, normal = null, sparks = false, sparkColor = 0xffc46a) {
  const n = normal || new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 4; i++) {
    const vel = n.clone().multiplyScalar(0.4 + Math.random() * 0.8)
      .add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(0.6));
    spawnSprite(point.clone().addScaledVector(n, 0.03), color, 0.12, 0.5 + Math.random() * 0.4, vel, { fx: { grow: 3.5, opacity: 0.75 } });
  }
  if (!sparks) return;
  for (let i = 0; i < 6; i++) {
    const vel = n.clone().multiplyScalar(2 + Math.random() * 3)
      .add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).multiplyScalar(4));
    spawnSprite(point, sparkColor, 0.035, 0.12 + Math.random() * 0.12, vel, { mat: { blending: THREE.AdditiveBlending }, fx: { gravity: 9.8 } });
  }
}

const casingGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
const casingMats = {
  cell: new THREE.MeshStandardMaterial({ color: 0x9aa3ae, roughness: 0.3, metalness: 1, emissive: 0x38e1ff, emissiveIntensity: 0.6 }),
  hull: new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.4, metalness: 0.6, emissive: 0xff8a2a, emissiveIntensity: 0.8 }),
};
// Spent energy cells vented from each weapon: [radius, length].
const CASINGS = { ion: [0.006, 0.02], pulse: [0.006, 0.024], plasma: [0.008, 0.035], scatter: [0.011, 0.05], rail: [0.008, 0.06] };

function ejectCasing(w) {
  const [r, len] = CASINGS[w.def.id];
  const mesh = new THREE.Mesh(casingGeo, w.def.id === 'scatter' ? casingMats.hull : casingMats.cell);
  mesh.scale.set(r, len, r);
  mesh.rotation.set(Math.random() * 3, 0, Math.PI / 2);
  mesh.frustumCulled = false;
  w.model.group.localToWorld(mesh.position.set(0.02, w.model.muzzle.y - 0.005, w.model.muzzle.z * 0.3));
  weaponScene.add(mesh);
  const vel = new THREE.Vector3(1.3 + Math.random() * 0.6, 1.1 + Math.random() * 0.5, 0.2 + Math.random() * 0.3);
  effects.push({ mesh, life: 0.6, max: 0.6, vel, gravity: 9.8, spin: 25, shared: true });
}

const decals = [];
const decalGeo = new THREE.PlaneGeometry(0.09, 0.09);
const decalMat = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(8,6,5,1)');
  grad.addColorStop(0.3, 'rgba(25,20,16,0.95)');
  grad.addColorStop(0.55, 'rgba(60,50,40,0.5)');
  grad.addColorStop(1, 'rgba(60,50,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({
    map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1,
  });
})();
const decalNormal = new THREE.Vector3();

function spawnDecal(hit) {
  if (!hit.face) return;
  decalNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
  const mesh = new THREE.Mesh(decalGeo, decalMat);
  mesh.position.copy(hit.point).addScaledVector(decalNormal, 0.004);
  mesh.lookAt(tmpV.copy(mesh.position).add(decalNormal));
  mesh.rotation.z = Math.random() * Math.PI * 2;
  mesh.scale.setScalar(0.7 + Math.random() * 0.6);
  scene.add(mesh);
  decals.push(mesh);
  if (decals.length > 120) scene.remove(decals.shift());
}

function clearDecals() {
  for (const d of decals) scene.remove(d);
  decals.length = 0;
}

const boltGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
const UP = new THREE.Vector3(0, 1, 0);
const boltDir = new THREE.Vector3();

// Glowing energy bolt from one point to another.
function spawnBolt(from, to, color, radius = 0.016, life = 0.07) {
  boltDir.subVectors(to, from);
  const len = boltDir.length();
  if (len < 0.01) return;
  const mesh = new THREE.Mesh(boltGeo, new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(2.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(UP, boltDir.divideScalar(len));
  mesh.scale.set(radius, len, radius);
  mesh.frustumCulled = false;
  scene.add(mesh);
  effects.push({ mesh, life, max: life });
}

function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life -= dt;
    const k = Math.max(0, e.life / e.max);
    if (!e.shared) e.mesh.material.opacity = k * (e.opacity ?? 1);
    if (e.grow) e.mesh.scale.setScalar((e.base || 1) * (1 + (1 - k) * e.grow));
    if (e.vel) {
      if (e.gravity) e.vel.y -= e.gravity * dt;
      else e.vel.multiplyScalar(Math.max(0, 1 - dt * 3));
      e.mesh.position.addScaledVector(e.vel, dt);
    }
    if (e.spin) e.mesh.rotation.x += e.spin * dt;
    if (e.life <= 0) {
      e.mesh.removeFromParent();
      if (e.ownGeo) e.mesh.geometry.dispose();
      if (!e.shared) e.mesh.material.dispose();
      effects.splice(i, 1);
    }
  }
}

// ---------- Soldiers (allied and hostile bots) ----------
const bots = [];
const GEO = {
  torso: new THREE.CapsuleGeometry(0.19, 0.32, 6, 16),
  pelvis: new THREE.CapsuleGeometry(0.15, 0.12, 4, 12),
  vest: new THREE.BoxGeometry(0.44, 0.44, 0.3),
  neck: new THREE.CylinderGeometry(0.055, 0.065, 0.12, 12),
  head: new THREE.SphereGeometry(0.125, 20, 16),
  helmet: new THREE.SphereGeometry(0.15, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.6),
  thigh: new THREE.CapsuleGeometry(0.085, 0.32, 4, 12),
  shin: new THREE.CapsuleGeometry(0.07, 0.34, 4, 12),
  boot: new THREE.BoxGeometry(0.13, 0.1, 0.28),
  upperArm: new THREE.CapsuleGeometry(0.06, 0.22, 4, 10),
  forearm: new THREE.CapsuleGeometry(0.052, 0.22, 4, 10),
};
const SHARED_MATS = {
  gear: new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.6, metalness: 0.3 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.6 }),
  lens: new THREE.MeshStandardMaterial({ color: 0x0c1420, metalness: 0.9, roughness: 0.05 }),
  metal: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.3, metalness: 1 }),
  gun: gunMat,
};
const TEAM_MATS = {};
for (const team of [1, -1]) {
  const s = TEAM_STYLE[team];
  TEAM_MATS[team] = {
    visor: new THREE.MeshStandardMaterial({ color: 0x050608, emissive: s.glow, emissiveIntensity: 2.2, roughness: 0.1, metalness: 0.8 }),
    patch: new THREE.MeshStandardMaterial({ color: s.glow, emissive: s.glow, emissiveIntensity: 1.2, roughness: 0.4 }),
  };
}
const ENEMY_MUZZLE = new THREE.Vector3(0.16, 1.34, -1.19);

const box3 = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 12);
const unitSphere = new THREE.SphereGeometry(1, 12, 10);

// Bakes a list of [material key, geometry, position, rotation, scale] into one geometry per material.
function bake(parts) {
  const byMat = new Map();
  const m = new THREE.Matrix4();
  for (const [key, geo, pos, rot = [0, 0, 0], scale = [1, 1, 1]] of parts) {
    m.compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
    if (!byMat.has(key)) byMat.set(key, []);
    byMat.get(key).push(geo.clone().applyMatrix4(m));
  }
  return [...byMat].map(([key, geos]) => [key, mergeGeometries(geos)]);
}

function attach(template, mats, parent) {
  for (const [key, geo] of template) {
    const mesh = new THREE.Mesh(geo, mats[key] || SHARED_MATS[key]);
    mesh.castShadow = true;
    parent.add(mesh);
  }
}

const HALF_PI = Math.PI / 2;
const TEMPLATES = {
  body: bake([
    ['pants', GEO.pelvis, [0, 0.98, 0], [0, 0, 0], [1.2, 1, 0.8]],
    ['vest', GEO.vest, [0, 1.34, 0]],
    ...[-1, 1].map((sx) => ['vest', box3(0.09, 0.05, 0.34), [sx * 0.14, 1.58, 0]]),
    ...[-0.12, 0, 0.12].flatMap((px) => [
      ['uniform', box3(0.1, 0.14, 0.07), [px, 1.2, -0.18]],
      ['gear', box3(0.105, 0.03, 0.078), [px, 1.275, -0.18]],
    ]),
    ['uniform', box3(0.18, 0.1, 0.04), [0, 1.43, -0.165]],
    ['patch', box3(0.07, 0.02, 0.005), [0.11, 1.5, -0.152]],
    ['patch', box3(0.3, 0.012, 0.005), [0, 1.36, -0.152]],
    ['gear', unitCyl, [0, 1.07, 0], [0, 0, 0], [0.2, 0.06, 0.16]],
    ['metal', box3(0.06, 0.04, 0.02), [0, 1.07, -0.165]],
    ['gear', box3(0.07, 0.17, 0.12), [0.23, 0.97, 0]],
    ['uniform', box3(0.34, 0.42, 0.18), [0, 1.36, 0.23]],
    ...[-1, 1].flatMap((sx) => [
      ['metal', unitCyl, [sx * 0.08, 1.42, 0.33], [0, 0, 0], [0.05, 0.34, 0.05]],
      ['patch', unitCyl, [sx * 0.08, 1.22, 0.33], [0, 0, 0], [0.04, 0.03, 0.04]],
    ]),
    ['gear', unitCyl, [0, 1.58, 0.22], [0, 0, HALF_PI], [0.055, 0.3, 0.055]],
    ['uniform', new THREE.CylinderGeometry(0.11, 0.12, 0.07, 14), [0, 1.59, 0]],
    ['skin', GEO.neck, [0, 1.62, 0]],
    ...[-1, 1].flatMap((sx) => [
      ['gear', unitCyl, [sx * 0.148, 1.79, 0], [0, 0, HALF_PI], [0.04, 0.04, 0.04]],
      ['patch', unitCyl, [sx * 0.17, 1.79, 0], [0, 0, HALF_PI], [0.022, 0.005, 0.022]],
    ]),
    ['visor', new THREE.SphereGeometry(0.152, 20, 8, -Math.PI * 0.82, Math.PI * 0.64, Math.PI * 0.36, Math.PI * 0.2), [0, 1.8, 0]],
    ['gear', box3(0.1, 0.05, 0.05), [0, 1.69, -0.12]],
    ['gear', box3(0.02, 0.18, 0.03), [0.06, 1.96, 0.05]],
  ]),
  upperArm: bake([
    ['pants', GEO.upperArm, [0, -0.15, 0]],
    ['vest', unitSphere, [0, -0.02, 0], [0, 0, 0], [0.085, 0.07, 0.085]],
    ['patch', box3(0.005, 0.05, 0.06), [0.07, -0.1, 0]],
  ]),
  forearm: bake([
    ['pants', GEO.forearm, [0, -0.14, 0]],
    ['uniform', unitCyl, [0, -0.16, 0], [0, 0, 0], [0.065, 0.16, 0.065]],
    ['patch', box3(0.04, 0.02, 0.005), [0, -0.16, -0.066]],
    ['gear', unitSphere, [0, -0.29, 0], [0, 0, 0], [0.048, 0.06, 0.04]],
  ]),
  shin: bake([
    ['vest', box3(0.12, 0.16, 0.05), [0, -0.02, -0.08]],
    ['uniform', box3(0.11, 0.24, 0.03), [0, -0.22, -0.07]],
    ['boots', GEO.boot, [0, -0.43, -0.04]],
    ['gear', box3(0.14, 0.03, 0.3), [0, -0.485, -0.04]],
    ['boots', unitCyl, [0, -0.36, 0], [0, 0, 0], [0.078, 0.12, 0.078]],
  ]),
  rifle: bake([
    ['gun', box3(0.07, 0.1, 0.46), [0, 0, 0]],
    ['uniform', box3(0.075, 0.06, 0.3), [0, 0.03, -0.3]],
    ['patch', box3(0.078, 0.012, 0.26), [0, 0.0, -0.3]],
    ['gun', unitCyl, [0, 0.02, -0.55], [HALF_PI, 0, 0], [0.02, 0.2, 0.02]],
    ['patch', unitCyl, [0, 0.02, -0.66], [HALF_PI, 0, 0], [0.024, 0.03, 0.024]],
    ['gun', box3(0.045, 0.16, 0.08), [0, -0.11, -0.08], [0.25, 0, 0]],
    ['gear', box3(0.04, 0.11, 0.05), [0, -0.08, 0.08], [-0.3, 0, 0]],
    ['uniform', box3(0.06, 0.12, 0.2), [0, -0.02, 0.32]],
    ['gear', box3(0.03, 0.05, 0.12), [0, 0.08, -0.05]],
    ['patch', box3(0.02, 0.02, 0.005), [0, 0.08, 0.012]],
  ]),
};
const POCKETS = [-1, 1].map((side) => bake([['vest', box3(0.06, 0.14, 0.12), [side * 0.085, -0.24, 0]]]));

function part(geo, mat, x, y, z, parent) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function createLeg(side, mats, group) {
  const hip = new THREE.Group();
  hip.position.set(side * 0.11, 0.93, 0);
  group.add(hip);
  const thigh = part(GEO.thigh, mats.pants, 0, -0.22, 0, hip);
  attach(POCKETS[side > 0 ? 1 : 0], mats, hip);
  const knee = new THREE.Group();
  knee.position.y = -0.44;
  hip.add(knee);
  const shin = part(GEO.shin, mats.pants, 0, -0.2, 0, knee);
  attach(TEMPLATES.shin, mats, knee);
  return { hip, knee, hitboxes: [thigh, shin] };
}

function createArm(shoulderX, shoulderRot, elbowRot, mats, group) {
  const shoulder = new THREE.Group();
  shoulder.position.set(shoulderX, 1.5, 0);
  shoulder.rotation.set(...shoulderRot);
  group.add(shoulder);
  attach(TEMPLATES.upperArm, mats, shoulder);
  const elbow = new THREE.Group();
  elbow.position.y = -0.3;
  elbow.rotation.set(...elbowRot);
  shoulder.add(elbow);
  attach(TEMPLATES.forearm, mats, elbow);
  return shoulder;
}

const BOT_NAMES = {
  1: ['Vega', 'Orion', 'Lyra', 'Rigel', 'Nova', 'Altair', 'Deneb'],
  [-1]: ['Raider', 'Reaver', 'Marauder', 'Corsair', 'Brute', 'Stalker', 'Warden', 'Hunter'],
};

function createBot(team, x, z, name) {
  const group = new THREE.Group();
  const s = TEAM_STYLE[team];
  const std = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const mats = {
    uniform: std(s.armor, 0.4, 0.3),
    pants: std(s.suit, 0.8),
    vest: std(s.plate, 0.4, 0.4),
    helmet: std(s.helmet, 0.3, 0.4),
    skin: std(s.under, 0.7),
    boots: std(s.boots, 0.6, 0.2),
  };
  const look = { ...mats, ...TEAM_MATS[team] };

  const torso = part(GEO.torso, mats.pants, 0, 1.33, 0, group);
  torso.scale.set(1.15, 1, 0.75);
  attach(TEMPLATES.body, look, group);
  const head = part(GEO.head, mats.skin, 0, 1.76, 0, group);
  const helmet = part(GEO.helmet, mats.helmet, 0, 1.79, 0.01, group);

  const legL = createLeg(-1, look, group);
  const legR = createLeg(1, look, group);
  createArm(0.24, [-1.1, 0, -0.2], [-0.9, 0, 0], look, group);
  createArm(-0.24, [-1.3, 0, 0.5], [-0.25, 0, 0], look, group);

  const rifle = new THREE.Group();
  rifle.position.set(0.16, 1.32, -0.5);
  group.add(rifle);
  attach(TEMPLATES.rifle, look, rifle);

  group.position.set(x, 0, z);
  const heading = team === 1 ? 0 : Math.PI;
  group.rotation.y = heading;
  scene.add(group);

  const bot = {
    team, name, group, legL, legR, mats,
    hitboxes: [torso, head, helmet, ...legL.hitboxes, ...legR.hitboxes],
    health: 100,
    speed: 3.1 + Math.random() * 0.5,
    fireCooldown: 0.8 + Math.random(),
    fireRate: 0.65,
    accuracy: 0.5,
    strafe: Math.random() < 0.5 ? -1 : 1,
    strafeTimer: 1 + Math.random() * 2,
    path: null,
    repath: 0,
    walk: Math.random() * 10,
    stride: 0,
    flash: 0,
    dead: false,
    deathTime: 0,
    target: null,
    scan: Math.random() * 0.3,
    goal: null,
    goalPoint: null,
    goalTimer: 0,
    heading,
  };
  for (const m of bot.hitboxes) m.userData.bot = bot;
  head.userData.head = true;
  helmet.userData.head = true;
  bots.push(bot);
  return bot;
}

function removeBot(bot) {
  scene.remove(bot.group);
  for (const m of Object.values(bot.mats)) m.dispose();
  bots.splice(bots.indexOf(bot), 1);
}

function hostileShootables() {
  const list = [];
  for (const b of bots) {
    if (b.team === -1 && !b.dead) list.push(...b.hitboxes);
  }
  return list;
}

// ---------- Pickups ----------
const pickups = [];
const PICKUP_MATS = {
  kit: new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.35 }),
  cross: new THREE.MeshStandardMaterial({ color: 0xe02020, roughness: 0.4, emissive: 0xe02020, emissiveIntensity: 0.4 }),
  can: new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.35, metalness: 0.5 }),
  cell: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x38e1ff, emissiveIntensity: 2.5 }),
  stencil: new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5, emissive: 0xffd23f, emissiveIntensity: 0.3 }),
  handle: new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.4, metalness: 0.8 }),
  latch: new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.25, metalness: 1 }),
  label: decalMaterial(textTexture(['PLASMA', 'CELLS'], { fg: '#1a8fd8', font: 'bold 84px Impact, Arial Black, sans-serif' }), { emissive: 0x0a2233 }),
  medLabel: decalMaterial(textTexture(['FIRST AID'], { fg: '#d91e1e', font: 'bold 92px Impact, Arial Black, sans-serif' })),
};
const PICKUP_GLOW = {
  health: new THREE.MeshBasicMaterial({ color: 0x2ee86b, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  ammo: new THREE.MeshBasicMaterial({ color: 0x38e1ff, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
};

function buildPickup(type) {
  const g = new THREE.Group();
  if (type === 'health') {
    part(new THREE.BoxGeometry(0.46, 0.32, 0.18), PICKUP_MATS.kit, 0, 0, 0, g);
    for (const z of [-0.091, 0.091]) {
      part(new THREE.BoxGeometry(0.2, 0.06, 0.004), PICKUP_MATS.cross, 0, 0, z, g);
      part(new THREE.BoxGeometry(0.06, 0.2, 0.004), PICKUP_MATS.cross, 0, 0, z, g);
    }
    part(new THREE.BoxGeometry(0.16, 0.03, 0.04), PICKUP_MATS.handle, 0, 0.18, 0, g);
    for (const x of [-0.07, 0.07]) part(new THREE.BoxGeometry(0.02, 0.03, 0.03), PICKUP_MATS.handle, x, 0.17, 0, g);
    for (const x of [-0.17, 0.17]) {
      for (const z of [-0.092, 0.092]) part(new THREE.BoxGeometry(0.04, 0.05, 0.012), PICKUP_MATS.latch, x, 0.12, z, g);
    }
    part(new THREE.BoxGeometry(0.47, 0.012, 0.185), PICKUP_MATS.handle, 0, 0.09, 0, g);
    for (const z of [-0.0915, 0.0915]) {
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.06), PICKUP_MATS.medLabel);
      label.position.set(0, -0.12, z);
      label.rotation.y = z > 0 ? 0 : Math.PI;
      g.add(label);
    }
  } else {
    part(new THREE.BoxGeometry(0.44, 0.28, 0.2), PICKUP_MATS.can, 0, 0, 0, g);
    part(new THREE.BoxGeometry(0.46, 0.04, 0.22), PICKUP_MATS.can, 0, 0.15, 0, g);
    for (const z of [-0.101, 0.101]) {
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), PICKUP_MATS.label);
      label.position.set(0, -0.01, z);
      label.rotation.y = z > 0 ? 0 : Math.PI;
      g.add(label);
    }
    for (const x of [-0.17, 0.17]) part(new THREE.BoxGeometry(0.03, 0.26, 0.21), PICKUP_MATS.can, x, -0.01, 0, g);
    part(new THREE.BoxGeometry(0.18, 0.025, 0.035), PICKUP_MATS.handle, 0, 0.185, 0, g);
    for (const x of [-0.08, 0.08]) part(new THREE.BoxGeometry(0.02, 0.03, 0.03), PICKUP_MATS.handle, x, 0.175, 0, g);
    part(new THREE.BoxGeometry(0.05, 0.14, 0.03), PICKUP_MATS.latch, 0.235, 0.09, 0, g).rotation.z = 0.2;
    const hinge = part(new THREE.CylinderGeometry(0.012, 0.012, 0.44, 8), PICKUP_MATS.handle, 0, 0.13, 0.115, g);
    hinge.rotation.z = Math.PI / 2;
    for (const x of [-0.1, 0.1]) part(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 12), PICKUP_MATS.cell, x, 0.2, -0.05, g);
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 40), PICKUP_GLOW[type]);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.46;
  g.add(ring);
  return g;
}

function spawnPickup(x, z, type) {
  const mesh = buildPickup(type);
  mesh.position.set(x, groundHeight(x, z, 0.3, 10) + 0.5, z);
  scene.add(mesh);
  pickups.push({ mesh, type, baseY: mesh.position.y, t: Math.random() * 6, life: 25 });
}

function removePickup(p) {
  scene.remove(p.mesh);
  p.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  pickups.splice(pickups.indexOf(p), 1);
}

// ---------- Game state ----------
const player = {
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  onGround: true,
  health: MAX_HEALTH,
  current: 0,
  switchTo: 0,
  switchTimer: 0,
  reloading: 0,
  reloadTotal: 0,
  reloadPose: 0,
  fireCooldown: 0,
  ejectAt: 0,
  cycle: 10,
  flashTime: 0,
  ads: 0,
  sprintPose: 0,
  recoil: 0,
  bob: 0,
  dead: false,
  respawn: 0,
};

const game = {
  state: 'menu', // menu | playing | paused | over
  score: 0,
  kills: 0,
  deaths: 0,
  damageFlash: 0,
  tickets: { 1: 0, [-1]: 0 },
  bleed: 0,
  respawns: [],
};

// Ship sections to capture. `start` is the initial owner (1 allies, -1 hostiles, 0 neutral).
const POINTS = [
  { id: 'A', name: 'Cargo Bay', x: -19.5, z: 3, r: 5, inner: 0, start: 0 },
  { id: 'B', name: 'Reactor', x: 0, z: 3, r: 5.5, inner: 2.4, start: 0 },
  { id: 'C', name: 'Bridge', x: 0, z: -20, r: 5, inner: 1.3, start: -1 },
];
const PLAYER_SPAWNS = [[0, 26], [-5, 25.5], [5, 25.5]];
const ALLY_SPAWNS = [[-4, 27.5], [4, 27.5], [-8, 23.5], [8, 23.5], [0, 22], [-3, 23], [3, 23]];
const ENEMY_SPAWNS = [[-22, -26], [22, -26], [-17, -28], [17, -28], [-25, -22], [25, -22], [-6, -26], [6, -26]];
const ALLY_BOTS = 5;
const ENEMY_BOTS = 6;
const START_TICKETS = 150;
const CAPTURE_RATE = 0.12;
const RESPAWN_TIME = 5;
const BLEED_INTERVAL = 5;
const OWNER_COLORS = { 1: new THREE.Color(0x3aa8ff), 0: new THREE.Color(0xdfe4ea), [-1]: new THREE.Color(0xff4a3a) };

const letterTex = (letter) => canvasTexture(128, (g, s) => {
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.font = 'bold 84px "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, s / 2, s / 2 + 4);
  g.lineWidth = 6;
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 5, 0, Math.PI * 2);
  g.stroke();
});
for (const p of POINTS) {
  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
  const ringMat = new THREE.MeshBasicMaterial({ ...additive, opacity: 0.7, side: THREE.DoubleSide });
  const bandMat = new THREE.MeshBasicMaterial({ ...additive, opacity: 0.12, side: THREE.DoubleSide });
  const letterMat = new THREE.MeshBasicMaterial({ ...additive, opacity: 0.8, map: letterTex(p.id) });
  const ring = new THREE.Mesh(new THREE.RingGeometry(p.r - 0.15, p.r, 72).rotateX(-Math.PI / 2), ringMat);
  ring.position.set(p.x, 0.03, p.z);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, 0.5, 72, 1, true), bandMat);
  band.position.set(p.x, 0.25, p.z);
  const letter = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4).rotateX(-Math.PI / 2), letterMat);
  letter.position.set(p.x, 0.035, p.z + p.r - 1.1);
  scene.add(ring, band, letter);
  Object.assign(p, { mats: [ringMat, bandMat, letterMat], owner: p.start, progress: p.start, allies: 0, hostiles: 0, playerIn: false });
}

const keys = {};
// Right-hand keys mirror WASD so the mouse can be used with the left hand.
const BINDINGS = {
  forward: ['KeyW', 'KeyI', 'ArrowUp', 'Numpad8'],
  back: ['KeyS', 'KeyK', 'ArrowDown', 'Numpad5', 'Numpad2'],
  left: ['KeyA', 'KeyJ', 'ArrowLeft', 'Numpad4'],
  right: ['KeyD', 'KeyL', 'ArrowRight', 'Numpad6'],
  jump: ['Space', 'Numpad0', 'ControlRight'],
  sprint: ['ShiftLeft', 'ShiftRight', 'KeyH'],
  reload: ['KeyR', 'KeyU', 'Enter', 'NumpadEnter'],
  next: ['KeyO'],
  prev: ['KeyY'],
  pause: ['KeyP'],
};
const WEAPON_KEYS = [
  ['Digit1', 'Digit6', 'Numpad1'],
  ['Digit2', 'Digit7', 'Numpad2'],
  ['Digit3', 'Digit8', 'Numpad3'],
  ['Digit4', 'Digit9', 'Numpad7'],
  ['Digit5', 'Digit0', 'Numpad9'],
];
const held = (action) => BINDINGS[action].some((code) => keys[code]);
const bound = (action, code) => BINDINGS[action].includes(code);
let mouseDown = false;
let aimDown = false;
let triggerQueued = false;

function refillAmmo() {
  for (const w of arsenal) {
    w.mag = w.def.magSize;
    w.reserve = w.def.reserve;
  }
}

function placePlayerAtSpawn() {
  const [x, z] = PLAYER_SPAWNS[Math.floor(Math.random() * PLAYER_SPAWNS.length)];
  player.pos.set(x, 0, z);
  player.vel.set(0, 0, 0);
  player.yaw = 0;
  player.pitch = 0;
}

function spawnBot(team, name, slot) {
  const spawns = team === 1 ? ALLY_SPAWNS : ENEMY_SPAWNS;
  const [sx, sz] = spawns[slot % spawns.length];
  const pos = { x: sx + (Math.random() - 0.5) * 1.2, z: sz + (Math.random() - 0.5) * 1.2 };
  pushOut(pos, ENEMY_RADIUS, 0, 2.3);
  return createBot(team, pos.x, pos.z, name);
}

function resetGame() {
  for (const b of [...bots]) removeBot(b);
  for (const p of [...pickups]) removePickup(p);
  clearDecals();
  hud.feed.textContent = '';
  Object.assign(player, {
    onGround: true, health: MAX_HEALTH, switchTimer: 0, reloading: 0, reloadPose: 0, dead: false, respawn: 0,
    fireCooldown: 0, ejectAt: 0, cycle: 10, flashTime: 0, ads: 0, sprintPose: 0, recoil: 0, bob: 0,
  });
  refillAmmo();
  equip(2);
  player.switchTo = player.current;
  placePlayerAtSpawn();
  viewmodel.visible = true;
  hud.respawn.classList.add('hidden');
  for (const p of POINTS) Object.assign(p, { owner: p.start, progress: p.start, allies: 0, hostiles: 0, playerIn: false });
  Object.assign(game, {
    score: 0, kills: 0, deaths: 0, damageFlash: 0, tickets: { 1: START_TICKETS, [-1]: START_TICKETS }, bleed: BLEED_INTERVAL, respawns: [],
  });
  for (let i = 0; i < ALLY_BOTS; i++) spawnBot(1, BOT_NAMES[1][i], i);
  for (let i = 0; i < ENEMY_BOTS; i++) spawnBot(-1, BOT_NAMES[-1][i], i);
  updateHud();
  updateObjectiveHud();
}

function respawnPlayer() {
  Object.assign(player, {
    dead: false, health: MAX_HEALTH, reloading: 0, switchTimer: 0, ads: 0, recoil: 0, fireCooldown: 0, onGround: true,
  });
  refillAmmo();
  placePlayerAtSpawn();
  resetParts(arsenal[player.current]);
  viewmodel.visible = true;
  hud.respawn.classList.add('hidden');
  showBanner('Redeployed');
  updateHud();
}

const ownedBy = (team) => POINTS.filter((p) => p.owner === team).length;
const pointThreatened = (p, team) => (team === 1 ? p.hostiles : p.allies) > 0 || p.progress * team < 0.999;
const inZone = (p, x, z, y = 0) => y < 2.6 && (x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r;

function checkEnd() {
  if (game.state !== 'playing') return;
  if (ownedBy(1) === POINTS.length) {
    game.score += 1000;
    endGame(true, 'Every section of the ship is under allied control.');
  } else if (game.tickets[-1] <= 0) {
    endGame(true, 'Enemy reinforcements exhausted.');
  } else if (game.tickets[1] <= 0) {
    endGame(false, 'Allied reinforcements exhausted.');
  }
}

function endGame(won, reason) {
  game.state = 'over';
  document.exitPointerLock();
  hud.respawn.classList.add('hidden');
  if (won) sfx.capture();
  else sfx.lost();
  showOverlay(won ? 'Ship captured' : 'Boarding failed', `${reason} ${game.kills} kills - Score ${game.score}`, 'Play again');
}

function pointChanged(p, before) {
  const label = `${p.name} (${p.id})`;
  if (p.owner === 1) {
    showBanner(`${label} captured`);
    sfx.capture();
    if (p.playerIn) game.score += 250;
  } else if (p.owner === -1) {
    showBanner(`${label} lost`);
    sfx.lost();
  } else {
    showBanner(before === 1 ? `${label} under attack` : `${label} neutralised`);
  }
  updateHud();
  checkEnd();
}

function updatePoints(dt) {
  const pulse = 0.55 + 0.45 * Math.sin(performance.now() * 0.012);
  for (const p of POINTS) {
    let allies = 0;
    let hostiles = 0;
    for (const b of bots) {
      if (b.dead || !inZone(p, b.group.position.x, b.group.position.z)) continue;
      if (b.team === 1) allies++;
      else hostiles++;
    }
    p.playerIn = !player.dead && inZone(p, player.pos.x, player.pos.z, player.pos.y);
    if (p.playerIn) allies++;
    p.allies = allies;
    p.hostiles = hostiles;
    const diff = allies - hostiles;
    if (diff !== 0) {
      const n = Math.min(Math.abs(diff), 3);
      p.progress += Math.sign(diff) * CAPTURE_RATE * (1 + (n - 1) * 0.5) * dt;
    } else if (!allies) {
      const gap = p.owner - p.progress;
      p.progress += Math.sign(gap) * Math.min(Math.abs(gap), 0.05 * dt);
    }
    p.progress = Math.max(-1, Math.min(1, p.progress));
    const before = p.owner;
    if (p.progress >= 1) p.owner = 1;
    else if (p.progress <= -1) p.owner = -1;
    else if (p.owner * p.progress <= 0) p.owner = 0;
    if (p.owner !== before) {
      pointChanged(p, before);
      if (game.state !== 'playing') return;
    }
    const k = allies && hostiles ? pulse : 1;
    for (const m of p.mats) m.color.copy(OWNER_COLORS[p.owner]).multiplyScalar(k);
  }
}

// Each section held over the enemy drains their reinforcements.
function updateBleed(dt) {
  game.bleed -= dt;
  if (game.bleed > 0) return;
  game.bleed = BLEED_INTERVAL;
  const diff = ownedBy(1) - ownedBy(-1);
  if (diff > 0) game.tickets[-1] = Math.max(0, game.tickets[-1] - diff);
  if (diff < 0) game.tickets[1] = Math.max(0, game.tickets[1] + diff);
  if (diff) checkEnd();
}

function updateRespawns(dt) {
  for (let i = game.respawns.length - 1; i >= 0; i--) {
    const r = game.respawns[i];
    r.t -= dt;
    if (r.t > 0) continue;
    game.respawns.splice(i, 1);
    if (game.tickets[r.team] > 0) spawnBot(r.team, r.name, Math.floor(Math.random() * 8));
  }
}

// ---------- HUD ----------
const $ = (id) => document.getElementById(id);
const hud = {
  score: $('score'), kills: $('kills'), allies: $('allies'), hostiles: $('hostiles'),
  healthFill: $('health-fill'), healthText: $('health-text'),
  mag: $('mag'), reserve: $('reserve'), reloadHint: $('reload-hint'),
  weaponName: $('weapon-name'), slots: $('slots'), scope: $('scope'), crosshair: $('crosshair'),
  hitmarker: $('hitmarker'), damage: $('damage'), banner: $('banner'),
  overlay: $('overlay'), title: $('title'), subtitle: $('subtitle'), play: $('play'),
  ticketsAlly: $('tickets-ally'), ticketsEnemy: $('tickets-enemy'), points: $('points'), objStatus: $('obj-status'),
  markers: $('markers'), feed: $('feed'), respawn: $('respawn'),
};

const ownerClass = (o) => (o > 0 ? 'ally' : o < 0 ? 'enemy' : 'neutral');
const pointEls = POINTS.map((p) => {
  const el = document.createElement('div');
  el.innerHTML = `<div class="fill"></div><span>${p.id}</span>`;
  hud.points.appendChild(el);
  return { el, fill: el.firstChild };
});
const markerEls = POINTS.map((p) => {
  const el = document.createElement('div');
  el.innerHTML = `<b>${p.id}</b><small></small>`;
  hud.markers.appendChild(el);
  return { el, dist: el.lastChild };
});

function updateObjectiveHud() {
  POINTS.forEach((p, i) => {
    const { el, fill } = pointEls[i];
    const cls = `point ${ownerClass(p.owner)}${p.allies && p.hostiles ? ' contested' : ''}${p.playerIn ? ' here' : ''}`;
    if (el.className !== cls) el.className = cls;
    fill.style.height = `${(Math.abs(p.progress) * 100).toFixed(1)}%`;
    fill.className = `fill ${p.progress >= 0 ? 'ally' : 'enemy'}`;
  });
  hud.ticketsAlly.textContent = game.tickets[1];
  hud.ticketsEnemy.textContent = game.tickets[-1];
  const here = POINTS.find((p) => p.playerIn);
  let status;
  if (here) {
    if (here.hostiles) status = `${here.name} contested`;
    else if (here.progress < 1) status = `Capturing ${here.name} ${Math.round(Math.max(0, here.progress) * 100)}%`;
    else status = `Holding ${here.name}`;
  } else {
    status = `Sections held ${ownedBy(1)}/${POINTS.length}`;
  }
  if (hud.objStatus.textContent !== status) hud.objStatus.textContent = status;
}

const markerPos = new THREE.Vector3();
function updateMarkers() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  camera.updateMatrixWorld();
  POINTS.forEach((p, i) => {
    const m = markerEls[i];
    markerPos.set(p.x, 3.2, p.z).project(camera);
    let x = (markerPos.x * 0.5 + 0.5) * W;
    let y = (-markerPos.y * 0.5 + 0.5) * H;
    if (markerPos.z > 1) {
      x = x < W / 2 ? W - 40 : 40;
      y = H / 2;
    }
    x = Math.max(40, Math.min(W - 40, x));
    y = Math.max(110, Math.min(H - 120, y));
    m.el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    const cls = `marker ${ownerClass(p.owner)}${p.allies && p.hostiles ? ' contested' : ''}`;
    if (m.el.className !== cls) m.el.className = cls;
    m.dist.textContent = `${Math.round(Math.hypot(p.x - player.pos.x, p.z - player.pos.z))}m`;
  });
}

function feed(killer, victim, killerTeam, victimTeam) {
  const el = document.createElement('div');
  const tag = (name, team) => `<span class="${team === 1 ? 'ally' : 'enemy'}">${name}</span>`;
  el.innerHTML = `${tag(killer, killerTeam)} &#9656; ${tag(victim, victimTeam)}`;
  hud.feed.prepend(el);
  while (hud.feed.children.length > 5) hud.feed.lastChild.remove();
  setTimeout(() => el.remove(), 5000);
}

function updateCounts() {
  const allies = String(bots.filter((b) => b.team === 1 && !b.dead).length + (player.dead ? 0 : 1));
  const hostiles = String(bots.filter((b) => b.team === -1 && !b.dead).length);
  if (hud.allies.textContent !== allies) hud.allies.textContent = allies;
  if (hud.hostiles.textContent !== hostiles) hud.hostiles.textContent = hostiles;
}

function updateHud() {
  hud.score.textContent = game.score;
  hud.kills.textContent = game.kills;
  updateCounts();
  const hp = Math.max(0, Math.ceil(player.health));
  hud.healthFill.style.width = `${(hp / MAX_HEALTH) * 100}%`;
  hud.healthFill.style.background = hp > 50 ? '#2ee86b' : hp > 25 ? '#ffb627' : '#ff3b3b';
  hud.healthText.textContent = hp;
  const w = arsenal[player.current];
  hud.weaponName.textContent = `${w.def.name}  ${w.def.caliber}`;
  hud.mag.textContent = w.mag;
  hud.reserve.textContent = w.reserve;
  if (player.reloading > 0) hud.reloadHint.textContent = 'Reloading...';
  else if (w.mag === 0 && w.reserve === 0) hud.reloadHint.textContent = 'Out of ammo';
  else if (w.mag <= Math.ceil(w.def.magSize * 0.2)) hud.reloadHint.textContent = 'Press R to reload';
  else hud.reloadHint.textContent = '';
  [...hud.slots.children].forEach((el, i) => {
    el.classList.toggle('active', i === player.switchTo);
    el.classList.toggle('empty', arsenal[i].mag + arsenal[i].reserve === 0);
  });
}

let hitTimer = null;
function showHitmarker(kill) {
  hud.hitmarker.classList.add('show');
  hud.hitmarker.classList.toggle('kill', kill);
  clearTimeout(hitTimer);
  hitTimer = setTimeout(() => hud.hitmarker.classList.remove('show'), 90);
}

let bannerTimer = null;
function showBanner(text) {
  hud.banner.textContent = text;
  hud.banner.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => hud.banner.classList.remove('show'), 1800);
}

function showOverlay(title, subtitle, button) {
  hud.title.textContent = title;
  hud.subtitle.textContent = subtitle;
  hud.play.textContent = button;
  hud.overlay.classList.remove('hidden');
}

// ---------- Input ----------
function requestLock() {
  initAudio();
  if (audio.state === 'suspended') audio.resume();
  hud.play.blur();
  if (game.state === 'over' || game.state === 'menu') resetGame();
  const lock = renderer.domElement.requestPointerLock();
  if (lock) lock.catch(() => {});
}

hud.play.addEventListener('click', requestLock);

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === renderer.domElement) {
    game.state = 'playing';
    hud.overlay.classList.add('hidden');
  } else {
    mouseDown = false;
    aimDown = false;
    for (const k in keys) keys[k] = false;
    if (game.state === 'playing') {
      game.state = 'paused';
      showOverlay('Paused', `${game.kills} kills - Score ${game.score} - Sections held ${ownedBy(1)}/${POINTS.length}`, 'Click to resume');
    }
  }
});

document.addEventListener('pointerlockerror', () => {
  showOverlay(hud.title.textContent, 'Could not lock the mouse - click again.', hud.play.textContent);
});

document.addEventListener('mousemove', (e) => {
  if (game.state !== 'playing') return;
  const sens = 0.0022 * (camera.fov / BASE_FOV);
  player.yaw -= e.movementX * sens;
  player.pitch -= e.movementY * sens;
  player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, player.pitch));
});

// Same mouse buttons for everyone: left click fires, right click aims.
const fireButton = () => 0;
const aimButton = () => 2;

document.addEventListener('mousedown', (e) => {
  if (game.state !== 'playing') return;
  if (e.button === fireButton()) {
    mouseDown = true;
    triggerQueued = true;
  }
  if (e.button === aimButton()) aimDown = true;
  if (e.button === 1) {
    e.preventDefault();
    startReload();
  }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === fireButton()) mouseDown = false;
  if (e.button === aimButton()) aimDown = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('wheel', (e) => {
  if (game.state !== 'playing' || e.deltaY === 0) return;
  const n = arsenal.length;
  switchWeapon((player.switchTo + (e.deltaY > 0 ? 1 : n - 1)) % n);
});

document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (game.state !== 'playing') return;
  if (bound('reload', e.code)) startReload();
  if (bound('pause', e.code)) document.exitPointerLock();
  const n = arsenal.length;
  if (bound('next', e.code)) switchWeapon((player.switchTo + 1) % n);
  if (bound('prev', e.code)) switchWeapon((player.switchTo + n - 1) % n);
  const slot = WEAPON_KEYS.findIndex((codes) => codes.includes(e.code));
  if (slot >= 0 && slot < n) switchWeapon(slot);
  if (bound('jump', e.code) || e.code.startsWith('Arrow') || e.code === 'Enter') e.preventDefault();
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

// ---------- Player actions ----------
function switchWeapon(index) {
  if (player.dead || index === player.switchTo) return;
  player.switchTo = index;
  player.reloading = 0;
  if (player.switchTimer <= 0 || player.switchTimer < SWITCH_TIME / 2) player.switchTimer = SWITCH_TIME;
  sfx.switch();
  updateHud();
}

function startReload() {
  const w = arsenal[player.current];
  if (player.dead || player.switchTimer > 0 || player.reloading > 0 || w.mag >= w.def.magSize || w.reserve === 0) return;
  player.reloading = player.reloadTotal = w.def.reloadTime + (w.def.perShell ? 0.2 : 0);
  if (!w.def.perShell) {
    sfx.magOut();
    later(w.def.reloadTime * 650, () => { if (player.reloading > 0) sfx.magIn(); });
  }
  updateHud();
}

function updateReload(dt) {
  if (player.reloading <= 0) return;
  const w = arsenal[player.current];
  player.reloading -= dt;
  if (player.reloading > 0) return;
  if (w.def.perShell) {
    w.mag++;
    w.reserve--;
    sfx.shellIn();
    if (w.mag < w.def.magSize && w.reserve > 0) player.reloading = player.reloadTotal = w.def.reloadTime;
    else player.reloading = 0;
  } else {
    const take = Math.min(w.def.magSize - w.mag, w.reserve);
    w.mag += take;
    w.reserve -= take;
    player.reloading = 0;
    sfx.rack();
  }
  updateHud();
}

const forward = new THREE.Vector3();
const muzzleWorld = new THREE.Vector3();

function shoot() {
  const w = arsenal[player.current];
  const def = w.def;
  if (player.switchTimer > 0 || player.fireCooldown > 0) return;
  if (player.reloading > 0) {
    if (!(def.perShell && w.mag > 0)) return;
    player.reloading = 0;
  }
  if (w.mag === 0) {
    player.fireCooldown = 0.25;
    sfx.empty();
    startReload();
    return;
  }
  w.mag--;
  player.fireCooldown = Math.max(player.fireCooldown, -def.interval) + def.interval;
  player.cycle = 0;
  player.ejectAt = { pump: 0.4, bolt: 0.52 }[def.action] ?? 0.001;
  player.flashTime = 0.05;
  player.recoil = Math.min(player.recoil + def.recoil, 6);
  player.pitch = Math.min(Math.PI / 2 - 0.01, player.pitch + def.recoil * 0.006 * (1 - player.ads * 0.4));
  player.yaw += (Math.random() - 0.5) * def.recoil * 0.004;
  sfx.shot(def.sound);
  if (def.action === 'pump' && w.mag > 0) sfx.pump();
  if (def.action === 'bolt' && w.mag > 0) sfx.bolt();
  flash.visible = true;
  flash.rotation.z = Math.random() * Math.PI;
  flashLight.intensity = 3;
  if (w.model.glow) w.model.glow.emissiveIntensity = w.model.glowBase * 3;
  worldFlash.intensity = 4 + def.flash * 20;

  camera.updateMatrixWorld();
  muzzleWorld.copy(w.model.muzzle);
  w.model.group.localToWorld(muzzleWorld);
  muzzleWorld.applyMatrix4(camera.matrixWorld);

  const moving = Math.hypot(player.vel.x, player.vel.z) > 0.5;
  const adsMult = def.adsSpreadMult ?? 0.35;
  const spread = def.spread * (1 + (adsMult - 1) * player.ads)
    + (moving ? 0.012 * (1 - player.ads * 0.5) : 0)
    + (player.onGround ? 0 : 0.025)
    + (def.pellets === 1 ? player.recoil * 0.0025 : 0);

  const targets = [...worldMeshes, ...hostileShootables()];
  const damage = new Map();
  for (let i = 0; i < def.pellets; i++) {
    camera.getWorldDirection(forward);
    const r = spread * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    const right = tmpV.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = tmpV2.set(0, 1, 0).applyQuaternion(camera.quaternion);
    forward.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();

    raycaster.set(camera.position, forward);
    const hits = raycaster.intersectObjects(targets, false);
    const end = hits.length ? hits[0].point : camera.position.clone().addScaledVector(forward, 80);
    if (i < 4) spawnBolt(muzzleWorld, end, def.color, def.id === 'rail' ? 0.03 : def.pellets > 1 ? 0.01 : 0.016, def.id === 'rail' ? 0.3 : 0.07);
    if (!hits.length) continue;
    const hit = hits[0];
    const enemy = hit.object.userData.bot;
    if (enemy) {
      const headshot = !!hit.object.userData.head;
      let dmg = headshot ? def.headDamage : def.damage;
      if (def.falloff) dmg *= Math.max(0.25, 1 - hit.distance / def.falloff);
      const entry = damage.get(enemy) || { dmg: 0, headshot: false };
      entry.dmg += dmg;
      entry.headshot = entry.headshot || headshot;
      damage.set(enemy, entry);
      spawnImpact(hit.point, 0x404650, forward.clone().negate(), true, def.color);
    } else {
      const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
      spawnImpact(hit.point, 0x9aa3ae, normal, true, def.color);
      spawnDecal(hit);
    }
  }
  for (const [enemy, { dmg, headshot }] of damage) damageBot(enemy, dmg, headshot, player);
  updateHud();
}

function damageBot(bot, amount, headshot, attacker) {
  if (bot.dead) return;
  bot.health -= amount;
  bot.flash = 0.1;
  const byPlayer = attacker === player;
  if (bot.health <= 0) {
    bot.dead = true;
    bot.deathTime = 0;
    bot.target = null;
    game.tickets[bot.team] = Math.max(0, game.tickets[bot.team] - 1);
    game.respawns.push({ team: bot.team, name: bot.name, t: RESPAWN_TIME });
    feed(byPlayer ? 'You' : attacker.name, bot.name, byPlayer ? 1 : attacker.team, bot.team);
    if (bot.team === -1) {
      const roll = Math.random();
      if (roll < 0.25) spawnPickup(bot.group.position.x, bot.group.position.z, 'health');
      else if (roll < 0.6) spawnPickup(bot.group.position.x, bot.group.position.z, 'ammo');
    }
    if (byPlayer) {
      game.kills++;
      game.score += headshot ? 150 : 100;
      sfx.kill();
      showHitmarker(true);
    }
    updateHud();
    checkEnd();
    return;
  }
  if (byPlayer) {
    sfx.hit();
    showHitmarker(false);
  }
}

function damagePlayer(amount, attacker) {
  if (player.dead) return;
  player.health -= amount;
  game.damageFlash = Math.min(1, game.damageFlash + 0.5);
  sfx.hurt();
  if (player.health <= 0) {
    player.health = 0;
    player.dead = true;
    player.respawn = RESPAWN_TIME;
    game.deaths++;
    game.tickets[1] = Math.max(0, game.tickets[1] - 1);
    feed(attacker.name, 'You', attacker.team, 1);
    mouseDown = false;
    aimDown = false;
    Object.assign(player, { reloading: 0, ads: 0, switchTimer: 0 });
    player.switchTo = player.current;
    viewmodel.visible = false;
    hud.scope.classList.remove('show');
    camera.fov = BASE_FOV;
    camera.updateProjectionMatrix();
    hud.respawn.classList.remove('hidden');
    updateHud();
    checkEnd();
    return;
  }
  updateHud();
}

function updateDeadPlayer(dt) {
  player.respawn -= dt;
  hud.respawn.textContent = `You were killed - redeploying in ${Math.max(0, Math.ceil(player.respawn))}`;
  camera.position.y = Math.max(player.pos.y + 0.4, camera.position.y - dt * 2);
  camera.rotation.z = Math.min(0.5, camera.rotation.z + dt);
  if (player.respawn <= 0) respawnPlayer();
}

// ---------- Update ----------
const moveDir = new THREE.Vector3();

function updatePlayer(dt) {
  const sprint = held('sprint') && !aimDown;
  const speed = sprint ? SPRINT_SPEED : WALK_SPEED * (1 - player.ads * 0.4);
  const f = (held('forward') ? 1 : 0) - (held('back') ? 1 : 0);
  const s = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
  moveDir.set(
    -Math.sin(player.yaw) * f + Math.cos(player.yaw) * s,
    0,
    -Math.cos(player.yaw) * f - Math.sin(player.yaw) * s,
  );
  if (moveDir.lengthSq() > 0) moveDir.normalize();

  const accel = player.onGround ? 12 : 3;
  player.vel.x += (moveDir.x * speed - player.vel.x) * Math.min(1, accel * dt);
  player.vel.z += (moveDir.z * speed - player.vel.z) * Math.min(1, accel * dt);

  if (held('jump') && player.onGround) {
    player.vel.y = JUMP_SPEED;
    player.onGround = false;
  }

  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  pushOut(player.pos, PLAYER_RADIUS, player.pos.y, player.pos.y + 1.8);
  player.pos.x = Math.max(-ARENA + PLAYER_RADIUS, Math.min(ARENA - PLAYER_RADIUS, player.pos.x));
  player.pos.z = Math.max(-ARENA + PLAYER_RADIUS, Math.min(ARENA - PLAYER_RADIUS, player.pos.z));

  player.vel.y -= GRAVITY * dt;
  const ground = groundHeight(player.pos.x, player.pos.z, PLAYER_RADIUS, player.pos.y);
  player.pos.y += player.vel.y * dt;
  if (player.pos.y <= ground) {
    player.pos.y = ground;
    player.vel.y = 0;
    player.onGround = true;
  } else {
    player.onGround = player.pos.y - ground < 0.02;
  }

  const horiz = Math.hypot(player.vel.x, player.vel.z);
  if (player.onGround) player.bob += horiz * dt * 1.6;

  camera.position.set(player.pos.x, player.pos.y + PLAYER_HEIGHT + Math.sin(player.bob * 2) * 0.04 * Math.min(1, horiz / WALK_SPEED), player.pos.z);
  camera.rotation.set(player.pitch + player.recoil * 0.008, player.yaw, 0);

  updateWeapon(dt, horiz, sprint && f > 0);
}

const smooth = (t) => t * t * (3 - 2 * t);
const phase = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));

function updateWeapon(dt, horiz, sprinting) {
  player.fireCooldown -= dt;
  player.cycle += dt;

  let lower = 0;
  if (player.switchTimer > 0) {
    player.switchTimer = Math.max(0, player.switchTimer - dt);
    if (player.switchTimer <= SWITCH_TIME / 2 && player.current !== player.switchTo) {
      equip(player.switchTo);
      player.cycle = 10;
      updateHud();
    }
    const t = player.switchTimer / SWITCH_TIME;
    lower = smooth(t > 0.5 ? (1 - t) * 2 : t * 2);
  }

  updateReload(dt);

  const w = arsenal[player.current];
  const def = w.def;
  const parts = w.model.parts;
  const wantShot = def.auto ? mouseDown : triggerQueued;
  triggerQueued = false;
  if (wantShot) shoot();
  else player.fireCooldown = Math.max(0, player.fireCooldown);
  player.recoil = Math.max(0, player.recoil - dt * 7);

  const adsTarget = aimDown && player.switchTimer <= 0 && player.reloading <= 0 && !sprinting ? 1 : 0;
  player.ads += Math.sign(adsTarget - player.ads) * Math.min(Math.abs(adsTarget - player.ads), dt * 6);
  const ads = smooth(player.ads);
  player.sprintPose += ((sprinting && horiz > 2 && !aimDown ? 1 : 0) - player.sprintPose) * Math.min(1, dt * 8);
  player.reloadPose += ((player.reloading > 0 ? 1 : 0) - player.reloadPose) * Math.min(1, dt * 8);

  camera.fov = BASE_FOV + (def.adsFov - BASE_FOV) * ads;
  camera.updateProjectionMatrix();
  const scoped = !!w.model.scope && ads > 0.92;
  hud.scope.classList.toggle('show', scoped);
  hud.crosshair.style.opacity = ads > 0.4 ? 0 : 1;
  viewmodel.visible = !scoped;

  // Viewmodel pose
  const moveK = Math.min(1, horiz / WALK_SPEED) * (1 - ads * 0.85);
  const rest = def.rest;
  const aim = def.ads;
  const kick = player.recoil / Math.max(def.recoil, 0.01);
  const reloadP = player.reloadTotal > 0 ? 1 - player.reloading / player.reloadTotal : 0;
  const reloadArc = player.reloading > 0 && !def.perShell ? Math.sin(reloadP * Math.PI) : 0;
  viewmodel.position.set(
    rest[0] + (aim[0] - rest[0]) * ads + Math.cos(player.bob) * 0.01 * moveK - player.sprintPose * 0.04,
    rest[1] + (aim[1] - rest[1]) * ads + Math.abs(Math.sin(player.bob)) * 0.01 * moveK
      - lower * 0.3 - player.sprintPose * 0.03 - reloadArc * 0.03,
    rest[2] + (aim[2] - rest[2]) * ads + Math.min(kick, 1.5) * def.kick,
  );
  viewmodel.rotation.set(
    Math.min(kick, 1.5) * 0.05 * (1 - ads * 0.6) - lower * 0.9 - player.sprintPose * 0.25 + reloadArc * 0.25,
    player.sprintPose * 0.7,
    reloadArc * 0.45 + player.reloadPose * (def.perShell ? -0.35 : 0) + player.sprintPose * 0.2,
  );

  // Mechanical parts
  const t = player.cycle;
  if (player.ejectAt > 0 && t >= player.ejectAt) {
    ejectCasing(w);
    player.ejectAt = 0;
  }
  if (parts.slide) {
    const locked = w.mag === 0 && player.reloading <= 0;
    const back = locked ? 1 : t < 0.025 ? t / 0.025 : 1 - phase(t, 0.025, 0.08);
    parts.slide.position.z = parts.slide.userData.rest.z + back * 0.028;
  }
  if (parts.charge) {
    const back = t < 0.02 ? t / 0.02 : 1 - phase(t, 0.02, 0.07);
    parts.charge.position.z = parts.charge.userData.rest.z + back * 0.07;
  }
  if (parts.pump) {
    let p = Math.sin(phase(t, 0.18, 0.62) * Math.PI);
    if (player.reloading > 0 && def.perShell) p = 0;
    parts.pump.position.z = parts.pump.userData.rest.z + p * 0.085;
  }
  if (parts.bolt) {
    let lift = phase(t, 0.25, 0.38) - phase(t, 0.85, 0.98);
    let pull = smooth(phase(t, 0.4, 0.58)) - smooth(phase(t, 0.62, 0.82));
    if (player.reloading > 0) {
      lift = phase(reloadP, 0.05, 0.12) - phase(reloadP, 0.88, 0.95);
      pull = smooth(phase(reloadP, 0.12, 0.2)) - smooth(phase(reloadP, 0.8, 0.88));
    }
    parts.bolt.rotation.z = lift * 1.1;
    parts.bolt.position.z = parts.bolt.userData.rest.z + pull * 0.085;
  }
  if (parts.mag) {
    let out = 0;
    if (player.reloading > 0) out = smooth(phase(reloadP, 0.05, 0.3)) - smooth(phase(reloadP, 0.55, 0.85));
    parts.mag.position.y = parts.mag.userData.rest.y - out * 0.25;
    parts.mag.visible = out < 0.95;
  }
  if (parts.shell) {
    const show = player.reloading > 0 && def.perShell && player.reloadTotal === def.reloadTime;
    parts.shell.visible = show;
    if (show) {
      const q = smooth(phase(reloadP, 0.1, 0.85));
      parts.shell.position.set(0, parts.shell.userData.rest.y - 0.06 + q * 0.06, parts.shell.userData.rest.z - q * 0.03);
    }
  }

  if (w.model.glow) {
    const glowTarget = w.model.glowBase * (w.mag > 0 ? 1 : 0.2);
    w.model.glow.emissiveIntensity += (glowTarget - w.model.glow.emissiveIntensity) * Math.min(1, dt * 10);
  }
  player.flashTime -= dt;
  if (player.flashTime <= 0) flash.visible = false;
  flashLight.intensity = Math.max(0, flashLight.intensity - dt * 60);
  worldFlash.intensity = Math.max(0, worldFlash.intensity - dt * 120);
  worldFlash.position.copy(camera.position);
}

const eyeFrom = new THREE.Vector3();
const eyeTo = new THREE.Vector3();
const BOT_SIGHT = 42;

function aimPoint(target, out) {
  if (target === player) return out.set(player.pos.x, player.pos.y + PLAYER_HEIGHT - 0.35, player.pos.z);
  return out.set(target.group.position.x, 1.35, target.group.position.z);
}

const targetAlive = (t) => t && (t === player ? !player.dead : !t.dead);

// Closest visible opponent, or null.
function findTarget(bot) {
  const gp = bot.group.position;
  eyeFrom.set(gp.x, ENEMY_EYE, gp.z);
  let best = null;
  let bestD = BOT_SIGHT;
  const consider = (t, x, z) => {
    const d = Math.hypot(x - gp.x, z - gp.z);
    if (d >= bestD || segmentBlocked(eyeFrom, aimPoint(t, eyeTo))) return;
    best = t;
    bestD = d;
  };
  for (const o of bots) {
    if (o.team !== bot.team && !o.dead) consider(o, o.group.position.x, o.group.position.z);
  }
  if (bot.team === -1 && !player.dead) consider(player, player.pos.x, player.pos.z);
  return best;
}

// Head for the nearest section that still needs taking or defending.
function chooseGoal(bot) {
  const gp = bot.group.position;
  let best = POINTS[0];
  let bestScore = Infinity;
  for (const p of POINTS) {
    let score = Math.hypot(p.x - gp.x, p.z - gp.z) + Math.random() * 14;
    if (p.owner === bot.team) score += pointThreatened(p, bot.team) ? 4 : 45;
    if (score < bestScore) {
      best = p;
      bestScore = score;
    }
  }
  const a = Math.random() * Math.PI * 2;
  const r = best.inner + 0.6 + Math.random() * (best.r - best.inner - 1.2);
  const goal = { x: best.x + Math.cos(a) * r, z: best.z + Math.sin(a) * r };
  pushOut(goal, ENEMY_RADIUS + 0.3, 0, 2.3);
  Object.assign(bot, { goal, goalPoint: best, goalTimer: 6 + Math.random() * 6, path: null, repath: 0 });
}

function updateBots(dt) {
  for (let i = bots.length - 1; i >= 0; i--) {
    const bot = bots[i];
    const g = bot.group;
    const gp = g.position;

    if (bot.dead) {
      bot.deathTime += dt;
      g.rotation.x = Math.min(Math.PI / 2, bot.deathTime * 5);
      gp.y = -Math.max(0, bot.deathTime - 1) * 1.5;
      if (bot.deathTime > 2.2) removeBot(bot);
      continue;
    }

    bot.scan -= dt;
    if (bot.scan <= 0) {
      bot.scan = 0.25 + Math.random() * 0.15;
      bot.target = findTarget(bot);
    }
    if (!targetAlive(bot.target)) bot.target = null;
    const target = bot.target;

    bot.goalTimer -= dt;
    if (!bot.goal || bot.goalTimer <= 0) chooseGoal(bot);
    else if (bot.goalPoint.owner === bot.team && !pointThreatened(bot.goalPoint, bot.team) && bot.goalTimer > 2) bot.goalTimer = 2;

    let tdx = 0;
    let tdz = 0;
    let tdist = Infinity;
    if (target) {
      aimPoint(target, eyeTo);
      tdx = eyeTo.x - gp.x;
      tdz = eyeTo.z - gp.z;
      tdist = Math.hypot(tdx, tdz) || 0.01;
    }

    bot.strafeTimer -= dt;
    if (bot.strafeTimer <= 0) {
      bot.strafe *= -1;
      bot.strafeTimer = 1 + Math.random() * 2.5;
    }
    let mx = 0;
    let mz = 0;
    const gx = bot.goal.x - gp.x;
    const gz = bot.goal.z - gp.z;
    const goalDist = Math.hypot(gx, gz);
    const fighting = target && tdist < 11;
    if (fighting) {
      mx += (-tdz / tdist) * bot.strafe * 0.8;
      mz += (tdx / tdist) * bot.strafe * 0.8;
      if (tdist < 5) {
        mx -= tdx / tdist;
        mz -= tdz / tdist;
      }
    }
    const pathWeight = fighting ? (goalDist > 3 ? 0.5 : 0) : goalDist > 0.8 ? 1 : 0;
    if (pathWeight > 0) {
      bot.repath -= dt;
      if (bot.repath <= 0 || !bot.path) {
        bot.path = findPath(gp.x, gp.z, bot.goal.x, bot.goal.z);
        bot.repath = 0.9 + Math.random() * 0.5;
      }
      while (bot.path && bot.path.length > 1 && Math.hypot(bot.path[0].x - gp.x, bot.path[0].z - gp.z) < 0.6) bot.path.shift();
      let wx = gx;
      let wz = gz;
      if (bot.path && bot.path.length && goalDist > 1.5) {
        wx = bot.path[0].x - gp.x;
        wz = bot.path[0].z - gp.z;
      }
      const wl = Math.hypot(wx, wz) || 1;
      mx += (wx / wl) * pathWeight;
      mz += (wz / wl) * pathWeight;
    } else if (target && !fighting) {
      mx += (-tdz / tdist) * bot.strafe * 0.4;
      mz += (tdx / tdist) * bot.strafe * 0.4;
    }
    for (const o of bots) {
      if (o === bot || o.dead) continue;
      const ox = gp.x - o.group.position.x;
      const oz = gp.z - o.group.position.z;
      const od = Math.hypot(ox, oz);
      if (od < 1.3 && od > 0.001) {
        mx += (ox / od) * (1.3 - od) * 1.5;
        mz += (oz / od) * (1.3 - od) * 1.5;
      }
    }
    if (!player.dead) {
      const ox = gp.x - player.pos.x;
      const oz = gp.z - player.pos.z;
      const od = Math.hypot(ox, oz);
      if (od < 1.2 && od > 0.001) {
        mx += (ox / od) * (1.2 - od) * 2;
        mz += (oz / od) * (1.2 - od) * 2;
      }
    }
    const ml = Math.hypot(mx, mz);
    const moving = ml > 0.05;
    if (moving) {
      const sp = bot.speed * Math.min(1, ml) * (fighting ? 0.75 : 1);
      gp.x += (mx / ml) * sp * dt;
      gp.z += (mz / ml) * sp * dt;
      bot.walk += dt * sp * 3;
    }
    pushOut(gp, ENEMY_RADIUS, 0, 2.3);
    gp.x = Math.max(-ARENA + 1, Math.min(ARENA - 1, gp.x));
    gp.z = Math.max(-ARENA + 1, Math.min(ARENA - 1, gp.z));

    let want = bot.heading;
    if (target) want = Math.atan2(-tdx, -tdz);
    else if (moving) want = Math.atan2(-mx, -mz);
    let turn = want - bot.heading;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    bot.heading += turn * Math.min(1, dt * 8);
    g.rotation.y = bot.heading;

    bot.stride += ((moving ? 1 : 0) - bot.stride) * Math.min(1, dt * 8);
    const swing = Math.sin(bot.walk) * bot.stride;
    bot.legL.hip.rotation.x = swing * 0.55;
    bot.legR.hip.rotation.x = -swing * 0.55;
    bot.legL.knee.rotation.x = Math.max(0, -Math.cos(bot.walk)) * 0.8 * bot.stride;
    bot.legR.knee.rotation.x = Math.max(0, Math.cos(bot.walk)) * 0.8 * bot.stride;

    bot.flash = Math.max(0, bot.flash - dt);
    for (const m of Object.values(bot.mats)) {
      m.emissive.setHex(bot.flash > 0 ? 0xff5040 : 0x000000);
      m.emissiveIntensity = 0.6;
    }

    bot.fireCooldown -= dt;
    if (target && bot.fireCooldown <= 0 && Math.abs(turn) < 0.5) {
      bot.fireCooldown = bot.fireRate * (0.6 + Math.random() * 0.8);
      let chance = bot.accuracy * Math.max(0.25, 1 - tdist / 45);
      if (target === player) {
        const ps = Math.hypot(player.vel.x, player.vel.z);
        chance *= ps > 7 ? 0.6 : ps > 1 ? 0.8 : 1;
      }
      const hit = Math.random() < chance;
      g.updateMatrixWorld();
      const muzzle = tmpV.copy(ENEMY_MUZZLE).applyMatrix4(g.matrixWorld).clone();
      const aim = eyeTo.clone();
      if (!hit) aim.add(tmpV2.set((Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 2.4));
      spawnBolt(muzzle, aim, TEAM_STYLE[bot.team].bolt, 0.016, 0.07);
      spawnSprite(muzzle, TEAM_STYLE[bot.team].bolt, 0.25, 0.05, null, { mat: { blending: THREE.AdditiveBlending } });
      sfx.botShot(Math.hypot(gp.x - player.pos.x, gp.z - player.pos.z), bot.team);
      if (hit) {
        if (target === player) damagePlayer(7, bot);
        else damageBot(target, 12 + Math.random() * 4, false, bot);
        if (game.state !== 'playing') return;
      }
    }
  }
}

function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.t += dt;
    p.life -= dt;
    p.mesh.rotation.y += dt * 2;
    p.mesh.position.y = p.baseY + Math.sin(p.t * 3) * 0.12;
    p.mesh.visible = p.life > 4 || Math.floor(p.life * 6) % 2 === 0;
    const d = Math.hypot(p.mesh.position.x - player.pos.x, p.mesh.position.z - player.pos.z);
    const dy = Math.abs(p.mesh.position.y - (player.pos.y + 0.6));
    if (d < 1.1 && dy < 1.5) {
      if (p.type === 'health' && player.health < MAX_HEALTH) {
        player.health = Math.min(MAX_HEALTH, player.health + 35);
      } else if (p.type === 'ammo') {
        for (const w of arsenal) {
          const full = w === arsenal[player.current];
          w.reserve += full ? Math.max(w.def.magSize, 8) : Math.ceil(w.def.magSize / 2);
        }
      } else {
        continue;
      }
      sfx.pickup();
      removePickup(p);
      updateHud();
    } else if (p.life <= 0) {
      removePickup(p);
    }
  }
}

function update(dt) {
  if (player.dead) updateDeadPlayer(dt);
  else updatePlayer(dt);
  if (game.state !== 'playing') return;
  updateBots(dt);
  if (game.state !== 'playing') return;
  updatePoints(dt);
  if (game.state !== 'playing') return;
  updateBleed(dt);
  if (game.state !== 'playing') return;
  updateRespawns(dt);
  if (!player.dead) updatePickups(dt);
  for (const s of spinners) s.mesh.rotation.y += s.speed * dt;
  updateCounts();
  updateObjectiveHud();
  updateMarkers();
}

// ---------- Main loop ----------
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(
  window.innerWidth * renderer.getPixelRatio(),
  window.innerHeight * renderer.getPixelRatio(),
  { type: THREE.HalfFloatType, samples: 4 },
));
composer.addPass(new RenderPass(scene, camera));
const weaponPass = new RenderPass(weaponScene, weaponCamera);
weaponPass.clear = false;
weaponPass.clearDepth = true;
composer.addPass(weaponPass);
composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.5, 0.92));
composer.addPass(new OutputPass());

const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (game.state === 'playing') update(dt);
  updateEffects(dt);
  game.damageFlash = Math.max(0, game.damageFlash - dt * 1.5);
  hud.damage.style.opacity = game.damageFlash;
  weaponPass.enabled = viewmodel.visible;
  composer.render(dt);
  requestAnimationFrame(frame);
}

resetGame();
camera.position.set(player.pos.x, PLAYER_HEIGHT, player.pos.z);
camera.rotation.set(0, 0, 0);
frame();
