const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { initializeDataDirectory } = require('../electron/data-directory')
const { unpackedPath, scriptPath } = require('../electron/runtime-paths')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'word-glass-package-'))
  assert.equal(path.dirname(path.resolve(root)).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase())
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const defaultsDir = path.join(root, 'defaults')
  fs.mkdirSync(defaultsDir)
  fs.writeFileSync(path.join(defaultsDir, 'words.json'), JSON.stringify({ words: [{ word: 'welcome' }] }))
  return { projectDir: path.join(root, 'app.asar'), userDataDir: path.join(root, 'profile'), defaultsDir }
}

test('packaged app seeds writable user data without copying a developer API key or writing into its archive', t => {
  const options = fixture(t)
  fs.mkdirSync(path.join(options.projectDir, 'data'), { recursive: true })
  fs.writeFileSync(path.join(options.projectDir, 'data/settings.json'), JSON.stringify({ llmApiKey: 'must-not-ship' }))
  const directory = initializeDataDirectory({ ...options, packaged: true })
  assert.equal(directory, path.join(options.userDataDir, 'word-glass-data'))
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'words.json'))), { words: [{ word: 'welcome' }] })
  assert.ok(!fs.existsSync(path.join(directory, 'settings.json')))
})

test('upgrade or second launch preserves existing vocabulary and settings', t => {
  const options = fixture(t)
  const directory = initializeDataDirectory({ ...options, packaged: true })
  const custom = JSON.stringify({ words: [{ word: 'custom' }] })
  fs.writeFileSync(path.join(directory, 'words.json'), custom)
  fs.writeFileSync(path.join(directory, 'settings.json'), 'custom settings')
  initializeDataDirectory({ ...options, packaged: true })
  assert.equal(fs.readFileSync(path.join(directory, 'words.json'), 'utf8'), custom)
  assert.equal(fs.readFileSync(path.join(directory, 'settings.json'), 'utf8'), 'custom settings')
})

test('packaged fixture overrides stay isolated and secondary processes do not create seed data', t => {
  const options = fixture(t)
  const override = path.join(options.userDataDir, 'fixture')
  assert.equal(initializeDataDirectory({ ...options, override, packaged: true, primary: false }), override)
  assert.ok(!fs.existsSync(path.join(override, 'words.json')))
  assert.ok(!fs.existsSync(path.join(options.userDataDir, 'word-glass-data')))
})

test('development data stays in the repository with a writable fallback', t => {
  const options = fixture(t)
  assert.equal(initializeDataDirectory({ ...options, packaged: false }), path.join(options.projectDir, 'data'))
  const blocked = path.join(options.userDataDir, 'not-a-directory')
  fs.mkdirSync(options.userDataDir, { recursive: true })
  fs.writeFileSync(blocked, 'fixture')
  assert.equal(initializeDataDirectory({ ...options, projectDir: blocked, packaged: false }), path.join(options.userDataDir, 'word-glass-data'))
})

test('external PowerShell scripts resolve outside ASAR on Windows and POSIX paths', () => {
  assert.equal(unpackedPath('C:\\Program Files\\Word Glass\\resources\\app.asar\\scripts\\capture-selection.ps1'),
    'C:\\Program Files\\Word Glass\\resources\\app.asar.unpacked\\scripts\\capture-selection.ps1')
  assert.equal(unpackedPath('/app/resources/app.asar/scripts/speech.ps1'), '/app/resources/app.asar.unpacked/scripts/speech.ps1')
  assert.ok(fs.existsSync(scriptPath('synthesize-pronunciation.ps1')))
})
