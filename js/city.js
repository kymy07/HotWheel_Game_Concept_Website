// ═══════════════════════════════════════════════
//  city.js — the world around the track
//  Dusk skydome, asphalt ground, a lit-window city that
//  keeps clear of the circuit footprint, neon billboards
//  and a few street props.
// ═══════════════════════════════════════════════
import * as THREE from 'three';

/* ── gradient sky dome ── */
export function makeSky() {
  const geo = new THREE.SphereGeometry(900, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, toneMapped: false,
    uniforms: {
      top: { value: new THREE.Color(0x060a16) },
      mid: { value: new THREE.Color(0x1c2440) },
      bot: { value: new THREE.Color(0x51264a) },
      glow: { value: new THREE.Color(0xff7a3c) },
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
        vec3 c = mix(bot, mid, smoothstep(0.35, 0.56, h));
        c = mix(c, top, smoothstep(0.56, 0.95, h));
        // warm horizon bloom toward -Z
        float sun = pow(max(0.0, dot(d, normalize(vec3(-0.35, 0.06, -1.0)))), 9.0);
        c += glow * sun * 0.55;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  return sky;
}

/* ── ground: dark asphalt with a faint block grid, tiled ── */
export function makeGround() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#0b0e15';
  x.fillRect(0, 0, 256, 256);
  // speckled tarmac
  for (let i = 0; i < 4200; i++) {
    x.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  // block edges
  x.strokeStyle = 'rgba(150,175,220,.09)';
  x.lineWidth = 3;
  x.strokeRect(0, 0, 256, 256);
  x.strokeStyle = 'rgba(150,175,220,.045)';
  x.lineWidth = 1;
  x.beginPath(); x.moveTo(128, 0); x.lineTo(128, 256); x.moveTo(0, 128); x.lineTo(256, 128); x.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(40, 40);
  tex.anisotropy = 4;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1400),
    new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.97, metalness: 0.0,
      color: 0xffffff, envMapIntensity: 0.18,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

/* ── window texture for buildings ── */
function windowTexture(tint) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#0b0e16'; x.fillRect(0, 0, 64, 128);
  const cols = 6, rows = 16;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const lit = Math.random();
      if (lit < 0.42) continue;
      const a = 0.25 + Math.random() * 0.75;
      x.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},${a})`;
      x.fillRect(i * 10 + 3, j * 8 + 2, 6, 4);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* ── the skyline ── */
export function makeCity(trackPoints, opts = {}) {
  const { count = 190, spread = 330 } = opts;

  const group = new THREE.Group();
  group.name = 'city';

  const tints = [[255, 214, 150], [150, 210, 255], [255, 160, 200], [180, 255, 220]];
  const mats = tints.map(t => {
    const tex = windowTexture(t);
    return new THREE.MeshStandardMaterial({
      color: 0x2b3245, roughness: 0.72, metalness: 0.28,
      emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.25, map: tex,
    });
  });

  // fast rejection grid over the track footprint
  const cell = 12;
  const grid = new Map();
  const key = (i, j) => i + ',' + j;
  for (const p of trackPoints) {
    const i = Math.round(p.x / cell), j = Math.round(p.z / cell);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) grid.set(key(i + a, j + b), 1);
  }
  const nearTrack = (x, z) => grid.has(key(Math.round(x / cell), Math.round(z / cell)));

  const box = new THREE.BoxGeometry(1, 1, 1);
  const placed = [];
  let guard = 0;

  while (placed.length < count && guard++ < count * 40) {
    const ang = Math.random() * Math.PI * 2;
    const rad = 40 + Math.pow(Math.random(), 0.62) * spread;
    const x = Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad * 0.92;
    if (nearTrack(x, z)) continue;

    // keep a little breathing room between towers
    let ok = true;
    for (const p of placed) {
      if (Math.abs(p.x - x) < p.w * 0.7 + 5 && Math.abs(p.z - z) < p.d * 0.7 + 5) { ok = false; break; }
    }
    if (!ok) continue;

    const distFactor = THREE.MathUtils.clamp((rad - 40) / spread, 0, 1);
    const h = THREE.MathUtils.lerp(9, 78, Math.pow(Math.random(), 1.5)) * (0.55 + distFactor * 0.9);
    const w = 8 + Math.random() * 14;
    const d = 8 + Math.random() * 14;

    const m = new THREE.Mesh(box, mats[(Math.random() * mats.length) | 0]);
    m.scale.set(w, h, d);
    m.position.set(x, h / 2, z);
    m.rotation.y = Math.random() < 0.35 ? Math.random() * 0.6 - 0.3 : 0;
    m.castShadow = false; m.receiveShadow = true;
    // stretch the window texture per building height
    group.add(m);
    placed.push({ x, z, w, d, h });

    // roof antenna / beacon on tall towers
    if (h > 46 && Math.random() < 0.5) {
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.25, 10, 6),
        new THREE.MeshStandardMaterial({ color: 0x3a4256, roughness: 0.5, metalness: 0.6 })
      );
      mast.position.set(x, h + 5, z);
      group.add(mast);
      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xff3355, toneMapped: false })
      );
      beacon.position.set(x, h + 10.4, z);
      beacon.userData.blink = Math.random() * 10;
      group.add(beacon);
    }
  }

  // ── neon billboards facing the circuit ──
  const signs = [
    { text: 'NITRO 9', c1: '#ff2d55', c2: '#ff9a1a' },
    { text: 'VOLTEC', c1: '#31d0ff', c2: '#3d7bff' },
    { text: 'APEXCO', c1: '#18e0c8', c2: '#a6ff2e' },
    { text: 'HOTLAP', c1: '#ff6a1a', c2: '#ff2d55' },
    { text: 'TURBO ST', c1: '#c86bff', c2: '#ff2d55' },
    { text: 'DIE-CAST', c1: '#ffd166', c2: '#ff6a1a' },
  ];
  signs.forEach((s, i) => {
    const ang = (i / signs.length) * Math.PI * 2 + 0.5;
    const rad = 118 + Math.random() * 46;
    const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
    const y = 26 + Math.random() * 28;

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 9),
      new THREE.MeshBasicMaterial({ map: signTexture(s), transparent: true, toneMapped: false })
    );
    mesh.position.set(x, y, z);
    mesh.lookAt(0, y * 0.6, 0);
    mesh.userData.flicker = Math.random() * 10;
    group.add(mesh);

    // solid back so the sign is a panel, not a one-sided hole
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 9),
      new THREE.MeshStandardMaterial({ color: 0x151a26, roughness: 0.85, metalness: 0.2, side: THREE.BackSide })
    );
    back.position.copy(mesh.position);
    back.quaternion.copy(mesh.quaternion);
    group.add(back);
  });

  return group;
}

function signTexture(s) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 320;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 1024, 320);
  x.fillStyle = 'rgba(8,10,18,.72)';
  roundRect(x, 8, 8, 1008, 304, 26); x.fill();

  const grd = x.createLinearGradient(0, 0, 1024, 320);
  grd.addColorStop(0, s.c1); grd.addColorStop(1, s.c2);
  x.strokeStyle = grd; x.lineWidth = 8;
  roundRect(x, 16, 16, 992, 288, 22); x.stroke();

  x.shadowColor = s.c1; x.shadowBlur = 38;
  x.fillStyle = grd;
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

/* ── animated bits (beacons, sign flicker) ── */
export function animateCity(city, t) {
  city.traverse(o => {
    if (o.userData.blink !== undefined) {
      o.visible = Math.sin(t * 2.2 + o.userData.blink) > -0.2;
    } else if (o.userData.flicker !== undefined) {
      o.material.opacity = 0.82 + Math.sin(t * 7 + o.userData.flicker) * 0.06 + Math.random() * 0.03;
      o.material.transparent = true;
    }
  });
}
