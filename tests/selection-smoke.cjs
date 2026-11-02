const electron = require('electron')
const { app, globalShortcut, clipboard } = electron
const fs = require('fs')
const path = require('path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const directory = path.join(root, '.test', `selection-${Date.now()}`)
const reports = path.join(root, '.test/report')
fs.mkdirSync(directory, { recursive: true })
fs.mkdirSync(reports, { recursive: true })
process.env.WORD_GLASS_DATA_DIR = directory
process.env.WORD_GLASS_DISABLE_TRAY = '1'
delete process.env.VITE_DEV_SERVER_URL
delete process.env.WORD_GLASS_DISABLE_SHORTCUT
delete process.env.WORD_GLASS_SMOKE
fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ groups: ['日常', '阅读'], theme: 'smoke' }))
fs.writeFileSync(path.join(directory, 'words.json'), JSON.stringify({ words: [{ id: 'original', word: 'resilient', group: '日常',
  phonetic: '', definitions: [{ partOfSpeech: 'adj.', meaning: '我的释义' }], phrases: [], examples: [], enriched: true, createdAt: 1 }] }))

// No OS-wide hotkeys or real clipboard changes in this fixture test.
const shortcuts = new Map()
globalShortcut.register = (key, callback) => { if (key === 'Unavailable') return false; shortcuts.set(key, callback); return true }
globalShortcut.unregister = (key) => shortcuts.delete(key)
globalShortcut.unregisterAll = () => shortcuts.clear()
clipboard.readText = () => 'hello'
let selectedWord = 'resilient'
require('../electron/selection-capture').captureSelectedText = async () => selectedWord
const dictionary = require('../electron/dictionary')
const lookup = dictionary.lookupDictionary
dictionary.lookupDictionary = (word) => lookup(word, { online: false })
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let mainWin, popup
async function until(check) {
  for (let i = 0; i < 80; i++) { if (await check()) return; await delay(40) }
  throw new Error('Selection smoke test timed out waiting for UI')
}
app.on('browser-window-created', (_, win) => {
  if (!mainWin) { mainWin = win; win.hide() }
  else popup = win
})
require('../electron/main')
app.whenReady().then(async () => {
  try {
    await until(() => !mainWin.webContents.isLoading())
    assert.ok(shortcuts.has('Control+Shift+Alt+D'))
    shortcuts.get('Control+Shift+Alt+D')()
    await until(() => popup && !popup.webContents.isLoading())
    const evaluate = (code) => popup.webContents.executeJavaScript(code)
    await until(() => evaluate("document.querySelector('.quick-add-word')?.value === 'resilient'"))
    const firstCapture = await evaluate('window.wordGlass.getSelectionCapture()')
    assert.ok(await evaluate("document.querySelector('.quick-add-submit').disabled"), 'same-group duplicate disabled')
    await evaluate("[...document.querySelectorAll('.quick-add-group')].find(b => b.textContent === '阅读').click()")
    assert.ok(!(await evaluate("document.querySelector('.quick-add-submit').disabled")))
    assert.ok(await evaluate("document.querySelector('.quick-add-panel').scrollHeight <= document.querySelector('.quick-add-panel').clientHeight"))
    await delay(150)
    fs.writeFileSync(path.join(reports, 'selection-popup.png'), (await popup.capturePage()).toPNG())
    await evaluate("document.querySelector('form').requestSubmit()")
    await until(() => evaluate("document.querySelector('.quick-add-feedback').textContent.includes('已添加')"))
    let state = await evaluate('window.wordGlass.getState()')
    assert.equal(state.words.filter((w) => w.word === 'resilient').length, 2)
    assert.equal(state.words.find((w) => w.id === 'original').definitions[0].meaning, '我的释义')
    assert.equal(state.settings.lastCaptureGroup, '阅读')

    selectedWord = 'hello'
    shortcuts.get('Control+Shift+Alt+D')()
    await until(() => evaluate("document.querySelector('.quick-add-word')?.value === 'hello'"))
    await delay(1000)
    assert.ok(popup.isVisible(), 'older auto-close timer must not close a newer selection')
    assert.ok(await evaluate("document.querySelector('.quick-add-group.selected').textContent === '阅读'"))
    await assert.rejects(evaluate(`window.wordGlass.addSelection({captureId:${JSON.stringify(firstCapture.id)},word:'hello',group:'日常'})`), /选词已更新/)
    popup.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    await until(() => !popup.isVisible())
    state = await mainWin.webContents.executeJavaScript('window.wordGlass.getState()')
    assert.equal(state.words.length, 2, 'Escape must not save the selection')

    selectedWord = '中文 paragraph'
    shortcuts.get('Control+Shift+Alt+D')()
    await until(() => evaluate("document.querySelector('.quick-add-message')?.textContent.includes('英文单词或短语')"))
    await evaluate('window.wordGlass.captureClipboard()')
    await until(() => evaluate("document.querySelector('.quick-add-word')?.value === 'hello'"))
    await evaluate("document.querySelector('form').requestSubmit()")
    await until(() => evaluate("document.querySelector('.quick-add-feedback').textContent.includes('已添加')"))
    state = await evaluate('window.wordGlass.getState()')
    assert.equal(state.words.length, 3)
    await assert.rejects(evaluate("window.wordGlass.updateSettings({selectionShortcut:'Unavailable'})"), /快捷键不可用/)
    assert.ok(shortcuts.has('Control+Shift+Alt+D'), 'failed registration must preserve previous shortcut')
    await evaluate("window.wordGlass.updateSettings({selectionShortcut:''})")
    assert.ok(!shortcuts.has('Control+Shift+Alt+D'))
    const result = { passed: true, checks: ['popup selection/group UI', 'same-group duplicate', 'different-group add', 'preserve original entry',
      'remember last group', 'stale request rejection', 'new capture survives old close timer', 'Escape cancels',
      'invalid selection and clipboard fallback', 'shortcut conflict rollback', 'disable shortcut'], mode: 'real Electron UI/IPC; OS capture and hotkeys stubbed' }
    fs.writeFileSync(path.join(reports, 'selection-electron.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result)); app.exit(0)
  } catch (error) { console.error(error); app.exit(1) }
})
setTimeout(() => app.exit(1), 20000).unref()
