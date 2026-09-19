/* BabyReader UI module: core/state */

'use strict';

/* --- State --- */
const state = {
  mode: 'read',        // 'read' | 'edit'
  theme: 'dark',       // 'dark' | 'light'
  currentBookId: null,
  currentPath: null,
  currentName: null,
  content: '',
  epubHtml: '',
  toc: [],
  tocOpen: true,
  epubBook: null,
  epubRendition: null,
  contentType: 'text', // 'text' | 'epub'
  dirty: false,
  session: null,
  userState: { version: 2, books: {}, settings: {} },
  readingMode: 'scroll',       // user preference: 'scroll' | 'double' ('single' is only the narrow-window fallback)
  effectiveReadingMode: 'scroll', // responsive mode after width-based fallback
  continuousScroll: true,     // legacy mirror retained for settings migration
  pageNumber: 1,
  pageCount: 1,
  columnWidth: 0,
  columnGap: 0,
  pageStepWidth: 0,
  pageGroupWidth: 0,
  pageHeight: 0,
  pageGroup: 0,
  pageGroupCount: 1,
  paginationGeometry: null,
  pageOffset: 0,                // current paged track offset in px
  paginationUsesTransform: false, // kept only for settings-shape compat; paging is always scrollLeft now
  lineHeight: 1.9,
  pageMargin: 40,
  highlightColor: 'yellow',
  // Reading typography (P0). Indent is in em (0 = flush); font is a stack key;
  // theme is the background mode ('dark' | 'light' | 'sepia').
  textIndent: 2,
  paragraphSpacing: 1.1,
  fontFamily: 'sans',          // 'sans' | 'songti' | 'source-serif'
  currentChapterIndex: 0,
  chapterPaths: [],
  library: null
};

/* --- Browser Host API --- */
const API_PREFIX = '/app/babyreader-fnos/api';

// Body-font choices. Every stack ends in a generic family so a missing CJK
// serif degrades to the platform's own 宋体-class face instead of a blank.
const FONT_STACKS = Object.freeze({
  'sans': '-apple-system, "PingFang SC", "Helvetica Neue", "Noto Sans SC", "Microsoft YaHei", sans-serif',
  'songti': '"SimSun", "STSong", "Songti SC", "宋体", serif',
  'source-serif': '"Noto Serif SC", "Source Han Serif SC", "Source Han Serif CN", "思源宋体", "SimSun", "Songti SC", serif'
});
