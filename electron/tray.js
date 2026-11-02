'use strict'

function createTrayController({ Tray, Menu, icon, getWindow, showWindow, hideWindow, openManager, nextWord, quit }) {
  const tray = new Tray(icon)
  tray.setToolTip('浮光单词 · Word Glass')
  let menu = null
  function refresh() {
    if (tray.isDestroyed()) return
    const window = getWindow()
    menu = Menu.buildFromTemplate([
      { label: '浮光单词 · Word Glass', enabled: false },
      { id: 'toggle-card', label: window?.isVisible() ? '隐藏单词卡片' : '显示单词卡片',
        click: () => { if (getWindow()?.isVisible()) hideWindow(); else showWindow() } },
      { id: 'manage', label: '管理单词 / 设置', click: openManager },
      { id: 'next-word', label: '下一个词', click: () => { showWindow(); nextWord() } },
      { type: 'separator' },
      { id: 'quit', label: '退出 Word Glass', click: quit },
    ])
    tray.setContextMenu(menu)
  }
  tray.on('click', showWindow)
  tray.on('double-click', showWindow)
  refresh()
  return { tray, get menu() { return menu }, refresh, destroy: () => { if (!tray.isDestroyed()) tray.destroy() } }
}

module.exports = { createTrayController }
