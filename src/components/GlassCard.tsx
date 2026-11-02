import { useEffect, useRef, useState } from 'react'
import type { Definition } from '../types'

interface GlassCardProps {
  word: string
  phonetic?: string
  group?: string
  showPhonetic: boolean
  definitions?: Definition[]
  hint?: string
  audioUrl?: string
  showNavigation?: boolean
  canNavigate?: boolean
  onPrevious?: () => void
  onNext?: () => void
}

function PronunciationButton({ word, url }: { word: string; url?: string }) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const request = useRef(0)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    setFailed(false)
    setLoading(false)
    return () => { request.current++; audio.current?.pause(); audio.current = null }
  }, [word, url])
  const play = async () => {
    const sequence = ++request.current
    setFailed(false)
    setLoading(true)
    audio.current?.pause()
    const start = async (source: string) => {
      if (sequence !== request.current) return
      const player = new Audio(source)
      audio.current = player
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([player.play(), new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('发音加载超时')), 4000)
        })])
        if (sequence !== request.current) player.pause()
      } catch (error) { player.pause(); throw error }
      finally { clearTimeout(timeout) }
    }
    try {
      if (url) {
        try { await start(url); return } catch { /* Use local English speech if the recording is unavailable. */ }
      }
      if (sequence !== request.current) return
      const pronunciation = await window.wordGlass.getPronunciation(word)
      await start(pronunciation.audioUrl)
    } catch { if (sequence === request.current) setFailed(true) }
    finally { if (sequence === request.current) setLoading(false) }
  }
  return (
    <button className="pronunciation-btn" type="button" aria-label={`播放 ${word} 的发音`}
      title={loading ? '正在准备发音…' : failed ? '发音暂不可用，点击重试' : '播放发音'} aria-busy={loading} disabled={loading} onClick={play}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m11 5-6 4H2v6h3l6 4V5Z M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
      </svg>
      {failed && <span className="sr-only" role="status">发音暂不可用，请稍后重试</span>}
    </button>
  )
}

/**
 * 液态玻璃单词卡片头部。
 * 顶部整条区域原生拖动，细线仅作提示，不限制鼠标命中范围；
 * 悬停展开时头部收窄，由外层 .sheet 的高度过渡控制。
 */
export default function GlassCard({ word, phonetic, group, showPhonetic, definitions = [], hint, audioUrl,
  showNavigation = false, canNavigate = false, onPrevious, onNext }: GlassCardProps) {
  const definition = definitions.find((item) => item.meaning.trim())
  const fullMeaning = definitions
    .map((item) => `${item.partOfSpeech} ${item.meaning}`.trim())
    .join('；')

  return (
    <div className="card">
      <div className="card-grip" title="拖动位置" />
      <div className="card-content">
        {group ? <div className="card-group">{group}</div> : null}
        <div className="card-word-row">
          {showNavigation && (
            <button className="card-nav card-nav-previous" type="button" aria-label="上一个词" title="上一个词"
              disabled={!canNavigate} onClick={onPrevious}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
            </button>
          )}
          <div key={word} className={`card-word ${word.length > 12 ? 'small' : ''}`} aria-live="polite" aria-atomic="true">{word}</div>
          {showNavigation && (
            <button className="card-nav card-nav-next" type="button" aria-label="下一个词" title="下一个词"
              disabled={!canNavigate} onClick={onNext}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg>
            </button>
          )}
        </div>
        {(showPhonetic && phonetic) || word ? (
          <div className="card-pronunciation">
            {showPhonetic && phonetic ? <span className="card-phonetic">{phonetic}</span> : null}
            {word && <PronunciationButton key={word} word={word} url={audioUrl} />}
          </div>
        ) : null}
        {word ? (
          <div className="card-definition" title={fullMeaning || undefined}>
            {definition?.partOfSpeech && <span className="card-pos">{definition.partOfSpeech}</span>}
            <span className="card-meaning">{definition?.meaning || '释义待补全'}</span>
          </div>
        ) : hint ? <div className="card-hint">{hint}</div> : null}
      </div>
    </div>
  )
}
