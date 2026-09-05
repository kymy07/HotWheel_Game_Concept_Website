/**
 * Headless checks for the parts of HOTLAP that are pure maths.
 *
 * The circuit and the cars are generated entirely in code, so they can be
 * verified without a browser or a GPU. These assertions encode the bugs that
 * actually bit during development:
 *
 *   - the frame seam popping ~110° because a corkscrew leaves a holonomy
 *     residue that parallel transport never closes
 *   - the jump ramp leaving the ground at a 43° crease
 *   - the back straight sinking below the ground plane
 *
 * Run with:  node --test tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { buildCircuit, computeFrames } from '../js/track.js';
import { CARS, makeCar } from '../js/cars.js';

const { curve, ups, marks } = buildCircuit();
const frames = computeFrames(curve, 2400, ups);
const deg = r => (r * 180) / Math.PI;

test('circuit closes on itself', () => {
  const pts = curve.points;
  const gap = pts[0].distanceTo(pts[pts.length - 1]);
  assert.ok(gap < 3, `closing gap ${gap.toFixed(2)} is larger than one sample step`);
  assert.equal(curve.closed, true);
});

test('no NaN anywhere on the centreline', () => {
  for (const p of curve.points) {
    assert.ok(Number.isFinite(p.x + p.y + p.z), 'non-finite control point');
  }
});

test('no two consecutive control points coincide', () => {
  const pts = curve.points;
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i].distanceTo(pts[i - 1]) > 1e-3, `duplicate point at ${i} would kill the tangent`);
  }
});

test('track never sinks through the ground', () => {
  const minY = Math.min(...frames.points.map(p => p.y));
  assert.ok(minY > 1, `lowest point of the track is y=${minY.toFixed(2)}`);
});

test('frames are orthonormal', () => {
  for (let i = 0; i < frames.count; i++) {
    const T = frames.tangents[i], N = frames.normals[i], B = frames.binormals[i];
    assert.ok(Number.isFinite(T.x + N.x + B.x), `non-finite frame at ${i}`);
    assert.ok(Math.abs(T.dot(N)) < 1e-6, `tangent and normal not perpendicular at ${i}`);
    assert.ok(Math.abs(N.length() - 1) < 1e-6, `normal not unit length at ${i}`);
  }
});

test('frame closes at the seam (no phantom roll around the lap)', () => {
  const angle = deg(frames.normals[0].angleTo(frames.normals[frames.count - 1]));
  assert.ok(angle < 2, `seam pops by ${angle.toFixed(2)}° — the track barrel-rolls`);
});

test('no crease: roll stays smooth sample to sample', () => {
  let worst = 0, at = -1;
  for (let i = 1; i < frames.count; i++) {
    const d = frames.normals[i].angleTo(frames.normals[i - 1]);
    if (d > worst) { worst = d; at = i; }
  }
  assert.ok(deg(worst) < 4, `${deg(worst).toFixed(2)}° kink at sample ${at}`);
});

test('the loop and corkscrew do invert the car, the rest does not', () => {
  const inverted = frames.normals.filter(n => n.y < 0).length / frames.count;
  assert.ok(inverted > 0.04, `only ${(inverted * 100).toFixed(1)}% inverted — the loop is missing`);
  assert.ok(inverted < 0.2, `${(inverted * 100).toFixed(1)}% inverted — the whole track is rolling`);
});

test('the ribbon never passes through itself', () => {
  // The loop used to lean forward, which made its climbing and descending
  // halves slice through each other partway up. A sideways drift replaced it.
  const F = computeFrames(curve, 1200, ups);
  const step = curve.getLength() / F.count;
  const WIDTH = 7.8;
  let worst = Infinity, at = [-1, -1];

  for (let i = 0; i < F.count; i++) {
    for (let j = i + 1; j < F.count; j++) {
      const along = Math.min(j - i, F.count - (j - i)) * step;
      if (along < 26) continue;            // neighbours along the ribbon
      const d = F.points[i].distanceTo(F.points[j]);
      if (d < worst) { worst = d; at = [i / F.count, j / F.count]; }
    }
  }
  assert.ok(worst > WIDTH,
    `track overlaps itself: ${worst.toFixed(2)} apart at u=${at[0].toFixed(3)} and u=${at[1].toFixed(3)}`);
});

test('section markers are ordered and inside the lap', () => {
  assert.ok(marks.length >= 6, 'expected the named sections');
  let prev = -1;
  for (const m of marks) {
    assert.ok(m.u >= 0 && m.u <= 1, `${m.name} at u=${m.u}`);
    assert.ok(m.u > prev, `${m.name} is out of order`);
    prev = m.u;
  }
});

test('every car builds with its wheels on the road', () => {
  assert.equal(CARS.length, 5);
  for (const spec of CARS) {
    const { group, wheels } = makeCar(spec);
    assert.equal(wheels.length, 4, `${spec.id} should have 4 wheels`);

    const bottom = Math.min(...wheels.map(w => w.position.y - spec.wheel.r));
    assert.ok(Math.abs(bottom) < 1e-6, `${spec.id} floats/sinks by ${bottom.toFixed(3)}`);

    const bb = new THREE.Box3().setFromObject(group);
    assert.ok(bb.max.x - bb.min.x < 7.4, `${spec.id} is too wide for the track`);
    assert.ok(Number.isFinite(bb.min.y + bb.max.y), `${spec.id} has a broken bounding box`);
  }
});

test('car stats stay in the range the UI bars assume', () => {
  for (const c of CARS) {
    for (const k of ['speed', 'accel', 'grip']) {
      assert.ok(c[k] > 0 && c[k] <= 1, `${c.id}.${k} = ${c[k]} is outside 0..1`);
    }
  }
});
