// ═══════════════════════════════════════════════
//  app.js — scene, driving, cameras, UI
// ═══════════════════════════════════════════════
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { buildCircuit, computeFrames, buildTrackMesh } from './track.js';
import { CARS, makeCar } from './cars.js';
import { makeSky, makeGround, makeCity } from './city.js';

const $ = s => document.querySelector(s);
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

/* ═══════════ state ═══════════ */
const S = {
  playing: true,
  cam: 'cinematic',
  speedMul: 1,
  carIndex: 0,
  u: 0,              // 0..1 along the circuit
  v: 26,             // world units / second
  lap: 1,
  lapStart: 0,
  lastLap: 0,
  bestLap: 0,
  gForce: 0,
  sound: false,
  clock: 0,
};

let renderer, scene, camera, controls, composer, bloom;
let frames, curve, curveLen, marks, trackGroup;
let hero = null, rivals = [];
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const lookNow = new THREE.Vector3();
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
const basis = new THREE.Matrix4();

/* ═══════════ boot ═══════════ */
// NOTE: init() is called at the BOTTOM of this file, not here. It touches
// `sample`, which is a const arrow function — consts are not hoisted, so
// calling init() before that definition dies in the temporal dead zone.

function setStatus(pct, text) {
  $('#loader-fill').style.width = pct + '%';
  if (text) $('#loader-status').textContent = text;
}

function init() {
  const canvas = $('#scene');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88;
  // count a whole frame, not just the last composer pass
  renderer.info.autoReset = false;

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xa9cdf0, 0.00055);

  camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.4, 2000);
  camera.position.set(-120, 90, -150);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 12;
  controls.maxDistance = 520;
  controls.screenSpacePanning = false;
  controls.enabled = false;

  // Grabbing the scene should just work, whatever camera you were in.
  // The listener is capturing so it flips `enabled` on before OrbitControls'
  // own pointerdown handler runs — otherwise the first drag gets swallowed.
  const grab = () => { if (S.cam !== 'orbit') setCam('orbit'); };
  canvas.addEventListener('pointerdown', grab, true);
  canvas.addEventListener('wheel', grab, { capture: true, passive: true });

  setStatus(12, 'Laying out the circuit…');

  // ── circuit ──
  const circuit = buildCircuit();
  curve = circuit.curve;
  marks = circuit.marks;
  curveLen = curve.getLength();
  frames = computeFrames(curve, 2400, circuit.ups);

  setStatus(38, 'Moulding orange track…');
  trackGroup = buildTrackMesh(frames);
  scene.add(trackGroup);

  // ── world ──
  setStatus(58, 'Raising the skyline…');
  scene.add(makeSky());
  scene.add(makeGround());
  scene.add(makeCity(frames.points.filter((_, i) => i % 6 === 0), { count: 190 }));

  // ── lights ──
  setStatus(74, 'Switching on the floodlights…');
  scene.add(new THREE.HemisphereLight(0xbcdcff, 0xd9cfae, 0.55));

  const key = new THREE.DirectionalLight(0xfff1d2, 2.3);
  key.position.set(-150, 190, -160);
  key.castShadow = true;
  // The shadow map only needs to cover the circuit, not the whole city —
  // a tight frustum at 1536 is sharper AND cheaper than a loose one at 2048.
  key.shadow.mapSize.set(1536, 1536);
  const sc = key.shadow.camera;
  sc.left = -115; sc.right = 115; sc.top = 115; sc.bottom = -115;
  sc.near = 40; sc.far = 480;
  key.shadow.bias = -0.0007;
  key.shadow.normalBias = 0.5;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xa8ccff, 0.35);
  fill.position.set(170, 90, 150);
  scene.add(fill);

  // environment reflections for the paintwork
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // ── cars ──
  setStatus(88, 'Rolling cars out of the garage…');
  spawnHero(S.carIndex);
  spawnRivals();

  // ── post ──
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth * 0.5, innerHeight * 0.5), 0.14, 0.7, 0.95);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  buildUI();
  addEventListener('resize', onResize);

  // seed camera
  placeHero(0);
  camPos.copy(camera.position);
  camLook.set(0, 6, 0);
  lookNow.copy(camLook);

  setStatus(100, 'Ready');
  const btn = $('#enter-btn');
  btn.disabled = false;
  requestAnimationFrame(() => btn.classList.add('ready'));
  btn.addEventListener('click', enter);

  renderer.setAnimationLoop(tick);
}

function enter() {
  $('#loader').classList.add('done');
  document.body.classList.add('live');
  setTimeout(() => toast('Drag to look around  ·  Follow Car to ride along'), 1400);
}

