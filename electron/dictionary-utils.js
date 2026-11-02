'use strict'

// CSV fields may contain commas, escaped quotes and embedded newlines.
function* parseCsv(text) {
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++ }
      else quoted = !quoted
    } else if (!quoted && char === ',') {
      row.push(field); field = ''
    } else if (!quoted && char === '\n') {
      row.push(field); yield row; row = []; field = ''
    } else if (quoted || char !== '\r') field += char
  }
  if (quoted) throw new Error('词库 CSV 包含未闭合的引号')
  if (field || row.length) { row.push(field); yield row }
}

function normalizeWord(word) {
  const value = String(word ?? '').trim().toLowerCase()
  if (!value || value.length > 100) throw new Error('请输入 1–100 个字符的单词或短语')
  return value
}

function dictionaryBucket(word) {
  return /^[a-z]/.test(word) ? word[0] : '_'
}

function parseDefinitions(translation, pos = '') {
  const fallbackPos = pos.split('/')[0]?.split(':')[0] || ''
  return translation.replace(/\\n/g, '\n').split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    const match = line.trim().match(/^((?:[a-z]+\.)(?:\s*[&/]\s*[a-z]+\.)?)\s*(.+)$/i)
    return match
      ? { partOfSpeech: match[1], meaning: match[2].trim() }
      : { partOfSpeech: fallbackPos ? `${fallbackPos}.` : '', meaning: line.trim() }
  })
}

function httpsUrl(value) {
  if (typeof value !== 'string' || !value) return ''
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''
  } catch { return '' }
}

module.exports = { parseCsv, normalizeWord, dictionaryBucket, parseDefinitions, httpsUrl }
