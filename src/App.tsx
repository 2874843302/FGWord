import { useEffect, useMemo, useState } from 'react'
import type { AppState } from './types'
import GlassCard from './components/GlassCard'
import DetailPanel from './components/DetailPanel'
import ManagerPanel from './components/ManagerPanel'
import ResizeHandle from './components/ResizeHandle'
import { useWordRotation } from './hooks/useWordRotation'
import { useWindowHitRegions } from './hooks/useWindowHitRegions'

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.1" />
      <path d="m9.5 3-.5 2-1.5.9-2-.6L3 9.7l1.5 1.4v1.8L3 14.3l2.5 4.4 2-.6L9 19l.5 2h5l.5-2 1.5-.9 2 .6 2.5-4.4-1.5-1.4v-1.8L21 9.7l-2.5-4.4-2 .6L15 5l-.5-2Z" />
    </svg>
  )
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(() => document.hasFocus())
  const [managerOpen, setManagerOpen] = useState(false)
  const [resizing, setResizing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useWindowHitRegions(managerOpen, !!state, !!error)
  useEffect(() => window.wordGlass.onOpenManager?.(() => setManagerOpen(true)), [])

  useEffect(() => {
    const onFocus = () => setFocused(true)
    const onBlur = () => setFocused(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    setFocused(document.hasFocus())
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const refresh = () => {
    window.wordGlass
      .getState()
      .then(setState)
      .catch((e) => setError(String((e as Error).message ?? e)))
  }

  useEffect(() => {
    const unsubscribe = window.wordGlass.onStateChanged(setState)
    refresh()
    return unsubscribe
  }, [])

  const theme = state?.settings.theme ?? 'smoke'
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // 按分组白名单过滤轮播词表（空白名单 = 全部）
  const rotationWords = useMemo(() => {
    if (!state) return []
    const { words, settings } = state
    if (settings.groups.length === 0) return words.map((w) => w.id)
    return words.filter((w) => settings.groups.includes(w.group)).map((w) => w.id)
  }, [state])

  const intervalMs = (state?.settings.intervalSec ?? 6) * 1000
  const { current, next, previous } = useWordRotation(rotationWords, intervalMs, focused || hovered || managerOpen || resizing)
  useEffect(() => window.wordGlass.onNextWord(next), [next])

  const currentEntry = useMemo(
    () => state?.words.find((w) => w.id === current) ?? null,
    [state, current],
  )

  if (error) {
    return (
      <div className="app">
        <div className="sheet glass">
          <div className="card-content is-static">
            <div className="card-word small">初始化失败</div>
            <div className="card-hint">{error}</div>
          </div>
        </div>
      </div>
    )
  }

  if (!state) {
    return (
      <div className="app">
        <div className="sheet glass">
          <div className="card-content is-static">
            <div className="card-word small">加载中…</div>
          </div>
        </div>
      </div>
    )
  }

  const expanded = (hovered || resizing) && !!currentEntry

  return (
    <div className={`app ${resizing ? 'is-resizing' : ''}`}>
      {/* 卡片 + 详情共用一个 hover 容器，避免鼠标移到详情区时收起 */}
      <div
        className="hover-zone"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {currentEntry ? (
          <div className={`sheet glass ${expanded ? 'open' : ''}`}>
            <GlassCard
              word={currentEntry.word}
              phonetic={currentEntry.phonetic}
              group={currentEntry.group}
              showPhonetic={state.settings.showPhonetic}
              definitions={currentEntry.definitions}
              audioUrl={currentEntry.audioUrl}
              showNavigation={(hovered || focused) && !managerOpen}
              canNavigate={rotationWords.length > 1}
              onPrevious={previous}
              onNext={next}
            />
            <div className="sheet-rule" />
            <DetailPanel word={currentEntry} expanded={expanded} />
            <ResizeHandle onResizingChange={setResizing} />
          </div>
        ) : (
          <div className="sheet glass">
            <GlassCard
              word=""
              phonetic=""
              showPhonetic={false}
              hint="暂无轮播单词，点击右上角添加"
            />
          </div>
        )}
      </div>

      {/* 管理入口：悬浮在卡片右上角（非拖拽区） */}
      <button
        className="gear"
        title="管理单词 / 分组 / 设置"
        aria-label="打开管理面板"
        onClick={() => setManagerOpen(true)}
      >
        <GearIcon />
      </button>

      {managerOpen && (
        <ManagerPanel state={state} onRefresh={refresh} onClose={() => setManagerOpen(false)} onResizingChange={setResizing} />
      )}
    </div>
  )
}
