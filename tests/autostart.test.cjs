const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loginOptions, createAutostartService } = require('../electron/autostart')
const configuration = { executable: 'C:\\Program Files\\Word Glass\\electron.exe', appPath: 'C:\\My Projects\\word-glass', packaged: false, platform: 'win32', rendererPath: 'dist/index.html' }
function setup({ items = [], exists = () => true, platform = 'win32' } = {}) {
  const writes = []
  const app = {
    getLoginItemSettings: () => ({ launchItems: items, executableWillLaunchAtLogin: true }),
    setLoginItemSettings: options => {
      writes.push(options)
      items = items.filter(item => item.name !== options.name)
      if (options.openAtLogin) items.push({ ...options, scope: 'user', enabled: options.enabled })
    },
  }
  const service = createAutostartService({ ...configuration, app, exists, platform })
  return { app, service, writes }
}

test('development login entry quotes its absolute app path and packaged entry launches its own executable', () => {
  assert.deepEqual(loginOptions(configuration), { name:'WordGlass', path:configuration.executable, args:['"C:\\My Projects\\word-glass"','--autostart'] })
  assert.deepEqual(loginOptions({ ...configuration, packaged:true }).args, ['--autostart'])
})

test('reading state never modifies startup and ignores other projects sharing electron.exe', () => {
  const { service, writes } = setup({ items:[{name:'Other App',path:configuration.executable,args:[],scope:'user',enabled:true}] })
  assert.deepEqual(service.read(), {supported:true,registered:false,enabled:false,message:''})
  assert.equal(writes.length,0)
})

test('enabling and disabling affect only this named user login item and verify system state', () => {
  const { service, writes } = setup()
  assert.ok(service.setEnabled(true).enabled)
  assert.ok(!service.setEnabled(false).registered)
  assert.equal(writes.length,2)
  assert.equal(writes[0].name,'WordGlass')
  assert.equal(writes[1].openAtLogin,false)
})

test('Windows-disabled entries are shown as disabled without silently re-enabling them', () => {
  const options = loginOptions(configuration)
  const { service, writes } = setup({ items:[{...options,args:[configuration.appPath,'--autostart'],scope:'user',enabled:false}] })
  const state = service.read()
  assert.ok(state.registered && !state.enabled)
  assert.match(state.message,/Windows 禁用/)
  assert.equal(writes.length,0)
})

test('native Windows launch-item args may omit the autostart switch', () => {
  const options = loginOptions(configuration)
  const { service } = setup({ items:[{...options,args:[configuration.appPath],scope:'user',enabled:true}] })
  assert.ok(service.read().enabled)
})

test('missing build and unsupported platform cannot create a broken startup entry', () => {
  const missing = setup({ exists: value => value !== 'dist/index.html' })
  assert.throws(()=>missing.service.setEnabled(true),/npm run build/)
  assert.equal(missing.writes.length,0)
  const unsupported = setup({ platform:'linux' })
  assert.ok(!unsupported.service.read().supported)
  assert.throws(()=>unsupported.service.setEnabled(true),/不支持/)
  assert.equal(unsupported.writes.length,0)
})

test('write failures and failed system readback are not reported as enabled', () => {
  const { app, service } = setup()
  app.setLoginItemSettings = () => { throw new Error('fixture denied') }
  assert.throws(()=>service.setEnabled(true),/fixture denied/)
  assert.ok(!service.read().enabled)
  app.setLoginItemSettings = () => {}
  assert.throws(()=>service.setEnabled(true),/未能保存/)
  assert.throws(()=>service.setEnabled('false'),/设置无效/)
})
