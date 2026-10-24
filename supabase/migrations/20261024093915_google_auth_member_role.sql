-- Google authentication grants workspace membership using server-managed metadata.
-- Email/password registrations keep the existing basic default.
begin;

create or replace function public.handle_new_auth_user_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  metadata jsonb := coalesce(to_jsonb(new)->'raw_app_meta_data', '{}'::jsonb);
  google_account boolean;
begin
  google_account := coalesce(metadata->>'provider' = 'google', false)
    or coalesce(metadata->'providers' ? 'google', false);

  if tg_op = 'INSERT' or google_account then
    insert into public.user_roles as existing(user_id, role)
    values (new.id, case when google_account then 'member' else 'basic' end)
    on conflict (user_id) do update
      set role = 'member'
      where google_account and existing.role = 'basic';
  end if;
  return new;
end;
$$;

-- Trigger functions cannot be invoked as RPCs.
revoke all on function public.handle_new_auth_user_role() from public, anon, authenticated;

-- Auth updates last_sign_in_at on login; also covers linking Google to an account.
drop trigger if exists trg_on_auth_user_updated_set_google_role on auth.users;
create trigger trg_on_auth_user_updated_set_google_role
after update on auth.users
for each row execute function public.handle_new_auth_user_role();

-- Apply the same rule to Google accounts created before this migration.
insert into public.user_roles as existing(user_id, role)
select u.id, 'member'
from auth.users u
where to_jsonb(u)->'raw_app_meta_data'->>'provider' = 'google'
   or to_jsonb(u)->'raw_app_meta_data'->'providers' ? 'google'
on conflict (user_id) do update set role = 'member'
where existing.role = 'basic';

commit;
