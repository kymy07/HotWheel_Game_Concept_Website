// ═══════════════════════════════════════════════
//  cars.js — procedural die-cast cars
//  Every model is built from code (no external assets)
//  and faces local +Z, so the app can orient it with a
//  makeBasis(right, up, forward) matrix straight from
//  the track frames.
//
//  Bodywork is authored as ~30 little meshes and then
//  merged per material before it reaches the scene: three
//  cars on track went from ~105 draw calls to ~40, and the
//  same saving again on the shadow pass.
// ═══════════════════════════════════════════════
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

export const CARS = [
  {
    id: 'blaze', name: 'Blaze GT', klass: 'Muscle',
    color: 0xff2d3f, accent: 0x2a0308, glass: 0x123048,
    speed: 0.86, accel: 0.78, grip: 0.72,
    body: { len: 4.6, wid: 2.05, hgt: 0.95, ride: 0.52 },
    cabin: { len: 1.9, wid: 1.62, hgt: 0.62, z: -0.28 },
    wheel: { r: 0.56, w: 0.42, fz: 1.5, bz: -1.45, x: 0.94 },
    spoiler: 'ducktail', scoop: true, stripe: 0xffffff,
  },
  {
    id: 'apex', name: 'Apex F1', klass: 'Formula',
    color: 0x18e0c8, accent: 0x04302c, glass: 0x0a2630,
    speed: 1.0, accel: 1.0, grip: 0.95,
    body: { len: 5.2, wid: 1.25, hgt: 0.5, ride: 0.36 },
    cabin: { len: 1.1, wid: 0.86, hgt: 0.38, z: -0.35 },
    wheel: { r: 0.5, w: 0.5, fz: 1.9, bz: -1.8, x: 1.12 },
    spoiler: 'wing', openWheel: true, nose: true, stripe: 0xffffff,
  },
  {
    id: 'volt', name: 'Volt Hyper', klass: 'Electric',
    color: 0x3d7bff, accent: 0xe8f1ff, glass: 0x0d2340,
    speed: 0.96, accel: 0.92, grip: 0.88,
    body: { len: 4.9, wid: 2.0, hgt: 0.78, ride: 0.42 },
    cabin: { len: 2.3, wid: 1.66, hgt: 0.5, z: -0.1 },
    wheel: { r: 0.54, w: 0.4, fz: 1.62, bz: -1.6, x: 0.94 },
    spoiler: 'wing', glow: 0x63a4ff, stripe: 0x9ecbff,
  },
  {
    id: 'titan', name: 'Titan 4×4', klass: 'Offroad',
    color: 0xa6ff2e, accent: 0x1d2b06, glass: 0x18301e,
    speed: 0.72, accel: 0.7, grip: 1.0,
    body: { len: 4.5, wid: 2.25, hgt: 1.25, ride: 0.95 },
    cabin: { len: 2.0, wid: 1.9, hgt: 0.95, z: -0.15 },
    wheel: { r: 0.86, w: 0.62, fz: 1.5, bz: -1.5, x: 1.06 },
    spoiler: 'rollbar', scoop: true, stripe: 0x27340c,
  },
  {
    id: 'retro', name: "Retro '68", klass: 'Classic',
    color: 0xf5e3b3, accent: 0x4a2f13, glass: 0x243746,
    speed: 0.78, accel: 0.74, grip: 0.68,
    body: { len: 4.7, wid: 2.0, hgt: 1.0, ride: 0.56 },
    cabin: { len: 2.2, wid: 1.7, hgt: 0.78, z: -0.2 },
    wheel: { r: 0.6, w: 0.4, fz: 1.55, bz: -1.5, x: 0.92 },
    spoiler: 'none', stripe: 0xc0392b,
  },
];

const rb = (w, h, d, r = 0.14) => new RoundedBoxGeometry(w, h, d, 3, r);

/**
 * Bake a mesh's transform into a standalone geometry.
 * RoundedBoxGeometry is non-indexed while Box/Cylinder/Torus are indexed, and
 * mergeGeometries silently returns null when the two are mixed — so everything
 * is dropped to non-indexed on the way in.
 */
function bake(mesh) {
  mesh.updateMatrix();
  const geo = mesh.geometry.clone().applyMatrix4(mesh.matrix);
  if (!geo.index) return geo;
  const flat = geo.toNonIndexed();
  geo.dispose();
  return flat;
}

