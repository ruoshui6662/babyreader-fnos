/* BabyReader UI module: library/view */

'use strict';

/* ============================================================
   Library View
   ============================================================ */
function renderLibrary(library) {
  if (typeof closeReaderPanel === 'function') closeReaderPanel({ restoreFocus: false });
  else if (typeof closeAllCustomSelects === 'function') closeAllCustomSelects();
  if (typeof closeAiModal === 'function') closeAiModal({ restoreFocus: false });
  const article = document.getElementById('article');
  const welcome = document.getElementById('welcome');
  if (!article) return;

  state.currentBookId = null;
  state.currentPath = null;
  state.currentName = null;
  state.content = '';
  state.contentType = 'text';
  destroyEpub();

  article.innerHTML = '';
  article.classList.add('is-library');
  if (welcome) welcome.style.display = 'none';
  document.body.classList.remove('is-welcome', 'is-epub', 'has-toc', 'toc-open');
  document.body.classList.add('is-library');
  document.getElementById('reader')?.classList.remove('is-welcome');

  const shell = document.createElement('section');
  shell.className = 'library-view';

  const header = document.createElement('div');
  header.className = 'library-header';

  const heading = document.createElement('div');
  heading.className = 'library-heading';

  const title = document.createElement('h1');
  title.textContent = '书库';
  heading.appendChild(title);

  const validBooks = (library?.books || []).filter((book) => book?.id && !book.error);
  const summary = document.createElement('p');
  summary.className = 'library-summary';
  summary.textContent = validBooks.length
    ? `已收录 ${validBooks.length} 本可阅读内容`
    : '你的私人阅读空间';
  heading.appendChild(summary);
  header.appendChild(heading);

  const scanButton = document.createElement('button');
  scanButton.type = 'button';
  scanButton.className = 'mode-btn library-scan-button';
  scanButton.textContent = '重新扫描';
  scanButton.addEventListener('click', async () => {
    scanButton.disabled = true;
    scanButton.textContent = '扫描中…';
    try {
      renderLibrary(await window.browserHost.scanLibrary());
    } catch (error) {
      showHighlightHint(error.message);
      scanButton.disabled = false;
      scanButton.textContent = '重新扫描';
    }
  });
  header.appendChild(scanButton);
  shell.appendChild(header);

  if (!validBooks.length) {
    const empty = document.createElement('section');
    empty.className = 'library-empty';
    empty.setAttribute('aria-live', 'polite');

    const emptyIcon = document.createElement('span');
    emptyIcon.className = 'library-empty-icon';
    emptyIcon.setAttribute('aria-hidden', 'true');
    empty.appendChild(emptyIcon);

    const emptyTitle = document.createElement('h2');
    emptyTitle.className = 'library-empty-title';
    emptyTitle.textContent = '书库还是空的';
    empty.appendChild(emptyTitle);

    const emptyCopy = document.createElement('p');
    emptyCopy.className = 'library-empty-copy';
    emptyCopy.textContent = '在 fnOS 中授权书库目录后，EPUB、Markdown 和 TXT 会出现在这里。';
    empty.appendChild(emptyCopy);
    shell.appendChild(empty);
  } else {
    const grid = document.createElement('div');
    grid.className = 'library-grid';
    for (const book of validBooks) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'library-book';

      const cover = document.createElement(book.coverUrl ? 'img' : 'span');
      cover.className = 'library-book-cover';
      if (book.coverUrl) {
        cover.src = book.coverUrl;
        cover.alt = '';
        cover.loading = 'lazy';
      } else {
        cover.setAttribute('aria-hidden', 'true');
      }
      button.appendChild(cover);

      const metadata = document.createElement('div');
      metadata.className = 'library-book-metadata';

      const name = document.createElement('strong');
      name.textContent = book.title || book.relativePath;
      metadata.appendChild(name);

      if (book.author) {
        const author = document.createElement('span');
        author.textContent = book.author;
        metadata.appendChild(author);
      }
      button.appendChild(metadata);

      button.addEventListener('click', () => {
        window.browserHost.openBook(book).catch((error) => showHighlightHint(error.message));
      });
      grid.appendChild(button);
    }
    shell.appendChild(grid);
  }

  article.appendChild(shell);
}
