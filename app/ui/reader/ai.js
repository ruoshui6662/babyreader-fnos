/* BabyReader UI module: reader/ai */

'use strict';

const AI_CHUNK_SIZE = 900;
const AI_CHUNK_OVERLAP = 120;
const AI_MAX_RESULTS = 6;
const AI_CONTEXT_CHAR_BUDGET = AI_CHUNK_SIZE * AI_MAX_RESULTS;
const AI_REMOTE_SEARCH_TIMEOUT_MS = 2500;
const AI_TITLE_WEIGHT = 4;
const AI_HEADING_WEIGHT = 3;
const AI_BODY_WEIGHT = 1;
const AI_SELECTED_TEXT_WEIGHT = 12;
const AI_CURRENT_CHAPTER_WEIGHT = 2;
// Two windows that start within one chunk width share content. Defer the
// second one so the fixed context budget can cover another relevant section.
const AI_MIN_DIVERSE_DISTANCE = AI_CHUNK_SIZE;
const AI_MARKDOWN_ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'del', 's', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'a'
]);
const AI_MARKDOWN_DROP_CONTENT_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select'
]);
const AI_SELECTION_PROMPTS = [
  '这段内容的核心观点是什么？',
  '请解释这段内容中的关键概念。',
  '书中有哪些内容可以支持这段观点？'
];
const AI_BOOK_PROMPTS = [
  '本章主要讲了什么？',
  '这本书的核心观点是什么？',
  '作者提出了哪些关键概念？'
];
const AI_PDF_PROMPTS = [
  '当前页的主要观点是什么？',
  '请解释当前页出现的关键概念。',
  '哪些可检索片段支持这个观点？'
];

let _aiSelection = null;
let _aiIndex = null;
let _aiIndexBookId = null;
let _aiBusy = false;
let _aiRequestId = 0;
let _aiSetup = false;
let _aiModalReturnFocus = null;
let _aiConfigReturnFocus = null;
let _aiClearApiKey = false;
let _aiConversation = [];
let _aiConversationId = null;
let _aiConversationList = [];
let _aiConversationBookId = null;
let _aiConversationRestoring = false;
let _aiConversationRestoreToken = 0;
let _aiConversationPersistenceAvailable = false;
let _aiConversationManageBusy = false;
let _aiConversationManageReturnFocus = null;
let _aiConversationConfirmation = null;
let _aiConversationConfirmationPending = false;
let _aiStreamController = null;
let _aiActiveAnswerElement = null;
let _aiActiveSourcesElement = null;
let _aiSourceScopeCounter = 0;

function normalizeAiText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeAiSourceLabel(value) {
  const rawLabel = normalizeAiText(value);
  if (!rawLabel) return '';
  const visibleLabel = rawLabel
    .replace(/^\s*(?:[\u2460-\u2473\u24f5-\u24fe\u2776-\u278a]|\d+\s*[.)、]|第\s*[0-9一二三四五六七八九十百]+\s*[章节篇])\s*/u, '')
    .trim();
  return visibleLabel || rawLabel;
}

function aiTerms(value) {
  const text = normalizeAiText(value).toLocaleLowerCase();
  const terms = new Set(text.match(/[a-z0-9_]{2,}|[\u3400-\u9fff]{2}/gi) || []);
  for (const phrase of text.match(/[\u3400-\u9fff]{1,}/g) || []) {
    const chars = Array.from(phrase);
    for (let index = 0; index < chars.length - 1; index += 1) terms.add(chars[index] + chars[index + 1]);
  }
  return [...terms];
}

function chunkChapterText(chapter, chunkSize = AI_CHUNK_SIZE, overlap = AI_CHUNK_OVERLAP) {
  const text = normalizeAiText(chapter?.text);
  if (!text) return [];
  const chars = Array.from(text);
  const title = normalizeAiText(chapter?.title || chapter?.label);
  const headings = Array.isArray(chapter?.headings)
    ? chapter.headings.map((heading) => normalizeAiText(heading)).filter(Boolean)
    : [];
  const chunks = [];
  const step = Math.max(1, chunkSize - overlap);
  for (let start = 0; start < chars.length; start += step) {
    const chunkText = chars.slice(start, start + chunkSize).join('').trim();
    if (chunkText) {
      chunks.push({
        text: chunkText,
        chapterIndex: Number.isInteger(chapter.index) ? chapter.index : 0,
        chapterHref: String(chapter.href || ''),
        chapterLabel: String(chapter.label || `第${(chapter.index || 0) + 1}章`),
        title,
        headings,
        titleTerms: aiTerms(title),
        headingTerms: aiTerms(headings.join(' ')),
        terms: aiTerms(chunkText),
        start
      });
    }
    if (start + chunkSize >= chars.length) break;
  }
  return chunks;
}

function buildBookSearchIndex(chapters) {
  return (chapters || []).flatMap((chapter) => chunkChapterText(chapter));
}

function cleanAiContextText(value) {
  return String(value || '').replace(/\u0000/g, '').trim();
}

function selectDiverseContextCandidates(candidates, resultLimit) {
  const selected = [];
  const seenTexts = new Set();
  let contextChars = 0;
  for (const item of candidates) {
    const text = cleanAiContextText(item.text);
    if (!text || seenTexts.has(text)) continue;
    const duplicate = selected.some((match) => (
      match.chapterIndex === item.chapterIndex
      && Math.abs((match.start || 0) - (item.start || 0)) < AI_MIN_DIVERSE_DISTANCE
    ));
    if (duplicate || contextChars + text.length > AI_CONTEXT_CHAR_BUDGET) continue;
    selected.push(item);
    seenTexts.add(text);
    contextChars += text.length;
    if (selected.length >= resultLimit) break;
  }
  return selected;
}

