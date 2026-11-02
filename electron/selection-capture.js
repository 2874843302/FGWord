'use strict'

const path = require('path')
const { execFile } = require('child_process')
const { scriptPath } = require('./runtime-paths')

function normalizeSelection(text) {
  let word = String(text || '').normalize('NFKC').trim()
  const pairs = [['"', '"'], ['“', '”'], ["'", "'"], ['‘', '’'], ['(', ')'], ['[', ']']]
  for (const [left, right] of pairs) {
    if (word.startsWith(left) && word.endsWith(right)) word = word.slice(left.length, -right.length).trim()
  }
  word = word.replace(/[.,!?;:，。！？；：]+$/, '').replace(/[\t\r\n ]+/g, ' ').replace(/’/g, "'")
  if (word.length > 100 || !/^[A-Za-z]+(?:['-][A-Za-z]+)*(?: [A-Za-z]+(?:['-][A-Za-z]+)*){0,4}$/.test(word)) {
    throw new Error('请选择英文单词或短语（最多 5 个词），然后再试一次')
  }
  return word
}

function captureSelectedText({ excludedProcessId = process.pid, platform = process.platform } = {}) {
  if (platform !== 'win32') return Promise.reject(new Error('当前平台请先复制单词，再使用「从剪贴板添加」'))
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
  const script = scriptPath('capture-selection.ps1')
  return new Promise((resolve, reject) => {
    execFile(executable, ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-ExcludedProcessId', String(excludedProcessId)], { windowsHide: true, timeout: 10000, maxBuffer: 65536, encoding: 'utf8' },
    (error, stdout) => {
      try {
        const result = JSON.parse(stdout.trim().replace(/^\uFEFF/, ''))
        if (!result.ok) return reject(new Error(result.error || '未读取到选中的单词'))
        resolve(normalizeSelection(result.text))
      } catch (parseError) {
        reject(error ? new Error('读取选词超时或失败，请复制后使用「从剪贴板添加」') : parseError)
      }
    })
  })
}

function popupPosition(point, area, width, height) {
  return {
    x: Math.max(area.x, Math.min(point.x + 12, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(point.y + 16, area.y + area.height - height)),
  }
}

module.exports = { normalizeSelection, captureSelectedText, popupPosition }
