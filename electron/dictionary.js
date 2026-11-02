'use strict'

const fs = require('fs')
const path = require('path')
const { gunzipSync } = require('zlib')
const { normalizeWord, dictionaryBucket, parseDefinitions, httpsUrl } = require('./dictionary-utils')
const { mergeExampleTranslations } = require('./example-translations')

const DICTIONARY_DIR = path.resolve(__dirname, '../resources/dictionary')
const ECDICT_SOURCE = {
  name: 'ECDICT', url: 'https://github.com/skywind3000/ECDICT',
  license: { name: 'MIT', url: 'https://github.com/skywind3000/ECDICT/blob/master/LICENSE' },
}
const shards = new Map()
const onlineCache = new Map()
const inFlight = new Map()
let cooldownUntil = 0

function emptyContent(word) {
  return { word, phonetic: '', definitions: [], phrases: [], examples: [], audioUrl: '', sources: [] }
}

function lookupLocal(word, directory = DICTIONARY_DIR) {
  const normalized = normalizeWord(word)
  const file = path.join(directory, `${dictionaryBucket(normalized)}.json.gz`)
  if (!shards.has(file)) {
    if (!fs.existsSync(file)) throw new Error('本地词库缺失，请运行 npm run dictionary:prepare')
    const data = JSON.parse(gunzipSync(fs.readFileSync(file)).toString('utf8'))
    if (shards.size >= 4) shards.delete(shards.keys().next().value)
    shards.set(file, data)
  }
  const shard = shards.get(file)
  const entry = Object.hasOwn(shard, normalized) ? shard[normalized] : null
  if (!entry) return null
  return {
    ...emptyContent(normalized), phonetic: entry[0] ? `/${entry[0].replace(/^\/+|\/+$/g, '')}/` : '',
    definitions: parseDefinitions(entry[1], entry[2]), sources: [ECDICT_SOURCE],
  }
}

function parseOnlineEntries(entries, word) {
  if (!Array.isArray(entries) || !entries.some((entry) => typeof entry?.word === 'string' && Array.isArray(entry.meanings))) {
    throw new Error('免费词典返回格式异常')
  }
  const content = emptyContent(word)
  content.sources.push({ name: 'Free Dictionary API', url: 'https://dictionaryapi.dev/' })
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const phonetics = Array.isArray(entry.phonetics) ? entry.phonetics : []
    const phonetic = (typeof entry.phonetic === 'string' ? entry.phonetic : '') || phonetics.find((p) => typeof p?.text === 'string' && p.text)?.text
    if (!content.phonetic && phonetic) content.phonetic = phonetic.startsWith('/') ? phonetic : `/${phonetic}/`
    const license = entry.license && typeof entry.license.name === 'string'
      ? { name: entry.license.name, url: httpsUrl(entry.license.url) } : undefined
    for (const url of Array.isArray(entry.sourceUrls) ? entry.sourceUrls : []) {
      if (httpsUrl(url)) content.sources.push({ name: '词条来源', url: httpsUrl(url), license })
    }
    for (const phoneticEntry of phonetics) {
      if (!content.audioUrl && httpsUrl(phoneticEntry?.audio)) {
        content.audioUrl = httpsUrl(phoneticEntry.audio)
        content.sources.push({ name: '发音来源', url: httpsUrl(phoneticEntry.sourceUrl) || content.audioUrl,
          license: phoneticEntry.license && typeof phoneticEntry.license.name === 'string'
            ? { name: phoneticEntry.license.name, url: httpsUrl(phoneticEntry.license.url) } : undefined })
      }
    }
    for (const meaning of Array.isArray(entry.meanings) ? entry.meanings : []) {
      for (const definition of Array.isArray(meaning?.definitions) ? meaning.definitions : []) {
        if (typeof definition?.example === 'string' && definition.example.trim()) content.examples.push(definition.example.trim())
      }
    }
  }
  content.examples = [...new Set(content.examples)].slice(0, 4)
  content.sources = uniqueSources(content.sources)
  return content
}

function uniqueSources(sources) {
  return [...new Map(sources.map((source) => [`${source.url}|${source.license?.name || ''}`, source])).values()]
}

async function lookupOnline(word, fetchImpl = fetch) {
  const normalized = normalizeWord(word)
  if (cooldownUntil > Date.now()) throw new Error('免费词典请求较多，请稍后再查；本地释义仍可使用')
  const cached = onlineCache.get(normalized)
  if (cached && cached.expires > Date.now()) return cached.content
  if (inFlight.has(normalized)) return inFlight.get(normalized)
  const request = (async () => {
    const response = await fetchImpl(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normalized)}`, {
      signal: AbortSignal.timeout(10000),
    })
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after')
      const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null
      cooldownUntil = Math.max(Date.now() + 60000, seconds !== null ? Date.now() + seconds * 1000 : Date.parse(retryAfter) || 0)
      throw new Error('免费词典暂时限流，本地释义仍可使用')
    }
    if (response.status !== 404 && !response.ok) throw new Error(`免费词典暂不可用（HTTP ${response.status}）`)
    const content = response.status === 404 ? null : parseOnlineEntries(await response.json(), normalized)
    if (onlineCache.size >= 128) onlineCache.delete(onlineCache.keys().next().value)
    onlineCache.set(normalized, { content, expires: Date.now() + (content ? 3600000 : 600000) })
    return content
  })()
  inFlight.set(normalized, request)
  try { return await request } finally { inFlight.delete(normalized) }
}

async function lookupDictionary(word, { fetchImpl = fetch, online = true } = {}) {
  const normalized = normalizeWord(word)
  const local = lookupLocal(normalized) || emptyContent(normalized)
  let remote = null, lookupNote = ''
  if (online) {
    try { remote = await lookupOnline(normalized, fetchImpl) }
    catch (error) {
      lookupNote = error.message.includes('限流') || error.message.includes('请求较多')
        ? error.message : '在线例句和发音暂不可用，本地释义仍可使用'
    }
  }
  if (!local.definitions.length) lookupNote = '本地词库未收录中文释义，可尝试 AI 补全'
  return { ...local, phonetic: local.phonetic || remote?.phonetic || '',
    examples: remote?.examples || [], audioUrl: remote?.audioUrl || '',
    sources: uniqueSources([...local.sources, ...(remote?.sources || [])]), lookupNote }
}

// Dictionary refreshes fill gaps without replacing existing or user-supplied meanings/examples.
function mergeDictionaryContent(entry, content) {
  return { ...entry, phonetic: entry.phonetic || content.phonetic,
    definitions: entry.definitions.length ? entry.definitions : content.definitions,
    phrases: entry.phrases.length ? entry.phrases : content.phrases,
    examples: mergeExampleTranslations(entry.examples, content.examples),
    audioUrl: entry.audioUrl || content.audioUrl,
    sources: uniqueSources([...(entry.sources || []), ...(content.sources || [])]),
    lookupNote: content.lookupNote || '', enriched: !!(entry.definitions.length || content.definitions.length) }
}

module.exports = { lookupLocal, lookupOnline, lookupDictionary, parseOnlineEntries, mergeDictionaryContent }
