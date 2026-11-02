import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 单词轮播：按固定间隔顺序切换。
 * @param words  轮播词表（已按分组过滤）
 * @param intervalMs 停留时间（毫秒）
 * @param paused 暂停自动轮播；恢复后重新计时，手动切词仍可用。
 */
export function useWordRotation(words: string[], intervalMs: number, paused = false) {
  const [index, setIndex] = useState(0)
  const [restart, setRestart] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const move = useCallback((direction: number) => {
    if (timer.current) clearInterval(timer.current)
    setIndex((i) => words.length ? (i + direction + words.length) % words.length : 0)
    setRestart((value) => value + 1)
  }, [words.length])
  const next = useCallback(() => move(1), [move])
  const previous = useCallback(() => move(-1), [move])

  // 词表变化时把 index 拉回有效范围
  useEffect(() => {
    setIndex((i) => (words.length === 0 ? 0 : i % words.length))
  }, [words.length])

  useEffect(() => {
    if (paused || words.length <= 1) return
    timer.current = setInterval(() => {
      setIndex((i) => (i + 1) % words.length)
    }, intervalMs)
    return () => { if (timer.current) clearInterval(timer.current); timer.current = null }
  }, [words.length, intervalMs, restart, paused])

  return { index, current: words.length > 0 ? words[index % words.length] : null, next, previous }
}
