/* BabyReader UI module: reader/pagination */

'use strict';

const DOUBLE_PAGE_MIN_WIDTH = 900;
// Centre seam. WeChat Reading web measures 98px between the two text columns
// at 1440x900 (column 457px, card padding 70px each side).
const DEFAULT_PAGE_GAP = 98;
const MIN_PAGE_WIDTH = 240;
// Body text must stop short of the floating toolbar. Folded into the right
// inset so the multicol track never runs underneath it.
const READER_TOOLBAR_RESERVE = 78;
// Paper card width, measured from WeChat Reading web across six viewports:
// card = min(0.8 x viewport, viewport - 220) -- 1280->1024, 1440->1152,
// 1600->1280, 1920->1536, 1100->876, 900->676. Our own ceiling keeps ultra
// wide lines from creeping back in.
const PAPER_WIDTH_RATIO = 0.9;
const PAPER_MIN_SIDE_GAP = 128;
// Expand the reading surface while preserving symmetric margins and comfortable
// line length. 1440px viewport the double-page card becomes 1296px wide.
const MAX_PAPER_WIDTH = { single: 700, double: 1344 };
// Symmetric outer margin for the paper card when the tool band isn't needed.
const MIN_OUTER_MARGIN = 40;
// Toolbar clearance on desktop (above mobile breakpoint).
const TOOLBAR_BAND = 40;
// Larger effective reading area: reduce the outer bands and internal vertical
// padding while keeping enough breathing room around chapter headings.
const READER_TOP_BAND = 56;
const READER_BOTTOM_BREATH = 40;
const PAPER_PAD_TOP = 64;
const PAPER_PAD_BOTTOM = 56;
// Hard floor so a short window still shows a usable column.
const MIN_VERTICAL_PADDING = 40;

function pageStep() {
  return state.effectiveReadingMode === 'double' ? 2 : 1;
}

function readingAreaWidth(reader = document.getElementById('reader')) {
  if (!reader) return 0;
  return Math.max(0, Math.floor(Number(reader.clientWidth) || 0));
}

function floorToDevicePixel(value, devicePixelRatio = window.devicePixelRatio || 1) {
  const scale = Math.max(1, Number(devicePixelRatio) || 1);
  return Math.floor(Math.max(0, value) * scale) / scale;
}

