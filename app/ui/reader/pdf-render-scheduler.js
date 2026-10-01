/* 枕书 UI module: reader/pdf-render-scheduler */

'use strict';

(function installPdfRenderScheduler(root) {
  function normalizedPages(values) {
    const pages = [];
    const seen = new Set();
    for (const value of values || []) {
      const pageIndex = Number(value);
      if (!Number.isInteger(pageIndex) || pageIndex < 0 || seen.has(pageIndex)) continue;
      seen.add(pageIndex);
      pages.push(pageIndex);
    }
    return pages;
  }

  function createPdfRenderScheduler({ maxConcurrent = 1, maxFrames = 10 } = {}) {
    const concurrencyLimit = Math.max(1, Math.floor(Number(maxConcurrent) || 1));
    const frameLimit = Math.max(1, Math.floor(Number(maxFrames) || 10));
    let currentGeneration;
    let destroyed = false;
    let queue = [];
    let sequence = 0;
    const running = new Map();
    const ready = new Map();
    const failed = new Map();
    let activeCurrentPage = 0;
    let visiblePages = new Set();
    let bufferedPages = new Set();
    let selectedPages = new Set();

    function isCurrentJob(job) {
      return Boolean(job) && job.generation === currentGeneration
        && Number.isInteger(job.pageIndex) && job.pageIndex >= 0;
    }

    function resetForGeneration(generation) {
      currentGeneration = generation;
      queue = [];
      running.clear();
      ready.clear();
      failed.clear();
      visiblePages = new Set();
      bufferedPages = new Set();
      selectedPages = new Set();
    }

    function update({
      visible = [],
      buffered = [],
      selected = [],
      currentPage = 0,
      scrollDirection = 'down',
      generation
    } = {}) {
      if (destroyed) return false;
      if (currentGeneration !== generation) resetForGeneration(generation);
      const current = Number.isInteger(Number(currentPage)) ? Number(currentPage) : 0;
      activeCurrentPage = current;
      if (failed.has(current) && !failed.get(current)?.failedAsCurrent) failed.delete(current);
      const visibleList = normalizedPages(visible);
      const bufferedList = normalizedPages(buffered);
      visiblePages = new Set(visibleList);
      bufferedPages = new Set(bufferedList);
      selectedPages = new Set(normalizedPages(selected));

      const visiblePriority = visibleList.slice().sort((left, right) => {
        if (left === current) return -1;
        if (right === current) return 1;
        return Math.abs(left - current) - Math.abs(right - current) || left - right;
      });
      const neighbors = bufferedList.filter((pageIndex) => !visiblePages.has(pageIndex));
      const before = neighbors.filter((pageIndex) => pageIndex < current).sort((a, b) => b - a);
      const after = neighbors.filter((pageIndex) => pageIndex > current).sort((a, b) => a - b);
      const same = neighbors.filter((pageIndex) => pageIndex === current);
      const candidates = scrollDirection === 'up'
        ? [...visiblePriority, ...before, ...same, ...after]
        : [...visiblePriority, ...after, ...same, ...before];
      queue = candidates.filter((pageIndex) => !running.has(pageIndex)
        && !ready.has(pageIndex) && !failed.has(pageIndex));
      return true;
    }

    function next() {
      if (destroyed || running.size >= concurrencyLimit) return null;
      const pageIndex = queue[0];
      if (!Number.isInteger(pageIndex)) return null;
      return { pageIndex, generation: currentGeneration };
    }

    function markRunning(job) {
      if (destroyed || !isCurrentJob(job) || running.size >= concurrencyLimit
          || running.has(job.pageIndex) || ready.has(job.pageIndex) || failed.has(job.pageIndex)) return false;
      const queueIndex = queue.indexOf(job.pageIndex);
      if (queueIndex < 0) return false;
      queue.splice(queueIndex, 1);
      running.set(job.pageIndex, currentGeneration);
      return true;
    }

    function markReady(job) {
      if (destroyed || !isCurrentJob(job) || running.get(job.pageIndex) !== currentGeneration) return false;
      running.delete(job.pageIndex);
      failed.delete(job.pageIndex);
      ready.delete(job.pageIndex);
      ready.set(job.pageIndex, ++sequence);
      return true;
    }

    function markFailed(job) {
      if (destroyed || !isCurrentJob(job) || running.get(job.pageIndex) !== currentGeneration) return false;
      running.delete(job.pageIndex);
      failed.set(job.pageIndex, { failedAsCurrent: job.pageIndex === activeCurrentPage });
      return true;
    }

    function markDeferred(job) {
      if (destroyed || !isCurrentJob(job) || running.get(job.pageIndex) !== currentGeneration) return false;
      running.delete(job.pageIndex);
      return true;
    }

    function evict(pageIndices) {
      if (destroyed) return [];
      const evicted = [];
      if (pageIndices != null) {
        for (const pageIndex of normalizedPages(pageIndices)) {
          if (visiblePages.has(pageIndex) || selectedPages.has(pageIndex) || !ready.has(pageIndex)) continue;
          ready.delete(pageIndex);
          evicted.push(pageIndex);
        }
        return evicted;
      }
      while (ready.size > frameLimit) {
        const victim = [...ready.entries()]
          .filter(([pageIndex]) => !visiblePages.has(pageIndex) && !selectedPages.has(pageIndex))
          .sort((left, right) => left[1] - right[1])[0];
        if (!victim) break;
        ready.delete(victim[0]);
        evicted.push(victim[0]);
      }
      return evicted;
    }

    function getState() {
      return {
        generation: currentGeneration,
        activeCount: running.size,
        queuedPages: queue.slice(),
        runningPages: [...running.keys()],
        readyPages: [...ready.keys()],
        failedPages: [...failed.keys()],
        bufferedPages: [...bufferedPages]
      };
    }

    function destroy() {
      destroyed = true;
      queue = [];
      running.clear();
      ready.clear();
      failed.clear();
      visiblePages.clear();
      bufferedPages.clear();
      selectedPages.clear();
    }

    return { update, next, markRunning, markReady, markFailed, markDeferred, evict, getState, destroy };
  }

  root.createPdfRenderScheduler = createPdfRenderScheduler;
})(window);
