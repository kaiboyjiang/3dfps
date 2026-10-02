import * as THREE from 'three';

// Viewmodel convention: metres, real-world proportions, origin at the trigger,
// -Z points out of the muzzle, +Y up. Profiles are side silhouettes given as
// [forward, up] points and extruded across the width of the gun.

const glow = (color, intensity = 3) => new THREE.MeshStandardMaterial({
  color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.3,
});

const MAT = {
  white: new THREE.MeshStandardMaterial({ color: 0xe9edf2, metalness: 0.15, roughness: 0.35 }),
  grey: new THREE.MeshStandardMaterial({ color: 0x8d96a3, metalness: 0.5, roughness: 0.4 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x23272e, metalness: 0.55, roughness: 0.42 }),
  alloy: new THREE.MeshStandardMaterial({ color: 0x5c636d, metalness: 0.9, roughness: 0.25 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.9 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x0f2a3c, metalness: 0.9, roughness: 0.05, emissive: 0x0a3a5a, emissiveIntensity: 0.6 }),
  bore: new THREE.MeshBasicMaterial({ color: 0x050608 }),
};

function profile(points, width, mat, holes = [], bevel = 0.0015) {
  const shape = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
  for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(([u, v]) => new THREE.Vector2(u, v))));
  const w = Math.max(0.001, width - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: w, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6,
  });
  geo.translate(0, 0, -w / 2);
  geo.rotateY(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  return mesh;
}

// Cylinder along Z between forward distances u0 (rear) and u1 (front).
function tube(rRear, rFront, u0, u1, y, mat, x = 0, seg = 18) {
  const geo = new THREE.CylinderGeometry(rRear, rFront, u1 - u0, seg);
  geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, -(u0 + u1) / 2);
  return mesh;
}

function box(w, h, d, mat, x, y, u, rx = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, -u);
  mesh.rotation.x = rx;
  return mesh;
}

function ring(r, thickness, u, y, mat) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(r, thickness, 8, 24), mat);
  mesh.position.set(0, y, -u);
  return mesh;
}

function bore(r, u, y) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 16), MAT.bore);
  mesh.position.set(0, y, -u - 0.0005);
  mesh.rotation.y = Math.PI;
  return mesh;
}

// Curved box magazine built from stacked segments; `curve` is radians per segment.
function boreAt(r, u, y, x = 0) {
  const mesh = bore(r, u, y);
  mesh.position.x = x;
  return mesh;
}

function triggerGroup(u, y, scale, guardMat) {
  const s = scale;
  const g = new THREE.Group();
  g.add(profile(
    [[0.034 * s, 0.006], [0.032 * s, -0.016 * s], [0.024 * s, -0.024 * s], [-0.006 * s, -0.024 * s], [-0.006 * s, 0.006]],
    0.011, guardMat,
    [[[0.028 * s, 0.003], [0.026 * s, -0.013 * s], [0.02 * s, -0.018 * s], [0.0, -0.018 * s], [0.0, 0.003]]],
    0.001,
  ));
  const trig = box(0.006, 0.016 * s, 0.004, MAT.alloy, 0, -0.006 * s, 0.014 * s, 0.25);
  g.add(trig);
  g.position.set(0, y, -u);
  return g;
}

function withRest(obj) {
  obj.userData.rest = obj.position.clone();
  obj.userData.restRot = obj.rotation.clone();
  return obj;
}

