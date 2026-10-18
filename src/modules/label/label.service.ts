import {
  EntityNotFoundError,
  ValidationError,
  labels,
  places,
} from '../../database'
import type {
  Label,
  LabelChanges,
  NewLabel,
  Place,
} from '../../database'
import { bulkDelete, type BulkDeleteResult } from '../../common/bulk-delete'

export interface LabelTreeNode extends Label {
  children: LabelTreeNode[]
}

export class LabelService {
  async listTree(): Promise<LabelTreeNode[]> {
    const records = await labels.list()
    const nodes = new Map<string, LabelTreeNode>()

    for (const record of records) {
      nodes.set(record.id, { ...record, children: [] })
    }

    const roots: LabelTreeNode[] = []

    for (const record of records) {
      const node = nodes.get(record.id)
      if (!node) {
        throw new EntityNotFoundError('Label', record.id)
      }

      if (record.parentId === undefined) {
        roots.push(node)
        continue
      }

      const parent = nodes.get(record.parentId)
      if (!parent) {
        throw new EntityNotFoundError('Parent label', record.parentId)
      }
      parent.children.push(node)
    }

    const visited = new Set<string>()
    const visit = (node: LabelTreeNode): void => {
      if (visited.has(node.id)) {
        throw new ValidationError('Label hierarchy must not contain a cycle.')
      }
      visited.add(node.id)
      for (const child of node.children) {
        visit(child)
      }
    }

    for (const root of roots) {
      visit(root)
    }

    if (visited.size !== nodes.size) {
      throw new ValidationError('Label hierarchy must not contain a cycle.')
    }

    return roots
  }

  getById(id: string): Promise<Label | undefined> {
    return labels.getById(id)
  }

  create(input: NewLabel): Promise<string> {
    return labels.create(input)
  }

  update(id: string, changes: LabelChanges): Promise<void> {
    return labels.update(id, changes)
  }

  delete(id: string): Promise<void> {
    return labels.delete(id)
  }

  deleteMany(ids: string[]): Promise<BulkDeleteResult> {
    return bulkDelete({
      ids,
      entity: '標籤',
      load: () => labels.list(),
      deleteOne: (id) => this.delete(id),
      order: (selectedIds, records) => {
        const byId = new Map(records.map((label) => [label.id, label]))
        const depth = (id: string) => {
          const visited = new Set<string>()
          let current = byId.get(id)
          while (current?.parentId && !visited.has(current.id)) {
            visited.add(current.id)
            current = byId.get(current.parentId)
          }
          return visited.size
        }
        // Sort only the selection; never implicitly select descendants.
        return [...selectedIds].sort((left, right) => depth(right) - depth(left))
      },
    })
  }

  assignToPlace(placeId: string, labelId: string): Promise<void> {
    return places.addLabel(placeId, labelId)
  }

  removeFromPlace(placeId: string, labelId: string): Promise<void> {
    return places.removeLabel(placeId, labelId)
  }

  listPlaces(): Promise<Place[]> {
    return places.list()
  }

  async findPlaces(
    labelId: string,
    includeDescendants = true,
  ): Promise<Place[]> {
    if (!(await labels.getById(labelId))) {
      throw new EntityNotFoundError('Label', labelId)
    }

    const labelIds = includeDescendants
      ? [labelId, ...(await labels.getDescendantIds(labelId))]
      : [labelId]

    return places.findByLabelIds(labelIds)
  }
}
