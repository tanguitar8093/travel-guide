import { database } from './database'
import { EntityInUseError, EntityNotFoundError, ValidationError } from './errors'
import type { Label, LabelChanges, NewLabel } from './models'
import { validateLabel } from './validation'

function createId(): string {
  return crypto.randomUUID()
}

function requiredLabel(value: Label | undefined, id: string): Label {
  if (value === undefined) {
    throw new EntityNotFoundError('Label', id)
  }
  return value
}

export class LabelRepository {
  async create(input: NewLabel): Promise<string> {
    validateLabel(input)
    const id = createId()

    await database.transaction('rw', database.labels, async () => {
      await this.assertParentExists(input.parentId)
      await database.labels.add({ ...input, id })
    })

    return id
  }

  async update(id: string, changes: LabelChanges): Promise<void> {
    await database.transaction('rw', database.labels, async () => {
      const current = requiredLabel(await database.labels.get(id), id)
      const next = { ...current, ...changes }

      validateLabel(next)
      await this.assertParentExists(next.parentId)
      await this.assertNoParentCycle(id, next.parentId)
      await database.labels.put(next)
    })
  }

  async delete(id: string): Promise<void> {
    await database.transaction(
      'rw',
      database.labels,
      database.places,
      async () => {
        requiredLabel(await database.labels.get(id), id)

        const [childCount, placeCount] = await Promise.all([
          database.labels.where('parentId').equals(id).count(),
          database.places.where('labelIds').equals(id).count(),
        ])

        if (childCount > 0 || placeCount > 0) {
          throw new EntityInUseError(
            'Label',
            id,
            'remove its child labels and place assignments before deleting it.',
          )
        }

        await database.labels.delete(id)
      },
    )
  }

  getById(id: string): Promise<Label | undefined> {
    return database.labels.get(id)
  }

  list(): Promise<Label[]> {
    return database.labels.orderBy('name').toArray()
  }

  async getDescendantIds(id: string): Promise<string[]> {
    requiredLabel(await database.labels.get(id), id)

    const labels = await database.labels.toArray()
    const descendants: string[] = []
    const visited = new Set([id])
    let parentIds = [id]

    while (parentIds.length > 0) {
      const children = labels.filter(
        (label) => label.parentId !== undefined && parentIds.includes(label.parentId),
      )
      const next = children.filter((label) => !visited.has(label.id))

      for (const child of next) {
        descendants.push(child.id)
        visited.add(child.id)
      }

      parentIds = next.map((label) => label.id)
    }

    return descendants
  }

  private async assertParentExists(parentId: string | undefined): Promise<void> {
    if (parentId !== undefined && !(await database.labels.get(parentId))) {
      throw new EntityNotFoundError('Parent label', parentId)
    }
  }

  private async assertNoParentCycle(id: string, parentId: string | undefined): Promise<void> {
    const visited = new Set<string>()
    let currentId = parentId

    while (currentId !== undefined) {
      if (currentId === id || visited.has(currentId)) {
        throw new ValidationError('Label hierarchy must not contain a cycle.')
      }

      visited.add(currentId)
      currentId = (await database.labels.get(currentId))?.parentId
    }
  }
}

export const labels = new LabelRepository()
