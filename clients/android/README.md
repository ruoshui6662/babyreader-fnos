# 枕书安卓客户端

这是一个很薄的安卓外壳：应用里只有“填写 NAS 地址”这一页，其余页面都从 NAS 上的枕书加载。因此客户端始终和 FPK 是同一个版本；登录使用飞牛自己的网页登录，书籍、进度和笔记都保存在 NAS 上。

## 使用

1. 在飞牛的“应用设置 › 枕书 › 直连访问”中：
   - 开启直连访问，设置端口和访问密码；
   - 选定以哪个飞牛用户的身份阅读。这个用户需要先在飞牛桌面打开一次枕书。
2. 打开 App，填写 NAS 地址（例如 `192.168.1.10:8090`，即 IP 加直连端口）和访问密码，点“登录”。
3. 之后打开 App 会直接进入书库，不需要再输入密码：
   - 登录状态保持 30 天；
   - 过期后，App 用加密保存的密码（Android Keystore）自动重新登录；
   - 只有在 NAS 上修改了访问密码时，才需要重新输入。
4. 在阅读设置里点“更多设置”，最下方的“手机客户端”可以设置：
   - 音量键翻页（默认开）；
   - 阅读时屏幕常亮（默认开）；
   - 阅读时隐藏状态栏（默认关）；
   - 退出登录：会清除保存的地址和密码。

也可以在登录页点“用飞牛账号登录（网页）”，走飞牛自己的网页登录。这种方式的登录由飞牛管理，过一段时间可能需要重新输入密码。另外，通过直连访问时，书库扫描、导入等管理员操作不可用，需要在飞牛桌面里完成。

状态栏和导航栏会使用页面顶部、底部的颜色：阅读时与纸张同色，开启“隐藏状态栏”后整屏都是书页。

返回键的处理顺序：先关闭打开的面板，再退出正在读的书；已经在书库时，按浏览历史后退，没有可后退的页面就把应用切到后台。

## 和网页之间的约定

外壳向网页提供 `window.ZhenshuNative`，方法如下：

| 方法 | 作用 |
|---|---|
| `version()` | 返回外壳版本 |
| `server()` | 返回连接的 NAS 地址 |
| `setScreen(reading, topColor, bottomColor, hideStatusBar, keepOn, volumeKeys)` | 告诉外壳当前是否在阅读、屏幕顶部和底部的颜色（用于状态栏和导航栏），以及阅读时生效的选项 |
| `setReading(reading, dark, …)` | 旧版页面使用，只区分深色和浅色 |
| `changeServer()` | 退出登录：清除保存的地址和密码 |
| `saveFile(name, mime, base64)` | 保存网页生成的文件（笔记 Markdown、分享图片），返回保存位置 |
| `printHtml(html, title)` | 用系统打印面板打印（可“另存为 PDF”） |

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

## 导出

- 笔记导出成 Markdown 时，文件保存到“下载/枕书”；分享图片保存到“相册/枕书”。
- 导出 PDF 时会打开系统打印面板，在打印机里选择“另存为 PDF”即可。
- Android 8–9 第一次保存时会请求存储权限；Android 10 及以上不需要任何权限。

调试版（`assembleDebug`）开启了 WebView 调试，可以用 Chrome 的 `chrome://inspect` 检查页面；正式版不开启。

## 已知限制

- HTTPS 使用自签名证书的 NAS 无法连接（客户端不跳过证书检查）。家庭网络内请使用 HTTP 地址，外网请使用带有效证书的远程访问地址。
