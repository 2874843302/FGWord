'use strict'

// Register every replacement before releasing old bindings so a failed settings
// save cannot leave either action using a shortcut different from its saved value.
function createShortcutManager(globalShortcut, actions, disabled = false) {
  let registered = {}
  return {
    start(settings) {
      const statuses = {}
      for (const action of actions) {
        const key = String(settings[action.field] || '').trim()
        let success = true
        if (key && !disabled) {
          try { success = globalShortcut.register(key, action.run) } catch { success = false }
        }
        registered[action.field] = success ? key : ''
        statuses[action.status] = { shortcut: key, active: !!key && success && !disabled,
          message: success ? '' : `${action.label}快捷键不可用或已被占用，请更换后保存` }
      }
      return statuses
    },
    update(settings) {
      const next = Object.fromEntries(actions.map((action) => [action.field, String(settings[action.field] || '').trim()]))
      const used = new Set()
      for (const key of Object.values(next).filter(Boolean)) {
        const normalized = key.toLowerCase()
        if (used.has(normalized)) throw new Error('选词和下一个词不能使用相同的快捷键')
        used.add(normalized)
      }
      const added = []
      try {
        for (const action of actions) {
          const key = next[action.field]
          if (!key || key === registered[action.field] || disabled) continue
          let success = false
          try { success = globalShortcut.register(key, action.run) } catch { /* Invalid accelerator. */ }
          if (!success) throw new Error(`${action.label}快捷键不可用或已被占用，请更换后保存`)
          added.push(key)
        }
      } catch (error) {
        for (const key of added) globalShortcut.unregister(key)
        throw error
      }
      if (!disabled) for (const action of actions) {
        const previous = registered[action.field]
        if (previous && previous !== next[action.field]) globalShortcut.unregister(previous)
      }
      registered = next
      return Object.fromEntries(actions.map((action) => [action.status, {
        shortcut: next[action.field], active: !!next[action.field] && !disabled, message: '',
      }]))
    },
  }
}

module.exports = { createShortcutManager }
