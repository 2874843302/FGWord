const { app } = require('electron')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const root = path.resolve(__dirname, '..')
const directory = path.join(root, '.test', `pronunciation-${Date.now()}`)
fs.mkdirSync(directory, { recursive: true })
fs.mkdirSync(path.join(root, '.test/report'), { recursive: true })
const fixture = (word, id, audioUrl = '') => ({ word, id, audioUrl, group: 'QA', phonetic: '',
  definitions: [{ partOfSpeech: 'n.', meaning: '测试' }], phrases: [], examples: [], createdAt: 1 })
fs.writeFileSync(path.join(directory, 'words.json'), JSON.stringify({ words: [fixture('not much of a', 'phrase'),
  fixture('hello', 'recording', 'https://fixture.invalid/good.mp3'), fixture('suitable', 'fallback', 'https://fixture.invalid/bad.mp3'),
  fixture('destination', 'pending'), fixture('broken', 'error')] }))
fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ intervalSec: 300 }))
process.env.WORD_GLASS_DATA_DIR = directory
process.env.WORD_GLASS_DISABLE_SHORTCUT = '1'
process.env.WORD_GLASS_DISABLE_TRAY = '1'
delete process.env.VITE_DEV_SERVER_URL
const hashes = () => ['words.json', 'settings.json'].map(name => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'data', name))).digest('hex'))
const before = hashes()
const requested = [], finished = []
const service = require('../electron/pronunciation')
const originalCreate = service.createPronunciationService
service.createPronunciationService = () => {
  const native = originalCreate()
  return { async get(word) {
    requested.push(word)
    if (word === 'broken') throw new Error('fixture speech failure')
    const result = await native.get(word)
    finished.push(word)
    return result
  } }
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) {
  for (let i = 0; i < 240; i++) { if (await check()) return; await delay(30) }
  throw new Error('Pronunciation smoke timed out')
}
app.once('browser-window-created', (_, win) => {
  win.webContents.once('did-finish-load', async () => {
    try {
      const evaluate = code => win.webContents.executeJavaScript(code)
      await until(() => evaluate("document.querySelector('.card-word')?.textContent === 'not much of a'"))
      await evaluate(`window.__audios=[]; window.__ended=0; window.__sourceRequests=[];
        const NativeAudio=window.Audio;
        window.Audio=function(source) {
          window.__sourceRequests.push(source);
          const mapped=source==='https://fixture.invalid/good.mp3' ? window.__knownAudio :
            source==='https://fixture.invalid/bad.mp3' ? 'data:audio/wav;base64,AAAA' : source;
          const audio=new NativeAudio(mapped); audio.volume=0;
          audio.addEventListener('ended',()=>window.__ended++);
          window.__audios.push(audio); return audio;
        }; void 0`)
      assert.ok(await evaluate("!!document.querySelector('.pronunciation-btn')"), 'phrase without recording still has speaker')
      await evaluate("document.querySelector('.pronunciation-btn').click()")
      assert.ok(await evaluate("document.querySelector('.pronunciation-btn').getAttribute('aria-busy') === 'true'"))
      await until(() => evaluate('window.__ended === 1'))
      const duration = await evaluate('window.__audios[0].duration')
      assert.ok(duration > 0.5 && duration < 10, 'actual native WAV is decoded and played through by Electron')
      await evaluate('window.__knownAudio=window.__audios[0].src')
      assert.deepEqual(requested, ['not much of a'])
      win.webContents.send('rotation:next')
      await until(() => evaluate("document.querySelector('.card-word')?.textContent === 'hello'"))
      await evaluate("document.querySelector('.pronunciation-btn').click()")
      await until(() => evaluate('window.__ended === 2'))
      assert.deepEqual(requested, ['not much of a'], 'recording playback does not request system speech')
      win.webContents.send('rotation:next')
      await until(() => evaluate("document.querySelector('.card-word')?.textContent === 'suitable'"))
      await evaluate("document.querySelector('.pronunciation-btn').click()")
      await until(() => evaluate('window.__ended === 3'))
      assert.deepEqual(requested, ['not much of a', 'suitable'], 'failed recording falls back to actual native speech')
      assert.ok(!(await evaluate("document.querySelector('.pronunciation-btn').disabled")))
      win.webContents.send('rotation:next')
      await until(() => evaluate("document.querySelector('.card-word')?.textContent === 'destination'"))
      const previousPlayers = await evaluate('window.__audios.length')
      await evaluate("document.querySelector('.pronunciation-btn').click()")
      await until(() => requested.includes('destination'))
      win.webContents.send('rotation:next')
      await until(() => evaluate("document.querySelector('.card-word')?.textContent === 'broken'"))
      await until(() => finished.includes('destination'))
      await delay(80)
      assert.equal(await evaluate('window.__audios.length'), previousPlayers, 'late speech response must not play the old word')
      await evaluate("document.querySelector('.pronunciation-btn').click()")
      await until(() => evaluate("document.querySelector('.pronunciation-btn').title.includes('重试')"))
      assert.ok(!(await evaluate("document.querySelector('.pronunciation-btn').disabled")))
      assert.deepEqual(hashes(), before)
      const result = { passed: true, nativeVoice: 'Windows installed English voice', phraseDurationSeconds: duration,
        checks: ['speaker available without recording or phonetic', 'native English phrase WAV generation and actual decoding/playback',
          'recording preferred', 'recording error falls back to system speech', 'loading feedback', 'switch cancels stale speech',
          'speech failure offers retry', 'production data untouched'],
        mode: 'real Electron UI/IPC and Windows System.Speech synthesis; actual audio media played muted; recording URLs mapped to local WAV or corrupt-data fixtures, no external network' }
      fs.writeFileSync(path.join(root, '.test/report/pronunciation.json'), JSON.stringify(result, null, 2))
      console.log(JSON.stringify(result))
      app.exit(0)
    } catch (error) { console.error(error); console.error(JSON.stringify({ requested, finished })); app.exit(1) }
  })
})
require('../electron/main')
setTimeout(() => { console.error('Pronunciation smoke timed out'); app.exit(1) }, 30000).unref()
