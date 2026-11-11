// 专用 DWG 转换线程。桌面版不传 dedicated，不会调用 convertInChild。
// 子线程转完就 terminate，调用方用 transfer 拿回 DXF 字节。

const CHILD_TIMEOUT_MS = 180000;

export function jsMem() {
  const m = typeof performance !== 'undefined' && performance.memory;
  if (!m) return null;
  return { used: m.usedJSHeapSize || 0, total: m.totalJSHeapSize || 0 };
}

export function wasmBytesOf(mod) {
  return mod && mod.HEAPU8 ? mod.HEAPU8.byteLength : 0;
}

// bytes：Uint8Array。返回 { bytes: Uint8Array, warn, oles, tch, wasmBefore, wasmBytes, jsAfter }
export function convertInChild(bytes) {
  return new Promise((resolve, reject) => {
    const url = new URL('./worker.js', import.meta.url);
    url.searchParams.set('dedicated', '1');
    const child = new Worker(url, { type: 'module' });
    let done = false;
    const timer = setTimeout(() => finish(new Error('DWG 转换超时')), CHILD_TIMEOUT_MS);
    const finish = (err, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child.terminate(); } catch (e) { /* 已经结束 */ }
      if (err) reject(err);
      else resolve(result);
    };
    child.onmessage = (e) => {
      const m = e.data;
      if (!m || m.id !== 1 || m.progress) return;
      if (m.ok) finish(null, m.result);
      else finish(new Error(m.bootError || m.error || '转换失败'));
    };
    child.onerror = (e) => finish(new Error(e.message || '转换线程出错'));
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    child.postMessage({ id: 1, cmd: 'convert-only', bytes: buf }, [buf]);
  });
}
