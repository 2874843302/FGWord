const { test } = require('node:test')
const assert = require('node:assert/strict')
const { isComplete, missingContent, createCompletionService } = require('../electron/completion')
const content = { word: 'hello', phonetic: '/hello/', definitions: [{ partOfSpeech: 'n.', meaning: '你好' }], phrases: ['say hello：打招呼'], examples: ['Hello. 你好。'] }
const incomplete = (id, word = 'hello') => ({ id, word, group: id, phonetic: '/custom/', definitions: [{ partOfSpeech: 'n.', meaning: '我的释义' }], phrases: [], examples: ['My example. 我的例句。'], enriched: true })
function setup(words, overrides = {}) {
  const progress = [], requests = [], saved = []
  const service = createCompletionService({ getWords: () => words,
    getSettings: () => ({ llmBaseUrl: 'https://fixture.invalid', llmApiKey: 'fixture-only' }),
    lookup: async (word) => { requests.push('lookup:' + word); return content },
    generate: async (word) => { requests.push('ai:' + word); return content },
    save: () => saved.push(1), onProgress: value => progress.push(value), ...overrides })
  return { service, progress, requests, saved }
}

test('completeness uses actual content, including legacy false and misleading true flags', () => {
  assert.ok(isComplete({ ...content, enriched: false }))
  assert.ok(!isComplete(incomplete('a')))
  assert.deepEqual(missingContent({ phonetic: ' ', definitions: [{ meaning: '' }], phrases: [' '], examples: [] }), ['音标', '释义', '短语', '例句'])
})

test('every example needs a Chinese translation even if the entry was previously marked enriched', () => {
  assert.deepEqual(missingContent({ ...content, examples: ['An English sentence.'], enriched: true }), ['例句翻译'])
  assert.deepEqual(missingContent({ ...content, examples: ['Hello. 你好。', 'Still untranslated.'] }), ['例句翻译'])
  assert.ok(!isComplete({ ...content, examples: ['只有中文没有英文。'] }))
  assert.ok(isComplete({ ...content, examples: ['Hello.\n你好。', 'My example. 我的例句。'] }))
})

test('completion translates the original English while preserving custom bilingual examples and other fields', async () => {
  const words = [{ ...content, id: 'a', examples: ['My original sentence.', 'My example. 已有自定义译文。'], enriched: true }]
  const { service, requests } = setup(words, { generate: async (word, settings, context) => {
    requests.push('ai:' + word)
    assert.deepEqual(context.examples, ['My original sentence.'])
    return { ...content, examples: ['My original sentence.\n我的原始例句。', 'A replacement. 替换句子。'] }
  } })
  const result = await service.completeAll()
  assert.equal(result.completed, 1)
  assert.deepEqual(requests, ['ai:hello'], 'translation-only gaps must not request the English dictionary')
  assert.deepEqual(words[0].examples, ['My original sentence.\n我的原始例句。', 'My example. 已有自定义译文。'])
  assert.deepEqual(words[0].definitions, content.definitions)
})

test('same word with different untranslated examples cannot reuse a translation for the wrong sentence', async () => {
  const words = ['First sentence.', 'Second sentence.'].map((example, index) => ({ ...content, id: String(index), examples: [example] }))
  const contexts = []
  const { service } = setup(words, { generate: async (word, settings, context) => {
    contexts.push(context.examples)
    return { ...content, examples: [`${context.examples[0]}\n对应译文。`] }
  } })
  assert.equal((await service.completeAll()).completed, 2)
  assert.deepEqual(contexts, [['First sentence.'], ['Second sentence.']])
  assert.equal(words[1].examples[0], 'Second sentence.\n对应译文。')
})

test('unmatched AI examples and English-only output stay incomplete without losing the original', async () => {
  const words = [{ ...content, id: 'a', examples: ['Keep this exact sentence.'] }]
  const { service } = setup(words, { generate: async () => ({ ...content,
    examples: ['A different example. 一条不同的例句。', 'Keep this exact sentence.'] }) })
  assert.equal((await service.completeAll()).remaining, 1)
  assert.deepEqual(words[0].examples, ['Keep this exact sentence.'])
  assert.ok(!isComplete(words[0]))
})

