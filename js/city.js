// ═══════════════════════════════════════════════
//  city.js — the world around the track
//
//  A block-grid city: asphalt roads with lane markings and
//  zebra crossings, parks with trees, candy-coloured towers
//  and a little train doing laps around it all.
//
//  Everything here is merged or instanced. The whole city —
//  roads, markings, parks, trees, ~190 towers — costs about
//  a dozen draw calls in total.
// ═══════════════════════════════════════════════
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

/* ── block grid ── */
const PITCH = 76;             // block + road
const ROAD = 18;              // carriageway width
const BLOCK = PITCH - ROAD;   // 58
const RINGS = 6;              // blocks out from the middle
const LIMIT = RINGS * PITCH + PITCH / 2;
const TRAIN_R = 118;          // the train's loop

/* helper: a flat quad lying on the ground, ready to merge */
function slab(cx, cz, w, d, y = 0, rotY = 0) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  if (rotY) g.rotateY(rotY);
  g.translate(cx, y, cz);
  return g;
}
const mergeAll = list => (list.length ? BufferGeometryUtils.mergeGeometries(list, false) : null);

/* ── bright sky dome ── */
export function makeSky() {
  const geo = new THREE.SphereGeometry(900, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, toneMapped: false,
    uniforms: {
      top: { value: new THREE.Color(0x4fb3bf) },
      mid: { value: new THREE.Color(0xa9dcd8) },
      bot: { value: new THREE.Color(0xfdf5e4) },
      glow: { value: new THREE.Color(0xffd98a) },
    },
    vertexShader: /* glsl */`
      varying vec3 vPos;
      void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 top, mid, bot, glow;
      varying vec3 vPos;
      void main(){
        vec3 d = normalize(vPos);
        float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 c = mix(bot, mid, smoothstep(0.42, 0.60, h));
        c = mix(c, top, smoothstep(0.60, 0.98, h));
        float sun = pow(max(0.0, dot(d, normalize(vec3(-0.4, 0.34, -1.0)))), 14.0);
        c += glow * sun * 0.7;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  return sky;
}

/* ═══════════════════════════════════════════════
   The ground: grass, roads, markings, parks, trees
   ═══════════════════════════════════════════════ */
export function makeGround() {
  const group = new THREE.Group();
  group.name = 'ground';

  // ── base: grass out to the horizon ──
  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshStandardMaterial({ color: 0xbcd8b4, roughness: 0.97, metalness: 0, envMapIntensity: 0.25 })
  );
  base.rotation.x = -Math.PI / 2;
  base.receiveShadow = true;
  group.add(base);

  const roads = [], dashes = [], zebras = [], plazas = [], parkland = [];

  // ── carriageways ──
  for (let k = -RINGS; k <= RINGS; k++) {
    const at = k * PITCH;
    roads.push(slab(0, at, LIMIT * 2, ROAD, 0.02));
    roads.push(slab(at, 0, ROAD, LIMIT * 2, 0.02));
  }

  // ── centre-line dashes, skipping the junctions ──
  const DASH = 7, GAP = 7;
  for (let k = -RINGS; k <= RINGS; k++) {
    const at = k * PITCH;
    for (let d = -LIMIT; d < LIMIT; d += DASH + GAP) {
      if (Math.abs((d + LIMIT) % PITCH - PITCH / 2) > PITCH / 2 - ROAD) continue;
      dashes.push(slab(d + DASH / 2, at, DASH, 0.7, 0.05));
      dashes.push(slab(at, d + DASH / 2, 0.7, DASH, 0.05));
    }
  }

  // ── zebra crossings on every approach to a junction ──
  for (let a = -RINGS; a <= RINGS; a++) {
    for (let b = -RINGS; b <= RINGS; b++) {
      const cx = a * PITCH, cz = b * PITCH;
      if (Math.hypot(cx, cz) > 260) continue;
      for (let stripe = 0; stripe < 4; stripe++) {
        const off = -ROAD / 2 + 3.2 + stripe * 4.0;
        const out = ROAD / 2 + 3.4;
        zebras.push(slab(cx + off, cz - out, 1.8, 7, 0.05));
        zebras.push(slab(cx + off, cz + out, 1.8, 7, 0.05));
        zebras.push(slab(cx - out, cz + off, 7, 1.8, 0.05));
        zebras.push(slab(cx + out, cz + off, 7, 1.8, 0.05));
      }
    }
  }

  // ── block interiors: paved plaza, or park ──
  const parks = [];
  for (let a = -RINGS; a < RINGS; a++) {
    for (let b = -RINGS; b < RINGS; b++) {
      const cx = (a + 0.5) * PITCH, cz = (b + 0.5) * PITCH;
      const isPark = ((a * 7 + b * 11) % 5 + 5) % 5 === 0;
      if (isPark) {
        parkland.push(slab(cx, cz, BLOCK, BLOCK, 0.03));
        parks.push({ cx, cz });
      } else {
        plazas.push(slab(cx, cz, BLOCK, BLOCK, 0.03));
      }
    }
  }

  const add = (list, mat) => {
    const g = mergeAll(list);
    if (!g) return;
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    group.add(m);
  };
  add(roads, new THREE.MeshStandardMaterial({ color: 0x6f7b84, roughness: 0.95 }));
  add(plazas, new THREE.MeshStandardMaterial({ color: 0xded4c0, roughness: 0.94 }));
  add(parkland, new THREE.MeshStandardMaterial({ color: 0x8fc98a, roughness: 0.95 }));
  add(dashes, new THREE.MeshStandardMaterial({ color: 0xfdf6e6, roughness: 0.8 }));
  add(zebras, new THREE.MeshStandardMaterial({ color: 0xfdf6e6, roughness: 0.8 }));

  group.add(makeTrees(parks));
  return group;
}

/* ── trees, two instanced meshes for the whole city ── */
function makeTrees(parks) {
  const g = new THREE.Group();
  const spots = [];
  for (const p of parks) {
    if (Math.hypot(p.cx, p.cz) < 130) continue;      // keep the circuit clear
    for (let i = 0; i < 7; i++) {
      spots.push({
        x: p.cx + (Math.random() - 0.5) * (BLOCK - 10),
        z: p.cz + (Math.random() - 0.5) * (BLOCK - 10),
        s: 0.8 + Math.random() * 0.7,
      });
    }
  }
  if (!spots.length) return g;

  const trunkGeo = new THREE.CylinderGeometry(0.4, 0.55, 3, 5);
  trunkGeo.translate(0, 1.5, 0);
  const leafGeo = new THREE.IcosahedronGeometry(2.3, 0);
  leafGeo.translate(0, 4.4, 0);

  const trunk = new THREE.InstancedMesh(
    trunkGeo, new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9 }), spots.length);
  const leaf = new THREE.InstancedMesh(
    leafGeo, new THREE.MeshStandardMaterial({ color: 0x4ea86a, roughness: 0.85, flatShading: true }), spots.length);

  const m = new THREE.Matrix4(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), q = new THREE.Quaternion();
  spots.forEach((s, i) => {
    pos.set(s.x, 0, s.z);
    scl.set(s.s, s.s, s.s);
    m.compose(pos, q, scl);
    trunk.setMatrixAt(i, m);
    leaf.setMatrixAt(i, m);
  });
  g.add(trunk, leaf);
  return g;
}

/* ── window sheets: dark glass on a white wall, tinted per instance ── */
function windowTexture(seed) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, 256, 512);

  const cols = 5, rows = 13;
  const cw = 256 / cols, ch = 512 / rows;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if ((i * 7 + j * 13 + seed * 5) % 11 === 0) continue;
      const a = 0.3 + ((i + j + seed) % 3) * 0.06;
      x.fillStyle = `rgba(28,62,66,${a})`;
      const w = cw * 0.52, h = ch * 0.4;
      roundRect(x, i * cw + (cw - w) / 2, j * ch + (ch - h) / 2, w, h, 4);
      x.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// pulled from the reference artwork: deep teal, cyan, cream, yellow, coral
const PALETTE = [
  0x2bb3a3, 0x4fd1c5, 0x1c5f5c, 0xffc93c, 0xff7a5c,
  0xe4d7bd, 0x7cd6c8, 0xffb703, 0x3f8f8b, 0xffd98a,
];

/* ═══════════════════════════════════════════════
   Towers, billboards, train, clouds
   ═══════════════════════════════════════════════ */
export function makeCity(trackPoints, opts = {}) {
  const { count = 190 } = opts;

  const group = new THREE.Group();
  group.name = 'city';

  // fast rejection grid over the track footprint
  const cell = 12;
  const grid = new Set();
  const key = (i, j) => i + ',' + j;
  for (const p of trackPoints) {
    const i = Math.round(p.x / cell), j = Math.round(p.z / cell);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) grid.add(key(i + a, j + b));
  }
  const nearTrack = (x, z) => grid.has(key(Math.round(x / cell), Math.round(z / cell)));
  const nearRail = (x, z) => Math.abs(Math.hypot(x, z) - TRAIN_R) < 12;

  // ── towers, dropped into block interiors so they line the streets ──
  const VARIANTS = 4;
  const buckets = Array.from({ length: VARIANTS }, () => []);
  const placed = [];

  const blocks = [];
  for (let a = -RINGS; a < RINGS; a++) {
    for (let b = -RINGS; b < RINGS; b++) {
      if (((a * 7 + b * 11) % 5 + 5) % 5 === 0) continue;    // that block is a park
      const cx = (a + 0.5) * PITCH, cz = (b + 0.5) * PITCH;
      const rad = Math.hypot(cx, cz);
      if (rad < 135 || rad > 430) continue;
      blocks.push({ cx, cz, rad });
    }
  }
  blocks.sort(() => Math.random() - 0.5);

  for (const blk of blocks) {
    if (placed.length >= count) break;
    const perBlock = 1 + ((Math.random() * 3) | 0);
    for (let n = 0; n < perBlock && placed.length < count; n++) {
      const w = 9 + Math.random() * 13;
      const d = 9 + Math.random() * 13;
      const x = blk.cx + (Math.random() - 0.5) * (BLOCK - w - 4);
      const z = blk.cz + (Math.random() - 0.5) * (BLOCK - d - 4);
      if (nearTrack(x, z) || nearRail(x, z)) continue;

      let ok = true;
      for (const p of placed) {
        if (Math.abs(p.x - x) < (p.w + w) * 0.55 && Math.abs(p.z - z) < (p.d + d) * 0.55) { ok = false; break; }
      }
      if (!ok) continue;

      const far = THREE.MathUtils.clamp((blk.rad - 135) / 295, 0, 1);
      const h = THREE.MathUtils.lerp(11, 72, Math.pow(Math.random(), 1.4)) * (0.6 + far * 0.8);
      placed.push({ x, z, w, d, h });
      buckets[(Math.random() * VARIANTS) | 0].push({
        x, z, w, d, h, color: PALETTE[(Math.random() * PALETTE.length) | 0],
      });
    }
  }

  const box = new THREE.BoxGeometry(1, 1, 1);
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();

  buckets.forEach((list, v) => {
    if (!list.length) return;
    const mat = new THREE.MeshStandardMaterial({
      map: windowTexture(v), roughness: 0.68, metalness: 0.04, envMapIntensity: 0.28,
    });
    const inst = new THREE.InstancedMesh(box, mat, list.length);
    list.forEach((b, i) => {
      pos.set(b.x, b.h / 2, b.z);
      scl.set(b.w, b.h, b.d);
      mtx.compose(pos, q, scl);
      inst.setMatrixAt(i, mtx);
      inst.setColorAt(i, col.setHex(b.color));
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = false;
    inst.receiveShadow = false;
    group.add(inst);
  });

  // roof caps
  const caps = placed.filter(b => b.h > 32);
  if (caps.length) {
    const capMesh = new THREE.InstancedMesh(
      box, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }), caps.length);
    caps.forEach((b, i) => {
      pos.set(b.x, b.h + 0.6, b.z);
      scl.set(b.w * 1.06, 1.2, b.d * 1.06);
      mtx.compose(pos, q, scl);
      capMesh.setMatrixAt(i, mtx);
      capMesh.setColorAt(i, col.setHex(PALETTE[(i * 3) % PALETTE.length]));
    });
    capMesh.instanceMatrix.needsUpdate = true;
    group.add(capMesh);
  }

  group.add(makeBillboards(nearTrack));

  const train = makeTrain();
  group.add(train);

  const clouds = makeClouds();
  group.add(clouds);

  group.userData.train = train;
  group.userData.clouds = clouds;
  return group;
}

/* ── billboards around the circuit ── */
function makeBillboards(nearTrack) {
  const g = new THREE.Group();
  const signs = [
    { text: 'NITRO 9', c1: '#ff7a5c', c2: '#ffc93c' },
    { text: 'VOLTEC', c1: '#2bb3a3', c2: '#4fd1c5' },
    { text: 'APEXCO', c1: '#0f3d3c', c2: '#2bb3a3' },
    { text: 'HOTLAP', c1: '#ffc93c', c2: '#ff7a5c' },
    { text: 'TURBO ST', c1: '#1c5f5c', c2: '#4fd1c5' },
    { text: 'DIE-CAST', c1: '#4fd1c5', c2: '#ffc93c' },
  ];
  const legMat = new THREE.MeshStandardMaterial({ color: 0xdfd6c4, roughness: 0.7, metalness: 0.2 });
  const signGeo = new THREE.PlaneGeometry(30, 9);
  const legs = [];

  signs.forEach((s, i) => {
    const ang = (i / signs.length) * Math.PI * 2 + 0.5;
    let rad = 96 + ((i * 37) % 20);
    while (rad < 230 && (nearTrack(Math.cos(ang) * rad, Math.sin(ang) * rad)
      || Math.abs(rad - TRAIN_R) < 10)) rad += 6;
    const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
    const y = 26 + ((i * 17) % 28);
    const mat = new THREE.MeshBasicMaterial({ map: signTexture(s), transparent: true });

    // two printed faces — one panel with a blank back looks broken from the
    // cinematic orbit, and a DoubleSide plane shows the far side mirrored
    const front = new THREE.Mesh(signGeo, mat);
    front.position.set(x, y, z);
    front.lookAt(0, y * 0.6, 0);
    g.add(front);

    const back = new THREE.Mesh(signGeo, mat);
    back.position.copy(front.position);
    back.quaternion.copy(front.quaternion);
    back.rotateY(Math.PI);
    g.add(back);

    const leg = new THREE.BoxGeometry(1.1, y, 1.1).translate(x, y / 2, z);
    legs.push(leg);
  });
  g.add(new THREE.Mesh(mergeAll(legs), legMat));
  return g;
}

/* ── a little train doing laps of the city ── */
function makeTrain() {
  const g = new THREE.Group();
  g.name = 'train';

  // rails + sleepers
  const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa6ae, roughness: 0.5, metalness: 0.6 });
  for (const r of [TRAIN_R - 1.5, TRAIN_R + 1.5]) {
    const rail = new THREE.Mesh(new THREE.TorusGeometry(r, 0.22, 4, 128), railMat);
    rail.rotation.x = -Math.PI / 2;
    rail.position.y = 0.5;
    g.add(rail);
  }
  const sleeper = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.2, 0.3, 5), new THREE.MeshStandardMaterial({ color: 0x9c7c5c, roughness: 0.9 }), 120);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(),
    s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    p.set(Math.cos(a) * TRAIN_R, 0.18, Math.sin(a) * TRAIN_R);
    q.setFromAxisAngle(up, -a);
    m.compose(p, q, s);
    sleeper.setMatrixAt(i, m);
  }
  g.add(sleeper);

  // Carriages share one spinning group, so their geometry can be baked
  // together: five carriages collapse from ~16 draw calls to four.
  const cars = new THREE.Group();
  cars.name = 'carriages';
  const COLOURS = [0xff7a5c, 0xffc93c, 0x4fd1c5, 0xffc93c, 0x4fd1c5];
  const byColour = new Map();
  const roofs = [], bits = [];

  for (let i = 0; i < 5; i++) {
    const a = -i * 0.055;
    const place = geo => {
      const mesh = new THREE.Mesh(geo);
      mesh.position.set(Math.cos(a) * TRAIN_R, 0.5, Math.sin(a) * TRAIN_R);
      mesh.rotation.y = -a + Math.PI / 2;
      mesh.updateMatrix();
      return geo.clone().applyMatrix4(mesh.matrix);
    };

    const body = new THREE.BoxGeometry(5.6, 3, 3.2).translate(0, 2.3, 0);
    const key = COLOURS[i];
    if (!byColour.has(key)) byColour.set(key, []);
    byColour.get(key).push(place(body));

    roofs.push(place(new THREE.BoxGeometry(5.8, 0.4, 3.4).translate(0, 4, 0)));
    if (i === 0) {
      bits.push(place(new THREE.CylinderGeometry(0.4, 0.55, 1.6, 8).translate(1.9, 5, 0)));
    }
  }

  for (const [colour, list] of byColour) {
    const mesh = new THREE.Mesh(
      mergeAll(list),
      new THREE.MeshStandardMaterial({ color: colour, roughness: 0.45, metalness: 0.15 })
    );
    mesh.castShadow = true;
    cars.add(mesh);
  }
  cars.add(new THREE.Mesh(mergeAll(roofs),
    new THREE.MeshStandardMaterial({ color: 0xfdf6e6, roughness: 0.6 })));
  cars.add(new THREE.Mesh(mergeAll(bits),
    new THREE.MeshStandardMaterial({ color: 0x0f3d3c, roughness: 0.6 })));

  g.add(cars);
  g.userData.cars = cars;
  return g;
}

/* ── soft cloud sprites ── */
function makeClouds() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,.98)');
  g.addColorStop(0.5, 'rgba(255,255,255,.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);

  const group = new THREE.Group();
  group.name = 'clouds';
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.92, depthWrite: false });
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Sprite(mat);
    const ang = (i / 10) * Math.PI * 2 + Math.random();
    const rad = 240 + Math.random() * 280;
    s.position.set(Math.cos(ang) * rad, 85 + Math.random() * 90, Math.sin(ang) * rad);
    const k = 70 + Math.random() * 110;
    s.scale.set(k, k * 0.52, 1);
    group.add(s);
  }
  return group;
}

/** One matrix each per frame: the train laps, the clouds drift. */
export function updateCity(city, t) {
  const train = city.userData.train;
  if (train) train.userData.cars.rotation.y = t * 0.055;
  const clouds = city.userData.clouds;
  if (clouds) clouds.rotation.y = t * 0.004;
}

function signTexture(s) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 320;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 1024, 320);

  const grd = x.createLinearGradient(0, 0, 1024, 320);
  grd.addColorStop(0, s.c1); grd.addColorStop(1, s.c2);
  x.fillStyle = grd;
  roundRect(x, 8, 8, 1008, 304, 30); x.fill();

  x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 9;
  roundRect(x, 26, 26, 972, 268, 22); x.stroke();

  x.fillStyle = '#ffffff';
  x.font = '900 132px Poppins, Arial Black, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(s.text, 512, 168);
  return new THREE.CanvasTexture(c);
}

function roundRect(x, a, b, w, h, r) {
  x.beginPath();
  x.moveTo(a + r, b);
  x.arcTo(a + w, b, a + w, b + h, r);
  x.arcTo(a + w, b + h, a, b + h, r);
  x.arcTo(a, b + h, a, b, r);
  x.arcTo(a, b, a + w, b, r);
  x.closePath();
}
