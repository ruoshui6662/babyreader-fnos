/* 枕书 UI module: library/notes-page */

'use strict';

/*
 * 笔记 (shelf page). The list shows one note document per book that has
 * highlights or thoughts, plus a document of everything; search looks
 * through all notes. A document lists a book's notes in reading order under
 * their chapter (or PDF page), each one jumps back to the passage.
 * Notes are edited in the reader; this page only shows them.
 */

const notesPageState = {
  query: '',
  sort: 'updated',
  focusNoteId: null
};

const NOTE_COLORS = ['yellow', 'green', 'blue', 'pink'];

function notesElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatNotesDate(iso, { withTime = false } = {}) {
  const time = new Date(iso);
  if (!Number.isFinite(time.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  const sameYear = time.getFullYear() === new Date().getFullYear();
  const day = `${sameYear ? '' : `${time.getFullYear()}年`}${time.getMonth() + 1}月${time.getDate()}日`;
  return withTime ? `${day} ${pad(time.getHours())}:${pad(time.getMinutes())}` : day;
}

function openNotesDocument(doc, { focusNoteId = null } = {}) {
  notesPageState.focusNoteId = focusNoteId;
  void showShelfView('notes', { push: true, doc });
}

function notesCover(book) {
  const cover = typeof createStatsCover === 'function'
    ? createStatsCover(book)
    : notesElement('span', 'library-book-cover');
  cover.classList.add('notes-cover');
  return cover;
}

function notesShell(title, summaryText) {
  const shell = renderShelfPlaceholder('notes');
  if (!shell) return null;
  shell.querySelector('h1').textContent = title;
  shell.querySelector('.library-summary').textContent = summaryText;
  return shell;
}

function sortNoteBooks(books) {
  const sorted = books.slice();
  if (notesPageState.sort === 'count') sorted.sort((left, right) => right.count - left.count);
  else if (notesPageState.sort === 'title') sorted.sort((left, right) => String(left.title || '').localeCompare(String(right.title || ''), 'zh-CN'));
  return sorted;
}

function createNoteBookCard(book) {
  const card = notesElement('button', 'notes-book-card');
  card.type = 'button';
  card.dataset.bookId = book.bookId;
  card.addEventListener('click', () => openNotesDocument(book.bookId));
  const body = notesElement('span', 'notes-book-body');
  body.appendChild(notesElement('span', 'notes-book-title', book.title || '已移除的书'));
  if (book.author) body.appendChild(notesElement('span', 'notes-book-author', book.author));
  const chips = notesElement('span', 'notes-book-chips');
  chips.appendChild(notesElement('span', 'notes-chip', `${book.count} 条笔记`));
  if (book.thoughtCount) chips.appendChild(notesElement('span', 'notes-chip', `${book.thoughtCount} 条想法`));
  body.appendChild(chips);
  const meta = [book.updatedAt ? `更新于 ${formatNotesDate(book.updatedAt)}` : '', book.seconds >= 60 ? `阅读 ${formatReadingDuration(book.seconds)}` : '']
    .filter(Boolean).join(' · ');
  if (meta) body.appendChild(notesElement('span', 'notes-book-meta', meta));
  card.append(notesCover(book), body);
  return card;
}

function createAllNotesCard(summary) {
  const card = notesElement('button', 'notes-book-card notes-all-card');
  card.type = 'button';
  card.addEventListener('click', () => openNotesDocument('all'));
  const preview = notesElement('span', 'notes-doc-preview');
  preview.setAttribute('aria-hidden', 'true');
  preview.appendChild(notesElement('strong', '', '笔记汇总'));
  for (const width of [100, 92, 100, 70, 86]) {
    const line = notesElement('i');
    line.style.width = `${width}%`;
    preview.appendChild(line);
  }
  const body = notesElement('span', 'notes-book-body');
  body.appendChild(notesElement('span', 'notes-book-title', '全部笔记汇总'));
  body.appendChild(notesElement('span', 'notes-book-author', '所有书的划线与想法，按书和章节整理'));
  const chips = notesElement('span', 'notes-book-chips');
  chips.append(notesElement('span', 'notes-chip', `${summary.totals.books} 本书`), notesElement('span', 'notes-chip', `${summary.totals.notes} 条笔记`));
  body.appendChild(chips);
  if (summary.updatedAt) body.appendChild(notesElement('span', 'notes-book-meta', `最后更新 ${formatNotesDate(summary.updatedAt, { withTime: true })}`));
  card.append(preview, body);
  return card;
}

function highlightQuery(element, text, query) {
  const value = String(text || '');
  const needle = query.trim();
  const index = needle ? value.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase()) : -1;
  if (index < 0) {
    element.textContent = value;
    return element;
  }
  element.append(value.slice(0, index), notesElement('mark', '', value.slice(index, index + needle.length)), value.slice(index + needle.length));
  return element;
}

function createNoteCard(note, { query = '', showBook = false } = {}) {
  const card = notesElement('article', 'notes-note');
  card.dataset.noteId = note.id;
  if (showBook) {
    const book = notesElement('button', 'notes-note-book', note.title || '已移除的书');
    book.type = 'button';
    book.addEventListener('click', () => openNotesDocument(note.bookId, { focusNoteId: note.id }));
    card.appendChild(book);
  }
  if (note.text) {
    const quote = notesElement('blockquote', `notes-quote is-${NOTE_COLORS.includes(note.color) ? note.color : 'yellow'}`);
    card.appendChild(highlightQuery(quote, note.text, query));
  }
  if (String(note.thought || '').trim()) {
    const thought = notesElement('p', 'notes-thought');
    card.appendChild(highlightQuery(thought, note.thought, query));
  }
  const footer = notesElement('div', 'notes-note-footer');
  footer.appendChild(notesElement('span', 'notes-note-date', formatNotesDate(note.createdAt, { withTime: true })));
  const actions = notesElement('span', 'notes-note-actions');
  const jump = notesElement('button', 'notes-action', '跳到原文');
  jump.type = 'button';
  jump.disabled = !note.available && note.available !== undefined;
  jump.addEventListener('click', () => { void openShelfBook(note.bookId, { annotationId: note.id }); });
  const copy = notesElement('button', 'notes-action', '复制');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    const text = [note.text, note.thought ? `想法：${note.thought}` : '', note.title ? `——《${note.title}》` : ''].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showHighlightHint('已复制');
    } catch {
      showHighlightHint('复制失败，请手动选择文字复制');
    }
  });
  actions.append(jump, copy);
  footer.appendChild(actions);
  card.appendChild(footer);
  return card;
}

