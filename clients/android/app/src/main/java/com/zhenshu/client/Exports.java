package com.zhenshu.client;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Files the page makes for the reader (notes as Markdown, share pictures)
 * and printing notes to PDF. A WebView cannot download the page's blob URLs
 * or open the browser's print dialog, so the page hands them over here.
 */
final class Exports {
    private static final String FOLDER = "枕书";

    private final Activity activity;
    // Kept until printing is handed to the system; a collected WebView
    // would cancel the job.
    private WebView printer;

    Exports(Activity activity) {
        this.activity = activity;
    }

    /**
     * Saves a file to 下载/枕书 (pictures to 相册/枕书). Returns where it went,
     * for the page to tell the reader, or "" when it could not be saved.
     */
    String save(String name, String mime, String base64) {
        String safeName = safeName(name);
        boolean image = mime != null && mime.startsWith("image/");
        byte[] bytes;
        try {
            bytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            return "";
        }
        String shownFolder = (image ? "相册/" : "下载/") + FOLDER + "/" + safeName;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName);
                values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                values.put(MediaStore.MediaColumns.RELATIVE_PATH,
                    (image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS) + "/" + FOLDER);
                ContentResolver resolver = activity.getContentResolver();
                Uri collection = image
                    ? MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    : MediaStore.Downloads.EXTERNAL_CONTENT_URI;
                Uri target = resolver.insert(collection, values);
                if (target == null) return "";
                try (OutputStream out = resolver.openOutputStream(target)) {
                    if (out == null) return "";
                    out.write(bytes);
                }
                return shownFolder;
            }
            // Android 8–9: the public folders need the storage permission.
            if (activity.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                activity.runOnUiThread(() -> activity.requestPermissions(
                    new String[] { android.Manifest.permission.WRITE_EXTERNAL_STORAGE }, 2));
                return "";
            }
            File folder = new File(Environment.getExternalStoragePublicDirectory(
                image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS), FOLDER);
            if (!folder.isDirectory() && !folder.mkdirs()) return "";
            File file = uniqueFile(folder, safeName);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(bytes);
            }
            MediaScannerConnection.scanFile(activity, new String[] { file.getAbsolutePath() }, new String[] { mime }, null);
            return (image ? "相册/" : "下载/") + FOLDER + "/" + file.getName();
        } catch (Exception error) {
            return "";
        }
    }

    /** Opens the system print panel for the page's HTML (“另存为 PDF”). */
    void print(String html, String title, String baseUrl) {
        activity.runOnUiThread(() -> {
            WebView view = new WebView(activity);
            printer = view;
            view.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView page, String url) {
                    // Give the web fonts a moment after the document itself.
                    // A Handler, not page.postDelayed: this web view is never
                    // attached to a window, and a detached view holds its
                    // posted tasks until it is.
                    new Handler(Looper.getMainLooper()).postDelayed(() -> {
                        PrintManager manager = (PrintManager) activity.getSystemService(Activity.PRINT_SERVICE);
                        String job = title == null || title.isEmpty() ? "枕书笔记" : title;
                        manager.print(job, page.createPrintDocumentAdapter(job),
                            new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
                        printer = null;
                    }, 800);
                }
            });
            view.getSettings().setJavaScriptEnabled(false);
            view.loadDataWithBaseURL(baseUrl, html, "text/html", "utf-8", null);
        });
    }

    private static String safeName(String name) {
        String value = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_").trim();
        if (value.isEmpty()) value = "枕书导出";
        return value.length() > 120 ? value.substring(value.length() - 120) : value;
    }

    private static File uniqueFile(File folder, String name) {
        File file = new File(folder, name);
        int dot = name.lastIndexOf('.');
        String stem = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int index = 1; file.exists(); index += 1) file = new File(folder, stem + " (" + index + ")" + ext);
        return file;
    }
}
