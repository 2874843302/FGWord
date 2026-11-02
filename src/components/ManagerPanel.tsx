import { useEffect, useMemo, useState } from 'react'
import type { AppState, ThemeName, WordContent } from '../types'
import ResizeHandle from './ResizeHandle'
import AutostartSetting from './AutostartSetting'

interface ManagerPanelProps {
  state: AppState
  onRefresh: () => void
  onClose: () => void
  onResizingChange: (value: boolean) => void
}

type Tab = 'add' | 'groups' | 'settings' | 'words'

const TABS: { key: Tab; label: string }[] = [
  { key: 'add', label: '添加' },
  { key: 'groups', label: '分组' },
  { key: 'settings', label: '设置' },
  { key: 'words', label: '词库' },
]

const THEME_OPTIONS: { key: ThemeName; label: string; swatches: string[] }[] = [
  { key: 'smoke', label: '烟熏玻璃', swatches: ['#202634', '#0d1018', '#7ce7ff'] },
  { key: 'frost', label: '霜白玻璃', swatches: ['#ffffff', '#dbe4f2', '#2463eb'] },
  { key: 'aurora', label: '极光玻璃', swatches: ['#151c32', '#0a0c16', '#a78bfa'] },
]

export default function ManagerPanel({ state, onRefresh, onClose, onResizingChange }: ManagerPanelProps) {
  const [tab, setTab] = useState<Tab>('add')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text })
    setTimeout(() => setMsg(null), 3000)
  }

  return (
    <div className="manager glass-strong">
      <div className="manager-head">
        <div className="manager-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`tab-btn ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button className="icon-btn" onClick={onClose} title="关闭" aria-label="关闭管理面板">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      {msg && <div className={`flash ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}

      <div className="manager-body">
        {tab === 'add' && <AddTab state={state} flash={flash} onRefresh={onRefresh} />}
        {tab === 'groups' && <GroupsTab state={state} flash={flash} onRefresh={onRefresh} />}
        {tab === 'settings' && <SettingsTab state={state} flash={flash} onRefresh={onRefresh} />}
        {tab === 'words' && <WordsTab state={state} flash={flash} onRefresh={onRefresh} />}
      </div>
      <ResizeHandle onResizingChange={onResizingChange} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab：添加单词
// ---------------------------------------------------------------------------
function AddTab({
  state,
  flash,
  onRefresh,
}: {
  state: AppState
  flash: (ok: boolean, text: string) => void
  onRefresh: () => void
}) {
  const groups = useMemo(() => {
    const s = new Set(state.words.map((w) => w.group))
    state.settings.groups.forEach((g) => s.add(g))
    if (s.size === 0) s.add('默认分组')
    return Array.from(s)
  }, [state])

  const [word, setWord] = useState('')
  const [group, setGroup] = useState(groups[0] ?? '默认分组')
  const [preview, setPreview] = useState<WordContent | null>(null)
  const [busy, setBusy] = useState(false)

  const add = async (content?: WordContent) => {
    const w = word.trim()
    if (!w) return flash(false, '请输入单词')
    setBusy(true)
    try {
      const res = await window.wordGlass.addWord({ word: w, group, content })
      flash(true, res.created ? `已添加 ${res.word.word}，正在补充例句与发音` : `${res.word.word} 已存在`)
      setWord('')
      setPreview(null)
      onRefresh()
    } catch (e) {
      flash(false, String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const previewWord = async (useAI = false) => {
    const w = word.trim()
    if (!w) return flash(false, '请输入单词')
    setBusy(true)
    try {
      const res = useAI ? await window.wordGlass.enrichFromLLM(w) : await window.wordGlass.lookupWord(w)
      setPreview(res)
      flash(res.definitions.length > 0, res.lookupNote || '查询结果如下，可确认后添加')
    } catch (e) {
      flash(false, String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tab-pane">
      <label className="field">
        <span>单词</span>
        <input
          value={word}
          disabled={busy}
          onChange={(e) => { setWord(e.target.value); setPreview(null) }}
          placeholder="如 serendipity"
          autoFocus
        />
      </label>
      <label className="field">
        <span>分组</span>
        <select value={group} onChange={(e) => setGroup(e.target.value)}>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>
      <div className="btn-row">
        <button className="primary" disabled={busy} onClick={() => add()}>
          {busy ? '处理中…' : '快速添加'}
        </button>
        <button disabled={busy} onClick={() => previewWord()}>
          免费查词预览
        </button>
        {state.settings.llmBaseUrl && state.settings.llmApiKey && !preview?.complete && (
          <button disabled={busy} onClick={() => previewWord(true)}>AI 补全</button>
        )}
      </div>
      {preview && (
        <div className="preview">
          <div className="preview-word">
            {preview.word} {preview.phonetic && <span className="muted">{preview.phonetic}</span>}
          </div>
          {preview.definitions.map((d, i) => (
            <div key={i}>
              <span className="pos">{d.partOfSpeech}</span> {d.meaning}
            </div>
          ))}
          {preview.phrases.length > 0 && (
            <div className="muted small">
              {preview.phrases.map((p, i) => (
                <div key={i}>• {p}</div>
              ))}
            </div>
          )}
          {preview.examples.length > 0 && (
            <div className="muted small">
              {preview.examples.map((e, i) => (
                <div className="example" key={i}>{e}</div>
              ))}
            </div>
          )}
          <button
            className="primary small"
            disabled={busy}
            onClick={() => add(preview)}
          >
            确认添加词条
          </button>
        </div>
      )}
      <p className="tip">
        无需配置即可查词：中文释义和音标来自本地词库，在线自动补充英文例句与发音。双语短语和例句可在配置 LLM 后用 AI 补全。
      </p>
      <div className="selection-entry">
        <p className="tip">屏幕选词：在其他应用选中单词后按 {state.settings.selectionShortcut || '已关闭的快捷键'}，选择分组即可添加。</p>
        {state.selection?.message && <p className="tip" role="status">{state.selection.message}</p>}
        <button type="button" onClick={() => window.wordGlass.captureClipboard()}>从剪贴板添加</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab：分组管理与轮播白名单
// ---------------------------------------------------------------------------
function GroupsTab({
  state,
  flash,
  onRefresh,
}: {
  state: AppState
  flash: (ok: boolean, text: string) => void
  onRefresh: () => void
}) {
  const groups = useMemo(() => {
    const s = new Set<string>()
    state.words.forEach((w) => s.add(w.group))
    state.settings.groups.forEach((g) => s.add(g))
    return Array.from(s)
  }, [state])

  const [name, setName] = useState('')

  const addGroup = async () => {
    if (!name.trim()) return
    try {
      await window.wordGlass.addGroup(name.trim())
      setName('')
      flash(true, `分组「${name.trim()}」已创建`)
      onRefresh()
    } catch (e) {
      flash(false, String((e as Error).message ?? e))
    }
  }

  const toggleWhitelist = async (g: string) => {
    const cur = new Set(state.settings.groups)
    if (cur.has(g)) cur.delete(g)
    else cur.add(g)
    try {
      await window.wordGlass.updateSettings({ groups: Array.from(cur) })
      onRefresh()
    } catch (e) {
      flash(false, String((e as Error).message ?? e))
    }
  }

  return (
    <div className="tab-pane">
      <div className="field-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="新分组名，如 考研核心词"
        />
        <button onClick={addGroup}>创建</button>
      </div>
      <div className="group-list">
        {groups.length === 0 && <p className="muted">还没有分组</p>}
        {groups.map((g) => (
          <label className="group-item" key={g}>
            <input
              type="checkbox"
              checked={state.settings.groups.includes(g)}
              onChange={() => toggleWhitelist(g)}
            />
            <span>{g}</span>
            <span className="muted small">{state.words.filter((w) => w.group === g).length} 词</span>
          </label>
        ))}
      </div>
      <p className="tip">勾选的分组参与轮播；全部取消勾选 = 轮播所有分组。</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab：设置
// ---------------------------------------------------------------------------
function SettingsTab({
  state,
  flash,
  onRefresh,
}: {
  state: AppState
  flash: (ok: boolean, text: string) => void
  onRefresh: () => void
}) {
  const s = state.settings
  const [form, setForm] = useState({ ...s })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setForm((previous) => ({ ...previous, windowWidth: s.windowWidth, windowHeight: s.windowHeight }))
  }, [s.windowWidth, s.windowHeight])

  const save = async () => {
    setBusy(true)
    try {
      await window.wordGlass.updateSettings(form)
      flash(true, '设置已保存')
      onRefresh()
    } catch (e) {
      flash(false, String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  return (
    <div className="tab-pane">
      <AutostartSetting />
      <div className="field">
        <span>窗口大小（像素）</span>
        <div className="window-size-fields">
          <label>宽度<input aria-label="窗口宽度" type="number" min={320} max={1200} value={form.windowWidth}
            onChange={(event) => set('windowWidth', Number(event.target.value))} /></label>
          <label>高度<input aria-label="窗口高度" type="number" min={360} max={1200} value={form.windowHeight}
            onChange={(event) => set('windowHeight', Number(event.target.value))} /></label>
        </div>
        <span className="tip">可直接拖动右下角调整并自动保存；这里填写后点击保存设置。高度用于展开详情和管理面板，收起时保持紧凑。</span>
      </div>
      <label className="field">
        <span>轮播间隔（秒）</span>
        <input
          type="number"
          min={1}
          value={form.intervalSec}
          onChange={(e) => set('intervalSec', Number(e.target.value) || 1)}
        />
      </label>
      <label className="field check">
        <input
          type="checkbox"
          checked={form.showPhonetic}
          onChange={(e) => set('showPhonetic', e.target.checked)}
        />
        <span>卡片上显示音标</span>
      </label>

      <div className="field">
        <span>卡片主题</span>
        <div className="theme-grid">
          {THEME_OPTIONS.map((t) => (
            <button
              type="button"
              key={t.key}
              className={`theme-option ${form.theme === t.key ? 'active' : ''}`}
              aria-pressed={form.theme === t.key}
              onClick={() => set('theme', t.key)}
            >
              <span className="theme-swatch">
                {t.swatches.map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="tip">免费查词已启用，无需 API Key。断网时可继续查询本地中文释义与音标。</p>
      <label className="field">
        <span>下一个词快捷键</span>
        <input value={form.nextWordShortcut} onChange={(event) => set('nextWordShortcut', event.target.value)} placeholder="Control+Alt+N" />
        <span className="tip">默认 Ctrl + Alt + N，在其他应用中也可切换当前轮播分组的下一个词，并重新计算停留时间。可手动修改，留空关闭。</span>
        {state.nextWord?.message && <span className="tip">{state.nextWord.message}</span>}
      </label>
      <label className="field">
        <span>屏幕选词快捷键</span>
        <input value={form.selectionShortcut} onChange={(event) => set('selectionShortcut', event.target.value)} placeholder="Control+Shift+Alt+D" />
        <span className="tip">默认 Ctrl + Shift + Alt + D，选中其他应用的英文后按下。可手动修改，留空关闭；按 Esc 取消添加。</span>
        {state.selection?.message && <span className="tip">{state.selection.message}</span>}
      </label>
      <div className="sep">可选 AI 补全（OpenAI 兼容接口）</div>

      <label className="field">
        <span>Base URL</span>
        <input
          value={form.llmBaseUrl}
          onChange={(e) => set('llmBaseUrl', e.target.value)}
          placeholder="https://api.openai.com"
        />
      </label>
      <label className="field">
        <span>API Key</span>
        <input
          type="password"
          value={form.llmApiKey}
          onChange={(e) => set('llmApiKey', e.target.value)}
          placeholder="sk-..."
        />
      </label>
      <label className="field">
        <span>模型</span>
        <input value={form.llmModel} onChange={(e) => set('llmModel', e.target.value)} />
      </label>
      <button className="primary" disabled={busy} onClick={save}>
        保存设置
      </button>
      <p className="tip">API Key 保存在本地，仅在点击 AI 补全时发送给你配置的服务。免费查词不会使用此 Key。</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab：词库管理
// ---------------------------------------------------------------------------
function WordsTab({
  state,
  flash,
  onRefresh,
}: {
  state: AppState
  flash: (ok: boolean, text: string) => void
  onRefresh: () => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const progress = state.completion
  const busy = starting || !!progress?.running || busyId !== null
  const pendingCount = state.words.filter((word) => !word.complete).length

  const remove = async (id: string, word: string) => {
    await window.wordGlass.deleteWord(id)
    flash(true, `已删除 ${word}`)
    onRefresh()
  }

  const enrich = async (id: string) => {
    setBusyId(id)
    try {
      const result = await window.wordGlass.completeWord(id)
      flash(!!result.complete, result.complete ? '补全完成' : result.lookupNote || '已补充可用内容；配置 AI 可继续补充短语和例句')
      onRefresh()
    } catch (e) {
      flash(false, String((e as Error).message ?? e))
    } finally {
      setBusyId(null)
    }
  }

  const completeAll = async () => {
    setStarting(true)
    try { await window.wordGlass.completeAllWords(); onRefresh() }
    catch (error) { flash(false, (error as Error).message || '批量补全失败') }
    finally { setStarting(false) }
  }

  return (
    <div className="tab-pane">
      <div className="completion-toolbar">
        <span className="muted small">{state.words.length} 个词条 · {pendingCount ? `${pendingCount} 个待补全` : '内容已完整'}</span>
        {pendingCount > 0 && <button className="primary small" disabled={busy} onClick={completeAll}>
          {progress?.running ? '补全中…' : '一键补全'}
        </button>}
      </div>
      <p className="tip">补齐缺少的音标、释义、短语、例句及中文翻译，保留已有原句和译文；已完整的词条自动跳过。
        {!state.settings.llmBaseUrl || !state.settings.llmApiKey ? ' 当前使用免费词典，配置 AI 后可补充短语和例句翻译。' : ''}</p>
      {progress && <div className="completion-progress" role="status" aria-live="polite">
        <p>{progress.running ? `正在补全 ${progress.currentWord}（${progress.processed}/${progress.total}）`
          : `${progress.stopped ? '已停止' : '处理完成'}：补全 ${progress.completed}，待补充 ${progress.remaining}，失败 ${progress.failed}${progress.stopped ? `，未处理 ${progress.total - progress.processed}` : ''}`}</p>
        <progress aria-label="补全进度" max={Math.max(1, progress.total)} value={progress.processed} />
        {progress.running && <button className="small" onClick={() => window.wordGlass.stopCompletion()}>处理完当前词后停止</button>}
        {!!progress.failures.length && <details><summary>查看失败词条（{progress.failures.length}）</summary>
          {progress.failures.map((failure, index) => <p key={index}>{failure.word}：{failure.message}</p>)}
        </details>}
      </div>}
      <div className="word-list">
        {state.words.length === 0 && <p className="muted">词库为空</p>}
        {state.words.map((w) => (
          <div className="word-item" key={w.id}>
            <div className="word-main">
              <span className="word-name">{w.word}</span>
              <span className={`badge ${w.complete ? 'ok' : ''}`}>{w.complete ? '已补全' : '待补全'}</span>
              <span className="muted small">{w.group}</span>
            </div>
            <div className="word-ops">
              {!w.complete && <button className="small" disabled={busy} onClick={() => enrich(w.id)}>
                {busyId === w.id ? '补全中…' : '补全'}
              </button>}
              <button className="small danger" disabled={busy} onClick={() => remove(w.id, w.word)}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