async function renderNotesSearch(results, query) {
  results.replaceChildren(notesElement('p', 'notes-empty', '正在搜索…'));
  let found;
  try {
    found = await window.browserHost.searchNotes(query);
  } catch (error) {
    results.replaceChildren(notesElement('p', 'notes-empty', `搜索失败：${error.message || '请稍后重试'}`));
    return;
  }
  if (query !== notesPageState.query || !results.isConnected) return;
  if (!found.results.length) {
    results.replaceChildren(notesElement('p', 'notes-empty', `没有找到包含“${query}”的笔记。`));
    return;
  }
  const list = notesElement('div', 'notes-search-results');
  list.appendChild(notesElement('p', 'notes-search-count', `找到 ${found.results.length}${found.truncated ? '+' : ''} 条笔记`));
  for (const note of found.results) list.appendChild(createNoteCard(note, { query, showBook: true }));
  results.replaceChildren(list);
}

async function renderNotesList() {
  const shell = notesShell('笔记', '正在读取笔记…');
  if (!shell) return null;
  let summary;
  try {
    summary = await window.browserHost.getNotesSummary();
  } catch (error) {
    shell.querySelector('.library-summary').textContent = `笔记读取失败：${error.message || '请稍后重试'}`;
    return shell;
  }
  if (!shell.isConnected) return null;
  shell.querySelector('.library-summary').textContent = summary.totals.notes
    ? `${summary.totals.books} 本书 · ${summary.totals.notes} 条笔记 · ${summary.totals.thoughts} 条想法`
    : '以书为单位汇总划线与想法';
  if (!summary.totals.notes) {
    shell.appendChild(notesElement('p', 'notes-empty', '还没有笔记：阅读时划线或写下想法，就会按书汇总在这里。'));
    return shell;
  }

  const toolbar = notesElement('div', 'notes-toolbar');
  const search = notesElement('input', 'library-filter notes-search');
  search.type = 'search';
  search.placeholder = '搜索笔记、想法或书名';
  search.setAttribute('aria-label', '搜索笔记、想法或书名');
  search.value = notesPageState.query;
  const sort = notesElement('select', 'notes-sort');
  sort.setAttribute('aria-label', '排序方式');
  for (const [value, label] of [['updated', '最近更新'], ['count', '笔记最多'], ['title', '书名']]) {
    const option = notesElement('option', '', label);
    option.value = value;
    sort.appendChild(option);
  }
  sort.value = notesPageState.sort;
  toolbar.append(search, sort);
  const content = notesElement('div', 'notes-content');
  shell.append(toolbar, content);

  const renderGrid = () => {
    const grid = notesElement('div', 'notes-grid');
    grid.appendChild(createAllNotesCard(summary));
    for (const book of sortNoteBooks(summary.books)) grid.appendChild(createNoteBookCard(book));
    content.replaceChildren(grid);
  };
  let timer = null;
  const update = () => {
    notesPageState.query = search.value.trim();
    sort.hidden = Boolean(notesPageState.query);
    if (notesPageState.query) void renderNotesSearch(content, notesPageState.query);
    else renderGrid();
  };
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(update, 250);
  });
  sort.addEventListener('change', () => {
    notesPageState.sort = sort.value;
    renderGrid();
  });
  update();
  return shell;
}