function searchBookIndex(index, { query = '', selectedText = '', currentChapterIndex = null, limit = AI_MAX_RESULTS } = {}) {
  const queryTerms = new Set(aiTerms(`${query} ${selectedText}`));
  const resultLimit = Math.max(1, Math.min(AI_MAX_RESULTS, limit));
  if (!queryTerms.size) {
    return selectDiverseContextCandidates(index, resultLimit)
      .map((item) => ({ ...item, score: 0 }));
  }
  const candidates = index
    .map((item) => {
      const itemTerms = new Set(item.terms || aiTerms(item.text));
      const titleTerms = new Set(item.titleTerms || aiTerms(item.title || item.chapterLabel));
      const headingTerms = new Set(item.headingTerms || aiTerms((item.headings || []).join(' ')));
      let titleScore = 0;
      let headingScore = 0;
      let bodyScore = 0;
      for (const term of queryTerms) {
        if (titleTerms.has(term)) titleScore += AI_TITLE_WEIGHT;
        if (headingTerms.has(term)) headingScore += AI_HEADING_WEIGHT;
        if (itemTerms.has(term)) bodyScore += AI_BODY_WEIGHT;
      }
      const selectedScore = selectedText && item.text.includes(normalizeAiText(selectedText))
        ? AI_SELECTED_TEXT_WEIGHT
        : 0;
      const contentScore = titleScore + headingScore + bodyScore + selectedScore;
      const chapterScore = Number.isInteger(currentChapterIndex) && item.chapterIndex === currentChapterIndex
        && contentScore > 0
        ? AI_CURRENT_CHAPTER_WEIGHT
        : 0;
      return {
        ...item,
        titleScore,
        headingScore,
        bodyScore,
        selectedScore,
        chapterScore,
        score: contentScore + chapterScore
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.chapterIndex - b.chapterIndex || a.start - b.start)
    ;
  if (!candidates.length && Number.isInteger(currentChapterIndex)) {
    return selectDiverseContextCandidates(
      index.filter((item) => item.chapterIndex === currentChapterIndex),
      resultLimit
    )
      .map((item) => ({ ...item, score: 0, fallback: true }));
  }
  return selectDiverseContextCandidates(candidates, resultLimit);
}

function aiChapterLabel(index) {
  const path = state.chapterPaths?.[index] || '';
  const toc = (state.toc || []).find((item) => String(item.target || '').includes(path));
  return toc?.label || (Number.isInteger(index) ? `第${index + 1}章` : '当前章节');
}

function currentAiChapter() {
  const reader = document.getElementById('reader');
  const locator = typeof currentReadingLocator === 'function' && reader
    ? currentReadingLocator(reader)
    : null;
  const visibleIndex = locator?.href && Array.isArray(state.chapterPaths)
    ? state.chapterPaths.indexOf(locator.href)
    : -1;
  const index = visibleIndex >= 0
    ? visibleIndex
    : Number.isInteger(state.epubChapterIndex) ? state.epubChapterIndex : 0;
  const href = state.chapterPaths?.[index] || '';
  return {
    index,
    href,
    label: aiChapterLabel(index),
    position: {
      href,
      anchor: locator?.href === href ? String(locator.anchor || '') : ''
    }
  };
}

function aiElement(id) {
  return document.getElementById(id);
}

function setAiStatus(message, tone = '') {
  const element = aiElement('aiStatus');
  if (!element) return;
  if (tone === 'ready' && aiElement('btnAiAsk')?.dataset.configured === 'false') {
    message = '尚未配置 AI 服务，请先填写 AI 设置。';
    tone = 'warning';
  }
  element.textContent = message;
  element.dataset.tone = tone;
  element.hidden = !['busy', 'warning', 'error'].includes(tone);
  // "Not configured" gets a way forward instead of a dead-end sentence.
  if (message === '尚未配置 AI 服务，请先填写 AI 设置。') {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'ai-status-action';
    action.textContent = '去设置';
    action.addEventListener('click', () => aiElement('btnAiSettings')?.click());
    element.appendChild(action);
  }
}

function pdfAiStatusFromMeta(meta, sourceCount) {
  if (meta?.profileStatus === 'ready') return '正在分析论文结构，仅发送有限页片段…';
  if (meta?.profileStatus === 'cached') return '已使用论文结构，正在检索原文页证据…';
  if (meta?.profileStatus === 'fallback') return '结构分析不可用，已按页检索。';
  return `已找到 ${sourceCount} 条页证据，正在生成回答…`;
}

function renderAiSelection() {
  const quote = aiElement('aiSelectedText');
  if (!quote) return;
  const selectedText = normalizeAiText(_aiSelection?.text);
  quote.textContent = selectedText;
  quote.hidden = !selectedText;
}

function renderAiPromptSuggestions() {
  const title = document.querySelector('.ai-suggested-title');
  const buttons = [...document.querySelectorAll('[data-ai-prompt]')];
  const hasSelection = Boolean(normalizeAiText(_aiSelection?.text));
  const prompts = hasSelection ? AI_SELECTION_PROMPTS : state.contentType === 'pdf' ? AI_PDF_PROMPTS : AI_BOOK_PROMPTS;
  if (title) title.textContent = hasSelection ? '你还可以问' : '常用问题';
  buttons.forEach((button, index) => {
    const prompt = prompts[index];
    if (!prompt) return;
    button.dataset.aiPrompt = prompt;
    button.textContent = prompt;
  });
}

function circledAiNumber(index) {
  const number = Number(index);
  if (number >= 1 && number <= 20) return String.fromCodePoint(0x245f + number);
  return String(number);
}

function aiSourceScopeFor(element) {
  const card = element?.closest?.('.ai-answer-card, #aiInitialAnswerCard');
  if (!card || card.id === 'aiInitialAnswerCard') return '';
  if (!card.dataset.aiSourceScope) card.dataset.aiSourceScope = `message-${++_aiSourceScopeCounter}`;
  return card.dataset.aiSourceScope;
}

function aiSourceAnchorId(scope, index) {
  return `ai-source-${scope ? `${scope}-` : ''}${index}`;
}

function extractAiCitationIndexes(answer) {
  const citations = new Set();
  const source = String(answer || '');
  for (const match of source.matchAll(/[【〔](\d+)[】〕]/g)) {
    const index = Number(match[1]);
    if (Number.isInteger(index) && index > 0) citations.add(index);
  }
  return citations;
}

function decorateAiCitationHtml(html, scope = '') {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  const walker = document.createTreeWalker(template.content, globalThis.NodeFilter?.SHOW_TEXT || 4);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const node of textNodes) {
    if (node.parentElement?.closest('a, code, pre')) continue;
    const source = node.nodeValue || '';
    const pattern = /[【〔](\d+)[】〕]/g;
    let cursor = 0;
    let match;
    const fragment = document.createDocumentFragment();
    let found = false;
    while ((match = pattern.exec(source))) {
      found = true;
      if (match.index > cursor) fragment.appendChild(document.createTextNode(source.slice(cursor, match.index)));
      const index = Number(match[1]);
      const link = document.createElement('a');
      link.className = 'ai-citation';
      link.dataset.aiCitation = String(index);
      link.href = `#${aiSourceAnchorId(scope, index)}`;
      link.textContent = circledAiNumber(index);
      link.setAttribute('aria-label', `跳转到来源 ${index}`);
      fragment.appendChild(link);
      cursor = match.index + match[0].length;
    }
    if (!found) continue;
    if (cursor < source.length) fragment.appendChild(document.createTextNode(source.slice(cursor)));
    node.replaceWith(fragment);
  }
  return template.innerHTML;
}

function bindAiCitationLinks(container) {
  container?.querySelectorAll?.('[data-ai-citation]')?.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const index = Number(link.dataset.aiCitation);
      const card = link.closest('.ai-answer-card, #aiInitialAnswerCard');
      const source = card?.querySelector?.(`[data-ai-source-index="${index}"]`)
        || document.getElementById(aiSourceAnchorId('', index));
      source?.click();
    });
  });
}

function renderAiSources(sources, target = null, answer = '') {
  const container = target || _aiActiveSourcesElement || aiElement('aiSources');
  if (!container) return;
  container.replaceChildren();
  container.hidden = true;
  const scope = aiSourceScopeFor(container);
  const citedIndexes = extractAiCitationIndexes(answer);
  const citedSources = (Array.isArray(sources) ? sources : [])
    .map((source, index) => ({
      ...source,
      citationIndexes: Array.isArray(source.citationIndexes) && source.citationIndexes.length
        ? source.citationIndexes.map(Number).filter((value) => Number.isInteger(value) && value > 0)
        : [Number(source.citationIndex || index + 1)]
    }))
    .map((source) => ({ ...source, citedIndexes: source.citationIndexes.filter((index) => citedIndexes.has(index)) }))
    .filter((source) => source.citedIndexes.length);
  if (!citedSources.length) return;
  const title = document.createElement('div');
  title.className = 'ai-sources-title';
  title.textContent = state.contentType === 'pdf' ? '来源页码' : '来源章节';
  container.appendChild(title);
  for (const source of citedSources) {
    const primaryCitationIndex = source.citedIndexes[0];
    const rawSourceLabel = normalizeAiText(source.chapterLabel || (state.contentType === 'pdf'
      ? `第${Number(source.pageIndex || 0) + 1}页` : `第${Number(source.chapterIndex || 0) + 1}章`));
    const sourceLabel = normalizeAiSourceLabel(rawSourceLabel);
    const link = document.createElement('a');
    link.id = aiSourceAnchorId(scope, primaryCitationIndex);
    link.href = `#${link.id}`;
    link.dataset.aiSourceIndex = String(primaryCitationIndex);
    link.className = 'ai-source';
    const stalePdfSource = state.contentType === 'pdf' && source.stale === true;
    link.setAttribute('aria-label', `来源${state.contentType === 'pdf' ? '页码' : '章节'}：${rawSourceLabel}${stalePdfSource ? '，来源已变化' : ''}`);
    if (stalePdfSource) {
      link.removeAttribute('href');
      link.setAttribute('aria-disabled', 'true');
      link.title = 'PDF 来源已变化，旧页码不可跳转';
    }
    if (!stalePdfSource && sourceLabel !== rawSourceLabel) link.title = rawSourceLabel;
    const indexElement = document.createElement('span');
    indexElement.className = 'ai-source-index';
    indexElement.setAttribute('aria-hidden', 'true');
    indexElement.textContent = String(primaryCitationIndex);
    const labelElement = document.createElement('span');
    labelElement.className = 'ai-source-label';
    labelElement.textContent = stalePdfSource ? `${sourceLabel} · 来源已变化` : sourceLabel;
    link.append(indexElement, labelElement);
    const navigateSource = (event) => {
      event.preventDefault();
      if (stalePdfSource) return;
      if (state.contentType === 'pdf' && Number.isInteger(source.pageIndex ?? source.chapterIndex)) {
        window.pdfReaderController?.goToPdfPage?.(source.pageIndex ?? source.chapterIndex);
      } else if (Number.isInteger(source.chapterIndex) && typeof navigateToEpubChapter === 'function') {
        navigateToEpubChapter(source.chapterIndex, { reason: 'ai-source' });
      }
    };
    link.addEventListener('click', navigateSource);
    container.appendChild(link);
    for (const citationIndex of source.citedIndexes.slice(1)) {
      const alias = document.createElement('a');
      alias.id = aiSourceAnchorId(scope, citationIndex);
      alias.href = `#${alias.id}`;
      alias.dataset.aiSourceIndex = String(citationIndex);
      alias.hidden = true;
      alias.setAttribute('aria-hidden', 'true');
      alias.addEventListener('click', navigateSource);
      container.appendChild(alias);
    }
  }
  container.hidden = false;
}

function createAiMessageElement(className) {
  const element = document.createElement('div');
  element.className = `ai-message ${className}`;
  return element;
}

function appendAiUserMessage(question) {
  const messages = aiElement('aiMessages');
  if (!messages) return null;
  const message = createAiMessageElement('ai-message-user');
  message.textContent = question;
  const initialAnswer = aiElement('aiInitialAnswerCard');
  if (initialAnswer?.hidden) messages.insertBefore(message, initialAnswer);
  else messages.appendChild(message);
  return message;
}

function prepareAiAssistantMessage() {
  const messages = aiElement('aiMessages');
  const initialAnswer = aiElement('aiInitialAnswerCard');
  if (!messages) return { answer: aiElement('aiAnswer'), sources: aiElement('aiSources'), card: initialAnswer, notice: null };
  if (initialAnswer?.hidden) {
    initialAnswer.hidden = false;
    return {
      answer: aiElement('aiAnswer'),
      sources: aiElement('aiSources'),
      card: initialAnswer,
      notice: ensureAiConfidenceNotice(initialAnswer)
    };
  }
  const card = createAiMessageElement('ai-message-assistant ai-answer-card');
  const answer = document.createElement('div');
  answer.className = 'ai-answer';
  answer.setAttribute('aria-live', 'polite');
  const notice = document.createElement('div');
  notice.className = 'ai-confidence-notice';
  notice.hidden = true;
  const sources = document.createElement('div');
  sources.className = 'ai-sources';
  card.append(notice, answer, sources);
  messages.appendChild(card);
  return { answer, sources, card, notice };
}

