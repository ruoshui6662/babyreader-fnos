/* 枕书 UI module: library/shelf-nav */

'use strict';

/*
 * The shelf has three pages: 书库 (the library), 阅读统计 and 笔记. A left
 * rail on desktops (icons only in narrow windows) and a bottom tab bar on
 * phones switch between them; the reading page never shows either.
 *
 * The page lives in the URL (?view=stats / ?view=notes; none for the
 * library), so refresh and the back button keep their place, and returning
 * from a book lands on the page it was opened from.
 */

const SHELF_VIEWS = Object.freeze({
  library: {
    label: '书库',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h3v16H5zM10 4h3v16h-3z"></path><path d="m15.4 5.3 2.9-.8 3.9 15-2.9.8z"></path></svg>'
  },
  stats: {
    label: '阅读统计',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"></path><path d="M7 16v-5M12 16V6M17 16v-8"></path></svg>'
  },
  notes: {
    label: '笔记',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h9l3.5 3.5v13.5H6z"></path><path d="M14.5 3.5V7.5h4"></path><path d="M9 12h6M9 15.5h6"></path></svg>'
  }
});

let currentShelfView = 'library';

function shelfViewFromLocation(href = window.location.href) {
  try {
    const view = new URL(href).searchParams.get('view');
    return Object.hasOwn(SHELF_VIEWS, view || '') ? view : 'library';
  } catch {
    return 'library';
  }
}

function shelfViewUrl(view, href = window.location.href) {
  const url = new URL(href);
  if (view === 'library') url.searchParams.delete('view');
  else url.searchParams.set('view', view);
  url.searchParams.delete('book');
  return `${url.pathname}${url.search}${url.hash}`;
}

function ensureShelfNav() {
  let nav = document.getElementById('shelfNav');
  if (nav) return nav;
  nav = document.createElement('nav');
  nav.id = 'shelfNav';
  nav.className = 'shelf-nav';
  nav.setAttribute('aria-label', '书架导航');
  for (const [view, { label, icon }] of Object.entries(SHELF_VIEWS)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shelf-nav-button';
    button.dataset.shelfView = view;
    button.title = label;
    button.innerHTML = `${icon}<span class="shelf-nav-label">${label}</span>`;
    button.addEventListener('click', () => {
      if (view === currentShelfView && document.body.classList.contains('is-library')) return;
      void showShelfView(view, { push: true });
    });
    nav.appendChild(button);
  }
  document.body.appendChild(nav);
  return nav;
}

function syncShelfNav(view = currentShelfView) {
  currentShelfView = view;
  const nav = ensureShelfNav();
  nav.querySelectorAll('[data-shelf-view]').forEach((button) => {
    const active = button.dataset.shelfView === view;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.body.dataset.shelfView = view;
}

async function loadShelfLibrary(loaded = null) {
  const library = loaded || await window.browserHost.getLibrary();
  if (!library.organization && library?.features?.libraryOrganization === true
      && typeof window.browserHost.getLibraryOrganization === 'function') {
    try {
      library.organization = await window.browserHost.getLibraryOrganization();
    } catch { /* The flat shelf still works. */ }
  }
  return library;
}

// Pages other than the library are filled by their own modules (S2/S3);
// until then they show their title and what will appear there.
const SHELF_PAGE_RENDERERS = {};

function renderShelfPlaceholder(view) {
  const article = typeof prepareLibrarySurface === 'function' ? prepareLibrarySurface() : null;
  if (!article) return null;
  const shell = document.createElement('section');
  shell.className = `library-view shelf-page shelf-page-${view}`;
  shell.dataset.shelfPage = view;
  const header = document.createElement('div');
  header.className = 'library-header';
  const heading = document.createElement('div');
  heading.className = 'library-heading';
  const title = document.createElement('h1');
  title.textContent = SHELF_VIEWS[view].label;
  const summary = document.createElement('p');
  summary.className = 'library-summary';
  summary.textContent = view === 'stats'
    ? '阅读时长、读过和读完的书、每日阅读与最近笔记'
    : '每本书的划线与想法汇总，可打开、导出与生成图片';
  heading.append(title, summary);
  header.appendChild(heading);
  shell.appendChild(header);
  article.appendChild(shell);
  return shell;
}

// Shows one shelf page. `library` (already loaded) avoids a second fetch.
async function showShelfView(view, { push = false, library = null } = {}) {
  const next = Object.hasOwn(SHELF_VIEWS, view) ? view : 'library';
  if (push && window.history?.pushState) {
    window.history.pushState({ ...(window.history.state || {}), shelfView: next }, '', shelfViewUrl(next));
  } else if (window.history?.replaceState && shelfViewFromLocation() !== next) {
    window.history.replaceState({ ...(window.history.state || {}), shelfView: next }, '', shelfViewUrl(next));
  }
  syncShelfNav(next);
  if (next === 'library') {
    renderLibrary(await loadShelfLibrary(library));
  } else if (typeof SHELF_PAGE_RENDERERS[next] === 'function') {
    await SHELF_PAGE_RENDERERS[next]({ library });
  } else {
    renderShelfPlaceholder(next);
  }
  syncShelfNav(next);
  return next;
}

function setupShelfNav() {
  if (window.__zhenshuShelfNavReady) return;
  window.__zhenshuShelfNavReady = true;
  ensureShelfNav();
  currentShelfView = shelfViewFromLocation();
  // Back/forward between shelf pages. Inside the library, organize-mode
  // routes are handled by library/organization.js.
  window.addEventListener('popstate', () => {
    if (!document.body.classList.contains('is-library')) return;
    const view = shelfViewFromLocation();
    if (view === currentShelfView) return;
    void showShelfView(view);
  });
}
