const { app, ipcMain, screen } = require('electron')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { snapshotProductionData } = require('./helpers/production-data')
const { execFile } = require('child_process')
const { promisify } = require('util')
const root = path.resolve(__dirname, '..')
const directory = path.join(root, '.test', `passthrough-${Date.now()}`)
fs.mkdirSync(directory, { recursive: true })
fs.mkdirSync(path.join(root, '.test/report'), { recursive: true })
fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ intervalSec: 300 }))
fs.writeFileSync(path.join(directory, 'words.json'), JSON.stringify({ words: [{ id: 'test', word: 'resilient', group: 'QA',
  phonetic: '/test/', definitions: [{ partOfSpeech: 'adj.', meaning: '有韧性的' }], phrases: [], examples: [], createdAt: 1 }] }))
process.env.WORD_GLASS_DATA_DIR = directory
process.env.WORD_GLASS_DISABLE_TRAY = '1'
process.env.WORD_GLASS_DISABLE_SHORTCUT = '1'
delete process.env.VITE_DEV_SERVER_URL
const productionHashes = () => snapshotProductionData(root)
const before = productionHashes()
let cursor = { x: -10000, y: -10000 }, ignored = null, latestLayout = null
// Querying a fixture cursor never moves or clicks the user's mouse.
app.whenReady().then(() => { screen.getCursorScreenPoint = () => cursor })
ipcMain.on('window:hit-regions', (event, layout) => { latestLayout = layout })
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) {
  for (let i = 0; i < 120; i++) { if (await check()) return; await delay(30) }
  throw new Error('Mouse passthrough smoke timed out')
}
app.once('browser-window-created', (_, win) => {
  const original = win.setIgnoreMouseEvents.bind(win)
  win.setIgnoreMouseEvents = (value, options) => { ignored = value; return original(value, options) }
  win.webContents.once('did-finish-load', async () => {
    try {
      const evaluate = code => win.webContents.executeJavaScript(code)
      await until(() => latestLayout?.regions?.some(rect => rect.height === 168))
      const point = async (x, y, pass) => {
        const bounds = win.getContentBounds()
        cursor = { x: bounds.x + x, y: bounds.y + y }
        await until(() => ignored === pass)
      }
      const nativeStyle = async () => {
        const handle = win.getNativeWindowHandle().readBigUInt64LE().toString()
        const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-File',
          path.join(__dirname, 'windows-mouse-style.ps1'), '-WindowHandle', handle], { windowsHide: true })
        return stdout.trim()
      }
      await point(180, 300, true)
      if (process.platform === 'win32') assert.equal(await nativeStyle(), 'transparent')
      await point(180, 80, false)
      if (process.platform === 'win32') assert.equal(await nativeStyle(), 'interactive')
      await point(1, 80, true)
      await point(15, 15, true)
      await point(320, 40, false)
      await evaluate("document.querySelector('.hover-zone').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))")
      await until(() => latestLayout.regions.some(rect => rect.height > 480))
      await point(180, 350, false)
      await evaluate("document.querySelector('.hover-zone').dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}))")
      await until(() => latestLayout.regions.some(rect => rect.height === 168))
      await until(() => ignored === true)
      await evaluate("document.querySelector('.gear').click()")
      await until(() => latestLayout.regions.some(rect => rect.height > 480))
      await point(180, 350, false)
      await evaluate("window.wordGlass.resizeWindow({width:440,height:640})")
      await until(() => latestLayout.width === 440 && latestLayout.regions.some(rect => rect.height > 600))
      await point(220, 580, false)
      await point(1, 580, true)
      await evaluate("document.querySelector('[aria-label=\"关闭管理面板\"]').click()")
      await until(() => latestLayout.regions.some(rect => rect.height === 168))
      await point(220, 580, true)
      await evaluate('window.wordGlass.setWindowResizing(true)')
      await until(() => ignored === false)
      await evaluate('window.wordGlass.setWindowResizing(false)')
      await until(() => ignored === true)
      await point(220, 80, false)
      const bounds = win.getContentBounds()
      win.emit('will-move', { preventDefault() {} }, bounds)
      cursor = { x: -10000, y: -10000 }
      await delay(50)
      assert.equal(ignored, false, 'native drag retains mouse capture outside surface')
      win.emit('moved')
      await until(() => ignored === true)
      assert.deepEqual(productionHashes(), before)
      const result = { passed: true, checks: ['collapsed transparent area passes through', 'native Windows transparent style',
        'visible card remains interactive', 'transparent margins and rounded corners', 'settings button interactive',
        'expanded details interactive', 'collapse releases old details area', 'manager and resize update geometry',
        'custom resize releases capture correctly', 'native drag keeps capture until moved', 'production data untouched'],
        mode: 'real Electron renderer geometry, ResizeObserver, IPC and native mouse-ignore API; Windows WS_EX_TRANSPARENT readback; cursor query stubbed, no physical mouse clicks' }
      fs.writeFileSync(path.join(root, '.test/report/mouse-passthrough.json'), JSON.stringify(result, null, 2))
      console.log(JSON.stringify(result))
      app.exit(0)
    } catch (error) { console.error(error); console.error(JSON.stringify({ ignored, latestLayout })); app.exit(1) }
  })
})
require('../electron/main')
setTimeout(() => { console.error('Mouse passthrough smoke timed out'); app.exit(1) }, 20000).unref()