function discardFailedAiTurn(userMessage, assistant, questionElement, question) {
  userMessage?.remove();
  if (assistant?.card === aiElement('aiInitialAnswerCard')) {
    assistant.card.hidden = true;
    if (assistant.answer) { assistant.answer.replaceChildren(); assistant.answer.hidden = true; }
    assistant.sources?.replaceChildren();
  } else {
    assistant?.card?.remove();
    const initialAnswer = aiElement('aiInitialAnswerCard');
    if (initialAnswer && !aiElement('aiAnswer')?.textContent?.trim()) initialAnswer.hidden = true;
  }
  if (questionElement && !questionElement.value.trim()) questionElement.value = question;
}

function ensureAiConfidenceNotice(card) {
  if (!card) return null;
  const existing = card.querySelector('.ai-confidence-notice');
  if (existing) return existing;
  const notice = document.createElement('div');
  notice.className = 'ai-confidence-notice';
  notice.hidden = true;
  const answer = card.querySelector('.ai-answer');
  card.insertBefore(notice, answer || card.firstChild);
  return notice;
}

function renderAiConfidenceNotice(confidence, target = null) {
  const element = target || ensureAiConfidenceNotice(_aiActiveAnswerElement?.closest?.('.ai-answer-card'));
  if (!element) return;
  const guarded = confidence?.level === 'low';
  element.textContent = guarded
    ? String(confidence.message || '检索依据有限，回答将严格限于书中可确认内容。')
    : '';
  element.hidden = !guarded;
  element.dataset.tone = guarded ? 'warning' : '';
}

function resetAiConversation({ clearConversationId = false, clearConversationList = false } = {}) {
  closeAiConversationConfirmation({ restoreFocus: false });
  _aiConversation = [];
  if (clearConversationId) {
    _aiConversationId = null;
    _aiConversationBookId = null;
    _aiConversationPersistenceAvailable = false;
  }
  if (clearConversationList) _aiConversationList = [];
  _aiActiveAnswerElement = null;
  _aiActiveSourcesElement = null;
  const messages = aiElement('aiMessages');
  const initialAnswer = aiElement('aiInitialAnswerCard');
  if (messages && initialAnswer) {
    for (const child of [...messages.children]) {
      if (child !== initialAnswer) child.remove();
    }
  }
  if (initialAnswer) initialAnswer.hidden = true;
  const answer = aiElement('aiAnswer');
  const sources = aiElement('aiSources');
  if (answer) {
    answer.innerHTML = '';
    answer.hidden = true;
  }
  if (sources) sources.replaceChildren();
  const newReply = aiElement('aiNewReply');
  if (newReply) newReply.hidden = true;
}

function getAiConversationState() {
  return {
    conversationId: _aiConversationId,
    conversationList: _aiConversationList.slice(),
    bookId: _aiConversationBookId,
    restoring: _aiConversationRestoring,
    persistenceAvailable: _aiConversationPersistenceAvailable
  };
}

function formatAiConversationTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  } catch {
    return '';
  }
}

function normalizeAiConversationSummary(item) {
  if (!item?.id) return null;
  const messageCount = Number(item.messageCount);
  return {
    id: String(item.id),
    title: normalizeAiText(item.title) || '未命名会话',
    messageCount: Number.isFinite(messageCount) && messageCount >= 0 ? messageCount : 0,
    updatedAt: item.updatedAt || item.createdAt || ''
  };
}

function setAiConversationManagementStatus(message, tone = '') {
  const status = aiElement('aiConversationStatus');
  if (!status) return;
  status.textContent = String(message || '');
  status.dataset.tone = tone;
  status.hidden = !message;
  const retry = aiElement('btnRetryAiConversations');
  if (retry && tone !== 'error') retry.hidden = true;
}

function setAiConversationManagementBusy(busy) {
  _aiConversationManageBusy = Boolean(busy);
  const refresh = aiElement('btnRefreshAiConversations');
  if (refresh) refresh.disabled = _aiConversationManageBusy;
  const rows = aiElement('aiConversationList')?.querySelectorAll?.('button') || [];
  rows.forEach((button) => {
    button.disabled = _aiConversationManageBusy;
  });
  const confirmView = aiElement('aiConversationConfirmView');
  const confirmBusy = _aiConversationManageBusy || _aiConversationConfirmationPending;
  if (confirmView) confirmView.classList.toggle('is-pending', confirmBusy);
  const cancel = aiElement('btnCancelAiConversationConfirm');
  const confirm = aiElement('btnConfirmAiConversationAction');
  if (cancel) cancel.disabled = confirmBusy;
  if (confirm) confirm.disabled = confirmBusy;
}

