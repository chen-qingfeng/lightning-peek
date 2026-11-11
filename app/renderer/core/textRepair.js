// 闪电看图 · 文字编码修复
// 从 swift-drawing 的 textRepair 迁入（所有者同意，按本仓库 GPL-3.0-or-later 发布）。
// 1) DXF 的 \U+XXXX / \M+nXXXX 转义；
// 2) 没有用声明的代码页解码时，把「GBK 被当成 Latin-1/CP1252」的字节按 GB18030 重解；
// 3) 连续的 ◇ 或 U+FFFD 视为丢字，交给界面提示。
// 重解只在结果明显更好时替换，避免改掉 café、résumé 这类本来就正确的西文。

/** \U+4E2D、\M+14E2D → 实际字符。\M+ 的第一位是代码页号，后四位是字符码。 */
export function unescapeDxfText(s) {
  if (!s) return s;
  return s
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u\+([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\M\+[0-9A-Fa-f]([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// windows-1252 把 0x80–0x9F 显示成这些符号；还原字节时要映射回去。
const CP1252_HIGH = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
let LEVEL1 = null;

// GB2312 一级汉字（GBK 字节 B0–D7 / A1–FE）。乱码重解后多数汉字落在这里，偶然拼出来的生僻字则不是。
function level1Set() {
  if (LEVEL1) return LEVEL1;
  LEVEL1 = new Set();
  const dec = new TextDecoder('gbk');
  for (let a = 0xb0; a <= 0xd7; a++) {
    for (let b = 0xa1; b <= 0xfe; b++) {
      const ch = dec.decode(new Uint8Array([a, b]));
      if (ch && ch.length === 1 && ch !== '\ufffd') LEVEL1.add(ch);
    }
  }
  return LEVEL1;
}

function tryDecode(bytes, label) {
  try { return new TextDecoder(label, { fatal: true }).decode(new Uint8Array(bytes)); }
  catch (e) { return null; }
}

// 连续高位字符若正好是码位相邻（ÀÁÂÃÄÅ），那是字母表而不是 GBK 字节对。
function alphabetDump(chars) {
  let saw = false;
  for (let i = 0; i < chars.length;) {
    if (chars[i].codePointAt(0) < 0x80) { i++; continue; }
    let j = i + 1;
    while (j < chars.length && chars[j].codePointAt(0) >= 0x80) j++;
    if (j - i >= 2) {
      saw = true;
      const step = chars[i + 1].codePointAt(0) - chars[i].codePointAt(0);
      if (step !== 1 && step !== -1) return false;
      for (let k = i + 1; k < j; k++) {
        if (chars[k].codePointAt(0) - chars[k - 1].codePointAt(0) !== step) return false;
      }
    }
    i = j;
  }
  return saw;
}

function score(s, common) {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 0x80) n += 1;
    else if (CJK.test(ch) && common.has(ch)) n += 3;
    else if (CJK.test(ch)) n += 1;
    else n -= 1;
  }
  return n;
}

/**
 * 把「被当成 Latin-1/CP1252 的 GBK 字节」还原。
 * opts.codepageDeclared 为真时原样返回：这份文字已经按 $DWGCODEPAGE 解过，不能再改。
 * 原文里已经有汉字、高位字符不足两个、或高位字符是零散的重音（café）时也不改。
 */
export function repairMojibake(input, opts) {
  if (!input || (opts && opts.codepageDeclared)) return input;
  if (CJK.test(input)) return input;
  const chars = [...input];
  let high = 0, run = 0, bestRun = 0;
  for (const ch of chars) {
    if (ch.codePointAt(0) >= 0x80) { high++; run++; if (run > bestRun) bestRun = run; }
    else run = 0;
  }
  if (high < 2 || bestRun < 2 || alphabetDump(chars)) return input;

  const bytes = [];
  for (const ch of chars) {
    const code = ch.codePointAt(0);
    if (code < 0x100) bytes.push(code);
    else if (CP1252_HIGH[code] != null) bytes.push(CP1252_HIGH[code]);
    else return input;
  }

  const common = level1Set();
  const before = score(input, common);
  let best = null, bestScore = before;
  for (const label of ['gb18030', 'gbk', 'big5']) {
    const text = tryDecode(bytes, label);
    if (!text || text === input || /\ufffd/.test(text)) continue;
    const out = [...text];
    if (out.length > chars.length) continue;
    let cjk = 0, l1 = 0;
    for (const ch of out) if (CJK.test(ch)) { cjk++; if (common.has(ch)) l1++; }
    if (cjk < 1) continue;
    if (cjk === 1 ? l1 !== 1 : l1 / cjk < 0.5) continue;
    const sc = score(text, common);
    if (sc > bestScore) { best = text; bestScore = sc; }
  }
  return best || input;
}

/** 丢字：连续的 ◇ 或替换符。单个 ◇ 不当成损坏。 */
export function looksBrokenText(input) {
  if (!input) return false;
  return /[\u25c7\ufffd]{2,}/.test(input);
}

/** 先解转义，再按 opts 决定要不要重解乱码。 */
export function repairText(input, opts) {
  return repairMojibake(unescapeDxfText(input), opts);
}
