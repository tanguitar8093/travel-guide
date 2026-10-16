import { supabase } from './supabase.client'
import { EntityInUseError, EntityNotFoundError, ValidationError } from './errors'
import type { NewRegion, Region, RegionChanges } from './models'
import { validateRegion } from './validation'

interface SupabaseRegionRow {
  id: string
  name: string
  center: { latitude?: number; longitude?: number } | null
  google_place_id: string | null
  zoom: number | string
}

function normalizeRegion(row: SupabaseRegionRow): Region {
  const center = row.center
  return {
    id: row.id,
    name: row.name,
    ...(center?.latitude !== undefined && center?.longitude !== undefined
      ? {
          center: {
            latitude: center.latitude,
            longitude: center.longitude,
          },
        }
      : {}),
    ...(row.google_place_id ? { googlePlaceId: row.google_place_id } : {}),
    zoom: Number(row.zoom),
  }
}

function toSupabaseRegionInput(input: NewRegion) {
  return {
    name: input.name,
    center: input.center ?? null,
    google_place_id: input.googlePlaceId ?? null,
    zoom: input.zoom,
  }
}

function mapSupabaseError(error: { code?: string; message: string }, fallback: string): Error {
  if (error.code === '23503') {
    return new EntityInUseError('Region', fallback, 'one or more places or trips still reference it.')
  }

  if (error.code === '42501') {
    return new ValidationError('目前沒有權限執行此操作。')
  }

  return new Error(error.message)
}

export class SupabaseRegionRepository {
  async create(input: NewRegion): Promise<string> {
    validateRegion(input)
    const { data, error } = await supabase
      .from('regions')
      .insert(toSupabaseRegionInput(input))
      .select('id')
      .single()

    if (error) throw mapSupabaseError(error, 'new')
    return data.id
  }

  async update(id: string, changes: RegionChanges): Promise<void> {
    const current = await this.getById(id)
    if (!current) {
      throw new EntityNotFoundError('Region', id)
    }

    const next = { ...current, ...changes }
    validateRegion(next)

    const { error } = await supabase
      .from('regions')
      .update(toSupabaseRegionInput(next))
      .eq('id', id)

    if (error) throw mapSupabaseError(error, id)
  }

  async delete(id: string): Promise<void> {
    const current = await this.getById(id)
    if (!current) {
      throw new EntityNotFoundError('Region', id)
    }

    const { error } = await supabase.from('regions').delete().eq('id', id)
    if (error) throw mapSupabaseError(error, id)
  }

  async getById(id: string): Promise<Region | undefined> {
    const { data, error } = await supabase
      .from('regions')
      .select('*')
      .eq('id', id)
      .maybeSingle<SupabaseRegionRow>()

    if (error) throw mapSupabaseError(error, id)
    return data ? normalizeRegion(data) : undefined
  }

  async list(): Promise<Region[]> {
    const { data, error } = await supabase
      .from('regions')
      .select('*')
      .order('name', { ascending: true })
      .returns<SupabaseRegionRow[]>()

    if (error) throw mapSupabaseError(error, 'list')
    return (data ?? []).map(normalizeRegion)
  }
}

export const regions = new SupabaseRegionRepository()