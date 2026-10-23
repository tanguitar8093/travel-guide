import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { accountOsmRegionId } from '../geo/osm-coverage'

const sql = new PGlite()
const migrations = import.meta.glob<string>('../../supabase/migrations/*.sql', { eager: true, query: '?raw', import: 'default' })
const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'
const basic = '33333333-3333-4333-8333-333333333333'

async function asUser<T>(uid: string, work: () => Promise<T>) {
  await sql.exec('begin; set local role authenticated')
  await sql.query("select set_config('request.jwt.claim.sub',$1,true)", [uid])
  try { const result = await work(); await sql.exec('commit'); return result }
  catch (error) { await sql.exec('rollback'); throw error }
}
async function create(uid = first, id = crypto.randomUUID(), name = '海中道路', lat = 26.3316539, lng = 127.927996) {
  return asUser(uid, async () => (await sql.query<{ result: { status: string; placeId: string; regionId?: string; reason?: string } }>(
    'select public.app_import_place($1,$2,$3,$4) as result', [name, lat, lng, id],
  )).rows[0].result)
}

beforeAll(async () => {
  await sql.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role supabase_admin;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`)
  for (const path of Object.keys(migrations).sort()) await sql.exec(migrations[path].replace('create extension if not exists pgcrypto;', ''))
  await sql.exec(`insert into auth.users values ('${first}','first@test.invalid'),('${second}','second@test.invalid'),('${basic}','basic@test.invalid');
    update public.user_roles set role='member' where user_id in ('${first}','${second}');`)
}, 120000)
afterAll(async () => sql.close())

it('creates a coordinate-only place in the same default region and exposes it through existing sync', async () => {
  const result = await create()
  expect(result.status).toBe('created')
  expect(result.regionId).toBe(await accountOsmRegionId(first))
  const record = (await sql.query<{ owner_uid: string; google_place_id: null; location: unknown }>('select owner_uid,google_place_id,location from public.places where id=$1', [result.placeId])).rows[0]
  expect(record).toMatchObject({ owner_uid: first, google_place_id: null, location: { coordinate: { latitude: 26.3316539, longitude: 127.927996 } } })
  const snapshot = await asUser(first, async () => (await sql.query<{ data: { records: { id: string }[] } }>('select public.app_sync_snapshot() as data')).rows[0].data)
  expect(snapshot.records.some(record => record.id === result.placeId)).toBe(true)
})

it('retries the same operation without adding a record and detects nearby and same-name duplicates', async () => {
  const id = crypto.randomUUID()
  expect((await create(first, id, '新地點', 26.5, 128)).status).toBe('created')
  expect((await create(first, id, '新地點', 26.5, 128)).status).toBe('already_imported')
  await expect(create(first, id, 'different', 26.5, 128)).rejects.toThrow('操作識別碼')
  expect(await create(first, crypto.randomUUID(), '附近', 26.50001, 128)).toMatchObject({ status: 'duplicate', placeId: id, reason: 'nearby' })
  expect(await create(first, crypto.randomUUID(), '新地點', 26.7, 128)).toMatchObject({ status: 'duplicate', placeId: id, reason: 'name' })
})

it('isolates accounts, denies basic/anonymous access, and validates range and name', async () => {
  expect((await create(second)).status).toBe('created')
  await expect(create(basic)).rejects.toThrow('已開通')
  await expect(create('', crypto.randomUUID())).rejects.toThrow('已開通')
  await expect(create(first, crypto.randomUUID(), '', 26.4, 128)).rejects.toThrow('有效')
  await expect(create(first, crypto.randomUUID(), '台北', 25.03, 121.56)).rejects.toThrow('沖繩')
  const permission = (await sql.query<{ allowed: boolean }>("select has_function_privilege('anon','public.app_import_place(text,double precision,double precision,uuid,text)','EXECUTE') as allowed")).rows[0]
  expect(permission.allowed).toBe(false)
})
