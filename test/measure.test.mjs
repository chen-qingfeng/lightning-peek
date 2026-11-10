// 运行：node --test test/   （Node 20+，无第三方依赖）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  guessUnit, labelUnitVote, geodetic, chainage, arc3, flattenArcs,
  footOn, linOrient, polyArea, offsetPoly, alongPts,
} from '../app/renderer/core/measure.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const nearPt = (p, x, y, eps = 1e-6) => near(p[0], x, eps) && near(p[1], y, eps);

function scene({ insunits = 0, measurement = 1, layers = ['墙'], texts = [], view = [0, 0, 100, 100], curves = null, origin = [0, 0] } = {}) {
  return {
    insunits, measurement,
    layers: layers.map((name) => ({ name })),
    spaces: [{ key: '*MODEL_SPACE', texts, view, bbox: view, origin, curves }],
  };
}
function msOf(sc) { return sc.spaces[0]; }
function lab(s, x = 0, y = 0, h = 2.5) { return { s, x, y, h }; }
function curve(len, x1, y1, x2, y2) { return [len, x1, y1, x2, y2, 0]; }

const meter = { unit: { uf: 1000, len: 'm', dec: 2 } };
const milli = { unit: { uf: 1, len: 'mm', dec: 2 } };

test('polyArea is the same for clockwise and counterclockwise rings', () => {
  const ccw = [[0, 0], [4, 0], [4, 3], [0, 3]];
  const cw = [[0, 0], [0, 3], [4, 3], [4, 0]];
  assert.equal(polyArea(ccw), 12);
  assert.equal(polyArea(cw), 12);
});

test('polyArea of a zero-length or duplicate-point polyline is zero', () => {
  assert.equal(polyArea([[0, 0], [0, 0], [0, 0]]), 0);
  assert.equal(polyArea([[5, 5], [5, 5]]), 0);
  assert.equal(polyArea([[0, 0], [10, 0]]), 0);
  assert.equal(polyArea([[0, 0], [6, 0], [0, 0]]), 0);
});

test('polyArea closes an open ring through the first point', () => {
  assert.equal(polyArea([[0, 0], [6, 0], [0, 3]]), 9);
});

test('footOn projects onto the infinite line, including a zero-length segment', () => {
  assert.ok(nearPt(footOn([5, 4], [0, 0], [10, 0]), 5, 0));
  assert.ok(nearPt(footOn([20, 1], [0, 0], [10, 0]), 20, 0));
  assert.ok(nearPt(footOn([3, 4], [1, 2], [1, 2]), 1, 2));
  assert.ok(nearPt(footOn([0, 0], [8, 8], [8, 8]), 8, 8));
});

test('linOrient picks horizontal when the cursor leaves the vertical span', () => {
  assert.equal(linOrient([0, 0], [10, 0], [5, 5]), 'h');
  assert.equal(linOrient([0, 0], [10, 0], [20, 0]), 'v');
  assert.equal(linOrient([0, 0], [0, 10], [5, 5]), 'v');
  assert.equal(linOrient([0, 0], [0, 10], [0, 20]), 'h');
});

test('alongPts walks an open polyline and stops at the end', () => {
  const pts = [[0, 0], [10, 0], [10, 10]];
  const a = alongPts(pts, 0);
  assert.ok(nearPt(a.p, 0, 0));
  assert.ok(near(a.ang, 0));
  const mid = alongPts(pts, 5);
  assert.ok(nearPt(mid.p, 5, 0));
  const corner = alongPts(pts, 15);
  assert.ok(nearPt(corner.p, 10, 5));
  assert.ok(near(corner.ang, Math.PI / 2));
  assert.ok(nearPt(alongPts(pts, 1000).p, 10, 10));
});

test('alongPts keeps a zero-length or duplicate vertex in place', () => {
  assert.ok(nearPt(alongPts([[5, 5], [5, 5]], 3).p, 5, 5));
  assert.ok(nearPt(alongPts([[0, 0], [0, 0], [4, 0]], 2).p, 2, 0));
  assert.ok(nearPt(alongPts([[1, 2]], 9).p, 1, 2));
});

