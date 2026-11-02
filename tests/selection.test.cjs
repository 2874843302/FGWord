const { test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeSelection, popupPosition, captureSelectedText } = require('../electron/selection-capture')

test('selected text accepts English words, contractions, hyphens and short phrases', () => {
  assert.equal(normalizeSelection(' “resilient” '), 'resilient')
  assert.equal(normalizeSelection('hello!'), 'hello')
  assert.equal(normalizeSelection('state-of-the-art'), 'state-of-the-art')
  assert.equal(normalizeSelection('don’t'), "don't")
  assert.equal(normalizeSelection('look\r\n forward\tto'), 'look forward to')
})

test('invalid/large selections are rejected instead of silently adding unrelated text', () => {
  for (const text of ['', '中文', 'a b c d e f', 'https://example.com', 'one two 123', 'x'.repeat(101)]) {
    assert.throws(() => normalizeSelection(text), /英文单词或短语/)
  }
})

test('popup stays within the active display including negative monitor coordinates', () => {
  assert.deepEqual(popupPosition({ x: 1900, y: 1070 }, { x: 0, y: 0, width: 1920, height: 1080 }, 360, 360), { x: 1560, y: 720 })
  assert.deepEqual(popupPosition({ x: -1910, y: 5 }, { x: -1920, y: 0, width: 1920, height: 1080 }, 360, 360), { x: -1898, y: 21 })
})

test('unsupported platforms offer explicit clipboard fallback', async () => {
  await assert.rejects(captureSelectedText({ platform: 'linux' }), /从剪贴板添加/)
})
