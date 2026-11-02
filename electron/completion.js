'use strict'

const { mergeDictionaryContent } = require('./dictionary')
const { hasTranslation } = require('./example-translations')

function missingContent(word) {
  const missing = []
  if (!word.phonetic?.trim()) missing.push('音标')
  if (!word.definitions?.some((item) => item.meaning?.trim())) missing.push('释义')
  if (!word.phrases?.some((item) => item.trim())) missing.push('短语')
  const examples = (word.examples || []).filter((item) => item.trim())
  if (!examples.length) missing.push('例句')
  else if (examples.some((example) => !hasTranslation(example))) missing.push('例句翻译')
  return missing
}

const isComplete = (word) => missingContent(word).length === 0

function createCompletionService({ getWords, getSettings, lookup, generate, save, onProgress }) {
  const pending = new Map()
  let batch = null
  let stopping = false
  const present = (entry) => getWords().includes(entry)
  const merge = (entry, content) => mergeDictionaryContent({ ...entry,
    phonetic: entry.phonetic?.trim() || '',
    definitions: (entry.definitions || []).filter((item) => item.meaning?.trim()),
    phrases: (entry.phrases || []).filter((item) => item.trim()),
    examples: (entry.examples || []).filter((item) => item.trim()),
  }, content)

  function completeEntry(entry, aiCache = new Map()) {
    if (pending.has(entry.id)) return pending.get(entry.id)
    const request = (async () => {
      if (!present(entry) || isComplete(entry)) return entry
      // English-only dictionaries cannot fill Chinese translations or bilingual phrases.
      if (missingContent(entry).some((field) => !['短语', '例句翻译'].includes(field))) {
        const content = await lookup(entry.word)
        if (!present(entry)) return entry
        Object.assign(entry, merge(entry, content))
        save()
      }
      const settings = getSettings()
      if (!isComplete(entry) && settings.llmBaseUrl && settings.llmApiKey) {
        const examples = (entry.examples || []).filter((example) => example.trim() && !hasTranslation(example))
        const key = JSON.stringify([entry.word.trim().toLowerCase(), examples])
        if (!aiCache.has(key)) aiCache.set(key, Promise.resolve().then(() => generate(entry.word, settings, { examples })))
        const content = await aiCache.get(key)
        if (!present(entry)) return entry
        Object.assign(entry, merge(entry, content))
        entry.enriched = isComplete(entry)
        save()
      }
      return entry
    })()
    pending.set(entry.id, request)
    request.finally(() => pending.delete(entry.id)).catch(() => {})
    return request
  }

  function completeAll() {
    if (batch) return batch
    stopping = false
    const targets = getWords().filter((word) => !isComplete(word))
    const progress = { running: true, total: targets.length, processed: 0, completed: 0, remaining: 0,
      failed: 0, skipped: 0, currentWord: '', failures: [], stopped: false }
    const publish = () => onProgress({ ...progress, failures: [...progress.failures] })
    publish()
    batch = Promise.resolve().then(async () => {
      const cache = new Map()
      try {
        for (const entry of targets) {
          if (stopping) break
          progress.currentWord = entry.word
          publish()
          try {
            if (!present(entry) || isComplete(entry)) progress.skipped++
            else {
              await completeEntry(entry, cache)
              if (!present(entry)) progress.skipped++
              else if (isComplete(entry)) progress.completed++
              else progress.remaining++
            }
          } catch (error) {
            progress.failed++
            progress.failures.push({ word: entry.word, message: error.message || '补全失败' })
            // A rate limit must stop the queue instead of immediately retrying other words.
            if (error.status === 429) stopping = true
          }
          progress.processed++
          publish()
        }
      } finally {
        progress.running = false
        progress.currentWord = ''
        progress.stopped = stopping && progress.processed < progress.total
        publish()
        batch = null
      }
      return { ...progress }
    })
    return batch
  }

  return { completeEntry, completeAll, stop: () => { stopping = true } }
}

module.exports = { missingContent, isComplete, createCompletionService }