function appendChapterGroups(container, notes, { headingTag = 'h2' } = {}) {
  let chapter = null;
  let list = null;
  for (const note of notes) {
    if (note.chapter !== chapter || !list) {
      chapter = note.chapter;
      const section = notesElement('section', 'notes-chapter');
      section.appendChild(notesElement(headingTag, 'notes-chapter-title', chapter || '其他'));
      list = notesElement('div', 'notes-chapter-notes');
      section.appendChild(list);
      container.appendChild(section);
    }
    list.appendChild(createNoteCard(note));
  }
}

function notesDocumentHeader(shell, { back, cover = null, title, meta, actions = [] }) {
  const header = notesElement('div', 'notes-doc-header');
  const backButton = notesElement('button', 'notes-back', '‹ 全部笔记');
  backButton.type = 'button';
  backButton.addEventListener('click', back);
  const info = notesElement('div', 'notes-doc-info');
  if (cover) info.appendChild(cover);
  const text = notesElement('div', 'notes-doc-text');
  text.append(notesElement('h2', 'notes-doc-title', title), notesElement('p', 'notes-doc-meta', meta));
  const row = notesElement('div', 'notes-doc-actions');
  for (const action of actions) row.appendChild(action);
  text.appendChild(row);
  info.appendChild(text);
  header.append(backButton, info);
  shell.appendChild(header);
  return header;
}

function backToNotesList() {
  // Came here from the list: step back to it; arrived directly: show it.
  if (notesPageState.cameFromList) window.history.back();
  else void showShelfView('notes', { doc: null });
}

