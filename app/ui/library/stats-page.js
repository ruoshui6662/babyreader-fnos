/* 枕书 UI module: library/stats-page */

'use strict';

/*
 * 阅读统计 (shelf page): this week or month against the one before, reading
 * time per day as a bar chart, the books read longest, and the latest notes.
 * Data comes from /api/stats (reading time is recorded by
 * reader/reading-timer.js from the day this version was installed).
 */

const statsPageState = {
  range: 'week',
  anchor: null, // local YYYY-MM-DD inside the shown period; null = today
  selectedDate: null,
  libraryBooks: null
};

const STATS_WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function statsToday() {
  return typeof localReadingDate === 'function' ? localReadingDate() : new Date().toISOString().slice(0, 10);
}

function statsShiftDate(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function statsShiftMonth(date, months) {
  const value = new Date(`${date}T00:00:00Z`);
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1)).toISOString().slice(0, 10);
}

function formatReadingDuration(seconds, { compact = false } = {}) {
  const minutes = Math.round((Number(seconds) || 0) / 60);
  if (!minutes) return seconds > 0 ? '不到 1 分钟' : '0 分钟';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (compact) return hours ? `${hours}h${rest ? ` ${rest}m` : ''}` : `${rest}m`;
  if (!hours) return `${rest} 分钟`;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

function formatStatsDay(date, { withWeekday = false } = {}) {
  const value = new Date(`${date}T00:00:00Z`);
  const label = `${value.getUTCMonth() + 1}月${value.getUTCDate()}日`;
  return withWeekday ? `${label} ${STATS_WEEKDAYS[(value.getUTCDay() + 6) % 7]}` : label;
}

function formatStatsPeriod(stats) {
  if (stats.range === 'month') {
    const value = new Date(`${stats.from}T00:00:00Z`);
    return `${value.getUTCFullYear()}年${value.getUTCMonth() + 1}月`;
  }
  return `${formatStatsDay(stats.from)} – ${formatStatsDay(stats.to)}`;
}

function formatNoteTime(iso) {
  const time = new Date(iso);
  if (!Number.isFinite(time.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${time.getMonth() + 1}月${time.getDate()}日 ${pad(time.getHours())}:${pad(time.getMinutes())}`;
}

// "较上周 +28%" / "较上月 +3" / "上周没有记录".
function statsDelta(current, previous, { percent = false, rangeLabel }) {
  if (!previous) return current ? `${rangeLabel}没有记录` : '';
  const change = current - previous;
  if (!change) return `与${rangeLabel}持平`;
  if (percent) {
    const ratio = Math.round((change / previous) * 100);
    return `较${rangeLabel} ${ratio >= 0 ? '+' : ''}${ratio}%`;
  }
  return `较${rangeLabel} ${change >= 0 ? '+' : ''}${change}`;
}

function statsElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

async function statsLibraryBook(bookId) {
  if (!statsPageState.libraryBooks) {
    const library = await window.browserHost.getLibrary();
    statsPageState.libraryBooks = new Map((library.books || []).map((book) => [book.id, book]));
  }
  return statsPageState.libraryBooks.get(bookId) || null;
}

// Opens a book from the shelf; with a note, also goes to it once the book
// (and, for PDFs, its notes) are ready.
async function openShelfBook(bookId, { annotationId = null } = {}) {
  const book = await statsLibraryBook(bookId);
  if (!book) {
    showHighlightHint('这本书已不在书库中');
    return false;
  }
  try {
    await window.browserHost.openBook(book);
  } catch (error) {
    showHighlightHint(error.message || '打开失败');
    return false;
  }
  if (!annotationId || typeof navigateToAnnotationDirect !== 'function') return true;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (state.currentBookId === bookId && typeof notesAnnotationById === 'function' && notesAnnotationById(annotationId)) {
      return navigateToAnnotationDirect(annotationId);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return true;
}

function createStatsCover(book) {
  const cover = typeof createLibraryCover === 'function'
    ? createLibraryCover({ id: book.bookId, title: book.title || '已移除的书', author: book.author, type: book.type, coverUrl: book.coverUrl })
    : statsElement('span', 'library-book-cover');
  cover.classList.add('stats-cover');
  return cover;
}

function renderStatsMetrics(stats) {
  const rangeLabel = stats.range === 'month' ? '上月' : '上周';
  const grid = statsElement('div', 'stats-metrics');
  const metric = (tone, label, value, delta) => {
    const card = statsElement('div', `stats-metric is-${tone}`);
    card.append(statsElement('div', 'stats-metric-label', label), statsElement('div', 'stats-metric-value', value));
    if (delta) card.appendChild(statsElement('div', 'stats-metric-delta', delta));
    return card;
  };
  const { totals, previousTotals } = stats;
  grid.append(
    metric('time', stats.range === 'month' ? '本月阅读时长' : '本周阅读时长',
      formatReadingDuration(totals.seconds),
      statsDelta(totals.seconds, previousTotals.seconds, { percent: true, rangeLabel })),
    metric('books', '读过的书', `${totals.booksRead} 本`, statsDelta(totals.booksRead, previousTotals.booksRead, { rangeLabel })),
    metric('finished', '读完的书', `${totals.booksFinished} 本`, statsDelta(totals.booksFinished, previousTotals.booksFinished, { rangeLabel })),
    metric('notes', '新增笔记', `${totals.notes} 条`, statsDelta(totals.notes, previousTotals.notes, { rangeLabel }))
  );
  return grid;
}

function statsChartScale(maxMinutes) {
  const step = maxMinutes > 240 ? 60 : maxMinutes > 90 ? 30 : 15;
  return Math.max(step * 2, Math.ceil(maxMinutes / step) * step);
}

function renderStatsChart(stats, titles) {
  const card = statsElement('section', 'stats-card stats-chart-card');
  const head = statsElement('div', 'stats-card-head');
  head.appendChild(statsElement('h2', 'stats-card-title', '每日阅读时长'));
  const today = statsToday();
  const elapsedDays = stats.daily.filter((day) => day.date <= today).length || stats.daily.length;
  const total = statsElement('div', 'stats-chart-total');
  total.append(
    statsElement('strong', '', formatReadingDuration(stats.totals.seconds)),
    statsElement('span', '', `日均 ${formatReadingDuration(stats.totals.seconds / Math.max(1, elapsedDays))}`)
  );
  head.appendChild(total);
  card.appendChild(head);

  const maxMinutes = Math.max(0, ...stats.daily.map((day) => day.seconds / 60));
  const scale = statsChartScale(maxMinutes);
  const chart = statsElement('div', `stats-chart is-${stats.range}`);
  const axis = statsElement('div', 'stats-chart-axis');
  for (const value of [scale, scale / 2, 0]) axis.appendChild(statsElement('span', '', `${Math.round(value)}`));
  axis.appendChild(statsElement('span', 'stats-chart-unit', '分钟'));
  const plot = statsElement('div', 'stats-chart-plot');
  const detail = statsElement('p', 'stats-chart-detail');
  detail.setAttribute('aria-live', 'polite');

  const select = (day, button) => {
    statsPageState.selectedDate = day.date;
    plot.querySelectorAll('.stats-bar').forEach((bar) => bar.setAttribute('aria-pressed', String(bar === button)));
    const books = day.books.slice(0, 3).map((book) => `${titles.get(book.bookId) || '其他书'} ${formatReadingDuration(book.seconds)}`);
    detail.textContent = `${formatStatsDay(day.date, { withWeekday: true })} · ${day.seconds ? formatReadingDuration(day.seconds) : '没有阅读'}${books.length ? `：${books.join('、')}` : ''}`;
  };
  let initial = null;
  stats.daily.forEach((day, index) => {
    const column = statsElement('div', 'stats-bar-column');
    const bar = statsElement('button', 'stats-bar');
    bar.type = 'button';
    bar.dataset.date = day.date;
    bar.style.setProperty('--bar', `${Math.min(100, (day.seconds / 60 / scale) * 100)}%`);
    if (!day.seconds) bar.classList.add('is-empty');
    if (day.date === today) column.classList.add('is-today');
    if (day.date > today) bar.disabled = true;
    bar.setAttribute('aria-label', `${formatStatsDay(day.date, { withWeekday: true })}，${formatReadingDuration(day.seconds)}`);
    bar.setAttribute('aria-pressed', 'false');
    bar.addEventListener('click', () => select(day, bar));
    const valueLabel = statsElement('span', 'stats-bar-value', day.seconds >= 60 ? String(Math.round(day.seconds / 60)) : '');
    const dayNumber = Number(day.date.slice(8));
    const label = stats.range === 'week'
      ? STATS_WEEKDAYS[index]
      : (dayNumber === 1 || dayNumber % 5 === 0 ? String(dayNumber) : '');
    column.append(valueLabel, bar, statsElement('span', 'stats-bar-label', label));
    plot.appendChild(column);
    if (day.date === statsPageState.selectedDate || (!statsPageState.selectedDate && day.date === today)) initial = [day, bar];
  });
  chart.append(axis, plot);
  card.append(chart, detail);
  const fallback = [...stats.daily].reverse().find((day) => day.seconds && day.date <= today) || stats.daily[0];
  const [day, bar] = initial || [fallback, plot.querySelector(`[data-date="${fallback.date}"]`)];
  select(day, bar);
  return card;
}

function renderStatsRanking(stats) {
  const card = statsElement('section', 'stats-card stats-ranking');
  const head = statsElement('div', 'stats-card-head');
  head.appendChild(statsElement('h2', 'stats-card-title', '书籍阅读时长'));
  card.appendChild(head);
  if (!stats.books.length) {
    card.appendChild(statsElement('p', 'stats-empty', stats.range === 'month' ? '本月还没有阅读记录。' : '本周还没有阅读记录。'));
    return card;
  }
  const list = statsElement('ol', 'stats-rank-list');
  stats.books.slice(0, 8).forEach((book, index) => {
    const item = statsElement('li');
    const row = statsElement('button', 'stats-rank-row');
    row.type = 'button';
    row.disabled = !book.available;
    row.addEventListener('click', () => { void openShelfBook(book.bookId); });
    const body = statsElement('span', 'stats-rank-body');
    body.appendChild(statsElement('span', 'stats-rank-title', book.title || '已移除的书'));
    const progress = statsElement('span', 'stats-progress');
    const fill = statsElement('i');
    fill.style.width = `${Math.round((book.percentage || 0) * 100)}%`;
    progress.appendChild(fill);
    body.appendChild(progress);
    const time = statsElement('span', 'stats-rank-time', formatReadingDuration(book.seconds));
    time.appendChild(statsElement('small', '', book.percentage === null ? '' : book.finishedAt ? '已读完' : `进度 ${Math.round(book.percentage * 100)}%`));
    row.append(statsElement('span', 'stats-rank-no', String(index + 1)), createStatsCover(book), body, time);
    item.appendChild(row);
    list.appendChild(item);
  });
  card.appendChild(list);
  return card;
}

function renderStatsNotes(stats) {
  const card = statsElement('section', 'stats-card stats-notes');
  const head = statsElement('div', 'stats-card-head');
  head.appendChild(statsElement('h2', 'stats-card-title', '最近笔记'));
  const all = statsElement('button', 'zs-btn zs-btn-plain zs-btn-small stats-link', '全部笔记 ›');
  all.type = 'button';
  all.addEventListener('click', () => { void showShelfView('notes', { push: true }); });
  head.appendChild(all);
  card.appendChild(head);
  if (!stats.recentNotes.length) {
    card.appendChild(statsElement('p', 'stats-empty', '阅读时划线或写下想法，会出现在这里。'));
    return card;
  }
  const list = statsElement('ul', 'stats-note-list');
  for (const note of stats.recentNotes.slice(0, 6)) {
    const item = statsElement('li');
    const row = statsElement('button', 'stats-note-row');
    row.type = 'button';
    row.disabled = !note.available;
    row.addEventListener('click', () => { void openShelfBook(note.bookId, { annotationId: note.id }); });
    const body = statsElement('span', 'stats-note-body');
    body.appendChild(statsElement('span', 'stats-note-title', note.title || '已移除的书'));
    if (note.text) {
      const quote = statsElement('span', `stats-note-quote is-${note.color || 'yellow'}`, note.text);
      body.appendChild(quote);
    }
    if (note.thought) body.appendChild(statsElement('span', 'stats-note-thought', note.thought));
    row.append(createStatsCover(note), body, statsElement('span', 'stats-note-time', formatNoteTime(note.createdAt)));
    item.appendChild(row);
    list.appendChild(item);
  }
  card.appendChild(list);
  return card;
}

function renderStatsToolbar(stats) {
  const bar = statsElement('div', 'stats-toolbar');
  const segments = statsElement('div', 'stats-range');
  segments.setAttribute('role', 'radiogroup');
  segments.setAttribute('aria-label', '统计周期');
  for (const [range, label] of [['week', '本周'], ['month', '本月']]) {
    const button = statsElement('button', '', label);
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.dataset.statsRange = range;
    button.setAttribute('aria-checked', String(stats.range === range));
    button.addEventListener('click', () => {
      if (statsPageState.range === range) return;
      statsPageState.range = range;
      statsPageState.anchor = null;
      statsPageState.selectedDate = null;
      void renderStatsPage();
    });
    segments.appendChild(button);
  }
  const period = statsElement('div', 'stats-period');
  const previous = statsElement('button', 'zs-btn zs-btn-secondary zs-btn-icon stats-period-step', '‹');
  previous.type = 'button';
  previous.setAttribute('aria-label', stats.range === 'month' ? '上个月' : '上一周');
  const next = statsElement('button', 'zs-btn zs-btn-secondary zs-btn-icon stats-period-step', '›');
  next.type = 'button';
  next.setAttribute('aria-label', stats.range === 'month' ? '下个月' : '下一周');
  next.disabled = stats.to >= statsToday();
  const step = (direction) => {
    statsPageState.anchor = stats.range === 'month'
      ? statsShiftMonth(stats.from, direction)
      : statsShiftDate(stats.from, direction * 7);
    statsPageState.selectedDate = null;
    void renderStatsPage();
  };
  previous.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  period.append(previous, statsElement('span', 'stats-period-label', formatStatsPeriod(stats)), next);
  bar.append(segments, period);
  return bar;
}

async function renderStatsPage() {
  const shell = renderShelfPlaceholder('stats');
  if (!shell) return null;
  const summary = shell.querySelector('.library-summary');
  const body = statsElement('div', 'stats-body');
  body.appendChild(statsElement('p', 'stats-loading', '正在统计…'));
  shell.appendChild(body);
  let stats;
  try {
    stats = await window.browserHost.getReadingStats(statsPageState.range, statsPageState.anchor || statsToday());
  } catch (error) {
    body.replaceChildren(statsElement('p', 'stats-empty', `统计读取失败：${error.message || '请稍后重试'}`));
    return shell;
  }
  if (!shell.isConnected) return null;
  summary.textContent = stats.firstRecordedDate
    ? `从 ${formatStatsDay(stats.firstRecordedDate)} 开始记录阅读时长`
    : '阅读时长从现在开始记录：打开一本书读一会儿，这里就会有数据。';
  const titles = new Map(stats.books.map((book) => [book.bookId, book.title]));
  const lower = statsElement('div', 'stats-lower');
  lower.append(renderStatsRanking(stats), renderStatsNotes(stats));
  body.replaceChildren(renderStatsToolbar(stats), renderStatsMetrics(stats), renderStatsChart(stats, titles), lower);
  return shell;
}

SHELF_PAGE_RENDERERS.stats = () => {
  statsPageState.libraryBooks = null;
  return renderStatsPage();
};
