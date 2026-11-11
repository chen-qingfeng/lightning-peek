import test from 'node:test';
import assert from 'node:assert/strict';
import { serial } from '../app/renderer/core/serial.js';
import { injectedPoints, lostCount } from '../app/renderer/core/lost.js';
import { tchUnsupported, annotationHeight, tchBuild } from '../app/renderer/core/tarch.js';
import { parseDxf, buildScene, makeRec } from '../app/renderer/core/engine.js';

const empty = () => parseDxf('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n');

test('DWG reads run one after another, even when one fails', async () => {
  const run = serial(), log = [];
  const job = (name, fail) => run(async () => {
    log.push(name + '+'); await new Promise(r => setTimeout(r, 5)); log.push(name + '-');
    if (fail) throw new Error(name);
  });
  const a = job('a', true), b = job('b'), c = job('c');
  await assert.rejects(a, /a/); await b; await c;
  assert.deepEqual(log, ['a+', 'a-', 'b+', 'b-', 'c+', 'c-']);
});

test('export counts each injected TArch object and OLE once, inside the clip box', () => {
  const doc = empty();
  const it1 = {}, it2 = {}, ole = {};
  doc.entities.push(makeRec('LINE', [[10, 0], [20, 0], [11, 5], [21, 5]], { _tch: 'TCH_SHEET', _lost: it1 }));
  doc.entities.push(makeRec('MTEXT', [[10, 1], [20, 1], [1, 'a']], { _tch: 'TCH_SHEET', _lost: it1 }));
  doc.entities.push(makeRec('TEXT', [[10, 100], [20, 100], [1, 'b']], { _tch: 'TCH_TEXT', _lost: it2 }));
  doc.entities.push(makeRec('OLE2FRAME', [[10, 50], [20, 50]], { _ole: new Uint8Array(1), _lost: ole }));
  doc.entities.push(makeRec('LINE', [[10, 0], [20, 0], [11, 1], [21, 1]]));
  const pts = injectedPoints(doc);
  assert.equal(pts.length, 3);
  assert.equal(lostCount(pts, null), 3);
  assert.equal(lostCount(pts, [-1, -1, 60, 60]), 2);
  assert.equal(lostCount(null, null), 0);
});

test('TArch classes the 2007 reader skips are listed as not shown', () => {
  const note = tchUnsupported({
    decoded: true,
    counts: { TCH_TEXT: 5, TCH_ELEVATION: 12, TCH_AXIS_LABEL: 30, TCH_WALL: 80 },
    items: [{ cls: 'TCH_TEXT' }],
    failed: {},
    untried: { TCH_ELEVATION: 12, TCH_AXIS_LABEL: 30, TCH_WALL: 80 },
  });
  assert.deepEqual(note, { TCH_ELEVATION: 12, TCH_AXIS_LABEL: 30, TCH_WALL: 80 });
});

test('display height drops one step without halving small text', () => {
  assert.equal(annotationHeight(3.5), 3);
  assert.equal(annotationHeight(3), 2.5);
  assert.equal(annotationHeight(2), 1.5);
  assert.equal(annotationHeight(1), 0.75);
  let prev = 0;
  for (let h = 0.1; h < 6; h += 0.05) { const d = annotationHeight(h); assert.ok(d > prev && d < h); prev = d; }
  const f = { kind: 'TCH_TEXT', rotFrom: 'stream', h: 1, scale: 100, x: 0, y: 0, rot: 0, align: 10, text: '测试' };
  assert.equal(Object.fromEntries(tchBuild(f, null)[0].pairs)[40], 75);
});

test('a polyline arrow with start and end widths is filled, not drawn as a hairline', () => {
  const doc = empty();
  doc.entities.push(makeRec('LWPOLYLINE', [[90, 2], [70, 0], [10, 0], [20, 0], [40, 0], [41, 3], [10, 10], [20, 0]]));
  const sp = buildScene(doc, { origin: [0, 0] }).spaces[0];
  assert.equal(sp.fills.length, 1);
  const ring = sp.fills[0].rings[0];
  assert.deepEqual([...ring].map(v => Math.round(v * 1000) / 1000), [0, 0, 10, 1.5, 10, -1.5, 0, 0]);
  assert.equal(sp.batches.length, 0);
});

test('constant-width and multi-segment tapered polylines', () => {
  const doc = empty();
  doc.entities.push(makeRec('LWPOLYLINE', [[90, 2], [70, 0], [43, 2], [10, 0], [20, 0], [10, 10], [20, 0]]));
  doc.entities.push(makeRec('LWPOLYLINE', [[90, 3], [70, 0], [10, 0], [20, 10], [10, 8], [20, 10], [40, 2], [41, 0], [10, 10], [20, 10]]));
  const sp = buildScene(doc, { origin: [0, 0] }).spaces[0];
  assert.deepEqual(sp.batches.map(b => b.w).sort(), [0, 2]); // 等宽线照旧按线宽；箭杆是零宽线
  assert.equal(sp.fills.length, 1); // 箭头
});

test('old-style polyline vertices keep their widths', () => {
  const doc = empty();
  doc.entities.push(makeRec('POLYLINE', [[66, 1], [70, 0]]));
  doc.entities.push(makeRec('VERTEX', [[10, 0], [20, 0], [40, 4], [41, 0]]));
  doc.entities.push(makeRec('VERTEX', [[10, 20], [20, 0]]));
  doc.entities.push(makeRec('SEQEND', []));
  const sp = buildScene(doc, { origin: [0, 0] }).spaces[0];
  assert.equal(sp.fills.length, 1);
});

test('ATTRIB vertical alignment comes from code 74, not the field length in 73', () => {
  const doc = empty();
  doc.entities.push(makeRec('ATTRIB', [[10, 0], [20, 0], [11, 5], [21, 5], [40, 2.5], [1, 'A1'], [2, 'TAG'], [72, 1], [73, 8]]));
  doc.entities.push(makeRec('ATTRIB', [[10, 0], [20, 0], [11, 5], [21, 5], [40, 2.5], [1, 'A2'], [2, 'TAG'], [72, 1], [73, 8], [74, 2]]));
  const texts = buildScene(doc, { origin: [0, 0] }).spaces[0].texts;
  assert.deepEqual(texts.map(t => [t.s, t.va]), [['A1', 0], ['A2', 2]]);
});
