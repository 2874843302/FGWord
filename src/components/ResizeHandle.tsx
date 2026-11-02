import { useEffect, useRef, useState } from 'react'

export default function ResizeHandle({ onResizingChange }: { onResizingChange: (value: boolean) => void }) {
  const drag = useRef<{ pointerId: number; x: number; y: number; width: number; height: number } | null>(null)
  const frame = useRef(0)
  const pending = useRef<{ width: number; height: number } | null>(null)
  const [error, setError] = useState('')
  const apply = () => {
    frame.current = 0
    if (pending.current) {
      window.wordGlass.resizeWindow(pending.current).catch(() => setError('调整尺寸失败，请重试'))
      pending.current = null
    }
  }
  const finish = () => {
    if (!drag.current) return
    cancelAnimationFrame(frame.current)
    apply()
    drag.current = null
    window.wordGlass.setWindowResizing(false)
    onResizingChange(false)
  }
  useEffect(() => () => {
    cancelAnimationFrame(frame.current)
    if (drag.current) { window.wordGlass.setWindowResizing(false); onResizingChange(false) }
  }, [onResizingChange])
  return (
    <>
      <button className="window-resize" aria-label="调整窗口大小" title="拖动调整大小；方向键微调"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, width: window.innerWidth, height: window.innerHeight }
          setError('')
          window.wordGlass.setWindowResizing(true)
          onResizingChange(true)
        }}
        onPointerMove={(event) => {
          const start = drag.current
          if (!start || start.pointerId !== event.pointerId) return
          pending.current = { width: start.width + event.screenX - start.x, height: start.height + event.screenY - start.y }
          if (!frame.current) frame.current = requestAnimationFrame(apply)
        }}
        onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 50 : 10
          const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0
          const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0
          if (!dx && !dy) return
          event.preventDefault()
          window.wordGlass.resizeWindow({ width: window.innerWidth + dx, height: window.innerHeight + dy })
            .catch(() => setError('调整尺寸失败，请重试'))
        }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="m7 20 13-13M13 20l7-7M19 20l1-1" />
        </svg>
      </button>
      {error && <span className="sr-only" role="status">{error}</span>}
    </>
  )
}
