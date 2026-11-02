// 全局共享类型：与 electron/main.js 中 JSON 数据结构保持一致

export interface Definition {
  partOfSpeech: string
  meaning: string
}

export interface WordSource {
  name: string
  url: string
  license?: { name: string; url: string }
}

export interface WordContent {
  /** 按实际内容计算，不依赖旧 enriched 标记。 */
  complete?: boolean
  word: string
  phonetic: string
  definitions: Definition[]
  phrases: string[]
  examples: string[]
  audioUrl?: string
  sources?: WordSource[]
  lookupNote?: string
}

export interface WordEntry extends WordContent {
  id: string
  group: string
  enriched: boolean
  createdAt: number
}

/** 卡片玻璃主题 */
export type ThemeName = 'smoke' | 'frost' | 'aurora'

export interface Settings {
  windowWidth: number
  windowHeight: number
  selectionShortcut: string
  nextWordShortcut: string
  lastCaptureGroup: string
  intervalSec: number
  showPhonetic: boolean
  /** 轮播分组白名单；空数组 = 全部分组 */
  groups: string[]
  /** 卡片材质主题 */
  theme: ThemeName
  llmBaseUrl: string
  llmApiKey: string
  llmModel: string
}

export interface AppState {
  completion?: CompletionProgress
  selection?: { shortcut: string; active: boolean; message: string }
  nextWord?: { shortcut: string; active: boolean; message: string }
  settings: Settings
  words: WordEntry[]
}

export interface CompletionProgress {
  running: boolean
  total: number
  processed: number
  completed: number
  remaining: number
  failed: number
  skipped: number
  currentWord: string
  failures: { word: string; message: string }[]
  stopped: boolean
}

export interface SelectionCapture {
  id: string
  word: string
  content: WordContent | null
  error: string
}

export interface AutostartStatus {
  supported: boolean
  enabled: boolean
  registered: boolean
  message: string
}

/** 渲染进程通过 preload 暴露的桥接 API（window.wordGlass） */
export interface WordGlassApi {
  getPronunciation(word: string): Promise<{ audioUrl: string; voice: string; locale: string }>
  setHitRegions(layout: { width: number; height: number; regions: { x: number; y: number; width: number; height: number; radius: number }[] }): void
  onOpenManager(listener: () => void): () => void
  getAutostart(): Promise<AutostartStatus>
  setAutostart(enabled: boolean): Promise<AutostartStatus>
  onNextWord(listener: () => void): () => void
  resizeWindow(size: { width: number; height: number }): Promise<{ width: number; height: number }>
  setWindowResizing(active: boolean): void
  completeWord(id: string): Promise<WordEntry>
  completeAllWords(): Promise<CompletionProgress>
  stopCompletion(): Promise<void>
  getSelectionCapture(): Promise<SelectionCapture | null>
  captureClipboard(): Promise<void>
  dismissSelection(): Promise<void>
  addSelection(payload: { captureId: string; word: string; group: string }): Promise<{ word: WordEntry; created: boolean }>
  onSelectionChanged(listener: (capture: SelectionCapture) => void): () => void
  getState(): Promise<AppState>
  onStateChanged(listener: (state: AppState) => void): () => void
  addWord(payload: {
    word: string
    group: string
    definitions?: Definition[]
    content?: WordContent
  }): Promise<{ word: WordEntry; created: boolean }>
  deleteWord(id: string): Promise<boolean>
  enrichWord(id: string): Promise<WordEntry>
  enrichWordWithAI(id: string): Promise<WordEntry>
  lookupWord(word: string): Promise<WordContent>
  /** 添加前预览：只调 LLM，不入库 */
  enrichFromLLM(word: string): Promise<WordContent>
  addGroup(name: string): Promise<string[]>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
}

declare global {
  interface Window {
    wordGlass: WordGlassApi
  }
}
