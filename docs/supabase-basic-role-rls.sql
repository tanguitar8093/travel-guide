-- Supabase RBAC bootstrap for signup-based default basic role
-- Goal:
-- 1) New signup users are assigned role=basic
-- 2) Member accesses own business data; admin accesses all business data
-- 3) Admin can manage role assignments

begin;

-- 1) Role table
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('basic', 'member', 'admin')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_user_roles_role on public.user_roles(role);

-- Keep updated_at current
create or replace function public.set_updated_at_user_roles()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_user_roles_set_updated_at on public.user_roles;
create trigger trg_user_roles_set_updated_at
before update on public.user_roles
for each row
execute function public.set_updated_at_user_roles();

-- 2) Assign default role=basic on signup
create or replace function public.handle_new_auth_user_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_roles(user_id, role)
  values (new.id, 'basic')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created_set_role on auth.users;
create trigger trg_on_auth_user_created_set_role
after insert on auth.users
for each row
execute function public.handle_new_auth_user_role();

-- Backfill existing users that do not have a role yet
insert into public.user_roles(user_id, role)
select u.id, 'member'
from auth.users u
left join public.user_roles r on r.user_id = u.id
where r.user_id is null;

-- 3) Helper functions for RLS
create or replace function public.app_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.user_roles
  where user_id = auth.uid();
$$;

create or replace function public.app_is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_current_role() in ('member', 'admin'), false);
$$;

create or replace function public.app_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_current_role() = 'admin', false);
$$;

-- 4) RLS for user_roles
alter table public.user_roles enable row level security;
revoke all on public.user_roles from anon;
grant select, insert, update, delete on public.user_roles to authenticated;

-- Drop all existing policies on user_roles to avoid permissive leftovers
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'user_roles'
  LOOP
    execute format('drop policy if exists %I on public.user_roles', p.policyname);
  END LOOP;
END $$;

create policy user_roles_select_self_or_admin
on public.user_roles
for select
using (auth.uid() = user_id or public.app_is_admin());

create policy user_roles_insert_admin_only
on public.user_roles
for insert
with check (public.app_is_admin());

create policy user_roles_update_admin_only
on public.user_roles
for update
using (public.app_is_admin())
with check (public.app_is_admin());

create policy user_roles_delete_admin_only
on public.user_roles
for delete
using (public.app_is_admin());

-- 5) Rebuild owner-scoped business policies. Safe to re-run after isolation.
-- NOTE: this intentionally removes existing policies for these tables.
DO $$
DECLARE
  t text;
  p record;
  target_tables text[] := array[
    'regions',
    'labels',
    'places',
    'place_regions',
    'place_labels',
    'trips',
    'itinerary_items'
  ];
BEGIN
  FOREACH t IN ARRAY target_tables LOOP
    FOR p IN
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = t
    LOOP
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    END LOOP;

    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'owner_uid') then
      execute format('create policy %I on public.%I for all to authenticated using (public.app_is_member() and (owner_uid = auth.uid() or public.app_is_admin())) with check (public.app_is_member() and (owner_uid = auth.uid() or public.app_is_admin()))', t || '_owner_or_admin', t);
    end if;
    -- Without an owner column, leave RLS closed until owner-isolation migration.

  END LOOP;
END $$;

-- Ensure RLS is enabled on all business tables
alter table public.regions enable row level security;
alter table public.labels enable row level security;
alter table public.places enable row level security;
alter table public.place_regions enable row level security;
alter table public.place_labels enable row level security;
alter table public.trips enable row level security;
alter table public.itinerary_items enable row level security;

commit;

-- Quick verification snippets:
-- select auth.uid(), public.app_current_role(), public.app_is_member(), public.app_is_admin();
-- select * from public.user_roles where user_id = auth.uid();
