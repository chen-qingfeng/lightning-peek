import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dwgMagicOf, errText, isKnownDwgMagic, isUsableDxf, verName } from '../app/renderer/core/dwgSupport.js';
import { parseDxf, decodeDxf, buildScene } from '../app/renderer/core/engine.js';

test('known DWG magics include 2010–2018', () => {
  assert.equal(isKnownDwgMagic('AC1024'), true);
  assert.equal(isKnownDwgMagic('AC1027'), true);
  assert.equal(isKnownDwgMagic('AC1032'), true);
  assert.equal(isKnownDwgMagic('AC1035'), false);
  assert.equal(verName('AC1032'), 'AutoCAD 2018+');
});

test('errText no longer asks to down-save to 2007', () => {
  const unknown = errText(2048, 'AC1035');
  assert.match(unknown, /2018/);
  assert.doesNotMatch(unknown, /2007/);
  const broken = errText(2048, 'AC1032');
  assert.match(broken, /无法完整读取|damaged|unrecognized/i);
  assert.doesNotMatch(broken, /2007/);
});

test('isUsableDxf accepts a minimal SECTION header', () => {
  const ok = new TextEncoder().encode('0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n');
  assert.equal(isUsableDxf(ok), true);
  assert.equal(isUsableDxf(new Uint8Array([1, 2, 3])), false);
  assert.equal(isUsableDxf(null), false);
});

async function convertSample(path) {
  const createModule = (await import('../app/renderer/lib/libredwg-web.js')).default;
  const m = await createModule({ locateFile: f => new URL('../app/renderer/lib/' + f, import.meta.url).href });
  const bytes = readFileSync(path);
  const magic = dwgMagicOf(bytes);
  const inF = '/sample.dwg', outF = '/sample.dxf';
  m.FS.writeFile(inF, bytes);
  const r = m.dwg_read_file(inF);
  const err = r && typeof r.error === 'number' ? r.error : 0;
  // Mirror the soft-open policy: write even when err looks critical.
  const rc = m.dwg_write_dxf(inF, outF);
  assert.ok(m.FS.analyzePath(outF).exists, path + ' should produce a DXF');
  const out = new Uint8Array(m.FS.readFile(outF));
  assert.equal(isUsableDxf(out), true);
  const doc = parseDxf(decodeDxf(out).text);
  const scene = buildScene(doc);
  assert.ok(scene.stats.entities > 0, path + ' should yield entities');
  return { magic, err, rc, entities: scene.stats.entities };
}

const samples = [
  ['/tmp/dwg-samples/sample_AC1024.dwg', 'AC1024'],
  ['/tmp/dwg-samples/sample_AC1027.dwg', 'AC1027'],
  ['/tmp/dwg-samples/sample_AC1032.dwg', 'AC1032'],
];

for (const [path, expectMagic] of samples) {
  test('opens ' + expectMagic + ' DWG through LibreDWG soft-open path', { skip: !existsSync(path) }, async () => {
    const r = await convertSample(path);
    assert.equal(r.magic, expectMagic);
    assert.ok(r.entities > 10);
  });
}
