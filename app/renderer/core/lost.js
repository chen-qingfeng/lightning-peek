// 闪电看图 · 另存时会丢掉的对象
// DXF 输出里没有、由这里补进图纸的对象（天正文字、OLE 表格）。另存 DXF / DWG 时它们不在文件里，
// 记下每个对象的位置（世界坐标），导出时按范围数出来告诉用户。
export function injectedPoints(doc) {
  const pts = [], seen = new Set();
  const scan = (ents) => {
    for (const r of ents) {
      if (!r._lost || seen.has(r._lost)) continue; // 一个天正对象会拆成几条线和字，只数一次
      seen.add(r._lost);
      pts.push([r.f(10, NaN), r.f(20, NaN)]);
    }
  };
  scan(doc.entities); for (const b of doc.blocks.values()) scan(b.ents);
  return pts;
}
export function lostCount(pts, bb) {
  if (!pts) return 0;
  if (!bb) return pts.length;
  let n = 0;
  for (const [x, y] of pts) if (!Number.isFinite(x) || !Number.isFinite(y) || (x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3])) n++;
  return n;
}
