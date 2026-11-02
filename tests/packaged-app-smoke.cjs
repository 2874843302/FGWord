const fs = require('fs')
const path = require('path')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { spawn } = require('child_process')
const { once } = require('events')
const asar = require('@electron/asar')
const root = path.resolve(__dirname, '..')
const appDirectory = path.resolve(process.argv[2] || path.join(root, 'release/win-unpacked'))
const executable = path.join(appDirectory, 'WordGlass.exe')
const archive = path.join(appDirectory, 'resources/app.asar')
const directory = path.resolve(process.env.WORD_GLASS_PACKAGE_QA_DIR || path.join(root, '.test', `packaged-${Date.now()}`))
fs.mkdirSync(directory, { recursive: true })
fs.mkdirSync(path.join(root, '.test/report'), { recursive: true })
// A fresh checkout has no personal data/ directory. Still verify any existing data is untouched.
const hash = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null
const before = ['words.json', 'settings.json'].map(name => hash(path.join(root, 'data', name)))
const entries = asar.listPackage(archive).map(entry => entry.replace(/\\/g, '/'))
assert.ok(!entries.some(entry => /^\/(?:data|\.test|tests|src)(?:\/|$)/.test(entry)), 'private data and development fixtures excluded')
const privateSettingsPath = path.join(root, 'data/settings.json')
const privateSettings = fs.existsSync(privateSettingsPath) ? JSON.parse(fs.readFileSync(privateSettingsPath)) : {}
if (privateSettings.llmApiKey) assert.equal(fs.readFileSync(archive).includes(Buffer.from(privateSettings.llmApiKey)), false, 'API key must not ship')
const seeds = JSON.parse(asar.extractFile(archive, path.join('resources', 'defaults', 'words.json')))
assert.equal(seeds.words.length, 3)
assert.ok(fs.existsSync(path.join(appDirectory, 'resources/app.asar.unpacked/scripts/synthesize-pronunciation.ps1')))
assert.ok(fs.existsSync(path.join(appDirectory, 'resources/app.asar.unpacked/scripts/capture-selection.ps1')))
let processHandle, socket, rpcId = 0
const pending = new Map()
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++rpcId
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
  pending.set(id, { resolve, reject, timer })
  socket.send(JSON.stringify({ id, method, params }))
})
async function evaluate(expression) {
  const result = await rpc('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, message) {
  for (let i = 0; i < 150; i++) { if (await check()) return; await delay(50) }
  throw new Error(message || 'Packaged application smoke timed out')
}
async function main() {
  const port = Number(process.env.WORD_GLASS_PACKAGE_QA_PORT || 9237)
  let output = ''
  processHandle = spawn(executable, [`--remote-debugging-port=${port}`], { cwd: appDirectory, windowsHide: true,
    env: { ...process.env, WORD_GLASS_DATA_DIR: directory, WORD_GLASS_DISABLE_SHORTCUT: '1', WORD_GLASS_DISABLE_TRAY: '1',
      VITE_DEV_SERVER_URL: 'http://127.0.0.1:1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  processHandle.stdout.on('data', data => { output += data })
  processHandle.stderr.on('data', data => { output += data })
  let targets
  await until(async () => {
    if (processHandle.exitCode !== null) throw new Error(`Packaged app exited: ${output.slice(-2000)}`)
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); return targets.some(t => t.type === 'page') }
    catch { return false }
  }, 'Packaged renderer did not expose a debugging target')
  const page = targets.find(target => target.type === 'page')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await once(socket, 'open')
  socket.addEventListener('message', event => {
    const result = JSON.parse(event.data)
    const request = pending.get(result.id)
    if (!request) return
    pending.delete(result.id); clearTimeout(request.timer)
    if (result.error) request.reject(new Error(result.error.message)); else request.resolve(result.result)
  })
  await until(() => evaluate("document.querySelector('.card-word')?.textContent === 'resilient'"))
  assert.match(await evaluate('location.href'), /^file:/, 'packaged app must ignore Vite and load bundled HTML')
  assert.match(await evaluate('document.title'), /浮光单词/)
  const state = await evaluate('window.wordGlass.getState()')
  assert.equal(state.words.length, 3)
  assert.ok(!state.settings.llmApiKey)
  const pronunciation = await evaluate("window.wordGlass.getPronunciation('not much of a')")
  assert.match(pronunciation.locale, /^en-/)
  const wav = Buffer.from(pronunciation.audioUrl.split(',')[1], 'base64')
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF')
  assert.ok(wav.length > 10000)
  const auto = await evaluate('window.wordGlass.getAutostart()')
  assert.ok(auto.supported)
  const added = await evaluate("window.wordGlass.addWord({word:'HeLLo',group:'安装包测试'})")
  assert.equal(added.word.word, 'hello')
  assert.ok(added.word.definitions.some(definition => /[\u4e00-\u9fff]/.test(definition.meaning)))
  await evaluate("document.querySelector('.gear').click()")
  await until(() => evaluate("!!document.querySelector('.manager')"))
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'words.json'))).words.length, 4)
  assert.deepEqual(['words.json', 'settings.json'].map(name => hash(path.join(root, 'data', name))), before)
  const screenshot = await rpc('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(root, '.test/report/packaged-app.png'), Buffer.from(screenshot.data, 'base64'))
  const result = { passed: true, checks: ['native branded WordGlass.exe', 'bundled renderer without Vite', 'first-run sample vocabulary',
    'no developer API key or vocabulary in archive', 'native PowerShell scripts unpacked', 'actual system English speech from packaged script',
    'autostart state read', 'offline Chinese dictionary', 'lowercase persistence', 'manager opens', 'production data unchanged'],
    packageEntryCount: entries.length, appDirectory,
    mode: 'actual packaged executable with isolated business/profile data and own CDP port; native speech generated, no system installation or startup registration changes' }
  fs.writeFileSync(path.join(root, '.test/report/packaged-app.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
  await evaluate('setTimeout(() => window.close(), 50); undefined')
  await until(() => processHandle.exitCode !== null, 'Packaged fixture did not close normally')
  socket.close()
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  for (const { timer } of pending.values()) clearTimeout(timer)
  socket?.close()
  if (processHandle && processHandle.exitCode === null) processHandle.kill()
})
