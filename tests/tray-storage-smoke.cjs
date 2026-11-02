const { app, globalShortcut } = require('electron')
const fs = require('fs')
const path = require('path')
const assert = require('node:assert/strict')
const { snapshotProductionData } = require('./helpers/production-data.cjs')
const root = path.resolve(__dirname, '..')
const directory = path.join(root, '.test', `tray-storage-${Date.now()}`)
const reports = path.join(root, '.test/report')
fs.mkdirSync(directory, { recursive: true })
fs.mkdirSync(reports, { recursive: true })
process.env.WORD_GLASS_DATA_DIR = directory
delete process.env.WORD_GLASS_DISABLE_TRAY
delete process.env.WORD_GLASS_DISABLE_SHORTCUT
delete process.env.VITE_DEV_SERVER_URL
delete process.env.WORD_GLASS_SMOKE
const productionHashes = () => snapshotProductionData(root)
const before = productionHashes()
const legacy = { id: 'legacy', word: 'ReSiLiEnT', group: '日常', phonetic: '/test/',
  definitions: [{ partOfSpeech: 'adj.', meaning: '保留自定义释义' }], phrases: [], examples: [], createdAt: 1 }
fs.writeFileSync(path.join(directory, 'words.json'), JSON.stringify({ note: 'preserve metadata on migration', words: [legacy] }))
fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ intervalSec: 600, groups: [] }))
const shortcuts = new Map()
globalShortcut.register = (key, callback) => { shortcuts.set(key, callback); return true }
globalShortcut.unregister = (key) => shortcuts.delete(key)
globalShortcut.unregisterAll = () => shortcuts.clear()
require('../electron/selection-capture').captureSelectedText = async () => 'WORLD'
const dictionary = require('../electron/dictionary')
const originalLookup = dictionary.lookupDictionary
dictionary.lookupDictionary = (word) => originalLookup(word, { online: false })
const trayModule = require('../electron/tray')
const originalCreate = trayModule.createTrayController
let controller, mainWin, popup, passed = false
trayModule.createTrayController = (options) => (controller = originalCreate(options))
const taskbarCalls = []
app.on('browser-window-created', (_, win) => {
  if (!mainWin) {
    mainWin = win
    const original = win.setSkipTaskbar.bind(win)
    win.setSkipTaskbar = (skip) => { taskbarCalls.push(skip); return original(skip) }
  } else popup = win
})
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await delay(40) }
  throw new Error('Tray/storage smoke timed out waiting for condition')
}
require('../electron/main')
app.on('will-quit', () => {
  if (!passed) return
  try {
    assert.ok(controller.tray.isDestroyed(), 'quit removes native tray icon')
    assert.ok(mainWin.isDestroyed(), 'quit closes main window instead of hiding it')
    assert.deepEqual(productionHashes(), before)
    const result = { passed: true, checks: ['legacy lowercase migration preserves fields', 'mixed-case direct add',
      'uppercase preview add', 'screen-selection add', 'case-insensitive group dedupe', 'native Tray creation with ICO',
      'taskbar skip on show', 'close hides without exit', 'tray click restores', 'tray menu hide/show',
      'tray menu opens manager', 'tray menu switches word', 'tray quit closes window and destroys icon', 'production data untouched'],
      mode: 'real Electron windows, Tray, Menu and IPC; OS selection/hotkeys stubbed, dictionary offline; shell taskbar placement not visually inspected' }
    fs.writeFileSync(path.join(reports, 'tray-storage.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result))
  } catch (error) { console.error(error); process.exitCode = 1 }
})
app.whenReady().then(async () => {
  try {
    const evaluate = (code) => mainWin.webContents.executeJavaScript(code)
    await until(() => controller && !mainWin.webContents.isLoading())
    await until(() => evaluate("document.querySelector('.card-word')?.textContent === 'resilient'"))
    assert.ok(!controller.tray.isDestroyed())
    const migrated = JSON.parse(fs.readFileSync(path.join(directory, 'words.json'), 'utf8'))
    assert.deepEqual(migrated, { note: 'preserve metadata on migration', words: [{ ...legacy, word: 'resilient' }] })
    const added = await evaluate("window.wordGlass.addWord({word:' HeLLo ', group:'日常'})")
    assert.equal(added.word.word, 'hello')
    assert.equal((await evaluate("window.wordGlass.addWord({word:'HELLO',group:'日常'})")).created, false)
    const preview = await evaluate("window.wordGlass.lookupWord('computer')")
    const saved = await evaluate(`window.wordGlass.addWord({word:'COMPUTER',group:'日常',content:${JSON.stringify({ ...preview, word: 'CoMpUtEr' })}})`)
    assert.equal(saved.word.word, 'computer')
    assert.deepEqual(saved.word.definitions, preview.definitions)
    shortcuts.get('Control+Shift+Alt+D')()
    await until(() => popup && !popup.webContents.isLoading())
    await until(() => popup.webContents.executeJavaScript('!!window.wordGlass'))
    const capture = await popup.webContents.executeJavaScript('window.wordGlass.getSelectionCapture()')
    const selection = await popup.webContents.executeJavaScript(`window.wordGlass.addSelection({captureId:${JSON.stringify(capture.id)},word:'WoRlD',group:'阅读'})`)
    assert.equal(selection.word.word, 'world')
    assert.equal(selection.word.group, '阅读')
    const crossGroup = await evaluate("window.wordGlass.addWord({word:'HELLO',group:'阅读'})")
    assert.ok(crossGroup.created)
    assert.equal(crossGroup.word.word, 'hello')
    const persisted = JSON.parse(fs.readFileSync(path.join(directory, 'words.json'), 'utf8'))
    assert.ok(persisted.words.every((entry) => entry.word === entry.word.toLowerCase()))
    mainWin.close()
    assert.ok(!mainWin.isDestroyed())
    assert.equal(mainWin.isVisible(), false)
    controller.tray.emit('click')
    assert.ok(mainWin.isVisible())
    assert.equal(taskbarCalls.at(-1), true)
    assert.ok(taskbarCalls.every(Boolean))
    controller.menu.getMenuItemById('toggle-card').click()
    assert.equal(mainWin.isVisible(), false)
    controller.menu.getMenuItemById('toggle-card').click()
    assert.ok(mainWin.isVisible())
    const wordBefore = await evaluate("document.querySelector('.card-word').textContent")
    controller.menu.getMenuItemById('next-word').click()
    await until(() => evaluate(`document.querySelector('.card-word').textContent !== ${JSON.stringify(wordBefore)}`))
    controller.menu.getMenuItemById('manage').click()
    await until(() => evaluate("!!document.querySelector('.manager')"))
    passed = true
    controller.menu.getMenuItemById('quit').click()
  } catch (error) {
    console.error(error)
    controller?.destroy()
    app.exit(1)
  }
})
setTimeout(() => { console.error('Tray/storage smoke timed out'); controller?.destroy(); app.exit(1) }, 20000).unref()
