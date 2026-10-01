# 阅读字体与授权

> 2026-10-01 建立。新增或替换字体前，必须先在本文登记来源、版本和授权，并通过 `scripts/vendor-fonts.py` 重新生成。

## 1. 结论

- **随包分发的字体全部是 SIL Open Font License 1.1（OFL）**，且都没有声明保留字体名（Reserved Font Name）。OFL 允许免费商用，允许把字体随软件捆绑、嵌入和再分发；唯一限制是不能单独出售字体本身。
- 我们对字体做了子集化并转成 woff2。按 OFL，这属于“修改版本”。由于这些字体都没有保留字体名，修改版本可以沿用原字体名。
- 每个字体目录都附带原样的授权文件（`app/ui/vendor/fonts/<字体>/LICENSE`），满足 OFL “随字体分发授权文本”的要求。
- **系统字体**（系统黑体、系统宋体）只是在 CSS 中按名称引用读者设备上已安装的字体，我们不分发这些字体文件，因此没有再分发风险。

## 2. 随包字体清单

| 设置中的名称 | 字体 | 版本与来源 | 授权 | 包内大小（woff2） |
| --- | --- | --- | --- | --- |
| 思源宋体（默认） | Noto Serif SC，400 字重 | `@fontsource/noto-serif-sc@5.3.0`（Google Fonts 的切片） | OFL 1.1，© Google | 约 3.3 MB，101 个切片 |
| 霞鹜文楷 | LXGW WenKai Regular | `lxgw-wenkai-webfont@1.7.0`（字体版本 v1.250；npm 包装为 MIT，字体为 OFL） | OFL 1.1 | 约 4.7 MB，97 个切片 |
| 朱雀仿宋 | Zhuque Fangsong Regular | 官方发布 [TrionesType/zhuque v0.212](https://github.com/TrionesType/zhuque/releases/tag/v0.212)（预览版），用 fontTools 按 Noto Serif SC 的切片范围切分 | OFL 1.1，© 浙江玉竹科技 | 约 4.7 MB，99 个切片 |
| （西文） | Literata 400 / 700，latin 与 latin-ext | `@fontsource/literata@5.3.0`（Google Play 图书使用的字体） | OFL 1.1，© The Literata Project Authors | 约 0.1 MB |

合计约 11.9 MB。字体按 `unicode-range` 切片，浏览器只下载当前书用到的字符所在切片，并且只加载读者选中的字体。

## 3. 评估后没有采用的字体

| 字体 | 原因 |
| --- | --- |
| 方正书宋、方正黑体、方正仿宋、方正楷体 | 虽称“免费商用”，但公开资料显示仍需方正书面授权，且禁止传播，不能随 FPK 分发 |
| HarmonyOS Sans、MiSans、阿里巴巴普惠体 | 各自使用厂商自定义授权（不是 OFL），再分发条款需要逐一审查；正文阅读已有 OFL 字体可用，暂不引入 |
| Source Han Serif（思源宋体 Adobe 版） | 与 Noto Serif SC 字形相同，但保留了字体名 “Source”，子集化后不能沿用该名称；因此改用 Noto 版 |
| 第三方 npm 上的朱雀仿宋切片包 | 发布者无法核实；改用官方发布文件自行切分 |

## 4. 重新生成

```bash
# 1. 准备暂存目录（版本号与上表一致）
npm install --prefix <暂存目录> @fontsource/noto-serif-sc@5.3.0 lxgw-wenkai-webfont@1.7.0 @fontsource/literata@5.3.0
# 2. 下载朱雀仿宋官方发布包，并把 ZhuqueFangsong-Regular.ttf 和仓库中的 LICENSE.txt 放到 <暂存目录>/zhuque/
# 3. 需要 Python 的 fonttools 与 brotli
python scripts/vendor-fonts.py <暂存目录>
```
