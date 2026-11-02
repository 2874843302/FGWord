const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseCsv, parseDefinitions, normalizeWord, httpsUrl } = require('../electron/dictionary-utils')
const { lookupLocal, lookupOnline, lookupDictionary, parseOnlineEntries, mergeDictionaryContent } = require('../electron/dictionary')

const remoteEntry = (word) => [{ word, phonetic: '/test/',
  phonetics: [{ audio: '//example.org/audio.mp3', sourceUrl: 'https://example.org/audio',
    license: { name: 'BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' } }],
  meanings: [{ partOfSpeech: 'noun', definitions: [{ example: 'A real example.' }, { example: 'A real example.' }] }],
  license: { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/' },
  sourceUrls: ['https://en.wiktionary.org/wiki/test'],
}]
const response = (body, status = 200, headers) => new Response(JSON.stringify(body), { status, headers })

test('CSV importer handles quoted commas, quotes, CRLF and multiline translations', () => {
  assert.deepEqual([...parseCsv('word,translation\r\nhello,"n. greeting, welcome\n""quoted"""\r\nlast,tail')], [
    ['word', 'translation'], ['hello', 'n. greeting, welcome\n"quoted"'], ['last', 'tail'],
  ])
  assert.throws(() => [...parseCsv('a,"broken')], /未闭合/)
})

test('ECDICT meanings retain each part of speech and Chinese definition', () => {
  assert.deepEqual(parseDefinitions('n. 测试\\nvt. 测验'), [
    { partOfSpeech: 'n.', meaning: '测试' }, { partOfSpeech: 'vt.', meaning: '测验' },
  ])
  assert.deepEqual(parseDefinitions('未标注词性的释义'), [{ partOfSpeech: '', meaning: '未标注词性的释义' }])
})

test('bundled dictionary supports offline lookup, case normalization and missing entries', () => {
  for (const word of ['resilient', 'hello', 'serendipity', 'scrutinize']) {
    const entry = lookupLocal(word.toUpperCase())
    assert.ok(entry.definitions.some((d) => /[\u4e00-\u9fff]/.test(d.meaning)), word)
    assert.ok(entry.phonetic, word)
    assert.equal(entry.sources[0].name, 'ECDICT')
  }
  assert.equal(lookupLocal('wordglasszzzxnonword'), null)
  assert.throws(() => normalizeWord(' '), /请输入/)
  assert.throws(() => normalizeWord('x'.repeat(101)), /100/)
  assert.throws(() => lookupLocal('hello', '/missing-word-glass-dictionary'), /dictionary:prepare/)
})

test('online normalization preserves attribution and deduplicates examples', () => {
  const content = parseOnlineEntries(remoteEntry('test'), 'test')
  assert.equal(content.audioUrl, 'https://example.org/audio.mp3')
  assert.deepEqual(content.examples, ['A real example.'])
  assert.equal(content.definitions.length, 0, 'English definitions must not be labelled as Chinese')
  assert.ok(content.sources.some((s) => s.license?.name === 'CC BY-SA 3.0'))
  assert.ok(content.sources.some((s) => s.license?.name === 'BY-SA 4.0'))
  assert.throws(() => parseOnlineEntries({ message: 'bad' }, 'test'), /格式异常/)
  assert.throws(() => parseOnlineEntries([{}], 'test'), /格式异常/)
  assert.equal(httpsUrl('javascript:alert(1)'), '')
  assert.equal(httpsUrl('https://user:secret@example.org/'), '')
})

test('offline lookup does not make network calls', async () => {
  const content = await lookupDictionary('resilient', { online: false, fetchImpl: () => { throw new Error('must not request') } })
  assert.ok(content.definitions.length)
  assert.equal(content.lookupNote, '')
})

test('network errors retain local Chinese meanings and explain missing online content', async () => {
  const content = await lookupDictionary('scrutinize', { fetchImpl: async () => { throw new Error('offline') } })
  assert.ok(content.definitions.length)
  assert.match(content.lookupNote, /在线例句和发音暂不可用/)
})

test('unknown words are saved as unknown without inventing Chinese meanings', async () => {
  const content = await lookupDictionary('wordglasszzzxnonword', { fetchImpl: async () => response({}, 404) })
  assert.equal(content.definitions.length, 0)
  assert.match(content.lookupNote, /未收录/)
})

test('concurrent lookups share one request, use URL encoding and reuse cached results', async () => {
  let calls = 0
  const fetchImpl = async (url, options) => {
    calls++
    assert.match(url, /words%20with%20spaces$/)
    assert.ok(options.signal instanceof AbortSignal)
    await new Promise((resolve) => setTimeout(resolve, 10))
    return response(remoteEntry('words with spaces'))
  }
  const [first, second] = await Promise.all([lookupOnline('words with spaces', fetchImpl), lookupOnline('words with spaces', fetchImpl)])
  assert.deepEqual(first, second)
  await lookupOnline('words with spaces', fetchImpl)
  assert.equal(calls, 1)
})

test('dictionary refresh preserves custom meanings, bilingual examples and word identity', () => {
  const entry = { id: 'keep-id', word: 'Test', group: '自定义', createdAt: 1, phonetic: '/custom/',
    definitions: [{ partOfSpeech: 'n.', meaning: '我自己的释义' }], phrases: ['custom phrase：自定义'],
    examples: ['My example. 我的例句。'], sources: [], enriched: true }
  const remote = parseOnlineEntries(remoteEntry('test'), 'test')
  const merged = mergeDictionaryContent(entry, { ...remote, lookupNote: '' })
  assert.deepEqual(merged.definitions, entry.definitions)
  assert.deepEqual(merged.examples, entry.examples)
  assert.equal(merged.word, 'Test')
  assert.equal(merged.id, 'keep-id')
  assert.equal(merged.phonetic, '/custom/')
  assert.equal(merged.audioUrl, 'https://example.org/audio.mp3')
})

test('rate limiting honors Retry-After and avoids additional upstream requests', async () => {
  let calls = 0
  const fetchImpl = async () => { calls++; return response({}, 429, { 'Retry-After': '120' }) }
  await assert.rejects(lookupOnline('rate-limit-test', fetchImpl), /限流/)
  await assert.rejects(lookupOnline('another-rate-limit-test', fetchImpl), /请求较多/)
  assert.equal(calls, 1)
})