function createPaginationGeometry({
  readerWidth,
  readerHeight,
  mode,
  pageMargin = state.pageMargin,
  columnGap = DEFAULT_PAGE_GAP,
  devicePixelRatio = window.devicePixelRatio || 1
}) {
  // Insets live on the reader viewport (CSS), never on the multicol box:
  // padding on a multicol container applies once to the whole flow, which
  // shifts every column start and breaks spread alignment.
  const columns = mode === 'double' ? 2 : 1;
  const viewportWidth = Math.max(1, Math.floor(Number(readerWidth) || 0));
  const viewportHeight = Math.max(1, Math.floor(Number(readerHeight) || 0));
  const requestedMargin = Math.max(0, Number(pageMargin) || 0);
  const mobile = viewportWidth <= 800;
  // Inner text inset of the card. The user's margin slider (8..96, default 40)
  // maps onto the measured WeChat inset of 70px, so the default setting lands
  // on the baseline look and the slider still moves both ways.
  const columnPadding = mobile
    ? Math.max(16, Math.min(32, Math.round(requestedMargin * 0.8)))
    : Math.max(24, Math.min(96, Math.round(requestedMargin * 1.75)));
  // The gap between consecutive columns doubles as the paper's trailing inset:
  // column k+1 starts at padding + columns*(cw+gap). It must clear the paper's
  // right edge (2*padding + columns*cw + (columns-1)*gap), i.e. gap >= padding.
  // Single-page mode therefore requires gap >= padding as well — it's
  // invisible (only one column per view), but it prevents column 2 from
  // leaking into column 1's right margin.
  const naturalGap = columns === 2
    ? Math.max(columnPadding, Math.max(0, Number(columnGap) || DEFAULT_PAGE_GAP))
    : Math.max(columnPadding, 48);
  const gap = floorToDevicePixel(naturalGap, devicePixelRatio);
  const readableMin = columns * MIN_PAGE_WIDTH + gap * (columns - 1) + columnPadding * 2;
  // The floating toolbar only exists above the mobile breakpoint; below it the
  // controls move to the bottom bar and no right-edge clearance is needed.
  const toolbarClearance = viewportWidth > 800 ? TOOLBAR_BAND : MIN_OUTER_MARGIN;
  // Measured WeChat card width: 80% of the window, never closer than 110px to
  // either edge. Our own ceiling still applies on ultra-wide windows.
  const wechatPaper = Math.min(viewportWidth * PAPER_WIDTH_RATIO, viewportWidth - PAPER_MIN_SIDE_GAP);
  const paperCap = Math.min(MAX_PAPER_WIDTH[mode] || MAX_PAPER_WIDTH.single, wechatPaper);
  const desiredPaper = Math.max(
    Math.min(readableMin, viewportWidth - 2 * MIN_OUTER_MARGIN),
    Math.min(viewportWidth - 2 * MIN_OUTER_MARGIN, paperCap)
  );
  const paperWidth = Math.max(1, Math.min(desiredPaper, viewportWidth - 2 * toolbarClearance));
  // Perfectly symmetric margins: the paper is centred in the window, which is
  // what gives the page its WeChat-reading proportions.
  const inset = Math.max(0, Math.floor((viewportWidth - paperWidth) / 2));
  const insetLeftFinal = inset;
  const insetRightFinal = inset;
  const textWidth = Math.max(1, viewportWidth - inset * 2);
  // The content box is the paper card minus left/right padding (columnPadding).
  // With gap >= columnPadding, column 1 starts at position >= paperWidth, so it
  // never leaks into column 0's right margin.
  const contentWidth = Math.max(1, paperWidth - columnPadding * 2);
  const columnWidth = Math.max(1, floorToDevicePixel((contentWidth - gap * (columns - 1)) / columns, devicePixelRatio));
  // One spread of continuous columns. The next page group starts exactly at
  // spreadWidth + gap, so stepping by pageStepWidth * columns is guaranteed
  // to be column-aligned forever.
  const spreadWidth = columnWidth * columns + gap * (columns - 1);
  // Vertical rhythm from the baseline: a 72px band above the card, a 58px
  // breath below it, then 84px / 70px of air inside the card. Both shrink on
  // short windows instead of squeezing the column to nothing.
  const bandTop = viewportHeight >= 560 ? READER_TOP_BAND : Math.round(viewportHeight * 0.08);
  const bandBottom = viewportHeight >= 560 ? READER_BOTTOM_BREATH : Math.round(viewportHeight * 0.07);
  const cardHeight = Math.max(200, viewportHeight - bandTop - bandBottom);
  const blockBudget = Math.max(0, cardHeight - 240);
  const padTop = Math.max(MIN_VERTICAL_PADDING, Math.min(PAPER_PAD_TOP, Math.round(blockBudget * 0.52)));
  const padBottom = Math.max(MIN_VERTICAL_PADDING, Math.min(PAPER_PAD_BOTTOM, Math.round(blockBudget * 0.44)));
  const verticalPadding = padTop;
  const pageHeight = Math.max(1, floorToDevicePixel(cardHeight - padTop - padBottom, devicePixelRatio));

  // Advance for one full page group. NEVER use viewportWidth here: the
  // multicol container is exactly spreadWidth wide (no padding), so the
  // browser places every new column on a k*(columnWidth + gap) grid.
  const pageGroupWidth = columnWidth * columns + gap * columns;

  return Object.freeze({
    columns,
    viewportWidth,
    viewportHeight,
    paperWidth: spreadWidth + columnPadding * 2,
    columnPadding,
    verticalPadding,
    padTop,
    padBottom,
    bandTop,
    bandBottom,
    insetLeft: insetLeftFinal,
    insetRight: insetRightFinal,
    columnGap: gap,
    columnWidth,
    spreadWidth,
    pageStepWidth: columnWidth + gap,
    pageGroupWidth,
    pageHeight,
    trailingSafety: Math.max(0, textWidth - spreadWidth)
  });
}

