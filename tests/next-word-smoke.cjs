const { app, BrowserWindow, globalShortcut, screen } = require('electron')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { snapshotProductionData } = require('./helpers/production-data')
const root = path.resolve(__dirname, '..')
const directory = path.join(root, '.test', `next-word-${Date.now()}`)
fs.mkdirSync(directory, { recursive: true })
const fixture = (id, word, group) => ({ id, word, group, phonetic: '/fixture/',
  definitions: [{ partOfSpeech: 'n.', meaning: '测试' }], phrases: ['fixture：测试'], examples: ['A fixture. 测试。'], createdAt: 1 })
fs.writeFileSync(path.join(directory, 'words.json'), JSON.stringify({ words: [fixture('a','hello','keep'),
  fixture('excluded','world','other'), fixture('b','resilient','keep')] }))
fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ groups: ['keep'], intervalSec: 60 }))
process.env.WORD_GLASS_DATA_DIR = directory
process.env.WORD_GLASS_DISABLE_TRAY = '1'
delete process.env.WORD_GLASS_DISABLE_SHORTCUT
delete process.env.VITE_DEV_SERVER_URL
const shortcuts = new Map()
globalShortcut.register = (key, callback) => {
  if (key === 'Unavailable' || shortcuts.has(key)) return false
  shortcuts.set(key, callback); return true
}
globalShortcut.unregister = key => shortcuts.delete(key)
globalShortcut.unregisterAll = () => shortcuts.clear()
const hashes = () => snapshotProductionData(root)
const before = hashes()
const delay = ms => new Promise(resolve => setTimeout(resolve,ms))
async function until(check) {
  for (let i=0; i<120; i++) { if (await check()) return; await delay(40) }
  throw new Error('Next-word smoke timed out')
}
app.once('browser-window-created', (_, win) => {
  win.webContents.once('did-finish-load', async () => {
    try {
      const evaluate = async code => {
        try { return await win.webContents.executeJavaScript(code) }
        catch (error) { throw new Error(`${error.message}\nRenderer script: ${code}`) }
      }
      const current = () => evaluate("document.querySelector('.card-word')?.textContent")
      const clickNavigation = async (selector) => {
        await until(() => evaluate("document.querySelector('.card-word').getAnimations().every(animation => animation.playState === 'finished')"))
        const point = await evaluate(`(() => {
          const button = document.querySelector(${JSON.stringify(selector)})
          const box = button.getBoundingClientRect()
          const word = document.querySelector('.card-word').getBoundingClientRect()
          return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2),
            aligned: Math.abs(box.y + box.height / 2 - word.y - word.height / 2) < 1,
            noDrag: getComputedStyle(button).getPropertyValue('-webkit-app-region') === 'no-drag' }
        })()`)
        assert.ok(point.aligned, 'arrows align with the word center')
        assert.ok(point.noDrag, 'arrow clicks must not drag the window')
        win.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
        win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 })
      }
      await until(async () => await current() === 'hello')
      // Keep the fixture away from the cursor so native hover cannot pause the timer.
      const area = screen.getPrimaryDisplay().workArea
      const cursor = screen.getCursorScreenPoint()
      const [width] = win.getSize()
      win.setPosition(cursor.x < area.x + area.width / 2 ? area.x + area.width - width : area.x, area.y)
      assert.ok(shortcuts.has('Control+Alt+N'))
      const wasFocused = win.isFocused()
      shortcuts.get('Control+Alt+N')()
      await until(async () => await current() === 'resilient')
      assert.equal(win.isFocused(), wasFocused, 'switch must not focus the window')
      shortcuts.get('Control+Alt+N')()
      await until(async () => await current() === 'hello')
      await evaluate("window.wordGlass.updateSettings({nextWordShortcut:'Control+Alt+M'})")
      assert.ok(!shortcuts.has('Control+Alt+N') && shortcuts.has('Control+Alt+M'))
      await assert.rejects(evaluate("window.wordGlass.updateSettings({selectionShortcut:'Alt+E',nextWordShortcut:'Unavailable'})"), /下一个词快捷键不可用/)
      const state = await evaluate('window.wordGlass.getState()')
      assert.equal(state.settings.selectionShortcut, 'Control+Shift+Alt+D')
      assert.equal(state.settings.nextWordShortcut, 'Control+Alt+M')
      assert.ok(shortcuts.has('Control+Shift+Alt+D') && !shortcuts.has('Alt+E'))
      await evaluate("window.wordGlass.updateSettings({nextWordShortcut:''})")
      assert.ok(!shortcuts.has('Control+Alt+M'))
      await evaluate("window.wordGlass.updateSettings({nextWordShortcut:'Control+Alt+N',intervalSec:2})")
      win.focus()
      await until(() => evaluate('document.hasFocus()'))
      await until(() => evaluate("document.querySelectorAll('.card-nav').length === 2"))
      await delay(2300)
      assert.equal(await current(), 'hello', 'focused card must not rotate automatically')
      await clickNavigation('.card-nav-previous')
      await until(async () => await current() === 'resilient')
      await clickNavigation('.card-nav-previous')
      await until(async () => await current() === 'hello')
      await clickNavigation('.card-nav-next')
      await until(async () => await current() === 'resilient')
      assert.ok(await evaluate("document.activeElement.matches('.card-nav-next')"), 'button focus survives a word change')
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
      await until(async () => await current() === 'hello')
      await evaluate("document.querySelector('.hover-zone').dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}))")
      await delay(450)
      fs.writeFileSync(path.join(root,'.test/report/card-navigation-focused.png'), (await win.capturePage()).toPNG())
      await evaluate("document.querySelector('.hover-zone').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))")
      win.setSize(320, 520)
      await delay(450)
      await clickNavigation('.card-nav-next')
      await until(async () => await current() === 'resilient')
      await delay(450)
      fs.writeFileSync(path.join(root,'.test/report/card-navigation-narrow.png'), (await win.capturePage()).toPNG())
      await clickNavigation('.card-nav-previous')
      await until(async () => await current() === 'hello')
      await evaluate("document.querySelector('.hover-zone').dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}))")
      shortcuts.get('Control+Alt+N')()
      await until(async () => await current() === 'resilient')
      await delay(2300)
      assert.equal(await current(), 'resilient', 'manual switching must not restart auto rotation while focused')
      const otherWindow = new BrowserWindow({ width: 100, height: 100, skipTaskbar: true, show: false })
      await otherWindow.loadURL('data:text/html,<title>Focus test</title>Other window')
      otherWindow.show()
      otherWindow.focus()
      await until(() => evaluate('!document.hasFocus()'))
      await until(() => evaluate("!document.querySelector('.card-nav')"))
      await delay(900)
      assert.equal(await current(), 'resilient', 'blur starts a fresh full interval')
      await until(async () => await current() === 'hello')
      const hoverPoint = await evaluate("(() => { const box = document.querySelector('.card-word').getBoundingClientRect(); return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) } })()")
      win.webContents.sendInputEvent({ type: 'mouseMove', ...hoverPoint })
      await until(() => evaluate("document.querySelectorAll('.card-nav').length === 2"))
      // Electron may activate its target when injecting mouse input; no click is sent here.
      await delay(2300)
      assert.equal(await current(), 'hello', 'hovering to read details pauses automatic rotation')
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 })
      otherWindow.focus()
      await until(() => evaluate('!document.hasFocus()'))
      await until(() => evaluate("!document.querySelector('.card-nav')"))
      await delay(1400)
      shortcuts.get('Control+Alt+N')()
      await until(async () => await current() === 'resilient')
      await delay(900)
      assert.equal(await current(),'resilient','manual switch resets the old automatic deadline')
      await until(async () => await current() === 'hello')
      await evaluate("window.wordGlass.deleteWord('b')")
      shortcuts.get('Control+Alt+N')()
      await delay(100)
      assert.equal(await current(),'hello','single word is stable')
      win.focus()
      await until(() => evaluate("document.querySelectorAll('.card-nav:disabled').length === 2"))
      await evaluate("window.wordGlass.deleteWord('a')")
      await until(async () => await current() === '')
      shortcuts.get('Control+Alt+N')()
      await delay(100)
      assert.equal(await current(),'','empty filtered list is stable')
      assert.ok(await evaluate("!document.querySelector('.card-nav')"))
      assert.deepEqual(hashes(),before,'production data unchanged')
      const result = { passed:true, checks:['main/preload/renderer dispatch','group filtering','wrap to first word','no focus change',
        'custom shortcut','atomic settings rollback','disable shortcut','native focus pauses rotation','manual switch remains available while focused',
        'hover or focus reveals arrows','previous wraps and filters groups','next pointer and keyboard activation','focus survives switching','centered non-drag arrows at 360 and 320 widths',
        'blur hides arrows when not hovered','mouse movement reveals arrows without clicking','mouse leave hides unfocused arrows','blur restarts full interval','hover pauses reading','manual switch resets auto timer','automatic rotation resumes','single and empty lists','production data unchanged'],
        mode:'real Electron UI/IPC; global shortcut callbacks invoked from fixture registry, no physical key injection' }
      fs.writeFileSync(path.join(root,'.test/report/next-word.json'),JSON.stringify(result,null,2))
      console.log(JSON.stringify(result)); app.exit(0)
    } catch(error) { console.error(error); app.exit(1) }
  })
})
require('../electron/main')
setTimeout(()=>{ console.error('Next-word smoke timed out'); app.exit(1) },30000).unref()
