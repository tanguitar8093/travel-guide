import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const migration = readFileSync(new URL('../../supabase/migrations/20261024093915_google_auth_member_role.sql', import.meta.url), 'utf8')

it('assigns Google members on signup/login, backfills existing accounts, and preserves admins and email defaults', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}', last_sign_in_at timestamptz);
      create table public.user_roles(user_id uuid primary key references auth.users, role text not null);
      insert into auth.users(id,raw_app_meta_data) values
        ('00000000-0000-4000-8000-000000000001','{"provider":"google"}'),
        ('00000000-0000-4000-8000-000000000002','{"provider":"google"}');
      insert into public.user_roles values
        ('00000000-0000-4000-8000-000000000001','basic'),
        ('00000000-0000-4000-8000-000000000002','admin');`)
    await db.exec(migration)
    await db.exec(`create trigger signup after insert on auth.users for each row execute function public.handle_new_auth_user_role();`)
    const role = async (id: string) => (await db.query<{ role: string }>('select role from public.user_roles where user_id=$1', [id])).rows[0]?.role
    expect(await role('00000000-0000-4000-8000-000000000001')).toBe('member')
    expect(await role('00000000-0000-4000-8000-000000000002')).toBe('admin')
    const google = crypto.randomUUID()
    const email = crypto.randomUUID()
    await db.query('insert into auth.users(id,raw_app_meta_data) values ($1,$2)', [google, { provider: 'google' }])
    await db.query('insert into auth.users(id,raw_user_meta_data) values ($1,$2)', [email, { provider: 'google', role: 'member' }])
    expect(await role(google)).toBe('member')
    expect(await role(email)).toBe('basic')
    await db.query("update public.user_roles set role='basic' where user_id=$1", [google])
    await db.query('update auth.users set last_sign_in_at=now() where id=$1', [google])
    expect(await role(google)).toBe('member')
    await db.query('update auth.users set raw_app_meta_data=$2 where id=$1', [email, { provider: 'email', providers: ['email', 'google'] }])
    expect(await role(email)).toBe('member')
    await db.exec(migration)
    expect(await role('00000000-0000-4000-8000-000000000002')).toBe('admin')
    expect((await db.query<{ allowed: boolean }>("select has_function_privilege('authenticated','public.handle_new_auth_user_role()','execute') as allowed")).rows[0].allowed).toBe(false)
  } finally { await db.close() }
}, 30000)
