'use strict'

const { app, BrowserWindow, ipcMain, screen, shell, net, globalShortcut, clipboard, Tray, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { ENRICH_SYSTEM_PROMPT } = require('./enrich-prompt')
const { lookupLocal, lookupDictionary, mergeDictionaryContent } = require('./dictionary')
const { normalizeWord, httpsUrl } = require('./dictionary-utils')
const { normalizeSelection, captureSelectedText, popupPosition } = require('./selection-capture')
const { isComplete, createCompletionService } = require('./completion')
const { createShortcutManager } = require('./shortcuts')
const { createAutostartService } = require('./autostart')
const { createTrayController } = require('./tray')
const { normalizeRegions, containsPoint } = require('./window-hit-test')
const { createPronunciationService } = require('./pronunciation')
const { hasTranslation } = require('./example-translations')
const { initializeDataDirectory } = require('./data-directory')

if (app.isPackaged) {
  app.setPath('userData', process.env.WORD_GLASS_DATA_DIR
    ? path.join(path.resolve(process.env.WORD_GLASS_DATA_DIR), 'profile')
    : path.join(app.getPath('appData'), 'WordGlass'))
}

// Isolated fixture processes use their own data and may run alongside the app.
const primaryInstance = !!process.env.WORD_GLASS_DATA_DIR || app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()

// ---------------------------------------------------------------------------
// Linux 下透明窗口依赖合成器，提前开启透明渲染支持
// ---------------------------------------------------------------------------
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals')
  app.commandLine.appendSwitch('disable-gpu')
}

// ---------------------------------------------------------------------------
// 开发版使用项目 data/；安装版使用独立、可写且不会被升级覆盖的用户目录。
// ---------------------------------------------------------------------------
const dataDir = initializeDataDirectory({ override: process.env.WORD_GLASS_DATA_DIR,
  packaged: app.isPackaged, projectDir: path.resolve(__dirname, '..'), userDataDir: app.getPath('userData'),
  defaultsDir: path.resolve(__dirname, '../resources/defaults'), primary: primaryInstance })

const WORDS_FILE = path.join(dataDir, 'words.json')
const SETTINGS_FILE = path.join(dataDir, 'settings.json')

const THEMES = ['smoke', 'frost', 'aurora']

const DEFAULT_SETTINGS = {
  intervalSec: 6, // 单词轮播间隔（秒）
  showPhonetic: true, // 是否显示音标
  groups: [], // 轮播分组白名单；空数组 = 全部分组
  theme: 'smoke', // 卡片玻璃主题：smoke | frost | aurora
  selectionShortcut: 'Control+Shift+Alt+D',
  nextWordShortcut: 'Control+Alt+N',
  lastCaptureGroup: '',
  windowWidth: 360,
  windowHeight: 520,
  llmBaseUrl: '', // OpenAI 兼容接口 baseUrl，如 https://api.openai.com
  llmApiKey: '',
  llmModel: 'gpt-4o-mini',
}

// ---------------------------------------------------------------------------
// 存储读写（原子写：tmp + rename，避免写一半损坏）
// ---------------------------------------------------------------------------
function readJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (e) {
    console.warn(`[word-glass] 读取 ${file} 失败，使用默认值：`, e.message)
  }
  return fallback
}

function writeJson(file, data) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, file)
}

function loadState() {
  const settings = { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) }
  const document = readJson(WORDS_FILE, { words: [] })
  let changed = false
  const words = document.words.map((entry) => {
    if (typeof entry.word !== 'string' || entry.word === entry.word.toLowerCase()) return entry
    changed = true
    return { ...entry, word: entry.word.toLowerCase() }
  })
  if (changed && primaryInstance) writeJson(WORDS_FILE, { ...document, words })
  return { settings, words }
}

let state = loadState()
const autostartService = createAutostartService({ app, executable: process.execPath,
  appPath: path.resolve(__dirname, '..'), packaged: app.isPackaged,
  rendererPath: path.resolve(__dirname, '../dist/index.html') })