function paginationInsetStyle(reader, geometry) {
  // The insets belong to the reader viewport, so the custom properties must
  // be declared on (or above) the reader — custom properties inherit
  // downwards only.
  reader.style.setProperty('--reader-inset-left', `${geometry.insetLeft}px`);
  reader.style.setProperty('--reader-inset-right', `${geometry.insetRight}px`);
}

function resolveEffectiveReadingMode(width = readingAreaWidth()) {
  if (state.readingMode !== 'double') return state.readingMode;
  return width >= DOUBLE_PAGE_MIN_WIDTH ? 'double' : 'single';
}

function pageGroupForPage(pageNumber, step = pageStep()) {
  const normalizedPage = Math.max(1, Math.floor(Number(pageNumber) || 1));
  return Math.floor((normalizedPage - 1) / Math.max(1, step));
}

function clampPageGroup(group) {
  return Math.max(0, Math.min(Math.max(0, state.pageGroupCount - 1), Math.round(Number(group) || 0)));
}

function pageLeftForGroup(group, pageGroupWidth = state.pageGroupWidth) {
  const step = Math.max(1, Number(pageGroupWidth) || 1);
  return clampPageGroup(group) * step;
}

function applyPagedOffset(article, left) {
  // Instant positioning only. Smooth scrolling inside heavy EPUB DOM (or a
  // slow fnOS iframe) is exactly where a page turn "looks" dead: buttons
  // update and the animation never visibly lands. WeChat-reading-like paging
  // here is quantized and immediate.
  // ScrollLeft ONLY: the article is now the centred paper card, so a
  // translateX fallback would slide the whole card off-centre. scrollLeft on
  // an overflow:hidden multicol box is verified working in the target browser.
  state.pageOffset = left;
  article.scrollLeft = left;
}

function pagedLogicalLeft(article, target) {
  const articleRect = article.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const delta = targetRect.left - articleRect.left;
  // The article border box is stable and children shift by scrollLeft, so the
  // offset must be added back to get the absolute track position.
  return state.pageOffset + delta;
}

function setPageGroup(group, { behavior = 'auto', save = false } = {}) {
  const reader = document.getElementById('reader');
  const article = document.getElementById('article');
  if (!reader || !article || state.effectiveReadingMode === 'scroll') return false;

  const nextGroup = clampPageGroup(group);
  const left = pageLeftForGroup(nextGroup);
  state.pageGroup = nextGroup;
  state.pageNumber = Math.min(state.pageCount, nextGroup * pageStep() + 1);
  applyPagedOffset(article, left);
  reader.scrollLeft = 0;
  reader.scrollTop = 0;
  updatePaginationControls();
  if (save) saveTextScroll();
  requestAnimationFrame(redrawDomHighlights);

  // Self-heal: never needed — scrollLeft on the article card works reliably.
  return true;
}

function snapPaginationToNearestGroup({ save = true } = {}) {
  const reader = document.getElementById('reader');
  const article = document.getElementById('article');
  if (!reader || !article || state.effectiveReadingMode === 'scroll') return false;
  const step = Math.max(1, state.pageGroupWidth || reader.clientWidth || 1);
  return setPageGroup(Math.round(state.pageOffset / step), { behavior: 'auto', save });
}

