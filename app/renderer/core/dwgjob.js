// 闪电看图 · 读图线程：只读一张 DWG，读完由后台线程关掉，内存随线程一起交还
import { convertDwg, wasmTrap } from './dwgconv.js';

const fail = (err) => self.postMessage({ ok: false, error: String(err && err.message || err), code: err && err.code || 0, trap: wasmTrap(err) });
self.onmessage = async (e) => {
  const { bytes, module } = e.data;
  try {
    const factory = (await import('../lib/libredwg-web.js')).default;
    const opts = { locateFile: (f) => new URL('../lib/' + f, import.meta.url).href };
    // 后台线程已经编译好的模块直接实例化，不用每张图重新编译 11MB 的 wasm
    if (module) opts.instantiateWasm = (imports, done) => { WebAssembly.instantiate(module, imports).then(inst => done(inst, module), fail); return {}; };
    const m = await factory(opts);
    const r = convertDwg(m, new Uint8Array(bytes));
    const t = [r.bytes.buffer]; for (const o of r.oles) t.push(o.data.buffer);
    self.postMessage({ ok: true, r }, t);
  } catch (err) { fail(err); }
};
