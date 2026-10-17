import { ValidationError } from './errors'
import type { SyncAccount } from './sync.types'

export function validateSyncAccount(account: SyncAccount): SyncAccount {
  if (!account.projectId?.trim() || !account.userId?.trim()) {
    throw new ValidationError('Sync project and user IDs must not be empty.')
  }
  return { projectId: account.projectId, userId: account.userId }
}

export function getSyncDatabaseName(account: SyncAccount): string {
  const validated = validateSyncAccount(account)
  return `travel-planner-hybrid:${encodeURIComponent(validated.projectId)}:${encodeURIComponent(validated.userId)}`
}

export class SyncAccountContext {
  private current: SyncAccount | null = null
  private generation = 0

  activate(account: SyncAccount): void {
    this.current = validateSyncAccount(account)
    this.generation += 1
  }

  deactivate(): void {
    this.current = null
    this.generation += 1
  }

  capture(account: SyncAccount): () => void {
    const generation = this.generation
    const assertCurrent = () => {
      if (generation !== this.generation ||
          this.current?.projectId !== account.projectId ||
          this.current?.userId !== account.userId) {
        throw new ValidationError('The sync account is inactive or has changed.')
      }
    }
    assertCurrent()
    return assertCurrent
  }
}
