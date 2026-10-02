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

const COLORS = {
  fog: 0xb4cde6,
  uniform: 0xc0392b,
  pants: 0x2f3d4f,
  vest: 0x55603a,
  helmet: 0x4a5532,
  skin: 0xc58c66,
  boots: 0x1f1a15,
  gun: 0x24272a,
  coverLow: 0xf2b134,
  coverHigh: 0x3d8fd6,
};

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(COLORS.fog, 0.0045);

const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);

// Sky dome, also used as the image-based lighting environment.
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(45), THREE.MathUtils.degToRad(140));
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(300, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color(0x1f6fe0) },
      horizon: { value: new THREE.Color(0xa6d2ff) },
      ground: { value: new THREE.Color(0x5d6b45) },
      sunDir: { value: sunDir },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `
      uniform vec3 zenith, horizon, ground, sunDir;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 6; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
        return v;
      }
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = d.y > 0.0 ? mix(horizon, zenith, pow(d.y, 0.45)) : mix(horizon, ground, pow(-d.y, 0.3));
        float s = max(dot(d, sunDir), 0.0);
        if (d.y > 0.0) {
          vec2 cp = d.xz / (d.y + 0.12) * 1.3;
          float c = smoothstep(0.48, 0.78, fbm(cp)) * smoothstep(0.0, 0.2, d.y);
          vec3 cloud = mix(vec3(0.5, 0.55, 0.62), vec3(0.66, 0.66, 0.68), smoothstep(0.5, 0.9, fbm(cp + 0.6)));
          col = mix(col, cloud + vec3(0.12, 0.1, 0.06) * pow(s, 6.0), c * 0.9);
        }
        col += vec3(1.0, 0.9, 0.7) * (pow(s, 1200.0) * 40.0 + pow(s, 24.0) * 0.6);
        gl_FragColor = vec4(col * 1.4, 1.0);
      }`,
  }),
);
sky.frustumCulled = false;
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(sky);
const envMap = pmrem.fromScene(envScene, 0.02).texture;
scene.add(sky);
scene.environment = envMap;
scene.environmentIntensity = 0.55;

scene.add(new THREE.HemisphereLight(0xbfdcff, 0x7a6248, 0.5));
const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
sun.position.copy(sunDir).multiplyScalar(50);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.03;
Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 120 });
scene.add(sun);

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

