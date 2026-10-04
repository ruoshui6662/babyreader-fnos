package com.zhenshu.client;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/**
 * 枕书 Android client: a thin shell around the 枕书 pages served by the NAS.
 *
 * The first launch asks for the address used in a browser (for example
 * http://192.168.1.10:5666); the pages then load from there, so the client is
 * always the same version as the FPK and signs in through fnOS itself.
 *
 * The page talks to the shell through window.ZhenshuNative (this class's
 * Bridge), and the shell calls back into window.zhenshuNative (defined by the
 * page) for the back key and volume-key page turns.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "zhenshu";
    private static final String KEY_SERVER = "server";
    private static final String APP_PATH = "/app/zhenshu/";
    private static final int FILE_CHOOSER_REQUEST = 1;

    // One root for the whole life of the activity: the setup page or the web
    // view goes inside it, padded clear of the status bar, navigation bar,
    // camera cutout and keyboard (Android 15 draws apps edge to edge).
    private FrameLayout root;
    private WebView web;
    private String server;
    private boolean volumeKeysTurnPages;
    private ValueCallback<Uri[]> pendingFileChooser;
    private final Exports exports = new Exports(this);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Debug builds only: lets Chrome DevTools (and the emulator tests)
        // inspect the page. Release builds stay closed.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF141416);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets ime = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                return WindowInsets.CONSUMED;
            }
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(root);
        server = prefs().getString(KEY_SERVER, null);
        if (server == null) showSetup(null, null);
        else openServer(server);
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private int dp(float value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    // ---------------------------------------------------------------------
    // First launch (or 更换 NAS): where is the library?

    private void showSetup(String error, String previous) {
        destroyWeb();
        setChrome(true, false, false);

        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(28), dp(72), dp(28), dp(28));

        TextView title = new TextView(this);
        title.setText("连接你的枕书");
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        column.addView(title);

        TextView lead = new TextView(this);
        lead.setText("填写在浏览器里打开飞牛 NAS 的地址。连接后用飞牛账号登录，书籍、进度和笔记都保存在 NAS 上。");
        lead.setTextColor(0xB3FFFFFF);
        lead.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        lead.setLineSpacing(0, 1.3f);
        lead.setPadding(0, dp(12), 0, dp(28));
        column.addView(lead);

        EditText address = new EditText(this);
        address.setSingleLine(true);
        address.setHint("例如 http://192.168.1.10:5666");
        address.setHintTextColor(0x66FFFFFF);
        address.setTextColor(Color.WHITE);
        address.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setImeOptions(EditorInfo.IME_ACTION_GO);
        address.setPadding(dp(16), dp(14), dp(16), dp(14));
        address.setBackground(rounded(0xFF2C2C2E, 12));
        if (previous != null) address.setText(previous);
        column.addView(address, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView problem = new TextView(this);
        problem.setTextColor(0xFFFF8A65);
        problem.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        problem.setPadding(0, dp(10), 0, 0);
        problem.setVisibility(error == null ? View.GONE : View.VISIBLE);
        if (error != null) problem.setText(error);
        column.addView(problem);

        Button connect = new Button(this);
        connect.setText("连接");
        connect.setAllCaps(false);
        connect.setTextColor(Color.WHITE);
        connect.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        connect.setBackground(rounded(0xFF0A84FF, 12));
        LinearLayout.LayoutParams connectParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        connectParams.topMargin = dp(20);
        column.addView(connect, connectParams);

        TextView hint = new TextView(this);
        hint.setText("· 只填 IP 和端口时，会自动打开 /app/zhenshu/\n· 用直连端口访问时，填写直连地址即可\n· 在外网使用，请填写你的飞牛远程访问地址");
        hint.setTextColor(0x80FFFFFF);
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        hint.setLineSpacing(0, 1.4f);
        hint.setPadding(0, dp(24), 0, 0);
        column.addView(hint);

        Runnable submit = () -> {
            String normalized = normalizeAddress(address.getText().toString());
            if (normalized == null) {
                problem.setText("地址不正确，请填写 http:// 或 https:// 开头的地址。");
                problem.setVisibility(View.VISIBLE);
                return;
            }
            prefs().edit().putString(KEY_SERVER, normalized).apply();
            openServer(normalized);
        };
        connect.setOnClickListener((view) -> submit.run());
        address.setOnEditorActionListener((view, actionId, event) -> {
            submit.run();
            return true;
        });

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(0xFF141416);
        scroll.setFillViewport(true);
        scroll.addView(column);
        root.removeAllViews();
        root.addView(scroll);
    }

    private GradientDrawable rounded(int color, float radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        return drawable;
    }

    /** http(s)://host[:port][/path]; a bare host:port opens /app/zhenshu/. */
    static String normalizeAddress(String input) {
        String value = input == null ? "" : input.trim();
        if (value.isEmpty()) return null;
        if (!value.matches("(?i)^https?://.*")) value = "http://" + value;
        Uri uri = Uri.parse(value);
        if (uri.getHost() == null || uri.getHost().isEmpty()) return null;
        String path = uri.getPath();
        if (path == null || path.isEmpty() || "/".equals(path)) {
            value = uri.buildUpon().path(APP_PATH).build().toString();
        }
        return value;
    }

    // ---------------------------------------------------------------------
    // The library itself.

    private void openServer(String address) {
        server = address;
        destroyWeb();
        web = new WebView(this);
        web.setBackgroundColor(0xFF141416);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportZoom(false);
        settings.setUserAgentString(settings.getUserAgentString() + " ZhenshuAndroid/0.1.2");
        CookieManager.getInstance().setAcceptCookie(true);

        web.addJavascriptInterface(new Bridge(), "ZhenshuNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                // The NAS (sign-in pages included) stays in the app; anything
                // else opens in the browser.
                if (sameHost(target)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, target));
                } catch (ActivityNotFoundException ignored) {
                    // No browser: stay put.
                }
                return true;
            }

            // The bridge answers only pages from the NAS: remember where the
            // page is (history changes include in-page navigation).
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                lastUrl = url;
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                lastUrl = url;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showSetup("无法连接到 " + Uri.parse(server).getAuthority() + "（" + error.getDescription() + "）。请确认手机和 NAS 在同一网络，或修改地址。", server);
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFileChooser != null) pendingFileChooser.onReceiveValue(null);
                pendingFileChooser = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException error) {
                    pendingFileChooser = null;
                    return false;
                }
                return true;
            }
        });
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> {
            // The page saves its own blob files through saveFile.
            if (!url.startsWith("http")) return;
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url));
            request.addRequestHeader("User-Agent", userAgent);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,
                URLUtil.guessFileName(url, contentDisposition, mimeType));
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
            Toast.makeText(this, "已开始下载", Toast.LENGTH_SHORT).show();
        });

        root.removeAllViews();
        root.addView(web);
        web.loadUrl(address);
    }

    private boolean sameHost(Uri target) {
        Uri base = Uri.parse(server);
        return target != null && base.getHost() != null && base.getHost().equalsIgnoreCase(target.getHost());
    }

    private void destroyWeb() {
        if (web == null) return;
        web.stopLoading();
        web.removeJavascriptInterface("ZhenshuNative");
        if (web.getParent() instanceof ViewGroup) ((ViewGroup) web.getParent()).removeView(web);
        web.destroy();
        web = null;
        volumeKeysTurnPages = false;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST && pendingFileChooser != null) {
            pendingFileChooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            pendingFileChooser = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    // ---------------------------------------------------------------------
    // Status bar, immersive reading.

    private void setChrome(boolean dark, boolean immersive, boolean keepOn) {
        int color = dark ? 0xFF141416 : 0xFFF2F3F5;
        // Edge to edge the bars are see-through: the root behind them sets
        // their colour. Older versions colour the bars themselves.
        root.setBackgroundColor(color);
        getWindow().setStatusBarColor(color);
        getWindow().setNavigationBarColor(color);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Through the decor view: the window's own controller is null
            // until the decor exists.
            WindowInsetsController controller = getWindow().getDecorView().getWindowInsetsController();
            if (controller != null) {
                int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(dark ? 0 : light, light);
                if (immersive) {
                    controller.hide(WindowInsets.Type.statusBars());
                    controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                } else {
                    controller.show(WindowInsets.Type.statusBars());
                }
            }
        } else {
            int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
            if (!dark) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (immersive) flags |= View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }
        if (keepOn) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    /** What the page may ask of the shell. Only pages from the NAS may ask. */
    private final class Bridge {
        private boolean trusted() {
            // Called on a binder thread: read the last address the UI thread
            // saw (lastUrl), enough to refuse pages from other sites.
            String url = web == null ? null : lastUrl;
            return url != null && sameHost(Uri.parse(url));
        }

        @JavascriptInterface
        public String version() {
            return "0.1.2";
        }

        @JavascriptInterface
        public String server() {
            return trusted() ? Uri.parse(server).getAuthority() : "";
        }

        /** While reading: theme, immersive status bar, screen on, volume keys. */
        @JavascriptInterface
        public void setReading(boolean reading, boolean dark, boolean immersive, boolean keepOn, boolean volumeKeys) {
            if (!trusted()) return;
            runOnUiThread(() -> {
                volumeKeysTurnPages = reading && volumeKeys;
                setChrome(dark, reading && immersive, reading && keepOn);
            });
        }

        /** Saves a file the page made (notes, pictures); returns where. */
        @JavascriptInterface
        public String saveFile(String name, String mime, String base64) {
            if (!trusted()) return "";
            return exports.save(name, mime, base64);
        }

        /** Prints the page's HTML through the system panel (另存为 PDF). */
        @JavascriptInterface
        public void printHtml(String html, String title) {
            if (!trusted()) return;
            exports.print(html, title, server);
        }

        @JavascriptInterface
        public void changeServer() {
            if (!trusted()) return;
            runOnUiThread(() -> {
                String previous = server;
                prefs().edit().remove(KEY_SERVER).apply();
                showSetup(null, previous);
            });
        }
    }

    private volatile String lastUrl;

    // ---------------------------------------------------------------------
    // Keys.

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (web != null && volumeKeysTurnPages
            && (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || keyCode == KeyEvent.KEYCODE_VOLUME_UP)) {
            int direction = keyCode == KeyEvent.KEYCODE_VOLUME_DOWN ? 1 : -1;
            web.evaluateJavascript("window.zhenshuNative && window.zhenshuNative.turn(" + direction + ")", null);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (volumeKeysTurnPages && (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || keyCode == KeyEvent.KEYCODE_VOLUME_UP)) {
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    /** Back: the page first (close a panel, leave the book), then history. */
    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript("(window.zhenshuNative && window.zhenshuNative.back()) ? 'handled' : ''", (result) -> {
            if ("\"handled\"".equals(result)) return;
            if (web != null && web.canGoBack()) web.goBack();
            else moveTaskToBack(true);
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            lastUrl = web.getUrl();
        }
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        destroyWeb();
        super.onDestroy();
    }
}