// ---------- VX-9 ion pistol ----------
function buildIonPistol() {
  const group = new THREE.Group();
  const g = glow(0x38e1ff);
  const slide = new THREE.Group();
  slide.add(profile([[-0.042, 0.028], [0.16, 0.028], [0.176, 0.04], [0.166, 0.06], [-0.03, 0.062], [-0.042, 0.052]], 0.03, MAT.white, [], 0.003));
  for (const x of [-0.0155, 0.0155]) slide.add(box(0.002, 0.005, 0.12, g, x, 0.047, 0.06));
  for (let i = 0; i < 5; i++) slide.add(box(0.031, 0.016, 0.003, MAT.dark, 0, 0.045, -0.032 + i * 0.006));
  slide.add(box(0.012, 0.004, 0.06, MAT.dark, 0, 0.063, 0.09));
  slide.add(box(0.005, 0.008, 0.008, MAT.dark, -0.007, 0.066, -0.024));
  slide.add(box(0.005, 0.008, 0.008, MAT.dark, 0.007, 0.066, -0.024));
  slide.add(box(0.004, 0.008, 0.006, MAT.dark, 0, 0.066, 0.15));
  slide.add(box(0.002, 0.002, 0.001, g, 0, 0.069, 0.146));
  group.add(withRest(slide));

  group.add(profile([
    [0.15, 0.028], [0.15, 0.012], [0.052, 0.012], [0.044, 0.005], [0.008, 0.004],
    [-0.024, -0.096], [-0.06, -0.096], [-0.034, 0.012], [-0.044, 0.022], [-0.036, 0.028],
  ], 0.032, MAT.dark, [], 0.003));
  for (let i = 0; i < 4; i++) group.add(box(0.033, 0.004, 0.008, MAT.grey, 0, -0.03 - i * 0.014, -0.028 - i * 0.004, 0.32));
  group.add(tube(0.011, 0.009, 0.15, 0.178, 0.044, MAT.alloy));
  group.add(ring(0.0105, 0.0022, 0.168, 0.044, g));
  group.add(bore(0.006, 0.178, 0.044));
  group.add(triggerGroup(0.012, 0.007, 1, MAT.dark));

  const mag = new THREE.Group();
  mag.add(box(0.022, 0.1, 0.028, MAT.grey, 0, 0, 0));
  mag.add(box(0.023, 0.06, 0.01, g, 0, 0.005, -0.012));
  mag.add(box(0.033, 0.01, 0.038, MAT.dark, 0, -0.052, 0));
  mag.position.set(0, -0.046, 0.028);
  mag.rotation.x = -0.32;
  group.add(withRest(mag));

  return { group, glow: g, parts: { slide, mag }, muzzle: new THREE.Vector3(0, 0.044, -0.185), sightY: 0.07 };
}

function holoSight(u, y, g) {
  const s = new THREE.Group();
  s.add(box(0.026, 0.012, 0.05, MAT.dark, 0, 0, 0));
  for (const x of [-0.014, 0.014]) s.add(box(0.004, 0.036, 0.008, MAT.dark, x, 0.022, -0.012));
  s.add(box(0.032, 0.004, 0.008, MAT.dark, 0, 0.042, -0.012));
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.024, 0.032), new THREE.MeshStandardMaterial({
    color: 0x6fd8ff, transparent: true, opacity: 0.12, metalness: 0.9, roughness: 0.05, depthWrite: false,
  }));
  pane.position.set(0, 0.022, 0.012);
  s.add(pane);
  const dot = new THREE.Mesh(new THREE.RingGeometry(0.0012, 0.0022, 16), g);
  dot.position.set(0, 0.022, 0.0115);
  s.add(dot);
  s.position.set(0, y, -u);
  return s;
}

