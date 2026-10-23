-- Supabase role operations for 旅圖 · TripMap
-- Usage:
-- 1) Replace the email in each block.
-- 2) Run one block at a time in Supabase SQL Editor.

-- A) Inspect account + current app role
with target as (
  select id, email, email_confirmed_at
  from auth.users
  where email = 'replace-me@example.com'
)
select
  t.id as user_id,
  t.email,
  t.email_confirmed_at,
  r.role,
  r.created_at,
  r.updated_at
from target t
left join public.user_roles r on r.user_id = t.id;

-- B) Set role = basic
insert into public.user_roles (user_id, role)
select id, 'basic'
from auth.users
where email = 'replace-me@example.com'
on conflict (user_id)
do update set
  role = excluded.role,
  updated_at = timezone('utc', now());

-- C) Set role = member
insert into public.user_roles (user_id, role)
select id, 'member'
from auth.users
where email = 'replace-me@example.com'
on conflict (user_id)
do update set
  role = excluded.role,
  updated_at = timezone('utc', now());

-- D) Set role = admin
insert into public.user_roles (user_id, role)
select id, 'admin'
from auth.users
where email = 'replace-me@example.com'
on conflict (user_id)
do update set
  role = excluded.role,
  updated_at = timezone('utc', now());

-- E) Quick verification by email
select
  u.email,
  r.user_id,
  r.role,
  r.updated_at
from public.user_roles r
join auth.users u on u.id = r.user_id
where u.email = 'replace-me@example.com';

-- F) Optional: list all users and roles
select
  u.email,
  u.email_confirmed_at,
  r.role,
  r.updated_at
from auth.users u
left join public.user_roles r on r.user_id = u.id
order by u.created_at desc;