/* ═══════════ cars on track ═══════════ */
function disposeCar(car) {
  car.group.traverse(o => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
  });
}

function spawnHero(i) {
  if (hero) { scene.remove(hero.group); disposeCar(hero); }
  hero = makeCar(CARS[i]);
  hero.lane = 0;
  scene.add(hero.group);
}

// Rivals ride fixed outer lanes so nobody ever drives through anybody.
function spawnRivals() {
  const picks = [{ car: 1, lane: -2.3, u: 0.42, lag: 0.9 }, { car: 3, lane: 2.3, u: 0.78, lag: 0.84 }];
  picks.forEach(p => {
    const r = makeCar(CARS[p.car]);
    r.u = p.u; r.v = 24; r.lag = p.lag; r.lane = p.lane;
    scene.add(r.group);
    rivals.push(r);
  });
}

/**
 * Sample the frames at u (0..1) into out{pos,fwd,up,right}.
 * Each sampler owns its vectors, so two live samples can coexist —
 * the chase camera needs the car AND a point further back on the curve.
 */
function makeSampler() {
  const pos = new THREE.Vector3(), fwd = new THREE.Vector3(),
    up = new THREE.Vector3(), right = new THREE.Vector3();
  return function (u) {
    const N = frames.count;
    const f = ((u % 1) + 1) % 1 * N;
    const i = Math.floor(f), t = f - i, j = (i + 1) % N;
    pos.copy(frames.points[i]).lerp(frames.points[j], t);
    fwd.copy(frames.tangents[i]).lerp(frames.tangents[j], t).normalize();
    up.copy(frames.normals[i]).lerp(frames.normals[j], t).normalize();
    // re-orthogonalise
    up.addScaledVector(fwd, -fwd.dot(up)).normalize();
    right.crossVectors(up, fwd).normalize();
    return { pos, fwd, up, right, index: i };
  };
}
const sample = makeSampler();
const sampleB = makeSampler();

function orient(obj, s, lean = 0, lane = 0) {
  tmpA.copy(s.right); tmpB.copy(s.up); tmpC.copy(s.fwd);
  basis.makeBasis(tmpA, tmpB, tmpC);
  obj.quaternion.setFromRotationMatrix(basis);
  if (lean) obj.rotateZ(lean);
  obj.position.copy(s.pos).addScaledVector(s.up, 0.06).addScaledVector(s.right, lane);
}

function placeHero(dt) {
  const s = sample(S.u);
  const lean = clamp(-frames.curvature[s.index] * 26 * (S.v / 40), -0.3, 0.3);
  orient(hero.group, s, lean, hero.lane);
  const spin = (S.v / (hero.spec.wheel.r)) * dt;
  for (const w of hero.wheels) w.rotation.x -= spin;
  return s;
}

/* ═══════════ driving model ═══════════ */
function drive(dt) {
  const s = sample(S.u);
  const spec = hero.spec;

  const vmax = 48 * spec.speed * S.speedMul;
  const climb = Math.max(0, s.fwd.y);
  const dive = Math.max(0, -s.fwd.y);
  const corner = Math.abs(frames.curvature[s.index]);

  // desired speed: slower uphill and through corners, faster on the drops
  let target = vmax * (1 - 0.42 * climb) * (1 + 0.55 * dive);
  target *= 1 - clamp(corner * 34 * (1.15 - spec.grip), 0, 0.42);
  target = Math.max(target, 11 * S.speedMul);

  const rate = target > S.v ? 1.5 * spec.accel : 2.4;
  S.v += (target - S.v) * Math.min(1, dt * rate);

  S.u += (S.v * dt) / curveLen;
  if (S.u >= 1) {
    S.u -= 1;
    S.lastLap = S.clock - S.lapStart;
    if (!S.bestLap || S.lastLap < S.bestLap) S.bestLap = S.lastLap;
    S.lapStart = S.clock;
    S.lap++;
    flashLap();
  }

  // lateral + vertical load for the HUD
  const gLat = corner * S.v * 7.5;
  const gVert = Math.max(0, -s.up.y) * 1.1;
  S.gForce = lerp(S.gForce, clamp(gLat + gVert, 0, 1), 0.12);

  // rivals
  for (const r of rivals) {
    const rs = sample(r.u);
    const rt = 40 * r.spec.speed * S.speedMul * r.lag * (1 - 0.4 * Math.max(0, rs.fwd.y)) * (1 + 0.5 * Math.max(0, -rs.fwd.y));
    r.v += (Math.max(rt, 10) - r.v) * Math.min(1, dt * 1.8);
    r.u = (r.u + (r.v * dt) / curveLen) % 1;
    orient(r.group, rs, clamp(-frames.curvature[rs.index] * 24 * (r.v / 40), -0.28, 0.28), r.lane);
    const sp = (r.v / r.spec.wheel.r) * dt;
    for (const w of r.wheels) w.rotation.x -= sp;
  }
}

