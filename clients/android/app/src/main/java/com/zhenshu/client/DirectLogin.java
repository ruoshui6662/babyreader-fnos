package com.zhenshu.client;

import android.webkit.CookieManager;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * Signs in to 枕书's direct-access port with its access password, the way
 * the login form there does, and hands the session cookie to the web view.
 * Runs off the main thread.
 */
final class DirectLogin {
    static final String APP_PATH = "/app/zhenshu/";
    private static final String COOKIE = "zhenshu_direct=";

    /** Empty on success; otherwise a message for the reader. */
    static String signIn(String base, String password) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(base + APP_PATH + "__direct/login");
            connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(15000);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            byte[] body = ("password=" + URLEncoder.encode(password, "UTF-8")
                + "&next=" + URLEncoder.encode(APP_PATH, "UTF-8")).getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body);
            }
            int status = connection.getResponseCode();
            if (status == 302 || status == 303) {
                boolean signedIn = false;
                CookieManager cookies = CookieManager.getInstance();
                for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
                    if (header.getKey() == null || !"set-cookie".equalsIgnoreCase(header.getKey())) continue;
                    for (String value : header.getValue()) {
                        if (!value.startsWith(COOKIE)) continue;
                        cookies.setCookie(base + APP_PATH, value);
                        signedIn = true;
                    }
                }
                if (signedIn) {
                    cookies.flush();
                    return "";
                }
                return "登录没有成功，请确认填写的是枕书的直连端口。";
            }
            String text = read(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
            if (status == 401) return "访问密码不正确。";
            if (status == 429) return "密码错误次数过多，请 15 分钟后再试。";
            if (status == 503 && text.contains("disabled")) {
                return "NAS 上还没有开启直连访问：请在飞牛的“应用设置 › 枕书”里开启，并设置端口和访问密码。";
            }
            if (status == 404) return "这个端口不是枕书的直连端口：请填写在飞牛应用设置里为枕书设置的直连端口。";
            return "登录失败（HTTP " + status + "）。";
        } catch (IOException error) {
            return "无法连接到 " + base.replaceFirst("^https?://", "") + "。请确认地址和端口，以及手机和 NAS 在同一网络。";
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String read(InputStream stream) throws IOException {
        if (stream == null) return "";
        try (InputStream in = stream) {
            byte[] buffer = new byte[4096];
            int length = in.read(buffer);
            return length > 0 ? new String(buffer, 0, length, StandardCharsets.UTF_8) : "";
        }
    }
}
