/* PDF covers are derived lazily in the browser; scanning never renders PDF pages. */
'use strict';

const PDF_COVER_ASSET_ROOT = '/app/zhenshu/vendor/pdfjs/';
const PDF_COVER_EDGE_LIMIT = 384;
const PDF_COVER_PIXEL_LIMIT = 160000;
const PDF_COVER_CACHE_LIMIT = 32;
const pdfCoverCache = new Map();
const pdfCoverJobs = new WeakMap();
const pdfCoverQueue = [];
let pdfCoverWorker = null;
let pdfCoverBusy = false;
let pdfCoverApiPromise = null;

function showPdfLibraryCover(placeholder, dataUrl) {
  if (!placeholder.isConnected || !placeholder.parentElement) return;
  const image = document.createElement('img');
  image.className = 'library-book-cover';
  image.alt = '';
  image.draggable = false;
  image.src = dataUrl;
  placeholder.replaceWith(image);
}

async function renderPdfLibraryCover(book) {
  pdfCoverApiPromise ||= import(`${PDF_COVER_ASSET_ROOT}build/pdf.mjs`);
  const pdfjs = await pdfCoverApiPromise;
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDF_COVER_ASSET_ROOT}build/pdf.worker.mjs`;
  const loadingTask = pdfjs.getDocument({
    url: `/app/zhenshu/api/books/${encodeURIComponent(book.id)}/content`,
    rangeChunkSize: 64 * 1024,
    disableAutoFetch: true,
    disableStream: true,
    isEvalSupported: false,
    enableScripting: false,
    enableXfa: false,
    useWorkerFetch: false,
    cMapUrl: `${PDF_COVER_ASSET_ROOT}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDF_COVER_ASSET_ROOT}standard_fonts/`,
    wasmUrl: `${PDF_COVER_ASSET_ROOT}wasm/`,
    iccUrl: `${PDF_COVER_ASSET_ROOT}iccs/`,
    imageResourcesPath: `${PDF_COVER_ASSET_ROOT}image_decoders/`
  });
  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages < 1) throw new Error('PDF has no pages');
    const page = await pdf.getPage(1);
    const source = page.getViewport({ scale: 1 });
    if (!Number.isFinite(source.width) || !Number.isFinite(source.height)
        || source.width <= 0 || source.height <= 0) throw new Error('Invalid PDF cover page');
    const scale = Math.min(
      (152 * Math.min(2, window.devicePixelRatio || 1)) / source.width,
      PDF_COVER_EDGE_LIMIT / Math.max(source.width, source.height),
      Math.sqrt(PDF_COVER_PIXEL_LIMIT / (source.width * source.height))
    );
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas unavailable for PDF cover');
    await page.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    page.cleanup?.();
    return dataUrl;
  } finally {
    await loadingTask.destroy();
  }
}

async function drainPdfLibraryCovers() {
  if (pdfCoverBusy) return;
  pdfCoverBusy = true;
  try {
    while (pdfCoverQueue.length) {
      const { book, placeholder } = pdfCoverQueue.shift();
      if (!placeholder.isConnected) continue;
      const key = `${book.id}:${book.fingerprint || ''}`;
      let dataUrl = pdfCoverCache.get(key);
      if (!dataUrl) {
        try {
          dataUrl = await renderPdfLibraryCover(book);
        } catch {
          // A corrupt or inaccessible PDF retains the neutral book placeholder.
          continue;
        }
        pdfCoverCache.set(key, dataUrl);
        if (pdfCoverCache.size > PDF_COVER_CACHE_LIMIT) {
          pdfCoverCache.delete(pdfCoverCache.keys().next().value);
        }
      }
      showPdfLibraryCover(placeholder, dataUrl);
    }
  } finally {
    pdfCoverBusy = false;
  }
}

function requestPdfLibraryCover(book, placeholder) {
  if (book?.type !== 'pdf' || book.coverUrl || !placeholder) return;
  const key = `${book.id}:${book.fingerprint || ''}`;
  const cached = pdfCoverCache.get(key);
  if (cached) {
    // Cards are built detached and appended by the library renderer afterward.
    queueMicrotask(() => showPdfLibraryCover(placeholder, cached));
    return;
  }
  if (typeof IntersectionObserver !== 'function') {
    pdfCoverQueue.push({ book, placeholder });
    void drainPdfLibraryCovers();
    return;
  }
  if (!pdfCoverWorker) {
    pdfCoverWorker = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.target.isConnected) {
          pdfCoverWorker.unobserve(entry.target);
          pdfCoverJobs.delete(entry.target);
          continue;
        }
        if (!entry.isIntersecting) continue;
        pdfCoverWorker.unobserve(entry.target);
        const job = pdfCoverJobs.get(entry.target);
        pdfCoverJobs.delete(entry.target);
        if (job) pdfCoverQueue.push(job);
      }
      void drainPdfLibraryCovers();
    }, { rootMargin: '200px' });
  }
  pdfCoverJobs.set(placeholder, { book, placeholder });
  pdfCoverWorker.observe(placeholder);
}

window.requestPdfLibraryCover = requestPdfLibraryCover;
