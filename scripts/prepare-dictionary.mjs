#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import utils from '../electron/dictionary-utils.js'

const { parseCsv, dictionaryBucket } = utils
const revision = 'ab22ad36302cafc6349a050e2b60894855208055'
const upstream = 'https://api.github.com/repos/skywind3000/ECDICT/contents'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'resources/dictionary')

async function download(name) {
  const url = `${upstream}/${name}?ref=${revision}&raw=1`
  // Windows' bundled curl uses system proxy/certificate settings. No shell interpolation.
  if (process.platform === 'win32') {
    return execFileSync('curl.exe', ['--ssl-revoke-best-effort', '--fail', '--silent', '--show-error',
      '--max-time', '120', '--header', 'Accept: application/vnd.github.raw+json', url],
    { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024, windowsHide: true })
  }
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github.raw+json' }, signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`下载 ${name} 失败：HTTP ${response.status}`)
  return response.text()
}

const csv = process.argv[2] ? await fs.readFile(process.argv[2], 'utf8') : await download('ecdict.csv')
const license = process.argv[3] ? await fs.readFile(process.argv[3], 'utf8') : await download('LICENSE')
const rows = parseCsv(csv)
const header = rows.next().value
const columns = Object.fromEntries(header.map((name, index) => [name, index]))
for (const key of ['word', 'phonetic', 'translation', 'pos']) {
  if (!(key in columns)) throw new Error(`词库缺少字段：${key}`)
}
const buckets = new Map()
let count = 0
for (const row of rows) {
  const original = row[columns.word]?.trim()
  const word = original?.toLowerCase()
  const translation = row[columns.translation]?.trim()
  if (!word || !translation) continue
  const key = dictionaryBucket(word)
  if (!buckets.has(key)) buckets.set(key, Object.create(null))
  const bucket = buckets.get(key)
  if (Object.hasOwn(bucket, word) && original !== word) continue
  if (!Object.hasOwn(bucket, word)) count++
  bucket[word] = [row[columns.phonetic] || '', translation, row[columns.pos] || '']
}
if (count < 100000) throw new Error(`词库条目异常：${count}`)
await fs.mkdir(output, { recursive: true })
for (const [key, bucket] of buckets) {
  const target = path.join(output, `${key}.json.gz`)
  const temp = `${target}.tmp`
  await fs.writeFile(temp, gzipSync(JSON.stringify(bucket)))
  await fs.rename(temp, target)
}
await fs.writeFile(path.join(output, 'LICENSE'), license)
await fs.writeFile(path.join(output, 'metadata.json'), JSON.stringify({
  name: 'ECDICT', revision, source: 'https://github.com/skywind3000/ECDICT',
  license: 'MIT', entries: count, sha256: createHash('sha256').update(csv).digest('hex'),
}, null, 2) + '\n')
console.log(`ECDICT 已准备：${count} 个词条，${buckets.size} 个压缩分片。无需联网即可查中文释义。`)
