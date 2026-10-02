import * as THREE from 'three';

// Viewmodel convention: metres, real-world proportions, origin at the trigger,
// -Z points out of the muzzle, +Y up. Profiles are side silhouettes given as
// [forward, up] points and extruded across the width of the gun.

function grainTexture(base, dark) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = dark;
    g.globalAlpha = 0.15 + Math.random() * 0.25;
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath();
    const y = Math.random() * 128;
    g.moveTo(0, y);
    for (let x = 0; x <= 128; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 4);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  return tex;
}

const MAT = {
  steel: new THREE.MeshStandardMaterial({ color: 0x3c4044, metalness: 0.7, roughness: 0.38 }),
  blued: new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.75, roughness: 0.32 }),
  bare: new THREE.MeshStandardMaterial({ color: 0x6a6e72, metalness: 0.85, roughness: 0.3 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x272a2c, metalness: 0.05, roughness: 0.78 }),
  odPolymer: new THREE.MeshStandardMaterial({ color: 0x575b4b, metalness: 0.05, roughness: 0.8 }),
  wood: new THREE.MeshStandardMaterial({ map: grainTexture('#6f5038', '#3e2a1c'), roughness: 0.62 }),
  akWood: new THREE.MeshStandardMaterial({ map: grainTexture('#77492f', '#3b2216'), roughness: 0.55 }),
  bakelite: new THREE.MeshStandardMaterial({ color: 0x6a4030, metalness: 0.1, roughness: 0.5 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x1d1e1f, roughness: 0.95 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x1f2f3c, metalness: 0.9, roughness: 0.08 }),
  bore: new THREE.MeshBasicMaterial({ color: 0x0a0a0a }),
  dot: new THREE.MeshBasicMaterial({ color: 0xe6e4da }),
  brass: new THREE.MeshStandardMaterial({ color: 0xb59a5c, metalness: 0.8, roughness: 0.35 }),
  shell: new THREE.MeshStandardMaterial({ color: 0x8a4a40, roughness: 0.6 }),
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
function curvedMag(segments, w, segH, d, curve, mat) {
  const group = new THREE.Group();
  let y = 0;
  let u = 0;
  let a = 0;
  for (let i = 0; i < segments; i++) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(w, segH * 1.08, d), mat);
    seg.position.set(0, y - segH / 2 * Math.cos(a), -(u + segH / 2 * Math.sin(a)));
    seg.rotation.x = a;
    group.add(seg);
    y -= segH * Math.cos(a);
    u += segH * Math.sin(a);
    a += curve;
  }
  return group;
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
  const trig = box(0.006, 0.016 * s, 0.004, MAT.steel, 0, -0.006 * s, 0.014 * s, 0.25);
  g.add(trig);
  g.position.set(0, y, -u);
  return g;
}

function withRest(obj) {
  obj.userData.rest = obj.position.clone();
  obj.userData.restRot = obj.rotation.clone();
  return obj;
}

// ---------- Glock 17 ----------
function buildGlock() {
  const group = new THREE.Group();
  const slide = new THREE.Group();
  slide.add(profile([[-0.034, 0.028], [0.15, 0.028], [0.153, 0.048], [0.146, 0.057], [-0.029, 0.057], [-0.034, 0.051]], 0.0255, MAT.blued));
  for (let i = 0; i < 7; i++) slide.add(box(0.0262, 0.02, 0.0018, MAT.polymer, 0, 0.044, -0.03 + i * 0.0045));
  slide.add(box(0.002, 0.011, 0.032, MAT.bore, 0.0125, 0.049, 0.035));
  slide.add(box(0.006, 0.007, 0.008, MAT.blued, -0.006, 0.0605, -0.022));
  slide.add(box(0.006, 0.007, 0.008, MAT.blued, 0.006, 0.0605, -0.022));
  slide.add(box(0.0015, 0.0015, 0.001, MAT.dot, -0.006, 0.061, -0.0265));
  slide.add(box(0.0015, 0.0015, 0.001, MAT.dot, 0.006, 0.061, -0.0265));
  slide.add(box(0.004, 0.007, 0.006, MAT.blued, 0, 0.0605, 0.142));
  slide.add(box(0.0018, 0.0018, 0.001, MAT.dot, 0, 0.0615, 0.1385));
  slide.add(tube(0.0068, 0.0068, 0.15, 0.1535, 0.043, MAT.steel));
  slide.add(bore(0.0045, 0.1535, 0.043));
  group.add(withRest(slide));

  group.add(profile([
    [0.146, 0.028], [0.146, 0.013], [0.052, 0.013], [0.044, 0.006], [0.008, 0.004],
    [-0.022, -0.094], [-0.058, -0.094], [-0.033, 0.012], [-0.043, 0.022], [-0.036, 0.028],
  ], 0.03, MAT.polymer));
  for (let i = 0; i < 3; i++) group.add(box(0.031, 0.003, 0.006, MAT.rubber, 0, 0.0145, 0.07 + i * 0.016));
  group.add(triggerGroup(0.012, 0.007, 1, MAT.polymer));

  const mag = new THREE.Group();
  mag.add(box(0.022, 0.1, 0.028, MAT.steel, 0, 0, 0));
  mag.add(box(0.031, 0.008, 0.038, MAT.polymer, 0, -0.052, 0));
  mag.position.set(0, -0.046, 0.028);
  mag.rotation.x = -0.32;
  group.add(withRest(mag));

  return { group, parts: { slide, mag }, muzzle: new THREE.Vector3(0, 0.043, -0.16), sightY: 0.0625 };
}

