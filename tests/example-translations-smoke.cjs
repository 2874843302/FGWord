const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const assert = require('node:assert/strict')
const { snapshotProductionData } = require('./helpers/production-data.cjs')
const root = path.resolve(__dirname, '..')
const directory = path.join(root, '.test', `example-translations-${Date.now()}`)
fs.mkdirSync(directory, { recursive: true })
fs.mkdirSync(path.join(root, '.test/report'), { recursive: true })
const word = { word: 'compact', phonetic: '/fixture/', definitions: [{ partOfSpeech: 'adj.', meaning: '我的自定义释义' }],
  phrases: ['compact design：紧凑的设计'], enriched: true, createdAt: 1 }
fs.writeFileSync(path.join(directory, 'words.json'), JSON.stringify({ words: [
  { ...word, id: 'first', group: 'A', examples: ['An original sentence.', 'Custom sentence. 自定义译文。'] },
  { ...word, id: 'second', group: 'B', examples: ['A different sentence.'] },
  { ...word, id: 'complete', group: 'C', examples: ['Already translated. 已有译文。'] },
] }))
fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ llmBaseUrl: 'https://fixture.invalid/v1',
  llmApiKey: 'fixture-only', intervalSec: 300 }))
process.env.WORD_GLASS_DATA_DIR = directory
process.env.WORD_GLASS_DISABLE_TRAY = '1'
process.env.WORD_GLASS_DISABLE_SHORTCUT = '1'
delete process.env.VITE_DEV_SERVER_URL
const hashes = () => snapshotProductionData(root)
const before = hashes()
const requests = []
require('../electron/dictionary').lookupDictionary = async () => { throw new Error('translation-only gap must skip dictionary') }
let incompleteResponse = true
global.fetch = async (url, options) => {
  assert.equal(url, 'https://fixture.invalid/v1/chat/completions')
  const body = JSON.parse(options.body)
  assert.match(body.messages[0].content, /每一项必须.*简体中文译文/)
  const payload = JSON.parse(body.messages[1].content.split('\n').at(-1))
  requests.push(payload.existingExamples)
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...word,
    examples: payload.existingExamples.map(example => example === 'A different sentence.' && incompleteResponse
      ? example : `${example}\n对应的中文翻译。`),
  }) } }] }), { status: 200 })
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await delay(30) }
  throw new Error('Example translation smoke timed out')
}
app.once('browser-window-created', (_, win) => {
  win.webContents.once('did-finish-load', async () => {
    try {
      const evaluate = code => win.webContents.executeJavaScript(code)
      await until(() => evaluate("document.querySelector('.card-word')?.textContent === 'compact'"))
      assert.ok(await evaluate("document.querySelector('.detail').textContent.includes('中文翻译待补全')"))
      let state = await evaluate('window.wordGlass.getState()')
      assert.equal(state.words[0].complete, false)
      assert.equal(state.words[1].complete, false)
      assert.equal(state.words[2].complete, true)
      await evaluate("document.querySelector('.gear').click()")
      await evaluate("[...document.querySelectorAll('.tab-btn')].find(b=>b.textContent==='词库').click()")
      assert.equal(await evaluate("[...document.querySelectorAll('.word-ops button')].filter(b=>b.textContent==='补全').length"), 2)
      const batch = await evaluate('window.wordGlass.completeAllWords()')
      assert.equal(batch.completed, 1)
      assert.equal(batch.remaining, 1)
      assert.deepEqual(requests, [['An original sentence.'], ['A different sentence.']])
      state = await evaluate('window.wordGlass.getState()')
      assert.deepEqual(state.words[0].examples, ['An original sentence.\n对应的中文翻译。', 'Custom sentence. 自定义译文。'])
      assert.deepEqual(state.words[1].examples, ['A different sentence.'])
      assert.equal(state.words[1].complete, false, 'English-only AI output must not count as completed')
      incompleteResponse = false
      await evaluate("window.wordGlass.enrichWordWithAI('second')")
      state = await evaluate('window.wordGlass.getState()')
      assert.ok(state.words.every(entry => entry.complete))
      assert.equal(state.words[1].examples[0], 'A different sentence.\n对应的中文翻译。')
      assert.ok(state.words.every(entry => entry.definitions[0].meaning === '我的自定义释义'))
      await until(() => evaluate("![...document.querySelectorAll('.word-ops button')].some(b=>b.textContent==='补全')"))
      assert.equal((await evaluate('window.wordGlass.completeAllWords()')).total, 0)
      const persisted = JSON.parse(fs.readFileSync(path.join(directory, 'words.json')))
      assert.equal(persisted.words[1].examples[0], state.words[1].examples[0])
      assert.deepEqual(hashes(), before)
      const result = { passed: true, checks: ['English-only legacy entries marked pending', 'missing translation visible in details',
        'completion actions reappear', 'prompt includes exact untranslated originals', 'all examples need Chinese',
        'preserve custom original and translation', 'separate translations for same word in different groups',
        'incomplete model output stays pending', 'direct AI action repairs translations', 'completed actions hidden',
        'translation persistence', 'production data untouched'], mode: 'real Electron renderer and IPC; isolated data, LLM fixture responses, no external network' }
      fs.writeFileSync(path.join(root, '.test/report/example-translations.json'), JSON.stringify(result, null, 2))
      console.log(JSON.stringify(result)); app.exit(0)
    } catch (error) { console.error(error); app.exit(1) }
  })
})
require('../electron/main')
setTimeout(() => { console.error('Example translation smoke timed out'); app.exit(1) }, 15000).unref()
