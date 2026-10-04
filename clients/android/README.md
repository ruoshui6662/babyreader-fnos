# 枕书安卓客户端

这是一个很薄的安卓外壳：应用里只有“填写 NAS 地址”这一页，其余页面都从 NAS 上的枕书加载。因此客户端始终和 FPK 是同一个版本；登录使用飞牛自己的网页登录，书籍、进度和笔记都保存在 NAS 上。

## 使用

1. 安装 APK，打开后填写在浏览器里打开飞牛 NAS 的地址：
   - 只填 IP 和端口（例如 `http://192.168.1.10:5666`）时，会自动打开 `/app/zhenshu/`。
   - 如果平时用直连端口访问，填写直连地址即可。
2. 用飞牛账号登录。登录状态会保存在手机上。
3. 在阅读设置里点“更多设置”，最下方的“手机客户端”可以设置：
   - 音量键翻页（默认开）；
   - 阅读时屏幕常亮（默认开）；
   - 阅读时隐藏状态栏（默认关）；
   - 更换连接的 NAS。

返回键的处理顺序：先关闭打开的面板，再退出正在读的书；已经在书库时，按浏览历史后退，没有可后退的页面就把应用切到后台。

## 和网页之间的约定

外壳向网页提供 `window.ZhenshuNative`，方法如下：

| 方法 | 作用 |
|---|---|
| `version()` | 返回外壳版本 |
| `server()` | 返回连接的 NAS 地址 |
| `setReading(reading, dark, immersive, keepOn, volumeKeys)` | 告诉外壳当前是否在阅读、是否深色、以及阅读时生效的选项 |
| `changeServer()` | 更换连接的 NAS |

网页向外壳提供 `window.zhenshuNative`（见 `app/ui/reader/device-profile.js`）：

| 方法 | 作用 |
|---|---|
| `back()` | 处理返回键，返回 `true` 表示已经处理 |
| `turn(direction)` | 音量键翻页 |

`ZhenshuNative` 只响应和所填 NAS 同一主机的页面。其他网址会在系统浏览器中打开。

## 构建

需要 JDK 17 和 Android SDK（platform `android-35`、build-tools `35.0.0`）。

```bash
cd clients/android
JAVA_HOME="C:/Program Files/Microsoft/jdk-17.0.20.101-hotspot" ANDROID_HOME="D:/Android/Sdk" ./gradlew assembleRelease
```

APK 输出在 `app/build/outputs/apk/release/`。目前用调试密钥签名，可以直接安装；以后要上架时再换成正式密钥。

## 已知限制

- 笔记导出（Markdown、PDF、分享图片）在网页里是用 blob 生成的，安卓 WebView 不能直接下载这类文件。客户端会提示“请在浏览器中导出”。
- HTTPS 使用自签名证书的 NAS 无法连接（客户端不跳过证书检查）。家庭网络内请使用 HTTP 地址，外网请使用带有效证书的远程访问地址。