function merge(list) {
  if (list.length === 1) return list[0];
  const merged = BufferGeometryUtils.mergeGeometries(list, false);
  if (!merged) throw new Error('mergeGeometries failed — mismatched attributes');
  list.forEach(g => g.dispose());
  return merged;
}

/** Collects meshes by material so each material becomes one draw call. */
function Batch() {
  const groups = new Map();
  return {
    add(mesh) {
      if (!groups.has(mesh.material)) groups.set(mesh.material, []);
      groups.get(mesh.material).push(bake(mesh));
      return mesh;
    },
    flush(parent, { castShadow = true } = {}) {
      for (const [material, list] of groups) {
        const mesh = new THREE.Mesh(merge(list), material);
        mesh.castShadow = castShadow;
        parent.add(mesh);
      }
      groups.clear();
    },
  };
}

/**
 * Build a car. Returns { group, wheels[], spec }.
 * Local axes: +Z forward, +Y up, +X right. Origin sits on the road.
 */
export function makeCar(spec) {
  const g = new THREE.Group();
  g.name = 'car-' + spec.id;

  const paint = new THREE.MeshStandardMaterial({
    color: spec.color, roughness: 0.26, metalness: 0.55, envMapIntensity: 1.1,
  });
  const dark = new THREE.MeshStandardMaterial({ color: spec.accent, roughness: 0.55, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({
    color: spec.glass, roughness: 0.08, metalness: 0.3,
    transparent: true, opacity: 0.72,
  });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdfe6ef, roughness: 0.15, metalness: 1.0 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1b1e26, roughness: 0.85, metalness: 0.05 });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfffaf0, emissive: 0xffe9b0, emissiveIntensity: 0.7, roughness: 0.2,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xff3b3b, emissive: 0xff1010, emissiveIntensity: 0.6, roughness: 0.3,
  });
  const stripeMat = spec.stripe !== undefined
    ? new THREE.MeshStandardMaterial({ color: spec.stripe, roughness: 0.35, metalness: 0.3 })
    : null;

  const B = spec.body, C = spec.cabin, W = spec.wheel;
  const baseY = W.r;
  const batch = Batch();
  const M = (geo, mat) => new THREE.Mesh(geo, mat);

  // ── main body ──
  const body = M(rb(B.wid, B.hgt, B.len, 0.22), paint);
  body.position.set(0, baseY + B.hgt * 0.5 - 0.1, 0);
  batch.add(body);

  const skirt = M(rb(B.wid * 0.94, 0.3, B.len * 0.92, 0.1), dark);
  skirt.position.set(0, baseY - 0.18, 0);
  batch.add(skirt);

  if (spec.nose) {
    const nose = M(rb(0.7, 0.34, 1.5, 0.12), paint);
    nose.position.set(0, baseY - 0.02, B.len * 0.5 + 0.5);
    batch.add(nose);
    const fw = M(new THREE.BoxGeometry(2.3, 0.08, 0.75), dark);
    fw.position.set(0, baseY - 0.22, B.len * 0.5 + 1.05);
    batch.add(fw);
  }

  // ── cabin / greenhouse ──
  const cabin = M(rb(C.wid, C.hgt, C.len, 0.18), glass);
  cabin.position.set(0, baseY + B.hgt + C.hgt * 0.5 - 0.22, C.z);
  batch.add(cabin);

  if (!spec.openWheel) {
    const roof = M(rb(C.wid * 0.98, 0.14, C.len * 0.72, 0.07), paint);
    roof.position.set(0, cabin.position.y + C.hgt * 0.5, C.z - 0.12);
    batch.add(roof);
  } else {
    const halo = M(new THREE.TorusGeometry(0.46, 0.06, 8, 20, Math.PI), chrome);
    halo.position.set(0, cabin.position.y + 0.2, C.z + 0.1);
    halo.rotation.set(-Math.PI / 2, 0, 0);
    batch.add(halo);
  }

  if (stripeMat) {
    const st = M(new THREE.BoxGeometry(0.34, 0.02, B.len * 0.98), stripeMat);
    st.position.set(0, baseY + B.hgt - 0.09, 0);
    batch.add(st);
  }

  if (spec.scoop) {
    const sc = M(rb(0.66, 0.26, 0.8, 0.08), dark);
    sc.position.set(0, baseY + B.hgt - 0.02, B.len * 0.22);
    batch.add(sc);
  }

  // ── spoilers ──
  if (spec.spoiler === 'wing') {
    const wing = M(new THREE.BoxGeometry(B.wid * 1.05, 0.09, 0.62), dark);
    wing.position.set(0, baseY + B.hgt + 0.52, -B.len * 0.5 - 0.05);
    wing.rotation.x = -0.16;
    batch.add(wing);
    for (const s of [-1, 1]) {
      const post = M(new THREE.BoxGeometry(0.1, 0.6, 0.16), dark);
      post.position.set(s * B.wid * 0.36, baseY + B.hgt + 0.24, -B.len * 0.5 - 0.05);
      batch.add(post);
    }
  } else if (spec.spoiler === 'ducktail') {
    const d = M(rb(B.wid * 0.92, 0.16, 0.6, 0.06), paint);
    d.position.set(0, baseY + B.hgt + 0.12, -B.len * 0.44);
    d.rotation.x = -0.3;
    batch.add(d);
  } else if (spec.spoiler === 'rollbar') {
    const bar = M(new THREE.TorusGeometry(0.85, 0.07, 8, 16, Math.PI), chrome);
    bar.position.set(0, baseY + B.hgt + 0.35, -B.len * 0.3);
    batch.add(bar);
    const lightBar = M(new THREE.BoxGeometry(1.5, 0.16, 0.16), headMat);
    lightBar.position.set(0, baseY + B.hgt + 1.12, -B.len * 0.3);
    batch.add(lightBar);
  }

  // ── lights ──
  for (const s of [-1, 1]) {
    const hl = M(new THREE.BoxGeometry(0.5, 0.16, 0.08), headMat);
    hl.position.set(s * B.wid * 0.28, baseY + B.hgt * 0.42, B.len * 0.5 + 0.01);
    batch.add(hl);
    const tl = M(new THREE.BoxGeometry(0.52, 0.14, 0.08), tailMat);
    tl.position.set(s * B.wid * 0.28, baseY + B.hgt * 0.46, -B.len * 0.5 - 0.01);
    batch.add(tl);
  }

  // ── fender flares (merged with the paint) ──
  if (!spec.openWheel) {
    for (const z of [W.fz, W.bz]) {
      for (const s of [-1, 1]) {
        const fl = M(rb(0.2, W.r * 1.1, W.r * 2.25, 0.09), paint);
        fl.position.set(s * (W.x - 0.06), baseY + W.r * 0.42, z);
        batch.add(fl);
      }
    }
  }

  batch.flush(g);

  // underglow stays its own mesh — transparent, and it must not cast
  if (spec.glow) {
    const ug = new THREE.Mesh(
      new THREE.PlaneGeometry(B.wid * 1.4, B.len * 1.25),
      new THREE.MeshBasicMaterial({
        color: spec.glow, transparent: true, opacity: 0.3, depthWrite: false,
      })
    );
    ug.rotation.x = -Math.PI / 2;
    ug.position.y = 0.03;
    g.add(ug);
  }

  // ── wheels: each hub is a tyre plus one merged rim-and-spokes ──
  const tyreGeo = new THREE.CylinderGeometry(W.r, W.r, W.w, 18);
  tyreGeo.rotateZ(Math.PI / 2);

  const rimGeo = new THREE.CylinderGeometry(W.r * 0.62, W.r * 0.62, W.w + 0.06, 10);
  rimGeo.rotateZ(Math.PI / 2);
  const rimParts = [rimGeo.toNonIndexed()];
  rimGeo.dispose();
  for (let k = 0; k < 3; k++) {
    const sp = new THREE.BoxGeometry(W.w + 0.08, W.r * 1.15, 0.09);
    sp.rotateX((k / 3) * Math.PI);
    rimParts.push(sp.toNonIndexed());
    sp.dispose();
  }
  const hubGeo = merge(rimParts);

  const wheels = [];
  for (const z of [W.fz, W.bz]) {
    for (const s of [-1, 1]) {
      const hub = new THREE.Group();
      const tyre = new THREE.Mesh(tyreGeo, rubber);
      tyre.castShadow = true;
      hub.add(tyre);
      hub.add(new THREE.Mesh(hubGeo, chrome));
      hub.position.set(s * W.x, baseY, z);
      g.add(hub);
      wheels.push(hub);
    }
  }

  return { group: g, wheels, spec };
}
