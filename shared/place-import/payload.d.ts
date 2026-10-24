import type { ImportCandidate } from './place-url.js'
export function createImportPayload(candidate: ImportCandidate, operationId: string): {
  p_name: string; p_latitude: number; p_longitude: number; p_operation_id: string; p_source_url: string | null
}