function pageNumberForElement(target) {
  const article = document.getElementById('article');
  if (!article || !target) return 1;
  const step = Math.max(1, state.pageStepWidth || state.columnWidth + state.columnGap || 1);
  const articleRect = article.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  // The article box is stable while its children shift left by the page
  // offset, so the absolute track position is offset + rect delta.
  const logicalLeft = pagedLogicalLeft(article, target);
  return Math.max(1, Math.min(state.pageCount, Math.floor((logicalLeft + 0.01) / step) + 1));
}

function navigateToSemanticTarget(target, { behavior = 'auto' } = {}) {
  if (!target) return false;
  if (state.effectiveReadingMode === 'scroll') {
    target.scrollIntoView({ block: 'start', behavior });
    return true;
  }
  return setPageGroup(pageGroupForPage(pageNumberForElement(target)), { behavior, save: true });
}

function updatePaginationControls() {
  const paged = state.effectiveReadingMode !== 'scroll';
  const previous = document.getElementById('btnPreviousPage');
  const next = document.getElementById('btnNextPage');
  const status = document.getElementById('paginationStatus');
  const mobilePrevious = document.getElementById('btnMobilePreviousPage');
  const mobileNext = document.getElementById('btnMobileNextPage');
  const atStart = state.pageGroup <= 0;
  const atEnd = state.pageGroup >= Math.max(0, state.pageGroupCount - 1);

  if (previous) {
    previous.hidden = !paged || state.contentType !== 'epub';
    previous.disabled = atStart;
  }
  if (next) {
    next.hidden = !paged || state.contentType !== 'epub';
    next.disabled = atEnd;
  }
  if (mobilePrevious) mobilePrevious.disabled = !paged || atStart;
  if (mobileNext) mobileNext.disabled = !paged || atEnd;
  if (status) {
    status.hidden = !paged || state.contentType !== 'epub';
    status.textContent = paged
      ? `${state.pageNumber}-${Math.min(state.pageCount, state.pageNumber + pageStep() - 1)} / ${state.pageCount}`
      : '';
  }
}

function measureColumnTrackWidth(article, geometry) {
  const columnPitch = Math.max(1, geometry.columnWidth + geometry.columnGap);
  let track = geometry.spreadWidth;
  // 1) Layout-derived ground truth: where the last chapter actually ends in
  //    the column track. It is available as soon as chapters are laid out and
  //    does not race the multicol overflow becoming measurable.
  const chapters = article.querySelectorAll('.epub-chapter');
  const last = chapters[chapters.length - 1];
  if (last) {
    const articleRect = article.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();
    const extent = lastRect.right - articleRect.left;
    if (Number.isFinite(extent) && extent > 0) track = Math.max(track, extent);
  }
  // 2) The multicol box is its own scroll container, so scrollWidth covers the
  //    whole track too; take the larger of the two.
  if (Number.isFinite(article.scrollWidth) && article.scrollWidth > 0) {
    track = Math.max(track, article.scrollWidth);
  }
  const totalColumns = Math.max(geometry.columns, Math.round((track + geometry.columnGap) / columnPitch));
  return { track, totalColumns };
}

