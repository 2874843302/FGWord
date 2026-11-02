import { useLayoutEffect } from 'react'

/** Keep the native mouse hit area in sync with visible surfaces, including height transitions. */
export function useWindowHitRegions(managerOpen: boolean, ready: boolean, failed: boolean) {
  useLayoutEffect(() => {
    const surface = document.querySelector(managerOpen ? '.manager' : '.sheet')
    const elements = [surface, document.querySelector('.gear')].filter((element): element is Element => !!element)
    let frame = 0
    const report = () => {
      frame = 0
      window.wordGlass.setHitRegions?.({ width: window.innerWidth, height: window.innerHeight,
        regions: elements.map((element) => {
          const rect = element.getBoundingClientRect()
          const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, radius }
        }),
      })
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(report) }
    const observer = new ResizeObserver(schedule)
    elements.forEach((element) => observer.observe(element))
    window.addEventListener('resize', schedule)
    document.addEventListener('animationend', schedule)
    document.addEventListener('transitionend', schedule)
    report()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('animationend', schedule)
      document.removeEventListener('transitionend', schedule)
    }
  }, [managerOpen, ready, failed])
}
