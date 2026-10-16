import schemaSql from '../../docs/supabase-schema-from-indexeddb.sql?raw'
import rolesSql from '../../docs/supabase-basic-role-rls.sql?raw'
import isolationSql from '../../docs/supabase-owner-isolation.sql?raw'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const admin = '33333333-3333-4333-8333-333333333333'
const basic = '44444444-4444-4444-8444-444444444444'
const region = '51111111-1111-4111-8111-111111111111'
const place = '61111111-1111-4111-8111-111111111111'
const trip = '71111111-1111-4111-8111-111111111111'
const label = '81111111-1111-4111-8111-111111111111'
const db = new PGlite()
const sqlFiles: Record<string, string> = {
  'supabase-schema-from-indexeddb.sql': schemaSql,
  'supabase-basic-role-rls.sql': rolesSql,
  'supabase-owner-isolation.sql': isolationSql,
}
const sql = (name: string) => sqlFiles[name]

// Each simulated authenticated API call runs in a rollback-only transaction.
async function asUser<T>(uid: string, operation: () => Promise<T>): Promise<T> {
  await db.exec('begin; set local role authenticated;')
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid])
  try {
    return await operation()
  } finally {
    await db.exec('rollback')
  }
}

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `)
  // PGlite provides gen_random_uuid natively but does not ship pgcrypto.
  await db.exec(sql('supabase-schema-from-indexeddb.sql').replace('create extension if not exists pgcrypto;', ''))
  await db.exec(`
    insert into auth.users values ('${owner}', 'tanguitar8093@gmail.com'), ('${other}', 'other@example.com'), ('${admin}', 'admin@example.com'), ('${basic}', 'basic@example.com');
    insert into public.regions(id,name,google_place_id,zoom) values ('${region}','Legacy region','google-region',10);
    insert into public.places(id,name,maps_url) values ('${place}','Legacy place','https://example.com');
    insert into public.labels(id,name,color) values ('${label}','Legacy label','#fff');
    insert into public.trips(id,region_id,name,start_date,end_date,owner_uid) values ('${trip}','${region}','Legacy trip','2026-10-16','2026-10-17','${owner}');
    insert into public.place_regions(place_id,region_id) values ('${place}','${region}');
    insert into public.place_labels(place_id,label_id) values ('${place}','${label}');
    insert into public.itinerary_items(trip_id,place_id,date,sort_order) values ('${trip}','${place}','2026-10-16',0);
  `)
  await db.exec(sql('supabase-basic-role-rls.sql'))
  await db.exec(`update public.user_roles set role = 'admin' where user_id = '${admin}'; update public.user_roles set role = 'basic' where user_id = '${basic}';`)
  await db.exec(sql('supabase-owner-isolation.sql'))
}, 30000)

afterAll(async () => { await db.close() })

describe('database owner isolation (real PostgreSQL RLS)', () => {
  it('backfills legacy and derived owners without changing trip ownership', async () => {
    for (const table of ['regions', 'places', 'labels', 'trips', 'place_regions', 'place_labels', 'itinerary_items']) {
      expect((await db.query<{ owner_uid: string }>(`select owner_uid from public.${table}`)).rows).toEqual([{ owner_uid: owner }])
    }
  })

  it('members can read their own complete data; another member and basic cannot', async () => {
    for (const uid of [owner, other, basic, admin]) {
      await asUser(uid, async () => {
        for (const table of ['regions', 'places', 'labels', 'trips', 'place_regions', 'place_labels', 'itinerary_items']) {
          const result = await db.query(`select * from public.${table}`)
          expect(result.rows.length).toBe(uid === owner || uid === admin ? 1 : 0)
        }
      })
    }
  })

  it('members cannot update or delete another account even with unfiltered queries', async () => {
    await asUser(other, async () => {
      for (const table of ['regions', 'places', 'labels', 'trips']) {
        expect((await db.query(`update public.${table} set name = 'intrusion' returning id`)).rows).toHaveLength(0)
      }
      for (const table of ['place_regions', 'place_labels', 'itinerary_items', 'trips', 'places', 'labels', 'regions']) {
        expect((await db.query(`delete from public.${table} returning *`)).rows).toHaveLength(0)
      }
    })
  })

  it('creates new private data with database-assigned owner', async () => {
    await asUser(other, async () => {
      const result = await db.query<{ owner_uid: string }>("insert into public.regions(name,google_place_id,zoom) values ('Mine','my-region',10) returning owner_uid")
      expect(result.rows[0].owner_uid).toBe(other)
      expect((await db.query("update public.regions set name = 'Updated' returning id")).rows).toHaveLength(1)
      expect((await db.query('delete from public.regions returning id')).rows).toHaveLength(1)
    })
  })

  it('owners can create a complete connected itinerary and delete it', async () => {
    await asUser(other, async () => {
      const r = (await db.query<{ id: string }>("insert into public.regions(name,google_place_id,zoom) values ('Own','own',10) returning id")).rows[0].id
      const p = (await db.query<{ id: string }>("insert into public.places(name,maps_url) values ('Own','https://example.com') returning id")).rows[0].id
      const l = (await db.query<{ id: string }>("insert into public.labels(name,color) values ('Own','#fff') returning id")).rows[0].id
      const t = (await db.query<{ id: string }>("insert into public.trips(region_id,name,start_date,end_date) values ($1,'Own','2026-10-16','2026-10-17') returning id", [r])).rows[0].id
      await db.query('insert into public.place_regions(place_id,region_id) values ($1,$2)', [p,r])
      await db.query('insert into public.place_labels(place_id,label_id) values ($1,$2)', [p,l])
      await db.query("insert into public.itinerary_items(trip_id,place_id,date,sort_order) values ($1,$2,'2026-10-16',0)", [t,p])
      expect((await db.query('select * from public.itinerary_items')).rows).toHaveLength(1)
      await db.query('delete from public.trips where id = $1', [t])
      expect((await db.query('select * from public.itinerary_items')).rows).toHaveLength(0)
      await db.query('delete from public.places where id = $1', [p])
      expect((await db.query('select * from public.place_regions')).rows).toHaveLength(0)
      expect((await db.query('select * from public.place_labels')).rows).toHaveLength(0)
      await db.query('delete from public.labels where id = $1', [l])
      await db.query('delete from public.regions where id = $1', [r])
    })
  })

  it('admin can delete another owner’s complete graph', async () => {
    await asUser(admin, async () => {
      for (const table of ['trips', 'places', 'labels', 'regions']) {
        expect((await db.query(`delete from public.${table} returning id`)).rows).toHaveLength(1)
      }
    })
  })

  it('rejects forged owner, role escalation, and basic writes', async () => {
    await expect(asUser(other, () => db.exec(`insert into public.regions(name,google_place_id,zoom,owner_uid) values ('Forged','forged',10,'${owner}')`))).rejects.toThrow(/row-level security/)
    await asUser(other, async () => {
      expect((await db.query("update public.user_roles set role = 'admin' returning user_id")).rows).toHaveLength(0)
    })
    await expect(asUser(basic, () => db.exec("insert into public.regions(name,google_place_id,zoom) values ('Blocked','blocked',10)"))).rejects.toThrow(/row-level security/)
  })

  it('prevents cross-owner references through direct APIs', async () => {
    const attacks = [
      `insert into public.trips(region_id,name,start_date,end_date,owner_uid) values ('${region}','Attack','2026-10-16','2026-10-17','${other}')`,
      `insert into public.labels(name,color,parent_id) values ('Attack','#fff','${label}')`,
      `insert into public.place_regions(place_id,region_id) values ('${place}','${region}')`,
      `insert into public.place_labels(place_id,label_id) values ('${place}','${label}')`,
      `insert into public.itinerary_items(trip_id,place_id,date,sort_order) values ('${trip}','${place}','2026-10-16',1)`,
    ]
    for (const attack of attacks) await expect(asUser(other, () => db.exec(attack))).rejects.toThrow()
    // Admin may manage all owners, but cannot create dependencies across them.
    await expect(asUser(admin, () => db.exec(attacks[0]))).rejects.toThrow(/foreign key/)
  })

  it('admin can edit all data and manage ACL, but owner changes are forbidden', async () => {
    await asUser(admin, async () => {
      for (const table of ['regions', 'places', 'labels', 'trips']) {
        expect((await db.query(`update public.${table} set name = 'Admin update' returning id`)).rows).toHaveLength(1)
      }
      await db.exec(`update public.trips set edit_mode = 'shared', editor_uids = array['${other}'::uuid]`)
      expect((await db.query('select public.can_edit_trip($1) as allowed', [trip])).rows).toEqual([{ allowed: true }])
    })
    await expect(asUser(admin, () => db.exec(`update public.regions set owner_uid = '${other}'`))).rejects.toThrow(/owner/)
  })

  it('stored collaborator ACL does not bypass phase-one private isolation', async () => {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner])
    await db.exec(`update public.trips set edit_mode = 'shared', editor_uids = array['${other}'::uuid]`)
    await db.query("select set_config('request.jwt.claim.sub', '', false)")
    await asUser(other, async () => {
      expect((await db.query('select * from public.trips')).rows).toHaveLength(0)
      expect((await db.query('select public.can_edit_trip($1) as allowed', [trip])).rows).toEqual([{ allowed: false }])
    })
  })

  it('migration and earlier bootstraps can be rerun without reopening member access', async () => {
    await db.exec(sql('supabase-owner-isolation.sql'))
    await db.exec(sql('supabase-schema-from-indexeddb.sql').replace('create extension if not exists pgcrypto;', ''))
    await db.exec(sql('supabase-basic-role-rls.sql'))
    await asUser(other, async () => {
      expect((await db.query('select * from public.trips')).rows).toHaveLength(0)
      expect((await db.query('select * from public.places')).rows).toHaveLength(0)
    })
    await asUser(admin, async () => {
      await db.exec("update public.trips set editor_uids = '{}'::uuid[]")
    })
  })
})