async function renderNotesDocument(doc) {
  const shell = notesShell('笔记', '');
  if (!shell) return null;
  shell.classList.add('is-document');
  const body = notesElement('div', 'notes-doc-body');
  body.appendChild(notesElement('p', 'notes-empty', '正在读取…'));

  if (doc === 'all') {
    const summary = await window.browserHost.getNotesSummary().catch(() => null);
    if (!shell.isConnected) return null;
    notesDocumentHeader(shell, {
      back: backToNotesList,
      title: '全部笔记汇总',
      meta: summary ? `${summary.totals.books} 本书 · ${summary.totals.notes} 条笔记 · ${summary.totals.thoughts} 条想法` : ''
    });
    shell.appendChild(body);
    if (!summary?.books.length) {
      body.replaceChildren(notesElement('p', 'notes-empty', '还没有笔记。'));
      return shell;
    }
    const documents = [];
    for (let index = 0; index < summary.books.length; index += 4) {
      documents.push(...await Promise.all(summary.books.slice(index, index + 4)
        .map((book) => window.browserHost.getBookNotes(book.bookId).catch(() => null))));
      if (!shell.isConnected) return null;
    }
    body.replaceChildren();
    for (const bookDoc of documents.filter(Boolean)) {
      const section = notesElement('section', 'notes-book-section');
      const heading = notesElement('button', 'notes-book-heading');
      heading.type = 'button';
      heading.append(notesCover(bookDoc.book), notesElement('span', 'notes-book-heading-title', bookDoc.book.title || '已移除的书'));
      heading.addEventListener('click', () => openNotesDocument(bookDoc.book.bookId));
      section.appendChild(heading);
      appendChapterGroups(section, bookDoc.notes.map((note) => ({ ...note, bookId: bookDoc.book.bookId, title: bookDoc.book.title, available: bookDoc.book.available })), { headingTag: 'h3' });
      body.appendChild(section);
    }
    return shell;
  }

  let bookDoc;
  try {
    bookDoc = await window.browserHost.getBookNotes(doc);
  } catch (error) {
    shell.appendChild(notesElement('p', 'notes-empty', `笔记读取失败：${error.message || '请稍后重试'}`));
    return shell;
  }
  if (!shell.isConnected) return null;
  const { book, notes } = bookDoc;
  const continueReading = notesElement('button', 'notes-primary', '继续阅读');
  continueReading.type = 'button';
  continueReading.disabled = !book.available;
  continueReading.addEventListener('click', () => { void openShelfBook(book.bookId); });
  const meta = [
    `${notes.length} 条笔记`,
    book.thoughtCount ? `${book.thoughtCount} 条想法` : '',
    book.seconds >= 60 ? `阅读 ${formatReadingDuration(book.seconds)}` : '',
    book.finishedAt ? '已读完' : Number.isFinite(book.percentage) ? `进度 ${Math.round(book.percentage * 100)}%` : ''
  ].filter(Boolean).join(' · ');
  notesDocumentHeader(shell, {
    back: backToNotesList,
    cover: notesCover(book),
    title: book.title || '已移除的书',
    meta: book.author ? `${book.author} · ${meta}` : meta,
    actions: [continueReading]
  });
  shell.appendChild(body);
  body.replaceChildren();
  if (!notes.length) {
    body.appendChild(notesElement('p', 'notes-empty', '这本书还没有笔记。'));
    return shell;
  }
  appendChapterGroups(body, notes.map((note) => ({ ...note, bookId: book.bookId, title: book.title, available: book.available })));
  if (notesPageState.focusNoteId) {
    const target = body.querySelector(`[data-note-id="${CSS.escape(notesPageState.focusNoteId)}"]`);
    notesPageState.focusNoteId = null;
    if (target) {
      target.classList.add('is-focused');
      requestAnimationFrame(() => target.scrollIntoView({ block: 'center' }));
    }
  }
  return shell;
}

SHELF_PAGE_RENDERERS.notes = ({ doc = null } = {}) => {
  if (typeof statsPageState !== 'undefined') statsPageState.libraryBooks = null;
  notesPageState.cameFromList = Boolean(doc) && notesPageState.listShown;
  notesPageState.listShown = !doc;
  return doc ? renderNotesDocument(doc) : renderNotesList();
};
