import type { ReactNode } from 'react'
import { useAdminSyncInfo } from './useAdminSyncInfo'

export function AdminInfo({ children }: { children: ReactNode }) {
  const { visible } = useAdminSyncInfo()
  return visible ? <>{children}</> : null
}