// ---------- H&K MP5A2 ----------
function buildMP5() {
  const group = new THREE.Group();
  group.add(profile([[-0.07, 0.022], [0.215, 0.022], [0.215, 0.066], [0.2, 0.072], [-0.06, 0.072], [-0.07, 0.066]], 0.042, MAT.blued, [], 0.005));
  group.add(box(0.002, 0.012, 0.045, MAT.bore, 0.0215, 0.055, 0.1));
  group.add(tube(0.012, 0.012, 0.18, 0.335, 0.064, MAT.blued));
  group.add(tube(0.0085, 0.0085, 0.2, 0.37, 0.042, MAT.steel));
  group.add(tube(0.0115, 0.0115, 0.355, 0.385, 0.042, MAT.blued));
  group.add(bore(0.0045, 0.385, 0.042));
  group.add(box(0.016, 0.04, 0.02, MAT.blued, 0, 0.07, 0.335));
  group.add(ring(0.009, 0.0022, 0.335, 0.094, MAT.blued));
  group.add(box(0.002, 0.012, 0.002, MAT.blued, 0, 0.09, 0.335));
  group.add(box(0.02, 0.012, 0.03, MAT.blued, 0, 0.079, -0.045));
  group.add(ring(0.0055, 0.0035, 0.045, 0.095, MAT.blued));
  group.add(box(0.024, 0.01, 0.014, MAT.blued, 0, 0.083, 0.045));
  group.add(box(0.025, 0.012, 0.006, MAT.steel, -0.026, 0.064, 0.315));
  group.add(profile([[0.14, -0.004], [0.3, 0.004], [0.312, 0.022], [0.3, 0.05], [0.14, 0.052], [0.13, 0.025]], 0.05, MAT.polymer, [], 0.006));
  for (let i = 0; i < 6; i++) group.add(box(0.051, 0.004, 0.012, MAT.rubber, 0, 0.004, 0.16 + i * 0.022));
  group.add(box(0.034, 0.032, 0.06, MAT.blued, 0, 0.006, 0.115));
  group.add(profile([[0.045, 0.024], [0.05, 0.0], [0.026, -0.094], [-0.012, -0.094], [0.0, 0.0], [-0.012, 0.024]], 0.032, MAT.polymer, [], 0.004));
  group.add(triggerGroup(0.05, 0.02, 1.1, MAT.polymer));
  group.add(profile([[-0.065, 0.068], [-0.065, 0.022], [-0.11, 0.008], [-0.29, -0.032], [-0.33, -0.04], [-0.335, 0.072], [-0.3, 0.076], [-0.12, 0.068]], 0.04, MAT.polymer, [], 0.005));
  group.add(box(0.042, 0.115, 0.012, MAT.rubber, 0, 0.018, -0.336));

  const mag = curvedMag(6, 0.022, 0.03, 0.05, 0.085, MAT.steel);
  mag.position.set(0, -0.005, -0.115);
  group.add(withRest(mag));

  return { group, parts: { mag }, muzzle: new THREE.Vector3(0, 0.042, -0.39), sightY: 0.095 };
}