/* ═══════════ cameras ═══════════ */
function updateCamera(dt) {
  const s = sample(S.u);
  const car = tmpA.copy(s.pos);
  let damp = 0.08;

  if (S.cam === 'chase') {
    // Trail the car ALONG the curve, not on a straight line behind it —
    // a straight offset punches through the track inside the loop.
    const b = sampleB(S.u - (9 + S.v * 0.06) / curveLen);
    camPos.copy(b.pos).addScaledVector(b.up, 3.6 + S.v * 0.02);
    camLook.copy(car).addScaledVector(s.fwd, 3).addScaledVector(s.up, 1.2);
    damp = 0.16;
    camera.up.lerp(b.up, 0.12).normalize();

  } else if (S.cam === 'onboard') {
    // hood cam: sat on the nose, otherwise we render from inside the roof
    const B = hero.spec.body, W = hero.spec.wheel;
    camPos.copy(car)
      .addScaledVector(s.fwd, B.len * 0.42)
      .addScaledVector(s.up, W.r + B.hgt + 0.42);
    camLook.copy(car).addScaledVector(s.fwd, 18).addScaledVector(s.up, 1.2);
    damp = 0.4;
    camera.up.lerp(s.up, 0.25).normalize();

  } else if (S.cam === 'garage') {
    const a = S.clock * 0.42;
    camPos.copy(car)
      .addScaledVector(s.fwd, Math.cos(a) * 9.5)
      .addScaledVector(s.right, Math.sin(a) * 9.5)
      .addScaledVector(s.up, 3.2);
    camLook.copy(car).addScaledVector(s.up, 0.9);
    damp = 0.09;
    camera.up.lerp(s.up, 0.06).normalize();

  } else { // cinematic
    const a = S.clock * 0.055;
    const r = 170 + Math.sin(S.clock * 0.09) * 30;
    camPos.set(Math.cos(a) * r, 100 + Math.sin(S.clock * 0.13) * 18, Math.sin(a) * r);
    camLook.set(0, 8, 0).lerp(car, 0.4);
    damp = 0.02;
    camera.up.lerp(THREE.Object3D.DEFAULT_UP, 0.05).normalize();
  }

  if (S.cam === 'orbit') {
    controls.enabled = true;
    controls.update();
    return;
  }
  controls.enabled = false;

  const k = 1 - Math.pow(1 - damp, dt * 60);
  camera.position.lerp(camPos, k);
  lookNow.lerp(camLook, Math.min(1, k * 1.7));
  camera.lookAt(lookNow);

  // subtle speed FOV
  const targetFov = S.cam === 'onboard' ? 60 + S.v * 0.18 : S.cam === 'chase' ? 50 + S.v * 0.10 : 52;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 2.2);
  camera.updateProjectionMatrix();
}

function setCam(mode, quiet) {
  S.cam = mode;
  if (mode === 'orbit') {
    camera.up.set(0, 1, 0);
    controls.target.copy(sample(S.u).pos);
    controls.object.position.copy(camera.position);
    controls.enabled = true;
  }
  document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('is-active', b.dataset.cam === mode));
  movePill();
  $('#follow-btn').classList.toggle('is-on', mode === 'chase');
  $('#follow-btn').querySelector('span').textContent = mode === 'chase' ? 'Wide Shot' : 'Follow Car';
  if (!quiet) toast(LABEL[mode] || mode);
}
const LABEL = {
  cinematic: 'Cinematic — track fly-around',
  chase: 'Chase cam — ikut belakang kereta',
  onboard: 'Onboard — cockpit view',
  orbit: 'Free camera — drag & scroll',
  garage: 'Garage — spotlight kereta',
};

