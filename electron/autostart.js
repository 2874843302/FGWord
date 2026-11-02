'use strict'

const fs = require('fs')

function loginOptions({ executable, appPath, packaged, name = 'WordGlass' }) {
  // Electron's login-item API expects paths containing spaces to be quoted.
  const quote = (value) => /\s/.test(value) ? `"${value}"` : value
  return { name, path: executable, args: packaged ? ['--autostart'] : [quote(appPath), '--autostart'] }
}

function createAutostartService({ app, executable, appPath, packaged, platform = process.platform,
  name = 'WordGlass', rendererPath, exists = fs.existsSync }) {
  const options = loginOptions({ executable, appPath, packaged, name })
  const normalize = (value) => String(value || '').replace(/^"(.*)"$/, '$1').toLowerCase()
  // Windows launchItems exposes positional args and omits Chromium switches.
  const positional = (args) => args.filter((value) => !value.startsWith('--')).map(normalize)
  const expectedArgs = positional(options.args)
  const sameArgs = (args) => Array.isArray(args) && positional(args).length === expectedArgs.length
    && positional(args).every((value, index) => value === expectedArgs[index])
  function read() {
    if (platform !== 'win32') return { supported: false, enabled: false, registered: false, message: '当前平台暂不支持设置开机自启' }
    try {
      const result = app.getLoginItemSettings({ path: options.path, args: options.args })
      // Several development apps can share electron.exe. Check our own named
      // entry and arguments, rather than executableWillLaunchAtLogin alone.
      const item = (result.launchItems || []).find((entry) => normalize(entry.name) === normalize(name)
        && entry.scope === 'user' && normalize(entry.path) === normalize(options.path) && sameArgs(entry.args))
      return { supported: true, registered: !!item, enabled: !!item?.enabled,
        message: item && !item.enabled ? '已被 Windows 禁用，可在任务管理器的“启动应用”中重新启用，或重新打开此开关。' : '' }
    } catch {
      return { supported: false, registered: false, enabled: false, message: '无法读取 Windows 开机自启状态，请稍后重试' }
    }
  }
  function setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('开机自启设置无效')
    if (platform !== 'win32') throw new Error('当前平台暂不支持设置开机自启')
    if (enabled && (!exists(executable) || (rendererPath && !exists(rendererPath)))) {
      throw new Error('应用启动文件不完整，请先运行 npm run build 后再开启开机自启')
    }
    app.setLoginItemSettings({ ...options, openAtLogin: enabled, enabled })
    const status = read()
    if (!status.supported || status.enabled !== enabled || (!enabled && status.registered)) {
      throw new Error(status.message || 'Windows 未能保存开机自启设置，请重试')
    }
    return status
  }
  return { read, setEnabled, options }
}

module.exports = { loginOptions, createAutostartService }
