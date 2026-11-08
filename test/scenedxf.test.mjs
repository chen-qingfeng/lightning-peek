// 场景 → DXF R12 导出：视口展平与裁剪
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDxf, buildScene } from '../app/renderer/core/engine.js';
import { layoutToDxf, spaceToDxf } from '../app/renderer/core/scenedxf.js';

const g = (...pairs) => pairs.flat().join('\n');
const ent = (type, ...kv) => { const o = ['0', type]; for (let i = 0; i < kv.length; i += 2) o.push(String(kv[i]), String(kv[i + 1])); return o.join('\n'); };

// 视口：中心 (50,40)，60×40，视图高 20（比例 2），扭转 90°，目标 (1000,2000)
// 模型 (1000+a, 2000+b) → 图纸 (50 − 2b, 40 + 2a)
// 裁剪边界：L 形（右上角缺口 x>50 且 y>40）
const CLIP = [[20, 20], [80, 20], [80, 40], [50, 40], [50, 60], [20, 60]];
const layer = (name, color, handle) => ent('LAYER', ...(handle ? [5, handle] : []), 2, name, 70, 0, 62, color, 6, 'CONTINUOUS');
const DXF = g(
  ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER'],
  layer('0', 7), layer('M', 1), layer('T', 3), layer('HIDE', 5, 'L3'), layer('FRAME', 2), layer('VP', 4),
  ['0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'],
  ent('LINE', 8, 'M', 10, 1015, 20, 2010, 11, 985, 21, 1985),      // 图纸 (30,70)→(80,10)，穿过缺口
  ent('ARC', 8, 'M', 10, 995, 20, 2005, 40, 3, 50, 0, 51, 90),     // 图纸圆心 (40,30) R6，完全在内
  ent('TEXT', 8, 'T', 10, 994, 20, 2010, 40, 2.5, 1, 'IN 内'),     // 图纸 (30,28)
  ent('TEXT', 8, 'T', 10, 1015, 20, 1990, 40, 2.5, 1, 'OUT'),      // 图纸 (70,70)，在外
  ent('LINE', 8, 'HIDE', 10, 998, 20, 2002, 11, 999, 21, 2003),    // 视口冻结
  ent('VIEWPORT', 8, 'VP', 67, 1, 10, 148.5, 20, 105, 40, 297, 41, 210, 12, 148.5, 22, 105, 45, 210, 69, 1, 90, 0),
  ent('VIEWPORT', 8, 'VP', 67, 1, 10, 50, 20, 40, 40, 60, 41, 40, 12, 0, 22, 0, 17, 1000, 27, 2000, 45, 20, 51, 90, 69, 2, 90, 65536, 340, 'C1', 341, 'L3'),
  ent('LWPOLYLINE', 5, 'C1', 8, 'VP', 67, 1, 90, CLIP.length, 70, 1, ...CLIP.flatMap(p => [10, p[0], 20, p[1]])),
  ent('LINE', 8, 'FRAME', 67, 1, 10, 0, 20, 0, 11, 100, 21, 0),
  ent('TEXT', 8, 'FRAME', 67, 1, 10, 10, 20, 5, 11, 10, 21, 5, 40, 3.5, 72, 1, 1, '标题'),
  ['0', 'ENDSEC', '0', 'EOF'],
);

const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
function inPoly(P, x, y) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < xi + (y - yi) * (xj - xi) / (yj - yi)) c = !c; } return c; }
function onBoundary(P, x, y) {
  for (let i = 0; i < P.length; i++) {
    const [ax, ay] = P[i], [bx, by] = P[(i + 1) % P.length];
    const L2 = (bx - ax) ** 2 + (by - ay) ** 2; const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2));
    if (Math.hypot(ax + t * (bx - ax) - x, ay + t * (by - ay) - y) < 1e-6) return true;
  }
  return false;
}

