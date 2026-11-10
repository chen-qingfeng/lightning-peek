// 运行：node --test test/textRepair.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksBrokenText, repairMojibake, repairText, unescapeDxfText } from '../app/renderer/core/textRepair.js';
import { buildScene, decodeDxf, parseDxf } from '../app/renderer/core/engine.js';

test('还原 \\U+XXXX 与 \\M+nXXXX 转义', () => {
  assert.equal(unescapeDxfText('\\U+4E2D\\U+6587'), '中文');
  assert.equal(unescapeDxfText('图号\\U+FF1A01'), '图号：01');
  assert.equal(unescapeDxfText('\\u+4e2d'), '中');
  assert.equal(unescapeDxfText('\\M+14E2D'), '中');
  assert.equal(unescapeDxfText('普通文本'), '普通文本');
});

test('把被当作 Latin-1 的 GBK 字节还原为中文', () => {
  // 「中文」的 GBK 字节 D6 D0 CE C4，按 Latin-1 读就是 ÖÐÎÄ
  assert.equal(repairMojibake('ÖÐÎÄ'), '中文');
  assert.equal(repairMojibake('¿Õ¼ä'), '空间');
  // 单字，以及含 GBK 扩展字「砼」的句子，也应当还原
  assert.equal(repairMojibake('¼×'), '甲');
  assert.equal(repairMojibake('µØÏÂÊÒµ×°åíÅÇ¿¶È'), '地下室底板砼强度');
});

test('正常中文、ASCII 和本来就正确的西文不被改写', () => {
  assert.equal(repairMojibake('一层平面图'), '一层平面图');
  assert.equal(repairMojibake('A-101'), 'A-101');
  assert.equal(repairMojibake('Café'), 'Café');
  assert.equal(repairMojibake('café'), 'café');
  assert.equal(repairMojibake('résumé'), 'résumé');
  assert.equal(repairMojibake('München'), 'München');
  assert.equal(repairMojibake('São Paulo'), 'São Paulo');
  assert.equal(repairMojibake('Ångström'), 'Ångström');
  assert.equal(repairMojibake('El Niño'), 'El Niño');
  // 一整串合法 Latin-1，重解结果并不会更好
  assert.equal(repairMojibake('àáâãäåæçèé'), 'àáâãäåæçèé');
  assert.equal(repairMojibake('ÀÁÂÃÄÅ'), 'ÀÁÂÃÄÅ');
});

test('已按 $DWGCODEPAGE 解码的文字不再重解', () => {
  const opt = { codepageDeclared: true };
  assert.equal(repairMojibake('ÖÐÎÄ', opt), 'ÖÐÎÄ');
  assert.equal(repairText('ÖÐÎÄ', opt), 'ÖÐÎÄ');
  // 转义仍然要解开，守卫只挡住「把字节再解一遍」
  assert.equal(repairText('\\U+4E2D\\U+6587', opt), '中文');
});

test('识别真正的丢字损坏', () => {
  assert.equal(looksBrokenText('5.◇◇◇◇'), true);
  assert.equal(looksBrokenText('正常文字'), false);
  assert.equal(looksBrokenText('单◇个'), false);
  assert.equal(looksBrokenText('A\ufffd\ufffdB'), true);
  assert.equal(looksBrokenText('只一个\ufffd'), false);
});

test('repairText 组合处理', () => {
  assert.equal(repairText('\\U+56FE\\U+7EB8'), '图纸');
  assert.equal(repairText('ÖÐÎÄ'), '中文');
});

function textDxf(body, headerLines) {
  const head = headerLines ? ['0', 'SECTION', '2', 'HEADER', ...headerLines, '0', 'ENDSEC'].join('\n') + '\n' : '';
  return head + ['0', 'SECTION', '2', 'ENTITIES', '0', 'TEXT', '8', '0', '10', '0', '20', '0', '40', '2.5', '1', body, '0', 'ENDSEC', '0', 'EOF'].join('\n');
}

test('显示文字走修复，且声明了代码页时不动', () => {
  const plain = buildScene(parseDxf(textDxf('ÖÐÎÄ')));
  assert.equal(plain.spaces[0].texts[0].s, '中文');

  const declared = buildScene(parseDxf(textDxf('ÖÐÎÄ', ['9', '$DWGCODEPAGE', '3', 'ANSI_1252'])));
  assert.equal(declared.spaces[0].texts[0].s, 'ÖÐÎÄ');

  const kept = buildScene(parseDxf(textDxf('café')));
  assert.equal(kept.spaces[0].texts[0].s, 'café');

  const mtext = ['0', 'SECTION', '2', 'ENTITIES', '0', 'MTEXT', '8', '0', '10', '0', '20', '0', '40', '2.5', '1', '\\U+6CF5\\U+623F', '0', 'ENDSEC', '0', 'EOF'].join('\n');
  assert.equal(buildScene(parseDxf(mtext)).spaces[0].texts[0].s, '泵房');
});

test('按声明代码页解开的 GBK 文件不会被二次改写', () => {
  const head = '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n9\n$DWGCODEPAGE\n3\nANSI_936\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nTEXT\n8\n0\n10\n0\n20\n0\n40\n2.5\n1\n';
  const gbk = Uint8Array.from([0xb1, 0xc3, 0xb7, 0xbf]); // 泵房
  const tail = '\n0\nENDSEC\n0\nEOF\n';
  const bytes = new Uint8Array([...new TextEncoder().encode(head), ...gbk, ...new TextEncoder().encode(tail)]);
  const r = decodeDxf(bytes);
  assert.equal(r.enc, 'gbk');
  assert.equal(r.codepageDeclared, true);
  assert.equal(buildScene(parseDxf(r.text), { codepageDeclared: true }).spaces[0].texts[0].s, '泵房');
});

test('UTF-8 里夹带的 GBK 乱码仍会修复，即使文件头写着 ANSI_936', () => {
  const dxf = textDxf('ÖÐÎÄ', ['9', '$ACADVER', '1', 'AC1021', '9', '$DWGCODEPAGE', '3', 'ANSI_936']);
  const r = decodeDxf(new TextEncoder().encode(dxf));
  assert.equal(r.enc, 'utf-8');
  assert.equal(r.codepageDeclared, false);
  assert.equal(buildScene(parseDxf(r.text), { codepageDeclared: r.codepageDeclared }).spaces[0].texts[0].s, '中文');
});

test('连续丢字记入 stats.brokenText，文字本身保留', () => {
  const dxf = ['0', 'SECTION', '2', 'ENTITIES',
    '0', 'TEXT', '8', '0', '10', '0', '20', '0', '40', '2.5', '1', '5.◇◇◇◇',
    '0', 'TEXT', '8', '0', '10', '0', '20', '5', '40', '2.5', '1', '正常',
    '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const sc = buildScene(parseDxf(dxf));
  assert.equal(sc.stats.brokenText, 1);
  assert.ok(sc.spaces[0].texts.some(t => t.s === '5.◇◇◇◇'));
  assert.ok(sc.spaces[0].texts.some(t => t.s === '正常'));
});
