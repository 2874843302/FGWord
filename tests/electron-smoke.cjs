const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const assert = require('node:assert/strict')
const crypto = require('crypto')

const root = path.resolve(__dirname, '..')
const directory = path.join(root, '.test', `electron-${Date.now()}`)
const reports = path.join(root, '.test/report')
fs.mkdirSync(directory, { recursive: true })
fs.mkdirSync(reports, { recursive: true })
process.env.WORD_GLASS_DATA_DIR = directory
process.env.WORD_GLASS_DISABLE_SHORTCUT = '1'
process.env.WORD_GLASS_DISABLE_TRAY = '1'
delete process.env.VITE_DEV_SERVER_URL
delete process.env.WORD_GLASS_SMOKE
const productionFiles = ['words.json', 'settings.json'].map((name) => path.join(root, 'data', name))
const hashes = () => productionFiles.map((file) => fs.existsSync(file)
  ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null)
const before = hashes()
const customDefinition = { partOfSpeech: 'adj.', meaning: '保留我的自定义中文释义' }
fs.writeFileSync(path.join(directory, 'words.json'), JSON.stringify({ words: [{
  id: 'existing', word: 'resilient', group: '测试', phonetic: '', definitions: [customDefinition],
  phrases: [], examples: [], enriched: false, createdAt: 1,
}] }))
fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ intervalSec: 130, theme: 'smoke' }))

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const dictionary = require('../electron/dictionary')
const originalLookup = dictionary.lookupDictionary
let offline = false, requests = 0
dictionary.lookupDictionary = (word, options) => originalLookup(word, { ...options, fetchImpl: async () => {
  requests++
  await delay(150)
  if (offline) throw new Error('offline fixture')
  if (word === 'wordglasszzzxnonword') return new Response('{}', { status: 404 })
  return new Response(JSON.stringify([{ word,
    phonetic: '/test/',
    phonetics: [{ audio: 'https://example.org/pronunciation.mp3', sourceUrl: 'https://example.org/audio',
      license: { name: 'BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' } }],
    meanings: [{ definitions: [{ example: 'This is a fixture example.' }] }],
    sourceUrls: ['https://en.wiktionary.org/wiki/' + word],
    license: { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/' },
  }]), { status: 200 })
} })

app.on('browser-window-created', (_, win) => {
  win.hide()
  win.webContents.once('did-finish-load', async () => {
    const evaluate = (script) => win.webContents.executeJavaScript(script)
    const until = async (expression) => {
      for (let i = 0; i < 80; i++) {
        if (await evaluate(expression)) return
        await delay(50)
      }
      throw new Error(`Timed out: ${expression}`)
    }
    try {
      await until("document.querySelector('.card-word')?.textContent === 'resilient'")
      const added = await evaluate("window.wordGlass.addWord({word:'HeLLo',group:'测试'})")
      assert.ok(added.created)
      assert.equal(added.word.word, 'hello')
      assert.ok(added.word.definitions.some((d) => /[\u4e00-\u9fff]/.test(d.meaning)))
      assert.ok(added.word.phonetic)
      const duplicate = await evaluate("window.wordGlass.addWord({word:'HELLO',group:'测试'})")
      assert.equal(duplicate.created, false)

      const refreshed = await evaluate("window.wordGlass.enrichWord('existing')")
      assert.deepEqual(refreshed.definitions, [customDefinition])
      assert.ok(refreshed.phonetic)
      await until("!!document.querySelector('.pronunciation-btn')")
      // Check actual click wiring without emitting audible sound during automated QA.
      await evaluate("HTMLMediaElement.prototype.play = function() { window.__playedAudio = this.src; return Promise.resolve() }; document.querySelector('.pronunciation-btn').click()")
      assert.equal(await evaluate('window.__playedAudio'), 'https://example.org/pronunciation.mp3')
      await evaluate("document.querySelector('.hover-zone').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))")
      await delay(450)
      assert.ok(await evaluate("document.querySelector('.word-sources').textContent.includes('CC BY-SA 3.0')"))
      fs.writeFileSync(path.join(reports, 'dictionary-detail.png'), (await win.capturePage()).toPNG())

      const preview = await evaluate("window.wordGlass.lookupWord('computer')")
      const saved = await evaluate(`window.wordGlass.addWord({word:'computer',group:'测试',content:${JSON.stringify(preview)}})`)
      assert.deepEqual(saved.word.examples, preview.examples)
      assert.equal(saved.word.phonetic, preview.phonetic)
      assert.ok(saved.word.sources.length)
      const unknown = await evaluate("window.wordGlass.lookupWord('wordglasszzzxnonword')")
      assert.equal(unknown.definitions.length, 0)
      assert.match(unknown.lookupNote, /未收录/)

      const pending = await evaluate("window.wordGlass.addWord({word:'resilience',group:'测试'})")
      await evaluate(`window.wordGlass.deleteWord(${JSON.stringify(pending.word.id)})`)
      await delay(250)
      assert.ok(!(await evaluate('window.wordGlass.getState()')).words.some((w) => w.id === pending.word.id))
      offline = true
      const offlineResult = await evaluate("window.wordGlass.lookupWord('scrutinize')")
      assert.ok(offlineResult.definitions.length)
      assert.match(offlineResult.lookupNote, /在线例句和发音暂不可用/)

      await evaluate("document.querySelector('.gear').click()")
      await delay(300)
      assert.ok(await evaluate("document.querySelector('.manager').textContent.includes('免费查词预览')"))
      assert.ok(!(await evaluate("document.querySelector('.btn-row').textContent")).includes('AI 补全'))
      await evaluate("[...document.querySelectorAll('.tab-btn')].find(b => b.textContent === '词库').click()")
      await delay(150)
      assert.ok(await evaluate("document.querySelector('.word-ops').textContent.includes('补全')"))
      fs.writeFileSync(path.join(reports, 'dictionary-manager.png'), (await win.capturePage()).toPNG())
      assert.deepEqual(hashes(), before, 'production words/settings must remain untouched')
      const result = { passed: true, checks: ['offline Chinese lookup', 'background IPC update', 'duplicate prevention',
        'custom definition preservation', 'pronunciation click wiring', 'license attribution', 'complete preview persistence',
        'unknown word', 'deletion during pending lookup', 'offline fallback', 'manager controls', 'production data untouched'],
        fixtureRequests: requests, mode: 'real Electron + isolated fixture data; HTTP responses mocked' }
      fs.writeFileSync(path.join(reports, 'electron-dictionary.json'), JSON.stringify(result, null, 2))
      console.log(JSON.stringify(result))
      app.exit(0)
    } catch (error) { console.error(error); app.exit(1) }
  })
})
require('../electron/main')
setTimeout(() => { console.error('Electron smoke test timed out'); app.exit(1) }, 20000).unref()
