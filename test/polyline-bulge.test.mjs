import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDxf, makeRec, buildScene, injectVertexBulges, OP } from '../app/renderer/core/engine.js';

const rec = (type, pairs) => makeRec(type, pairs);

function documentWithStraightPolyline() {
  const doc = parseDxf('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n');
  doc.entities.push(rec('POLYLINE', [[5, 'PL'], [70, 0]]));
  doc.entities.push(rec('VERTEX', [[5, 'V1'], [330, 'PL'], [10, 0], [20, 0]]));
  doc.entities.push(rec('VERTEX', [[5, 'V2'], [330, 'PL'], [10, 2], [20, 0]]));
  doc.entities.push(rec('SEQEND', [[330, 'PL']]));
  return doc;
}

function countOps(scene) {
  let arcs = 0, lines = 0;
  for (const sp of scene.spaces) {
    for (const b of sp.batches) {
      const ops = b.ops;
      for (let i = 0; i < ops.length;) {
        const op = ops[i++];
        if (op === OP.A) { arcs++; i += 5; }
        else if (op === OP.M || op === OP.L) { if (op === OP.L) lines++; i += 2; }
        else if (op === OP.E) i += 5;
        else if (op === OP.Z) { /* closed */ }
        else break;
      }
    }
  }
  return { arcs, lines };
}

test('injectVertexBulges writes missing group 42 onto matching VERTEX handles', () => {
  const doc = documentWithStraightPolyline();
  assert.equal(doc.entities[1].f(42), 0);
  const n = injectVertexBulges(doc, new Map([['V1', 1]]));
  assert.equal(n, 1);
  assert.equal(doc.entities[1].f(42), 1);
  assert.equal(doc.entities[2].f(42), 0);
});

test('restored VERTEX bulge draws a curved POLYLINE instead of one straight edge', () => {
  const straight = buildScene(documentWithStraightPolyline());
  const before = countOps(straight);
  assert.equal(before.arcs, 0);
  assert.equal(before.lines, 1);

  const doc = documentWithStraightPolyline();
  injectVertexBulges(doc, new Map([['V1', 1]])); // semicircle
  const after = countOps(buildScene(doc));
  assert.equal(after.arcs, 1);
  assert.ok(after.lines >= before.lines);
});
