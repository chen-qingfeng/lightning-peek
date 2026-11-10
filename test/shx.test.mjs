import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShx, layoutShx } from '../app/renderer/core/shx.js';
import { parseDxf, buildScene, FONT_FAMILIES } from '../app/renderer/core/engine.js';
import fs from 'node:fs';

function u16(n) { return [n & 255, n >> 8 & 255]; }
function u32(n) { return [n & 255, n >> 8 & 255, n >> 16 & 255, n >> 24 & 255]; }

function shapesFont(glyphs) {
  const entries = [[0, [...'TXT'.split('').map(c => c.charCodeAt(0)), 0, 8, 2, 0, 0].flat()], ...glyphs];
  const index = [];
  const data = [];
  for (const [code, bytes] of entries) { index.push(...u16(code), ...u16(bytes.length)); data.push(...bytes); }
  const header = [...'AutoCAD-86 shapes 1.0\r\n\x1a'].map(c => c.charCodeAt(0));
  return Uint8Array.from([...header, 0, 0, 0, 0, ...u16(entries.length), ...index, ...data]);
}

function bigFont(glyphs, above = 8) {
  const entries = [[0, [0x48, 0x5a, 0, above, 0, 0, 0]], ...glyphs];
  const header = [...'AutoCAD-86 bigfont 1.0\r\n\x1a'].map(c => c.charCodeAt(0));
  const indexAt = header.length + 10;
  let at = indexAt + entries.length * 8;
  const index = [];
  const data = [];
  for (const [code, bytes] of entries) {
    index.push(...u16(code), ...u16(bytes.length), ...u32(at));
    data.push(...bytes);
    at += bytes.length;
  }
  return Uint8Array.from([...header, 8, 0, ...u16(entries.length), ...u16(1), 0x01, 0xa1, 0xfe, 0xfe, ...index, ...data]);
}

test('shapes SHX draws a glyph and reports its advance', () => {
  // 从 (0,0) 画到 (0,8)、(6,8)，再提笔走到 (8,0)
  const font = parseShx(shapesFont([[65, [8, 0, 8, 8, 6, 0, 2, 8, 2, -8 & 255, 0]]]));
  assert.equal(font.type, 'shapes');
  assert.equal(font.baseUp, 8);
  const lay = layoutShx('A', font, null);
  assert.ok(lay);
  assert.equal(lay.width, 8);
  assert.equal(lay.lines.length, 1);
  assert.deepEqual(lay.lines[0].slice(0, 4), [0, 0, 0, 8]);
});

test('bigfont SHX is looked up by GBK code', () => {
  const dec = new TextDecoder('gbk');
  const ch = dec.decode(new Uint8Array([0xd6, 0xd0]));
  assert.equal(ch, '中');
  // 提笔开始，落笔后向上画 8 个单位
  const font = parseShx(bigFont([[0xd6d0, [1, 8, 0, 8, 2, 8, 8, 0, 0]]]));
  assert.equal(font.type, 'bigfont');
  assert.equal(font.baseUp, 8);
  const lay = layoutShx(ch, null, font);
  assert.ok(lay, '中 should come from the bigfont');
  assert.ok(lay.width >= 8);
  assert.ok(lay.lines.length >= 1);
});

test('a style that names hztxt.shx is kept on the text', () => {
  const dxf = ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'STYLE',
    '0', 'STYLE', '2', 'HZ', '3', 'txt.shx', '4', 'HZTXT.SHX', '0', 'ENDTAB',
    '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES',
    '0', 'TEXT', '8', '0', '10', '0', '20', '0', '40', '3', '1', '池', '7', 'HZ',
    '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const t = buildScene(parseDxf(dxf)).spaces[0].texts[0];
  assert.equal(t.s, '池');
  assert.equal(t.sf, 'txt.shx');
  assert.equal(t.bf, 'hztxt.shx');
});

test('the bundled Chinese font is part of every fallback stack', () => {
  for (const fam of FONT_FAMILIES) assert.match(fam, /Noto Sans SC/);
  const font = fs.readFileSync(new URL('../app/renderer/fonts/NotoSansSC-Regular.woff2', import.meta.url));
  assert.equal(font.length > 500000, true);
  assert.equal(String.fromCharCode(font[0], font[1], font[2], font[3]), 'wOF2');
  const notice = fs.readFileSync(new URL('../app/renderer/fonts/NotoSansSC-OFL.txt', import.meta.url), 'utf8');
  assert.match(notice, /SIL OPEN FONT LICENSE/);
});

test('missing SHX data falls back instead of drawing an empty word', () => {
  const font = parseShx(shapesFont([[65, [8, 6, 0, 0]]]));
  assert.equal(layoutShx('消防', font, null), null);
});
