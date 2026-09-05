// ═══════════════════════════════════════════════
//  city.js — the world around the track (daylight)
//  Bright sky, soft ground, and a candy-coloured toy city.
//  Every tower is an InstancedMesh instance rather than its
//  own Mesh: ~190 buildings collapse from ~190 draw calls
//  down to 5, which is most of the frame budget back.
// ═══════════════════════════════════════════════
import * as THREE from 'three';

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

/* ── ground: soft mint with a faint block grid ── */
export function makeGround() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#ddd2ba';
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    x.fillStyle = `rgba(15,61,60,${Math.random() * 0.045})`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  x.strokeStyle = 'rgba(43,179,163,.30)';
  x.lineWidth = 4;
  x.strokeRect(0, 0, 256, 256);
  x.strokeStyle = 'rgba(43,179,163,.14)';
  x.lineWidth = 1;
  x.beginPath(); x.moveTo(128, 0); x.lineTo(128, 256); x.moveTo(0, 128); x.lineTo(256, 128); x.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(40, 40);
  tex.anisotropy = 4;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1400),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0, envMapIntensity: 0.2 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

/* ── window sheets: dark glass on a white wall, tinted per instance ── */
function windowTexture(seed) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;                 // 4x the old sheet: the windows
  const x = c.getContext('2d');                  // were visibly blocky when
  x.fillStyle = '#ffffff';                       // stretched up a tall tower
  x.fillRect(0, 0, 256, 512);

  const cols = 5, rows = 13;
  const cw = 256 / cols, ch = 512 / rows;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if ((i * 7 + j * 13 + seed * 5) % 11 === 0) continue;   // a few blanks
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

// cheerful toy-city palette
// pulled from the reference artwork: deep teal, cyan, cream, yellow, coral
const PALETTE = [
  0x2bb3a3, 0x4fd1c5, 0x1c5f5c, 0xffc93c, 0xff7a5c,
  0xe4d7bd, 0x7cd6c8, 0xffb703, 0x3f8f8b, 0xffd98a,
];

/* ── the skyline ── */
export function makeCity(trackPoints, opts = {}) {
  // inner radius keeps the skyline clear of the cinematic camera's orbit
  const { count = 190, inner = 100, spread = 290 } = opts;

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

  // ── place towers, bucketed by window-sheet variant ──
  const VARIANTS = 4;
  const buckets = Array.from({ length: VARIANTS }, () => []);
  const placed = [];
  let guard = 0;

  while (placed.length < count && guard++ < count * 40) {
    const ang = Math.random() * Math.PI * 2;
    const rad = inner + Math.pow(Math.random(), 0.62) * spread;
    const x = Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad * 0.92;
    if (nearTrack(x, z)) continue;

    let ok = true;
    for (const p of placed) {
      if (Math.abs(p.x - x) < p.w * 0.7 + 5 && Math.abs(p.z - z) < p.d * 0.7 + 5) { ok = false; break; }
    }
    if (!ok) continue;

    const distFactor = THREE.MathUtils.clamp((rad - inner) / spread, 0, 1);
    const h = THREE.MathUtils.lerp(10, 74, Math.pow(Math.random(), 1.5)) * (0.55 + distFactor * 0.9);
    const w = 8 + Math.random() * 14;
    const d = 8 + Math.random() * 14;

    placed.push({ x, z, w, d, h });
    buckets[(Math.random() * VARIANTS) | 0].push({
      x, z, w, d, h,
      rot: Math.random() < 0.35 ? Math.random() * 0.6 - 0.3 : 0,
      color: PALETTE[(Math.random() * PALETTE.length) | 0],
    });
  }

  // ── one InstancedMesh per variant ──
  const box = new THREE.BoxGeometry(1, 1, 1);
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  const yAxis = new THREE.Vector3(0, 1, 0);

  buckets.forEach((list, v) => {
    if (!list.length) return;
    const mat = new THREE.MeshStandardMaterial({
      map: windowTexture(v), roughness: 0.68, metalness: 0.04, envMapIntensity: 0.28,
    });
    const inst = new THREE.InstancedMesh(box, mat, list.length);
    list.forEach((b, i) => {
      pos.set(b.x, b.h / 2, b.z);
      scl.set(b.w, b.h, b.d);
      q.setFromAxisAngle(yAxis, b.rot);
      mtx.compose(pos, q, scl);
      inst.setMatrixAt(i, mtx);
      inst.setColorAt(i, col.setHex(b.color));
    });
    inst.instanceMatrix.needsUpdate = true;
    // Buildings neither cast nor receive: the shadow map is reserved for the
    // track and the cars, which is the only place it reads as anything.
    inst.castShadow = false;
    inst.receiveShadow = false;
    group.add(inst);
  });

  // ── roof caps: a flat slab of colour on the taller towers ──
  const caps = placed.filter(b => b.h > 34);
  if (caps.length) {
    const capMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const capMesh = new THREE.InstancedMesh(box, capMat, caps.length);
    caps.forEach((b, i) => {
      pos.set(b.x, b.h + 0.6, b.z);
      scl.set(b.w * 1.06, 1.2, b.d * 1.06);
      q.identity();
      mtx.compose(pos, q, scl);
      capMesh.setMatrixAt(i, mtx);
      capMesh.setColorAt(i, col.setHex(PALETTE[(i * 3) % PALETTE.length]));
    });
    capMesh.instanceMatrix.needsUpdate = true;
    group.add(capMesh);
  }

  // ── billboards around the circuit ──
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

  signs.forEach((s, i) => {
    const ang = (i / signs.length) * Math.PI * 2 + 0.5;
    // The circuit reaches out to a radius of ~100, so a fixed ring would spear
    // billboard legs straight through the track. Walk outwards until clear.
    let rad = 92 + ((i * 37) % 20);
    while (rad < 220 && nearTrack(Math.cos(ang) * rad, Math.sin(ang) * rad)) rad += 6;
    const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
    const y = 26 + ((i * 17) % 28);
    const mat = new THREE.MeshBasicMaterial({ map: signTexture(s), transparent: true });

    // Two printed faces rather than one panel with a blank grey back: the
    // billboard has to read from the track AND from the cinematic orbit
    // outside it, and a DoubleSide plane shows the far side mirrored.
    const front = new THREE.Mesh(signGeo, mat);
    front.position.set(x, y, z);
    front.lookAt(0, y * 0.6, 0);
    group.add(front);

    const back = new THREE.Mesh(signGeo, mat);
    back.position.copy(front.position);
    back.quaternion.copy(front.quaternion);
    back.rotateY(Math.PI);
    group.add(back);

    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.1, y, 1.1), legMat);
    leg.position.set(x, y / 2, z);
    group.add(leg);
  });

  group.add(makeClouds());
  return group;
}

/* ── a handful of soft cloud sprites ── */
function makeClouds() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,.95)');
  g.addColorStop(0.55, 'rgba(255,255,255,.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);

  const group = new THREE.Group();
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false });
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(mat);
    const ang = (i / 14) * Math.PI * 2 + Math.random();
    const rad = 260 + Math.random() * 300;
    s.position.set(Math.cos(ang) * rad, 120 + Math.random() * 130, Math.sin(ang) * rad);
    const k = 60 + Math.random() * 90;
    s.scale.set(k, k * 0.55, 1);
    group.add(s);
  }
  return group;
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
  x.font = '900 132px Orbitron, Arial Black, sans-serif';
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