// ---------- P-40 pulse SMG ----------
function buildPulseSMG() {
  const group = new THREE.Group();
  const g = glow(0xc06bff);
  group.add(profile([[-0.08, 0.02], [0.22, 0.02], [0.24, 0.04], [0.22, 0.076], [-0.06, 0.08], [-0.08, 0.062]], 0.046, MAT.white, [], 0.005));
  group.add(box(0.03, 0.008, 0.24, MAT.dark, 0, 0.083, 0.07));
  for (let i = 0; i < 10; i++) group.add(box(0.032, 0.004, 0.006, MAT.alloy, 0, 0.088, -0.035 + i * 0.022));
  for (const x of [-0.0235, 0.0235]) group.add(box(0.002, 0.006, 0.16, g, x, 0.05, 0.08));
  group.add(box(0.002, 0.016, 0.04, MAT.dark, 0.0235, 0.064, 0.17));
  group.add(tube(0.017, 0.017, 0.2, 0.34, 0.046, MAT.dark));
  for (let i = 0; i < 3; i++) group.add(ring(0.0172, 0.0028, 0.235 + i * 0.03, 0.046, g));
  group.add(tube(0.012, 0.009, 0.34, 0.382, 0.046, MAT.alloy));
  group.add(bore(0.0055, 0.382, 0.046));
  group.add(profile([[0.14, -0.004], [0.3, 0.004], [0.312, 0.022], [0.3, 0.045], [0.14, 0.045], [0.13, 0.025]], 0.052, MAT.dark, [], 0.006));
  group.add(box(0.03, 0.02, 0.02, MAT.dark, 0, -0.01, 0.3));
  group.add(profile([[0.045, 0.024], [0.05, 0.0], [0.026, -0.094], [-0.012, -0.094], [0.0, 0.0], [-0.012, 0.024]], 0.032, MAT.dark, [], 0.004));
  group.add(triggerGroup(0.05, 0.02, 1.1, MAT.dark));
  group.add(profile(
    [[-0.07, 0.075], [-0.07, 0.03], [-0.29, 0.008], [-0.312, 0.004], [-0.316, 0.076], [-0.29, 0.082]],
    0.036, MAT.grey, [[[-0.1, 0.064], [-0.1, 0.042], [-0.282, 0.022], [-0.282, 0.066]]], 0.004,
  ));
  group.add(box(0.04, 0.09, 0.014, MAT.rubber, 0, 0.04, -0.318));
  group.add(holoSight(0.0, 0.092, g));

  const mag = new THREE.Group();
  mag.add(box(0.026, 0.1, 0.042, MAT.grey, 0, -0.045, 0));
  mag.add(box(0.027, 0.07, 0.012, g, 0, -0.04, 0.016));
  mag.add(box(0.03, 0.012, 0.046, MAT.dark, 0, -0.098, 0));
  mag.position.set(0, 0.02, -0.115);
  group.add(withRest(mag));

  return { group, glow: g, parts: { mag }, muzzle: new THREE.Vector3(0, 0.046, -0.39), sightY: 0.114 };
}

// ---------- LR-7 plasma rifle ----------
function buildPlasmaRifle() {
  const group = new THREE.Group();
  const g = glow(0x3dff9a);
  group.add(profile([[-0.09, 0.0], [0.24, 0.0], [0.26, 0.03], [0.24, 0.072], [-0.06, 0.076], [-0.09, 0.052]], 0.052, MAT.white, [], 0.005));
  group.add(box(0.034, 0.01, 0.32, MAT.dark, 0, 0.081, 0.08));
  for (let i = 0; i < 13; i++) group.add(box(0.036, 0.004, 0.007, MAT.alloy, 0, 0.087, -0.06 + i * 0.024));
  group.add(tube(0.014, 0.014, 0.03, 0.19, 0.04, g, 0.024, 14));
  for (const u of [0.02, 0.2]) group.add(box(0.012, 0.034, 0.012, MAT.dark, 0.026, 0.04, u));
  group.add(box(0.002, 0.012, 0.07, MAT.dark, -0.0265, 0.05, 0.1));

  group.add(profile([[0.24, 0.002], [0.5, 0.012], [0.52, 0.036], [0.5, 0.066], [0.24, 0.072]], 0.058, MAT.dark, [], 0.005));
  for (let i = 0; i < 5; i++) group.add(box(0.06, 0.008, 0.022, g, 0, 0.036, 0.28 + i * 0.045));
  group.add(tube(0.012, 0.012, 0.5, 0.66, 0.036, MAT.alloy));
  for (let i = 0; i < 4; i++) group.add(ring(0.016, 0.0035, 0.53 + i * 0.03, 0.036, g));
  group.add(tube(0.018, 0.014, 0.645, 0.685, 0.036, MAT.dark));
  group.add(bore(0.007, 0.685, 0.036));

  group.add(profile([[0.052, 0.0], [0.048, -0.022], [0.022, -0.102], [-0.016, -0.102], [0.002, -0.022], [0.006, 0.0]], 0.032, MAT.dark, [], 0.004));
  group.add(triggerGroup(0.05, 0.002, 1.25, MAT.dark));
  group.add(profile(
    [[-0.088, 0.066], [-0.088, 0.004], [-0.36, -0.042], [-0.376, -0.046], [-0.382, 0.062], [-0.36, 0.07]],
    0.042, MAT.white, [[[-0.13, 0.052], [-0.13, 0.016], [-0.33, -0.02], [-0.33, 0.054]]], 0.005,
  ));
  group.add(box(0.044, 0.112, 0.012, MAT.rubber, 0, 0.01, -0.384));
  group.add(box(0.043, 0.004, 0.2, g, 0, 0.058, -0.23, 0.17));
  group.add(holoSight(0.05, 0.09, g));

  const charge = box(0.022, 0.012, 0.016, MAT.alloy, 0.034, 0.055, 0.21);
  group.add(withRest(charge));

  const mag = new THREE.Group();
  mag.add(box(0.03, 0.11, 0.062, MAT.grey, 0, -0.05, 0));
  mag.add(box(0.031, 0.08, 0.012, g, 0, -0.045, 0.022));
  mag.add(box(0.034, 0.012, 0.066, MAT.dark, 0, -0.108, 0));
  mag.position.set(0, 0.0, -0.13);
  group.add(withRest(mag));

  return { group, glow: g, parts: { mag, charge }, muzzle: new THREE.Vector3(0, 0.036, -0.695), sightY: 0.112 };
}

