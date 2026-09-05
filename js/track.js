// ═══════════════════════════════════════════════
//  track.js — procedural Hot Wheels style circuit
//  Builds a closed centreline from driving primitives
//  (straight / banked turn / hill jump / vertical loop /
//   corkscrew), then extrudes an orange plastic track
//  with side rails and support pillars along it.
// ═══════════════════════════════════════════════
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/* ---------------------------------------------------------
   PathBuilder — walks a virtual pen through the world.
   yaw 0 = heading +X. Positive turn angle = turn right (+Z).
--------------------------------------------------------- */
export class PathBuilder {
  constructor(x = 0, y = 0, z = 0, yaw = 0) {
    this.pos = new THREE.Vector3(x, y, z);
    this.yaw = yaw;
    this.pts = [this.pos.clone()];
    this.ups = [UP.clone()];      // analytic "which way is up for the car" per sample
    this.step = 1.6;              // sample spacing (world units)
    this.marks = [];              // named sections for the HUD
  }

  get forward() {
    return new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }
  get right() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
  _push(p, up = UP) { this.pts.push(p.clone()); this.ups.push(up.clone().normalize()); this.pos.copy(p); }

  mark(name) { this.marks.push({ name, index: this.pts.length - 1 }); return this; }

  /** Flat or sloped straight. */
  straight(len, dy = 0) {
    const f = this.forward, s = this.pos.clone();
    const n = Math.max(2, Math.round(len / this.step));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const p = s.clone().addScaledVector(f, len * t);
      p.y = s.y + dy * t;
      this._push(p);
    }
    return this;
  }

  /**
   * Straight with a bump — the jump ramp. Raised cosine, not a half sine:
   * a half sine leaves the ground at a 40°+ kink, which shows up as a hard
   * crease in the frames and pops the car.
   */
  hill(len, height, dy = 0) {
    const f = this.forward, s = this.pos.clone();
    const n = Math.max(10, Math.round(len / this.step));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const p = s.clone().addScaledVector(f, len * t);
      p.y = s.y + dy * t + height * 0.5 * (1 - Math.cos(Math.PI * 2 * t));
      this._push(p);
    }
    return this;
  }

  /** Horizontal arc. deg > 0 turns right, deg < 0 turns left. */
  turn(deg, radius, dy = 0) {
    const ang = THREE.MathUtils.degToRad(deg);
    const sign = Math.sign(ang) || 1;
    const f = this.forward, r = this.right;
    const s = this.pos.clone();
    const center = s.clone().addScaledVector(r, sign * radius);
    const n = Math.max(8, Math.round((Math.abs(ang) * radius) / this.step));
    for (let i = 1; i <= n; i++) {
      const t = i / n, phi = Math.abs(ang) * t;
      const p = center.clone()
        .addScaledVector(r, -sign * radius * Math.cos(phi))
        .addScaledVector(f, radius * Math.sin(phi));
      // ease the climb so the turn joins the flat straights without a crease
      p.y = s.y + dy * (t * t * (3 - 2 * t));
      this._push(p);
    }
    this.yaw += ang;
    return this;
  }

  /**
   * Vertical loop-the-loop, leaning forward by `len` so it never self-touches.
   * The car's up points at the loop centre, so it rolls upside down at the top.
   */
  loop(radius, len = 0) {
    const f = this.forward, s = this.pos.clone();
    const center = s.clone().addScaledVector(UP, radius);
    const n = 108;
    for (let i = 1; i <= n; i++) {
      const t = i / n, phi = Math.PI * 2 * t;
      const p = center.clone()
        .addScaledVector(f, radius * Math.sin(phi) + len * t)
        .addScaledVector(UP, -radius * Math.cos(phi));
      const up = UP.clone().multiplyScalar(Math.cos(phi)).addScaledVector(f, -Math.sin(phi));
      this._push(p, up);
    }
    return this;
  }

  /** Corkscrew: helix wrapped around the direction of travel. */
  corkscrew(len, radius, turns = 1) {
    const f = this.forward, r = this.right, s = this.pos.clone();
    const n = Math.max(60, Math.round(len / 0.8));
    for (let i = 1; i <= n; i++) {
      const t = i / n, phi = Math.PI * 2 * turns * t;
      // ease the radius in and out so entry/exit stay flat
      const rr = radius * (0.25 + 0.75 * Math.sin(Math.PI * t));
      const p = s.clone()
        .addScaledVector(f, len * t)
        .addScaledVector(r, rr * Math.sin(phi))
        .addScaledVector(UP, rr * (1 - Math.cos(phi)));
      // up points back at the helix axis
      const up = UP.clone().multiplyScalar(Math.cos(phi)).addScaledVector(r, -Math.sin(phi));
      this._push(p, up);
    }
    return this;
  }

  /** Closed CatmullRom through every sample, plus the matching up vectors. */
  build() {
    const pts = this.pts.slice(), ups = this.ups.slice();
    // drop a duplicated closing point if present
    if (pts[0].distanceTo(pts[pts.length - 1]) < 0.4) { pts.pop(); ups.pop(); }
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    curve.arcLengthDivisions = 6000;
    return { curve, ups };
  }
}

