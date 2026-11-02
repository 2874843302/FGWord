const { test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeRegions, containsPoint } = require('../electron/window-hit-test')
const card = { x: 14, y: 14, width: 332, height: 168, radius: 24 }
const layout = normalizeRegions({ width: 360, height: 520, regions: [card] })

test('collapsed card captures its surface but passes transparent lower area and margins', () => {
  assert.equal(containsPoint(layout, 180, 80, 360, 520), true)
  assert.equal(containsPoint(layout, 180, 300, 360, 520), false)
  assert.equal(containsPoint(layout, 1, 80, 360, 520), false)
  assert.equal(containsPoint(layout, 180, 182, 360, 520), false)
})
test('rounded transparent corners pass through while the visible curved edge captures', () => {
  assert.equal(containsPoint(layout, 15, 15, 360, 520), false)
  assert.equal(containsPoint(layout, 38, 15, 360, 520), true)
})
test('expanded surfaces and separate controls combine without claiming empty space', () => {
  const expanded = normalizeRegions({ width: 360, height: 520, regions: [{ ...card, height: 492 },
    { x: 0, y: 0, width: 10, height: 10, radius: 0 }] })
  assert.equal(containsPoint(expanded, 180, 400, 360, 520), true)
  assert.equal(containsPoint(expanded, 5, 5, 360, 520), true)
  assert.equal(containsPoint(expanded, 5, 100, 360, 520), false)
})
test('viewport coordinates scale to native content bounds, including zoom', () => {
  assert.equal(containsPoint(layout, 360, 160, 720, 1040), true)
  assert.equal(containsPoint(layout, 360, 600, 720, 1040), false)
})
test('invalid or absent geometry cannot block the desktop', () => {
  assert.equal(normalizeRegions({ width: 0, height: 520, regions: [card] }), null)
  assert.equal(normalizeRegions({ width: 360, height: 520, regions: null }), null)
  const invalid = normalizeRegions({ width: 360, height: 520, regions: [{ ...card, x: NaN }] })
  assert.equal(containsPoint(invalid, 180, 80, 360, 520), false)
  assert.equal(containsPoint(null, 180, 80, 360, 520), false)
})
