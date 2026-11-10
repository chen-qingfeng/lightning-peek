// 运行：node --test test/   （Node 20+，无第三方依赖）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseDxf, buildScene, decodeDxf, OP, drawnWidth, layoutTitle } from '../app/renderer/core/engine.js';
import { makeXlsx } from '../app/renderer/core/xlsx.js';

const sample = (n) => fs.readFileSync(new URL('../docs/samples/' + n, import.meta.url));
const load = (n) => buildScene(parseDxf(decodeDxf(sample(n)).text));

test('sample drawing parses without skipped entities', () => {
  const sc = load('pump-room.dxf');
  assert.equal(Object.keys(sc.stats.skipped).length, 0);
  assert.equal(sc.layers.length, 11);
  const ms = sc.spaces[0];
  assert.equal(ms.key, '*MODEL_SPACE');
  assert.ok(ms.texts.some((t) => t.s === 'PUMP ROOM  泵房'), 'mixed-language text survives');
});

test('block instances are counted per name', () => {
  const ms = load('pump-room.dxf').spaces[0];
  const count = (n) => ms.inserts.filter((i) => i.n === n).length;
  assert.equal(count('PUMP'), 4);
  assert.equal(count('VALVE'), 6);
  assert.equal(load('pump-room-rev-b.dxf').spaces[0].inserts.filter((i) => i.n === 'VALVE').length, 7);
});

test('closed polyline regions give exact rectangle areas', () => {
  const ms = load('pump-room.dxf').spaces[0];
  const area = (r) => { let a = 0; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1]; return Math.abs(a) / 2; };
  const areas = ms.regions.filter((g) => g.rings[0] && g.rings[0].length).map((g) => area(g.rings[0]));
  // 内墙净尺寸 11760 × 7760 mm
  assert.ok(areas.some((a) => Math.abs(a - 11760 * 7760) < 1e-6));
});

test('circles are stored analytically for area pick', () => {
  const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'CIRCLE', '8', '0', '10', '0', '20', '0', '40', '10', '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const ms = buildScene(parseDxf(dxf)).spaces[0];
  assert.equal(ms.regions.length, 1);
  assert.ok(ms.regions[0].circ);
  const [x, y, r] = ms.regions[0].circ;
  assert.equal(r, 10);
  assert.ok(Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9);
  assert.equal(ms.regions[0].rings.length, 0);
});

test('circle length is analytic', () => {
  const ms = load('pump-room.dxf').spaces[0];
  const lens = []; for (let i = 0; i < ms.curves.length; i += 6) lens.push(ms.curves[i]);
  assert.ok(lens.some((l) => Math.abs(l - 2 * Math.PI * 320) < 1e-9), 'pump casing R320');
});

test('arc direction: CCW arc 0°→90° is drawn as a canvas arc', () => {
  const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'ARC', '8', '0', '10', '0', '20', '0', '40', '10', '50', '0', '51', '90', '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const sc = buildScene(parseDxf(dxf));
  const ops = sc.spaces[0].batches[0].ops;
  const a = ops.indexOf(OP.A);
  assert.ok(a > 0);
  assert.equal(ops[a + 3], 10);
  assert.ok(Math.abs(ops[a + 5] - ops[a + 4] - Math.PI / 2) < 1e-12);
});

test('legacy GBK DXF is decoded with its code page', () => {
  const head = '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n9\n$DWGCODEPAGE\n3\nANSI_936\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nTEXT\n8\n0\n10\n0\n20\n0\n40\n2.5\n1\n';
  const gbk = Uint8Array.from([0xb1, 0xc3, 0xb7, 0xbf]); // 泵房
  const tail = '\n0\nENDSEC\n0\nEOF\n';
  const bytes = new Uint8Array([...new TextEncoder().encode(head), ...gbk, ...new TextEncoder().encode(tail)]);
  const r = decodeDxf(bytes);
  assert.equal(r.enc, 'gbk');
  assert.equal(buildScene(parseDxf(r.text)).spaces[0].texts[0].s, '泵房');
});

test('xlsx output is a valid zip with the expected parts', () => {
  const z = makeXlsx([{ name: 'A', rows: [['x', 1], ['中文', 2.5]] }]);
  assert.equal(z[0], 0x50); assert.equal(z[1], 0x4b);
  const s = new TextDecoder().decode(z);
  for (const part of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']) assert.ok(s.includes(part), part);
});

test('version numbers agree across package files', () => {
  const root = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version;
  const app = JSON.parse(fs.readFileSync(new URL('../app/package.json', import.meta.url))).version;
  const pre = fs.readFileSync(new URL('../app/preload.js', import.meta.url), 'utf8').match(/version: '([^']+)'/)[1];
  assert.equal(app, root); assert.equal(pre, root);
});

