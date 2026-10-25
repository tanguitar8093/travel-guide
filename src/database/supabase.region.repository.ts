import { osmRegion, type OsmDatasetId } from '../geo/osm-datasets'
import { supabase } from './supabase.client'
import { EntityInUseError, EntityNotFoundError, ValidationError } from './errors'
import type { NewRegion, Region, RegionChanges } from './models'
import { validateRegion } from './validation'
import { accountOsmRegionId } from '../geo/osm-coverage'
import { requireAuthenticatedUserId } from './supabase.utils'

interface SupabaseRegionRow {
  id: string
  name: string
  center: { latitude?: number; longitude?: number } | null
  google_place_id: string | null
  map_provider: Region['mapProvider'] | null
  osm_dataset?: Region['osmDataset'] | null
  center_metadata: Region['centerMetadata'] | null
  zoom: number | string
}

const SUPABASE_TIMEOUT_MS = 8000

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`Supabase 請求逾時（${label}），請稍後再試。`))
    }, SUPABASE_TIMEOUT_MS)

    promise
      .then((value) => {
        window.clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        window.clearTimeout(timer)
        reject(error)
      })
  })
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
    ...(row.osm_dataset ? { osmDataset: row.osm_dataset } : {}),
    ...(row.map_provider ? { mapProvider: row.map_provider } : {}),
    ...(row.center_metadata ? { centerMetadata: row.center_metadata } : {}),
    zoom: Number(row.zoom),
  }
}

function toSupabaseRegionInput(input: NewRegion) {
  return {
    name: input.name,
    center: input.center ?? null,
    google_place_id: input.googlePlaceId ?? null,
    map_provider: input.mapProvider ?? null,
    osm_dataset: input.osmDataset ?? null,
    center_metadata: input.centerMetadata ?? null,
    zoom: input.zoom,
  }
}

function mapSupabaseError(error: { code?: string; message: string }, fallback: string): Error {
  if (error.code === '23503') {
    return new EntityInUseError('Region', fallback, '仍有地點或行程使用此地圖。')
  }

  if (error.code === '42501') {
    return new ValidationError('目前沒有權限執行此操作。')
  }

  return new Error(error.message)
}

export class SupabaseRegionRepository {
  async prepareOsmRegion(dataset: OsmDatasetId = 'okinawa'): Promise<void> {
    const owner = await requireAuthenticatedUserId()
    const id = await accountOsmRegionId(owner, dataset)
    const { error } = await withTimeout(Promise.resolve(
      supabase.from('regions').upsert({
        id, owner_uid: owner, ...toSupabaseRegionInput(osmRegion(dataset)),
      }, { onConflict: 'id', ignoreDuplicates: true }),
    ), 'prepare OSM region')
    if (error) throw mapSupabaseError(error, id)
  }

  async create(input: NewRegion): Promise<string> {
    validateRegion(input)
    const regionId = crypto.randomUUID()

    const { data, error } = await withTimeout(
      Promise.resolve(
        supabase
          .from('regions')
          .insert({ id: regionId, ...toSupabaseRegionInput(input) })
          .select('id')
          .single(),
      ),
      'create region',
    )

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

    const { error } = await withTimeout(
      Promise.resolve(
        supabase
          .from('regions')
          .update(toSupabaseRegionInput(next))
          .eq('id', id),
      ),
      'update region',
    )

    if (error) throw mapSupabaseError(error, id)
  }

  async delete(id: string): Promise<void> {
    const current = await this.getById(id)
    if (!current) {
      throw new EntityNotFoundError('Region', id)
    }

    const { error } = await withTimeout(
      Promise.resolve(supabase.from('regions').delete().eq('id', id)),
      'delete region',
    )
    if (error) throw mapSupabaseError(error, id)
  }

  async getById(id: string): Promise<Region | undefined> {
    const { data, error } = await withTimeout(
      Promise.resolve(
        supabase
          .from('regions')
          .select('*')
          .eq('id', id)
          .maybeSingle<SupabaseRegionRow>(),
      ),
      'get region',
    )

    if (error) throw mapSupabaseError(error, id)
    return data ? normalizeRegion(data) : undefined
  }

  async list(): Promise<Region[]> {
    const { data, error } = await withTimeout(
      Promise.resolve(
        supabase
          .from('regions')
          .select('*')
          .order('name', { ascending: true })
          .returns<SupabaseRegionRow[]>(),
      ),
      'list regions',
    )

    if (error) throw mapSupabaseError(error, 'list')
    return (data ?? []).map(normalizeRegion)
  }
}

export const supabaseRegions = new SupabaseRegionRepository()