function renderAiConversationList() {
  const list = aiElement('aiConversationList');
  const empty = aiElement('aiConversationEmpty');
  if (!list) return;
  list.replaceChildren();
  const summaries = _aiConversationList
    .map(normalizeAiConversationSummary)
    .filter(Boolean);
  _aiConversationList = summaries;
  if (empty) empty.hidden = summaries.length > 0;
  for (const summary of summaries) {
    const row = document.createElement('article');
    row.className = `ai-conversation-row${summary.id === _aiConversationId ? ' is-active' : ''}`;
    row.dataset.aiConversationId = summary.id;
    row.setAttribute('role', 'listitem');
    if (summary.id === _aiConversationId) row.setAttribute('aria-current', 'true');

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'ai-conversation-open';
    open.setAttribute('aria-label', `打开会话：${summary.title}`);
    const title = document.createElement('span');
    title.className = 'ai-conversation-title';
    title.textContent = summary.title;
    const meta = document.createElement('span');
    meta.className = 'ai-conversation-meta';
    const time = formatAiConversationTime(summary.updatedAt);
    meta.textContent = `${summary.messageCount} 条消息${time ? ` · ${time}` : ''}`;
    open.append(title, meta);
    open.addEventListener('click', () => void selectAiConversation(summary.id));

    const actions = document.createElement('div');
    actions.className = 'ai-conversation-actions';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'ai-conversation-clear';
    clear.textContent = '清空';
    clear.addEventListener('click', (event) => {
      requestAiConversationConfirmation('clear', summary.id, event.currentTarget);
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ai-conversation-delete';
    remove.textContent = '删除';
    remove.addEventListener('click', (event) => {
      requestAiConversationConfirmation('delete', summary.id, event.currentTarget);
    });
    actions.append(clear, remove);
    row.append(open, actions);
    list.appendChild(row);
  }
  setAiConversationManagementBusy(_aiConversationManageBusy);
}

function closeAiConversationsSheet({ restoreFocus = true } = {}) {
  closeAiConversationConfirmation({ restoreFocus: false });
  const sheet = aiElement('aiConversationsView');
  if (sheet) sheet.hidden = true;
  if (restoreFocus && _aiConversationManageReturnFocus?.isConnected) _aiConversationManageReturnFocus.focus();
  _aiConversationManageReturnFocus = null;
}

async function openAiConversationsSheet(trigger = document.activeElement) {
  const sheet = aiElement('aiConversationsView');
  if (!sheet || !state.currentBookId) return false;
  closeAiConfigSheet({ restoreFocus: false });
  _aiConversationManageReturnFocus = trigger;
  sheet.hidden = false;
  setAiConversationManagementStatus('', 'ready');
  renderAiConversationList();
  aiElement('btnCloseAiConversationsSheet')?.focus();
  return true;
}

async function refreshAiConversationList() {
  const bookId = state.currentBookId;
  if (!bookId || typeof browserHost?.getAiConversations !== 'function') {
    setAiConversationManagementStatus('当前书籍暂不支持会话列表。', 'error');
    return false;
  }
  const token = ++_aiConversationRestoreToken;
  setAiConversationManagementBusy(true);
  setAiConversationManagementStatus('正在加载会话列表…', 'busy');
  try {
    const summary = await browserHost.getAiConversations(bookId);
    if (token !== _aiConversationRestoreToken || state.currentBookId !== bookId) return false;
    _aiConversationPersistenceAvailable = true;
    _aiConversationList = Array.isArray(summary?.conversations) ? summary.conversations.slice() : [];
    if (!_aiConversationId || !_aiConversationList.some((item) => String(item.id) === _aiConversationId)) {
      _aiConversationId = summary?.activeConversationId || _aiConversationList[0]?.id || null;
    }
    _aiConversationBookId = bookId;
    renderAiConversationList();
    setAiConversationManagementStatus('', 'ready');
    return true;
  } catch (error) {
    if (token === _aiConversationRestoreToken && state.currentBookId === bookId) {
      setAiConversationManagementStatus(error.message || '会话列表加载失败，请点击“重试”。', 'error');
      const retry = aiElement('btnRetryAiConversations');
      if (retry) retry.hidden = false;
      renderAiConversationList();
    }
    return false;
  } finally {
    if (token === _aiConversationRestoreToken) setAiConversationManagementBusy(false);
  }
}

async function loadAiConversationDetail(conversationId, { closeOnSuccess = true } = {}) {
  const bookId = state.currentBookId;
  if (!bookId || !conversationId || typeof browserHost?.getAiConversation !== 'function') return false;
  setAiConversationManagementBusy(true);
  setAiConversationManagementStatus('正在打开会话…', 'busy');
  try {
    const conversation = await browserHost.getAiConversation(conversationId, bookId);
    if (state.currentBookId !== bookId) return false;
    if (!conversation || String(conversation.id) !== String(conversationId)) throw new Error('会话内容无效');
    _aiConversationId = String(conversationId);
    _aiConversationBookId = bookId;
    renderAiConversation(conversation);
    renderAiConversationList();
    setAiConversationManagementStatus('', 'ready');
    if (closeOnSuccess) closeAiConversationsSheet();
    return true;
  } catch (error) {
    setAiConversationManagementStatus(error.message || '会话打开失败，请重试。', 'error');
    return false;
  } finally {
    setAiConversationManagementBusy(false);
  }
}

async function selectAiConversation(conversationId) {
  if (_aiConversationManageBusy || String(conversationId) === String(_aiConversationId)) {
    if (String(conversationId) === String(_aiConversationId)) closeAiConversationsSheet();
    return false;
  }
  return loadAiConversationDetail(String(conversationId));
}

function requestAiConversationConfirmation(action, conversationId, trigger) {
  if (_aiConversationManageBusy || _aiConversationConfirmationPending || !state.currentBookId) return false;
  if (action !== 'clear' && action !== 'delete') return false;
  const summary = normalizeAiConversationSummary(_aiConversationList.find((item) => (
    String(item?.id) === String(conversationId)
  )));
  const view = aiElement('aiConversationConfirmView');
  const conversations = aiElement('aiConversationsView');
  if (!summary || !view || !conversations) return false;
  const isClear = action === 'clear';
  const title = isClear ? '清空此会话？' : '删除此会话？';
  const description = isClear
    ? `将删除“${summary.title}”中的 ${summary.messageCount} 条消息。此操作无法撤销。`
    : `将删除“${summary.title}”及其中全部消息。此操作无法恢复。`;
  aiElement('aiConversationConfirmTitle').textContent = title;
  aiElement('aiConversationConfirmDescription').textContent = description;
  const confirm = aiElement('btnConfirmAiConversationAction');
  if (confirm) {
    confirm.textContent = isClear ? '清空会话' : '删除会话';
    confirm.dataset.action = action;
  }
  _aiConversationConfirmation = {
    action,
    conversationId: summary.id,
    title: summary.title,
    messageCount: summary.messageCount,
    bookId: state.currentBookId,
    trigger
  };
  view.dataset.action = action;
  conversations.setAttribute('aria-hidden', 'true');
  view.hidden = false;
  queueMicrotask(() => {
    if (_aiConversationConfirmation && !view.hidden) aiElement('btnCancelAiConversationConfirm')?.focus();
  });
  return true;
}

function closeAiConversationConfirmation({ restoreFocus = true } = {}) {
  const confirmation = _aiConversationConfirmation;
  const view = aiElement('aiConversationConfirmView');
  if (view) {
    view.hidden = true;
    view.classList.remove('is-pending');
    delete view.dataset.action;
  }
  const conversations = aiElement('aiConversationsView');
  if (conversations) conversations.removeAttribute('aria-hidden');
  const confirm = aiElement('btnConfirmAiConversationAction');
  if (confirm) {
    confirm.disabled = false;
    delete confirm.dataset.action;
  }
  const cancel = aiElement('btnCancelAiConversationConfirm');
  if (cancel) cancel.disabled = false;
  _aiConversationConfirmation = null;
  _aiConversationConfirmationPending = false;
  if (restoreFocus && confirmation?.trigger?.isConnected) confirmation.trigger.focus();
}

function trapAiConversationConfirmationFocus(event) {
  if (event.key !== 'Tab' || _aiConversationConfirmationPending) return;
  const cancel = aiElement('btnCancelAiConversationConfirm');
  const confirm = aiElement('btnConfirmAiConversationAction');
  if (!cancel || !confirm) return;
  if (event.shiftKey && document.activeElement === cancel) {
    event.preventDefault();
    confirm.focus();
  } else if (!event.shiftKey && document.activeElement === confirm) {
    event.preventDefault();
    cancel.focus();
  }
}

async function executeAiConversationConfirmation() {
  const confirmation = _aiConversationConfirmation;
  if (!confirmation || _aiConversationConfirmationPending || confirmation.bookId !== state.currentBookId) {
    if (confirmation && confirmation.bookId !== state.currentBookId) closeAiConversationConfirmation({ restoreFocus: false });
    return false;
  }
  _aiConversationConfirmationPending = true;
  closeAiConversationConfirmation({ restoreFocus: false });
  try {
    if (confirmation.action === 'clear') {
      return await performClearAiConversationItem(confirmation.conversationId, confirmation.bookId);
    }
    return await performDeleteAiConversationItem(confirmation.conversationId, confirmation.bookId);
  } finally {
    _aiConversationConfirmationPending = false;
  }
}

async function performClearAiConversationItem(conversationId, bookId) {
  if (!bookId || typeof browserHost?.clearAiConversation !== 'function') return false;
  setAiConversationManagementBusy(true);
  setAiConversationManagementStatus('正在清空会话…', 'busy');
  try {
    await browserHost.clearAiConversation(conversationId, bookId);
    if (state.currentBookId !== bookId) return false;
    if (String(conversationId) === String(_aiConversationId)) {
      resetAiConversation();
      _aiConversationId = String(conversationId);
      _aiConversationBookId = bookId;
    }
    _aiConversationList = _aiConversationList.map((item) => (
      String(item.id) === String(conversationId) ? { ...item, messageCount: 0 } : item
    ));
    renderAiConversationList();
    setAiConversationManagementStatus('', 'ready');
    return true;
  } catch (error) {
    if (state.currentBookId === bookId) {
      setAiConversationManagementStatus(error.message || '清空失败，请重试。', 'error');
    }
    return false;
  } finally {
    setAiConversationManagementBusy(false);
  }
}

async function performDeleteAiConversationItem(conversationId, bookId) {
  if (!bookId || typeof browserHost?.deleteAiConversation !== 'function') return false;
  setAiConversationManagementBusy(true);
  setAiConversationManagementStatus('正在删除会话…', 'busy');
  try {
    await browserHost.deleteAiConversation(conversationId, bookId);
    if (state.currentBookId !== bookId) return false;
    _aiConversationList = _aiConversationList.filter((item) => String(item.id) !== String(conversationId));
    if (String(conversationId) === String(_aiConversationId)) {
      const next = _aiConversationList[0];
      if (next) {
        setAiConversationManagementBusy(false);
        return loadAiConversationDetail(next.id, { closeOnSuccess: false });
      }
      resetAiConversation({ clearConversationId: true });
      _aiConversationPersistenceAvailable = true;
      _aiConversationBookId = bookId;
    }
    renderAiConversationList();
    setAiConversationManagementStatus('', 'ready');
    return true;
  } catch (error) {
    if (state.currentBookId === bookId) {
      setAiConversationManagementStatus(error.message || '删除失败，请重试。', 'error');
    }
    return false;
  } finally {
    setAiConversationManagementBusy(false);
  }
}

function setAiConversationRetryVisible(visible) {
  const status = aiElement('aiStatus');
  if (!status?.parentElement) return;
  let button = aiElement('btnAiRetryConversation');
  if (!button && visible) {
    button = document.createElement('button');
    button.type = 'button';
    button.id = 'btnAiRetryConversation';
    button.className = 'ai-conversation-retry';
    button.textContent = '重试';
    button.addEventListener('click', () => void restoreAiConversation());
    status.parentElement.appendChild(button);
  }
  if (button) button.hidden = !visible;
}

function renderAiConversation(conversation) {
  resetAiConversation();
  for (const message of Array.isArray(conversation?.messages) ? conversation.messages : []) {
    if (message.role === 'user') {
      appendAiUserMessage(message.content);
      _aiConversation.push({ role: 'user', content: message.content });
      continue;
    }
    if (message.role !== 'assistant') continue;
    const assistant = prepareAiAssistantMessage();
    renderAiSources(message.sources || [], assistant.sources, message.content);
    renderAiAnswer(message.content, assistant.answer, message.sources || []);
    _aiConversation.push({ role: 'assistant', content: message.content });
  }
  scrollAiConversationToBottom();
}

async function restoreAiConversation() {
  const bookId = state.currentBookId;
  if (_aiBusy) return false;
  if (!bookId || typeof browserHost?.getAiConversations !== 'function') {
    _aiConversationPersistenceAvailable = false;
    return false;
  }
  const token = ++_aiConversationRestoreToken;
  const requestGeneration = _aiRequestId;
  _aiConversationRestoring = true;
  _aiConversationBookId = bookId;
  setAiConversationRetryVisible(false);
  setAiStatus('正在恢复 AI 对话…', 'busy');
  resetAiConversation({ clearConversationId: true, clearConversationList: true });
  try {
    const summary = await browserHost.getAiConversations(bookId);
    if (token !== _aiConversationRestoreToken || state.currentBookId !== bookId || requestGeneration !== _aiRequestId) return false;
    _aiConversationPersistenceAvailable = true;
    _aiConversationList = Array.isArray(summary?.conversations) ? summary.conversations.slice() : [];
    const activeId = summary?.activeConversationId || _aiConversationList[0]?.id || null;
    _aiConversationId = activeId;
    renderAiConversationList();
    if (activeId && typeof browserHost.getAiConversation === 'function') {
      const conversation = await browserHost.getAiConversation(activeId, bookId);
      if (token !== _aiConversationRestoreToken || state.currentBookId !== bookId || requestGeneration !== _aiRequestId) return false;
      if (!conversation || conversation.id !== activeId) throw new Error('会话恢复结果无效');
      renderAiConversation(conversation);
    }
    setAiStatus('', 'ready');
    return true;
  } catch (error) {
    if (token === _aiConversationRestoreToken && state.currentBookId === bookId && requestGeneration === _aiRequestId) {
      resetAiConversation({ clearConversationId: true, clearConversationList: true });
      setAiStatus('会话恢复失败，请点击“重试”重新加载。', 'error');
      setAiConversationRetryVisible(true);
    }
    return false;
  } finally {
    if (token === _aiConversationRestoreToken) _aiConversationRestoring = false;
  }
}

async function ensureAiConversation() {
  if (_aiConversationId && _aiConversationBookId === state.currentBookId) return _aiConversationId;
  // Older fixtures/servers may not expose conversation persistence yet. Keep
  // the legacy ask flow usable instead of adding a failing create request.
  if (!_aiConversationPersistenceAvailable) return null;
  if (!state.currentBookId || typeof browserHost?.createAiConversation !== 'function') return null;
  try {
    const created = await browserHost.createAiConversation('', state.currentBookId);
    if (!created?.id) throw new Error('会话创建结果无效');
    _aiConversationId = created.id;
    _aiConversationBookId = state.currentBookId;
    _aiConversationList = [
      ..._aiConversationList.filter((item) => item.id !== created.id),
      { id: created.id, title: created.title || '新对话', messageCount: 0 }
    ];
    renderAiConversationList();
    return created.id;
  } catch {
    _aiConversationPersistenceAvailable = false;
    return null;
  }
}

function scrollAiConversationToBottom() {
  const scroll = aiElement('aiChatScroll');
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
  const button = aiElement('aiNewReply');
  if (button) button.hidden = true;
}

function aiConversationIsNearBottom() {
  const scroll = aiElement('aiChatScroll');
  if (!scroll) return true;
  return scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 64;
}

function setAiSendButtonState(busy) {
  const send = aiElement('btnAiAsk');
  if (!send) return;
  send.dataset.state = busy ? 'stop' : 'send';
  send.disabled = busy ? false : send.dataset.configured !== 'true';
  send.setAttribute('aria-label', busy ? '停止回答' : '发送问题');
  send.title = busy ? '停止回答' : '发送问题';
  send.innerHTML = busy
    ? '<span class="ai-stop-glyph" aria-hidden="true"></span>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"></path><path d="m6 11 6-6 6 6"></path></svg>';
}

function escapeAiHtml(value) {
  const element = document.createElement('div');
  element.textContent = String(value || '');
  return element.innerHTML;
}

function sanitizeAiMarkdownHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');

  const sanitizeChildren = (parent) => {
    for (const node of [...parent.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) continue;
      if (node.nodeType !== Node.ELEMENT_NODE) {
        node.remove();
        continue;
      }

      const tag = node.tagName.toLowerCase();
      if (AI_MARKDOWN_DROP_CONTENT_TAGS.has(tag)) {
        node.remove();
        continue;
      }
      if (!AI_MARKDOWN_ALLOWED_TAGS.has(tag)) {
        const fragment = document.createDocumentFragment();
        while (node.firstChild) fragment.appendChild(node.firstChild);
        node.replaceWith(fragment);
        sanitizeChildren(parent);
        continue;
      }

      const originalHref = tag === 'a' ? node.getAttribute('href') : null;
      for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
      if (tag === 'a') {
        if (originalHref) {
          try {
            const url = new URL(originalHref, document.baseURI);
            if (['http:', 'https:', 'mailto:'].includes(url.protocol)) {
              node.setAttribute('href', url.href);
              node.setAttribute('rel', 'noopener noreferrer');
            }
          } catch {
            // Leave an unsafe or malformed link as plain text.
          }
        }
      }
      sanitizeChildren(node);
    }
  };

  sanitizeChildren(template.content);
  return template.innerHTML;
}

function renderAiMarkdown(markdown, scope = '') {
  const source = String(markdown || '');
  if (!source) return '';
  try {
    const parser = globalThis.marked;
    if (parser && typeof parser.parse === 'function') {
      return decorateAiCitationHtml(sanitizeAiMarkdownHtml(parser.parse(source, { gfm: true, breaks: true })), scope);
    }
  } catch {
    // Fall back to escaped text if the bundled parser cannot handle a response.
  }
  return decorateAiCitationHtml(escapeAiHtml(source).replace(/\r?\n/g, '<br>'), scope);
}

function filterAiCitationsForSources(answer, sources = []) {
  const allowed = new Set((Array.isArray(sources) ? sources : []).flatMap((source, index) => {
    const indexes = Array.isArray(source?.citationIndexes) && source.citationIndexes.length
      ? source.citationIndexes
      : [source?.citationIndex || index + 1];
    return indexes.map(Number).filter((value) => Number.isInteger(value) && value > 0);
  }));
  return String(answer || '').replace(/[【〔](\d+)[】〕]/g, (marker, rawIndex) => (
    allowed.has(Number(rawIndex)) ? `【${Number(rawIndex)}】` : ''
  )).replace(/[ \t]{2,}/g, ' ').replace(/\s+([，。；：！？])/g, '$1');
}

function renderAiAnswer(answer, target = null, sources = null) {
  const element = target || _aiActiveAnswerElement || aiElement('aiAnswer');
  if (!element) return;
  const followAnswer = aiConversationIsNearBottom();
  const renderedSources = sources === null
    ? Array.from(_aiActiveSourcesElement?.querySelectorAll?.('[data-ai-source-index]') || [])
      .map((item) => ({ citationIndex: Number(item.dataset?.aiSourceIndex) }))
    : sources;
  const hasSourceContract = sources !== null || renderedSources.length > 0;
  const safeAnswer = hasSourceContract
    ? filterAiCitationsForSources(answer, renderedSources)
    : String(answer || '');
  element.innerHTML = renderAiMarkdown(safeAnswer, aiSourceScopeFor(element));
  element.hidden = !safeAnswer;
  bindAiCitationLinks(element);
  if (followAnswer) scrollAiConversationToBottom();
  else {
    const button = aiElement('aiNewReply');
    if (button) button.hidden = false;
  }
}

function syncReaderLayoutAfterAiToggle() {
  if (state.contentType !== 'epub' || typeof measurePagination !== 'function') return;
  requestAnimationFrame(() => measurePagination({ preserveLocator: true }));
}

async function buildCurrentBookIndex() {
  if (_aiIndex && _aiIndexBookId === state.currentBookId) return _aiIndex;
  if (state.contentType !== 'epub' || !state.epubArchive?.spine?.length) throw new Error('AI 仅支持 EPUB 书本');
  const chapters = [];
  const total = state.epubArchive.spine.length;
  for (let index = 0; index < total; index += 1) {
    setAiStatus(`正在思考并读取本书内容（${index + 1}/${total}）…`, 'busy');
    const chapter = await loadEpubChapterText(state.epubArchive, index);
    chapters.push({ ...chapter, label: aiChapterLabel(index) });
  }
  _aiIndex = buildBookSearchIndex(chapters);
  _aiIndexBookId = state.currentBookId;
  return _aiIndex;
}

function normalizeAiSearchMatches(matches) {
  return (Array.isArray(matches) ? matches : [])
    .map((item) => ({
      ...item,
      chapterLabel: Number.isInteger(item?.chapterIndex)
        ? aiChapterLabel(item.chapterIndex)
        : String(item?.chapterLabel || '当前章节')
    }))
    .filter((item) => item.text);
}

function assessAiRetrievalConfidence(matches, { query = '', selectedText = '' } = {}) {
  const items = Array.isArray(matches) ? matches : [];
  if (!items.length) {
    return { level: 'none', guarded: true, reason: 'no-matches', message: '没有检索到足够的书本内容，请换一种问法。' };
  }
  const queryTerms = new Set(aiTerms(`${query} ${selectedText}`));
  const selectedNeedle = normalizeAiText(selectedText);
  const scored = items.map((item) => {
    const text = normalizeAiText(item.text);
    const itemTerms = new Set(item.terms || aiTerms(text));
    const matchedTermCount = [...queryTerms].filter((term) => itemTerms.has(term)).length;
    const lexicalScore = Number.isFinite(Number(item.lexicalScore)) ? Number(item.lexicalScore) : matchedTermCount;
    const selectedHit = Boolean(selectedNeedle && text.includes(selectedNeedle));
    const sourceSet = new Set(Array.isArray(item.retrievalSources) ? item.retrievalSources : []);
    return {
      lexicalScore,
      queryCoverage: queryTerms.size ? matchedTermCount / queryTerms.size : 0,
      selectedHit,
      sourceAgreement: sourceSet.has('fts') && sourceSet.has('lexical')
    };
  }).sort((left, right) => (
    Number(right.selectedHit) - Number(left.selectedHit)
    || right.lexicalScore - left.lexicalScore
    || right.queryCoverage - left.queryCoverage
  ));
  const best = scored[0];
  const highConfidence = best.selectedHit
    || (best.queryCoverage >= 0.4 && best.lexicalScore >= 4)
    || (best.sourceAgreement && best.queryCoverage >= 0.5 && best.lexicalScore >= 3);
  return {
    level: highConfidence ? 'high' : 'low',
    guarded: !highConfidence,
    reason: highConfidence ? 'matched-evidence' : 'weak-term-coverage',
    topScore: best.lexicalScore,
    queryCoverage: best.queryCoverage,
    message: highConfidence
      ? '书本检索依据充分。'
      : '检索到的书本依据与问题匹配度有限，回答将严格限于可确认内容。'
  };
}

async function retrieveAiMatches(question, selectedText, chapter) {
  if (typeof browserHost.searchAiBook === 'function') {
    try {
      const remote = await Promise.race([
        browserHost.searchAiBook(state.currentBookId, {
          question,
          selectedText,
          chapter
        }),
        new Promise((_, reject) => window.setTimeout(
          () => reject(new Error('远程检索超时')),
          AI_REMOTE_SEARCH_TIMEOUT_MS
        ))
      ]);
      const matches = normalizeAiSearchMatches(remote?.matches);
      if (remote?.scope === 'chapter' || remote?.scope === 'section'
        || remote?.retrievalStatus === 'insufficient_scope') {
        return {
          matches,
          confidence: remote?.confidence || assessAiRetrievalConfidence(matches, { query: question, selectedText }),
          chapterResolution: remote?.chapterResolution || null,
          retrievalStatus: remote?.retrievalStatus || (matches.length ? 'ok' : 'no_matches'),
          intent: remote?.intent || 'chapter_lookup',
          scope: remote.scope
        };
      }
      if (remote?.intent === 'book_summary') {
        return {
          matches,
          confidence: remote?.confidence || { level: 'low', message: '将按目录抽取代表性章节原文。' },
          chapterResolution: null,
          retrievalStatus: 'ok',
          intent: 'book_summary',
          scope: 'book'
        };
      }
      if (matches.length) {
        return {
          matches,
          confidence: remote?.confidence || assessAiRetrievalConfidence(matches, { query: question, selectedText }),
          chapterResolution: remote?.chapterResolution || null,
          retrievalStatus: remote?.retrievalStatus || 'ok',
          intent: remote?.intent || 'lookup',
          scope: remote?.scope || 'book'
        };
      }
    } catch {
      // The server-side FTS index is an optimization. Keep the existing local
      // index as a transparent fallback when the runtime lacks SQLite/FTS5 or
      // an index build/search fails.
    }
  }
  const index = await buildCurrentBookIndex();
  const matches = searchBookIndex(index, {
    query: question,
    selectedText,
    currentChapterIndex: chapter.index
  });
  return {
    matches,
    confidence: assessAiRetrievalConfidence(matches, { query: question, selectedText }),
    chapterResolution: null
  };
}

async function refreshAiStatus() {
  const question = aiElement('aiQuestion');
  const send = aiElement('btnAiAsk');
  if (state.contentType !== 'epub' && state.contentType !== 'pdf') {
    setAiStatus('AI 阅读助手仅支持 EPUB 和 PDF。');
    if (send) {
      send.dataset.configured = 'false';
      send.disabled = true;
    }
    if (question) question.disabled = true;
    return false;
  }
  try {
    const status = await browserHost.aiStatus();
    return applyAiStatus(status);
  } catch (error) {
    setAiStatus(error.message || 'AI 服务状态读取失败', 'error');
    if (send) {
      send.dataset.configured = 'false';
      send.disabled = true;
    }
    if (question) question.disabled = true;
    return false;
  }
}

function configurePdfAiDisclosure() {
  const row = aiElement('aiPdfScopeRow');
  if (!row) return;
  const isPdf = state.contentType === 'pdf';
  row.hidden = !isPdf;
}

function pdfAiScopeInput() {
  const reader = window.pdfReaderController;
  const selectedText = normalizeAiText(_aiSelection?.text);
  if (selectedText) {
    const pageCount = reader?.getPageCount?.() || 0;
    if (!pageCount) throw new Error('PDF 尚未准备好，请稍后重试。');
    const pageIndex = _aiSelection?.targets?.[0]?.pageIndex;
    if (!Number.isInteger(pageIndex) || _aiSelection?.targets?.length !== 1) {
      throw new Error('请选择同一页的 PDF 文本后提问。');
    }
    return { scope: 'selection', pageIndex, selectedText: selectedText.slice(0, 1200) };
  }
  return { scope: 'searchable_book' };
}

function applyAiStatus(status) {
  const question = aiElement('aiQuestion');
  const send = aiElement('btnAiAsk');
  const configured = Boolean(status?.configured);
  // Mark the send button first: setAiStatus turns a 'ready' message into the
  // "not configured" warning while the button still says configured=false,
  // which kept that warning up right after a successful save.
  if (send) {
    send.dataset.configured = configured ? 'true' : 'false';
    if (!_aiBusy) send.disabled = !configured;
  }
  setAiStatus(configured ? `已连接 · ${status.model || 'OpenAI'}` : '尚未配置 AI 服务，请先填写 AI 设置。', configured ? 'ready' : 'warning');
  if (question) question.disabled = !configured;
  return configured;
}

async function loadAiConfig() {
  const baseUrl = aiElement('aiBaseUrl');
  const model = aiElement('aiModel');
  const apiKey = aiElement('aiApiKey');
  const hint = aiElement('aiConfigHint');
  try {
    const config = await browserHost.getAiConfig();
    if (baseUrl) baseUrl.value = config.baseUrl || '';
    if (model) model.value = config.model || '';
    if (apiKey) apiKey.value = '';
    setAiClearKeyPending(false);
    if (aiElement('btnClearAiKey')) aiElement('btnClearAiKey').disabled = !config.hasApiKey;
    if (hint) hint.textContent = config.hasApiKey ? '当前已配置 API Key；留空保存可保留原 Key。' : '尚未配置 API Key。支持 OpenAI 及兼容 Responses API 的服务。';
    return config;
  } catch (error) {
    if (hint) hint.textContent = error.message || 'AI 配置读取失败';
    return null;
  }
}

function setAiClearKeyPending(pending) {
  _aiClearApiKey = Boolean(pending);
  const button = aiElement('btnClearAiKey');
  if (!button) return;
  button.classList.toggle('is-pending', _aiClearApiKey);
  button.setAttribute('aria-pressed', String(_aiClearApiKey));
  button.textContent = _aiClearApiKey ? '取消清除' : '清除 Key';
}

function closeAiConfigSheet({ restoreFocus = true } = {}) {
  const config = aiElement('aiConfigView');
  if (config) config.hidden = true;
  if (restoreFocus && _aiConfigReturnFocus?.isConnected) _aiConfigReturnFocus.focus();
  _aiConfigReturnFocus = null;
}

async function openAiConfigSheet() {
  const config = aiElement('aiConfigView');
  if (!config) return false;
  closeAiConversationsSheet({ restoreFocus: false });
  _aiConfigReturnFocus = document.activeElement;
  config.hidden = false;
  await loadAiConfig();
  if (!config.hidden) aiElement('aiBaseUrl')?.focus();
  return true;
}

function showAiView(view) {
  if (view === 'config') return openAiConfigSheet();
  closeAiConversationsSheet({ restoreFocus: false });
  closeAiConfigSheet({ restoreFocus: false });
  aiElement('aiQuestion')?.focus();
  return true;
}

async function saveAiSettings() {
  const hint = aiElement('aiConfigHint');
  const save = aiElement('btnSaveAiSettings');
  const payload = {
    baseUrl: String(aiElement('aiBaseUrl')?.value || '').trim(),
    model: String(aiElement('aiModel')?.value || '').trim(),
    apiKey: String(aiElement('aiApiKey')?.value || '').trim(),
    clearApiKey: _aiClearApiKey
  };
  if (save) save.disabled = true;
  if (hint) hint.textContent = '正在保存…';
  try {
    const config = await browserHost.saveAiConfig(payload);
    if (aiElement('aiApiKey')) aiElement('aiApiKey').value = '';
    _aiClearApiKey = false;
    applyAiStatus(config);
    if (hint) hint.textContent = config.hasApiKey ? '配置已保存，API Key 已安全保存且不会回显。' : '配置已保存，尚未配置 API Key。';
    closeAiConfigSheet();
    return true;
  } catch (error) {
    if (hint) hint.textContent = error.message || 'AI 配置保存失败';
    return false;
  } finally {
    if (save) save.disabled = false;
  }
}

async function testAiConnection() {
  const button = aiElement('btnTestAiConnection');
  const hint = aiElement('aiConfigHint');
  const payload = {
    baseUrl: String(aiElement('aiBaseUrl')?.value || '').trim(),
    model: String(aiElement('aiModel')?.value || '').trim(),
    apiKey: String(aiElement('aiApiKey')?.value || '').trim(),
    clearApiKey: _aiClearApiKey
  };
  if (button) button.disabled = true;
  if (hint) hint.textContent = '正在测试连接…';
  try {
    const result = await browserHost.testAiConnection(payload);
    if (hint) hint.textContent = `连接成功 · ${result.model || '当前模型'}`;
    return true;
  } catch (error) {
    if (hint) hint.textContent = error.message || '连接失败，请检查配置';
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

function stopAiQuestion() {
  if (!_aiBusy) return false;
  _aiRequestId += 1;
  _aiStreamController?.abort();
  _aiStreamController = null;
  _aiBusy = false;
  setAiSendButtonState(false);
  const question = aiElement('aiQuestion');
  if (question) question.disabled = aiElement('btnAiAsk')?.dataset.configured !== 'true';
  setAiStatus('回答已停止。', 'warning');
  return true;
}

async function askPdfAiQuestion() {
  if (_aiBusy || !state.currentBookId) return false;
  const questionElement = aiElement('aiQuestion');
  const question = String(questionElement?.value || '').trim();
  if (!question) {
    setAiStatus('请先输入问题。', 'warning');
    questionElement?.focus();
    return false;
  }
  let scopeInput;
  try { scopeInput = pdfAiScopeInput(); }
  catch (error) { setAiStatus(error.message, 'warning'); return false; }
  const requestId = ++_aiRequestId;
  const bookId = state.currentBookId;
  _aiBusy = true;
  setAiSendButtonState(true);
  if (questionElement) { questionElement.disabled = true; questionElement.value = ''; }
  const userMessage = appendAiUserMessage(question);
  const assistant = prepareAiAssistantMessage();
  _aiActiveAnswerElement = assistant.answer;
  _aiActiveSourcesElement = assistant.sources;
  setAiStatus('正在检索 PDF 页证据…', 'busy');
  try {
    const conversationId = await ensureAiConversation();
    if (requestId !== _aiRequestId || bookId !== state.currentBookId) return false;
    _aiStreamController = new AbortController();
    let answer = '';
    let sources = [];
    let streamError = null;
    let persistenceWarning = false;
    let citationWarning = false;
    const result = await browserHost.askAiStream(bookId, {
      question, ...scopeInput,
      history: _aiConversation.slice(-4).map(({ role, content }) => ({ role, content: String(content).slice(0, 500) })),
      ...(conversationId ? { conversationId } : {})
    }, {
      onMeta: (meta) => {
        if (requestId !== _aiRequestId || bookId !== state.currentBookId) return;
        sources = Array.isArray(meta?.sources) ? meta.sources : [];
        setAiStatus(pdfAiStatusFromMeta(meta, sources.length), 'busy');
      },
      onDelta: (delta) => {
        if (requestId !== _aiRequestId || bookId !== state.currentBookId) return;
        answer += String(delta || '');
        setAiStatus('正在生成并核验页码引用…', 'busy');
      },
      onDone: (done) => {
        if (requestId !== _aiRequestId || bookId !== state.currentBookId) return;
        if (done?.answer) answer = String(done.answer);
        sources = Array.isArray(done?.sources) ? done.sources : sources;
        persistenceWarning = done?.persisted === false;
        citationWarning = done?.citationIntegrity === false;
        renderAiSources(sources, null, answer);
        renderAiAnswer(answer, null, sources);
      },
      onError: (error) => { streamError = new Error(error?.message || 'PDF 问书失败'); }
    }, _aiStreamController.signal);
    if (streamError) throw streamError;
    if (requestId !== _aiRequestId || bookId !== state.currentBookId) return false;
    answer = result?.answer || answer;
    if (!answer) throw new Error('AI 没有返回可读回答。');
    renderAiSources(result?.sources || sources, null, answer);
    renderAiAnswer(answer, null, result?.sources || sources);
    _aiConversation.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
    setAiStatus(citationWarning ? '页码引用未通过核验，本轮未保存。'
      : persistenceWarning ? '回答已生成，但本轮未保存。' : '',
    citationWarning || persistenceWarning ? 'warning' : 'ready');
    return true;
  } catch (error) {
    if (requestId === _aiRequestId) {
      discardFailedAiTurn(userMessage, assistant, questionElement, question);
      setAiStatus(error.message || 'PDF 问书失败，请稍后重试。', 'error');
    }
    return false;
  } finally {
    if (requestId === _aiRequestId) {
      _aiBusy = false;
      _aiStreamController = null;
      setAiSendButtonState(false);
      if (questionElement) questionElement.disabled = aiElement('btnAiAsk')?.dataset.configured !== 'true';
      _aiActiveAnswerElement = null;
      _aiActiveSourcesElement = null;
    }
  }
}

async function askAiQuestion() {
  if (state.contentType === 'pdf') return askPdfAiQuestion();
  if (_aiBusy || !state.currentBookId) return false;
  const questionElement = aiElement('aiQuestion');
  const question = String(questionElement?.value || '').trim();
  if (!question) {
    setAiStatus('请先输入问题。', 'warning');
    questionElement?.focus();
    return false;
  }
  const requestId = ++_aiRequestId;
  _aiBusy = true;
  setAiSendButtonState(true);
  if (questionElement) questionElement.disabled = true;
  if (questionElement) questionElement.value = '';
  const userMessage = appendAiUserMessage(question);
  const assistant = prepareAiAssistantMessage();
  _aiActiveAnswerElement = assistant.answer;
  _aiActiveSourcesElement = assistant.sources;
  renderAiConfidenceNotice(null, assistant.notice);
  renderAiAnswer('');
  renderAiSources([]);
  scrollAiConversationToBottom();
  setAiStatus('正在思考并检索本书内容…', 'busy');
  try {
    const chapter = currentAiChapter();
    const retrieval = await retrieveAiMatches(question, _aiSelection?.text || '', chapter);
    if (retrieval.retrievalStatus === 'insufficient_scope') {
      throw new Error('无法准确定位当前章节，请先跳转到明确章节标题后再提问。');
    }
    const matches = retrieval.matches;
    const locationIsUncertain = Boolean(retrieval.chapterResolution)
      && (retrieval.chapterResolution.status !== 'resolved' || retrieval.chapterResolution.mappingQuality !== 'exact');
    const confidence = locationIsUncertain
      ? {
        ...retrieval.confidence,
        message: `${retrieval.confidence?.message || ''} 当前阅读位置${retrieval.chapterResolution?.status === 'resolved' ? '仅能推断' : '尚未能可靠映射'}到目录章节；章节范围问答将要求更明确的位置。`.trim()
      }
      : retrieval.confidence;
    renderAiConfidenceNotice(confidence, assistant.notice);
    if (retrieval.confidence?.level === 'low') {
      setAiStatus(`正在思考并检索本书内容… ${retrieval.confidence.message}`, 'warning');
    }
    const isBookSummary = retrieval.intent === 'book_summary';
    if (!matches.length && !isBookSummary) throw new Error('没有检索到足够的书本内容，请换一种问法。');
    const conversationId = await ensureAiConversation();
    _aiStreamController = new AbortController();
    let partialAnswer = '';
    let streamSources = matches;
    let streamError = null;
    let persistenceWarning = false;
    let summaryCacheHit = false;
    let summaryCoverage = null;
    let answerRenderScheduled = false;
    const scheduleAnswerRender = () => {
      if (answerRenderScheduled) return;
      answerRenderScheduled = true;
      requestAnimationFrame(() => {
        answerRenderScheduled = false;
        if (requestId === _aiRequestId && _aiBusy) renderAiAnswer(partialAnswer, null, streamSources);
      });
    };
    const result = await browserHost.askAiStream(state.currentBookId, {
      question,
      selectedText: _aiSelection?.text || '',
      chapter,
      retrievalConfidence: confidence?.level || 'none',
      context: matches.map(({ text, chapterIndex, chapterHref, chapterLabel }) => ({ text, chapterIndex, chapterHref, chapterLabel })),
      history: _aiConversation.slice(-12),
      ...(conversationId ? { conversationId } : {})
    }, {
      onMeta: (meta) => {
        if (requestId !== _aiRequestId) return;
        streamSources = meta?.sources || matches;
        if (meta?.scope === 'book' && meta?.coverage) summaryCoverage = meta.coverage;
        if (Number.isSafeInteger(meta?.estimatedInputTokens) && meta.estimatedInputTokens > 0) {
          const statusScope = meta?.scope === 'book' ? '代表性章节' : '本章';
          setAiStatus(`正在整理${statusScope}证据 · 输入约 ${meta.estimatedInputTokens.toLocaleString()} tokens（粗估，实际随模型而异）…`, 'busy');
        }
        const serverResolution = meta?.chapterResolution;
        if (meta?.scope !== 'book' && serverResolution
          && (serverResolution.status !== 'resolved' || serverResolution.mappingQuality !== 'exact')) {
          renderAiConfidenceNotice({
            ...confidence,
            message: `${confidence?.message || ''} 服务端未能精确确认当前目录章节；请在后续提问中补充章节信息。`.trim()
          }, assistant.notice);
        }
      },
      onDelta: (delta) => {
        if (requestId !== _aiRequestId) return;
        partialAnswer += String(delta || '');
        scheduleAnswerRender();
        setAiStatus('正在生成回答…', 'busy');
      },
      onDone: (done) => {
        if (requestId !== _aiRequestId) return;
        streamSources = done?.sources || streamSources;
        if (done?.answer) partialAnswer = String(done.answer);
        renderAiSources(streamSources, null, partialAnswer);
        renderAiAnswer(partialAnswer, null, streamSources);
        persistenceWarning = done?.persisted === false;
        summaryCacheHit = done?.summaryCacheHit === true;
        if (done?.scope === 'book' && done?.coverage) summaryCoverage = done.coverage;
        if (done?.summaryConfidence?.level === 'low') {
          renderAiConfidenceNotice({ level: 'low', message: done.summaryConfidence.message }, assistant.notice);
        }
      },
      onError: (error) => {
        streamError = new Error(error?.message || 'AI 回答失败，请稍后重试。');
      }
    }, _aiStreamController.signal);
    if (streamError) throw streamError;
    if (requestId !== _aiRequestId) return false;
    const answer = result?.answer || partialAnswer;
    if (!answer) throw new Error('AI 没有返回可读回答。');
    renderAiAnswer(answer, null, result?.sources || streamSources || matches);
    renderAiSources(result?.sources || streamSources || matches, null, answer);
    _aiConversation.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
    setAiStatus(
      persistenceWarning
        ? '回答已生成，但本轮未保存。'
        : summaryCoverage && summaryCoverage.ratio < 1
          ? `全书概述抽取 ${summaryCoverage.selectedChapters}/${summaryCoverage.totalChapters} 章，结果为代表性概述。`
          : summaryCacheHit ? '已复用本地摘要缓存。' : '',
      persistenceWarning ? 'warning' : 'ready'
    );
    return true;
  } catch (error) {
    if (requestId === _aiRequestId) {
      discardFailedAiTurn(userMessage, assistant, questionElement, question);
      setAiStatus(error.message || 'AI 回答失败，请稍后重试。', 'error');
    }
    return false;
  } finally {
    if (requestId === _aiRequestId) {
      _aiBusy = false;
      _aiStreamController = null;
      setAiSendButtonState(false);
      if (questionElement) questionElement.disabled = aiElement('btnAiAsk')?.dataset.configured !== 'true';
      _aiActiveAnswerElement = null;
      _aiActiveSourcesElement = null;
    }
  }
}

function closeAiModal({ restoreFocus = true, cancelRequest = false } = {}) {
  if (_aiBusy && cancelRequest) stopAiQuestion();
  _aiConversationRestoreToken += 1;
  closeAiConversationConfirmation({ restoreFocus: false });
  closeAiConversationsSheet({ restoreFocus: false });
  closeAiConfigSheet({ restoreFocus: false });
  if (!_aiBusy || cancelRequest) _aiSelection = null;
  const modal = aiElement('aiModal');
  const backdrop = aiElement('aiModalBackdrop');
  if (modal) {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
  }
  if (backdrop) backdrop.hidden = true;
  document.body.classList.remove('ai-modal-open');
  setAiConversationRetryVisible(false);
  document.getElementById('btnAi')?.setAttribute('aria-expanded', 'false');
  syncReaderLayoutAfterAiToggle();
  if (restoreFocus && _aiModalReturnFocus?.isConnected) _aiModalReturnFocus.focus();
  _aiModalReturnFocus = null;
}

async function openAiModal(session = null, trigger = document.activeElement) {
  if (state.contentType !== 'epub' && state.contentType !== 'pdf') {
    showHighlightHint('AI 阅读助手仅支持 EPUB 和 PDF');
    return false;
  }
  const modal = aiElement('aiModal');
  const backdrop = aiElement('aiModalBackdrop');
  if (!modal) return false;
  _aiModalReturnFocus = trigger;
  if (typeof readerSurfaceController !== 'undefined') {
    readerSurfaceController.close({ restoreFocus: false });
  } else if (typeof closeReaderPanel === 'function') {
    closeReaderPanel({ restoreFocus: false });
  }
  const continuing = _aiBusy;
  if (!continuing) _aiSelection = session || null;
  configurePdfAiDisclosure();
  renderAiSelection();
  renderAiPromptSuggestions();
  showAiView('chat');
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  if (backdrop) backdrop.hidden = false;
  document.body.classList.add('ai-modal-open');
  document.getElementById('btnAi')?.setAttribute('aria-expanded', 'true');
  syncReaderLayoutAfterAiToggle();
  if (continuing) return true;
  const requestGeneration = _aiRequestId;
  await refreshAiStatus();
  if (requestGeneration === _aiRequestId && !modal.hidden) await restoreAiConversation();
  if (!modal.hidden) aiElement('aiQuestion')?.focus();
  return true;
}

async function openAiForSelection(session) {
  _aiSelection = session || null;
  return openAiModal(session, document.activeElement);
}

function setupAiPanel() {
  if (_aiSetup) return;
  _aiSetup = true;
  aiElement('aiNewReply')?.addEventListener('click', scrollAiConversationToBottom);
  aiElement('aiChatScroll')?.addEventListener('scroll', () => {
    if (aiConversationIsNearBottom()) {
      const button = aiElement('aiNewReply');
      if (button) button.hidden = true;
    }
  });
  aiElement('btnAiAsk')?.addEventListener('click', () => {
    if (_aiBusy) stopAiQuestion();
    else void askAiQuestion();
  });
  aiElement('btnAiConversations')?.addEventListener('click', () => {
    void openAiConversationsSheet(aiElement('btnAiConversations'));
  });
  aiElement('btnRefreshAiConversations')?.addEventListener('click', () => {
    void refreshAiConversationList();
  });
  aiElement('btnRetryAiConversations')?.addEventListener('click', () => {
    void refreshAiConversationList();
  });
  aiElement('btnCloseAiConversationsSheet')?.addEventListener('click', () => closeAiConversationsSheet());
  aiElement('btnCloseAiConversationsBackdrop')?.addEventListener('click', () => closeAiConversationsSheet());
  aiElement('btnCloseAiConversationConfirmBackdrop')?.addEventListener('click', () => closeAiConversationConfirmation());
  aiElement('btnCancelAiConversationConfirm')?.addEventListener('click', () => closeAiConversationConfirmation());
  aiElement('btnConfirmAiConversationAction')?.addEventListener('click', () => {
    void executeAiConversationConfirmation();
  });
  aiElement('aiConversationConfirmView')?.addEventListener('keydown', trapAiConversationConfirmationFocus);
  aiElement('btnAiNewConversation')?.addEventListener('click', async () => {
    if (_aiBusy) stopAiQuestion();
    if (!state.currentBookId || typeof browserHost?.createAiConversation !== 'function') {
      resetAiConversation({ clearConversationId: true, clearConversationList: true });
      setAiStatus('', 'ready');
      aiElement('aiQuestion')?.focus();
      return;
    }
    const button = aiElement('btnAiNewConversation');
    if (button) button.disabled = true;
    try {
      const created = await browserHost.createAiConversation('', state.currentBookId);
      if (!created?.id) throw new Error('新对话创建失败');
      _aiConversationId = created.id;
      _aiConversationBookId = state.currentBookId;
      _aiConversationList = [
        ..._aiConversationList.filter((item) => item.id !== created.id),
        { id: created.id, title: created.title || '新对话', messageCount: 0 }
      ];
      renderAiConversationList();
      resetAiConversation();
      setAiStatus('', 'ready');
      aiElement('aiQuestion')?.focus();
    } catch (error) {
      setAiStatus(error.message || '新对话创建失败，请稍后重试。', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  });
  aiElement('btnCloseAiModal')?.addEventListener('click', () => closeAiModal());
  aiElement('btnAiSettings')?.addEventListener('click', () => showAiView('config'));
  aiElement('btnCloseAiConfig')?.addEventListener('click', () => closeAiConfigSheet());
  aiElement('btnCloseAiConfigBackdrop')?.addEventListener('click', () => closeAiConfigSheet());
  aiElement('btnSaveAiSettings')?.addEventListener('click', () => void saveAiSettings());
  aiElement('btnTestAiConnection')?.addEventListener('click', () => void testAiConnection());
  aiElement('btnClearAiKey')?.addEventListener('click', () => {
    const clearButton = aiElement('btnClearAiKey');
    if (!clearButton || clearButton.disabled) return;
    const pending = clearButton.getAttribute('aria-pressed') !== 'true';
    setAiClearKeyPending(pending);
    if (pending && aiElement('aiApiKey')) aiElement('aiApiKey').value = '';
    const hint = aiElement('aiConfigHint');
    if (hint) hint.textContent = pending ? '保存后将清除当前 API Key。' : '当前已配置 API Key；留空保存可保留原 Key。';
  });
  aiElement('aiApiKey')?.addEventListener('input', (event) => {
    if (String(event.currentTarget?.value || '').trim()) setAiClearKeyPending(false);
  });
  document.querySelectorAll('[data-ai-prompt]').forEach((button) => {
    button.addEventListener('click', () => {
      const question = aiElement('aiQuestion');
      if (question) {
        question.value = button.dataset.aiPrompt || '';
        question.focus();
      }
    });
  });
  aiElement('aiQuestion')?.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229 || event.key !== 'Enter' || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void askAiQuestion();
  });
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.key !== 'Escape' || aiElement('aiModal')?.hidden !== false) return;
    event.preventDefault();
    event.stopPropagation();
    if (aiElement('aiConversationConfirmView')?.hidden === false) closeAiConversationConfirmation();
    else if (aiElement('aiConversationsView')?.hidden === false) closeAiConversationsSheet();
    else if (aiElement('aiConfigView')?.hidden === false) closeAiConfigSheet();
    else closeAiModal();
  });
}

window.__babyReaderAiApi = {
  currentAiChapter,
  buildBookSearchIndex,
  chunkChapterText,
  searchBookIndex,
  openAiModal,
  closeAiModal,
  openAiForSelection,
  openAiConfigSheet,
  closeAiConfigSheet,
  saveAiSettings,
  testAiConnection,
  assessAiRetrievalConfidence,
  getAiConversationState,
  restoreAiConversation,
  openAiConversationsSheet,
  closeAiConversationsSheet,
  refreshAiConversationList,
  renderAiConversationList,
  setupAiPanel,
  askAiQuestion,
  stopAiQuestion,
  refreshAiStatus,
  renderAiMarkdown,
  renderAiAnswer,
  renderAiSources,
  extractAiCitationIndexes,
  renderAiSelection,
  renderAiPromptSuggestions,
  pdfAiStatusFromMeta
};
