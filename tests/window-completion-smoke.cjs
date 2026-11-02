const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const { snapshotProductionData } = require('./helpers/production-data')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const directory = path.join(root, '.test', `window-completion-${Date.now()}`)
const reports = path.join(root, '.test/report')
fs.mkdirSync(directory, { recursive: true })
const full = { word: 'resilient', phonetic: '/fixture/', definitions: [{ partOfSpeech: 'adj.', meaning: '有韧性的' }],
  phrases: ['be resilient：保持韧性'], examples: ['Be resilient. 保持韧性。'] }
const words = [{ ...full, id: 'complete', group: '日常', enriched: false, createdAt: 1 },
  ...['a', 'b'].map(id => ({ ...full, id, word: 'hello', group: id, phrases: [],
    definitions: [{ partOfSpeech: 'n.', meaning: `自定义释义 ${id}` }], enriched: true, createdAt: 1 })),
  { ...full, id: 'failure', word: 'broken', group: '日常', phrases: [], enriched: true, createdAt: 1 }]
fs.writeFileSync(path.join(directory, 'words.json'), JSON.stringify({ words }))
fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ windowWidth: 440, windowHeight: 600,
  llmBaseUrl: 'https://fixture.invalid/v1', llmApiKey: 'fixture-not-real', intervalSec: 300 }))
