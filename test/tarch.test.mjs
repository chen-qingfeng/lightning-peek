// 天正文字解码：用手工拼出来的位流测试（不依赖真实图纸）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeTch, tchPairs, tchMarkup, tgNumber, decodeTchStream, tchBuild, placeSharedText, tchAlign, orientTch, textAnchor } from '../app/renderer/core/tarch.js';
import { rejoinSplitChars, rejoinUtf8, decodeDxf, parseDxf, buildScene } from '../app/renderer/core/engine.js';

class W {
  constructor() { this.bits = []; }
  put(v, n) { for (let i = n - 1; i >= 0; i--) this.bits.push(Math.floor(v / 2 ** i) % 2); }
  RC(v) { this.put(v, 8); } RS(v) { this.RC(v & 255); this.RC(v >> 8); }
  RD(v) { const u = new Uint8Array(new Float64Array([v]).buffer); for (const b of u) this.RC(b); }
  BS(v) { if (v === 0) this.put(2, 2); else if (v < 256) { this.put(1, 2); this.RC(v); } else { this.put(0, 2); this.RS(v); } }
  BD(v) { if (v === 0) this.put(2, 2); else if (v === 1) this.put(1, 2); else { this.put(0, 2); this.RD(v); } }
  TV(bytes) { this.BS(bytes.length); for (const b of bytes) this.RC(b); }
  H(code, v) { const n = v ? Math.ceil(Math.log2(v + 1) / 8) : 0; this.put(code, 4); this.put(n, 4); for (let i = n - 1; i >= 0; i--) this.RC((v >> (8 * i)) & 255); }
  bytes() { const u = new Uint8Array(Math.ceil(this.bits.length / 8)); this.bits.forEach((b, i) => { if (b) u[i >> 3] |= 128 >> (i & 7); }); return u; }
}
const GBK_XFBF = [0xcf, 0xfb, 0xb7, 0xc0, 0x00]; // “消防” + \0
function header(w, scale) { w.RC(4); w.BD(scale); w.BS(0); w.RS(512); w.TV(GBK_XFBF); }

test('TCH_TEXT: text, point, height × scale, alignment and style handle', () => {
  const w = new W(); header(w, 100);
  w.BD(71796.85); w.BD(25636.74); w.BD(0); w.BD(3.5); w.BD(0); w.RS(5);
  const hdl = w.bits.length; w.H(3, 0); w.H(5, 0xc4); w.H(5, 0xc7);
  const f = decodeTch('TCH_TEXT', w.bytes(), w.bits.length, hdl);
  assert.equal(new TextDecoder('gbk').decode(f.raw), '消防');
  assert.equal(f.style, 0xc7);
  const { type, pairs } = tchPairs(f, '消防');
  const g = Object.fromEntries(pairs);
  assert.equal(type, 'TEXT');
  assert.equal(g[40], 350); assert.equal(g[72], 1); assert.equal(g[73], 2); assert.equal(g[11], 71796.85);
});

test('TCH_MTEXT: box top-left, centred in box for code 11, pitch = h(1+lsf)/2', () => {
  const w = new W(); header(w, 100);
  w.BD(101744.7); w.BD(300656.1); w.BD(0); w.BD(3); w.BD(0); w.RS(11); w.RC(1); w.BD(5.6); w.BD(1.2);
  const f = decodeTch('TCH_MTEXT', w.bytes(), w.bits.length);
  const { type, pairs } = tchPairs(f, 'a\r\nb\r\n');
  const g = Object.fromEntries(pairs);
  assert.equal(type, 'MTEXT');
  assert.ok(Math.abs(g[10] - 102024.7) < 1e-6); // 101744.7 + 560/2
  assert.equal(g[41], 560); // 文字框 5.6 × 出图比例 100，不再放宽
  assert.equal(g[71], 2); assert.equal(g[1], 'a\\Pb');
  const sc = buildScene(parseDxf(['0', 'SECTION', '2', 'ENTITIES', '0', 'MTEXT', ...pairs.flatMap(([c, v]) => [String(c), String(v)]), '0', 'ENDSEC', '0', 'EOF'].join('\n')));
  const t = sc.spaces[0].texts;
  assert.equal(t.length, 2);
  assert.ok(Math.abs((t[0].y - t[1].y) - 300 * 1.1) < 1e-6);
});