function measurePagination({ preserveLocator = true } = {}) {
  const reader = document.getElementById('reader');
  const article = document.getElementById('article');
  if (!reader || !article) return;

  const locator = preserveLocator && state.currentPath && state.contentType === 'epub'
    ? currentReadingLocator(reader)
    : null;
  state.effectiveReadingMode = resolveEffectiveReadingMode(readingAreaWidth(reader));
  state.continuousScroll = state.readingMode === 'scroll';

  document.body.dataset.readingMode = state.readingMode;
  document.body.dataset.effectiveReadingMode = state.effectiveReadingMode;
  document.body.classList.toggle('continuous-scroll', state.effectiveReadingMode === 'scroll');
  document.body.classList.toggle('paged-reading', state.effectiveReadingMode !== 'scroll');
  document.body.classList.toggle('single-page-reading', state.effectiveReadingMode === 'single');
  document.body.classList.toggle('double-page-reading', state.effectiveReadingMode === 'double');

  if (state.effectiveReadingMode === 'scroll') {
    for (const property of [
      '--reader-column-count',
      '--reader-column-width',
      '--reader-column-gap',
      '--reader-page-height',
      '--reader-horizontal-padding',
      '--reader-vertical-padding',
      '--reader-spread-width'
    ]) article.style.removeProperty(property);
    for (const property of ['--reader-inset-left', '--reader-inset-right']) {
      reader.style.removeProperty(property);
    }
    delete article.dataset.paginationGeometry;
    delete article.dataset.paginationStep;
    article.style.removeProperty('transform');
    state.pageOffset = 0;
    reader.scrollLeft = 0;
    article.scrollLeft = 0;
    state.columnWidth = 0;
    state.columnGap = 0;
    state.pageStepWidth = 0;
    state.pageGroupWidth = 0;
    state.pageHeight = 0;
    state.paginationGeometry = null;
    state.pageNumber = 1;
    state.pageCount = 1;
    state.pageGroup = 0;
    state.pageGroupCount = 1;
    updatePaginationControls();
    if (locator) restoreReadingLocator(locator);
    requestAnimationFrame(redrawDomHighlights);
    return;
  }

  const geometry = createPaginationGeometry({
    readerWidth: reader.clientWidth,
    readerHeight: reader.clientHeight,
    mode: state.effectiveReadingMode,
    pageMargin: state.pageMargin,
    columnGap: DEFAULT_PAGE_GAP,
    devicePixelRatio: window.devicePixelRatio || 1
  });
  state.paginationGeometry = geometry;
  state.columnWidth = geometry.columnWidth;
  state.columnGap = geometry.columnGap;
  state.pageStepWidth = geometry.pageStepWidth;
  state.pageGroupWidth = geometry.pageGroupWidth;
  state.pageHeight = geometry.pageHeight;

  article.style.setProperty('--reader-column-count', String(geometry.columns));
  article.style.setProperty('--reader-column-width', `${geometry.columnWidth}px`);
  article.style.setProperty('--reader-column-gap', `${geometry.columnGap}px`);
  article.style.setProperty('--reader-page-height', `${geometry.pageHeight}px`);
  // Card geometry: the article box is the paper, its inline padding is the
  // text inset, and --reader-spread-width stays the pure column track so the
  // alignment invariants (and tests) keep a single source of truth.
  article.style.setProperty('--reader-spread-width', `${geometry.spreadWidth}px`);
  article.style.setProperty('--reader-paper-width', `${geometry.paperWidth}px`);
  article.style.setProperty('--reader-paper-padding', `${geometry.columnPadding}px`);
  article.style.setProperty('--reader-paper-padding-top', `${geometry.padTop}px`);
  article.style.setProperty('--reader-paper-padding-bottom', `${geometry.padBottom}px`);
  paginationInsetStyle(reader, geometry);
  // Vertical bands live on the reader to give the fixed breathing above/below
  // the card, matching the measured baseline (72/58).
  reader.style.setProperty('--reader-band-top', `${geometry.bandTop}px`);
  reader.style.setProperty('--reader-band-bottom', `${geometry.bandBottom}px`);
  // Live-geometry diagnostics: mirror the numbers the layout was computed
  // from so fnOS field screenshots (or a pasted data-* dump) pin down any
  // remaining viewport vs columnWidth mismatch without guessing.
  article.dataset.paginationGeometry =
    `mode=${state.effectiveReadingMode};vw=${geometry.viewportWidth};` +
    `cols=${geometry.columns};col=${geometry.columnWidth};gap=${geometry.columnGap};` +
    `spread=${geometry.spreadWidth};step=${geometry.pageStepWidth};` +
    `group=${geometry.pageGroupWidth};inset=${geometry.insetLeft}/${geometry.insetRight}`;
  article.dataset.paginationStep = String(geometry.pageGroupWidth);

  // The multicol track only exists after the browser has fragmented the
  // content, which can land a frame or two after the classes are applied.
  // Reading it once, too early, froze pageCount at 1: the page buttons then
  // stayed hidden/disabled and every page turn silently returned false.
  // Converge here, and never depend on a single rAF: rAF is throttled in a
  // background tab, so a timer backs it up.
  let settleAttempts = 0;
  let lastColumns = -1;
  const finalizePagination = () => {
    if (locator) restoreReadingLocator(locator);
    state.pageGroup = Math.max(0, Math.min(state.pageGroupCount - 1, pageGroupForPage(state.pageNumber)));
    state.pageNumber = Math.min(state.pageCount, state.pageGroup * geometry.columns + 1);
    applyPagedOffset(article, pageLeftForGroup(state.pageGroup, geometry.pageGroupWidth));
    reader.scrollLeft = 0;
    reader.scrollTop = 0;
    updatePaginationControls();
    redrawDomHighlights();
  };
  const settlePagination = () => {
    if (state.effectiveReadingMode === 'scroll') return;
    const { track, totalColumns } = measureColumnTrackWidth(article, geometry);
    state.pageCount = totalColumns;
    state.pageGroupCount = Math.max(1, Math.ceil(totalColumns / geometry.columns));
    article.dataset.paginationTrack = `w=${Math.round(track)};cols=${totalColumns};groups=${state.pageGroupCount}`;
    settleAttempts += 1;
    if (totalColumns !== lastColumns && settleAttempts < 6) {
      lastColumns = totalColumns;
      let done = false;
      const once = () => { if (done) return; done = true; settlePagination(); };
      requestAnimationFrame(once);
      setTimeout(once, 60);
      return;
    }
    finalizePagination();
  };
  observePaginationSettle(settlePagination);
  settlePagination();
}

