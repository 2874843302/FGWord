# 浮光单词 · Word Glass

一个置顶在屏幕任意位置的桌面单词卡片：显示英语单词、词性与中文释义，按自定义间隔轮播；悬停展开短语与例句，按分组管理词库。内置免费离线英汉词库，自动补充可用的在线英文例句和发音，也可手动使用 LLM 补全双语内容。

## 快速开始

需要 Node.js 22+。下载源码后先安装依赖；个人词库和 API 配置由程序在本机创建，不随仓库分发。

```bash
npm ci             # 按锁文件安装依赖（含 Electron）
npm run dev        # 开发模式：Vite dev server + Electron 热更新
npm run build      # 构建渲染进程（dist/）并做 TS 类型检查
npm start          # 生产模式：直接加载 dist/ 运行
npm run package:win # 生成带名称、Logo 的 Windows x64 安装包
```

> 无 GPU / 无桌面合成器的环境（如远程云主机、虚拟机）下 backdrop-filter 不生效，卡片会退化为浅色半透明卡片；本地桌面运行即为真实液态玻璃效果。

Windows 本地安装包输出到 `release/`。安装版的数据位于 `%APPDATA%\WordGlass\word-glass-data\`，包内不含开发版个人词库或 API Key；安装、数据迁移与重建说明见 [本地安装版](docs/local-installer.md)。

## 自动构建与发布

推送 `main` 或提交 Pull Request 时，GitHub Actions 自动测试并生成 Windows x64 安装包。在 [Actions](https://github.com/2874843302/FGWord/actions/workflows/windows-build.yml) 中下载该次成功运行的 `WordGlass-Windows-x64-<运行编号>` Artifact。

推送与项目版本一致的 `v*` 标签（例如 `v0.1.0`）后，自动构建并发布到 [Releases](https://github.com/2874843302/FGWord/releases)，附带安装器及 SHA-256。操作步骤见 [GitHub 自动构建与发布](docs/github-build.md)。

## 功能一览

| 功能 | 说明 |
|---|---|
| 置顶轮播 | 屏幕任意位置，一次显示一个单词，间隔时间可自定义（设置面板，默认 6 秒） |
| 悬停详情 | 鼠标移入卡片，展开该词的词性释义、常用短语、双语例句 |
| 分组管理 | 按分组添加/筛选单词，可勾选哪些分组参与轮播 |
| 免费查词 | 本地 ECDICT 查询中文释义、词性和音标；Free Dictionary API 补充可用的发音与英文例句 |
| 点击朗读 | 音标旁点击喇叭播放词典录音；没有录音或加载失败时使用 Windows 本地英文朗读，支持短语，无需 API Key |
| AI 补全 | 可选配置 LLM，手动生成双语短语、例句和未收录的词条 |
| 鼠标穿透 | 默认穿透（不挡其他应用操作），悬停卡片时自动接管鼠标事件 |
| 本地存储 | 数据存 `data/words.json`、`data/settings.json`，可直接编辑 |
| 托盘常驻 | 默认显示系统托盘图标、隐藏任务栏图标；关闭卡片后收进托盘，通过托盘显示、管理或退出 |

## 使用说明

1. **添加单词**：点击卡片右上角 ⚙ → 「添加」→ 输入单词、选分组 → 「快速添加」。
   - 手动输入、预览确认和屏幕选词统一以小写入库；已有词条启动时也会转为小写，保留原分组、释义和其他内容。
   - 添加时立即查本地词库，不需要 API Key；在线例句和发音在后台补充后自动刷新。
   - 也可点「免费查词预览」查看后确认添加；旧词可在「词库」中点击「补全」。
   - 配置 LLM 后显示「AI 补全」按钮，仅在手动点击时调用模型。
2. **可选配置 LLM（OpenAI 兼容接口）**：⚙ → 「设置」→ 填 Base URL / API Key / 模型 → 保存。
   - 支持任何 OpenAI 兼容端点（OpenAI、中转站、本地 vLLM 等），配置仅存本地。
   - 也可用环境变量：`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`。
   - 命令行补全工具：`node scripts/enrich-word.mjs <word>`（复用同一份配置与提示词）。
3. **调整轮播**：⚙ → 「设置」改间隔；⚙ → 「分组」勾选参与轮播的分组（全部不勾 = 全部分组）。
   - 卡片获得焦点、鼠标悬停阅读、调整尺寸或打开管理面板时暂停自动轮播；交互结束后重新计算完整停留时间，手动切词仍然可用。
   - 鼠标移入卡片即可显示左右「上一个词 / 下一个词」按钮，无需点击激活窗口；按当前轮播分组循环切换。移出且失去焦点后隐藏，只有一个词时禁用。
   - 按 **Ctrl + Alt + N** 切换下一个词，在其他应用中也生效；按当前轮播分组循环切换，并重新计算停留时间。「设置 → 下一个词快捷键」可更换，留空关闭。
   - 按住卡片顶部横条附近的空白区域即可拖动位置，无需精确点中细线。
   - 悬停展开后或打开管理面板，拖动右下角手柄即可调整窗口大小并自动保存；设置中也可填写宽高。手柄聚焦后支持方向键微调，Shift + 方向键每次调整 50 像素。
   - 高度决定详情与管理面板的可用空间；卡片收起时保持紧凑。
   - 「设置 → 开机自启」可开启或关闭登录 Windows 后自动启动，开关立即生效；状态来自系统，不会在每次启动时强行覆盖 Windows 的选择。源码运行时直接加载 `dist/`，不依赖 Vite，移动项目目录后需要重新关闭并开启自启。

4. **一键补全**：打开「词库」，点击顶部「一键补全」，依次处理缺少音标、释义、短语或例句的词条，自动跳过内容已完整的词条。已有内容会保留，已完整的词条隐藏补全按钮。
   - 每条例句都包含中文译文才算完整；配置 AI 后会为缺少翻译的原句补译，保留已有英文和自定义译文。
   - 默认使用免费词典；配置 AI 后自动补充仍然缺少的短语、例句等内容。没有 AI 配置时，免费词典无法补齐的内容会继续标为待补全。
   - 可查看进度、失败项，并在当前词处理完成后停止。已保存的补全结果会保留；下次操作继续跳过已完整的词条。

5. **屏幕选词添加（Windows）**：在其他应用选中英文单词或短语，按 **Ctrl + Shift + Alt + D**，在鼠标附近的浮窗中选择分组，再点击「添加到分组」或按 Enter。按 Esc 或点击浮窗外取消。浮窗会记住上次使用的分组。
   - 优先直接读取系统文字选择，兼容模式临时使用 Ctrl+C 并尝试恢复原剪贴板；当前应用不支持读取时，可先手动复制，再通过管理面板「从剪贴板添加」。
   - 同一单词可加入不同分组，同一分组不会重复添加。
   - 「设置 → 屏幕选词快捷键」可更换快捷键，留空关闭。快捷键被占用时会显示提示。
   - 支持可选择的文字，不包含图片 OCR。管理员权限应用或受保护的内容可能无法读取。

6. **托盘操作**：点击系统托盘中的 Word Glass 图标显示卡片；右键可显示/隐藏卡片、管理单词、切换下一个词，或退出。关闭窗口会收进托盘；完全退出请使用「退出 Word Glass」。

## 数据格式

`data/words.json` 词条结构：

```json
{
  "id": "唯一id",
  "word": "serendipity",
  "phonetic": "/ˌserənˈdɪpəti/",
  "group": "示例",
  "definitions": [{ "partOfSpeech": "n.", "meaning": "意外发现珍奇事物的运气" }],
  "phrases": ["by pure serendipity：纯属机缘巧合"],
  "examples": ["They met by serendipity at a coffee shop in Paris. 他们在巴黎一家咖啡馆偶然相遇。"],
  "enriched": true,
  "createdAt": 1730000000000
}
```

## 架构要点

```
electron/main.js          主进程：透明置顶窗口、鼠标穿透轮询、本地 JSON 存储、LLM 补全代理
electron/preload.js       contextBridge 桥接（渲染进程无 node 能力，沙箱开启）
electron/enrich-prompt.js 补全提示词（主进程与 CLI 共用）
src/                      React 渲染进程
  ├─ components/GlassCard.tsx    玻璃卡片（顶部拖拽把手独立于 hover 区）
  ├─ components/DetailPanel.tsx  悬停详情
  ├─ components/ManagerPanel.tsx 添加 / 分组 / 设置 / 词库
  ├─ hooks/useWordRotation.ts    轮播定时器
  └─ styles.css                  液态玻璃材质（backdrop-filter blur + saturate）
