'use strict';

// Runs one MOBI→EPUB conversion inside a resource-limited worker so a hostile
// or huge book can only exhaust this thread, never the reader service.

const { parentPort, workerData } = require('node:worker_threads');
const { convertMobiToEpub } = require('./mobi-convert');

(async () => {
  try {
    const epub = await convertMobiToEpub(new Uint8Array(workerData.sourceBytes), {
      identifier: workerData.identifier,
      limits: workerData.limits
    });
    const output = epub.buffer.byteLength === epub.byteLength ? epub.buffer : epub.slice().buffer;
    parentPort.postMessage({ ok: true, epub: output }, [output]);
  } catch (error) {
    parentPort.postMessage({ ok: false, code: String(error?.code || 'CONVERSION_FAILED'), message: String(error?.message || error) });
  }
})();