/* ═══════════ UI ═══════════ */
function buildUI() {
  // garage cards
  const list = $('#car-list');
  CARS.forEach((c, i) => {
    const hex = '#' + c.color.toString(16).padStart(6, '0');
    const b = document.createElement('button');
    b.className = 'car-card' + (i === S.carIndex ? ' is-active' : '');
    b.style.setProperty('--swatch', hex);
    b.innerHTML = `
      <span class="car-dot"></span>
      <span class="car-meta">
        <span class="car-name">${c.name}</span>
        <span class="car-class">${c.klass}</span>
      </span>
      <span class="car-spec">
        <span class="spec-bar"><i style="width:${c.speed * 100}%"></i></span>
        <span class="spec-bar"><i style="width:${c.accel * 100}%"></i></span>
        <span class="spec-bar"><i style="width:${c.grip * 100}%"></i></span>
      </span>`;
    b.addEventListener('click', () => selectCar(i));
    list.appendChild(b);
  });

  // camera segment
  document.querySelectorAll('.seg-btn').forEach(b =>
    b.addEventListener('click', () => setCam(b.dataset.cam)));
  requestAnimationFrame(movePill);
  document.fonts?.ready.then(movePill);

  $('#follow-btn').addEventListener('click', () =>
    setCam(S.cam === 'chase' ? 'cinematic' : 'chase'));

  $('#play-btn').addEventListener('click', togglePlay);

  const sl = $('#speed-slider');
  const applySlider = () => {
    S.speedMul = parseFloat(sl.value);
    $('#speed-out').textContent = S.speedMul.toFixed(1) + '×';
    sl.style.setProperty('--p', ((S.speedMul - 0.35) / (2 - 0.35)) * 100 + '%');
  };
  sl.addEventListener('input', applySlider);
  applySlider();

  // header nav → view presets
  const navMap = { garage: 'garage', track: 'cinematic', stats: 'onboard' };
  document.querySelectorAll('.nav-link').forEach(n => n.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach(x => x.classList.remove('is-active'));
    n.classList.add('is-active');
    setCam(navMap[n.dataset.scroll]);
  }));

  $('#sound-btn').addEventListener('click', toggleSound);
  $('#fs-btn').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  addEventListener('keydown', e => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); togglePlay(); }
    else if (k === 'c') selectCar((S.carIndex + 1) % CARS.length);
    else if (k === 'f') setCam(S.cam === 'chase' ? 'cinematic' : 'chase');
    else if ('1234'.includes(k)) setCam(['cinematic', 'chase', 'onboard', 'orbit'][+k - 1]);
  });

  // hold left/right (or A/D) to swing around the track
  addEventListener('keydown', e => {
    const k = e.key;
    const dir = (k === 'ArrowLeft' || k === 'a' || k === 'A') ? 1
      : (k === 'ArrowRight' || k === 'd' || k === 'D') ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    if (S.cam !== 'orbit') setCam('orbit');
    swing(dir * 0.06);
  });
}

/** Rotate the free camera around whatever it is looking at. */
function swing(dTheta) {
  const off = camera.position.clone().sub(controls.target);
  off.applyAxisAngle(THREE.Object3D.DEFAULT_UP, dTheta);
  camera.position.copy(controls.target).add(off);
  controls.update();
}

/**
 * Drop resolution before the frame rate drops. Downgrade only — an
 * up/down ladder oscillates right on the threshold and looks worse than
 * simply settling one step lower.
 */
const QUALITY = [
  { ratio: 0.75, bloom: false, label: 'Performance' },
  { ratio: 1.0, bloom: true, label: 'Balanced' },
  { ratio: Math.min(devicePixelRatio, 1.5), bloom: true, label: 'High' },
];
let qLevel = 2, qAcc = 0, qFrames = 0, qStrikes = 0;

function applyQuality() {
  const q = QUALITY[qLevel];
  renderer.setPixelRatio(q.ratio);
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setSize(innerWidth, innerHeight);
  bloom.enabled = q.bloom;
}

function adaptQuality(dt) {
  if (qLevel === 0) return;
  qAcc += dt; qFrames++;
  if (qAcc < 2.5) return;
  const fps = qFrames / qAcc;
  qAcc = 0; qFrames = 0;
  if (fps < 45) {
    if (++qStrikes >= 2) {
      qStrikes = 0;
      qLevel--;
      applyQuality();
      toast(`Graphics set to ${QUALITY[qLevel].label} for a smoother frame rate`);
    }
  } else qStrikes = 0;
}

function movePill() {
  const seg = $('#cam-seg'), active = seg.querySelector('.seg-btn.is-active'), pill = $('#seg-pill');
  if (!active) return;
  pill.style.left = active.offsetLeft + 'px';
  pill.style.width = active.offsetWidth + 'px';
}

function selectCar(i) {
  S.carIndex = i;
  spawnHero(i);
  document.querySelectorAll('.car-card').forEach((c, n) => c.classList.toggle('is-active', n === i));
  $('#car-index').textContent = `${i + 1} / ${CARS.length}`;
  const hex = '#' + CARS[i].color.toString(16).padStart(6, '0');
  document.documentElement.style.setProperty('--hot', hex);
  toast(`${CARS[i].name} — ${CARS[i].klass}`);
  placeHero(0);
}

