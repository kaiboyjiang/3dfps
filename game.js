import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
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

const COLORS = {
  sky: 0x5f6870,
  floor: 0x6b6f72,
  wall: 0x80878c,
  pillar: 0xd4d8dc,
  crate: 0x8f8268,
  enemy: 0x8a5a55,
  enemyHead: 0x6e4743,
  eye: 0xe0c27a,
  gun: 0x50555a,
  health: 0x7f9c7a,
  ammo: 0xb9a77a,
};

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.sky);
scene.fog = new THREE.Fog(COLORS.sky, 25, 75);

const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 200);
camera.rotation.order = 'YXZ';
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xc9ced2, 0x5a5d60, 1.2));
const sun = new THREE.DirectionalLight(0xfff1dc, 1.4);
sun.position.set(18, 30, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35, near: 1, far: 80 });
scene.add(sun);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  weaponCamera.aspect = camera.aspect;
  weaponCamera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Textures ----------
function canvasTexture(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

const floorTex = canvasTexture(256, (g, s) => {
  g.fillStyle = '#7a7e81';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 400; i++) {
    const v = 110 + Math.random() * 30;
    g.fillStyle = `rgba(${v},${v + 3},${v + 5},0.25)`;
    g.fillRect(Math.random() * s, Math.random() * s, 3, 3);
  }
  g.strokeStyle = '#5e6265';
  g.lineWidth = 4;
  g.strokeRect(0, 0, s, s);
}, ARENA);

const crateTex = canvasTexture(128, (g, s) => {
  g.fillStyle = '#8f8268';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = '#6b604b';
  g.lineWidth = 10;
  g.strokeRect(5, 5, s - 10, s - 10);
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(8, 8); g.lineTo(s - 8, s - 8);
  g.moveTo(s - 8, 8); g.lineTo(8, s - 8);
  g.stroke();
});

const wallTex = canvasTexture(128, (g, s) => {
  g.fillStyle = '#80878c';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = '#6c7277';
  g.lineWidth = 3;
  for (let y = 0; y <= s; y += 32) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke();
    const off = (y / 32) % 2 ? 32 : 0;
    for (let x = off; x <= s; x += 64) {
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke();
    }
  }
});

// ---------- World ----------
const solids = [];      // { min: Vector3, max: Vector3 }
const worldMeshes = []; // meshes that block bullets

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA * 2, ARENA * 2),
  new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
worldMeshes.push(floor);

function addBox(x, z, w, h, d, kind, y = 0) {
  let material;
  if (kind === 'crate') {
    material = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.85 });
  } else {
    const tex = wallTex.clone();
    tex.repeat.set(Math.max(1, Math.round(Math.max(w, d) / 2)), Math.max(1, Math.round(h / 2)));
    tex.needsUpdate = true;
    material = new THREE.MeshStandardMaterial({
      map: tex,
      color: kind === 'pillar' ? COLORS.pillar : 0xffffff,
      roughness: 0.9,
    });
  }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  worldMeshes.push(mesh);
  solids.push({
    min: new THREE.Vector3(x - w / 2, y, z - d / 2),
    max: new THREE.Vector3(x + w / 2, y + h, z + d / 2),
  });
}

// Outer walls
const WALL_H = 5;
addBox(0, -ARENA - 0.5, ARENA * 2 + 2, WALL_H, 1, 'wall');
addBox(0, ARENA + 0.5, ARENA * 2 + 2, WALL_H, 1, 'wall');
addBox(-ARENA - 0.5, 0, 1, WALL_H, ARENA * 2, 'wall');
addBox(ARENA + 0.5, 0, 1, WALL_H, ARENA * 2, 'wall');

// Pillars
for (const [x, z] of [[-12, -12], [12, -12], [-12, 12], [12, 12], [0, -20], [0, 20], [-20, 0], [20, 0]]) {
  addBox(x, z, 2.2, 6, 2.2, 'pillar');
}

// Low cover walls
addBox(-6, -4, 6, 1.3, 0.8, 'wall');
addBox(6, 4, 6, 1.3, 0.8, 'wall');
addBox(-4, 7, 0.8, 1.3, 5, 'wall');
addBox(4, -7, 0.8, 1.3, 5, 'wall');
addBox(-20, -18, 8, 2.5, 0.8, 'wall');
addBox(20, 18, 8, 2.5, 0.8, 'wall');
addBox(18, -21, 0.8, 2.5, 7, 'wall');
addBox(-18, 21, 0.8, 2.5, 7, 'wall');

