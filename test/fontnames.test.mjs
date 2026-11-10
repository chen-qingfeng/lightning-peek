import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { fontCandidates } = createRequire(import.meta.url)('../app/fontnames.cjs');

test('missing bigfont falls back to hztxt then gbcbig, not a structural font', () => {
  assert.deepEqual(fontCandidates('HZTXT.SHX'), ['hztxt.shx', 'gbcbig.shx']);
  assert.deepEqual(fontCandidates('gbcbig.shx'), ['gbcbig.shx', 'hztxt.shx']);
  assert.deepEqual(fontCandidates('tssdeng.shx'), ['tssdeng.shx']);
  assert.deepEqual(fontCandidates('yjkeng.shx'), ['yjkeng.shx']);
});

test('missing western shx falls back to simplex, txt, complex', () => {
  assert.deepEqual(fontCandidates('txt.shx'), ['txt.shx', 'simplex.shx', 'complex.shx']);
  assert.deepEqual(fontCandidates('romans.shx'), ['romans.shx', 'simplex.shx', 'txt.shx', 'complex.shx']);
});

test('simsun.ttf resolves to the Windows ttc name', () => {
  assert.deepEqual(fontCandidates('simsun.ttf'), ['simsun.ttf', 'simsun.ttc']);
  assert.deepEqual(fontCandidates('C:\\\\Windows\\\\Fonts\\\\simhei.ttf'), ['simhei.ttf']);
  assert.deepEqual(fontCandidates('unknown.shx'), ['unknown.shx']);
});