test('外部参照：记录插入矩阵，不展开空块', () => {
  const dxf = ['0', 'SECTION', '2', 'BLOCKS',
    '0', 'BLOCK', '2', 'SITE', '70', '4', '10', '0', '20', '0', '1', 'D:\\proj\\site.dwg', '0', 'ENDBLK',
    '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '10', '21', '0',
    '0', 'INSERT', '8', 'XR', '2', 'SITE', '10', '100', '20', '50', '41', '2', '42', '2', '50', '90',
    '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const sc = buildScene(parseDxf(dxf));
  const ms = sc.spaces[0];
  assert.equal(ms.xrefs.length, 1);
  const x = ms.xrefs[0];
  assert.equal(x.name, 'SITE'); assert.equal(x.path, 'D:\\proj\\site.dwg'); assert.equal(x.layer, 'XR');
  // 外部图纸 (1,0) → 旋转 90°、放大 2 倍后在 (100,52)，再换成局部坐标
  const px = x.M[0] * 1 + x.M[4] + ms.origin[0], py = x.M[1] * 1 + x.M[5] + ms.origin[1];
  assert.ok(Math.abs(px - 100) < 1e-9 && Math.abs(py - 52) < 1e-9, `${px},${py}`);
});

import { rebarText, barStrokes } from '../app/renderer/core/engine.js';
test('rebar codes %%130-%%133 keep SHX bytes, draw as marks, and search as grade letters', () => {
  const sc = buildScene(parseDxf(['0', 'SECTION', '2', 'ENTITIES', '0', 'TEXT', '8', '0', '10', '0', '20', '0', '40', '3', '1', '4%%13225 %%1308@100', '0', 'ENDSEC', '0', 'EOF'].join('\n')));
  const t = sc.spaces[0].texts[0];
  assert.equal(t.sr, '4\x8425 \x828@100'); // 原始字符保留给 SHX 字体
  assert.equal(t.sg, '4\uE00325 \uE0018@100');
  assert.equal(t.s, '4C25 A8@100');
  assert.equal(rebarText('\x83\x85'), 'BD');
  assert.equal(rebarText('kN/m\x8c2\x8d，2.5x10\x8c-4'), 'kN/m²，2.5x10⁻⁴');
  const a = barStrokes(1), b = barStrokes(2), c = barStrokes(3), d = barStrokes(4);
  assert.equal(a.verts.length, 1); assert.equal(a.bar, null); assert.equal(a.verts[0][3], 0);
  assert.equal(b.verts.length, 1); assert.equal(b.verts[0][3], -3.5); assert.equal(b.bar.y, -3.5);
  assert.equal(c.verts.length, 2); assert.equal(d.verts.length, 3);
  assert.ok(d.verts.every(v => v[3] === -3.5 && v[1] === a.verts[0][1]));
});

test('caret ^M^J grows with the two points and does not stretch each line', () => {
  const dxf = ['0', 'SECTION', '2', 'ENTITIES',
    '0', 'TEXT', '8', '0', '10', '0', '20', '0', '11', '30', '21', '0', '40', '3', '72', '5', '1', 'X=12^M^JY=3',
    '0', 'TEXT', '8', '0', '10', '0', '20', '5', '11', '40', '21', '5', '40', '2', '72', '3', '1', 'AB',
    '0', 'TEXT', '8', '0', '10', '0', '20', '8', '11', '20', '21', '8', '40', '2.5', '72', '5', '1', 'HELLO',
    '0', 'MTEXT', '8', '0', '10', '0', '20', '10', '40', '2.5', '1', '\\T2;AB',
    '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const texts = buildScene(parseDxf(dxf)).spaces[0].texts;
  const x = texts.find(t => t.s === 'X=12');
  const y = texts.find(t => t.s === 'Y=3');
  assert.ok(x && y);
  assert.equal(x.para, 'X=12\nY=3');
  const expectH = 3 * 30 / drawnWidth('X=12', 3);
  assert.ok(expectH > 3);
  assert.ok(Math.abs(x.h - expectH) < 1e-6);
  assert.equal(y.h, x.h);
  assert.ok(Math.abs((x.y - y.y) - x.h) < 1e-6);
  assert.equal(x.fit, undefined);
  assert.equal(y.fit, undefined);
  const aligned = texts.find(t => t.s === 'AB' && t.y === 5);
  assert.ok(aligned.h > 2);
  const single = texts.find(t => t.s === 'HELLO');
  assert.equal(single.h, 2.5);
  assert.ok(Math.abs(single.fit - 20) < 1e-6);
  const m = texts.find(t => t.s === 'AB' && t.mt);
  assert.ok(m && Math.abs(m.wf - 2) < 1e-9);
});

test('named layouts stay in the scene even when the sheet is empty', () => {
  const dxf = ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'BLOCK_RECORD',
    '0', 'BLOCK_RECORD', '5', '1F', '2', '*Model_Space',
    '0', 'BLOCK_RECORD', '5', '58', '2', '*Paper_Space',
    '0', 'ENDTAB', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '10', '21', '0',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'OBJECTS',
    '0', 'LAYOUT', '100', 'AcDbLayout', '1', 'Model', '71', '0', '330', '1F',
    '0', 'LAYOUT', '100', 'AcDbLayout', '1', '布局1', '71', '1', '330', '58',
    '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const names = buildScene(parseDxf(dxf)).spaces.map(s => s.name);
  assert.deepEqual(names, ['模型', '布局1']);
  const en = dxf.replace('1\n布局1\n', '1\nLayout1\n');
  assert.deepEqual(buildScene(parseDxf(en)).spaces.map(s => s.name), ['模型', '布局1']);
  assert.equal(layoutTitle('Layout2'), '布局2');
  assert.equal(layoutTitle('封面'), '封面');
});
