import { useRef, useState } from 'react'
import type { BulkDeleteResult } from './bulk-delete'

export function useBulkDelete() {
  const [active, setActive] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BulkDeleteResult>()
  const running = useRef(false)
  function toggle(id: string) {
    if (running.current) return
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  async function remove(options: {
    records: Array<{ id: string; name: string }>
    entity: string
    deleteMany: (ids: string[]) => Promise<BulkDeleteResult>
    reload: () => Promise<void>
  }) {
    if (running.current || !selectedIds.size) return
    const ids = [...selectedIds]
    const names = ids.map((id) => options.records.find((record) => record.id === id)?.name ?? id)
    if (!window.confirm(`確定刪除所選 ${ids.length} 個${options.entity}？\n\n${names.join('\n')}\n\n有關聯的資料不會強制刪除；逐筆處理，成功項目無法復原。`)) return
    running.current = true
    setBusy(true)
    setResult(undefined)
    try {
      const outcome = await options.deleteMany(ids)
      setResult(outcome)
      setSelectedIds(new Set(outcome.failures.map((failure) => failure.id)))
      await options.reload()
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  function enter() {
    if (running.current) return
    setSelectedIds(new Set())
    setResult(undefined)
    setActive(true)
  }
  function exit() {
    if (running.current) return
    setSelectedIds(new Set())
    setResult(undefined)
    setActive(false)
  }
  return { active, enter, exit, selectedIds, setSelectedIds, busy, result, toggle, remove }
}