const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const { snapshotProductionData } = require('./helpers/production-data')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname,'..')
const directory = path.join(root,'.test',`autostart-${Date.now()}`)
fs.mkdirSync(directory,{recursive:true})
fs.writeFileSync(path.join(directory,'words.json'),JSON.stringify({words:[]}))
fs.writeFileSync(path.join(directory,'settings.json'),'{}')
process.env.WORD_GLASS_DATA_DIR = directory
process.env.WORD_GLASS_DISABLE_TRAY = '1'
process.env.WORD_GLASS_DISABLE_SHORTCUT = '1'
delete process.env.VITE_DEV_SERVER_URL
let items = [{name:'OtherElectronApp',path:process.execPath,args:['other-app'],scope:'user',enabled:true}]
const writes = []
let denied = false
app.getLoginItemSettings = () => ({launchItems:items,executableWillLaunchAtLogin:true})
app.setLoginItemSettings = options => {
  if (denied) throw new Error('fixture startup write denied')
  writes.push(options)
  items = items.filter(item=>item.name!==options.name)
  if(options.openAtLogin) items.push({...options,scope:'user'})
}
const hashes = () => snapshotProductionData(root)
const before = hashes()
const delay = ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check) {
  for(let i=0;i<100;i++){if(await check())return;await delay(40)}
  throw new Error('Autostart UI test timed out')
}
app.on('browser-window-created',(_,win)=>{
  win.webContents.once('did-finish-load',async()=>{
    try {
      const evaluate = code=>win.webContents.executeJavaScript(code)
      await until(()=>evaluate("!!document.querySelector('.gear')"))
      await evaluate("document.querySelector('.gear').click()")
      const settings = ()=>evaluate("[...document.querySelectorAll('.tab-btn')].find(b=>b.textContent==='设置').click()")
      await settings()
      const checkbox = "[...document.querySelectorAll('label.check')].find(l=>l.textContent==='开机自启').querySelector('input')"
      await until(()=>evaluate(`!!(${checkbox}) && !(${checkbox}).disabled`))
      assert.ok(!(await evaluate(`(${checkbox}).checked`)))
      assert.equal(writes.length,0,'reading UI does not change startup')
      await evaluate(`(${checkbox}).click()`)
      await until(()=>evaluate("document.querySelector('.tab-pane').textContent.includes('已开启开机自启')"))
      assert.ok(await evaluate(`(${checkbox}).checked`))
      assert.equal(writes.length,1)
      await evaluate("[...document.querySelectorAll('.tab-pane button')].find(b=>b.textContent==='保存设置').click()")
      await delay(100)
      assert.equal(writes.length,1,'ordinary save does not rewrite startup')
      items.find(item=>item.name==='WordGlass').enabled=false
      await evaluate("[...document.querySelectorAll('.tab-btn')].find(b=>b.textContent==='添加').click()")
      await settings()
      await until(()=>evaluate("document.querySelector('.tab-pane').textContent.includes('Windows 禁用')"))
      assert.ok(!(await evaluate(`(${checkbox}).checked`)))
      assert.equal(writes.length,1,'external Windows disable is respected')
      await evaluate(`(${checkbox}).click()`)
      await until(()=>evaluate("document.querySelector('.tab-pane').textContent.includes('已开启开机自启')"))
      denied=true
      await evaluate(`(${checkbox}).click()`)
      await until(()=>evaluate("document.querySelector('.tab-pane').textContent.includes('fixture startup write denied')"))
      assert.ok(await evaluate(`(${checkbox}).checked`),'failed change restores real enabled state')
      denied=false
      await evaluate(`(${checkbox}).click()`)
      await until(()=>evaluate("document.querySelector('.tab-pane').textContent.includes('未开启开机自启')"))
      assert.ok(!items.some(item=>item.name==='WordGlass'))
      assert.ok(items.some(item=>item.name==='OtherElectronApp'&&item.enabled))
      assert.deepEqual(hashes(),before)
      const result={passed:true,checks:['default reflects OS state','enable immediately','ordinary settings save has no startup side effect',
        'external Windows disable reflected','write failure restores checkbox','disable removes own entry','other Electron app unaffected','production data unchanged'],
        mode:'real Electron UI/IPC; login item APIs replaced with isolated fixture registry'}
      fs.writeFileSync(path.join(root,'.test/report/autostart-ui.json'),JSON.stringify(result,null,2))
      console.log(JSON.stringify(result));app.exit(0)
    }catch(error){console.error(error);app.exit(1)}
  })
})
require('../electron/main')
setTimeout(()=>app.exit(1),20000).unref()