test('without AI an untranslated example remains pending and never triggers an unnecessary dictionary request', async () => {
  const words = [{ ...content, id: 'a', examples: ['English only.'] }]
  const { service, requests } = setup(words, { getSettings: () => ({}) })
  assert.equal((await service.completeAll()).remaining, 1)
  assert.deepEqual(requests, [])
  assert.equal(words[0].examples[0], 'English only.')
})

test('batch skips complete entries, preserves custom content and shares AI for the same word across groups', async () => {
  const words = [{ ...content, id: 'done', enriched: false }, incomplete('a'), incomplete('b')]
  const { service, progress, requests } = setup(words)
  const first = service.completeAll()
  assert.equal(service.completeAll(), first, 'concurrent starts share a job')
  const result = await first
  assert.equal(result.total, 2)
  assert.equal(result.completed, 2)
  assert.deepEqual(requests, ['ai:hello'])
  for (const word of words.slice(1)) {
    assert.equal(word.phonetic, '/custom/')
    assert.equal(word.definitions[0].meaning, '我的释义')
    assert.deepEqual(word.examples, ['My example. 我的例句。'])
    assert.ok(isComplete(word))
  }
  assert.equal(progress.at(-1).running, false)
  assert.equal((await service.completeAll()).total, 0)
  words.push(incomplete('new', 'world'))
  assert.equal((await service.completeAll()).completed, 1, 'an empty batch must not block later work')
})

test('free dictionary can fill missing data without falsely claiming missing phrases are complete', async () => {
  const words = [{ id: 'a', word: 'hello', phonetic: '', definitions: [], phrases: [], examples: [] }]
  const { service, requests } = setup(words, { getSettings: () => ({}), lookup: async () => ({ ...content, phrases: [] }) })
  const result = await service.completeAll()
  assert.equal(result.completed, 0)
  assert.equal(result.remaining, 1)
  assert.deepEqual(missingContent(words[0]), ['短语'])
  assert.equal(requests.length, 0)
})

test('failures preserve previous results and continue with other words', async () => {
  const words = [incomplete('a', 'broken'), incomplete('b', 'hello')]
  const { service } = setup(words, { generate: async word => { if (word === 'broken') throw new Error('fixture failure'); return content } })
  const result = await service.completeAll()
  assert.equal(result.failed, 1)
  assert.equal(result.completed, 1)
  assert.equal(result.failures[0].word, 'broken')
  assert.equal(words[0].definitions[0].meaning, '我的释义')
})

test('stop finishes the current word and leaves remaining words untouched', async () => {
  const words = [incomplete('a'), incomplete('b', 'world')]
  let release
  const generated = new Promise(resolve => { release = resolve })
  const { service } = setup(words, { generate: () => generated })
  const job = service.completeAll()
  await new Promise(resolve => setImmediate(resolve))
  service.stop()
  release(content)
  const result = await job
  assert.equal(result.processed, 1)
  assert.equal(result.completed, 1)
  assert.ok(result.stopped)
  assert.equal(words[1].phrases.length, 0)
})

test('a rate limit stops the batch without retrying the remaining queue', async () => {
  const words = [incomplete('a'), incomplete('b', 'world')]
  let calls = 0
  const { service } = setup(words, { generate: async () => { calls++; throw Object.assign(new Error('rate limited'), { status: 429 }) } })
  const result = await service.completeAll()
  assert.equal(calls, 1)
  assert.equal(result.failed, 1)
  assert.ok(result.stopped)
})

test('deleting an entry during lookup cannot resurrect it or trigger its AI generation', async () => {
  const words = [{ ...incomplete('a'), phonetic: '', examples: [] }]
  let release
  const lookup = new Promise(resolve => { release = resolve })
  const { service, requests, saved } = setup(words, { lookup: () => lookup })
  const job = service.completeAll()
  await new Promise(resolve => setImmediate(resolve))
  words.pop()
  release(content)
  assert.equal((await job).skipped, 1)
  assert.equal(requests.length, 0)
  assert.equal(saved.length, 0)
  assert.equal(words.length, 0)
})
