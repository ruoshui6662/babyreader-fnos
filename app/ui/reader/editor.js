/* BabyReader UI module: reader/editor */

'use strict';

function renderPreview() {
  const preview = document.getElementById('preview');
  if (!preview) return;

  const raw = document.getElementById('editor')?.value || '';
  const html = preprocessCustomBlocks(raw);
  preview.innerHTML = html;
}

/* ============================================================
   Mode Switching
   ============================================================ */
function setMode(mode) {
  // EPUB files are read-only — never enter edit mode
  if (mode === 'edit' && state.contentType === 'epub') return;

  const prevMode = state.mode;
  state.mode = mode;

  const reader          = document.getElementById('reader');
  const editorContainer = document.getElementById('editorContainer');
  const editor          = document.getElementById('editor');

  if (mode === 'read') {
    // Flush editor content before switching — only if coming from edit mode
    if (prevMode === 'edit' && editor) {
      state.content = editor.value;
    }

    reader.style.display          = '';
    editorContainer.style.display = 'none';
    renderArticle();

  } else if (mode === 'edit') {
    reader.style.display          = 'none';
    editorContainer.style.display = 'flex';

    // Populate textarea with raw content
    editor.value = state.content;

    // Render initial preview
    renderPreview();

    // Focus editor
    editor.focus();
  }
}
