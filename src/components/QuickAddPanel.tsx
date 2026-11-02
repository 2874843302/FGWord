import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppState, SelectionCapture } from '../types'

export default function QuickAddPanel() {
  const [state, setState] = useState<AppState | null>(null)
  const [capture, setCapture] = useState<SelectionCapture | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const offState = window.wordGlass.onStateChanged(setState)
    const offSelection = window.wordGlass.onSelectionChanged(setCapture)
    Promise.all([window.wordGlass.getState(), window.wordGlass.getSelectionCapture()])
      .then(([nextState, nextCapture]) => { setState(nextState); setCapture(nextCapture) })
      .catch(() => setError('读取选词失败，请关闭后重试'))
    return () => { offState(); offSelection() }
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = state?.settings.theme || 'smoke'
  }, [state?.settings.theme])
  return (
    <div className="quick-add-shell">
      <section className="quick-add-panel" aria-label="选词添加">
        <header className="quick-add-head">
          <span>选词添加</span>
          <button className="icon-btn" aria-label="关闭选词添加" title="关闭（Esc）" onClick={() => window.wordGlass.dismissSelection()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        {state && capture ? <QuickAddForm key={capture.id} state={state} capture={capture} />
          : <p className="quick-add-message" role="status">{error || '正在读取选词…'}</p>}
      </section>
    </div>
  )
}

function QuickAddForm({ state, capture }: { state: AppState; capture: SelectionCapture }) {
  const groups = useMemo(() => {
    const result = [...new Set([...state.words.map((w) => w.group), ...state.settings.groups])]
    return result.length ? result : ['默认分组']
  }, [state.words, state.settings.groups])
  const [word, setWord] = useState(capture.word)
  const [group, setGroup] = useState(groups.includes(state.settings.lastCaptureGroup) ? state.settings.lastCaptureGroup : groups[0])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [saved, setSaved] = useState(false)
  const firstGroup = useRef<HTMLButtonElement>(null)
  const submitButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (submitButton.current && !submitButton.current.disabled) submitButton.current.focus()
    else firstGroup.current?.focus()
  }, [])
  const exists = state.words.some((entry) => entry.word.toLowerCase() === word.trim().toLowerCase() && entry.group === group)
  const definition = capture.content?.definitions[0]
  const add = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || saved || exists || !word.trim()) return
    setBusy(true); setMessage('')
    try {
      const result = await window.wordGlass.addSelection({ captureId: capture.id, word, group })
      setSaved(true)
      setMessage(result.created ? `已添加到「${result.word.group}」` : `已在「${result.word.group}」中`)
    } catch (error) { setMessage((error as Error).message || '添加失败，请重试') }
    finally { setBusy(false) }
  }
  if (capture.error) return (
    <div className="quick-add-body">
      <p className="quick-add-message" role="alert">{capture.error}</p>
      <button className="primary" onClick={() => window.wordGlass.captureClipboard()}>使用已复制的单词</button>
      <p className="tip">也可以先复制单词，再点击此按钮。</p>
    </div>
  )
  return (
    <form className="quick-add-body" onSubmit={add}>
      <input className="quick-add-word" aria-label="要添加的单词" value={word} maxLength={100}
        disabled={busy || saved} onChange={(event) => { setWord(event.target.value); setMessage('') }} />
      <p className="quick-add-meaning" title={definition?.meaning}>
        {word === capture.word && definition ? <>{definition.partOfSpeech && <span className="pos">{definition.partOfSpeech}</span>}<span>{definition.meaning}</span></>
          : <span>添加后自动查询中文释义</span>}
      </p>
      <fieldset className="quick-add-groups" disabled={busy || saved}>
        <legend>添加到分组</legend>
        <div className="quick-add-group-list">
          {groups.map((name, index) => (
            <button key={name} ref={index === 0 ? firstGroup : undefined} type="button" aria-pressed={group === name}
              className={`quick-add-group ${group === name ? 'selected' : ''}`} onClick={() => {
                setGroup(name); setMessage('')
                requestAnimationFrame(() => submitButton.current?.focus())
              }}>{name}</button>
          ))}
        </div>
      </fieldset>
      <div className="quick-add-feedback" role="status">{message || (exists ? '这个单词已在此分组，可以选择其他分组' : '')}</div>
      <button ref={submitButton} className="primary quick-add-submit" type="submit" disabled={busy || saved || exists || !word.trim()}>
        {saved ? '已添加' : busy ? '正在添加…' : exists ? '已在此分组' : '添加到分组'}
      </button>
    </form>
  )
}
