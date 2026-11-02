'use strict'

function normalizeRegions(payload) {
  if (!payload || !Number.isFinite(payload.width) || !Number.isFinite(payload.height) ||
    payload.width <= 0 || payload.height <= 0 || !Array.isArray(payload.regions)) return null
  const regions = payload.regions.slice(0, 8).filter((rect) => rect &&
    ['x', 'y', 'width', 'height', 'radius'].every((key) => Number.isFinite(rect[key])) && rect.width > 0 && rect.height > 0)
    .map((rect) => ({ ...rect, radius: Math.max(0, Math.min(rect.radius, rect.width / 2, rect.height / 2)) }))
  return { width: payload.width, height: payload.height, regions }
}

function containsPoint(layout, x, y, width, height) {
  if (!layout || width <= 0 || height <= 0) return false
  const px = x * layout.width / width
  const py = y * layout.height / height
  return layout.regions.some((rect) => {
    if (px < rect.x || py < rect.y || px >= rect.x + rect.width || py >= rect.y + rect.height) return false
    const r = rect.radius
    const cx = Math.max(rect.x + r, Math.min(px, rect.x + rect.width - r))
    const cy = Math.max(rect.y + r, Math.min(py, rect.y + rect.height - r))
    return (px - cx) ** 2 + (py - cy) ** 2 <= r ** 2
  })
}

module.exports = { normalizeRegions, containsPoint }
