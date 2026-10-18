import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import baseline from '../../supabase/migrations/20261017153621_repository_baseline.sql?raw'
import syncMigration from '../../supabase/migrations/20261017153641_local_first_sync.sql?raw'
import distanceMigration from '../../supabase/migrations/20261018220000_itinerary_travel_distance.sql?raw'
import routeMapsMigration from '../../supabase/migrations/20261019010000_route_maps.sql?raw'

const db = new PGlite()
const member = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const admin = '33333333-3333-4333-8333-333333333333'
const basic = '44444444-4444-4444-8444-444444444444'

async function asUser<Result>(uid: string, work: () => Promise<Result>): Promise<Result> {
  await db.exec('begin; set local role authenticated;')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid])
  try {
    const result = await work()
    await db.exec('commit')
    return result
  } catch (error) {
    await db.exec('rollback')
    throw error
  }
}

async function rpc(name: string, args: unknown[] = []) {
  const parameters = args.map((_, index) => `$${index + 1}`).join(',')
  const result = await db.query<{ result: Record<string, unknown> }>(`select public.${name}(${parameters}) as result`, args)
  return result.rows[0].result
}

function task(uid: string, changes: unknown[]) {
  return {
    protocolVersion: 1,
    operationId: crypto.randomUUID(),
    account: { userId: uid },
    changes,
  }
}

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `)
  await db.exec(baseline.replace('create extension if not exists pgcrypto;', ''))
  await db.exec(`
    insert into auth.users values
      ('${member}','member@example.com'),('${other}','other@example.com'),
      ('${admin}','admin@example.com'),('${basic}','basic@example.com');
    update public.user_roles set role='member' where user_id in ('${member}','${other}');
    update public.user_roles set role='admin' where user_id='${admin}';
  `)
  await db.exec(syncMigration)
  await db.exec(distanceMigration)
  await db.exec(routeMapsMigration)
}, 120000)

afterAll(async () => { await db.close() })

describe('route-map cloud persistence migration', () => {
  it('persists maps and markers through sync, enforces owner access, and cascades trip deletion', async () => {
    const regionId = crypto.randomUUID()
    const tripId = crypto.randomUUID()
    const mapId = crypto.randomUUID()
    const markerId = crypto.randomUUID()
    const originGooglePlaceId = 'origin-google-id'
    const destinationGooglePlaceId = 'destination-google-id'
    let mapVersion = ''

    await asUser(member, async () => {
      await db.query(
        'insert into public.regions(id,name,google_place_id,zoom) values($1,$2,$3,12)',
        [regionId, 'Route region', 'route-region'],
      )
      await db.query(
        "insert into public.trips(id,region_id,name,start_date,end_date) values($1,$2,'Route trip','2026-10-19','2026-10-20')",
        [tripId, regionId],
      )
      const applied = await rpc('app_sync_push', [task(member, [
        {
          entity: 'routeMaps',
          id: mapId,
          kind: 'put',
          baseVersion: null,
          after: {
            id: mapId,
            name: 'Morning walk',
            tripId,
            selectedDate: '2026-10-24',
            originGooglePlaceId,
            destinationGooglePlaceId,
            transport: 'WALKING',
          },
        },
        {
          entity: 'routeMapPlaces',
          id: markerId,
          kind: 'put',
          baseVersion: null,
          after: { id: markerId, routeMapId: mapId, googlePlaceId: 'marker-google-id', name: 'User label' },
        },
      ])])
      expect(applied.status).toBe('applied')
      expect((await db.query<{ owner_uid: string; name: string }>(
        'select owner_uid,name from public.route_maps where id=$1', [mapId],
      )).rows[0]).toEqual({ owner_uid: member, name: 'Morning walk' })
      expect((await db.query('select * from public.route_map_places where id=$1', [markerId])).rows).toHaveLength(1)

      const snapshot = await rpc('app_sync_snapshot')
      const snapshotRecords = snapshot.records as Array<{ entity: string; id: string; version: string; record: Record<string, unknown> }>
      expect(snapshotRecords).toContainEqual(expect.objectContaining({
        entity: 'routeMaps',
        id: mapId,
        record: expect.objectContaining({
          id: mapId,
          tripId,
          selectedDate: '2026-10-24',
          originGooglePlaceId,
          destinationGooglePlaceId,
          transport: 'WALKING',
        }),
      }))
      expect(snapshotRecords).toContainEqual(expect.objectContaining({
        entity: 'routeMapPlaces',
        id: markerId,
        record: { id: markerId, routeMapId: mapId, googlePlaceId: 'marker-google-id', name: 'User label' },
      }))
      const mapSnapshot = snapshotRecords.find((record) => record.entity === 'routeMaps' && record.id === mapId)!
      mapVersion = mapSnapshot.version
    })

    await expect(asUser(member, () => rpc('app_sync_push', [task(member, [{
      entity: 'routeMaps',
      id: mapId,
      kind: 'put',
      baseVersion: mapVersion,
      after: {
        id: mapId,
        name: 'Morning walk',
        tripId,
        selectedDate: '2026-10-24',
        originGooglePlaceId,
        destinationGooglePlaceId,
        transport: 'WALKING',
        distanceMeters: 500,
      },
    }])]))).rejects.toThrow('authorization fields')
    await expect(asUser(member, () => db.query(
      "insert into public.route_maps(name,trip_id,transport) values('Duplicate trip map',$1,'DRIVING')", [tripId],
    ))).rejects.toThrow()
    await expect(asUser(member, () => db.query(
      "insert into public.route_maps(name,transport,origin_google_place_id,destination_google_place_id) values('Invalid endpoints','DRIVING','same','same')",
    ))).rejects.toThrow()
    await expect(asUser(member, () => db.query(
      "insert into public.route_map_places(route_map_id,google_place_id) values($1,'marker-google-id')", [mapId],
    ))).rejects.toThrow()

    await asUser(other, async () => {
      expect((await db.query('select * from public.route_maps')).rows).toHaveLength(0)
      expect((await db.query('select * from public.route_map_places')).rows).toHaveLength(0)
      const inserted = await db.query("insert into public.route_maps(name,transport) values('Other map','DRIVING') returning owner_uid")
      expect((inserted.rows[0] as { owner_uid: string }).owner_uid).toBe(other)
    })
    await asUser(admin, async () => {
      expect((await db.query('select id from public.route_maps where id=$1', [mapId])).rows).toHaveLength(1)
      await expect(db.query('update public.route_maps set owner_uid=$1 where id=$2', [other, mapId]))
        .rejects.toThrow('Changing a record owner is not supported')
    })
    await expect(asUser(basic, () => db.query("insert into public.route_maps(name,transport) values('Denied','DRIVING')")))
      .rejects.toThrow()
    await db.exec('begin; set local role anon;')
    try {
      await expect(db.query('select * from public.route_maps')).rejects.toThrow()
      await expect(rpc('app_sync_snapshot')).rejects.toThrow()
    } finally {
      await db.exec('rollback')
    }

    await asUser(member, async () => {
      await db.query('delete from public.trips where id=$1', [tripId])
      expect((await db.query('select id from public.route_maps where id=$1', [mapId])).rows).toEqual([])
      expect((await db.query('select id from public.route_map_places where id=$1', [markerId])).rows).toEqual([])
      const afterDelete = await rpc('app_sync_snapshot')
      expect(afterDelete.records).not.toContainEqual(expect.objectContaining({ id: mapId }))
      const pulled = await rpc('app_sync_pull', ['0', 500])
      expect((pulled.changes as Array<{ entity: string; id: string; record: unknown }>).some(
        (change) => change.entity === 'routeMaps' && change.id === mapId && change.record === null,
      )).toBe(true)
      expect((pulled.changes as Array<{ entity: string; id: string; record: unknown }>).some(
        (change) => change.entity === 'routeMapPlaces' && change.id === markerId && change.record === null,
      )).toBe(true)
    })
  })

  it('replaces route maps atomically with remapped IDs and supports old v1 backups', async () => {
    const sourceRegionId = crypto.randomUUID()
    const sourceTripId = crypto.randomUUID()
    const sourceMapId = crypto.randomUUID()
    const sourceMarkerId = crypto.randomUUID()
    const backup = {
      format: 'travel-planner-backup',
      version: 2,
      exportedAt: '2026-10-19T00:00:00.000Z',
      data: {
        regions: [{ id: sourceRegionId, name: 'Backup region', zoom: 12, googlePlaceId: 'backup-region' }],
        places: [],
        labels: [],
        trips: [{
          id: sourceTripId,
          regionId: sourceRegionId,
          name: 'Backup trip',
          startDate: '2026-10-19',
          endDate: '2026-10-20',
        }],
        itineraryItems: [],
        routeMaps: [{
          id: sourceMapId,
          name: 'Independent route',
          tripId: sourceTripId,
          selectedDate: '2026-11-01',
          originGooglePlaceId: 'backup-origin',
          destinationGooglePlaceId: 'backup-destination',
          transport: 'TWO_WHEELER',
        }],
        routeMapPlaces: [{
          id: sourceMarkerId,
          routeMapId: sourceMapId,
          googlePlaceId: 'backup-marker',
          name: 'Backup stop',
        }],
      },
    }

    const preview = await asUser(other, () => rpc('app_backup_preview_replace', [backup]))
    expect(preview.incoming).toMatchObject({ routeMaps: 1, routeMapPlaces: 1 })
    const replacedCounts = await asUser(other, () => rpc('app_backup_apply_replace', [backup, preview.token]))
    expect(replacedCounts).toMatchObject({ routeMaps: 1, routeMapPlaces: 1 })
    const restored = await asUser(other, async () => {
      const routeMap = (await db.query<{ id: string; trip_id: string; selected_date: Date; transport: string }>(
        'select id,trip_id,selected_date,transport from public.route_maps',
      )).rows[0]
      const marker = (await db.query<{ id: string; route_map_id: string }>(
        'select id,route_map_id from public.route_map_places',
      )).rows[0]
      return { routeMap, marker }
    })
    expect(restored.routeMap.selected_date).toEqual(new Date('2026-11-01T00:00:00.000Z'))
    expect(restored.routeMap.transport).toBe('TWO_WHEELER')
    expect(restored.routeMap.id).not.toBe(sourceMapId)
    expect(restored.routeMap.trip_id).not.toBe(sourceTripId)
    expect(restored.marker.id).not.toBe(sourceMarkerId)
    expect(restored.marker.route_map_id).toBe(restored.routeMap.id)

    const invalidBackup = {
      ...backup,
      data: {
        ...backup.data,
        routeMaps: [{ ...backup.data.routeMaps[0], tripId: crypto.randomUUID() }],
      },
    }
    await expect(asUser(other, () => rpc('app_backup_preview_replace', [invalidBackup])))
      .rejects.toThrow('Backup route maps reference a missing trip')
    expect((await asUser(other, () => db.query('select id from public.route_maps'))).rows).toHaveLength(1)

    const legacyBackup = {
      format: 'travel-planner-backup',
      version: 1,
      exportedAt: '2026-10-19T00:00:00.000Z',
      data: { regions: [], places: [], labels: [], trips: [], itineraryItems: [] },
    }
    await expect(asUser(other, () => rpc('app_backup_preview_replace', [legacyBackup])))
      .rejects.toThrow('Version 1 backup cannot replace an account with route maps')
    expect((await asUser(other, () => db.query('select id from public.route_maps'))).rows).toHaveLength(1)

    const emptyV2 = {
      ...legacyBackup,
      version: 2,
      data: { ...legacyBackup.data, routeMaps: [], routeMapPlaces: [] },
    }
    const emptyPreview = await asUser(other, () => rpc('app_backup_preview_replace', [emptyV2]))
    await asUser(other, () => rpc('app_backup_apply_replace', [emptyV2, emptyPreview.token]))
    const legacyPreview = await asUser(admin, () => rpc('app_backup_preview_replace', [legacyBackup]))
    expect(legacyPreview.incoming).toMatchObject({ routeMaps: 0, routeMapPlaces: 0 })
    const legacyCounts = await asUser(admin, () => rpc('app_backup_apply_replace', [legacyBackup, legacyPreview.token]))
    expect(legacyCounts).toMatchObject({ routeMaps: 0, routeMapPlaces: 0 })
    await expect(asUser(other, () => rpc('app_backup_assert_payload', [{
      ...legacyBackup,
      data: { ...legacyBackup.data, routeMaps: [] },
    }]))).rejects.toThrow('Version 1 backup cannot contain route-map fields')
  })

  it('rejects derived Google data and clears maps in the full account backup transaction', async () => {
    const regionId = crypto.randomUUID()
    const mapId = crypto.randomUUID()
    const payload = {
      format: 'travel-planner-backup',
      version: 2,
      exportedAt: '2026-10-19T00:00:00.000Z',
      data: {
        regions: [{ id: regionId, name: 'Clear region', zoom: 12, googlePlaceId: 'clear-region' }],
        places: [],
        labels: [],
        trips: [],
        itineraryItems: [],
        routeMaps: [{
          id: mapId,
          name: 'Clear route',
          transport: 'DRIVING',
          originGooglePlaceId: 'clear-origin',
          destinationGooglePlaceId: 'clear-destination',
        }],
        routeMapPlaces: [],
      },
    }
    await expect(asUser(member, () => rpc('app_backup_assert_payload', [{
      ...payload,
      data: { ...payload.data, routeMaps: [{ ...payload.data.routeMaps[0], distanceMeters: 1000 }] },
    }]))).rejects.toThrow('unsupported fields')
    await expect(asUser(member, () => rpc('app_backup_assert_payload', [{
      ...payload,
      data: { ...payload.data, routeMaps: [{ ...payload.data.routeMaps[0], name: '   ' }] },
    }]))).rejects.toThrow('invalid or missing fields')
    await expect(asUser(member, () => rpc('app_backup_assert_payload', [{
      ...payload,
      data: { ...payload.data, routeMaps: [payload.data.routeMaps[0], payload.data.routeMaps[0]] },
    }]))).rejects.toThrow('duplicate route-map IDs')
    await expect(asUser(member, () => rpc('app_backup_assert_payload', [{
      ...payload,
      data: {
        ...payload.data,
        routeMaps: [{ ...payload.data.routeMaps[0], tripId: crypto.randomUUID() }],
      },
    }]))).rejects.toThrow('reference a missing trip')
    await expect(asUser(member, () => rpc('app_backup_assert_payload', [{
      ...payload,
      data: {
        ...payload.data,
        routeMapPlaces: [
          { id: crypto.randomUUID(), routeMapId: mapId, googlePlaceId: 'duplicate-marker' },
          { id: crypto.randomUUID(), routeMapId: mapId, googlePlaceId: 'duplicate-marker' },
        ],
      },
    }]))).rejects.toThrow('duplicate Google places')

    const preview = await asUser(member, () => rpc('app_backup_preview_replace', [payload]))
    await asUser(member, () => rpc('app_backup_apply_replace', [payload, preview.token]))
    const clearPreview = await asUser(member, () => rpc('app_backup_preview_clear'))
    expect(clearPreview.current).toMatchObject({ routeMaps: 1, routeMapPlaces: 0 })
    const cleared = await asUser(member, () => rpc('app_backup_apply_clear', [clearPreview.token]))
    expect(cleared).toMatchObject({ routeMaps: 1, routeMapPlaces: 0 })
    expect((await asUser(member, () => db.query('select id from public.route_maps'))).rows).toEqual([])
  })
})