// ---------- AK-47 ----------
function buildAK() {
  const group = new THREE.Group();
  group.add(profile([[-0.08, 0.0], [0.205, 0.0], [0.205, 0.056], [-0.05, 0.056], [-0.08, 0.04]], 0.044, MAT.blued, [], 0.003));
  const cover = tube(0.021, 0.021, -0.055, 0.2, 0.052, MAT.blued);
  cover.scale.x = 1.02;
  group.add(cover);
  for (let i = 0; i < 6; i++) group.add(box(0.045, 0.003, 0.004, MAT.steel, 0, 0.072, -0.03 + i * 0.006));
  group.add(box(0.002, 0.014, 0.06, MAT.bore, 0.0225, 0.04, 0.1));
  group.add(box(0.004, 0.006, 0.09, MAT.steel, 0.023, 0.025, 0.06));
  const charge = box(0.022, 0.012, 0.014, MAT.bare, 0.032, 0.046, 0.175);
  group.add(withRest(charge));

  group.add(box(0.03, 0.026, 0.05, MAT.blued, 0, 0.066, 0.225));
  const leaf = box(0.022, 0.004, 0.07, MAT.blued, 0, 0.081, 0.24, 0.05);
  group.add(leaf);
  group.add(box(0.008, 0.006, 0.004, MAT.blued, -0.007, 0.085, 0.207));
  group.add(box(0.008, 0.006, 0.004, MAT.blued, 0.007, 0.085, 0.207));

  group.add(tube(0.0105, 0.0105, 0.2, 0.62, 0.032, MAT.blued));
  group.add(tube(0.011, 0.011, 0.27, 0.515, 0.061, MAT.blued));
  group.add(box(0.026, 0.045, 0.03, MAT.blued, 0, 0.045, 0.505));
  group.add(box(0.022, 0.03, 0.024, MAT.blued, 0, 0.042, 0.585));
  group.add(box(0.003, 0.04, 0.008, MAT.blued, -0.009, 0.068, 0.585));
  group.add(box(0.003, 0.04, 0.008, MAT.blued, 0.009, 0.068, 0.585));
  group.add(box(0.0025, 0.032, 0.003, MAT.blued, 0, 0.068, 0.585));
  const brake = tube(0.013, 0.013, 0.62, 0.655, 0.032, MAT.blued);
  group.add(brake);
  group.add(bore(0.0055, 0.655, 0.032));

  group.add(profile([[0.235, 0.006], [0.475, 0.004], [0.485, 0.022], [0.475, 0.05], [0.235, 0.052], [0.225, 0.03]], 0.052, MAT.akWood, [], 0.006));
  for (let i = 0; i < 2; i++) {
    group.add(box(0.054, 0.012, 0.03, MAT.akWood, 0, 0.026, 0.3 + i * 0.12));
  }
  group.add(tube(0.017, 0.017, 0.275, 0.44, 0.062, MAT.akWood));
  for (const u of [0.235, 0.478]) group.add(box(0.054, 0.056, 0.008, MAT.blued, 0, 0.028, u));

  group.add(profile([[0.052, 0.0], [0.048, -0.022], [0.022, -0.102], [-0.016, -0.102], [0.002, -0.022], [0.006, 0.0]], 0.03, MAT.bakelite, [], 0.004));
  group.add(triggerGroup(0.05, 0.002, 1.25, MAT.blued));

  group.add(profile([[-0.078, 0.042], [-0.078, 0.002], [-0.12, -0.016], [-0.36, -0.07], [-0.372, -0.074], [-0.378, 0.046], [-0.36, 0.052], [-0.12, 0.046]], 0.04, MAT.akWood, [], 0.005));
  group.add(box(0.042, 0.13, 0.008, MAT.blued, 0, -0.012, -0.378));

  const mag = curvedMag(7, 0.026, 0.034, 0.064, 0.09, MAT.bakelite);
  for (let i = 0; i < 3; i++) mag.add(box(0.027, 0.004, 0.06, MAT.blued, 0, -0.01 - i * 0.002, 0));
  mag.position.set(0, -0.0, -0.13);
  group.add(withRest(mag));

  return { group, parts: { mag, charge }, muzzle: new THREE.Vector3(0, 0.032, -0.665), sightY: 0.085 };
}

