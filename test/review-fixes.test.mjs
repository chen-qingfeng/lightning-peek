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

// ---------- 第二轮 ----------
import { parseShx, layoutShx, shxLayout, installFont, fontLib } from '../app/renderer/core/shx.js';
import { cleanText, canvasDash } from '../app/renderer/core/engine.js';
import { unescapeDxfText } from '../app/renderer/core/textRepair.js';
import { spaceToDxf } from '../app/renderer/core/scenedxf.js';

function u16(n) { return [n & 255, n >> 8 & 255]; }
function shapesFont(glyphs) {
  const entries = [[0, [...'TXT'.split('').map(c => c.charCodeAt(0)), 0, 8, 2, 0, 0].flat()], ...glyphs];
  const index = [], data = [];
  for (const [code, bytes] of entries) { index.push(...u16(code), ...u16(bytes.length)); data.push(...bytes); }
  const header = [...'AutoCAD-86 shapes 1.0\r\n\x1a'].map(c => c.charCodeAt(0));
  return Uint8Array.from([...header, 0, 0, 0, 0, ...u16(entries.length), ...index, ...data]);
}
const GLYPH = [8, 0, 8, 8, 6, 0, 2, 8, 2, -8 & 255, 0]; // 一笔折线，前进 8

test('SHX shape fonts draw the diameter, degree and plus-minus symbols', () => {
  const font = parseShx(shapesFont([[48, GLYPH], [49, GLYPH], [127, GLYPH], [128, GLYPH], [129, GLYPH]]));
  const lay = layoutShx(cleanText('%%c100%%d%%p1'), font, null);
  assert.ok(lay);
  assert.equal(lay.lines.length, 7); // Ø 1 0 0 ° ± 1 各一笔
});

test('SHX fractional arc radius uses a 256 high byte', () => {
  // 0x0b：起点偏移 0、终点偏移 0、半径高字节 1、低字节 0（=256）、从 0° 逆时针两个八分圆
  const font = parseShx(shapesFont([[65, [1, 0x0b, 0, 0, 1, 0, 0x02, 0]]]));
  const lay = layoutShx('A', font, null);
  const xs = lay.lines.flat().filter((_, i) => i % 2 === 0);
  assert.ok(Math.abs(Math.min(...xs) - (256 * Math.cos(Math.PI / 2) - 256)) < 1e-6);
});

test('SHX line layout is cached until the text or the font changes', () => {
  installFont('cachetest.shx', shapesFont([[65, GLYPH]]));
  const t = { s: 'A', sf: 'cachetest.shx', bf: '' };
  const a = shxLayout(t);
  assert.ok(a);
  assert.equal(shxLayout(t), a);
  t.s = 'AA';
  const b = shxLayout(t);
  assert.notEqual(b, a); assert.equal(b.lines.length, 2);
  installFont('cachetest.shx', shapesFont([[65, GLYPH]]));
  assert.notEqual(shxLayout(t), b);
  fontLib.delete('cachetest.shx');
});

test('\\M+ escapes decode the double-byte code in their code page', () => {
  assert.equal(unescapeDxfText('\\M+5C4E3\\M+5BAC3'), '你好');
  assert.equal(unescapeDxfText('\\M+2A4A4'), '中'); // Big5
  assert.equal(unescapeDxfText('\\M+14E2D'), '中'); // 解不出时保持旧的写法
});

test('layout export writes CAD control codes instead of ? for symbols', () => {
  const doc = empty();
  doc.entities.push(makeRec('TEXT', [[10, 0], [20, 0], [40, 2.5], [1, '%%c100 30%%d %%p5 m\\U+00B2']]));
  doc.entities.push(makeRec('TEXT', [[10, 0], [20, 10], [40, 2.5], [1, '%%1328@100']]));
  const sc = buildScene(doc, { origin: [0, 0] });
  const out = spaceToDxf(sc, '*MODEL_SPACE');
  assert.ok(out.includes('\r\n%%c100 30%%d %%p5 m2\r\n'), out);
  assert.ok(out.includes('\r\n%%1328@100\r\n'));
});

test('dash patterns keep gaps where the line type puts them', () => {
  assert.deepEqual(canvasDash([10, -5]), { dash: [10, 5], offset: 0 });
  // 以空白开头：先空 5 再画 10
  assert.deepEqual(canvasDash([-5, 10]), { dash: [10, 5], offset: 10 });
  // 奇数段、首尾都是画：首尾相连成一段，从第一段开头画
  assert.deepEqual(canvasDash([10, -5, 2]), { dash: [12, 5], offset: 2 });
  // 相邻同号合并
  assert.deepEqual(canvasDash([10, 3, -5, -1]), { dash: [13, 6], offset: 0 });
  // 只有画的段是实线
  assert.deepEqual(canvasDash([4, 4]), { dash: [], offset: 0 });
});

import { errText, dwgMagic } from '../app/renderer/core/dwgconv.js';
test('DWG 错误位按 LibreDWG 定义解释，2048 不再一律说版本过新', () => {
  assert.match(errText(2048, 'AC1032'), /无法识别|损坏/);
  assert.doesNotMatch(errText(2048, 'AC1032'), /过新/);
  assert.match(errText(2048, 'AC1040'), /过新/);
  assert.match(errText(2048, 'AC1009'), /太旧/);
  assert.match(errText(2048, ''), /不是可识别的 DWG/);
  assert.match(errText(8192 | 2048, 'AC1027'), /内存不够/);
  assert.match(errText(4096, 'AC1027'), /读取图纸文件出错/);
  assert.equal(dwgMagic(new TextEncoder().encode('AC1032xx')), 'AC1032');
});