/* ---------------------------------------------------------
   Frames from the analytic up vectors recorded while drawing
   the path. Parallel transport was the obvious choice here,
   but a corkscrew leaves a holonomy residue that never closes
   (~110° of phantom roll spread over the lap), so instead we
   sample the exact up per primitive: world-up on the flat
   stuff, loop-centre-facing in the loop, axis-facing in the
   corkscrew. Closes perfectly, no seam pop.
   Frames are spaced by ARC LENGTH; u → t → control index.
--------------------------------------------------------- */
export function computeFrames(curve, N, ups) {
  const points = [], tangents = [], normals = [], binormals = [];
  const P = curve.points.length;
  const up = new THREE.Vector3(), n = new THREE.Vector3();
  const flat = new Float32Array(N);   // 1 = level section, 0 = loop / corkscrew

  for (let i = 0; i < N; i++) {
    const t = curve.getUtoTmapping(i / N);
    const pos = curve.getPoint(t);
    const tan = curve.getTangent(t).normalize();

    // closed CatmullRom: parameter t maps straight onto control index t·P
    const f = t * P;
    const k = Math.floor(f) % P, k2 = (k + 1) % P, w = f - Math.floor(f);
    up.copy(ups[k]).lerp(ups[k2], w);
    if (up.lengthSq() < 1e-8) up.copy(UP);
    up.normalize();

    // only level sections get banked; inside a loop the horizontal heading
    // spins meaninglessly and would otherwise inject a roll spike
    flat[i] = THREE.MathUtils.smoothstep(up.dot(UP), 0.86, 0.985) *
      (Math.abs(tan.y) > 0.55 ? 0 : 1);

    // orthogonalise against the tangent (guard the degenerate parallel case)
    n.copy(up).addScaledVector(tan, -tan.dot(up));
    if (n.lengthSq() < 1e-6) n.copy(UP).addScaledVector(tan, -tan.dot(UP));
    n.normalize();

    points.push(pos);
    tangents.push(tan);
    normals.push(n.clone());
    binormals.push(new THREE.Vector3().crossVectors(tan, n).normalize());
  }

  // ── banking: roll into horizontal corners like a real track ──
  const rate = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = tangents[i], b = tangents[(i + 1) % N];
    const ax = Math.atan2(a.z, a.x), bx = Math.atan2(b.z, b.x);
    let d = bx - ax;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    rate[i] = d * flat[i];
  }
  smooth(flat, 30, 3);
  smooth(rate, 26, 4);
  for (let i = 0; i < N; i++) rate[i] *= flat[i];

  const MAX_BANK = THREE.MathUtils.degToRad(26);
  for (let i = 0; i < N; i++) {
    const bank = THREE.MathUtils.clamp(rate[i] * 70, -MAX_BANK, MAX_BANK);
    if (Math.abs(bank) > 1e-4) {
      normals[i].applyAxisAngle(tangents[i], -bank).normalize();
      binormals[i].crossVectors(tangents[i], normals[i]).normalize();
    }
  }

  return { points, tangents, normals, binormals, count: N, curvature: rate };
}