// ---------- Remington 870 ----------
function buildRemington() {
  const group = new THREE.Group();
  group.add(profile([[-0.06, -0.012], [0.175, -0.012], [0.175, 0.052], [0.15, 0.062], [-0.04, 0.062], [-0.06, 0.046]], 0.042, MAT.blued, [], 0.004));
  group.add(box(0.002, 0.026, 0.07, MAT.bore, 0.0215, 0.032, 0.08));
  group.add(box(0.03, 0.002, 0.07, MAT.bore, 0, -0.0135, 0.07));
  group.add(tube(0.0125, 0.0115, 0.175, 0.66, 0.042, MAT.blued));
  group.add(bore(0.009, 0.66, 0.042));
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.0032, 10, 8), MAT.brass);
  bead.position.set(0, 0.056, -0.652);
  group.add(bead);
  group.add(tube(0.0115, 0.0115, 0.175, 0.585, 0.012, MAT.blued));
  group.add(tube(0.0125, 0.0125, 0.585, 0.605, 0.012, MAT.steel));
  group.add(box(0.018, 0.04, 0.012, MAT.blued, 0, 0.028, 0.585));

  const pump = new THREE.Group();
  pump.add(tube(0.021, 0.02, 0.24, 0.43, 0.014, MAT.wood, 0, 20));
  for (let i = 0; i < 8; i++) pump.add(ring(0.0205, 0.0022, 0.27 + i * 0.018, 0.014, MAT.rubber));
  pump.add(box(0.003, 0.006, 0.2, MAT.steel, 0.017, 0.004, 0.17));
  pump.add(box(0.003, 0.006, 0.2, MAT.steel, -0.017, 0.004, 0.17));
  group.add(withRest(pump));

  group.add(triggerGroup(0.04, -0.012, 1.25, MAT.steel));
  group.add(profile([[-0.058, 0.046], [-0.058, -0.012], [-0.1, -0.04], [-0.135, -0.048], [-0.37, -0.088], [-0.378, 0.046], [-0.36, 0.052], [-0.135, 0.044]], 0.042, MAT.wood, [], 0.005));
  group.add(box(0.044, 0.142, 0.016, MAT.rubber, 0, -0.02, -0.384, 0.08));

  const shell = new THREE.Group();
  shell.add(tube(0.0095, 0.0095, -0.03, 0.035, 0, MAT.shell));
  shell.add(tube(0.01, 0.01, -0.045, -0.03, 0, MAT.brass));
  shell.position.set(0, -0.05, -0.08);
  shell.visible = false;
  group.add(withRest(shell));

  return { group, parts: { pump, shell }, muzzle: new THREE.Vector3(0, 0.042, -0.67), sightY: 0.063 };
}

// ---------- M24 SWS ----------
function buildM24() {
  const group = new THREE.Group();
  group.add(profile([
    [0.42, 0.03], [0.42, 0.006], [0.15, -0.012], [0.05, -0.02], [0.032, -0.095], [-0.018, -0.1],
    [-0.03, -0.032], [-0.08, -0.042], [-0.38, -0.086], [-0.392, 0.052], [-0.37, 0.058], [-0.1, 0.05], [-0.065, 0.03],
  ], 0.052, MAT.odPolymer, [], 0.006));
  group.add(box(0.054, 0.14, 0.018, MAT.rubber, 0, -0.016, -0.398));
  group.add(tube(0.019, 0.019, -0.065, 0.17, 0.045, MAT.blued));
  group.add(box(0.002, 0.016, 0.06, MAT.bore, 0.019, 0.05, 0.06));
  group.add(tube(0.0145, 0.0105, 0.17, 0.72, 0.045, MAT.blued));
  group.add(tube(0.0115, 0.0115, 0.72, 0.73, 0.045, MAT.steel));
  group.add(bore(0.004, 0.73, 0.045));
  group.add(triggerGroup(0.028, -0.006, 1.2, MAT.blued));
  group.add(box(0.03, 0.006, 0.08, MAT.blued, 0, -0.016, 0.1));

  const bolt = new THREE.Group();
  bolt.add(tube(0.01, 0.01, -0.09, -0.06, 0, MAT.bare));
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 10), MAT.bare);
  arm.rotation.z = Math.PI / 2 - 0.5;
  arm.position.set(0.024, -0.012, 0.03);
  bolt.add(arm);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 14, 10), MAT.blued);
  knob.position.set(0.046, -0.024, 0.03);
  bolt.add(knob);
  bolt.position.set(0, 0.045, 0);
  group.add(withRest(bolt));

  group.add(box(0.024, 0.02, 0.24, MAT.blued, 0, 0.068, 0.04));
  for (const u of [-0.02, 0.12]) {
    group.add(box(0.02, 0.018, 0.02, MAT.blued, 0, 0.083, u));
    group.add(ring(0.0145, 0.003, u, 0.1, MAT.blued));
  }
  group.add(tube(0.0127, 0.0127, -0.09, 0.2, 0.1, MAT.blued));
  group.add(tube(0.0127, 0.023, 0.2, 0.25, 0.1, MAT.blued));
  group.add(tube(0.023, 0.023, 0.25, 0.3, 0.1, MAT.blued));
  group.add(tube(0.017, 0.0127, -0.14, -0.09, 0.1, MAT.blued));
  group.add(tube(0.019, 0.019, -0.2, -0.14, 0.1, MAT.rubber));
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.021, 24), MAT.glass);
  lens.position.set(0, 0.1, -0.3005);
  lens.rotation.y = Math.PI;
  group.add(lens);
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.026, 16), MAT.blued);
  turret.position.set(0, 0.123, -0.06);
  group.add(turret);
  const windage = turret.clone();
  windage.rotation.z = Math.PI / 2;
  windage.position.set(0.023, 0.1, -0.06);
  group.add(windage);

  for (const x of [-0.012, 0.012]) group.add(tube(0.004, 0.004, 0.3, 0.46, -0.004, MAT.blued, x, 8));
  group.add(box(0.034, 0.014, 0.02, MAT.blued, 0, 0.0, 0.46));

  return { group, parts: { bolt }, muzzle: new THREE.Vector3(0, 0.045, -0.74), sightY: 0.1, scope: true };
}