// One observer for the life of the page: late web fonts, images and window
// resizes all change the column track, and the page count has to follow.
let _paginationSettleObserver = null;
let _paginationSettleHandler = null;
function observePaginationSettle(handler) {
  _paginationSettleHandler = handler;
  const article = document.getElementById('article');
  if (!article || typeof ResizeObserver !== 'function' || _paginationSettleObserver) return;
  _paginationSettleObserver = new ResizeObserver(() => {
    if (state.effectiveReadingMode === 'scroll') return;
    const article = document.getElementById('article');
    if (!article) return;
    const recorded = Number((article.dataset.paginationTrack || '').match(/cols=(\d+)/)?.[1] || 0);
    const geometry = state.paginationGeometry;
    if (!geometry) return;
    const { totalColumns } = measureColumnTrackWidth(article, geometry);
    if (totalColumns !== recorded) _paginationSettleHandler?.();
  });
  _paginationSettleObserver.observe(article);
}

function setReadingMode(mode, { persist = true, preserveLocator = true } = {}) {
  // Only two user-selectable modes: scroll and double. (single is responsive fallback)
  if (!['scroll', 'double', 'single'].includes(mode)) return false;
  state.readingMode = mode === 'single' ? 'double' : mode;
  state.continuousScroll = state.readingMode === 'scroll';
  measurePagination({ preserveLocator });
  syncSettingsPanel();
  if (persist) persistUserSettings();
  return true;
}

function navigatePageGroup(delta) {
  if (state.effectiveReadingMode === 'scroll' || !Number.isInteger(delta) || delta === 0) return false;
  const target = state.pageGroup + Math.sign(delta);
  if (target < 0 || target >= state.pageGroupCount) return false;
  return setPageGroup(target, { save: true });
}

function applyContinuousScroll() {
  const migratedMode = state.continuousScroll ? 'scroll' : 'double';
  if (!['scroll', 'double'].includes(state.readingMode)) state.readingMode = migratedMode;
  measurePagination({ preserveLocator: false });
}
