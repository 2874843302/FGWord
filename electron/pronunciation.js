'use strict'

const { execFile } = require('child_process')
const { scriptPath } = require('./runtime-paths')
const { normalizeWord } = require('./dictionary-utils')

function synthesize(word) {
  return new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
      scriptPath('synthesize-pronunciation.ps1')],
    { windowsHide: true, timeout: 10000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      if (error) { reject(new Error('系统英文朗读不可用，请检查 Windows 英文语音组件')); return }
      try {
        const { pcm, voice, locale } = JSON.parse(stdout.replace(/^\uFEFF/, '').trim())
        const samples = Buffer.from(pcm, 'base64')
        if (samples.length < 48 || !/^en-/i.test(locale)) throw new Error('Invalid speech output')
        // Windows emits signed 16-bit mono PCM at 24 kHz. Wrap it as a portable WAV.
        const header = Buffer.alloc(44)
        header.write('RIFF', 0); header.writeUInt32LE(36 + samples.length, 4); header.write('WAVEfmt ', 8)
        header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
        header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28)
        header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
        header.write('data', 36); header.writeUInt32LE(samples.length, 40)
        resolve({ audioUrl: `data:audio/wav;base64,${Buffer.concat([header, samples]).toString('base64')}`, voice, locale })
      } catch { reject(new Error('系统朗读未生成有效音频，请重试')) }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ word }), 'utf8')
  })
}

function createPronunciationService({ platform = process.platform, generate = synthesize } = {}) {
  const cache = new Map()
  const pending = new Map()
  return {
    async get(word) {
      const normalized = normalizeWord(word)
      if (platform !== 'win32') throw new Error('系统英文朗读暂仅支持 Windows')
      if (cache.has(normalized)) return cache.get(normalized)
      if (pending.has(normalized)) return pending.get(normalized)
      const task = Promise.resolve().then(() => generate(normalized)).then((result) => {
        if (cache.size >= 24) cache.delete(cache.keys().next().value)
        cache.set(normalized, result)
        return result
      }).finally(() => pending.delete(normalized))
      pending.set(normalized, task)
      return task
    },
  }
}

module.exports = { createPronunciationService }
