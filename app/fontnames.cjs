// 图纸里点名的字体找不到时，按文件名互相替。不内置这些字体，只决定查找顺序。
// 大字体：hztxt.shx、gbcbig.shx，以及 hzfs 这类仿宋大字体。西文：simplex、txt、complex，以及 gbenor、monotxt。
// 叫不上名字的 SHX 也按这套标准字体找。结构钢筋字体（tssdeng、yjkeng）不拿普通大字体顶替。
const BIG = ['hztxt.shx', 'gbcbig.shx'];
const SHAPE = ['simplex.shx', 'txt.shx', 'complex.shx'];
const STRUCT = new Set(['tssdeng.shx', 'yjkeng.shx', 'tssdeng2.shx']);
const BIG_NAME = /^(hztxt|gbcbig|hzdx|china|hzfs|hzs|chineset|hzkt|hzxk|fsdb|idqstyle)\.shx$/;
const SHAPE_NAME = /^(txt|simplex|complex|romans|italic|isocp|gbenor|gbeitc|monotxt|romanc|romant|romand)\.shx$/;
const TTF = {
  'simsun.ttf': ['simsun.ttc', 'simsun.ttf'],
  'simsun.ttc': ['simsun.ttf', 'simsun.ttc'],
  'nsimsun.ttf': ['simsun.ttc', 'simsun.ttf'],
  'simhei.ttf': ['simhei.ttf'],
  'simkai.ttf': ['simkai.ttf'],
  'simfang.ttf': ['simfang.ttf', 'fangsong.ttf'],
  'fangsong.ttf': ['simfang.ttf', 'fangsong.ttf'],
  'msyh.ttf': ['msyh.ttc', 'msyh.ttf'],
  'msyh.ttc': ['msyh.ttf', 'msyh.ttc'],
  'arialuni.ttf': ['arialuni.ttf'],
};

function fontCandidates(name) {
  const key = String(name || '').split(/[\\/]/).pop().trim().toLowerCase();
  if (!key) return [];
  const out = [];
  const add = (n) => { if (n && !out.includes(n)) out.push(n); };
  add(key);
  const ttf = TTF[key];
  if (ttf) for (const n of ttf) add(n);
  if (!key.endsWith('.shx') || STRUCT.has(key)) return out;
  const group = BIG.includes(key) || BIG_NAME.test(key) ? BIG
    : (SHAPE.includes(key) || SHAPE_NAME.test(key) ? SHAPE : null);
  if (group) for (const n of group) add(n);
  else { for (const n of SHAPE) add(n); for (const n of BIG) add(n); }
  return out;
}

module.exports = { fontCandidates, BIG, SHAPE };
