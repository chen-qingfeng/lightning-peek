// DWG 版本识别与 LibreDWG 错误提示（纯函数，便于单测）

export const DWG_MAGIC = {
  AC1009: 'R12',
  AC1012: 'R13',
  AC1014: 'R14',
  AC1015: '2000',
  AC1018: '2004',
  AC1021: '2007',
  AC1024: '2010',
  AC1027: '2013',
  AC1032: '2018',
};

export function dwgMagicOf(bytes) {
  if (!bytes || bytes.length < 6) return '';
  return new TextDecoder('latin1').decode(bytes.subarray(0, 6)).replace(/\0.*$/, '');
}

export function isKnownDwgMagic(magic) {
  return Object.prototype.hasOwnProperty.call(DWG_MAGIC, String(magic || ''));
}

export function verName(v) {
  const key = String(v || '').replace(/\0.*$/, '');
  if (DWG_MAGIC[key]) {
    // AC1032 从 AutoCAD 2018 沿用到现在；状态栏写「2018+」避免误以为只能开 2018。
    if (key === 'AC1032') return 'AutoCAD 2018+';
    return 'AutoCAD ' + DWG_MAGIC[key];
  }
  return key || 'DWG';
}

// LibreDWG 写出的 DXF 是否值得继续解析
export function isUsableDxf(bytes) {
  if (!bytes || bytes.length < 32) return false;
  const n = Math.min(bytes.length, 8192);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, n));
  return /(?:^|\r?\n)\s*0\s*\r?\n\s*SECTION\b/i.test(head);
}

export function errText(code, magic = '') {
  const m = String(magic || '').replace(/\0.*$/, '');
  const known = isKnownDwgMagic(m);
  if (code & 2048) {
    if (m.startsWith('AC') && !known) {
      return '图纸版本不受支持。目前最高可读 AutoCAD 2018 格式（AC1032，2018–2025 另存均为此格式）。可在 CAD 里另存为 2018 或更早的 DWG，或另存为 DXF 后再打开';
    }
    if (known) {
      return '这张图纸无法完整读取，可能已损坏或含无法识别的内容。可在 CAD 里用「修复」后另存为 2018 或更早的 DWG，或另存为 DXF 后再试';
    }
    return '图纸格式无法识别或已损坏。请确认是 DWG/DXF 文件；也可以在 CAD 里另存为 2018 或更早的 DWG，或另存为 DXF 后再打开';
  }
  if (code & 1024) return '图纸文件损坏或不完整。可以用 CAD 软件的「修复」功能处理后再打开';
  if (code & 512) return '图纸被加密或格式无法识别。请确认文件是 DWG 格式，加密图纸需先在原软件中解密';
  if (code & 256) return '无法读取这张图纸，文件可能已损坏。可以用 CAD 软件的「修复」功能处理，或另存为 DXF 后再试';
  if (code & 128) return '图纸缺少必要数据，无法打开。可以在 CAD 软件里另存一份后再试';
  console.warn('LibreDWG error code', code);
  return '图纸无法解析。可以在 CAD 软件里另存为 DXF 后再试，并欢迎反馈这张图纸的情况';
}
