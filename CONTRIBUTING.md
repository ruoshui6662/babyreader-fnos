# 开发与版本管理约定

接手这个项目时，先读这份文档，然后读 [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)。

## 1. 快速了解开发情况

```bash
git log --oneline --graph -30          # 最近做了什么
git tag -n1 --sort=-creatordate        # 发布了哪些版本
git log --oneline v1.2.0..main         # 上次发布之后的改动（tag 换成最新发布版本）
git status                             # 有没有没提交的工作（正常应为空）
```

- 项目全貌、待办、踩过的坑：`docs/PROJECT_STATUS.md`
- 每次发布的内容：`CHANGELOG_WORK.md`（最新的在最上面）
- 单项功能的设计、计划、执行记录：`docs/superpowers/{specs,plans,progress}/`，文件名以日期开头

## 2. 分支

| 分支 | 用途 |
| --- | --- |
| `main` | 唯一主线，始终可测试、可打包 |
| `feat/<主题>`、`fix/<主题>` | 单个功能或修复。完成后用 `--no-ff` 合回 `main`，然后删除该分支 |
| `archive/*`（tag） | 不合并但想留作参考的旧分支，先打 tag 再删分支 |

规则：

- **不要在工作区长期堆积没提交的改动**。每完成一个可验证的小步骤就提交一次。项目曾经在 9/23–9/29 积压了约 380 个文件没有提交，打包内容也因此无法追溯。
- 用 worktree 并行开发时，功能合入后要执行 `git worktree remove`，不要留下过期副本。
- 不要改写已推送的历史，也就是不要对 `main` 执行 `rebase` 或 `push --force`。

## 3. 提交信息

使用 [Conventional Commits](https://www.conventionalcommits.org/)，和已有历史保持一致：

```
<type>: <一句话说明>

<可选：为什么改、影响范围、验证结果>
```

`type` 可选 `feat`、`fix`、`test`、`docs`、`style`、`refactor`、`chore`、`merge`。功能代码和它的测试尽量放在同一个提交里。

## 4. 每个任务完成时要更新的内容

1. 代码和测试：`npm test`、`npm run check` 必须通过；涉及界面的改动还要跑 `npm run test:e2e`。
2. 在对应的 `docs/superpowers/progress/*.md` 里写明状态、验证证据和还没验收的内容。
3. 如果改变了功能状态、待办或已知坑，同步更新 `docs/PROJECT_STATUS.md` 的 §3、§6、§7。
4. 提交。

## 5. 发布流程

1. 同时修改 `manifest` 的 `version` 和 `package.json` 的 `version`，两处保持一致。修订号表示修复，次版本号表示功能。**同一个版本号只打包一次**，内容变了就升版本号。
2. 在 `CHANGELOG_WORK.md` 顶部新增一节，写明版本号、功能要点、验证结果和尚未验收的内容。
3. 提交：`chore: release vX.Y.Z`。
4. 在**干净的工作区**里执行 `npm run build:fpk`，产物输出到 `dist-v<版本>/`（脚本读取 manifest 版本；目录已存在时拒绝构建）。检查其中的 `build-provenance.json`，`git_dirty` 必须是 `false`。
5. 打附注 tag：`git tag -a vX.Y.Z -m "BabyReader fnOS vX.Y.Z"`。
6. 推送：`git push origin main --follow-tags`。FPK 不进 git（已在 `.gitignore` 中）。如果需要长期保存，把它作为附件上传到 GitHub Release。
7. 真机验收的结果回填到 `docs/FNOS_DEVICE_ACCEPTANCE.md` 和 CHANGELOG。

每个版本只有一个 `dist-v<版本>/` 目录；旧版本目录在新版本验收后可以删除，要找历史版本的包，用 `git checkout vX.Y.Z` 后重新构建即可。

## 6. 不进 git 的内容

`node_modules/`、`.build/`、`.runtime/`（本地和 E2E 的合成书库）、`dist/`、`dist-*/`、`test-results/`、`*.fpk`、`.superpowers/`（AI 执行时的草稿记录）。
