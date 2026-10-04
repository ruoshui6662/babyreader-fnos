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
 * Signing in: the first screen takes the NAS address and 枕书's access
 * password (direct access, set in the fnOS app settings) and signs in by
 * itself; the password is kept encrypted (SecretStore) so an expired sign-in
 * renews without asking. Signing in through the fnOS web page stays as a
 * second way.
 *
 * The page talks to the shell through window.ZhenshuNative (Bridge), and
 * the shell calls back into window.zhenshuNative (defined by the page) for
 * the back key and volume-key page turns. The page also reports the colours
 * at the top and bottom of the screen, which fill the status-bar and
 * navigation-bar strips so reading stays one surface.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "zhenshu";
    private static final String KEY_SERVER = "server";
    private static final String KEY_MODE = "mode";
    private static final String MODE_DIRECT = "direct";
    private static final String MODE_WEB = "web";
    private static final String APP_PATH = DirectLogin.APP_PATH;
    private static final String VERSION = "0.2.0";
    private static final int FILE_CHOOSER_REQUEST = 1;
    private static final int SETUP_BACKGROUND = 0xFF141416;

    // The window: the content between two colour strips that sit under the
    // status bar (and camera cutout) and the navigation bar. Android 15
    // draws apps edge to edge, so the strips are ours to colour.
    private FrameLayout root;
    private FrameLayout content;
    private View topStrip;
    private View bottomStrip;
    private boolean immersive;

    private WebView web;
    private String server;
    private String mode;
    private boolean volumeKeysTurnPages;
    private boolean renewing;
    private ValueCallback<Uri[]> pendingFileChooser;
    private final Exports exports = new Exports(this);
    private SecretStore secrets;
    private volatile String lastUrl;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Debug builds only: lets Chrome DevTools (and the emulator tests)
        // inspect the page. Release builds stay closed.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        secrets = new SecretStore(prefs());
        buildWindow();
        server = prefs().getString(KEY_SERVER, null);
        // Clients before 0.2 kept a fnOS web address without a mode.
        mode = prefs().getString(KEY_MODE, server == null ? MODE_DIRECT : MODE_WEB);
        if (server == null) showLogin(null, null);
        else openServer(server);
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private int dp(float value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    private void buildWindow() {
        root = new FrameLayout(this);
        content = new FrameLayout(this);
        topStrip = new View(this);
        bottomStrip = new View(this);
        root.addView(content, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(topStrip, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.TOP));
        root.addView(bottomStrip, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.BOTTOM));
        setStripColors(SETUP_BACKGROUND, SETUP_BACKGROUND);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int left, top, right, bottom, keyboard;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                left = bars.left;
                top = bars.top;
                right = bars.right;
                bottom = bars.bottom;
                keyboard = insets.getInsets(WindowInsets.Type.ime()).bottom;
            } else {
                left = insets.getSystemWindowInsetLeft();
                top = insets.getSystemWindowInsetTop();
                right = insets.getSystemWindowInsetRight();
                bottom = insets.getSystemWindowInsetBottom();
                keyboard = 0;
            }
            FrameLayout.LayoutParams contentParams = (FrameLayout.LayoutParams) content.getLayoutParams();
            contentParams.setMargins(left, top, right, Math.max(bottom, keyboard));
            content.setLayoutParams(contentParams);
            topStrip.getLayoutParams().height = top;
            topStrip.requestLayout();
            bottomStrip.getLayoutParams().height = bottom;
            bottomStrip.requestLayout();
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
        });
        setContentView(root);
    }

    // ---------------------------------------------------------------------
    // Signing in.

    private void showLogin(String error, String previousAddress) {
        destroyWeb();
        setSystemBars(SETUP_BACKGROUND, SETUP_BACKGROUND, false, false);
        boolean web = MODE_WEB.equals(mode);

        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(28), dp(64), dp(28), dp(28));

        TextView title = text(web ? "用飞牛账号登录" : "登录枕书", 28, Color.WHITE);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        column.addView(title);
        TextView lead = text(web
            ? "填写在浏览器里打开飞牛 NAS 的地址，之后在飞牛的登录页输入账号和密码。"
            : "填写 NAS 的地址和枕书的访问密码。登录一次后会保持登录，无需再次输入。", 15, 0xB3FFFFFF);
        lead.setLineSpacing(0, 1.3f);
        lead.setPadding(0, dp(12), 0, dp(28));
        column.addView(lead);

        EditText address = field(web ? "例如 192.168.1.10:5666" : "NAS 地址，例如 192.168.1.10:8090",
            InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        if (previousAddress != null) address.setText(previousAddress.replaceFirst("^http://", "").replaceFirst("/app/zhenshu/?$", ""));
        column.addView(address, fill());

        EditText password = field("访问密码", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        LinearLayout.LayoutParams passwordParams = fill();
        passwordParams.topMargin = dp(12);
        if (!web) column.addView(password, passwordParams);

        TextView problem = text("", 14, 0xFFFF8A65);
        problem.setPadding(0, dp(10), 0, 0);
        problem.setVisibility(error == null ? View.GONE : View.VISIBLE);
        if (error != null) problem.setText(error);
        column.addView(problem);

        Button submit = new Button(this);
        submit.setText(web ? "打开" : "登录");
        submit.setAllCaps(false);
        submit.setTextColor(Color.WHITE);
        submit.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        submit.setBackground(rounded(0xFF0A84FF, 12));
        LinearLayout.LayoutParams submitParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        submitParams.topMargin = dp(20);
        column.addView(submit, submitParams);

        TextView hint = text(web
            ? "· 只填 IP 和端口时，会自动打开 /app/zhenshu/\n· 飞牛的登录可能过一段时间就需要重新输入；用访问密码登录不会"
            : "· 访问密码和端口在飞牛的“应用设置 › 枕书 › 直连访问”中设置\n· 以那里选定的飞牛用户的书架和进度阅读\n· 在外网使用，请填写可以从外网访问的地址", 13, 0x80FFFFFF);
        hint.setLineSpacing(0, 1.4f);
        hint.setPadding(0, dp(24), 0, 0);
        column.addView(hint);

        TextView other = text(web ? "改用访问密码登录" : "用飞牛账号登录（网页）", 15, 0xFF0A84FF);
        other.setPadding(0, dp(28), 0, dp(8));
        other.setOnClickListener((view) -> {
            mode = web ? MODE_DIRECT : MODE_WEB;
            showLogin(null, address.getText().toString());
        });
        column.addView(other);

        Runnable go = () -> {
            String base = normalizeBase(address.getText().toString());
            if (base == null) {
                problem.setText("地址不正确，请填写 IP 和端口，例如 192.168.1.10:8090。");
                problem.setVisibility(View.VISIBLE);
                return;
            }
            if (web) {
                saveSignIn(MODE_WEB, webAddress(address.getText().toString(), base), null);
                openServer(server);
                return;
            }
            String secret = password.getText().toString();
            if (secret.isEmpty()) {
                problem.setText("请填写访问密码。");
                problem.setVisibility(View.VISIBLE);
                return;
            }
            submit.setEnabled(false);
            submit.setText("正在登录…");
            problem.setVisibility(View.GONE);
            new Thread(() -> {
                String failure = DirectLogin.signIn(base, secret);
                runOnUiThread(() -> {
                    if (failure.isEmpty()) {
                        saveSignIn(MODE_DIRECT, base + APP_PATH, secret);
                        openServer(server);
                    } else {
                        submit.setEnabled(true);
                        submit.setText("登录");
                        problem.setText(failure);
                        problem.setVisibility(View.VISIBLE);
                    }
                });
            }).start();
        };
        submit.setOnClickListener((view) -> go.run());
        (web ? address : password).setOnEditorActionListener((view, actionId, event) -> {
            go.run();
            return true;
        });

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(SETUP_BACKGROUND);
        scroll.setFillViewport(true);
        scroll.addView(column);
        content.removeAllViews();
        content.addView(scroll);
    }

    private void saveSignIn(String newMode, String address, String password) {
        mode = newMode;
        server = address;
        prefs().edit().putString(KEY_MODE, newMode).putString(KEY_SERVER, address).apply();
        if (password != null) secrets.save(password);
        else secrets.clear();
    }

    private TextView text(String value, int sp, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextColor(color);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        return view;
    }

    private EditText field(String hint, int inputType) {
        EditText field = new EditText(this);
        field.setSingleLine(true);
        field.setHint(hint);
        field.setHintTextColor(0x66FFFFFF);
        field.setTextColor(Color.WHITE);
        field.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        field.setInputType(inputType);
        field.setImeOptions(EditorInfo.IME_ACTION_GO);
        field.setPadding(dp(16), dp(14), dp(16), dp(14));
        field.setBackground(rounded(0xFF2C2C2E, 12));
        return field;
    }

    private LinearLayout.LayoutParams fill() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private GradientDrawable rounded(int color, float radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        return drawable;
    }

    /** http(s)://host[:port], without a path; null when there is no host. */
    static String normalizeBase(String input) {
        String value = input == null ? "" : input.trim();
        if (value.isEmpty()) return null;
        if (!value.matches("(?i)^https?://.*")) value = "http://" + value;
        Uri uri = Uri.parse(value);
        if (uri.getHost() == null || uri.getHost().isEmpty()) return null;
        return uri.getScheme() + "://" + uri.getEncodedAuthority();
    }

    /** The fnOS web address: a bare host:port opens /app/zhenshu/. */
    static String webAddress(String input, String base) {
        String value = input.trim();
        if (!value.matches("(?i)^https?://.*")) value = "http://" + value;
        String path = Uri.parse(value).getPath();
        return path == null || path.isEmpty() || "/".equals(path) ? base + APP_PATH : value;
    }

    // ---------------------------------------------------------------------
    // The library itself.

    private boolean isDirectLoginPage(Uri url) {
        return MODE_DIRECT.equals(mode) && url != null && url.getPath() != null && url.getPath().endsWith("/__direct/login");
    }

    /**
     * The sign-in expired (the page was sent to the login form): sign in
     * again with the kept password, then reload. Asks only when that fails.
     */
    private void renewSignIn() {
        if (renewing) return;
        String password = secrets.load();
        if (password == null) {
            showLogin("登录已过期，请重新输入访问密码。", server);
            return;
        }
        renewing = true;
        String base = normalizeBase(server);
        new Thread(() -> {
            String failure = DirectLogin.signIn(base, password);
            runOnUiThread(() -> {
                renewing = false;
                if (failure.isEmpty()) {
                    if (web != null) web.loadUrl(server);
                } else if (failure.startsWith("访问密码不正确")) {
                    secrets.clear();
                    showLogin("访问密码已更改，请重新登录。", server);
                } else {
                    showLogin(failure, server);
                }
            });
        }).start();
    }

    private void openServer(String address) {
        server = address;
        destroyWeb();
        web = new WebView(this);
        web.setBackgroundColor(SETUP_BACKGROUND);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportZoom(false);
        settings.setUserAgentString(settings.getUserAgentString() + " ZhenshuAndroid/" + VERSION);
        CookieManager.getInstance().setAcceptCookie(true);

        web.addJavascriptInterface(new Bridge(), "ZhenshuNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                if (isDirectLoginPage(target)) {
                    renewSignIn();
                    return true;
                }
                // The NAS (fnOS sign-in pages included) stays in the app;
                // anything else opens in the browser.
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
                // A redirect to the login form arrives here, not above.
                if (isDirectLoginPage(Uri.parse(url))) {
                    view.stopLoading();
                    renewSignIn();
                }
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                lastUrl = url;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showLogin("无法连接到 " + Uri.parse(server).getAuthority() + "（" + error.getDescription() + "）。请确认手机和 NAS 在同一网络，或修改地址。", server);
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

        content.removeAllViews();
        content.addView(web);
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
    // Status bar, navigation bar, immersive reading.

    private static boolean isLight(int color) {
        double luminance = (0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color)) / 255;
        return luminance > 0.6;
    }

    private void setStripColors(int top, int bottom) {
        topStrip.setBackgroundColor(top);
        bottomStrip.setBackgroundColor(bottom);
        root.setBackgroundColor(top);
        // Before Android 15 the system draws the bars itself.
        getWindow().setStatusBarColor(top);
        getWindow().setNavigationBarColor(bottom);
    }

    /** The bars take the page's colours; icons stay readable on them. */
    private void setSystemBars(int top, int bottom, boolean hideStatusBar, boolean keepOn) {
        immersive = hideStatusBar;
        setStripColors(top, bottom);
        boolean lightTop = isLight(top);
        boolean lightBottom = isLight(bottom);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Through the decor view: the window's own controller is null
            // until the decor exists.
            WindowInsetsController controller = getWindow().getDecorView().getWindowInsetsController();
            if (controller != null) {
                int appearance = (lightTop ? WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS : 0)
                    | (lightBottom ? WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS : 0);
                controller.setSystemBarsAppearance(appearance,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
                if (hideStatusBar) {
                    controller.hide(WindowInsets.Type.statusBars());
                    controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                } else {
                    controller.show(WindowInsets.Type.statusBars());
                }
            }
        } else {
            int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
            if (lightTop) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (lightBottom) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            if (hideStatusBar) flags |= View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }
        if (keepOn) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    /** "rgb(r, g, b)" / "rgba(r, g, b, a)" / "#rrggbb" to a colour; fallback when unreadable. */
    static int parseCssColor(String value, int fallback) {
        if (value == null) return fallback;
        String text = value.trim();
        try {
            if (text.startsWith("#")) return Color.parseColor(text);
            java.util.regex.Matcher match = java.util.regex.Pattern
                .compile("rgba?\\(\\s*([\\d.]+)[ ,]+([\\d.]+)[ ,]+([\\d.]+)").matcher(text);
            if (match.find()) {
                return Color.rgb(Math.round(Float.parseFloat(match.group(1))),
                    Math.round(Float.parseFloat(match.group(2))), Math.round(Float.parseFloat(match.group(3))));
            }
        } catch (IllegalArgumentException ignored) {
            // Fall through.
        }
        return fallback;
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
            return VERSION;
        }

        @JavascriptInterface
        public String server() {
            return trusted() ? Uri.parse(server).getAuthority() : "";
        }

        /**
         * The screen: reading or not, the colours at its top and bottom edge
         * (CSS colours), and the options that apply while reading.
         */
        @JavascriptInterface
        public void setScreen(boolean reading, String topColor, String bottomColor, boolean hideStatusBar, boolean keepOn, boolean volumeKeys) {
            if (!trusted()) return;
            runOnUiThread(() -> {
                volumeKeysTurnPages = reading && volumeKeys;
                int top = parseCssColor(topColor, SETUP_BACKGROUND);
                int bottom = parseCssColor(bottomColor, top);
                setSystemBars(top, bottom, reading && hideStatusBar, reading && keepOn);
            });
        }

        /** Older pages (FPK before 0.0.20): dark or light only. */
        @JavascriptInterface
        public void setReading(boolean reading, boolean dark, boolean hideStatusBar, boolean keepOn, boolean volumeKeys) {
            String color = dark ? "#141416" : "#F2F3F5";
            setScreen(reading, color, color, hideStatusBar, keepOn, volumeKeys);
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

        /** 退出登录 / 更换 NAS: forget the address and password. */
        @JavascriptInterface
        public void changeServer() {
            if (!trusted()) return;
            runOnUiThread(() -> {
                String previous = server;
                secrets.clear();
                CookieManager.getInstance().removeAllCookies(null);
                prefs().edit().remove(KEY_SERVER).apply();
                showLogin(null, previous);
            });
        }
    }

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
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // A swipe shows the hidden status bar for a moment; hide it again.
        if (hasFocus && immersive && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getDecorView().getWindowInsetsController();
            if (controller != null) controller.hide(WindowInsets.Type.statusBars());
        }
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
