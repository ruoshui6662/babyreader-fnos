/* BabyReader UI module: library/view */

'use strict';

/* ============================================================
   Library View
   ============================================================ */
function renderLibrary(library) {
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
  if (welcome) welcome.style.display = 'none';
  document.body.classList.remove('is-welcome', 'is-epub', 'has-toc', 'toc-open');
  document.getElementById('reader')?.classList.remove('is-welcome');

  const shell = document.createElement('section');
  shell.className = 'library-view';

  const header = document.createElement('div');
  header.className = 'library-header';

  const title = document.createElement('h1');
  title.textContent = '书库';
  header.appendChild(title);

  const scanButton = document.createElement('button');
  scanButton.type = 'button';
  scanButton.className = 'mode-btn';
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

  const validBooks = (library?.books || []).filter((book) => book?.id && !book.error);
  if (!validBooks.length) {
    const empty = document.createElement('p');
    empty.className = 'library-empty';
    empty.textContent = '书库中还没有可阅读的 EPUB、Markdown 或 TXT 文件。请先在 fnOS 中授权书库目录，然后重新扫描。';
    shell.appendChild(empty);
  } else {
    const grid = document.createElement('div');
    grid.className = 'library-grid';
    for (const book of validBooks) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'library-book';

      if (book.coverUrl) {
        const cover = document.createElement('img');
        cover.src = book.coverUrl;
        cover.alt = '';
        cover.loading = 'lazy';
        button.appendChild(cover);
      }

      const name = document.createElement('strong');
      name.textContent = book.title || book.relativePath;
      button.appendChild(name);

      if (book.author) {
        const author = document.createElement('span');
        author.textContent = book.author;
        button.appendChild(author);
      }

      button.addEventListener('click', () => {
        window.browserHost.openBook(book).catch((error) => showHighlightHint(error.message));
      });
      grid.appendChild(button);
    }
    shell.appendChild(grid);
  }

  article.appendChild(shell);
}