// ---------- SC-12 scatter blaster ----------
function buildScatter() {
  const group = new THREE.Group();
  const g = glow(0xff8a2a);
  group.add(profile([[-0.06, -0.015], [0.2, -0.015], [0.22, 0.02], [0.2, 0.064], [-0.04, 0.068], [-0.06, 0.05]], 0.05, MAT.grey, [], 0.005));
  for (const x of [-0.0255, 0.0255]) group.add(box(0.002, 0.008, 0.18, g, x, 0.03, 0.08));
  group.add(tube(0.018, 0.018, 0.2, 0.56, 0.045, MAT.dark));
  for (let i = 0; i < 6; i++) group.add(box(0.04, 0.003, 0.012, MAT.alloy, 0, 0.064, 0.24 + i * 0.05));
  group.add(box(0.064, 0.056, 0.1, MAT.dark, 0, 0.045, 0.6));
  group.add(box(0.066, 0.006, 0.08, g, 0, 0.045, 0.6));
  for (const x of [-0.018, 0, 0.018]) group.add(boreAt(0.007, 0.651, 0.045, x));
  group.add(tube(0.012, 0.012, 0.2, 0.55, 0.008, MAT.alloy));
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 10, 8), g);
  bead.position.set(0, 0.078, -0.62);
  group.add(bead);
  group.add(box(0.012, 0.006, 0.01, MAT.dark, 0, 0.074, 0.0));

  const pump = new THREE.Group();
  pump.add(tube(0.024, 0.023, 0.25, 0.43, 0.01, MAT.white, 0, 20));
  for (const u of [0.29, 0.39]) pump.add(ring(0.0235, 0.0025, u, 0.01, g));
  pump.add(box(0.003, 0.006, 0.2, MAT.alloy, 0.019, 0.004, 0.17));
  pump.add(box(0.003, 0.006, 0.2, MAT.alloy, -0.019, 0.004, 0.17));
  group.add(withRest(pump));

  group.add(triggerGroup(0.04, -0.015, 1.25, MAT.dark));
  group.add(profile([[-0.058, 0.046], [-0.058, -0.015], [-0.1, -0.04], [-0.135, -0.048], [-0.37, -0.088], [-0.378, 0.046], [-0.36, 0.052], [-0.135, 0.044]], 0.044, MAT.white, [], 0.005));
  group.add(box(0.046, 0.142, 0.016, MAT.rubber, 0, -0.02, -0.384, 0.08));

  const shell = new THREE.Group();
  shell.add(tube(0.0095, 0.0095, -0.03, 0.035, 0, MAT.grey));
  shell.add(tube(0.0098, 0.0098, -0.01, 0.015, 0, g));
  shell.add(tube(0.01, 0.01, -0.045, -0.03, 0, MAT.alloy));
  shell.position.set(0, -0.05, -0.08);
  shell.visible = false;
  group.add(withRest(shell));

  return { group, glow: g, parts: { pump, shell }, muzzle: new THREE.Vector3(0, 0.045, -0.66), sightY: 0.078 };
}

