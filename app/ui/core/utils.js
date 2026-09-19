/* BabyReader UI module: core/utils */

'use strict';

/* ============================================================
   Debounce
   ============================================================ */
function debounce(fn, delay) {
  let timer = null;
  let pendingArgs = null;
  let pendingThis = null;

  const invoke = () => {
    if (!pendingArgs) return Promise.resolve();
    const args = pendingArgs;
    const context = pendingThis;
    pendingArgs = null;
    pendingThis = null;
    if (timer) clearTimeout(timer);
    timer = null;
    return Promise.resolve(fn.apply(context, args));
  };

  const debounced = function (...args) {
    pendingArgs = args;
    pendingThis = this;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      invoke().catch((error) => console.error('延迟任务执行失败', error));
    }, delay);
  };

  debounced.flush = invoke;
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pendingArgs = null;
    pendingThis = null;
  };
  debounced.pending = () => Boolean(pendingArgs);
  return debounced;
}
