/* BabyReader UI module: reader/ai */

'use strict';

const AI_CHUNK_SIZE = 900;
const AI_CHUNK_OVERLAP = 120;
const AI_MAX_RESULTS = 6;
const AI_CONTEXT_CHAR_BUDGET = AI_CHUNK_SIZE * AI_MAX_RESULTS;
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
  const index = Number.isInteger(state.epubChapterIndex) ? state.epubChapterIndex : 0;
  return { index, href: state.chapterPaths?.[index] || '', label: aiChapterLabel(index) };
}

function aiElement(id) {
  return document.getElementById(id);
}

function setAiStatus(message, tone = '') {
  const element = aiElement('aiStatus');
  if (!element) return;
  element.textContent = message;
  element.dataset.tone = tone;
  element.hidden = !['busy', 'warning', 'error'].includes(tone);
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
  const prompts = hasSelection ? AI_SELECTION_PROMPTS : AI_BOOK_PROMPTS;
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
      link.setAttribute('aria-label', `跳转到来源章节 ${index}`);
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
  title.textContent = '来源章节';
  container.appendChild(title);
  for (const source of citedSources) {
    const primaryCitationIndex = source.citedIndexes[0];
    const rawSourceLabel = normalizeAiText(source.chapterLabel || `第${Number(source.chapterIndex || 0) + 1}章`);
    const sourceLabel = normalizeAiSourceLabel(rawSourceLabel);
    const link = document.createElement('a');
    link.id = aiSourceAnchorId(scope, primaryCitationIndex);
    link.href = `#${link.id}`;
    link.dataset.aiSourceIndex = String(primaryCitationIndex);
    link.className = 'ai-source';
    link.setAttribute('aria-label', `来源章节：${rawSourceLabel}`);
    if (sourceLabel !== rawSourceLabel) link.title = rawSourceLabel;
    const indexElement = document.createElement('span');
    indexElement.className = 'ai-source-index';
    indexElement.setAttribute('aria-hidden', 'true');
    indexElement.textContent = String(primaryCitationIndex);
    const labelElement = document.createElement('span');
    labelElement.className = 'ai-source-label';
    labelElement.textContent = sourceLabel;
    link.append(indexElement, labelElement);
    const navigateSource = (event) => {
      event.preventDefault();
      if (Number.isInteger(source.chapterIndex) && typeof navigateToEpubChapter === 'function') {
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

function resetAiConversation() {
  _aiConversation = [];
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
}

function scrollAiConversationToBottom() {
  const scroll = aiElement('aiChatScroll');
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
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

function renderAiAnswer(answer, target = null) {
  const element = target || _aiActiveAnswerElement || aiElement('aiAnswer');
  if (!element) return;
  element.innerHTML = renderAiMarkdown(answer, aiSourceScopeFor(element));
  element.hidden = !answer;
  bindAiCitationLinks(element);
  scrollAiConversationToBottom();
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
      const remote = await browserHost.searchAiBook(state.currentBookId, {
        question,
        selectedText,
        chapter
      });
      const matches = normalizeAiSearchMatches(remote?.matches);
      if (matches.length) {
        return {
          matches,
          confidence: remote?.confidence || assessAiRetrievalConfidence(matches, { query: question, selectedText })
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
    confidence: assessAiRetrievalConfidence(matches, { query: question, selectedText })
  };
}

async function refreshAiStatus() {
  const question = aiElement('aiQuestion');
  const send = aiElement('btnAiAsk');
  if (state.contentType !== 'epub') {
    setAiStatus('AI 阅读助手仅支持 EPUB。');
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

function applyAiStatus(status) {
  const question = aiElement('aiQuestion');
  const send = aiElement('btnAiAsk');
  const configured = Boolean(status?.configured);
  setAiStatus(configured ? `已连接 · ${status.model || 'OpenAI'}` : '尚未配置 AI 服务，请先填写 AI 设置。', configured ? 'ready' : 'warning');
  if (send) {
    send.dataset.configured = configured ? 'true' : 'false';
    if (!_aiBusy) send.disabled = !configured;
  }
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
  _aiConfigReturnFocus = document.activeElement;
  config.hidden = false;
  await loadAiConfig();
  if (!config.hidden) aiElement('aiBaseUrl')?.focus();
  return true;
}

function showAiView(view) {
  if (view === 'config') return openAiConfigSheet();
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

async function askAiQuestion() {
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
  appendAiUserMessage(question);
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
    const matches = retrieval.matches;
    renderAiConfidenceNotice(retrieval.confidence, assistant.notice);
    if (retrieval.confidence?.level === 'low') {
      setAiStatus(`正在思考并检索本书内容… ${retrieval.confidence.message}`, 'warning');
    }
    if (!matches.length) throw new Error('没有检索到足够的书本内容，请换一种问法。');
    _aiStreamController = new AbortController();
    let partialAnswer = '';
    let streamSources = matches;
    let streamError = null;
    let answerRenderScheduled = false;
    const scheduleAnswerRender = () => {
      if (answerRenderScheduled) return;
      answerRenderScheduled = true;
      requestAnimationFrame(() => {
        answerRenderScheduled = false;
        if (requestId === _aiRequestId) renderAiAnswer(partialAnswer);
      });
    };
    const result = await browserHost.askAiStream(state.currentBookId, {
      question,
      selectedText: _aiSelection?.text || '',
      chapter,
      retrievalConfidence: retrieval.confidence?.level || 'none',
      context: matches.map(({ text, chapterIndex, chapterHref, chapterLabel }) => ({ text, chapterIndex, chapterHref, chapterLabel })),
      history: _aiConversation.slice(-12)
    }, {
      onMeta: (meta) => {
        if (requestId !== _aiRequestId) return;
        streamSources = meta?.sources || matches;
      },
      onDelta: (delta) => {
        if (requestId !== _aiRequestId) return;
        partialAnswer += String(delta || '');
        scheduleAnswerRender();
        setAiStatus('正在生成回答…', 'busy');
      },
      onDone: (done) => {
        if (requestId !== _aiRequestId) return;
        if (done?.answer) {
          partialAnswer = String(done.answer);
          renderAiAnswer(partialAnswer);
        }
        streamSources = done?.sources || streamSources;
        renderAiSources(streamSources, null, partialAnswer);
      },
      onError: (error) => {
        streamError = new Error(error?.message || 'AI 回答失败，请稍后重试。');
      }
    }, _aiStreamController.signal);
    if (streamError) throw streamError;
    if (requestId !== _aiRequestId) return false;
    const answer = result?.answer || partialAnswer;
    if (!answer) throw new Error('AI 没有返回可读回答。');
    renderAiAnswer(answer);
    renderAiSources(result?.sources || streamSources || matches, null, answer);
    _aiConversation.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
    setAiStatus('', 'ready');
    return true;
  } catch (error) {
    if (requestId === _aiRequestId) setAiStatus(error.message || 'AI 回答失败，请稍后重试。', 'error');
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

function closeAiModal({ restoreFocus = true } = {}) {
  if (_aiBusy) stopAiQuestion();
  closeAiConfigSheet({ restoreFocus: false });
  resetAiConversation();
  _aiSelection = null;
  const modal = aiElement('aiModal');
  const backdrop = aiElement('aiModalBackdrop');
  if (modal) modal.hidden = true;
  if (backdrop) backdrop.hidden = true;
  document.body.classList.remove('ai-modal-open');
  document.getElementById('btnAi')?.setAttribute('aria-expanded', 'false');
  syncReaderLayoutAfterAiToggle();
  if (restoreFocus && _aiModalReturnFocus?.isConnected) _aiModalReturnFocus.focus();
  _aiModalReturnFocus = null;
}

async function openAiModal(session = null, trigger = document.activeElement) {
  if (state.contentType !== 'epub') {
    showHighlightHint('AI 阅读助手仅支持 EPUB');
    return false;
  }
  if (typeof closeReaderPanel === 'function') closeReaderPanel({ restoreFocus: false });
  const modal = aiElement('aiModal');
  const backdrop = aiElement('aiModalBackdrop');
  if (!modal) return false;
  _aiModalReturnFocus = trigger;
  if (_aiBusy) stopAiQuestion();
  resetAiConversation();
  _aiSelection = session || null;
  renderAiSelection();
  renderAiPromptSuggestions();
  showAiView('chat');
  modal.hidden = false;
  if (backdrop) backdrop.hidden = false;
  document.body.classList.add('ai-modal-open');
  document.getElementById('btnAi')?.setAttribute('aria-expanded', 'true');
  syncReaderLayoutAfterAiToggle();
  await refreshAiStatus();
  aiElement('aiQuestion')?.focus();
  return true;
}

async function openAiForSelection(session) {
  _aiSelection = session || null;
  return openAiModal(session, document.activeElement);
}

function setupAiPanel() {
  if (_aiSetup) return;
  _aiSetup = true;
  aiElement('btnAiAsk')?.addEventListener('click', () => {
    if (_aiBusy) stopAiQuestion();
    else void askAiQuestion();
  });
  aiElement('btnAiNewConversation')?.addEventListener('click', () => {
    if (_aiBusy) stopAiQuestion();
    resetAiConversation();
    setAiStatus('', 'ready');
    aiElement('aiQuestion')?.focus();
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
    if (event.key !== 'Escape' || aiElement('aiConfigView')?.hidden !== false) return;
    event.preventDefault();
    closeAiConfigSheet();
  });
}

window.__babyReaderAiApi = {
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
  askAiQuestion,
  stopAiQuestion,
  refreshAiStatus,
  renderAiMarkdown,
  renderAiAnswer,
  renderAiSources,
  extractAiCitationIndexes,
  renderAiSelection,
  renderAiPromptSuggestions
};
