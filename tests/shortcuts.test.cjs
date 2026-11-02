const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createShortcutManager } = require('../electron/shortcuts')
function setup(disabled = false) {
  const active = new Map(), calls = []
  const keys = { register: (key, callback) => {
    if (key === 'Unavailable' || active.has(key)) return false
    active.set(key, callback); return true
  }, unregister: key => active.delete(key) }
  const manager = createShortcutManager(keys, [
    { field: 'selectionShortcut', status: 'selection', label: '选词', run: () => calls.push('selection') },
    { field: 'nextWordShortcut', status: 'nextWord', label: '下一个词', run: () => calls.push('next') },
  ], disabled)
  return { manager, active, calls }
}
const initial = { selectionShortcut: 'Alt+D', nextWordShortcut: 'Alt+N' }

test('both shortcuts start independently and dispatch the correct action', () => {
  const { manager, active, calls } = setup()
  const state = manager.start(initial)
  assert.ok(state.selection.active && state.nextWord.active)
  active.get('Alt+N')(); active.get('Alt+D')()
  assert.deepEqual(calls, ['next','selection'])
})

test('failed replacement rolls back all new keys and preserves both original bindings', () => {
  const { manager, active } = setup()
  manager.start(initial)
  assert.throws(() => manager.update({ selectionShortcut: 'Alt+E', nextWordShortcut: 'Unavailable' }), /下一个词快捷键不可用/)
  assert.deepEqual([...active.keys()], ['Alt+D','Alt+N'])
  assert.ok(manager.update(initial).nextWord.active)
})

test('identical action keys are rejected and disabling one leaves the other registered', () => {
  const { manager, active } = setup()
  manager.start(initial)
  assert.throws(() => manager.update({ selectionShortcut: 'Alt+D', nextWordShortcut: 'alt+d' }), /相同/)
  const status = manager.update({ ...initial, nextWordShortcut: '' })
  assert.ok(!status.nextWord.active)
  assert.deepEqual([...active.keys()], ['Alt+D'])
})

test('one unavailable saved shortcut does not block the other at startup', () => {
  const { manager, active } = setup()
  const state = manager.start({ selectionShortcut: 'Unavailable', nextWordShortcut: 'Alt+N' })
  assert.ok(!state.selection.active)
  assert.match(state.selection.message, /被占用/)
  assert.ok(state.nextWord.active)
  assert.deepEqual([...active.keys()], ['Alt+N'])
})

test('fixture mode never registers global hotkeys', () => {
  const { manager, active } = setup(true)
  const state = manager.start(initial)
  assert.ok(!state.selection.active && !state.nextWord.active)
  manager.update({ ...initial, nextWordShortcut: 'Alt+M' })
  assert.equal(active.size, 0)
})
