import { useEffect, useState } from 'react'
import type { AutostartStatus } from '../types'

export default function AutostartSetting() {
  const [status, setStatus] = useState<AutostartStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    if (!window.wordGlass.getAutostart) return
    window.wordGlass.getAutostart().then((value) => { if (active) setStatus(value) })
      .catch(() => { if (active) setError('无法读取开机自启状态，请稍后重试') })
    return () => { active = false }
  }, [])
  const change = async (enabled: boolean) => {
    setBusy(true); setError('')
    try { setStatus(await window.wordGlass.setAutostart(enabled)) }
    catch (error) {
      setError((error as Error).message || '保存开机自启设置失败')
      try { setStatus(await window.wordGlass.getAutostart()) } catch { /* Keep the last known state. */ }
    } finally { setBusy(false) }
  }
  return (
    <div className="field">
      <label className="field check">
        <input type="checkbox" checked={status?.enabled || false} disabled={!status?.supported || busy}
          onChange={(event) => change(event.target.checked)} />
        <span>开机自启</span>
      </label>
      <span className="tip">登录 Windows 后自动打开单词卡片。开关立即生效，无需点击保存设置。</span>
      <span className="tip" role="status">{busy ? '正在更新…' : error || status?.message
        || (status ? status.enabled ? '已开启开机自启' : '未开启开机自启' : '正在读取系统状态…')}</span>
    </div>
  )
}
