// 闪电看图 · 依次执行的任务队列。前一个结束（成功或失败）后才开始下一个。
// 读 DWG 用它：每张图读完都会换一个新的读图模块，两张图不能同时拿到同一个模块。
export function serial() {
  let chain = Promise.resolve();
  return (fn) => {
    const job = chain.then(() => fn());
    chain = job.catch(() => {});
    return job;
  };
}