test('implausible data is rejected instead of guessed', () => {
  const w = new W(); header(w, 0); w.BD(1); w.BD(1); w.BD(0); w.BD(3.5); w.BD(0); w.RS(5);
  assert.equal(decodeTch('TCH_TEXT', w.bytes(), w.bits.length), null);
});

test('TArch superscript markup', () => {
  assert.equal(tchMarkup('360m^U3^U消防水池'), '360m³消防水池');
  assert.equal(tchMarkup('面积 m^U2^U'), '面积 m²');
});

test('MTEXT chunk split inside a GBK character is rejoined', () => {
  const enc = s => Array.from(new TextEncoder().encode(s));
  // “加盖”= bc d3 b8 c7，第一段在 b8 后被截断
  const bytes = Uint8Array.from([...enc('  3\r\n'), 0xbc, 0xd3, 0xb8, ...enc('\r\n  1\r\n'), 0xc7, ...enc('\r\n')]);
  const fixed = rejoinSplitChars(bytes, 'gbk');
  const s = new TextDecoder('gbk').decode(fixed);
  assert.ok(s.includes('加\r\n  1\r\n盖'), s);
  assert.equal(rejoinSplitChars(bytes, 'windows-1252'), bytes);
});

test('2007 MTEXT split inside a UTF-8 character is rejoined', () => {
  // “不” = e4 b8 8d，第一段在 e4 后被截断
  const raw = '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1021\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nMTEXT\n3\n接口' ;
  const head = new TextEncoder().encode(raw);
  const mid = new Uint8Array([0xe4]); // 不 的第一个字节
  const tail = new TextEncoder().encode('\n1\n');
  const rest = new Uint8Array([0xb8, 0x8d]);
  const end = new TextEncoder().encode('得采用\n0\nENDSEC\n0\nEOF\n');
  const bytes = new Uint8Array(head.length + mid.length + tail.length + rest.length + end.length);
  let p = 0;
  for (const part of [head, mid, tail, rest, end]) { bytes.set(part, p); p += part.length; }
  const text = new TextDecoder('utf-8').decode(rejoinUtf8(bytes));
  // 组码还在两段中间，汉字本身已经接回同一条 MTEXT
  assert.ok(text.includes('接口\n1\n不得采用'), text);
  assert.equal(text.includes('\ufffd'), false);
  const decoded = decodeDxf(bytes).text;
  const mt = parseDxf(decoded).entities.find(e => e.type === 'MTEXT');
  const joined = mt.all(3).join('') + mt.raw(1);
  assert.equal(joined, '接口不得采用');
});

import { decodeTchAny } from '../app/renderer/core/tarch.js';
const dec = u => new TextDecoder('gbk').decode(u);
function tchHeader(w, scale = 100, ver = 768) { w.RC(4); w.BD(scale); w.BS(0); w.RS(ver); }

test('TCH_ELEVATION: zero shows as ±0.000, mirrored flag puts text left of the symbol', () => {
  for (const flags of [0, 2]) {
    const w = new W(); tchHeader(w);
    w.BD(3.5); w.BD(0); w.BD(1); w.put(flags, 24); w.RD(1000); w.RD(2000); w.TV([0x30, 0x2e, 0x30, 0x30, 0x30, 0]); w.BD(11.5);
    const f = decodeTchAny('TCH_ELEVATION', w.bytes(), w.bits.length);
    const recs = tchBuild(f, dec);
    const t = recs.find(r => r.type === 'TEXT'), g = Object.fromEntries(t.pairs);
    assert.equal(g[1], '±0.000');
    assert.equal(g[40], 350);
    assert.equal(g[72], flags ? 2 : 0);
    assert.equal(recs.filter(r => r.type === 'LINE').length, 3);
  }
});