function saveWords() {
  writeJson(WORDS_FILE, { words: state.words })
  broadcastState()
}

function saveSettings() {
  writeJson(SETTINGS_FILE, state.settings)
  broadcastState()
}

function broadcastState() {
  for (const window of [win, quickWin]) {
    if (window && !window.isDestroyed()) window.webContents.send('state:changed', viewState())
  }
}

function viewState() {
  return { ...state, words: state.words.map((word) => ({ ...word, complete: isComplete(word) })) }
}

// ---------------------------------------------------------------------------
// 窗口：透明 + 无边框 + 置顶 + 常驻任务栏外
// ---------------------------------------------------------------------------
const WIN_WIDTH = 360
const WIN_HEIGHT = 520 // 视觉上只有卡片是玻璃，其余区域透明

let win = null
let cursorTimer = null
let quickWin = null
let selectionCapture = null
let capturingSelection = false
let resizeSaveTimer = null
let customResizing = false
let hitRegions = null
let updateMousePassthrough = () => {}
let trayController = null
let trayFailed = false
let quitting = false
const APP_ICON = path.resolve(__dirname, `../assets/tray.${process.platform === 'win32' ? 'ico' : 'png'}`)

function showMainWindow() {
  if (!win || win.isDestroyed()) createWindow()
  win.setSkipTaskbar(!trayFailed)
  win.show()
  win.focus()
}

function hideMainWindow() {
  customResizing = false
  if (win && !win.isDestroyed()) win.hide()
  if (quickWin && !quickWin.isDestroyed()) quickWin.hide()
}

function createTray() {
  if (process.env.WORD_GLASS_DISABLE_TRAY === '1') return
  try {
    trayController = createTrayController({ Tray, Menu, icon: APP_ICON, getWindow: () => win,
      showWindow: showMainWindow, hideWindow: hideMainWindow,
      openManager: () => { showMainWindow(); win.webContents.send('manager:open') },
      nextWord: () => { if (win && !win.isDestroyed()) win.webContents.send('rotation:next') },
      quit: () => app.quit(),
    })
    console.log('[word-glass] tray ready; taskbar hidden')
  } catch (error) {
    trayFailed = true
    if (win && !win.isDestroyed()) win.setSkipTaskbar(false)
    console.warn('[word-glass] tray unavailable:', error.message)
  }
}

function windowSize(width, height) {
  const area = win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()).workArea : screen.getPrimaryDisplay().workArea
  const limit = (value, fallback, min, max) => Math.round(Math.max(min, Math.min(max, Number(value) || fallback)))
  return { width: limit(width, WIN_WIDTH, 320, Math.max(320, Math.min(1200, area.width))),
    height: limit(height, WIN_HEIGHT, 360, Math.max(360, Math.min(1200, area.height))) }
}

function applyWindowSize(width, height) {
  const size = windowSize(width, height)
  if (win && !win.isDestroyed()) win.setSize(size.width, size.height)
  state.settings.windowWidth = size.width
  state.settings.windowHeight = size.height
  return size
}

const shortcutActions = [
  { field: 'selectionShortcut', status: 'selection', label: '选词', run: () => requestSelectionCapture(false) },
  { field: 'nextWordShortcut', status: 'nextWord', label: '下一个词', run: () => {
    if (win && !win.isDestroyed()) win.webContents.send('rotation:next')
  } },
]
const shortcutManager = createShortcutManager(globalShortcut, shortcutActions, process.env.WORD_GLASS_DISABLE_SHORTCUT === '1')
function updateShortcuts(settings) { Object.assign(state, shortcutManager.update(settings)) }