```

两个关键设计：

- **鼠标穿透**：窗口 `transparent + frameless + alwaysOnTop(screen-saver)`，默认
  `setIgnoreMouseEvents(true, { forward: true })` 不挡桌面操作；渲染进程同步可见卡片、管理面板及按钮的实际范围，
  主进程每 16ms 判断鼠标是否位于这些范围内，透明空白和圆角处保持穿透。展开、收起和调整尺寸时同步更新；拖动期间保持接管。拖拽把手用 `-webkit-app-region: drag`，
  与 hover 区分离（drag 区域会吞掉鼠标事件）。
- **免费查词**：`words:add` 先查询分片压缩的 ECDICT，随后通过主进程查询 Free Dictionary API；超时、未收录或限流时保留本地结果。已有释义和例句不被词典刷新覆盖。
- **AI 补全**：手动点击后主进程调用 `${baseUrl}/v1/chat/completions`，生成多词性、双语短语及例句。

免费词典的数据来源、许可及词库更新方式见 [docs/dictionary.md](docs/dictionary.md)。

## 已做验证

- `tsc --noEmit` 类型检查通过；`vite build` 生产构建通过；主进程/预加载/CLI 语法检查通过。
- 在 Xvfb 虚拟屏真实启动 Electron，连续截图确认窗口渲染正常、单词按 6 秒间隔轮播切换
  （scrutinize → resilient → serendipity 循环）、音标按数据有无正确显隐。

## 下一步可扩展

- **打包分发**：继续扩展 macOS 安装包与正式代码签名（Windows 本地安装包已支持）
- **窗口记忆**：记住上次位置（窗口尺寸记忆和开机自启已支持）
- **轮播模式**：随机 / 按分组加权 / 不重复洗牌
- **复习联动**：词义自测模式、复习进度统计

## 目录

```
word-glass/
├── electron/     # 主进程、预加载、补全提示词
├── src/          # React 渲染进程（液态玻璃 UI）
├── scripts/      # enrich-word.mjs 命令行补全
├── data/         # words.json / settings.json（可直接编辑）
├── dist/         # 渲染进程生产构建产物
└── package.json  # dev / build / start / enrich 脚本
```