const scene = buildScene(parseDxf(DXF));
const paper = scene.spaces.find(s => s.paper);
const out = layoutToDxf(scene, paper.key);
const back = parseDxf(out);
const on = (layer, type) => back.entities.filter(r => r.s(8) === layer && (!type || r.type === type));

test('layout export is valid R12 and reads back cleanly', () => {
  assert.equal(paper.viewports.length, 1);
  assert.ok(paper.viewports[0].clip, 'clip boundary resolved');
  assert.equal(back.header.$ACADVER[0][1], 'AC1009');
  assert.equal(back.header.$DWGCODEPAGE[0][1], 'ANSI_936');
  assert.equal(back.layers.get('M').color, 0xff0000);
  const sc = buildScene(back);
  assert.equal(Object.keys(sc.stats.skipped).length, 0);
});

test('model line is clipped exactly by the non-convex viewport boundary', () => {
  const lines = on('M', 'LINE');
  assert.equal(lines.length, 2, 'line crossing the notch splits into two pieces');
  const pts = [];
  for (const r of lines) {
    const a = [r.f(10), r.f(20)], b = [r.f(11), r.f(21)];
    assert.ok(onBoundary(CLIP, ...a) && onBoundary(CLIP, ...b), 'endpoints land on the boundary');
    assert.ok(inPoly(CLIP, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2), 'piece lies inside');
    pts.push(a, b);
  }
  // 解析交点：(38.333,60) (50,46) (55,40) (71.667,20)
  for (const [x, y] of [[115 / 3, 60], [50, 46], [55, 40], [215 / 3, 20]]) assert.ok(pts.some(p => near(p[0], x) && near(p[1], y)), `endpoint ${x},${y}`);
});

test('arc fully inside stays an ARC with twisted angles', () => {
  const arcs = on('M', 'ARC');
  assert.equal(arcs.length, 1);
  const a = arcs[0];
  assert.ok(near(a.f(10), 40) && near(a.f(20), 30) && near(a.f(40), 6));
  assert.ok(near(a.f(50), 90) && near(a.f(51), 180));
});

test('model text is transformed; outside text and frozen layer are dropped', () => {
  const t = on('T', 'TEXT');
  assert.equal(t.length, 1);
  assert.equal(t[0].s(1), 'IN 内');
  assert.ok(near(t[0].f(10), 30) && near(t[0].f(20), 28));
  assert.ok(near(t[0].f(40), 5) && near(t[0].f(50), 90));
  assert.equal(on('HIDE').length, 0);
});

test('paper entities are kept as-is, with text alignment', () => {
  const l = on('FRAME', 'LINE');
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].f(10), l[0].f(20), l[0].f(11), l[0].f(21)], [0, 0, 100, 0]);
  const t = on('FRAME', 'TEXT')[0];
  assert.equal(t.s(1), '标题');
  assert.equal(t.i(72), 1);
  assert.ok(near(t.f(11), 10) && near(t.f(21), 5));
  // 裁剪边界本身作为闭合多段线输出
  const pl = on('VP', 'POLYLINE');
  assert.equal(pl.length, 1);
  assert.equal(pl[0].i(70) & 1, 1);
});

test('layer switches are honoured', () => {
  const d = parseDxf(layoutToDxf(scene, paper.key, { layerOn: new Map([['M', false]]) }));
  assert.equal(d.entities.filter(r => r.s(8) === 'M').length, 0);
  assert.ok(d.entities.some(r => r.s(8) === 'T'));
});

test('model space export uses world coordinates', () => {
  const d = parseDxf(spaceToDxf(scene, '*MODEL_SPACE'));
  const l = d.entities.find(r => r.type === 'LINE' && r.s(8) === 'M');
  assert.ok(near(l.f(10), 1015) && near(l.f(20), 2010) && near(l.f(11), 985) && near(l.f(21), 1985));
  assert.ok(d.entities.some(r => r.type === 'LINE' && r.s(8) === 'HIDE'), 'viewport freeze does not apply to model export');
});
