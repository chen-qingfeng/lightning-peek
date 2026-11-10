// 天正文字解码：用手工拼出来的位流测试（不依赖真实图纸）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeTch, tchPairs, tchMarkup, tgNumber, decodeTchStream, tchBuild } from '../app/renderer/core/tarch.js';
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