test('TCH_DIMENSION2: chain of segments gives one rounded text per segment', () => {
  const w = new W(); tchHeader(w, 100, 256);
  w.BD(0); w.BD(0); w.BD(0); w.BD(0); w.BD(-25); w.BS(3); w.BD(4600); w.BD(4000); w.BD(1074.2);
  const f = decodeTchAny('TCH_DIMENSION2', w.bytes(), w.bits.length);
  const texts = tchBuild(f, dec).filter(r => r.type === 'TEXT').map(r => Object.fromEntries(r.pairs));
  assert.deepEqual(texts.map(t => t[1]), ['4600', '4000', '1074.2']);
  assert.ok(Math.abs(texts[0][10] - 2300) < 1e-6);
  assert.ok(texts[0][20] < 0 && texts[0][20] > -2500); // 尺寸线在下方 2500 处，文字在线上方
});

test('TCH_DRAWINGNAME: name, scale and circled-number markup', () => {
  const w = new W(); tchHeader(w);
  w.put(1, 2); w.BD(500); w.BD(600); w.BD(0);
  const name = [0x5e, 0x43, 0x31, 0x5e, 0x43, 0xc1, 0xa2, 0xc3, 0xe6, 0xcd, 0xbc, 0]; // ^C1^C立面图
  w.TV(name); w.TV([0x31, 0x3a, 0x31, 0x30, 0x30, 0]); w.BD(0); w.BD(7); w.BD(5);
  const f = decodeTchAny('TCH_DRAWINGNAME', w.bytes(), w.bits.length);
  const texts = tchBuild(f, u => tchMarkup(dec(u))).filter(r => r.type === 'TEXT').map(r => Object.fromEntries(r.pairs)[1]);
  assert.deepEqual(texts, ['①立面图', '1:100']);
});

test('2007 Tianzheng text is read from the string stream, not the 2000 field order', () => {
  const pair = ch => {
    const v = ch.charCodeAt(0) ^ 4;
    return String.fromCharCode(0x324 + Math.floor(v / 26), 0x324 + (v % 26));
  };
  // 写进去的十进制会在第 0、2 位各垫一个字符，读的时候去掉
  assert.equal(tgNumber(pair('X') + pair('5') + pair('Y') + pair('.') + pair('2')), 5.2);
  assert.equal(tgNumber('线下文字页宽'), NaN);

  const w = new W();
  w.put(0, 96); w.RD(4786700); w.put(0, 4); w.RD(567700);
  w.put(1, 2); w.RC(1); w.RC(0x32); w.RC(0x75); // “甲”
  w.RS(26); w.put(1, 1);
  const f = decodeTchStream('TCH_TEXT', w.bytes(), w.bits.length, w.bits.length);
  assert.equal(f.text, '甲');
  assert.ok(Math.abs(f.x - 567700) < 1e-6);
  assert.ok(Math.abs(f.y - 4786700) < 1e-6);
  const drawn = tchBuild(f, () => { throw new Error('unicode text is already decoded'); }).find(r => r.type === 'TEXT');
  assert.equal(Object.fromEntries(drawn.pairs)[1], '甲');
});

