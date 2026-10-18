import {
  EntityNotFoundError,
  labels,
  places,
  regions,
} from '../../database'
import type {
  Label,
  NewPlace,
  Place,
  PlaceChanges,
  Region,
} from '../../database'
import {
  getGooglePlaceDetails,
  isGooglePlacesConfigured,
  mountPlaceAutocomplete,
} from './google-places.service'
import type { GooglePlaceDetails } from './google-places.service'
import { bulkDelete, type BulkDeleteResult } from '../../common/bulk-delete'

export interface PlaceQuery {
  search?: string
  labelIds?: string[]
  includeDescendants?: boolean
  regionId?: string
}

export interface PlaceWorkspace {
  places: Place[]
  labels: Label[]
  regions: Region[]
}

export class PlaceService {
  isGooglePlacesConfigured(): boolean {
    return isGooglePlacesConfigured()
  }

  mountPlaceAutocomplete(
    container: HTMLElement,
    onSelect: (details: GooglePlaceDetails, query: string) => void,
    onError: (error: Error) => void,
  ): Promise<() => void> {
    return mountPlaceAutocomplete(container, onSelect, onError)
  }

  getGooglePlaceDetails(placeId: string): Promise<GooglePlaceDetails> {
    return getGooglePlaceDetails(placeId)
  }

  async loadWorkspace(): Promise<PlaceWorkspace> {
    const [placeRecords, labelRecords, regionRecords] = await Promise.all([
      places.list(),
      labels.list(),
      regions.list(),
    ])
    return {
      places: placeRecords,
      labels: labelRecords,
      regions: regionRecords,
    }
  }

  getById(id: string): Promise<Place | undefined> {
    return places.getById(id)
  }

  create(input: NewPlace): Promise<string> {
    return places.create(input)
  }

  update(id: string, changes: PlaceChanges): Promise<void> {
    return places.update(id, changes)
  }

  delete(id: string): Promise<void> {
    return places.delete(id)
  }

  deleteMany(ids: string[]): Promise<BulkDeleteResult> {
    return bulkDelete({
      ids,
      entity: '地點',
      load: () => places.list(),
      deleteOne: (id) => this.delete(id),
    })
  }

  async search(query: PlaceQuery = {}): Promise<Place[]> {
    let results = query.labelIds?.length
      ? await this.findByLabels(query.labelIds, query.includeDescendants ?? true)
      : await places.list()

    const regionId = query.regionId
    if (regionId) {
      results = results.filter((place) => place.regionIds.includes(regionId))
    }

    const searchTerm = query.search?.trim().toLocaleLowerCase()
    if (searchTerm) {
      results = results.filter((place) =>
        place.name.toLocaleLowerCase().includes(searchTerm) ||
        place.notes?.toLocaleLowerCase().includes(searchTerm),
      )
    }

    return results
  }

  private async findByLabels(
    selectedIds: string[],
    includeDescendants: boolean,
  ): Promise<Place[]> {
    const availableLabels = await labels.list()
    const labelById = new Map(availableLabels.map((label) => [label.id, label]))
    const expandedIds = new Set<string>()

    for (const id of selectedIds) {
      if (!labelById.has(id)) {
        throw new EntityNotFoundError('Label', id)
      }
      expandedIds.add(id)
      if (!includeDescendants) continue

      let parents = [id]
      while (parents.length > 0) {
        const children = availableLabels.filter(
          (label) => label.parentId !== undefined && parents.includes(label.parentId),
        )
        parents = []
        for (const child of children) {
          if (!expandedIds.has(child.id)) {
            expandedIds.add(child.id)
            parents.push(child.id)
          }
        }
      }
    }

    return places.findByLabelIds([...expandedIds])
  }
}