test('offsetPoly expands a closed ring whether it is clockwise or not', () => {
  const ccw = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const cw = [[0, 0], [0, 10], [10, 10], [10, 0]];
  const outCcw = offsetPoly(ccw, 1);
  const outCw = offsetPoly(cw, 1);
  assert.ok(nearPt(outCcw[0], -1, -1));
  assert.ok(nearPt(outCcw[2], 11, 11));
  assert.ok(nearPt(outCw[0], -1, -1));
  assert.ok(polyArea(outCcw) > polyArea(ccw));
  assert.ok(polyArea(outCw) > polyArea(cw));
  const same = offsetPoly(ccw, 0);
  same.forEach((p, i) => assert.ok(nearPt(p, ccw[i][0], ccw[i][1])));
});

test('offsetPoly tolerates a duplicated vertex on a closed polyline', () => {
  const ring = [[0, 0], [0, 0], [10, 0], [10, 10], [0, 10]];
  const out = offsetPoly(ring, 1);
  assert.equal(out.length, ring.length);
  assert.ok(out.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])));
});

test('arc3 returns the later points when the three are collinear or identical', () => {
  assert.deepEqual(arc3([0, 0], [1, 0], [2, 0]), [[1, 0], [2, 0]]);
  assert.deepEqual(arc3([0, 0], [0, 0], [0, 0]), [[0, 0], [0, 0]]);
});

test('arc3 follows the bulge, clockwise or counterclockwise', () => {
  const up = arc3([0, 0], [1, 1], [2, 0], 8);
  const down = arc3([0, 0], [1, -1], [2, 0], 8);
  assert.equal(up.length, 8);
  assert.ok(nearPt(up[up.length - 1], 2, 0));
  assert.ok(up.some((p) => nearPt(p, 1, 1, 0.2)));
  assert.ok(nearPt(down[down.length - 1], 2, 0));
  assert.ok(down.some((p) => nearPt(p, 1, -1, 0.2)));
  assert.ok(up.some((p) => p[1] > 0.5));
  assert.ok(down.some((p) => p[1] < -0.5));
});

test('flattenArcs leaves an open polyline alone and expands an arc segment', () => {
  const open = [[0, 0], [3, 0], [6, 1]];
  assert.deepEqual(flattenArcs(open, new Set()), open);
  const withArc = [[0, 0], [1, 1], [2, 0], [4, 0]];
  const flat = flattenArcs(withArc, new Set([1]));
  assert.ok(nearPt(flat[0], 0, 0));
  assert.ok(nearPt(flat[flat.length - 1], 4, 0));
  assert.ok(flat.length > withArc.length);
  assert.ok(flat.some((p) => nearPt(p, 1, 1, 0.05)));
});

test('flattenArcs keeps a closed ring and the arc between its ends', () => {
  const closed = [[0, 0], [1, 1], [2, 0], [2, -1], [0, 0]];
  const flat = flattenArcs(closed, new Set([1]));
  assert.ok(nearPt(flat[0], 0, 0));
  assert.ok(nearPt(flat[flat.length - 1], 0, 0));
  assert.ok(flat.some((p) => near(p[0], 2, 1e-6) && near(p[1], 0, 1e-6)));
  const straight = flattenArcs(closed, new Set());
  assert.equal(straight.length, closed.length);
});

test('chainage prints millimetres or a K stake', () => {
  assert.equal(chainage(1234.4, milli), '1234');
  assert.equal(chainage(0, meter), 'K0+000');
  assert.equal(chainage(1.234, meter), 'K0+001.23');
  assert.equal(chainage(1234.5, meter), 'K1+234.50');
});