function loadRenderer(window, quickAdd = false) {
  const devUrl = app.isPackaged || process.argv.includes('--autostart') ? undefined : process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    const url = new URL(devUrl)
    if (quickAdd) url.searchParams.set('view', 'quick-add')
    window.loadURL(url.href)
  } else window.loadFile(path.join(__dirname, '../dist/index.html'), quickAdd ? { query: { view: 'quick-add' } } : {})
}

function showSelectionPopup() {
  if (!quickWin || quickWin.isDestroyed()) {
    quickWin = new BrowserWindow({ width: 360, height: 360, show: false, transparent: true, frame: false,
      resizable: false, maximizable: false, minimizable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    quickWin.setAlwaysOnTop(true, 'screen-saver')
    quickWin.on('closed', () => { quickWin = null })
    quickWin.on('blur', () => { if (quickWin && !quickWin.isDestroyed()) quickWin.hide() })
    quickWin.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); quickWin.hide() }
    })
    quickWin.webContents.once('did-finish-load', () => {
      if (!quickWin || quickWin.isDestroyed()) return
      quickWin.show(); quickWin.focus()
    })
    loadRenderer(quickWin, true)
  } else {
    quickWin.webContents.send('selection:changed', selectionCapture)
    quickWin.show(); quickWin.focus()
  }
  const point = screen.getCursorScreenPoint()
  const area = screen.getDisplayNearestPoint(point).workArea
  const position = popupPosition(point, area, 360, 360)
  quickWin.setPosition(position.x, position.y)
}

async function requestSelectionCapture(fromClipboard) {
  if (capturingSelection) return
  capturingSelection = true
  try {
    // Keep the original app focused until its selection has been read.
    const word = normalizeSelection(fromClipboard ? clipboard.readText() : await captureSelectedText())
    selectionCapture = { id: crypto.randomUUID(), word, content: lookupLocal(word), error: '' }
  } catch (error) {
    selectionCapture = { id: crypto.randomUUID(), word: '', content: null, error: error.message }
  } finally { capturingSelection = false }
  if (win && !win.isDestroyed()) showSelectionPopup()
}

