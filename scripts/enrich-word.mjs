#!/usr/bin/env node
/**
 * 词条补全 CLI：node scripts/enrich-word.mjs <word>
 * 配置来源（优先级从高到低）：环境变量 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
 *                                     → data/settings.json 中的 llmBaseUrl / llmApiKey / llmModel
 * 输出：补全后的完整词条 JSON（与主进程入库格式一致）
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { ENRICH_SYSTEM_PROMPT } = require('../electron/enrich-prompt.js')

const word = process.argv[2]?.trim()
if (!word) {
  console.error('用法: node scripts/enrich-word.mjs <word>\n示例: node scripts/enrich-word.mjs serendipity')
  process.exit(1)
}

// 配置加载
const settingsFile = resolve(__dirname, '../data/settings.json')
let settings = {}
if (existsSync(settingsFile)) {
  try {
    settings = JSON.parse(readFileSync(settingsFile, 'utf-8'))
  } catch (e) {
    console.warn(`[warn] 解析 ${settingsFile} 失败，忽略：`, e.message)
  }
}

const baseUrl = (process.env.LLM_BASE_URL || settings.llmBaseUrl || '').trim().replace(/\/+$/, '')
const apiKey = process.env.LLM_API_KEY || settings.llmApiKey || ''
const model = process.env.LLM_MODEL || settings.llmModel || 'gpt-4o-mini'

if (!baseUrl || !apiKey) {
  console.error('未配置 LLM 接口。请二选一：')
  console.error('  1. 编辑 data/settings.json 填写 llmBaseUrl / llmApiKey / llmModel')
  console.error('  2. 设置环境变量 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL')
  process.exit(1)
}

async function main() {
  console.log(`→ 正在为「${word}」补全词条（${model} @ ${baseUrl}）...`)
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: ENRICH_SYSTEM_PROMPT },
        { role: 'user', content: `单词：${word}` },
      ],
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error(`✗ LLM 接口返回 ${res.status}: ${text.slice(0, 300)}`)
    process.exit(1)
  }

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    console.error('✗ LLM 返回内容为空')
    process.exit(1)
  }

  const parsed = JSON.parse(content.replace(/```json|```/g, '').trim())
  console.log('\n✓ 补全结果：')
  console.log(JSON.stringify(parsed, null, 2))
}

main().catch((e) => {
  console.error('✗ 失败：', e.message)
  process.exit(1)
})