const MATS = {
  floor: pbrMaterial('concrete_floor_worn_001'),
  brick: pbrMaterial('red_brick_03'),
  pillar: pbrMaterial('concrete_wall_008'),
  coverLow: pbrMaterial('concrete_wall_008', { color: COLORS.coverLow }),
  coverHigh: pbrMaterial('concrete_wall_008', { color: COLORS.coverHigh }),
  crate: pbrMaterial('wood_planks_dirt', { color: 0xe0b98a }),
  crateFrame: pbrMaterial('wood_planks_dirt', { color: 0x9a6a42 }),
  metal: pbrMaterial('metal_plate'),
  rust: pbrMaterial('rusty_metal_02'),
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
floorGeo.attributes.uv.array.forEach((v, i, a) => { a[i] = v * (ARENA * 2 + 2) / 3; });
const floor = new THREE.Mesh(floorGeo, MATS.floor);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
worldMeshes.push(floor);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(600, 600),
  new THREE.MeshStandardMaterial({ color: 0x6f8f4a, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
ground.receiveShadow = true;
scene.add(ground);

const TILE = { brick: 2.5, pillar: 3, coverLow: 2, coverHigh: 2 };

function addSolid(mesh, x, z, w, h, d, y) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  worldMeshes.push(mesh);
  solids.push({
    min: new THREE.Vector3(x - w / 2, y, z - d / 2),
    max: new THREE.Vector3(x + w / 2, y + h, z + d / 2),
  });
}

function addBox(x, z, w, h, d, kind, y = 0) {
  if (kind === 'crate') return addCrate(x, z, w, y);
  const mesh = new THREE.Mesh(worldBox(w, h, d, TILE[kind]), MATS[kind]);
  mesh.position.set(x, y + h / 2, z);
  addSolid(mesh, x, z, w, h, d, y);
}

function addCrate(x, z, s, y) {
  const mesh = new THREE.Mesh(worldBox(s * 0.96, s * 0.96, s * 0.96, s), MATS.crate);
  mesh.position.set(x, y + s / 2, z);
  addSolid(mesh, x, z, s, s, s, y);
  addCrateDetails(x, z, s, y);
}

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
  decorEuler.set(rot[0], rot[1], rot[2]);
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

const blobTex = canvasTexture(256, (g, s) => {
  g.fillStyle = '#000';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 9; i++) {
    const x = s / 2 + (Math.random() - 0.5) * s * 0.35;
    const y = s / 2 + (Math.random() - 0.5) * s * 0.35;
    const r = s * (0.12 + Math.random() * 0.16);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  }
}, false);
blobTex.wrapS = blobTex.wrapT = THREE.ClampToEdgeWrapping;

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

const burlapTex = canvasTexture(128, (g, s) => {
  g.fillStyle = '#c9b48a';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < s; i += 3) {
    g.fillStyle = `rgba(80,60,30,${0.15 + Math.random() * 0.2})`;
    g.fillRect(0, i, s, 1);
    g.fillRect(i, 0, 1, s);
  }
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(60,45,25,${Math.random() * 0.25})`;
    g.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 6, 2 + Math.random() * 6);
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

const windowsTex = canvasTexture(256, (g, s) => {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, s, s);
  const n = 4;
  const cell = s / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const lit = Math.random() < 0.15;
      g.fillStyle = lit ? '#ffe9a8' : `rgb(${40 + Math.random() * 30},${60 + Math.random() * 30},${85 + Math.random() * 40})`;
      g.fillRect(x * cell + cell * 0.18, y * cell + cell * 0.2, cell * 0.64, cell * 0.55);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x * cell + cell * 0.18, y * cell + cell * 0.75, cell * 0.64, cell * 0.06);
    }
  }
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

const DMAT = {
  metal: MATS.metal,
  rust: MATS.rust,
  concrete: MATS.pillar,
  brick: MATS.brick,
  wood: MATS.crateFrame,
  hazard: stdMat(0xffffff, 0.6, 0, { map: hazardTex }),
  pipeYellow: stdMat(0xffc21a, 0.45, 0.3),
  pipeRed: stdMat(0xd62828, 0.45, 0.3),
  black: stdMat(0x18191b, 0.6, 0.2),
  rubber: stdMat(0x161616, 0.92),
  cone: stdMat(0xff5a00, 0.5),
  reflective: stdMat(0xf4f4f4, 0.3, 0.2),
  sandbag: stdMat(0xffffff, 1, 0, { map: burlapTex }),
  drumRed: stdMat(0xe0382a, 0.45, 0.3, { normalMap: MATS.metal.normalMap }),
  drumBlue: stdMat(0x2c6fe0, 0.45, 0.3, { normalMap: MATS.metal.normalMap }),
  containerGreen: pbrMaterial('corrugated_iron', { color: 0x5fe0a0, metalnessMap: null, metalness: 0.35 }),
  containerOrange: pbrMaterial('corrugated_iron', { color: 0xf0642a, metalnessMap: null, metalness: 0.35 }),
  glow: noShadow(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0c4, emissiveIntensity: 5 })),
  glass: stdMat(0x9fc7e8, 0.05, 0.1, { transparent: true, opacity: 0.6 }),
  paintYellow: decalMaterial(null, { color: 0xffc81e, alphaMap: wornTex, roughness: 0.75 }),
  paintWhite: decalMaterial(null, { color: 0xf2f2f2, alphaMap: wornTex, roughness: 0.75 }),
  seam: noShadow(stdMat(0x2b2c2d, 0.95, 0, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })),
  grate: noShadow(stdMat(0xffffff, 0.45, 0.8, { map: grateTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
  puddle: noShadow(stdMat(0x15181b, 0.02, 0, {
    alphaMap: blobTex, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  })),
  oil: noShadow(stdMat(0x080808, 0.2, 0, {
    alphaMap: blobTex, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  })),
  extinguisher: stdMat(0xd81e1e, 0.35, 0.2),
  foliage: scenery(stdMat(0x2f9a3e, 0.9)),
  foliageDark: scenery(stdMat(0x1f6e34, 0.9)),
  trunk: scenery(stdMat(0x5b3b22, 0.95)),
  buildings: [0xe8a87c, 0xf3e3c3, 0x7fc8c2, 0xa9b8d6, 0xd9786a].map((c) => scenery(stdMat(c, 0.85, 0, { map: windowsTex }))),
  roof: scenery(stdMat(0x55585c, 0.9)),
};
const STENCILS = [
  decalMaterial(textTexture(['FRAGILE'], { fg: '#d91e1e' })),
  decalMaterial(textTexture(['7.62 AMMO', 'x 1000'], { fg: '#141414', font: 'bold 70px Impact, Arial Black, sans-serif' })),
  decalMaterial(textTexture(['\u25B2 \u25B2', 'THIS SIDE UP'], { fg: '#141414', font: 'bold 64px Impact, Arial Black, sans-serif' })),
  decalMaterial(textTexture(['MED SUPPLY'], { fg: '#1a5fd6', font: 'bold 78px Impact, Arial Black, sans-serif' })),
];

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 20),
  cylLow: new THREE.CylinderGeometry(1, 1, 1, 10),
  plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  wallPlane: new THREE.PlaneGeometry(1, 1),
  rib: new THREE.TorusGeometry(1, 0.05, 6, 24).rotateX(Math.PI / 2),
  tire: new THREE.TorusGeometry(0.31, 0.12, 10, 22).rotateX(Math.PI / 2),
  cone: new THREE.CylinderGeometry(0.03, 0.16, 0.62, 18),
  bag: new THREE.SphereGeometry(1, 12, 8),
  sphere: new THREE.SphereGeometry(1, 10, 8),
  pine: new THREE.ConeGeometry(1, 1, 10),
};

// Box helper: centre (x, y, z), size (w, h, d) and optional yaw, with world-scaled UVs.
function box(material, x, y, z, w, h, d, ry = 0, tile = 1) {
  deco(material, worldBox(w, h, d, tile), x, y, z, [0, ry, 0]);
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

function addWallDetails() {
  const L = ARENA * 2;
  WALLS.forEach((wall, wi) => {
    wallBox(wall, DMAT.concrete, 0, -0.5, WALL_H + 0.15, L + 2.4, 0.3, 1.4, 3);
    wallBox(wall, DMAT.concrete, 0, 0.06, 0.2, L, 0.4, 0.12, 3);
    for (let t = -26.25; t <= 26.25; t += 7.5) {
      wallBox(wall, DMAT.brick, t, 0.125, WALL_H / 2, 0.7, WALL_H, 0.25, 2.5);
      wallBox(wall, DMAT.concrete, t, 0.15, WALL_H - 0.1, 0.8, 0.2, 0.3, 3);
      if (Math.round((t + 26.25) / 7.5) % 2 === 0) {
        wallBox(wall, DMAT.black, t, 0.45, 3.85, 0.34, 0.12, 0.42);
        wallBox(wall, DMAT.black, t, 0.3, 3.95, 0.08, 0.2, 0.08);
        wallBox(wall, DMAT.glow, t, 0.5, 3.78, 0.26, 0.02, 0.3);
      }
    }
    if (wi < 2) {
      wallPart(wall, DMAT.metal, G.cylLow, 0, 0.4, 4.35, [0, 0, Math.PI / 2], [0.1, L, 0.1]);
      wallPart(wall, wi === 0 ? DMAT.pipeYellow : DMAT.pipeRed, G.cylLow, 0, 0.62, 4.35, [0, 0, Math.PI / 2], [0.06, L, 0.06]);
      for (let t = -28; t <= 28; t += 3.5) {
        wallBox(wall, DMAT.black, t, 0.35, 4.35, 0.06, 0.26, 0.7);
      }
    } else {
      for (const t of [-10, 10]) {
        wallBox(wall, DMAT.metal, t, 0.12, 1.6, 0.6, 0.8, 0.22, 1);
        wallBox(wall, DMAT.black, t + 0.2, 0.24, 1.75, 0.06, 0.12, 0.04);
        wallBox(wall, DMAT.hazard, t, 0.235, 1.35, 0.3, 0.12, 0.01, 0.25);
        wallPart(wall, DMAT.metal, G.cylLow, t, 0.08, 3.4, [0, 0, 0], [0.025, 2.8, 0.025]);
      }
      for (const t of [-18.75, 18.75]) {
        wallBox(wall, DMAT.metal, t, 0.04, 3, 1.4, 0.9, 0.08, 1);
        for (let k = 0; k < 6; k++) wallBox(wall, DMAT.black, t, 0.09, 2.65 + k * 0.14, 1.25, 0.03, 0.06);
      }
    }
  });
  const signs = [
    [0, textTexture(['SECTOR 7'], { fg: '#ffffff', font: 'bold 100px Impact, Arial Black, sans-serif' }), 5.6, 2.8],
    [1, textTexture(['ZONE B'], { fg: '#ffd21a', font: 'bold 130px Impact, Arial Black, sans-serif' }), 5, 2.5],
    [2, textTexture(['DANGER', 'KEEP CLEAR'], { fg: '#15161a', bg: '#ffc61a', font: 'bold 80px Impact, Arial Black, sans-serif' }), 2.4, 1.2],
    [3, textTexture(['NO SMOKING'], { fg: '#ffffff', bg: '#d62828', font: 'bold 76px Impact, Arial Black, sans-serif' }), 2.4, 1.2],
  ];
  for (const [wi, tex, w, h] of signs) {
    wallPart(WALLS[wi], decalMaterial(tex), G.wallPlane, 0, 0.01, wi < 2 ? 2.8 : 2.2, [0, 0, 0], [w, h, 1]);
  }
}

function addPillarDetails(x, z, i) {
  box(DMAT.concrete, x, 0.175, z, 2.5, 0.35, 2.5, 0, 3);
  box(DMAT.concrete, x, 5.85, z, 2.45, 0.3, 2.45, 0, 3);
  deco(DMAT.hazard, worldBox(2.24, 0.5, 2.24, 0.5), x, 0.6, z);
  if (i % 2 === 0) {
    const fz = z + (z > 0 ? -1.18 : 1.18);
    deco(DMAT.extinguisher, G.cyl, x, 1.25, fz, [0, 0, 0], [0.08, 0.45, 0.08]);
    deco(DMAT.black, G.cylLow, x, 1.52, fz, [0, 0, 0], [0.03, 0.1, 0.03]);
    deco(DMAT.black, G.box, x + 0.05, 1.56, fz, [0, 0, 0], [0.12, 0.03, 0.03]);
    deco(DMAT.metal, G.box, x, 1.25, fz + (z > 0 ? 0.06 : -0.06), [0, 0, 0], [0.18, 0.04, 0.04]);
  }
}

function addCoverCap(x, z, w, h, d) {
  box(DMAT.concrete, x, h - 0.04, z, w + 0.1, 0.08, d + 0.1, 0, 2);
}

function addCrateDetails(x, z, s, y) {
  const frame = new THREE.Object3D();
  frame.position.set(x, y + s / 2, z);
  frame.rotation.y = Math.floor(rand() * 4) * Math.PI / 2;
  frame.updateMatrix();
  const add = (material, geo, lx, ly, lz, ry = 0) => {
    decorMatrix.compose(decorPos.set(lx, ly, lz), decorQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ry), decorScale.set(1, 1, 1));
    decoMatrix(material, geo, decorMatrix.premultiply(frame.matrix));
  };
  const t = s * 0.09;
  const half = s / 2 - t / 2;
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      add(DMAT.wood, worldBox(s, t, t, 1), 0, a * half, b * half);
      add(DMAT.wood, worldBox(t, s, t, 1), a * half, 0, b * half);
      add(DMAT.wood, worldBox(t, t, s, 1), a * half, b * half, 0);
      for (const c of [-1, 1]) add(DMAT.metal, worldBox(t * 1.15, t * 1.15, t * 1.15, 0.3), a * half, b * half, c * half);
    }
  }
  const diag = Math.hypot(s - 2 * t, s - 2 * t);
  for (const side of [-1, 1]) {
    decorMatrix.compose(decorPos.set(0, 0, side * (s * 0.48 + t * 0.2)), decorQuat.setFromEuler(decorEuler.set(0, 0, Math.PI / 4 * side)), decorScale.set(1, 1, 1));
    decoMatrix(DMAT.wood, worldBox(diag, t * 0.9, t * 0.5, 1), decorMatrix.premultiply(frame.matrix));
  }
  const stencil = STENCILS[Math.floor(rand() * STENCILS.length)];
  for (const side of [-1, 1]) {
    decorMatrix.compose(decorPos.set(side * (s * 0.48 + 0.003), 0, 0), decorQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, side * Math.PI / 2), decorScale.set(s * 0.62, s * 0.31, 1));
    decoMatrix(stencil, G.wallPlane, decorMatrix.premultiply(frame.matrix));
  }
}

function addDrum(x, z, material) {
  deco(material, G.cyl, x, 0.44, z, [0, rand() * 6, 0], [0.29, 0.88, 0.29]);
  for (const y of [0.02, 0.3, 0.58, 0.86]) deco(material, G.rib, x, y, z, [0, 0, 0], [0.295, 0.3, 0.295]);
  deco(DMAT.metal, G.cylLow, x + 0.12, 0.885, z + 0.05, [0, 0, 0], [0.035, 0.02, 0.035]);
  deco(DMAT.metal, G.cylLow, x - 0.14, 0.885, z - 0.04, [0, 0, 0], [0.025, 0.02, 0.025]);
  solidOnly(x, z, 0.6, 0.9, 0.6);
}

function addTires(x, z, n) {
  for (let i = 0; i < n; i++) deco(DMAT.rubber, G.tire, x + (rand() - 0.5) * 0.08, 0.12 + i * 0.235, z + (rand() - 0.5) * 0.08, [0, 0, 0], [1, 0.95, 1]);
  solidOnly(x, z, 0.9, n * 0.235 + 0.05, 0.9);
}

function addSandbags(x, z, length, rows, ry) {
  const cos = Math.cos(ry);
  const sin = Math.sin(ry);
  for (let r = 0; r < rows; r++) {
    const n = Math.round(length / 0.6) - (r % 2);
    for (let i = 0; i < n; i++) {
      const t = (i - (n - 1) / 2) * 0.6;
      deco(DMAT.sandbag, G.bag, x + t * cos, 0.1 + r * 0.19, z - t * sin, [0, ry + (rand() - 0.5) * 0.15, (rand() - 0.5) * 0.08], [0.32, 0.11, 0.22]);
    }
  }
  const w = Math.abs(cos) * length + Math.abs(sin) * 0.45;
  const d = Math.abs(sin) * length + Math.abs(cos) * 0.45;
  solidOnly(x, z, w, rows * 0.19 + 0.05, d);
}

function addPallets(x, z, n, ry) {
  for (let p = 0; p < n; p++) {
    const y = p * 0.145;
    for (let i = 0; i < 5; i++) box(DMAT.wood, x + Math.sin(ry) * (i - 2) * 0.24, y + 0.133, z + Math.cos(ry) * (i - 2) * 0.24, 1.2, 0.022, 0.14, ry, 1);
    for (let i = 0; i < 3; i++) box(DMAT.wood, x + Math.sin(ry) * (i - 1) * 0.45, y + 0.072, z + Math.cos(ry) * (i - 1) * 0.45, 1.2, 0.1, 0.1, ry, 1);
    for (let i = 0; i < 3; i++) box(DMAT.wood, x + Math.sin(ry) * (i - 1) * 0.45, y + 0.011, z + Math.cos(ry) * (i - 1) * 0.45, 1.2, 0.022, 0.12, ry, 1);
  }
  solidOnly(x, z, Math.abs(Math.cos(ry)) * 1.2 + Math.abs(Math.sin(ry)) * 1.0, n * 0.145, Math.abs(Math.sin(ry)) * 1.2 + Math.abs(Math.cos(ry)) * 1.0);
}

function addCone(x, z) {
  box(DMAT.black, x, 0.015, z, 0.38, 0.03, 0.38, rand(), 1);
  deco(DMAT.cone, G.cone, x, 0.34, z);
  deco(DMAT.reflective, G.cyl, x, 0.4, z, [0, 0, 0], [0.085, 0.09, 0.085]);
}

function addContainer(x, z, material, ry) {
  const L = 6.06;
  const H = 2.59;
  const W = 2.44;
  box(material, x, H / 2, z, L, H, W, ry, 2.5);
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  for (const lx of [-L / 2, L / 2]) {
    for (const lz of [-W / 2, W / 2]) {
      for (const y of [0.09, H - 0.09]) {
        const [px, pz] = at(lx, lz);
        box(DMAT.black, px, y, pz, 0.2, 0.18, 0.2, ry, 1);
      }
    }
  }
  for (const lz of [-W / 2, W / 2]) {
    for (const y of [0.05, H - 0.05]) {
      const [px, pz] = at(0, lz);
      box(material, px, y, pz, L, 0.1, 0.1, ry, 2);
    }
  }
  const endX = L / 2 + 0.03;
  for (const lz of [-0.85, -0.35, 0.35, 0.85]) {
    const [px, pz] = at(endX, lz);
    deco(DMAT.metal, G.cylLow, px, H / 2, pz, [0, 0, 0], [0.025, H - 0.25, 0.025]);
    const [hx, hz] = at(endX + 0.03, lz);
    box(DMAT.metal, hx, 1.2, hz, 0.06, 0.2, 0.06, ry, 1);
  }
  const [mx, mz] = at(endX - 0.02, 0);
  box(DMAT.black, mx, H / 2, mz, 0.02, H - 0.2, 0.04, ry, 1);
  solidOnly(x, z, Math.abs(c) * L + Math.abs(s) * W, H, Math.abs(s) * L + Math.abs(c) * W);
}

function addLightPole(x, z) {
  const dir = Math.atan2(-x, -z);
  deco(DMAT.metal, G.cylLow, x, 3.5, z, [0, 0, 0], [0.08, 7, 0.08]);
  box(DMAT.concrete, x, 0.15, z, 0.5, 0.3, 0.5, 0, 1);
  const ax = x + Math.sin(dir) * 0.6;
  const az = z + Math.cos(dir) * 0.6;
  box(DMAT.metal, ax, 6.9, az, 0.06, 0.06, 1.2, dir, 1);
  const hx = x + Math.sin(dir) * 1.2;
  const hz = z + Math.cos(dir) * 1.2;
  box(DMAT.black, hx, 6.85, hz, 0.4, 0.14, 0.6, dir, 1);
  box(DMAT.glow, hx, 6.77, hz, 0.32, 0.02, 0.5, dir, 1);
  solidOnly(x, z, 0.3, 7, 0.3);
}

function addFloorDetails() {
  const paint = DMAT.paintYellow;
  const line = (x, z, w, d, material = paint) => deco(material, G.plane, x, 0.004, z, [0, 0, 0], [w, 1, d]);
  for (const s of [-1, 1]) {
    line(0, s * 24, 48, 0.15);
    line(s * 24, 0, 0.15, 48);
  }
  deco(paint, new THREE.RingGeometry(3.4, 3.58, 64).rotateX(-Math.PI / 2), 0, 0.004, 0);
  for (let t = 5; t < 23; t += 2) {
    for (const s of [-1, 1]) {
      line(0, s * t, 0.12, 1, DMAT.paintWhite);
      line(s * t, 0, 1, 0.12, DMAT.paintWhite);
    }
  }
  for (let t = -ARENA + 6; t < ARENA; t += 6) {
    deco(DMAT.seam, G.plane, t, 0.002, 0, [0, 0, 0], [0.025, 1, ARENA * 2]);
    deco(DMAT.seam, G.plane, 0, 0.002, t, [0, 0, 0], [ARENA * 2, 1, 0.025]);
  }
  for (const [x, z] of [[8, 8], [-8, -8], [8, -9.5], [-8, 9.5]]) {
    deco(DMAT.grate, G.plane, x, 0.005, z, [0, 0, 0], [0.8, 1, 0.8]);
  }
  for (const [x, z, r] of [[3, -2, 1.6], [-9, -9, 2.2], [15.5, 12, 1.8], [-16, -12.2, 1.4], [10, 21, 2], [-22, 6, 1.7], [22, -5, 1.5]]) {
    deco(DMAT.puddle, G.plane, x, 0.006, z, [0, rand() * 6, 0], [r * 1.3, 1, r]);
  }
  for (const [x, z, r] of [[6.8, -27.5, 1.2], [-19.5, 26.8, 1], [27, 6.5, 0.9], [-6, 0.5, 0.7], [17, -15, 0.8]]) {
    deco(DMAT.oil, G.plane, x, 0.007, z, [0, rand() * 6, 0], [r * 1.4, 1, r]);
  }
}

function addProps() {
  const drums = [
    [6.5, -28.9, 'drumRed'], [7.2, -28.8, 'drumBlue'], [6.8, -28.15, 'rust'],
    [-6.5, 28.9, 'drumBlue'], [-7.2, 28.85, 'drumRed'],
    [28.9, 19.5, 'rust'], [28.8, 18.8, 'drumRed'], [28.15, 19.2, 'drumBlue'],
    [-28.9, -19.5, 'drumRed'], [-28.85, -6.5, 'rust'], [-28.2, -6.8, 'drumBlue'],
    [16.4, 7.4, 'drumRed'], [-16.4, -7.4, 'drumBlue'],
  ];
  for (const [x, z, m] of drums) addDrum(x, z, DMAT[m]);
  addTires(-28.5, 19.5, 4);
  addTires(-28.3, 18.5, 3);
  addTires(28.5, -6.5, 4);
  addTires(28.5, -19.5, 2);
  addSandbags(10, -7, 3, 4, 0);
  addSandbags(-10, 7, 3, 4, 0);
  addSandbags(-21, -10, 2.4, 3, Math.PI / 2);
  addSandbags(21, 10, 2.4, 3, Math.PI / 2);
  addPallets(6.5, 28.4, 4, 0);
  addPallets(-28.4, 6.5, 3, Math.PI / 2);
  addContainer(-19.5, -ARENA + 1.3, DMAT.containerGreen, 0);
  addContainer(19.5, ARENA - 1.3, DMAT.containerOrange, 0);
  for (const [x, z] of [[-2.6, -4.6], [-1.9, -4.9], [2.6, 4.6], [-3.3, 9.9], [3.3, -9.9], [11.6, -5.6]]) addCone(x, z);
  for (const s of [-1, 1]) {
    addLightPole(s * (ARENA - 0.6), s * (ARENA - 0.6));
    addLightPole(s * (ARENA - 0.6), -s * (ARENA - 0.6));
  }
}

function addSkyline() {
  for (let i = 0; i < 30; i++) {
    const a = i / 30 * Math.PI * 2 + rand() * 0.1;
    const r = 80 + rand() * 55;
    const w = 10 + rand() * 14;
    const d = 10 + rand() * 14;
    const h = 14 + rand() * 46;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    box(DMAT.buildings[i % DMAT.buildings.length], x, h / 2, z, w, h, d, a, 7);
    box(DMAT.roof, x, h + 0.4, z, w * 0.4, 0.8, d * 0.4, a, 4);
  }
  for (let i = 0; i < 46; i++) {
    const a = rand() * Math.PI * 2;
    const r = 36 + rand() * 30;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const h = 7 + rand() * 7;
    deco(DMAT.trunk, G.cylLow, x, h * 0.25, z, [0, 0, 0], [0.22, h * 0.5, 0.22]);
    if (rand() < 0.5) {
      for (let k = 0; k < 3; k++) deco(DMAT.foliageDark, G.pine, x, h * (0.45 + k * 0.18), z, [0, 0, 0], [h * (0.28 - k * 0.07), h * 0.32, h * (0.28 - k * 0.07)]);
    } else {
      for (let k = 0; k < 4; k++) {
        deco(DMAT.foliage, G.sphere, x + (rand() - 0.5) * h * 0.25, h * (0.65 + rand() * 0.2), z + (rand() - 0.5) * h * 0.25, [0, 0, 0], [h * 0.22, h * 0.2, h * 0.22]);
      }
    }
  }
}

// Outer walls
const WALL_H = 5;
addBox(0, -ARENA - 0.5, ARENA * 2 + 2, WALL_H, 1, 'brick');
addBox(0, ARENA + 0.5, ARENA * 2 + 2, WALL_H, 1, 'brick');
addBox(-ARENA - 0.5, 0, 1, WALL_H, ARENA * 2, 'brick');
addBox(ARENA + 0.5, 0, 1, WALL_H, ARENA * 2, 'brick');

// Pillars
for (const [x, z] of [[-12, -12], [12, -12], [-12, 12], [12, 12], [0, -20], [0, 20], [-20, 0], [20, 0]]) {
  addBox(x, z, 2.2, 6, 2.2, 'pillar');
}
[[-12, -12], [12, -12], [-12, 12], [12, 12], [0, -20], [0, 20], [-20, 0], [20, 0]].forEach(([x, z], i) => addPillarDetails(x, z, i));

// Low cover walls
addBox(-6, -4, 6, 1.3, 0.8, 'coverLow');
addCoverCap(-6, -4, 6, 1.3, 0.8);
addBox(6, 4, 6, 1.3, 0.8, 'coverLow');
addCoverCap(6, 4, 6, 1.3, 0.8);
addBox(-4, 7, 0.8, 1.3, 5, 'coverLow');
addCoverCap(-4, 7, 0.8, 1.3, 5);
addBox(4, -7, 0.8, 1.3, 5, 'coverLow');
addCoverCap(4, -7, 0.8, 1.3, 5);
addBox(-20, -18, 8, 2.5, 0.8, 'coverHigh');
addCoverCap(-20, -18, 8, 2.5, 0.8);
addBox(20, 18, 8, 2.5, 0.8, 'coverHigh');
addCoverCap(20, 18, 8, 2.5, 0.8);
addBox(18, -21, 0.8, 2.5, 7, 'coverHigh');
addCoverCap(18, -21, 0.8, 2.5, 7);
addBox(-18, 21, 0.8, 2.5, 7, 'coverHigh');
addCoverCap(-18, 21, 0.8, 2.5, 7);

// Crates (some stacked so you can climb)
const crates = [
  [8, -14, 1.6], [9.6, -14, 1.6], [8.8, -14, 1.6, 1.6],
  [-8, 14, 1.6], [-9.6, 14, 1.6], [-8.8, 14, 1.6, 1.6],
  [-15, -6, 1.4], [15, 6, 1.4], [-24, 10, 1.8], [24, -10, 1.8],
  [-25, -26, 2], [-23, -26, 1.4], [25, 26, 2], [23, 26, 1.4],
  [2, 13, 1.2], [-2, -13, 1.2], [14, -2, 1.2], [-14, 2, 1.2],
];
for (const [x, z, s, y = 0] of crates) addBox(x, z, s, s, s, 'crate', y);

addWallDetails();
addFloorDetails();
addProps();
addSkyline();
finalizeDecor();

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

function lineBlocked(from, to) {
  tmpV.subVectors(to, from);
  const dist = tmpV.length();
  raycaster.set(from, tmpV.normalize());
  raycaster.far = dist;
  const hit = raycaster.intersectObjects(worldMeshes, false);
  raycaster.far = Infinity;
  return hit.length > 0;
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
  shot: (s) => { playNoise(s.vol, s.freq, s.dur); playTone(s.vol * 0.6, s.tone, 35, s.dur * 0.8, 'triangle'); },
  pump: () => { later(200, () => click(0.14, 2200)); later(420, () => click(0.16, 2600)); },
  bolt: () => { later(250, () => click(0.1, 3000)); later(420, () => click(0.12, 2400)); later(650, () => click(0.12, 2600)); later(850, () => click(0.1, 3000)); },
  magOut: () => click(0.1, 2000),
  magIn: () => click(0.14, 2800),
  rack: () => { click(0.12, 3000); later(90, () => click(0.12, 2400)); },
  shellIn: () => playTone(0.08, 700, 480, 0.05, 'square'),
  switch: () => { click(0.08, 1800); later(120, () => click(0.06, 2600)); },
  enemyShot: (dist) => playNoise(Math.max(0.03, 0.25 - dist * 0.006), 1400, 0.15),
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
weaponScene.add(new THREE.HemisphereLight(0xbfdcff, 0x7a6248, 0.4));
const vmKey = new THREE.DirectionalLight(0xfff0d8, 2.2);
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

const arsenal = WEAPONS.map((def) => {
  const model = buildWeaponModel(def);
  model.group.visible = false;
  viewmodel.add(model.group);
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

function spawnImpact(point, color, normal = null, sparks = false) {
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
    spawnSprite(point, 0xffc46a, 0.035, 0.12 + Math.random() * 0.12, vel, { mat: { blending: THREE.AdditiveBlending }, fx: { gravity: 9.8 } });
  }
}

const casingGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
const casingMats = {
  brass: new THREE.MeshStandardMaterial({ color: 0xe0ac48, roughness: 0.28, metalness: 1 }),
  hull: new THREE.MeshStandardMaterial({ color: 0xd2232a, roughness: 0.5 }),
};
const CASINGS = { glock: [0.0048, 0.019], mp5: [0.0048, 0.019], ak47: [0.0056, 0.039], r870: [0.0105, 0.07], m24: [0.006, 0.051] };

function ejectCasing(w) {
  const [r, len] = CASINGS[w.def.id];
  const mesh = new THREE.Mesh(casingGeo, w.def.id === 'r870' ? casingMats.hull : casingMats.brass);
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

function spawnTracer(from, to, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
  const mesh = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  scene.add(mesh);
  effects.push({ mesh, life: 0.08, max: 0.08, grow: 0, ownGeo: true });
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

// ---------- Enemies ----------
const enemies = [];
const GEO = {
  torso: new THREE.CapsuleGeometry(0.19, 0.32, 6, 16),
  pelvis: new THREE.CapsuleGeometry(0.15, 0.12, 4, 12),
  vest: new THREE.BoxGeometry(0.44, 0.44, 0.3),
  neck: new THREE.CylinderGeometry(0.055, 0.065, 0.12, 12),
  head: new THREE.SphereGeometry(0.125, 20, 16),
  helmet: new THREE.SphereGeometry(0.15, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.47),
  thigh: new THREE.CapsuleGeometry(0.085, 0.32, 4, 12),
  shin: new THREE.CapsuleGeometry(0.07, 0.34, 4, 12),
  boot: new THREE.BoxGeometry(0.13, 0.1, 0.28),
  upperArm: new THREE.CapsuleGeometry(0.06, 0.22, 4, 10),
  forearm: new THREE.CapsuleGeometry(0.052, 0.22, 4, 10),
};
const SHARED_MATS = {
  gear: new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.7, metalness: 0.1 }),
  eye: new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.3 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x22160f, roughness: 0.6 }),
  lens: new THREE.MeshStandardMaterial({ color: 0x0c1420, metalness: 0.9, roughness: 0.05 }),
  patch: new THREE.MeshStandardMaterial({ color: 0xffc61a, roughness: 0.6, emissive: 0xffc61a, emissiveIntensity: 0.15 }),
  metal: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.3, metalness: 1 }),
  gun: gunMat,
};
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
      ['vest', box3(0.1, 0.14, 0.07), [px, 1.2, -0.18]],
      ['vest', box3(0.105, 0.03, 0.078), [px, 1.275, -0.18]],
      ['gear', box3(0.07, 0.03, 0.03), [px, 1.3, -0.18]],
    ]),
    ['vest', box3(0.18, 0.1, 0.04), [0, 1.43, -0.165]],
    ['patch', box3(0.07, 0.045, 0.005), [0.11, 1.5, -0.152]],
    ['vest', box3(0.07, 0.14, 0.07), [-0.21, 1.42, -0.08]],
    ['gear', unitCyl, [-0.21, 1.66, -0.08], [0, 0, 0], [0.006, 0.36, 0.006]],
    ['gear', unitCyl, [0, 1.07, 0], [0, 0, 0], [0.2, 0.06, 0.16]],
    ['metal', box3(0.06, 0.04, 0.02), [0, 1.07, -0.165]],
    ['gear', box3(0.07, 0.17, 0.12), [0.23, 0.97, 0]],
    ['vest', box3(0.32, 0.36, 0.15), [0, 1.36, 0.22]],
    ['vest', box3(0.3, 0.06, 0.16), [0, 1.52, 0.225]],
    ...[-1, 1].map((sx) => ['vest', box3(0.05, 0.18, 0.1), [sx * 0.18, 1.3, 0.22]]),
    ['pants', unitCyl, [0, 1.58, 0.22], [0, 0, HALF_PI], [0.055, 0.3, 0.055]],
    ['uniform', new THREE.CylinderGeometry(0.1, 0.11, 0.05, 14), [0, 1.585, 0]],
    ['skin', GEO.neck, [0, 1.62, 0]],
    ...[-1, 1].flatMap((sx) => [
      ['eye', unitSphere, [sx * 0.042, 1.785, -0.11], [0, 0, 0], [0.018, 0.014, 0.012]],
      ['dark', unitSphere, [sx * 0.042, 1.785, -0.12], [0, 0, 0], [0.008, 0.008, 0.005]],
      ['dark', box3(0.04, 0.008, 0.01), [sx * 0.042, 1.806, -0.116], [0, 0, -sx * 0.12]],
      ['skin', unitSphere, [sx * 0.124, 1.77, 0], [0, 0, 0], [0.016, 0.03, 0.022]],
      ['gear', box3(0.012, 0.15, 0.012), [sx * 0.122, 1.735, -0.02]],
      ['gear', box3(0.02, 0.03, 0.12), [sx * 0.148, 1.84, 0.01]],
    ]),
    ['skin', box3(0.022, 0.042, 0.03), [0, 1.76, -0.124]],
    ['dark', box3(0.045, 0.006, 0.01), [0, 1.725, -0.117]],
    ['gear', new THREE.TorusGeometry(0.146, 0.008, 6, 24), [0, 1.84, 0], [HALF_PI, 0, 0]],
    ['gear', box3(0.06, 0.05, 0.02), [0, 1.9, -0.122], [-0.6, 0, 0]],
    ['lens', box3(0.17, 0.045, 0.02), [0, 1.835, -0.148], [-0.2, 0, 0]],
  ]),
  upperArm: bake([
    ['uniform', GEO.upperArm, [0, -0.15, 0]],
    ['vest', unitSphere, [0, -0.02, 0], [0, 0, 0], [0.075, 0.06, 0.075]],
    ['patch', box3(0.005, 0.05, 0.06), [0.062, -0.1, 0]],
  ]),
  forearm: bake([
    ['uniform', GEO.forearm, [0, -0.14, 0]],
    ['gear', unitSphere, [0, -0.01, 0.02], [0, 0, 0], [0.062, 0.07, 0.06]],
    ['uniform', unitCyl, [0, -0.25, 0], [0, 0, 0], [0.058, 0.04, 0.058]],
    ['gear', unitSphere, [0, -0.29, 0], [0, 0, 0], [0.048, 0.06, 0.04]],
    ['gear', box3(0.06, 0.05, 0.03), [0, -0.33, -0.02]],
  ]),
  shin: bake([
    ['gear', box3(0.12, 0.13, 0.04), [0, -0.02, -0.08]],
    ['boots', GEO.boot, [0, -0.43, -0.04]],
    ['gear', box3(0.14, 0.03, 0.3), [0, -0.485, -0.04]],
    ['boots', unitCyl, [0, -0.36, 0], [0, 0, 0], [0.078, 0.12, 0.078]],
    ['dark', box3(0.06, 0.006, 0.12), [0, -0.378, -0.11]],
  ]),
  rifle: bake([
    ['gun', box3(0.06, 0.09, 0.42), [0, 0, 0]],
    ['gear', box3(0.07, 0.08, 0.26), [0, 0.005, -0.34]],
    ['gun', unitCyl, [0, 0.02, -0.55], [HALF_PI, 0, 0], [0.012, 0.2, 0.012]],
    ['gun', unitCyl, [0, 0.02, -0.66], [HALF_PI, 0, 0], [0.018, 0.06, 0.018]],
    ['gun', box3(0.045, 0.18, 0.08), [0, -0.11, -0.08], [0.25, 0, 0]],
    ['gear', box3(0.04, 0.11, 0.05), [0, -0.08, 0.08], [-0.3, 0, 0]],
    ['gun', unitCyl, [0, 0, 0.24], [HALF_PI, 0, 0], [0.018, 0.2, 0.018]],
    ['gear', box3(0.05, 0.11, 0.18), [0, -0.025, 0.36]],
    ['gun', box3(0.03, 0.03, 0.06), [0, 0.06, -0.05]],
    ['gear', unitCyl, [0, 0.09, -0.05], [HALF_PI, 0, 0], [0.022, 0.11, 0.022]],
    ['lens', unitCyl, [0, 0.09, -0.106], [HALF_PI, 0, 0], [0.019, 0.004, 0.019]],
    ['gear', box3(0.02, 0.008, 0.5), [0.035, -0.05, 0.05]],
  ]),
};
const POCKETS = [-1, 1].map((side) => bake([['pants', box3(0.06, 0.14, 0.12), [side * 0.085, -0.24, 0]]]));

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

function createEnemy(x, z, wave) {
  const group = new THREE.Group();
  const std = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const mats = {
    uniform: std(COLORS.uniform, 0.85),
    pants: std(COLORS.pants, 0.9),
    vest: std(COLORS.vest, 0.8),
    helmet: std(COLORS.helmet, 0.6, 0.1),
    skin: std(COLORS.skin, 0.6),
    boots: std(COLORS.boots, 0.7),
  };

  const torso = part(GEO.torso, mats.uniform, 0, 1.33, 0, group);
  torso.scale.set(1.15, 1, 0.75);
  attach(TEMPLATES.body, mats, group);
  const head = part(GEO.head, mats.skin, 0, 1.76, 0, group);
  const helmet = part(GEO.helmet, mats.helmet, 0, 1.8, 0.01, group);

  const legL = createLeg(-1, mats, group);
  const legR = createLeg(1, mats, group);
  createArm(0.24, [-1.1, 0, -0.2], [-0.9, 0, 0], mats, group);
  createArm(-0.24, [-1.3, 0, 0.5], [-0.25, 0, 0], mats, group);

  const rifle = new THREE.Group();
  rifle.position.set(0.16, 1.32, -0.5);
  group.add(rifle);
  attach(TEMPLATES.rifle, mats, rifle);

  group.position.set(x, 0, z);
  scene.add(group);

  const enemy = {
    group, legL, legR, mats,
    hitboxes: [torso, head, helmet, ...legL.hitboxes, ...legR.hitboxes],
    health: 100,
    speed: 2.4 + Math.min(wave, 10) * 0.25 + Math.random() * 0.6,
    fireCooldown: 1.5 + Math.random() * 1.5,
    fireRate: Math.max(0.9, 2.2 - wave * 0.12),
    accuracy: Math.min(0.75, 0.35 + wave * 0.04),
    strafe: Math.random() < 0.5 ? -1 : 1,
    strafeTimer: 1 + Math.random() * 2,
    path: null,
    repath: 0,
    walk: Math.random() * 10,
    flash: 0,
    dead: false,
    deathTime: 0,
  };
  for (const m of enemy.hitboxes) m.userData.enemy = enemy;
  head.userData.head = true;
  helmet.userData.head = true;
  enemies.push(enemy);
  return enemy;
}

function removeEnemy(enemy) {
  scene.remove(enemy.group);
  for (const m of Object.values(enemy.mats)) m.dispose();
  enemies.splice(enemies.indexOf(enemy), 1);
}

function enemyShootables() {
  const list = [];
  for (const e of enemies) {
    if (!e.dead) list.push(...e.hitboxes);
  }
  return list;
}

// ---------- Pickups ----------
const pickups = [];
const PICKUP_MATS = {
  kit: new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.35 }),
  cross: new THREE.MeshStandardMaterial({ color: 0xe02020, roughness: 0.4, emissive: 0xe02020, emissiveIntensity: 0.4 }),
  can: new THREE.MeshStandardMaterial({ color: 0x4f6b2c, roughness: 0.45, metalness: 0.6 }),
  stencil: new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5, emissive: 0xffd23f, emissiveIntensity: 0.3 }),
  handle: new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.4, metalness: 0.8 }),
  latch: new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.25, metalness: 1 }),
  label: decalMaterial(textTexture(['7.62 MM', 'BALL M80'], { fg: '#ffd23f', font: 'bold 84px Impact, Arial Black, sans-serif' }), { emissive: 0x332a08 }),
  medLabel: decalMaterial(textTexture(['FIRST AID'], { fg: '#d91e1e', font: 'bold 92px Impact, Arial Black, sans-serif' })),
};
const PICKUP_GLOW = {
  health: new THREE.MeshBasicMaterial({ color: 0x2ee86b, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  ammo: new THREE.MeshBasicMaterial({ color: 0xffb627, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
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
};

const game = {
  state: 'menu', // menu | playing | paused | over
  score: 0,
  wave: 0,
  waveDelay: 0,
  kills: 0,
  damageFlash: 0,
};

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
const settings = { lefty: localStorage.getItem('fps-lefty') === '1' };
let mouseDown = false;
let aimDown = false;
let triggerQueued = false;

const SPAWN_POINTS = [];
for (let i = -26; i <= 26; i += 13) {
  SPAWN_POINTS.push([i, -27], [i, 27], [-27, i], [27, i]);
}

function resetGame() {
  for (const e of [...enemies]) removeEnemy(e);
  for (const p of [...pickups]) removePickup(p);
  clearDecals();
  Object.assign(player, {
    yaw: 0, pitch: 0, onGround: true, health: MAX_HEALTH, switchTimer: 0, reloading: 0, reloadPose: 0,
    fireCooldown: 0, ejectAt: 0, cycle: 10, flashTime: 0, ads: 0, sprintPose: 0, recoil: 0, bob: 0,
  });
  for (const w of arsenal) {
    w.mag = w.def.magSize;
    w.reserve = w.def.reserve;
  }
  equip(2);
  player.switchTo = player.current;
  player.pos.set(0, 0, 0);
  player.vel.set(0, 0, 0);
  Object.assign(game, { score: 0, wave: 0, waveDelay: 1, kills: 0, damageFlash: 0 });
  updateHud();
}

function startWave() {
  game.wave++;
  const count = 3 + game.wave * 2;
  const candidates = SPAWN_POINTS
    .filter(([x, z]) => Math.hypot(x - player.pos.x, z - player.pos.z) > 18)
    .sort(() => Math.random() - 0.5);
  for (let i = 0; i < count; i++) {
    const [x, z] = candidates[i % candidates.length];
    const pos = { x: x + (Math.random() - 0.5) * 3, z: z + (Math.random() - 0.5) * 3 };
    pushOut(pos, ENEMY_RADIUS, 0, 2.3);
    createEnemy(pos.x, pos.z, game.wave);
  }
  showBanner(`Wave ${game.wave}`);
  updateHud();
}

// ---------- HUD ----------
const $ = (id) => document.getElementById(id);
const hud = {
  score: $('score'), wave: $('wave'), enemies: $('enemies'),
  healthFill: $('health-fill'), healthText: $('health-text'),
  mag: $('mag'), reserve: $('reserve'), reloadHint: $('reload-hint'),
  weaponName: $('weapon-name'), slots: $('slots'), scope: $('scope'), crosshair: $('crosshair'),
  hitmarker: $('hitmarker'), damage: $('damage'), banner: $('banner'),
  overlay: $('overlay'), title: $('title'), subtitle: $('subtitle'), play: $('play'),
};

function updateHud() {
  hud.score.textContent = game.score;
  hud.wave.textContent = game.wave;
  hud.enemies.textContent = enemies.filter((e) => !e.dead).length;
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
  else if (w.mag <= Math.ceil(w.def.magSize * 0.2)) hud.reloadHint.textContent = settings.lefty ? 'Press U to reload' : 'Press R to reload';
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

const leftyBox = document.getElementById('lefty');
const controlsTable = document.getElementById('controls');
function applyHandedness() {
  leftyBox.checked = settings.lefty;
  controlsTable.classList.toggle('lefty', settings.lefty);
}
leftyBox.addEventListener('change', () => {
  settings.lefty = leftyBox.checked;
  localStorage.setItem('fps-lefty', settings.lefty ? '1' : '0');
  applyHandedness();
  updateHud();
});
applyHandedness();

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
      showOverlay('Paused', `Wave ${game.wave} - Score ${game.score}`, 'Click to resume');
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

const fireButton = () => (settings.lefty ? 2 : 0);
const aimButton = () => (settings.lefty ? 0 : 2);

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
  if (index === player.switchTo) return;
  player.switchTo = index;
  player.reloading = 0;
  if (player.switchTimer <= 0 || player.switchTimer < SWITCH_TIME / 2) player.switchTimer = SWITCH_TIME;
  sfx.switch();
  updateHud();
}

function startReload() {
  const w = arsenal[player.current];
  if (player.switchTimer > 0 || player.reloading > 0 || w.mag >= w.def.magSize || w.reserve === 0) return;
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

  const targets = [...worldMeshes, ...enemyShootables()];
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
    if (i < 4) spawnTracer(muzzleWorld, end, 0xffd27a);
    if (!hits.length) continue;
    const hit = hits[0];
    const enemy = hit.object.userData.enemy;
    if (enemy) {
      const headshot = !!hit.object.userData.head;
      let dmg = headshot ? def.headDamage : def.damage;
      if (def.falloff) dmg *= Math.max(0.25, 1 - hit.distance / def.falloff);
      const entry = damage.get(enemy) || { dmg: 0, headshot: false };
      entry.dmg += dmg;
      entry.headshot = entry.headshot || headshot;
      damage.set(enemy, entry);
      spawnImpact(hit.point, 0x8a0a0a, forward.clone().negate());
    } else {
      const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
      spawnImpact(hit.point, 0xcdbfa6, normal, true);
      spawnDecal(hit);
    }
  }
  for (const [enemy, { dmg, headshot }] of damage) damageEnemy(enemy, dmg, headshot);
  updateHud();
}

function damageEnemy(enemy, amount, headshot) {
  enemy.health -= amount;
  enemy.flash = 0.1;
  if (enemy.health <= 0) {
    enemy.dead = true;
    enemy.deathTime = 0;
    game.kills++;
    game.score += headshot ? 150 : 100;
    sfx.kill();
    showHitmarker(true);
    const roll = Math.random();
    if (roll < 0.25) spawnPickup(enemy.group.position.x, enemy.group.position.z, 'health');
    else if (roll < 0.6) spawnPickup(enemy.group.position.x, enemy.group.position.z, 'ammo');
  } else {
    sfx.hit();
    showHitmarker(false);
  }
  updateHud();
}

function damagePlayer(amount) {
  player.health -= amount;
  game.damageFlash = Math.min(1, game.damageFlash + 0.5);
  sfx.hurt();
  if (player.health <= 0) {
    player.health = 0;
    game.state = 'over';
    document.exitPointerLock();
    showOverlay('You died', `Wave ${game.wave} - ${game.kills} kills - Score ${game.score}`, 'Play again');
  }
  updateHud();
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
  const scoped = def.id === 'm24' && ads > 0.92;
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

  player.flashTime -= dt;
  if (player.flashTime <= 0) flash.visible = false;
  flashLight.intensity = Math.max(0, flashLight.intensity - dt * 60);
  worldFlash.intensity = Math.max(0, worldFlash.intensity - dt * 120);
  worldFlash.position.copy(camera.position);
}

const eyeFrom = new THREE.Vector3();
const eyeTo = new THREE.Vector3();

function updateEnemies(dt) {
  const target = player.pos;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    const g = e.group;

    if (e.dead) {
      e.deathTime += dt;
      g.rotation.x = Math.min(Math.PI / 2, e.deathTime * 5);
      g.position.y = -Math.max(0, e.deathTime - 1) * 1.5;
      if (e.deathTime > 2.2) removeEnemy(e);
      continue;
    }

    const dx = target.x - g.position.x;
    const dz = target.z - g.position.z;
    const dist = Math.hypot(dx, dz);
    const nx = dx / (dist || 1);
    const nz = dz / (dist || 1);
    g.rotation.y = Math.atan2(-dx, -dz);

    eyeFrom.set(g.position.x, ENEMY_EYE, g.position.z);
    eyeTo.set(player.pos.x, player.pos.y + PLAYER_HEIGHT - 0.1, player.pos.z);
    const canSee = dist < 45 && !lineBlocked(eyeFrom, eyeTo);

    // Movement: approach, keep some distance when the player is visible, and strafe.
    e.strafeTimer -= dt;
    if (e.strafeTimer <= 0) {
      e.strafe *= -1;
      e.strafeTimer = 1 + Math.random() * 2.5;
    }
    let mx = 0;
    let mz = 0;
    const preferred = canSee ? 9 : 2;
    if (dist > preferred) {
      e.repath -= dt;
      if (e.repath <= 0 || !e.path) {
        e.path = findPath(g.position.x, g.position.z, target.x, target.z);
        e.repath = 0.4 + Math.random() * 0.4;
      }
      while (e.path && e.path.length > 1 && Math.hypot(e.path[0].x - g.position.x, e.path[0].z - g.position.z) < 0.5) e.path.shift();
      if (e.path && e.path.length && !(canSee && dist < 4)) {
        const wx = e.path[0].x - g.position.x;
        const wz = e.path[0].z - g.position.z;
        const wl = Math.hypot(wx, wz) || 1;
        mx += wx / wl;
        mz += wz / wl;
      } else {
        mx += nx;
        mz += nz;
      }
    } else if (dist < preferred - 3) {
      mx -= nx;
      mz -= nz;
    }
    if (canSee) { mx += -nz * e.strafe * 0.6; mz += nx * e.strafe * 0.6; }
    for (const o of enemies) {
      if (o === e || o.dead) continue;
      const ox = g.position.x - o.group.position.x;
      const oz = g.position.z - o.group.position.z;
      const od = Math.hypot(ox, oz);
      if (od < 1.6 && od > 0.001) { mx += (ox / od) * (1.6 - od); mz += (oz / od) * (1.6 - od); }
    }
    const ml = Math.hypot(mx, mz);
    if (ml > 0.01) {
      g.position.x += (mx / ml) * e.speed * dt;
      g.position.z += (mz / ml) * e.speed * dt;
      e.walk += dt * e.speed * 3;
    }
    pushOut(g.position, ENEMY_RADIUS, 0, 2.3);
    g.position.x = Math.max(-ARENA + 1, Math.min(ARENA - 1, g.position.x));
    g.position.z = Math.max(-ARENA + 1, Math.min(ARENA - 1, g.position.z));

    const swing = Math.sin(e.walk);
    e.legL.hip.rotation.x = swing * 0.55;
    e.legR.hip.rotation.x = -swing * 0.55;
    e.legL.knee.rotation.x = Math.max(0, -Math.cos(e.walk)) * 0.8;
    e.legR.knee.rotation.x = Math.max(0, Math.cos(e.walk)) * 0.8;

    e.flash = Math.max(0, e.flash - dt);
    for (const m of Object.values(e.mats)) {
      m.emissive.setHex(e.flash > 0 ? 0xff5040 : 0x000000);
      m.emissiveIntensity = 0.6;
    }

    // Shooting
    e.fireCooldown -= dt;
    if (canSee && e.fireCooldown <= 0) {
      e.fireCooldown = e.fireRate * (0.7 + Math.random() * 0.6);
      const playerSpeed = Math.hypot(player.vel.x, player.vel.z);
      const chance = e.accuracy * Math.max(0.2, 1 - dist / 40) * (playerSpeed > 7 ? 0.6 : playerSpeed > 1 ? 0.8 : 1);
      const hit = Math.random() < chance;
      const muzzle = tmpV.copy(ENEMY_MUZZLE).applyMatrix4(g.matrixWorld).clone();
      const aim = eyeTo.clone();
      aim.y -= 0.3;
      if (!hit) aim.add(tmpV2.set((Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 2.5));
      spawnTracer(muzzle, aim, 0xffb347);
      sfx.enemyShot(dist);
      if (hit) damagePlayer(6 + Math.min(game.wave, 8));
      if (game.state !== 'playing') return;
    }

    // Melee if right on top of the player
    if (dist < 1.1 && Math.abs(player.pos.y) < 1) {
      e.meleeCooldown = (e.meleeCooldown || 0) - dt;
      if (e.meleeCooldown <= 0) {
        e.meleeCooldown = 0.8;
        damagePlayer(10);
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
  updatePlayer(dt);
  if (game.state !== 'playing') return;
  updateEnemies(dt);
  if (game.state !== 'playing') return;
  updatePickups(dt);

  const alive = enemies.filter((e) => !e.dead).length;
  if (alive !== Number(hud.enemies.textContent)) updateHud();
  if (alive === 0 && enemies.length === 0) {
    if (game.waveDelay <= 0) {
      game.waveDelay = game.wave === 0 ? 1 : 3;
      if (game.wave > 0) {
        showBanner(`Wave ${game.wave} cleared`);
        for (const w of arsenal) w.reserve += w.def.magSize;
        player.health = Math.min(MAX_HEALTH, player.health + 20);
        updateHud();
      }
    }
    game.waveDelay -= dt;
    if (game.waveDelay <= 0) startWave();
  }
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
camera.position.set(0, PLAYER_HEIGHT, 0);
camera.rotation.set(0, 0, 0);
frame();
