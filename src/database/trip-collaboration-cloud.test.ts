import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import baseline from '../../supabase/migrations/20261017153621_repository_baseline.sql?raw'
import syncMigration from '../../supabase/migrations/20261017153641_local_first_sync.sql?raw'
import distanceMigration from '../../supabase/migrations/20261018220000_itinerary_travel_distance.sql?raw'
import routeMapsMigration from '../../supabase/migrations/20261019010000_route_maps.sql?raw'
import collaborationMigration from '../../supabase/migrations/20261019060000_trip_collaboration.sql?raw'

const db = new PGlite()
const owner = '11111111-1111-4111-8111-111111111111'
const editor = '22222222-2222-4222-8222-222222222222'
const viewer = '33333333-3333-4333-8333-333333333333'
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

async function rpc<T extends Record<string, unknown>>(name: string, args: unknown[] = []): Promise<T> {
  const parameters = args.map((_, index) => `$${index + 1}`).join(',')
  const result = await db.query<{ result: T }>(`select public.${name}(${parameters}) as result`, args)
  return result.rows[0].result
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
      ('${owner}','owner@example.com'),('${editor}','editor@example.com'),
      ('${viewer}','viewer@example.com'),('${basic}','basic@example.com');
    update public.user_roles set role='member' where user_id in ('${owner}','${editor}','${viewer}');
    update public.user_roles set role='basic' where user_id='${basic}';
  `)
  await db.exec(syncMigration)
  await db.exec(distanceMigration)
  await db.exec(routeMapsMigration)
  await db.exec(collaborationMigration)
}, 120000)

afterAll(async () => { await db.close() })

describe('trip collaboration migration foundation', () => {
  it('keeps owner data and projects only scoped shared fields', async () => {
    const regionId = crypto.randomUUID()
    const tripId = crypto.randomUUID()
    const placeId = crypto.randomUUID()
    await asUser(owner, async () => {
      await db.query('insert into public.regions(id,name,google_place_id,zoom) values($1,$2,$3,12)', [regionId, 'Shared region', 'region-google'])
      await db.query(
        "insert into public.places(id,name,google_place_id,maps_url,notes,owner_uid) values($1,'Secret place',$2,$3,$4,$5)",
        [placeId, 'place-google', 'https://maps.example/secret', 'private-note', owner],
      )
      await db.query(
        "insert into public.trips(id,region_id,name,start_date,end_date,owner_uid) values($1,$2,$3,'2026-10-20','2026-10-21',$4)",
        [tripId, regionId, 'Shared trip', owner],
      )
      await db.query(
        "insert into public.itinerary_items(id,trip_id,place_id,date,sort_order,note,owner_uid) values($1,$2,$3,'2026-10-20',0,'trip-note',$4)",
        [crypto.randomUUID(), tripId, placeId, owner],
      )
      const details = await rpc<{ places: Array<Record<string, unknown>>; items: Array<Record<string, unknown>> }>(
        'app_trip_collaboration', ['details', tripId, {}],
      )
      const places = details.places as Array<Record<string, unknown>>
      expect(places[0]).toEqual(expect.objectContaining({
        id: placeId,
        name: 'Secret place',
        googlePlaceId: 'place-google',
        mapsUrl: 'https://maps.example/secret',
      }))
      expect(places[0]).not.toHaveProperty('notes')
      expect(details.items[0]).not.toHaveProperty('note')
    })
  })

  it('handles invite accept revoke flow and membership permissions', async () => {
    const regionId = crypto.randomUUID()
    const tripId = crypto.randomUUID()
    let invitationId = ''
    await asUser(owner, async () => {
      await db.query('insert into public.regions(id,name,google_place_id,zoom) values($1,$2,$3,12)', [regionId, 'Flow region', 'flow-google'])
      await db.query(
        "insert into public.trips(id,region_id,name,start_date,end_date,owner_uid) values($1,$2,$3,'2026-10-20','2026-10-21',$4)",
        [tripId, regionId, 'Flow trip', owner],
      )
      const invited = await rpc<{ invitationId: string }>('app_trip_collaboration', ['invite', tripId, { inviteeUserId: editor, role: 'editor' }])
      invitationId = invited.invitationId as string
      expect(typeof invitationId).toBe('string')
      const tripRow = await db.query<{ edit_mode: string }>('select edit_mode from public.trips where id=$1', [tripId])
      expect(tripRow.rows[0].edit_mode).toBe('shared')
    })
    await asUser(editor, async () => {
      const list = await rpc<{ invitations: Array<{ id: string }> }>('app_trip_collaboration', ['list', null, {}])
      expect(list.invitations[0].id).toBe(invitationId)
      await rpc('app_trip_collaboration', ['accept', tripId, { invitationId }])
      const details = await rpc<{ trip: { access: string } }>('app_trip_collaboration', ['details', tripId, {}])
      expect(details.trip.access).toBe('editor')
    })
    await asUser(owner, async () => {
      const details = await rpc<{ members: Array<{ userId: string; role: string }> }>('app_trip_collaboration', ['details', tripId, {}])
      expect(details.members).toEqual(expect.arrayContaining([expect.objectContaining({ userId: editor, role: 'editor' })]))
    })
    await asUser(viewer, async () => {
      await expect(rpc('app_trip_collaboration', ['details', tripId, {}])).rejects.toThrow('Trip unavailable')
    })
    await asUser(owner, async () => {
      await rpc('app_trip_collaboration', ['remove_member', tripId, { userId: editor }])
      const details = await rpc<{ members: Array<{ userId: string }> }>('app_trip_collaboration', ['details', tripId, {}])
      expect(details.members.find((member) => member.userId === editor)).toBeUndefined()
    })
  })

  it('denies basic users and blocks non-managers from changing ACL', async () => {
    const regionId = crypto.randomUUID()
    const tripId = crypto.randomUUID()
    let invitationId = ''
    await asUser(owner, async () => {
      await db.query('insert into public.regions(id,name,google_place_id,zoom) values($1,$2,$3,12)', [regionId, 'Denied region', 'denied-google'])
      await db.query(
        "insert into public.trips(id,region_id,name,start_date,end_date,owner_uid) values($1,$2,$3,'2026-10-20','2026-10-21',$4)",
        [tripId, regionId, 'Denied trip', owner],
      )
      const invited = await rpc<{ invitationId: string }>('app_trip_collaboration', ['invite', tripId, { inviteeUserId: viewer, role: 'viewer' }])
      invitationId = invited.invitationId as string
    })
    await asUser(viewer, async () => {
      await rpc('app_trip_collaboration', ['accept', tripId, { invitationId }])
      await expect(rpc('app_trip_collaboration', ['invite', tripId, { inviteeUserId: editor, role: 'viewer' }])).rejects.toThrow('Only owner or admin')
    })
    await asUser(basic, async () => {
      await expect(rpc('app_trip_collaboration', ['list', null, {}])).rejects.toThrow('requires member or admin access')
    })
  })
})