test('geodetic accepts a projected grid and rejects a local or oversized view', () => {
  assert.equal(geodetic({ view: [490000, 3400000, 491000, 3401000], origin: [0, 0] }), true);
  assert.equal(geodetic({ view: [3400000, 490000, 3401000, 491000], origin: [0, 0] }), true);
  assert.equal(geodetic({ view: [38499000, 3399000, 38501000, 3401000], origin: [0, 0] }), true);
  assert.equal(geodetic({ view: [0, 3400000, 300000, 3401000], origin: [0, 0] }), false);
  assert.equal(geodetic({ view: [0, 0, 100, 100], origin: [0, 0] }), false);
  assert.equal(geodetic({ origin: [0, 0] }), false);
});

test('labelUnitVote needs three agreeing labels', () => {
  const line = curve(10.5, -5, 0, 5.5, 0);
  const voted = {
    texts: [lab('L=10.50'), lab('L＝10.50', 1), lab('L:10.50m', 2)],
    curves: line, view: [0, 0, 10, 10], origin: [0, 0],
  };
  assert.equal(labelUnitVote(voted), 0);
  assert.equal(labelUnitVote({ ...voted, texts: voted.texts.slice(0, 2) }), null);
  assert.equal(labelUnitVote({ ...voted, curves: null }), null);
  const mm = {
    texts: [lab('L=10'), lab('L=10', 1), lab('L=10', 2)],
    curves: curve(10000, -5000, 0, 5000, 0),
    view: [0, 0, 10, 10], origin: [0, 0],
  };
  assert.equal(labelUnitVote(mm), -3);
  const plain = {
    texts: [lab('L=10'), lab('L=10', 1), lab('L=10', 2)],
    curves: curve(10, -5, 0, 5, 0),
    view: [0, 0, 20, 20], origin: [0, 0],
  };
  assert.equal(labelUnitVote(plain), null);
  const geo = { ...plain, view: [490000, 3400000, 491000, 3401000] };
  assert.equal(labelUnitVote(geo), 0);
  const mismatch = {
    texts: [lab('L=10'), lab('L=10', 1), lab('L=10', 2)],
    curves: curve(3, -1, 0, 2, 0),
    view: [0, 0, 10, 10], origin: [0, 0],
  };
  assert.equal(labelUnitVote(mismatch), null);
});

test('guessUnit prefers labels, then the header, then a geodetic grid', () => {
  const labeled = scene({
    texts: [lab('L=10.50'), lab('L=10.50', 1), lab('L=10.50', 2)],
    curves: curve(10.5, -5, 0, 5.5, 0),
  });
  assert.deepEqual(guessUnit(labeled), { uf: 1000, why: 'label' });
  const fromMm = scene({
    texts: [lab('L=10'), lab('L=10', 1), lab('L=10', 2)],
    curves: curve(10000, -5000, 0, 5000, 0),
  });
  assert.deepEqual(guessUnit(fromMm), { uf: 1, why: 'label' });
  assert.deepEqual(guessUnit(scene({ insunits: 4 })), { uf: 1, why: 'header' });
  assert.deepEqual(guessUnit(scene({ insunits: 5 })), { uf: 10, why: 'header' });
  assert.deepEqual(guessUnit(scene({ insunits: 6 })), { uf: 1000, why: 'header' });
  assert.deepEqual(guessUnit(scene({ insunits: 14 })), { uf: 100, why: 'header' });
  assert.deepEqual(guessUnit(scene({ layers: ['WALL'], measurement: 0, insunits: 1 })), { uf: 25.4, why: 'header' });
  assert.deepEqual(guessUnit(scene({ layers: ['WALL'], measurement: 0, insunits: 2 })), { uf: 304.8, why: 'header' });
  const grid = scene({ insunits: 0, view: [490000, 3400000, 491000, 3401000] });
  assert.deepEqual(guessUnit(grid), { uf: 1000, why: 'coord' });
  assert.deepEqual(guessUnit(scene({ insunits: 0 })), { uf: 1, why: 'default' });
});