function togglePlay() {
  S.playing = !S.playing;
  const b = $('#play-btn');
  b.classList.toggle('paused', !S.playing);
  b.querySelector('.lbl').textContent = S.playing ? 'Pause' : 'Play';
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function flashLap() {
  toast(`Lap ${S.lap} — ${fmt(S.lastLap)}${S.lastLap === S.bestLap ? '  ★ best' : ''}`);
}
const fmt = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;

/* ═══════════ engine sound ═══════════ */
let actx, oscA, oscB, filt, gain;
function toggleSound() {
  S.sound = !S.sound;
  $('#sound-btn').classList.toggle('on', S.sound);
  if (S.sound && !actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    oscA = actx.createOscillator(); oscA.type = 'sawtooth';
    oscB = actx.createOscillator(); oscB.type = 'square'; oscB.detune.value = -12;
    filt = actx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 700; filt.Q.value = 6;
    gain = actx.createGain(); gain.gain.value = 0;
    oscA.connect(filt); oscB.connect(filt); filt.connect(gain); gain.connect(actx.destination);
    oscA.start(); oscB.start();
  }
  if (actx) {
    actx.resume();
    gain.gain.setTargetAtTime(S.sound ? 0.05 : 0, actx.currentTime, 0.15);
  }
  toast(S.sound ? 'Engine sound on' : 'Engine sound muted');
}
function updateSound() {
  if (!S.sound || !actx) return;
  const f = 42 + S.v * 4.4;
  oscA.frequency.setTargetAtTime(f, actx.currentTime, 0.08);
  oscB.frequency.setTargetAtTime(f * 0.5, actx.currentTime, 0.08);
  filt.frequency.setTargetAtTime(360 + S.v * 26, actx.currentTime, 0.1);
}

/* ═══════════ HUD ═══════════ */
let hudAcc = 0, frameCount = 0, fpsAcc = 0;
function updateHUD(dt) {
  hudAcc += dt; frameCount++; fpsAcc += dt;

  const kmh = Math.round(S.v * 7.2);          // scale model → “scale km/h”
  $('#speed-val').textContent = kmh;
  const pct = clamp(kmh / 420, 0, 1);
  $('#dial-fill').style.strokeDasharray = `${pct * 245} 327`;
  $('#g-fill').style.width = (S.gForce * 100).toFixed(0) + '%';

  if (hudAcc > 0.2) {
    hudAcc = 0;
    $('#lap-val').textContent = S.lap;
    $('#last-val').textContent = S.lastLap ? fmt(S.lastLap) : '--.--';
    $('#best-val').textContent = S.bestLap ? fmt(S.bestLap) : '--.--';
    $('#sect-val').textContent = sectionName(S.u);
  }
  if (fpsAcc > 0.5) {
    $('#fps').textContent = Math.round(frameCount / fpsAcc) + ' fps';
    fpsAcc = 0; frameCount = 0;
  }
}

function sectionName(u) {
  let name = marks[0]?.name || '—';
  for (const m of marks) if (u >= m.u) name = m.name;
  return name;
}

/* ═══════════ loop ═══════════ */
let last = performance.now();
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (S.playing) {
    S.clock += dt;
    drive(dt);
  }
  placeHero(S.playing ? dt : 0);
  updateCamera(dt);
  updateSound();
  updateHUD(dt);
  adaptQuality(dt);

  renderer.info.reset();
  composer.render();
}

/** Any uncaught error would otherwise leave the loader frozen mid-bar. */
function fatal(err) {
  console.error(err);
  const st = $('#loader-status');
  if (st) {
    st.style.color = '#ff6a6a';
    st.style.textTransform = 'none';
    st.style.letterSpacing = '0';
    st.textContent = (err && err.message) ? err.message : String(err);
  }
  $('#loader-fill').style.background = '#ff3355';
}
addEventListener('error', e => fatal(e.error || e.message));
addEventListener('unhandledrejection', e => fatal(e.reason));

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth * 0.5, innerHeight * 0.5);
  movePill();
}

/* ═══════════ profiling hook ═══════════ */
// Handy from the console: HOTLAP.info -> draw calls, triangles, quality level.
window.HOTLAP = {
  get info() {
    return {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      programs: renderer.info.programs?.length,
      quality: QUALITY[qLevel].label,
      pixelRatio: renderer.getPixelRatio(),
    };
  },
};

/* ═══════════ go ═══════════ */
try {
  init();
} catch (err) {
  fatal(err);
}
