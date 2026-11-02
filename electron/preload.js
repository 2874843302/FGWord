'use strict'

const { contextBridge, ipcRenderer } = require('electron')

// 渲染进程唯一可用的桥接 API（contextIsolation 开启，无 node 能力）
contextBridge.exposeInMainWorld('wordGlass', {
  getState: () => ipcRenderer.invoke('state:get'),
  getPronunciation: (word) => ipcRenderer.invoke('pronunciation:get', word),
  setHitRegions: (layout) => ipcRenderer.send('window:hit-regions', layout),
  onOpenManager: (listener) => {
    const handler = () => listener()
    ipcRenderer.on('manager:open', handler)
    return () => ipcRenderer.removeListener('manager:open', handler)
  },
  getAutostart: () => ipcRenderer.invoke('autostart:get'),
  setAutostart: (enabled) => ipcRenderer.invoke('autostart:set', enabled),
  onNextWord: (listener) => {
    const handler = () => listener()
    ipcRenderer.on('rotation:next', handler)
    return () => ipcRenderer.removeListener('rotation:next', handler)
  },
  resizeWindow: (size) => ipcRenderer.invoke('window:resize', size),
  setWindowResizing: (active) => ipcRenderer.send('window:resizing', active),
  completeWord: (id) => ipcRenderer.invoke('words:complete', id),
  completeAllWords: () => ipcRenderer.invoke('words:complete-all'),
  stopCompletion: () => ipcRenderer.invoke('words:stop-completion'),
  getSelectionCapture: () => ipcRenderer.invoke('selection:get'),
  captureClipboard: () => ipcRenderer.invoke('selection:clipboard'),
  dismissSelection: () => ipcRenderer.invoke('selection:dismiss'),
  addSelection: (payload) => ipcRenderer.invoke('selection:add', payload),
  onSelectionChanged: (listener) => {
    const handler = (_event, capture) => listener(capture)
    ipcRenderer.on('selection:changed', handler)
    return () => ipcRenderer.removeListener('selection:changed', handler)
  },
  onStateChanged: (listener) => {
    const handler = (_event, state) => listener(state)
    ipcRenderer.on('state:changed', handler)
    return () => ipcRenderer.removeListener('state:changed', handler)
  },
  addWord: (payload) => ipcRenderer.invoke('words:add', payload),
  deleteWord: (id) => ipcRenderer.invoke('words:delete', id),
  enrichWord: (id) => ipcRenderer.invoke('words:enrich', id),
  enrichWordWithAI: (id) => ipcRenderer.invoke('words:enrich-ai', id),
  lookupWord: (word) => ipcRenderer.invoke('words:lookup', word),
  enrichFromLLM: (word) => ipcRenderer.invoke('words:enrich-llm', word),
  addGroup: (name) => ipcRenderer.invoke('groups:add', name),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
})
