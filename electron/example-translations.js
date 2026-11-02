'use strict'

function splitExample(example) {
  const text = String(example || '').trim()
  const index = text.search(/[\u4e00-\u9fff]/)
  if (index <= 0) return [text, '']
  const english = text.slice(0, index).trim().replace(/[（(\[【]\s*$/, '').trim()
  return [english, text.slice(index).trim()]
}

function hasTranslation(example) {
  const [english, chinese] = splitExample(example)
  return /[a-z]/i.test(english) && !!chinese
}

const englishKey = (example) => splitExample(example)[0].replace(/[：:—–]\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase()

// Only attach a translation to the same original sentence; preserve custom bilingual examples.
function mergeExampleTranslations(existing, incoming) {
  if (!existing.length) return incoming
  const translated = new Map(incoming.filter(hasTranslation).map((example) => [englishKey(example), splitExample(example)[1]]))
  return existing.map((example) => {
    if (hasTranslation(example)) return example
    const translation = translated.get(englishKey(example))
    return translation ? `${example.trim()}\n${translation}` : example
  })
}

module.exports = { hasTranslation, mergeExampleTranslations }
