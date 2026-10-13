export class EntityNotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} "${id}" was not found.`)
    this.name = 'EntityNotFoundError'
  }
}

export class EntityInUseError extends Error {
  constructor(entity: string, id: string, reason: string) {
    super(`Cannot delete ${entity} "${id}": ${reason}`)
    this.name = 'EntityInUseError'
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}
