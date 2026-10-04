package com.zhenshu.client;

import android.content.Context;
import android.os.Build;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.textclassifier.TextClassifier;
import android.webkit.WebView;

/**
 * The reading web view. Selecting text in a WebView starts the system's
 * floating action mode (复制 / 剪切 / 全选 / 分享, and on ColorOS also 翻译 /
 * 搜索), which covers 枕书's own selection menu. Here the action mode still
 * starts, so the selection and its handles stay, but its menu is emptied
 * after the system (and the vendor) filled it: an empty menu shows no bar.
 * The page's own menu offers 复制 and the rest.
 */
final class ReaderWebView extends WebView {
    ReaderWebView(Context context) {
        super(context);
        // No "smart selection": the system widening a selection to a whole
        // address or phone number, or turning it into a link.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) setTextClassifier(TextClassifier.NO_OP);
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback) {
        return super.startActionMode(new Quiet(callback));
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback, int type) {
        return super.startActionMode(new Quiet(callback), type);
    }

    /** Lets the system set the mode up, then removes every item it offered. */
    private static class Quiet extends ActionMode.Callback2 {
        private final ActionMode.Callback inner;

        Quiet(ActionMode.Callback inner) {
            this.inner = inner;
        }

        @Override
        public boolean onCreateActionMode(ActionMode mode, Menu menu) {
            boolean created = inner.onCreateActionMode(mode, menu);
            menu.clear();
            return created;
        }

        @Override
        public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
            inner.onPrepareActionMode(mode, menu);
            menu.clear();
            return true;
        }

        @Override
        public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
            return inner.onActionItemClicked(mode, item);
        }

        @Override
        public void onDestroyActionMode(ActionMode mode) {
            inner.onDestroyActionMode(mode);
        }

        @Override
        public void onGetContentRect(ActionMode mode, View view, android.graphics.Rect outRect) {
            if (inner instanceof ActionMode.Callback2) ((ActionMode.Callback2) inner).onGetContentRect(mode, view, outRect);
            else super.onGetContentRect(mode, view, outRect);
        }
    }
}