// ---------- RG-2 rail gun ----------
function buildRailgun() {
  const group = new THREE.Group();
  const g = glow(0x4fa8ff, 4);
  group.add(profile([
    [0.32, 0.03], [0.32, 0.004], [0.15, -0.012], [0.05, -0.02], [0.032, -0.095], [-0.018, -0.1],
    [-0.03, -0.032], [-0.08, -0.042], [-0.38, -0.086], [-0.392, 0.052], [-0.37, 0.058], [-0.1, 0.05], [-0.065, 0.03],
  ], 0.054, MAT.white, [], 0.006));
  group.add(box(0.056, 0.14, 0.018, MAT.rubber, 0, -0.016, -0.398));
  group.add(box(0.055, 0.004, 0.22, g, 0, 0.0, -0.22, 0.14));
  group.add(tube(0.021, 0.021, -0.065, 0.17, 0.045, MAT.dark));
  for (const x of [-0.016, 0.016]) group.add(box(0.008, 0.034, 0.56, MAT.alloy, x, 0.045, 0.45));
  group.add(box(0.012, 0.014, 0.54, g, 0, 0.045, 0.45));
  for (let i = 0; i < 6; i++) group.add(box(0.044, 0.044, 0.008, MAT.dark, 0, 0.045, 0.22 + i * 0.09));
  group.add(box(0.046, 0.054, 0.03, MAT.dark, 0, 0.045, 0.73));
  group.add(box(0.012, 0.014, 0.002, MAT.bore, 0, 0.045, 0.746));
  for (const x of [-0.03, 0.03]) {
    group.add(tube(0.009, 0.009, 0.06, 0.2, 0.0, MAT.grey, x, 12));
    group.add(tube(0.0092, 0.0092, 0.1, 0.16, 0.0, g, x, 12));
  }
  group.add(triggerGroup(0.028, -0.006, 1.2, MAT.dark));

  const bolt = new THREE.Group();
  bolt.add(tube(0.01, 0.01, -0.09, -0.06, 0, MAT.alloy));
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 10), MAT.alloy);
  arm.rotation.z = Math.PI / 2 - 0.5;
  arm.position.set(0.024, -0.012, 0.03);
  bolt.add(arm);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 14, 10), g);
  knob.position.set(0.046, -0.024, 0.03);
  bolt.add(knob);
  bolt.position.set(0, 0.045, 0);
  group.add(withRest(bolt));

  group.add(box(0.024, 0.02, 0.24, MAT.dark, 0, 0.068, 0.04));
  for (const u of [-0.02, 0.12]) {
    group.add(box(0.02, 0.018, 0.02, MAT.dark, 0, 0.083, u));
    group.add(ring(0.0145, 0.003, u, 0.1, MAT.dark));
  }
  group.add(tube(0.0135, 0.0135, -0.09, 0.2, 0.1, MAT.grey));
  group.add(ring(0.0137, 0.0018, 0.04, 0.1, g));
  group.add(tube(0.0135, 0.024, 0.2, 0.25, 0.1, MAT.dark));
  group.add(tube(0.024, 0.024, 0.25, 0.3, 0.1, MAT.dark));
  group.add(tube(0.017, 0.0135, -0.14, -0.09, 0.1, MAT.dark));
  group.add(tube(0.019, 0.019, -0.2, -0.14, 0.1, MAT.rubber));
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.022, 24), MAT.glass);
  lens.position.set(0, 0.1, -0.3005);
  lens.rotation.y = Math.PI;
  group.add(lens);
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.026, 16), MAT.dark);
  turret.position.set(0, 0.123, -0.06);
  group.add(turret);
  const windage = turret.clone();
  windage.rotation.z = Math.PI / 2;
  windage.position.set(0.023, 0.1, -0.06);
  group.add(windage);

  return { group, glow: g, parts: { bolt }, muzzle: new THREE.Vector3(0, 0.045, -0.75), sightY: 0.1, scope: true };
}

