# 浮光单词 · Word Glass 本地安装版

当前版本为 0.1.0，支持 Windows x64。安装器、程序、桌面和开始菜单快捷方式统一使用玻璃底白色 W Logo，显示名称为「浮光单词」，程序文件名为 `WordGlass.exe`。

## 安装

运行 `release/WordGlass-Setup-0.1.0-x64.exe`，按中文安装向导选择安装目录。安装器默认安装到当前用户，无需管理员权限；可创建桌面和开始菜单快捷方式。运行后常驻系统托盘。

本地构建没有数字签名。安装器完整性可用同目录下的 `.sha256` 校验。

## 词库和设置

安装版数据保存在 `%APPDATA%\WordGlass\word-glass-data\`，升级不会覆盖，卸载默认保留。初次运行提供 3 个双语示例词条。开发版仍使用项目的 `data/`。

安装包不包含本机的个人词库、API Key、测试数据或开发工具。需要沿用开发版数据时，先从托盘退出两边的程序，再将项目 `data/words.json` 和 `data/settings.json` 复制到安装版数据目录。若目标目录已有数据，先备份再合并，不要直接覆盖。

离线英汉词库包含在安装包内。本地朗读使用 Windows 已安装的英文语音；本机验证为 Microsoft Zira Desktop。选词和朗读的 PowerShell 脚本作为普通文件安装在 `resources/app.asar.unpacked/scripts/`，避免外部程序读取 ASAR 失败。

## 重建

```powershell
npm ci
npm run package:win
```

配置在 `electron-builder.yml`。默认输出 `release/`，只生成本地安装包，不发布到外部服务。构建中间文件较大，磁盘不足时可用单独的输出目录：

```powershell
npm run build
node node_modules/electron-builder/cli.js --win --x64 --publish never --config.directories.output=D:/WordGlass-build/output
```

包内资源检查与独立运行验证：

```powershell
node tests/packaged-app-smoke.cjs release/win-unpacked
```

该验证使用隔离词库和浏览器配置，不修改当前个人词库或 Windows 启动项，不执行安装。