function smooth(arr, radius, passes = 1) {
  const n = arr.length, tmp = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let k = -radius; k <= radius; k++) { s += arr[(i + k + n * 4) % n]; c++; }
      tmp[i] = s / c;
    }
    arr.set(tmp);
  }
  return arr;
}

/* ---------------------------------------------------------
   Extrude a 2D profile along the frames.
   profile: [[u, v], ...] in (binormal, normal) space, closed.
--------------------------------------------------------- */
function extrude(frames, profile, uvRepeat = 1) {
  const { points, normals, binormals, count } = frames;
  const np = profile.length;
  const pos = [], uv = [], idx = [];

  for (let i = 0; i <= count; i++) {
    const k = i % count;
    const P = points[k], N = normals[k], B = binormals[k];
    for (let j = 0; j < np; j++) {
      const [u, v] = profile[j];
      pos.push(P.x + B.x * u + N.x * v, P.y + B.y * u + N.y * v, P.z + B.z * u + N.z * v);
      uv.push(j / (np - 1), (i / count) * uvRepeat);
    }
  }
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < np; j++) {
      const j2 = (j + 1) % np;
      const a = i * np + j, b = i * np + j2, c = (i + 1) * np + j2, d = (i + 1) * np + j;
      idx.push(a, b, c, a, c, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---------------------------------------------------------
   The circuit layout. Closes exactly:
   4 × 90° right turns (same radius) + equal opposite straights.
--------------------------------------------------------- */
export function buildCircuit() {
  const pb = new PathBuilder(-47, 5, -61, 0);

  // ── side A (+X) : start/finish straight → giant vertical loop ──
  pb.mark('Start / Finish').straight(30);
  pb.mark('The Loop').loop(12, 16).straight(48);

  pb.mark('Turn 1 — Skyline').turn(90, 26, 6);

  // ── side B (+Z) : elevated jump ──
  pb.straight(10).mark('Big Air').hill(50, 15).straight(10);

  pb.mark('Turn 2 — Downtown').turn(90, 26, -6);

  // ── side C (−X) : corkscrew ──
  pb.straight(18).mark('Corkscrew').corkscrew(50, 9, 1).straight(26);

  pb.mark('Turn 3 — Neon Bend').turn(90, 26);

  // ── side D (−Z) : sweeping run home ──
  pb.mark('Back Straight').hill(70, -2.5);

  pb.mark('Turn 4 — Final').turn(90, 26);

  const { curve, ups } = pb.build();

  // Section markers are recorded as control-point indices, but control points
  // are far denser inside the loop and corkscrew than on the straights, so
  // convert each one to a true arc-length fraction for the HUD.
  const lengths = curve.getLengths();
  const total = lengths[lengths.length - 1];
  const P = curve.points.length;
  const marks = pb.marks.map(m => {
    const t = (m.index % P) / P;
    return { name: m.name, u: lengths[Math.round(t * (lengths.length - 1))] / total };
  }).sort((a, b) => a.u - b.u);

  return { curve, ups, marks };
}

/* ---------------------------------------------------------
   Track mesh: road bed + two rails + glow strips + pillars
--------------------------------------------------------- */
export function buildTrackMesh(frames) {
  const HW = 3.9;        // half width (wide enough for two cars abreast)
  const DECK = 0.42;     // deck thickness
  const RAIL_H = 1.15;
  const RAIL_W = 0.55;

  const group = new THREE.Group();
  group.name = 'track';

  // road bed ------------------------------------------------
  const bedGeo = extrude(frames, [
    [-HW, 0], [HW, 0], [HW, -DECK], [-HW, -DECK],
  ], 160);
  const bedMat = new THREE.MeshStandardMaterial({
    color: 0xff7d22, roughness: 0.46, metalness: 0.04,
  });
  const bed = new THREE.Mesh(bedGeo, bedMat);
  bed.castShadow = true; bed.receiveShadow = true;
  group.add(bed);

  // rails ---------------------------------------------------
  const railMat = new THREE.MeshStandardMaterial({
    color: 0xffa63c, roughness: 0.34, metalness: 0.1,
  });
  for (const s of [-1, 1]) {
    const x0 = s * HW, x1 = s * (HW - RAIL_W);
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    const geo = extrude(frames, [
      [lo, RAIL_H], [hi, RAIL_H], [hi, -DECK], [lo, -DECK],
    ], 160);
    const m = new THREE.Mesh(geo, railMat);
    m.castShadow = true;
    group.add(m);
  }

  // neon glow strip on top of each rail ---------------------
  const glowMat = new THREE.MeshStandardMaterial({ color: 0xffe08a, roughness: 0.35, metalness: 0.05 });
  for (const s of [-1, 1]) {
    const c = s * (HW - RAIL_W / 2);
    const geo = extrude(frames, [
      [c - 0.16, RAIL_H + 0.03], [c + 0.16, RAIL_H + 0.03],
      [c + 0.16, RAIL_H - 0.05], [c - 0.16, RAIL_H - 0.05],
    ], 1);
    group.add(new THREE.Mesh(geo, glowMat));
  }

  // centre lane line ----------------------------------------
  const lineTex = dashTexture();
  const lineGeo = extrude(frames, [
    [-0.22, 0.035], [0.22, 0.035], [0.22, 0.0], [-0.22, 0.0],
  ], 300);
  group.add(new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({
    map: lineTex, transparent: true, opacity: 0.6, depthWrite: false, color: 0xffffff,
  })));

  // support pillars -----------------------------------------
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0xb7c3d4, roughness: 0.6, metalness: 0.25 });
  const { points, normals, count } = frames;
  const pillarGeo = new THREE.CylinderGeometry(0.7, 1.15, 1, 10);
  const spots = [];
  for (let i = 0; i < count; i += 44) {
    const p = points[i];
    if (p.y < 3.2 || normals[i].y < 0.55) continue;   // skip low / inverted track
    spots.push(p);
  }
  const pillars = new THREE.InstancedMesh(pillarGeo, pillarMat, spots.length);
  const mtx = new THREE.Matrix4();
  spots.forEach((p, i) => {
    const h = p.y - 0.4;
    mtx.makeScale(1, h, 1);
    mtx.setPosition(p.x, h / 2, p.z);
    pillars.setMatrixAt(i, mtx);
  });
  pillars.castShadow = true;
  group.add(pillars);

  // start / finish gantry ----------------------------------
  group.add(startGate(frames, HW));

  return group;
}

function dashTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 16;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, 4, 16);
  x.fillStyle = '#fff'; x.fillRect(0, 0, 4, 9);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function startGate(frames, HW) {
  const g = new THREE.Group();
  const P = frames.points[0], B = frames.binormals[0], T = frames.tangents[0];
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5b6b82, roughness: 0.55, metalness: 0.45 });
  const postGeo = new THREE.BoxGeometry(0.7, 9, 0.7);

  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(postGeo, postMat);
    m.position.copy(P).addScaledVector(B, s * (HW + 2.1)).add(new THREE.Vector3(0, 4.5 - 0.4, 0));
    g.add(m);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 5, 1.9, 0.8), postMat);
  beam.position.copy(P).add(new THREE.Vector3(0, 9.0, 0));
  beam.lookAt(beam.position.clone().add(T));
  beam.rotateY(Math.PI / 2);
  g.add(beam);

  // glowing banner
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(HW * 2 + 4, 1.4),
    new THREE.MeshBasicMaterial({ map: bannerTexture(), transparent: true, toneMapped: false, side: THREE.DoubleSide })
  );
  banner.position.copy(beam.position).addScaledVector(T, -0.5);
  banner.lookAt(banner.position.clone().addScaledVector(T, -1));
  g.add(banner);

  return g;
}

function bannerTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 128;
  const x = c.getContext('2d');
  const grd = x.createLinearGradient(0, 0, 1024, 0);
  grd.addColorStop(0, '#ffb03a'); grd.addColorStop(1, '#ff5c8a');
  x.fillStyle = grd; x.fillRect(0, 0, 1024, 128);
  x.fillStyle = '#fff';
  x.font = '900 74px Orbitron, Arial Black, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('H O T L A P   C I R C U I T', 512, 70);
  return new THREE.CanvasTexture(c);
}