test('2007 composing note sits to the right of the leader, on the stored row', () => {
  const w = new W();
  w.put(0, 134);
  w.RD(4787022); w.RD(575143); w.RD(4787156); w.RD(575143);
  w.put(1, 2); w.RC(1); w.RC(0x32); w.RC(0x75);
  w.RS(26); w.put(1, 1);
  const f = decodeTchStream('TCH_COMPOSING', w.bytes(), w.bits.length, w.bits.length);
  assert.equal(f.text, '甲');
  assert.ok(Math.abs(f.y - 4787156) < 1e-3, f.y);
  const recs = tchBuild(f, () => { throw new Error('already decoded'); });
  const lines = recs.filter(r => r.type === 'LINE').map(r => Object.fromEntries(r.pairs));
  const vert = lines.find(g => Math.abs(g[10] - g[11]) < 1e-3);
  const horz = lines.find(g => Math.abs(g[20] - g[21]) < 1e-3);
  assert.ok(Math.abs(vert[20] - 4787022) < 1e-3 && Math.abs(vert[21] - 4787156) < 1e-3);
  assert.ok(horz[11] > horz[10]);
  const note = Object.fromEntries(recs.find(r => r.type === 'TEXT').pairs);
  assert.equal(note[73], 2);
  assert.ok(note[10] > 575143);
  assert.ok(Math.abs(note[20] - 4787156) < 1e-3);
});

test('two Tianzheng notes on one stored point use the attachment digit, and a separated note stays put', () => {
  const above = { kind: 'TCH_TEXT', scale: 1, x: 567762.72, y: 4786619.42, h: 5.401, align: 10, anchor: 7, text: '停车场' };
  const below = { kind: 'TCH_TEXT', scale: 1, x: 567761.72, y: 4786619.31, h: 5.309, align: 10, anchor: 1, text: '拆除' };
  const apart = { kind: 'TCH_TEXT', scale: 1, x: 567754.26, y: 4786684.30, h: 5.604, align: 10, anchor: 7, text: '巷道' };
  placeSharedText([above, below, apart]);
  assert.equal(above.align, 10);
  assert.equal(below.align, 1);
  assert.equal(apart.align, 10);
  assert.equal(above.x, 567762.72);
  assert.equal(above.y, 4786619.42);
  assert.equal(below.x, 567761.72);
  assert.equal(below.y, 4786619.31);
  assert.equal(above.h, 5.401);
  const along = Math.atan2(-1, 0.11);
  assert.ok(Math.abs(above.rot - along) < 1e-9, above.rot);
  assert.ok(Math.abs(below.rot - along) < 1e-9, below.rot);
  assert.ok(!apart.rot);
  const low = tchBuild(below, () => { throw new Error('already decoded'); })[0];
  const g = Object.fromEntries(low.pairs);
  assert.equal(g[10], 567761.72);
  assert.equal(g[20], 4786619.31);
  assert.equal(g[40], 5.309);
  assert.equal(g[72], 0);
  assert.equal(g[73], 3);
});

test('baseline-right Tianzheng text stays on the stored point', () => {
  assert.equal(tchAlign(9), 12);
  assert.equal(tchAlign(8), 11);
  const right = { kind: 'TCH_TEXT', scale: 1, x: 567788.93, y: 4786647.77, h: 1.6, align: 10, anchor: 9, rot: 0, text: '停车场' };
  placeSharedText([right]);
  assert.equal(right.align, 12);
  assert.equal(right.x, 567788.93);
  const g = Object.fromEntries(tchBuild(right, () => { throw new Error('already decoded'); })[0].pairs);
  assert.equal(g[10], 567788.93);
  assert.equal(g[20], 4786647.77);
  assert.equal(g[72], 2);
  assert.equal(g[73], 0);
});

const pairCh = ch => { const v = ch.charCodeAt(0) ^ 4; return String.fromCharCode(0x324 + Math.floor(v / 26), 0x324 + (v % 26)); };
const encDigits = s => [...s].map(pairCh).join('');

