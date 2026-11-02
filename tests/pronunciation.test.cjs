const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createPronunciationService } = require('../electron/pronunciation')

test('system speech normalizes words and shares concurrent generation, then reuses its audio', async () => {
  const calls = []
  const result = { audioUrl: 'data:audio/wav;base64,fixture', voice: 'English voice', locale: 'en-US' }
  const service = createPronunciationService({ platform: 'win32', generate: async (word) => { calls.push(word); return result } })
  assert.deepEqual(await Promise.all([service.get(' HELLO '), service.get('hello')]), [result, result])
  assert.equal(await service.get('HeLLo'), result)
  assert.deepEqual(calls, ['hello'])
})
test('failed generation can be retried without caching an error', async () => {
  let calls = 0
  const service = createPronunciationService({ platform: 'win32', generate: async () => {
    if (++calls === 1) throw new Error('voice unavailable')
    return { audioUrl: 'retry' }
  } })
  await assert.rejects(service.get('hello'), /voice unavailable/)
  assert.equal((await service.get('hello')).audioUrl, 'retry')
  assert.equal(calls, 2)
})
test('invalid input and unsupported system speech do not spawn generation', async () => {
  let calls = 0
  const generate = async () => { calls++; return {} }
  const windows = createPronunciationService({ platform: 'win32', generate })
  await assert.rejects(windows.get(''))
  await assert.rejects(windows.get('x'.repeat(101)))
  await assert.rejects(createPronunciationService({ platform: 'linux', generate }).get('hello'), /Windows/)
  assert.equal(calls, 0)
})