// Crates (some stacked so you can climb)
const crates = [
  [8, -14, 1.6], [9.6, -14, 1.6], [8.8, -14, 1.6, 1.6],
  [-8, 14, 1.6], [-9.6, 14, 1.6], [-8.8, 14, 1.6, 1.6],
  [-15, -6, 1.4], [15, 6, 1.4], [-24, 10, 1.8], [24, -10, 1.8],
  [-25, -26, 2], [-23, -26, 1.4], [25, 26, 2], [23, 26, 1.4],
  [2, 13, 1.2], [-2, -13, 1.2], [14, -2, 1.2], [-14, 2, 1.2],
];
for (const [x, z, s, y = 0] of crates) addBox(x, z, s, s, s, 'crate', y);

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
const gunMat = new THREE.MeshStandardMaterial({ color: COLORS.gun, roughness: 0.5, metalness: 0.3, emissive: 0x1e2022 });
const weaponScene = new THREE.Scene();
const weaponCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 10);
weaponScene.add(new THREE.HemisphereLight(0xd6dadd, 0x45484b, 1.3));
const vmKey = new THREE.DirectionalLight(0xfff1dc, 1.8);
vmKey.position.set(-1, 2, 1.5);
weaponScene.add(vmKey);
const vmRim = new THREE.DirectionalLight(0xbcc6d0, 0.8);
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

function spawnImpact(point, color) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 6, 6),
    new THREE.MeshBasicMaterial({ color, transparent: true }),
  );
  mesh.position.copy(point);
  scene.add(mesh);
  effects.push({ mesh, life: 0.25, max: 0.25, grow: 3 });
}

function spawnTracer(from, to, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
  const mesh = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  scene.add(mesh);
  effects.push({ mesh, life: 0.08, max: 0.08, grow: 0 });
}

function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life -= dt;
    const k = Math.max(0, e.life / e.max);
    e.mesh.material.opacity = k;
    if (e.grow) e.mesh.scale.setScalar(1 + (1 - k) * e.grow);
    if (e.life <= 0) {
      scene.remove(e.mesh);
      e.mesh.geometry.dispose();
      e.mesh.material.dispose();
      effects.splice(i, 1);
    }
  }
}

// ---------- Enemies ----------
const enemies = [];
const enemyBodyGeo = new THREE.BoxGeometry(0.8, 1.2, 0.5);
const enemyHeadGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
const enemyEyeGeo = new THREE.BoxGeometry(0.36, 0.08, 0.05);
const enemyLegGeo = new THREE.BoxGeometry(0.25, 0.6, 0.25);
const enemyGunGeo = new THREE.BoxGeometry(0.08, 0.1, 0.5);
const eyeMat = new THREE.MeshBasicMaterial({ color: COLORS.eye });

function createEnemy(x, z, wave) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: COLORS.enemy, roughness: 0.7, emissive: 0x000000 });
  const headMat = new THREE.MeshStandardMaterial({ color: COLORS.enemyHead, roughness: 0.7, emissive: 0x000000 });

  const body = new THREE.Mesh(enemyBodyGeo, bodyMat);
  body.position.y = 1.2;
  const head = new THREE.Mesh(enemyHeadGeo, headMat);
  head.position.y = 2.05;
  const eye = new THREE.Mesh(enemyEyeGeo, eyeMat);
  eye.position.set(0, 2.08, -0.26);
  const legL = new THREE.Mesh(enemyLegGeo, bodyMat);
  legL.position.set(-0.2, 0.3, 0);
  const legR = legL.clone();
  legR.position.x = 0.2;
  const weapon = new THREE.Mesh(enemyGunGeo, gunMat);
  weapon.position.set(0.45, 1.25, -0.3);

  for (const m of [body, head, legL, legR, weapon]) { m.castShadow = true; }
  group.add(body, head, eye, legL, legR, weapon);
  group.position.set(x, 0, z);
  scene.add(group);

  const enemy = {
    group, body, head, legL, legR, bodyMat, headMat,
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
  body.userData.enemy = enemy;
  head.userData.enemy = enemy;
  head.userData.head = true;
  legL.userData.enemy = enemy;
  legR.userData.enemy = enemy;
  enemies.push(enemy);
  return enemy;
}

function removeEnemy(enemy) {
  scene.remove(enemy.group);
  enemy.bodyMat.dispose();
  enemy.headMat.dispose();
  enemies.splice(enemies.indexOf(enemy), 1);
}

function enemyShootables() {
  const list = [];
  for (const e of enemies) {
    if (!e.dead) list.push(e.body, e.head, e.legL, e.legR);
  }
  return list;
}

// ---------- Pickups ----------
const pickups = [];
const pickupGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);