function createWindow() {
  const size = windowSize(state.settings.windowWidth, state.settings.windowHeight)
  win = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: 320,
    minHeight: 360,
    maxWidth: 1200,
    maxHeight: 1200,
    transparent: true,
    frame: false,
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    title: '浮光单词 · Word Glass',
    skipTaskbar: true,
    icon: APP_ICON,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  state.settings.windowWidth = size.width
  state.settings.windowHeight = size.height
  win.setSkipTaskbar(!trayFailed)
  win.on('show', () => { win.setSkipTaskbar(!trayFailed); trayController?.refresh() })
  win.on('hide', () => trayController?.refresh())

  // screen-saver 级别置顶，尽量不被其他窗口盖住
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (httpsUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 在一个画面帧内接管鼠标，避免快速移入后按下时仍穿透到下层应用。
  // 原生拖动期间保持接管，防止光标/窗口坐标更新次序导致拖动中断。
  let mouseInside = null
  let nativeDragging = false
  hitRegions = null
  updateMousePassthrough = () => {
    if (!win || win.isDestroyed()) return
    const pt = screen.getCursorScreenPoint()
    const b = win.getContentBounds()
    const inside = nativeDragging || customResizing || containsPoint(hitRegions, pt.x - b.x, pt.y - b.y, b.width, b.height)
    if (inside !== mouseInside) {
      mouseInside = inside
      win.setIgnoreMouseEvents(!inside, { forward: true })
    }
  }
  updateMousePassthrough()
  cursorTimer = setInterval(updateMousePassthrough, 16)
  win.on('will-move', () => { nativeDragging = true; updateMousePassthrough() })
  win.on('moved', () => { nativeDragging = false; updateMousePassthrough() })
  const rememberSize = () => {
    if (!win || win.isDestroyed()) return
    const [width, height] = win.getSize()
    state.settings.windowWidth = width
    state.settings.windowHeight = height
    saveSettings()
  }
  win.on('resize', () => {
    clearTimeout(resizeSaveTimer)
    resizeSaveTimer = setTimeout(rememberSize, 180)
  })
  win.on('close', (event) => {
    if (resizeSaveTimer) { clearTimeout(resizeSaveTimer); resizeSaveTimer = null; rememberSize() }
    if (!quitting && trayController && !trayController.tray.isDestroyed()) {
      event.preventDefault()
      hideMainWindow()
    }
  })

  loadRenderer(win)

  win.on('closed', () => {
    clearInterval(cursorTimer)
    updateMousePassthrough = () => {}
    hitRegions = null
    customResizing = false
    win = null
    if (quickWin && !quickWin.isDestroyed()) quickWin.close()
  })

  // 冒烟测试钩子：WORD_GLASS_SMOKE=<张数> 时自动截屏并退出（正常使用不受影响）
  const smokeShots = process.env.WORD_GLASS_SMOKE
  if (smokeShots) {
    const shots = Number(smokeShots) || 1
    let n = 0
    const timer = setInterval(async () => {
      if (!win || win.isDestroyed()) return
      try {
        const img = await win.capturePage()
        fs.writeFileSync(path.join(__dirname, `../smoke-${n}.png`), img.toPNG())
        console.log(`SMOKE_SHOT_${n}`, img.getSize())
      } catch (e) {
        console.error('SMOKE_FAIL', e.message)
      }
      n++
      if (n >= shots) {
        clearInterval(timer)
        console.log('SMOKE_DONE')
        app.quit()
      }
    }, 6500)
  }
}

// ---------------------------------------------------------------------------
// LLM 词条补全（OpenAI 兼容接口）
// ---------------------------------------------------------------------------
async function enrichWordWithLLM(word, settings, context = {}) {
  const base = (settings.llmBaseUrl || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '')
  if (!base || !settings.llmApiKey) {
    throw new Error('未配置 LLM 接口（需设置 llmBaseUrl 和 llmApiKey）')
  }
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(60000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.llmApiKey}`,
    },
    body: JSON.stringify({
      model: settings.llmModel || 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: ENRICH_SYSTEM_PROMPT },
        { role: 'user', content: `单词：${word}` + (context.examples?.length
          ? `\n请为以下已有英文例句逐条补充中文翻译，在 examples 中完整返回每一条，英文原句必须原样保留：\n${JSON.stringify({ existingExamples: context.examples })}` : '') },
      ],
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const error = new Error(`LLM 接口返回 ${res.status}: ${text.slice(0, 200)}`)
    error.status = res.status
    throw error
  }
  const data = await res.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('LLM 返回内容为空')
  // 兼容模型偶尔输出 markdown 代码块包裹
  const jsonStr = content.replace(/```json|```/g, '').trim()
  const parsed = JSON.parse(jsonStr)
  return cleanContent({
    word: (parsed.word || word).trim(),
    phonetic: String(parsed.phonetic || ''),
    definitions: Array.isArray(parsed.definitions) ? parsed.definitions : [],
    phrases: Array.isArray(parsed.phrases) ? parsed.phrases : [],
    examples: Array.isArray(parsed.examples) ? parsed.examples : [],
    sources: [{ name: 'AI 补全', url: '' }],
  }, word)
}

// Preview results cross the renderer boundary; persist only known word fields.
function cleanContent(value, word) {
  const strings = (items) => Array.isArray(items) ? items.filter((item) => typeof item === 'string' && item.trim()) : []
  return {
    word,
    phonetic: typeof value.phonetic === 'string' ? value.phonetic : '',
    definitions: Array.isArray(value.definitions) ? value.definitions
      .filter((d) => d && typeof d.meaning === 'string' && d.meaning.trim())
      .map((d) => ({ partOfSpeech: typeof d.partOfSpeech === 'string' ? d.partOfSpeech : '', meaning: d.meaning })) : [],
    phrases: strings(value.phrases), examples: strings(value.examples),
    audioUrl: httpsUrl(value.audioUrl), lookupNote: typeof value.lookupNote === 'string' ? value.lookupNote : '',
    sources: Array.isArray(value.sources) ? value.sources.filter((source) => typeof source?.name === 'string')
      .map((source) => ({ name: source.name, url: httpsUrl(source.url),
        ...(typeof source.license?.name === 'string' ? { license: { name: source.license.name, url: httpsUrl(source.license.url) } } : {}) })) : [],
  }
}

async function fillFromDictionary(entry) {
  const content = await lookupDictionary(entry.word, { fetchImpl: net.fetch.bind(net) })
  // The entry may have been removed while its network lookup was pending.
  if (!state.words.includes(entry)) return entry
  Object.assign(entry, mergeDictionaryContent(entry, content))
  saveWords()
  return entry
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function uid() {
  return crypto.randomUUID()
}

ipcMain.handle('state:get', () => viewState())
const pronunciationService = createPronunciationService()
ipcMain.handle('pronunciation:get', (event, word) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) throw new Error('窗口不可用')
  return pronunciationService.get(word)
})
ipcMain.handle('autostart:get', () => autostartService.read())
ipcMain.handle('autostart:set', (event, enabled) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) throw new Error('窗口不可用')
  return autostartService.setEnabled(enabled)
})
ipcMain.handle('window:resize', (event, size) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) throw new Error('窗口不可用')
  return applyWindowSize(size?.width, size?.height)
})
ipcMain.on('window:resizing', (event, active) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return
  customResizing = active === true
  updateMousePassthrough()
})
ipcMain.on('window:hit-regions', (event, layout) => {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return
  const normalized = normalizeRegions(layout)
  if (!normalized) return
  hitRegions = normalized
  updateMousePassthrough()
})

const completionService = createCompletionService({
  getWords: () => state.words,
  getSettings: () => state.settings,
  lookup: (word) => lookupDictionary(word, { fetchImpl: net.fetch.bind(net) }),
  generate: enrichWordWithLLM,
  save: saveWords,
  onProgress: (progress) => { state.completion = progress; broadcastState() },
})
ipcMain.handle('words:complete', async (event, id) => {
  const entry = state.words.find((word) => word.id === id)
  if (!entry) throw new Error('词条不存在')
  await completionService.completeEntry(entry)
  return { ...entry, complete: isComplete(entry) }
})
ipcMain.handle('words:complete-all', () => completionService.completeAll())
ipcMain.handle('words:stop-completion', () => { completionService.stop() })

function addWord(payload) {
  const { word, group = '默认分组', definitions = [], content } = payload || {}
  const w = normalizeWord(word)
  const targetGroup = String(group || '').trim() || '默认分组'

  // 已存在则返回现有词条
  const existed = state.words.find((it) => it.word.toLowerCase() === w.toLowerCase() && it.group === targetGroup)
  if (existed) return { word: existed, created: false }

  if (content && normalizeWord(content.word) !== normalizeWord(w)) throw new Error('预览结果与当前单词不一致，请重新查词')
  const local = lookupLocal(w)
  const selected = cleanContent(content || { ...local, definitions: definitions.length ? definitions : local?.definitions }, w)
  const entry = {
    ...selected,
    id: uid(),
    word: w,
    group: targetGroup,
    enriched: selected.definitions.length > 0,
    createdAt: Date.now(),
  }
  state.words.push(entry)
  saveWords()

  // Chinese meanings are already available; remote examples/audio are optional.
  fillFromDictionary(entry).catch((err) => console.warn(`[word-glass] 查词 ${w} 失败：`, err.message))
  return { word: entry, created: true }
}

ipcMain.handle('words:add', (event, payload) => addWord(payload))

ipcMain.handle('selection:get', () => selectionCapture)
ipcMain.handle('selection:clipboard', () => requestSelectionCapture(true))
ipcMain.handle('selection:dismiss', () => { if (quickWin && !quickWin.isDestroyed()) quickWin.hide() })
ipcMain.handle('selection:add', (event, payload) => {
  if (!selectionCapture || selectionCapture.id !== payload?.captureId) throw new Error('选词已更新，请重新确认')
  const word = normalizeSelection(payload.word)
  const result = addWord({ word, group: payload.group })
  state.settings.lastCaptureGroup = result.word.group
  saveSettings()
  const captureId = selectionCapture.id
  setTimeout(() => {
    if (selectionCapture?.id === captureId && quickWin && !quickWin.isDestroyed()) quickWin.hide()
  }, 900)
  return result
})

ipcMain.handle('words:delete', (event, id) => {
  state.words = state.words.filter((it) => it.id !== id)
  saveWords()
  return true
})

ipcMain.handle('words:enrich', async (event, id) => {
  const entry = state.words.find((it) => it.id === id)
  if (!entry) throw new Error('词条不存在')
  return fillFromDictionary(entry)
})

ipcMain.handle('words:lookup', async (event, word) => {
  const content = await lookupDictionary(word, { fetchImpl: net.fetch.bind(net) })
  return { ...content, complete: isComplete(content) }
})

ipcMain.handle('words:enrich-ai', async (event, id) => {
  const entry = state.words.find((it) => it.id === id)
  if (!entry) throw new Error('词条不存在')
  if (isComplete(entry)) return { ...entry, complete: true }
  const full = await enrichWordWithLLM(entry.word, state.settings, {
    examples: entry.examples.filter((example) => !hasTranslation(example)),
  })
  if (!state.words.includes(entry)) return entry
  Object.assign(entry, mergeDictionaryContent(entry, full))
  entry.enriched = isComplete(entry)
  saveWords()
  return entry
})

ipcMain.handle('words:enrich-llm', async (event, word) => {
  // 添加前预览：只调 LLM，不入库
  const content = await enrichWordWithLLM(String(word || '').trim(), state.settings)
  return { ...content, complete: isComplete(content) }
})

ipcMain.handle('groups:add', (event, name) => {
  const n = String(name || '').trim()
  if (!n) throw new Error('分组名不能为空')
  const groups = new Set(state.words.map((it) => it.group))
  groups.add(n)
  // 新分组默认加入轮播白名单
  if (!state.settings.groups.includes(n)) {
    state.settings.groups.push(n)
    saveSettings()
  }
  return Array.from(groups)
})

ipcMain.handle('settings:update', (event, patch) => {
  const next = { ...state.settings, ...(patch || {}) }
  next.intervalSec = Math.max(1, Number(next.intervalSec) || DEFAULT_SETTINGS.intervalSec)
  if (!THEMES.includes(next.theme)) next.theme = DEFAULT_SETTINGS.theme
  updateShortcuts(next)
  const size = windowSize(next.windowWidth, next.windowHeight)
  next.windowWidth = size.width
  next.windowHeight = size.height
  state.settings = next
  applyWindowSize(size.width, size.height)
  saveSettings()
  return state.settings
})

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  if (!primaryInstance) return
  if (process.platform === 'win32') app.setAppUserModelId('com.wordglass.desktop')
  createWindow()
  createTray()
  // A conflict in one saved binding must not stop the other feature at startup.
  Object.assign(state, shortcutManager.start(state.settings))
  console.log('[word-glass] selection shortcut:', JSON.stringify(state.selection))
  console.log('[word-glass] next word shortcut:', JSON.stringify(state.nextWord))
  app.on('activate', () => {
    showMainWindow()
  })
})

app.on('second-instance', (event, argv) => {
  if (argv.includes('--autostart')) return
  showMainWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && (!trayController || trayController.tray.isDestroyed())) app.quit()
})

app.on('before-quit', () => {
  quitting = true
  globalShortcut.unregisterAll()
  trayController?.destroy()
})