test('when two viewports cover one point, the one with a user axis wins', () => {
  const f = (codes) => (c, d = 0) => codes[c] ?? d;
  const doc = {
    header: { $UCSXDIR: [[10, '1'], [20, '0']] },
    entities: [
      { type: 'VIEWPORT', i: () => 2, f: f({ 40: 20, 41: 20, 45: 20, 12: 0, 22: 0, 17: 0, 27: 0, 51: 0, 111: 1, 121: 0 }) },
      { type: 'VIEWPORT', i: () => 2, f: f({ 40: 20, 41: 20, 45: 20, 12: 0, 22: 0, 17: 0, 27: 0, 51: 0, 111: Math.cos(0.4), 121: Math.sin(0.4) }) },
    ],
    blocks: new Map(),
  };
  const note = { kind: 'TCH_TEXT', x: 1, y: 1, h: 2, rot: 0, anchor: 7, align: 10 };
  orientTch(doc, { items: [{ cls: 'TCH_TEXT', mode: 2, f: note }] });
  assert.equal(note.rotFrom, 'viewport');
  assert.ok(Math.abs(note.rot - 0.4) < 1e-9);
});

test('a drawing without a rotated viewport leaves ordinary text horizontal', () => {
  const f = { kind: 'TCH_TEXT', x: 10, y: 10, h: 5, rot: 0, anchor: 7, align: 10 };
  const doc = { header: { $UCSXDIR: [[10, '1'], [20, '0']] }, entities: [], blocks: new Map() };
  orientTch(doc, { items: [{ cls: 'TCH_TEXT', mode: 2, f }, { cls: 'TCH_MTEXT', mode: 2, f: { kind: 'TCH_MTEXT', x: 1, y: 1, rot: 0 } }] });
  assert.equal(f.rot, 0);
});

test('a turned header UCS does not rotate unpaired text, and a pair far from that UCS is dropped', () => {
  const alone = { kind: 'TCH_TEXT', x: 30, y: 30, h: 2, rot: 0, anchor: 7, align: 10, pts: [[0, 0], [1, 1]] };
  const base = { kind: 'TCH_TEXT', x: 0, y: 0, h: 2, rot: 0, anchor: 7, align: 10 };
  const top = { kind: 'TCH_TEXT', x: 0, y: -1, h: 2, rot: 0, anchor: 1, align: 10 };
  const doc = { header: { $UCSXDIR: [[10, '0'], [20, '1']] }, entities: [], blocks: new Map() };
  placeSharedText([alone, base, top]);
  orientTch(doc, { items: [{ cls: 'TCH_TEXT', mode: 2, f: alone }, { cls: 'TCH_TEXT', mode: 2, f: base }, { cls: 'TCH_TEXT', mode: 2, f: top }] });
  assert.equal(alone.rot, 0);
  assert.equal(base.rotFrom, 'ucs');
  assert.ok(Math.abs(base.rot - Math.PI / 2) < 1e-9, base.rot);
  assert.equal(base.h, 2);
});

test('the two repair notes share a column, so the pair stays when it agrees with the viewport axis', () => {
  const fire = { kind: 'TCH_TEXT', x: 567741.391504929, y: 4786709.800570535, h: 5.201, rot: 0, anchor: 8, align: 10, text: '修复砌筑老消防井（更换井盖）' };
  const water = { kind: 'TCH_TEXT', x: 567740.3422067738, y: 4786709.656322091, h: 5.703, rot: 0, anchor: 2, align: 10, text: '修复砌筑老给水井（更换井盖）' };
  assert.equal((fire.anchor - 1) % 3, (water.anchor - 1) % 3);
  const otherCol = { kind: 'TCH_TEXT', x: fire.x + 0.2, y: fire.y, h: 2, rot: 0, anchor: 1, align: 10 };
  placeSharedText([fire, water, otherCol]);
  assert.equal(otherCol.rotFrom, undefined);
  const ucs = Math.atan2(-0.994986462951335, 0.100009692248261);
  const doc = {
    header: { $UCSXDIR: [[10, '1'], [20, '0']] },
    entities: [{
      type: 'VIEWPORT', i: () => 2,
      f: (c, d = 0) => ({ 40: 2000, 41: 2000, 45: 2000, 12: 0, 22: 0, 17: fire.x, 27: fire.y, 51: 0, 111: 0.100009692248261, 121: -0.994986462951335 }[c] ?? d),
    }],
    blocks: new Map(),
  };
  orientTch(doc, { items: [{ cls: 'TCH_TEXT', mode: 2, f: fire }, { cls: 'TCH_TEXT', mode: 2, f: water }] });
  assert.equal(fire.rotFrom, 'pair');
  assert.equal(water.rotFrom, 'pair');
  assert.ok(Math.abs(fire.rot - water.rot) < 1e-9);
  assert.ok(Math.abs(fire.rot - ucs) < 5 * Math.PI / 180);
  assert.equal(fire.h, 5.201);
  assert.equal(fire.x, 567741.391504929);
});