export const WEAPONS = [
  {
    id: 'glock', name: 'Glock 17', caliber: '9x19mm', build: buildGlock, action: 'slide',
    auto: false, interval: 0.13, damage: 22, headDamage: 55, pellets: 1,
    spread: 0.006, magSize: 17, reserve: 85, reloadTime: 1.25,
    recoil: 0.9, kick: 0.035, adsFov: 62, rest: [0.13, -0.13, -0.3], ads: [0, -0.0625, -0.2],
    sound: { vol: 0.3, freq: 3200, dur: 0.09, tone: 220 }, flash: 0.08,
  },
  {
    id: 'mp5', name: 'MP5A2', caliber: '9x19mm', build: buildMP5, action: 'auto',
    auto: true, interval: 0.075, damage: 17, headDamage: 42, pellets: 1,
    spread: 0.008, magSize: 30, reserve: 150, reloadTime: 1.7,
    recoil: 0.45, kick: 0.02, adsFov: 58, rest: [0.13, -0.15, -0.28], ads: [0, -0.095, -0.12],
    sound: { vol: 0.24, freq: 2600, dur: 0.07, tone: 200 }, flash: 0.09,
  },
  {
    id: 'ak47', name: 'AK-47', caliber: '7.62x39mm', build: buildAK, action: 'auto',
    auto: true, interval: 0.1, damage: 32, headDamage: 80, pellets: 1,
    spread: 0.011, magSize: 30, reserve: 90, reloadTime: 2.0,
    recoil: 0.85, kick: 0.03, adsFov: 55, rest: [0.13, -0.155, -0.2], ads: [0, -0.083, 0.08],
    sound: { vol: 0.42, freq: 2000, dur: 0.14, tone: 160 }, flash: 0.12,
  },
  {
    id: 'r870', name: 'Remington 870', caliber: '12 gauge', build: buildRemington, action: 'pump',
    auto: false, interval: 0.85, damage: 14, headDamage: 24, pellets: 9, falloff: 22,
    spread: 0.055, adsSpreadMult: 0.75, magSize: 6, reserve: 30, reloadTime: 0.5, perShell: true,
    recoil: 2.2, kick: 0.06, adsFov: 62, rest: [0.13, -0.15, -0.18], ads: [0, -0.076, -0.2],
    sound: { vol: 0.6, freq: 1300, dur: 0.3, tone: 90 }, flash: 0.18,
  },
  {
    id: 'm24', name: 'M24 SWS', caliber: '7.62x51mm', build: buildM24, action: 'bolt',
    auto: false, interval: 1.25, damage: 130, headDamage: 300, pellets: 1,
    spread: 0.035, adsSpreadMult: 0, magSize: 5, reserve: 25, reloadTime: 2.6,
    recoil: 2.8, kick: 0.05, adsFov: 16, rest: [0.13, -0.16, -0.12], ads: [0, -0.1, 0.05],
    sound: { vol: 0.65, freq: 1500, dur: 0.45, tone: 70 }, flash: 0.14,
  },
];

export function buildWeaponModel(def) {
  const model = def.build();
  model.group.traverse((o) => {
    if (o.isMesh) o.frustumCulled = false;
  });
  return model;
}
