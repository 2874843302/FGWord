const { app } = require('electron')
const { execFile } = require('child_process')
const { promisify } = require('util')
const fs = require('fs')
const path = require('path')
const assert = require('node:assert/strict')
const { createAutostartService } = require('../electron/autostart')
const root = path.resolve(__dirname,'..')
const fixture = path.join(root,'.test',`autostart launch ${Date.now()}`)
fs.mkdirSync(fixture,{recursive:true})
fs.writeFileSync(path.join(fixture,'words.json'),JSON.stringify({words:[]}))
fs.writeFileSync(path.join(fixture,'settings.json'),'{}')
const childReport = path.join(fixture,'launch-result.json')
fs.writeFileSync(path.join(fixture,'package.json'),JSON.stringify({name:'word-glass-autostart-fixture',main:'main.cjs'}))
fs.writeFileSync(path.join(fixture,'main.cjs'),`
const {app}=require('electron');const fs=require('fs');
process.env.WORD_GLASS_DATA_DIR=${JSON.stringify(fixture)};
process.env.WORD_GLASS_DISABLE_SHORTCUT='1';process.env.VITE_DEV_SERVER_URL='http://127.0.0.1:1';
process.env.WORD_GLASS_DISABLE_TRAY='1';
app.on('browser-window-created',(_,win)=>{win.hide();win.webContents.once('did-finish-load',async()=>{
 for(let i=0;i<80;i++){if(await win.webContents.executeJavaScript("!!document.querySelector('.gear')")){
  fs.writeFileSync(${JSON.stringify(childReport)},JSON.stringify({loaded:true,url:win.webContents.getURL(),autostart:process.argv.includes('--autostart')}));app.exit(0);return
 }await new Promise(r=>setTimeout(r,40))}app.exit(1)
})});require(${JSON.stringify(path.join(root,'electron/main.js'))});setTimeout(()=>app.exit(1),15000).unref();
`)
const execute = promisify(execFile)
const runKey='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const approvedKey='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
const name=`WordGlass-QA-${process.pid}-${Date.now()}`
const service=createAutostartService({app,executable:process.execPath,appPath:fixture,packaged:false,name,rendererPath:path.join(root,'dist/index.html')})
async function registryExists(key) {
  try{await execute('reg.exe',['query',key,'/v',name]);return true}
  catch(error){if(error.code===1)return false;throw error}
}
app.whenReady().then(async()=>{
  let claimed=false,result,error
  try{
    assert.ok(!(await registryExists(runKey))&&!(await registryExists(approvedKey)),'QA registry name must be unused')
    claimed=true
    assert.ok(!service.read().registered)
    let enabled
    try { enabled=service.setEnabled(true) }
    catch(caught) {
      const native=app.getLoginItemSettings({path:service.options.path,args:service.options.args})
      console.error(JSON.stringify({options:service.options,state:service.read(),ownItems:native.launchItems.filter(item=>item.name===name),runEntryExists:await registryExists(runKey)}))
      throw caught
    }
    assert.ok(enabled.enabled&&enabled.registered)
    await execute('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(__dirname,'launch-autostart-fixture.ps1'),'-EntryName',name],{windowsHide:true})
    for(let i=0;i<180&&!fs.existsSync(childReport);i++)await new Promise(r=>setTimeout(r,50))
    const launched=JSON.parse(fs.readFileSync(childReport,'utf8'))
    assert.ok(launched.loaded&&launched.autostart&&launched.url.startsWith('file:'))
    assert.ok(!service.setEnabled(false).registered)
    result={passed:true,checks:['real named Windows startup registration','system readback enabled','startup command launched with a space in app path',
      'dist loads without Vite','disable removes Run entry'],mode:'temporary unique QA login item; no actual logoff or reboot'}
  }catch(caught){error=caught}
  finally{
    if(claimed){
      try{app.setLoginItemSettings({...service.options,openAtLogin:false,enabled:false})}catch(caught){error ||= caught}
      for(const key of [runKey,approvedKey]){
        try{if(await registryExists(key))await execute('reg.exe',['delete',key,'/v',name,'/f'])}catch(caught){error ||= caught}
      }
    }
  }
  if(error){console.error(error);app.exit(1);return}
  result.temporaryRegistryValuesRemoved=!(await registryExists(runKey))&&!(await registryExists(approvedKey))
  fs.writeFileSync(path.join(root,'.test/report/autostart-native.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify(result));app.exit(0)
})
