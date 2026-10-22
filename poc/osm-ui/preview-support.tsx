export function useHybridDataRevision() { return 0 }
export function HybridStatus() { return null }
export function WorkspaceInfoBar() { return null }
export function useDatabaseMode() { return 'indexeddb' }
export function publicSharingAvailable() { return false }
export function createPublicItineraryController() { return {} }
export function PublicationDialog() { return null }
export function TripCollaborationPanel({ onClose }: { onClose: () => void }) {
  return <dialog open style={{zIndex:1300}}><p>此地圖 UI 預覽未連接協作服務。</p><button onClick={() => onClose()}>關閉</button></dialog>
}
