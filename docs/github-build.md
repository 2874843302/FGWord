# GitHub 自动构建与发布

仓库：<https://github.com/2874843302/FGWord>。工作流为 `.github/workflows/windows-build.yml`，使用 GitHub 托管的 Windows runner 和 Node.js 22。

## 自动打包

- 推送 `main`、向 `main` 提交 Pull Request，或在 Actions 页面手动运行 **Windows build**，都会执行测试、TypeScript 检查、前端构建及 Windows x64 NSIS 打包。
- 安装包使用「浮光单词」名称和项目 Logo，文件名为 `WordGlass-Setup-<版本>-x64.exe`。
- 构建后还会运行隔离数据的 Electron 集成测试和真实打包程序检查。通过后，安装器及 `.sha256` 会上传至该次运行的 **Artifacts → WordGlass-Windows-x64-<运行编号>**，保留 14 天。
- 检查结果保存在 **Windows-test-reports-<运行编号>**，保留 7 天。失败时也会尝试上传已有报告。

在 [Actions 页面](https://github.com/2874843302/FGWord/actions/workflows/windows-build.yml) 打开成功的运行，下载并解压 Artifacts 即可获得安装包。Artifacts 下载需要登录 GitHub。

## 发布下载页

推送 `v*` 标签时，先检查标签与 `package.json` 版本一致，然后执行同样的完整构建。成功后自动创建 GitHub Release，附加安装包、SHA-256 和自动生成的版本说明。

首次发布当前版本：

```powershell
git tag -a v0.1.0 -m "浮光单词 v0.1.0"
git push origin v0.1.0
```

后续发布新版本（需先提交完代码修改）：

```powershell
npm version patch
git push origin main --follow-tags
```

`npm version patch` 会更新 `package.json` / `package-lock.json`、创建版本提交和标签，例如 `v0.1.1`。版本标签应指向已审核的 `main` 提交。已发布版本不重复使用同名标签；下一次发布请递增版本。

发布下载页：<https://github.com/2874843302/FGWord/releases>。

## 配置与数据

构建使用仓库自带的 ECDICT 压缩分片及其 MIT LICENSE，不会每次重新下载原始词典。`npm ci` 使用锁定的依赖和官方 npm registry。

`data/`、`.test/`、`.env*`、`release/`、`node_modules/`、`dist/` 不入库。安装包仅包含 `resources/defaults/words.json` 的三个示例词条，个人词库、API Key 和测试文件不打包。开发版首次运行会创建本地 `data/`，可在应用中添加词条和配置 AI。

不需要配置个人 PAT 或 LLM 密钥。普通构建只需读取仓库；仅标签发布 job 使用 GitHub 自动提供的 `GITHUB_TOKEN` 写入 Release。若仓库或组织禁用了 Actions，需要先在 GitHub 设置中启用。

当前安装包没有代码签名，自动构建不会改变这一点。用户数据仍保存在 `%APPDATA%\WordGlass\word-glass-data\`；升级默认保留，迁移方法见 [本地安装版](local-installer.md)。