process.env.WORD_GLASS_DATA_DIR = directory
process.env.WORD_GLASS_DISABLE_TRAY = '1'
process.env.WORD_GLASS_DISABLE_SHORTCUT = '1'
delete process.env.VITE_DEV_SERVER_URL
const productionHashes = () => snapshotProductionData(root)
const before = productionHashes()
const requests = []
global.fetch = async (url, options) => {
  assert.equal(url, 'https://fixture.invalid/v1/chat/completions')
  const word = JSON.parse(options.body).messages[1].content.replace('单词：', '')
  requests.push(word)
  await new Promise(resolve => setTimeout(resolve, 150))
  if (word === 'broken') return new Response('fixture unavailable', { status: 503 })
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(full) } }] }), { status: 200 })
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) {
  for (let i = 0; i < 120; i++) { if (await check()) return; await delay(40) }
  throw new Error('Window/completion smoke timed out')
}
app.on('browser-window-created', (_, win) => {
  win.webContents.once('did-finish-load', async () => {
    try {
      const evaluate = code => win.webContents.executeJavaScript(code)
      await until(() => evaluate("!!document.querySelector('.card-word')"))
      assert.deepEqual(win.getSize(), [440, 600], 'restore saved window size on launch')
      assert.ok(win.isResizable())
      win.setPosition(40, 40)
      await evaluate("document.querySelector('.gear').click()")
      await delay(300)
      await evaluate("window.__resizeEvents=[]; for(const t of ['pointerdown','pointermove','pointerup','gotpointercapture','lostpointercapture']) document.addEventListener(t,e=>window.__resizeEvents.push({type:e.type,target:e.target.className,buttons:e.buttons,id:e.pointerId,x:e.clientX,y:e.clientY,sx:e.screenX,sy:e.screenY}),true)")
      for (const [dx, dy, width, height] of [[-60,-40,380,560], [80,60,460,620]]) {
        const handle = await evaluate(`(() => { const r = document.querySelector('.manager .window-resize').getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)} })()`)
        const origin = win.getBounds()
        const globalPoint = { globalX: origin.x + handle.x, globalY: origin.y + handle.y }
        win.webContents.sendInputEvent({ type: 'mouseMove', ...handle, ...globalPoint })
        win.webContents.sendInputEvent({ type: 'mouseDown', ...handle, ...globalPoint, button: 'left', modifiers: ['leftButtonDown'], clickCount: 1 })
        await delay(50)
        win.webContents.sendInputEvent({ type: 'mouseMove', x: handle.x + dx, y: handle.y + dy,
          globalX: globalPoint.globalX + dx, globalY: globalPoint.globalY + dy, modifiers: ['leftButtonDown'] })
        await until(() => win.getSize()[0] === width && win.getSize()[1] === height)
        win.webContents.sendInputEvent({ type: 'mouseUp', x: handle.x + dx, y: handle.y + dy,
          globalX: globalPoint.globalX + dx, globalY: globalPoint.globalY + dy, button: 'left', clickCount: 1 })
        await until(() => JSON.parse(fs.readFileSync(path.join(directory, 'settings.json'))).windowWidth === width)
      }
      await evaluate("document.querySelector('.manager .window-resize').focus()")
      win.focus()
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
      await until(() => win.getSize()[0] === 470)
      await evaluate("window.wordGlass.resizeWindow({width:100,height:100})")
      assert.deepEqual(win.getSize(), [320,360])
      await evaluate("[...document.querySelectorAll('.tab-btn')].find(b=>b.textContent==='设置').click()")
      await delay(200)
      assert.equal(await evaluate("document.querySelector('[aria-label=\"窗口宽度\"]').value"), '320')
      assert.ok(await evaluate("document.querySelector('.manager-body').scrollWidth <= document.querySelector('.manager-body').clientWidth"), 'settings fit minimum width')
      await evaluate("window.wordGlass.resizeWindow({width:440,height:600})")
      await evaluate("[...document.querySelectorAll('.tab-btn')].find(b=>b.textContent==='词库').click()")
      await delay(200)
      assert.ok(!(await evaluate("document.querySelector('.word-item').textContent")).includes('待补全'))
      assert.deepEqual(await evaluate("[...document.querySelector('.word-item').querySelectorAll('button')].map(b=>b.textContent.trim())"), ['删除'])
      assert.equal(await evaluate("[...document.querySelectorAll('.word-ops button')].filter(b=>b.textContent==='补全').length"), 3)
      await evaluate("document.querySelector('.completion-toolbar button').click()")
      await until(() => evaluate("document.querySelector('.completion-progress')?.textContent.includes('正在补全')"))
      await until(() => evaluate("document.querySelector('.completion-progress')?.textContent.includes('处理完成')"))
      const state = await evaluate('window.wordGlass.getState()')
      assert.equal(state.completion.completed, 2)
      assert.equal(state.completion.failed, 1)
      assert.deepEqual(requests, ['hello', 'broken'], 'one generation shared across groups; complete word skipped')
      assert.equal(state.words.find(w=>w.id==='a').definitions[0].meaning, '自定义释义 a')
      assert.equal(state.words.find(w=>w.id==='b').definitions[0].meaning, '自定义释义 b')
      assert.equal(await evaluate("[...document.querySelectorAll('.word-ops button')].filter(b=>b.textContent==='补全').length"), 1)
      await delay(250)
      fs.writeFileSync(path.join(reports, 'window-completion.png'), (await win.capturePage()).toPNG())
      await evaluate("window.wordGlass.deleteWord('failure')")
      await until(() => evaluate("!document.querySelector('.completion-toolbar button')"))
      await evaluate("[...document.querySelectorAll('.tab-btn')].find(b=>b.textContent==='添加').click()")
      await evaluate("document.querySelector('.tab-pane input').focus()")
      await win.webContents.insertText('hello')
      await evaluate("[...document.querySelectorAll('.btn-row button')].find(b=>b.textContent==='AI 补全').click()")
      await until(() => evaluate("!!document.querySelector('.preview')"))
      assert.ok(!(await evaluate("document.querySelector('.btn-row').textContent")).includes('AI 补全'), 'complete preview hides AI completion')
      assert.deepEqual(productionHashes(), before, 'production data unchanged')
      const result = { passed: true, checks: ['saved size restored', 'pointer resize handle', 'keyboard resize', 'minimum size', 'size persistence',
        'minimum width settings layout', 'complete buttons hidden', 'batch progress', 'AI reused across groups', 'failure report', 'custom content preserved', 'all-complete batch button hidden', 'complete preview button hidden', 'production data unchanged'],
        mode: 'real Electron and IPC; isolated data, fixture LLM response' }
      fs.writeFileSync(path.join(reports, 'window-completion.json'), JSON.stringify(result,null,2))
      console.log(JSON.stringify(result))
      app.exit(0)
    } catch(error) {
      console.error(error)
      console.error(JSON.stringify({size:win.getSize(),focused:win.isFocused(),events:await win.webContents.executeJavaScript('window.__resizeEvents')}))
      fs.writeFileSync(path.join(reports,'window-completion-failure.png'), (await win.capturePage()).toPNG())
      app.exit(1)
    }
  })
})
require('../electron/main')
setTimeout(() => { console.error('Window/completion smoke timed out'); app.exit(1) }, 25000).unref()