function spawnPickup(x, z, type) {
  const mesh = new THREE.Mesh(pickupGeo, new THREE.MeshStandardMaterial({
    color: type === 'health' ? COLORS.health : COLORS.ammo,
    emissive: type === 'health' ? COLORS.health : COLORS.ammo,
    emissiveIntensity: 0.35,
    roughness: 0.4,
  }));
  mesh.position.set(x, groundHeight(x, z, 0.3, 10) + 0.6, z);
  mesh.castShadow = true;
  scene.add(mesh);
  pickups.push({ mesh, type, baseY: mesh.position.y, t: Math.random() * 6, life: 25 });
}

function removePickup(p) {
  scene.remove(p.mesh);
  p.mesh.material.dispose();
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
  Object.assign(player, {
    yaw: 0, pitch: 0, onGround: true, health: MAX_HEALTH, switchTimer: 0, reloading: 0, reloadPose: 0,
    fireCooldown: 0, cycle: 10, flashTime: 0, ads: 0, sprintPose: 0, recoil: 0, bob: 0,
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
  hud.healthFill.style.background = hp > 50 ? '#7f9c7a' : hp > 25 ? '#b9a77a' : '#b0605a';
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

document.addEventListener('mousedown', (e) => {
  if (game.state !== 'playing') return;
  if (e.button === 0) {
    mouseDown = true;
    triggerQueued = true;
  }
  if (e.button === 2) aimDown = true;
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2) aimDown = false;
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
  if (e.code === 'KeyR') startReload();
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && Number(digit[1]) <= arsenal.length) switchWeapon(Number(digit[1]) - 1);
  if (e.code === 'Space') e.preventDefault();
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
    if (i < 4) spawnTracer(muzzleWorld, end, 0xf0dcb0);
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
      spawnImpact(hit.point, 0xa04a40);
    } else {
      spawnImpact(hit.point, 0xcfc6b0);
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
  const sprint = (keys.ShiftLeft || keys.ShiftRight) && !aimDown;
  const speed = sprint ? SPRINT_SPEED : WALK_SPEED * (1 - player.ads * 0.4);
  const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  moveDir.set(
    -Math.sin(player.yaw) * f + Math.cos(player.yaw) * s,
    0,
    -Math.cos(player.yaw) * f - Math.sin(player.yaw) * s,
  );
  if (moveDir.lengthSq() > 0) moveDir.normalize();

  const accel = player.onGround ? 12 : 3;
  player.vel.x += (moveDir.x * speed - player.vel.x) * Math.min(1, accel * dt);
  player.vel.z += (moveDir.z * speed - player.vel.z) * Math.min(1, accel * dt);

  if (keys.Space && player.onGround) {
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

    eyeFrom.set(g.position.x, 2.05, g.position.z);
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

    e.legL.rotation.x = Math.sin(e.walk) * 0.5;
    e.legR.rotation.x = -Math.sin(e.walk) * 0.5;

    e.flash = Math.max(0, e.flash - dt);
    const glow = e.flash > 0 ? 0xffffff : 0x000000;
    e.bodyMat.emissive.setHex(glow);
    e.headMat.emissive.setHex(glow);
    e.bodyMat.emissiveIntensity = e.headMat.emissiveIntensity = 0.5;

    // Shooting
    e.fireCooldown -= dt;
    if (canSee && e.fireCooldown <= 0) {
      e.fireCooldown = e.fireRate * (0.7 + Math.random() * 0.6);
      const playerSpeed = Math.hypot(player.vel.x, player.vel.z);
      const chance = e.accuracy * Math.max(0.2, 1 - dist / 40) * (playerSpeed > 7 ? 0.6 : playerSpeed > 1 ? 0.8 : 1);
      const hit = Math.random() < chance;
      const muzzle = tmpV.set(0.45, 1.25, -0.55).applyMatrix4(g.matrixWorld).clone();
      const aim = eyeTo.clone();
      aim.y -= 0.3;
      if (!hit) aim.add(tmpV2.set((Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 2.5));
      spawnTracer(muzzle, aim, 0xe0a070);
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
const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (game.state === 'playing') update(dt);
  updateEffects(dt);
  game.damageFlash = Math.max(0, game.damageFlash - dt * 1.5);
  hud.damage.style.opacity = game.damageFlash;
  renderer.clear();
  renderer.render(scene, camera);
  if (viewmodel.visible) {
    renderer.clearDepth();
    renderer.render(weaponScene, weaponCamera);
  }
  requestAnimationFrame(frame);
}

resetGame();
camera.position.set(0, PLAYER_HEIGHT, 0);
camera.rotation.set(0, 0, 0);
frame();