export const WEAPONS = [
  {
    id: 'ion', name: 'VX-9 Ion Pistol', caliber: 'Ion cell', build: buildIonPistol, action: 'slide', color: 0x38e1ff,
    auto: false, interval: 0.13, damage: 22, headDamage: 55, pellets: 1,
    spread: 0.006, magSize: 16, reserve: 80, reloadTime: 1.25,
    recoil: 0.9, kick: 0.035, adsFov: 62, rest: [0.13, -0.13, -0.3], ads: [0, -0.07, -0.2],
    sound: { vol: 0.28, freq: 4200, dur: 0.12, tone: 1500, toneEnd: 300 }, flash: 0.08,
  },
  {
    id: 'pulse', name: 'P-40 Pulse SMG', caliber: 'Pulse cell', build: buildPulseSMG, action: 'auto', color: 0xc06bff,
    auto: true, interval: 0.075, damage: 17, headDamage: 42, pellets: 1,
    spread: 0.008, magSize: 36, reserve: 180, reloadTime: 1.7,
    recoil: 0.45, kick: 0.02, adsFov: 58, rest: [0.13, -0.15, -0.28], ads: [0, -0.114, -0.12],
    sound: { vol: 0.22, freq: 5000, dur: 0.08, tone: 1100, toneEnd: 420 }, flash: 0.09,
  },
  {
    id: 'plasma', name: 'LR-7 Plasma Rifle', caliber: 'Plasma core', build: buildPlasmaRifle, action: 'auto', color: 0x3dff9a,
    auto: true, interval: 0.1, damage: 32, headDamage: 80, pellets: 1,
    spread: 0.011, magSize: 30, reserve: 120, reloadTime: 2.0,
    recoil: 0.85, kick: 0.03, adsFov: 55, rest: [0.13, -0.155, -0.2], ads: [0, -0.112, 0.06],
    sound: { vol: 0.36, freq: 2600, dur: 0.16, tone: 620, toneEnd: 110 }, flash: 0.12,
  },
  {
    id: 'scatter', name: 'SC-12 Scatter Blaster', caliber: 'Arc charge', build: buildScatter, action: 'pump', color: 0xff8a2a,
    auto: false, interval: 0.85, damage: 14, headDamage: 24, pellets: 9, falloff: 22,
    spread: 0.055, adsSpreadMult: 0.75, magSize: 6, reserve: 30, reloadTime: 0.5, perShell: true,
    recoil: 2.2, kick: 0.06, adsFov: 62, rest: [0.13, -0.15, -0.18], ads: [0, -0.078, -0.2],
    sound: { vol: 0.55, freq: 1600, dur: 0.32, tone: 380, toneEnd: 50 }, flash: 0.18,
  },
  {
    id: 'rail', name: 'RG-2 Rail Gun', caliber: 'Mag slug', build: buildRailgun, action: 'bolt', color: 0x4fa8ff,
    auto: false, interval: 1.25, damage: 130, headDamage: 300, pellets: 1,
    spread: 0.035, adsSpreadMult: 0, magSize: 5, reserve: 25, reloadTime: 2.6,
    recoil: 2.8, kick: 0.05, adsFov: 16, rest: [0.13, -0.16, -0.12], ads: [0, -0.1, 0.05],
    sound: { vol: 0.6, freq: 3000, dur: 0.5, tone: 2400, toneEnd: 60 }, flash: 0.14,
  },
];

export function buildWeaponModel(def) {
  const model = def.build();
  model.group.traverse((o) => {
    if (o.isMesh) o.frustumCulled = false;
  });
  return model;
}
