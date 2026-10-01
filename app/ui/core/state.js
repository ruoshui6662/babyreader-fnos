/* 枕书 UI module: core/state */

'use strict';

/* --- State --- */
const state = {
  mode: 'read',        // 'read' | 'edit'
  theme: 'dark',       // 'dark' | 'light'
  currentBookId: null,
  currentPath: null,
  currentName: null,
  content: '',
  epubArchive: null,
  epubChapterIndex: 0,
  epubChapterCount: 0,
  epubHtml: '',
  epubChapters: [],
  epubRenderPending: false,
  epubChapterLoading: false,
  epubDiagnostics: null,
  toc: [],
  tocOpen: false,
  epubBook: null,
  epubRendition: null,
  contentType: 'text', // 'text' | 'epub' | 'pdf'
  dirty: false,
  session: null,
  userState: { version: 2, books: {}, settings: {} },
  readingMode: 'scroll',       // user preference: 'scroll' | 'double' ('single' is only the narrow-window fallback)
  pdfLayoutMode: 'continuous', // independent PDF preference: continuous | single | double
  readingModeAutoApplied: false, // mobile default is temporary until the user chooses a mode
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
  fontFamily: 'source-serif',  // see FONT_STACKS; persisted as settings.readerFont
  currentChapterIndex: 0,
  chapterPaths: [],
  library: null
};

/* --- Browser Host API --- */
const API_PREFIX = '/app/zhenshu/api';

// Body-font choices. Every stack ends in a generic family so a missing CJK
// serif degrades to the platform's own 宋体-class face instead of a blank.
// Bundled fonts (app/ui/vendor/fonts, all SIL OFL 1.1) look the same on every
// device; the two system stacks only name fonts already on the reader's
// device, so nothing is redistributed for them. Literata leads the serif
// stacks for Latin text; it has no CJK glyphs, so Chinese falls through.
const FONT_STACKS = Object.freeze({
  'source-serif': '"Literata", "Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", serif',
  'wenkai': '"LXGW WenKai", "Literata", "KaiTi", "STKaiti", serif',
  'fangsong': '"Literata", "Zhuque Fangsong", "FangSong", "STFangsong", serif',
  'sans': '-apple-system, "PingFang SC", "Helvetica Neue", "Noto Sans SC", "Microsoft YaHei", sans-serif',
  'songti': '"SimSun", "STSong", "Songti SC", "宋体", serif'
});
const DEFAULT_READER_FONT = 'source-serif';
// Stylesheets each reading font needs (vendor/fonts/<folder>/font.css).
const FONT_STYLESHEETS = Object.freeze({
  'source-serif': ['literata', 'noto-serif-sc'],
  'wenkai': ['lxgw-wenkai', 'literata'],
  'fangsong': ['literata', 'zhuque-fangsong'],
  'sans': [],
  'songti': []
});
