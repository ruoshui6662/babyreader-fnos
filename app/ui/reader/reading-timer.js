/* 枕书 UI module: reader/reading-timer */

'use strict';

/*
 * Reading time, as the browser sees it. Time counts while a book is open, the
 * page is visible, and the reader did something (turned a page, scrolled,
 * selected, tapped, pressed a key) within the last 3 minutes — staring away
 * from the book stops the clock, like KOReader's per-page idle cap.
 *
 * Seconds add up per local date and book and are reported every minute, when
 * the page is hidden and when it closes. Anything not yet accepted by the
 * server waits in localStorage (per user) and goes out with the next report.
 */

const READING_TIMER_DEFAULTS = Object.freeze({
  tickMs: 15 * 1000,
  idleMs: 3 * 60 * 1000,
  flushMs: 60 * 1000
});

const readingTimer = {
  config: { ...READING_TIMER_DEFAULTS, ...(window.__zhenshuReadingTimerConfig || {}) },
  pending: new Map(), // `${date}|${bookId}` -> milliseconds
  lastTick: Date.now(),
  lastActivity: 0,
  bookId: null,
  sending: null,
  started: false
};

function localReadingDate(time = Date.now()) {
  const date = new Date(time);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function readingTimerStorageKey() {
  const uid = state.session?.uid;
  return uid ? `zhenshu-reading-time:${uid}` : null;
}

function persistPendingReadingTime() {
  const key = readingTimerStorageKey();
  if (!key) return;
  try {
    if (!readingTimer.pending.size) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify([...readingTimer.pending]));
  } catch { /* Private mode: the time is still sent from memory. */ }
}

function restorePendingReadingTime() {
  const key = readingTimerStorageKey();
  if (!key) return;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    for (const [entryKey, ms] of Array.isArray(saved) ? saved : []) {
      if (typeof entryKey === 'string' && Number.isFinite(ms) && ms > 0) {
        readingTimer.pending.set(entryKey, (readingTimer.pending.get(entryKey) || 0) + ms);
      }
    }
  } catch { /* Unreadable leftovers are dropped. */ }
}

function isReadingNow() {
  return Boolean(state.currentBookId && state.currentPath)
    && !document.body.classList.contains('is-library')
    && document.visibilityState === 'visible';
}

function noteReadingActivity() {
  readingTimer.lastActivity = Date.now();
}

function tickReadingTimer(now = Date.now()) {
  // A long gap (sleeping laptop, frozen tab) counts as one tick at most.
  const elapsed = Math.max(0, Math.min(now - readingTimer.lastTick, readingTimer.config.tickMs * 2));
  readingTimer.lastTick = now;
  if (!isReadingNow()) return 0;
  if (state.currentBookId !== readingTimer.bookId) {
    // Opening a book is itself a reading action.
    readingTimer.bookId = state.currentBookId;
    readingTimer.lastActivity = now;
    return 0;
  }
  if (now - readingTimer.lastActivity > readingTimer.config.idleMs) return 0;
  const key = `${localReadingDate(now)}|${state.currentBookId}`;
  readingTimer.pending.set(key, (readingTimer.pending.get(key) || 0) + elapsed);
  persistPendingReadingTime();
  return elapsed;
}

// Whole seconds go out; the remainder stays for the next report.
async function flushReadingTime({ keepalive = false } = {}) {
  if (readingTimer.sending) return readingTimer.sending;
  const entries = [];
  const sent = new Map();
  for (const [key, ms] of readingTimer.pending) {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 1) continue;
    const [date, bookId] = key.split('|');
    entries.push({ date, bookId, seconds });
    sent.set(key, seconds * 1000);
  }
  if (!entries.length || !state.session?.uid) return null;
  for (const [key, ms] of sent) {
    const left = (readingTimer.pending.get(key) || 0) - ms;
    if (left > 0) readingTimer.pending.set(key, left);
    else readingTimer.pending.delete(key);
  }
  persistPendingReadingTime();
  readingTimer.sending = window.browserHost.saveReadingTime(entries, { keepalive })
    .catch((error) => {
      // Put it back so the next report retries — unless the server refused
      // the data itself, which would be refused again.
      if (error?.status !== 400) {
        for (const [key, ms] of sent) readingTimer.pending.set(key, (readingTimer.pending.get(key) || 0) + ms);
        persistPendingReadingTime();
      }
      return null;
    })
    .finally(() => { readingTimer.sending = null; });
  return readingTimer.sending;
}

function setupReadingTimer() {
  if (readingTimer.started) return;
  readingTimer.started = true;
  restorePendingReadingTime();
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
    document.addEventListener(type, noteReadingActivity, { capture: true, passive: true });
  }
  document.addEventListener('selectionchange', noteReadingActivity);
  setInterval(() => tickReadingTimer(), readingTimer.config.tickMs);
  setInterval(() => { void flushReadingTime(); }, readingTimer.config.flushMs);
  document.addEventListener('visibilitychange', () => {
    tickReadingTimer();
    if (document.visibilityState === 'hidden') void flushReadingTime({ keepalive: true });
  });
  window.addEventListener('pagehide', () => {
    tickReadingTimer();
    void flushReadingTime({ keepalive: true });
  });
}

window.__zhenshuReadingTimer = { tick: tickReadingTimer, flush: flushReadingTime, state: readingTimer };
