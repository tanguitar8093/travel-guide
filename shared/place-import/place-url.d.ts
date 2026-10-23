export interface ImportCandidate {
  name: string
  coordinate: { latitude: number; longitude: number }
  sourceUrl: string
}
export function parsePlaceUrl(value: unknown): ImportCandidate | null
