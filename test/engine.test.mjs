// 运行：node --test test/   （Node 20+，无第三方依赖）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseDxf, buildScene, decodeDxf, OP } from '../app/renderer/core/engine.js';
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
  const areas = ms.regions.map((g) => area(g.rings[0]));
  // 内墙净尺寸 11760 × 7760 mm
  assert.ok(areas.some((a) => Math.abs(a - 11760 * 7760) < 1e-6));
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