test('anchors 4–6 set alignment, an unpaired 1–3 anchor does not, and the nearest partner wins', () => {
  assert.equal(tchAlign(4), 4);
  assert.equal(tchAlign(5), 5);
  assert.equal(tchAlign(6), 6);
  const mid = { kind: 'TCH_TEXT', x: 0, y: 0, h: 2, rot: 0, anchor: 5, align: 10 };
  const lone = { kind: 'TCH_TEXT', x: 30, y: 30, h: 2, rot: 0, anchor: 3, align: 10 };
  const host = { kind: 'TCH_TEXT', x: 0, y: 0, h: 2, rot: 0, anchor: 7, align: 10 };
  const close = { kind: 'TCH_TEXT', x: 0.4, y: 0, h: 2, rot: 0, anchor: 1, align: 10 };
  const farther = { kind: 'TCH_TEXT', x: 0, y: 1.6, h: 2, rot: 0, anchor: 1, align: 10 };
  placeSharedText([mid, lone, host, close, farther]);
  assert.equal(mid.align, 5);
  assert.equal(lone.align, 10);
  assert.equal(lone.rot, 0);
  const alongX = Math.atan2(0.4, 0);
  assert.ok(Math.abs(host.rot - alongX) < 1e-9, host.rot);
  assert.equal(host.rotFrom, 'pair');
  assert.ok(Math.abs(close.x - 0.4) < 1e-9);
});

test('text anchor is the first 3-digit code after the words, not a later one', () => {
  assert.equal(textAnchor(['注', encDigits('076'), encDigits('395')]), 7);
  assert.equal(textAnchor(['注', encDigits('102')]), 0);
});

test('a layout viewport UCS rotates only model text inside that viewport', () => {
  const ang = Math.atan2(-0.99499, 0.10001);
  const f = { kind: 'TCH_TEXT', x: 1, y: 1, h: 2, rot: 0, anchor: 7, align: 10 };
  const outside = { kind: 'TCH_TEXT', x: 80, y: 80, h: 2, rot: 0, anchor: 7, align: 10 };
  const kept = { kind: 'TCH_TEXT', x: 1, y: 1, h: 2, rot: 0.4, anchor: 7, align: 10 };
  const doc = {
    header: { $UCSXDIR: [[10, '1'], [20, '0']] },
    entities: [{ type: 'VIEWPORT', i: () => 2, f: (c, d = 0) => ({ 40: 20, 41: 20, 45: 20, 12: 0, 22: 0, 17: 0, 27: 0, 51: 0, 111: 0.10001, 121: -0.99499 }[c] ?? d) }],
    blocks: new Map(),
  };
  orientTch(doc, {
    items: [
      { cls: 'TCH_TEXT', mode: 2, f },
      { cls: 'TCH_TEXT', mode: 2, f: outside },
      { cls: 'TCH_TEXT', mode: 2, f: kept },
      { cls: 'TCH_MTEXT', mode: 2, f: { kind: 'TCH_MTEXT', x: 1, y: 1, rot: 0 } },
    ],
  });
  assert.ok(Math.abs(f.rot - ang) < 1e-12);
  assert.equal(f.x, 1);
  assert.equal(outside.rot, 0);
  assert.equal(kept.rot, 0.4);
});
