-- Email-based invitation entry point; existing UUID API and stored IDs remain compatible.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

create function public.app_trip_collaboration_v2(
  p_action text,
  p_trip_id uuid default null,
  p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  target uuid;
  email_value text;
  candidates bigint;
  result jsonb;
  manager boolean;
begin
  if uid is null or not public.app_is_member() then
    raise exception 'Collaboration requires member or admin access' using errcode='42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then
    raise exception 'Payload must be an object';
  end if;
  perform pg_advisory_xact_lock(741293,1);

  if p_action='invite' then
    -- Check management rights before resolving any email. This is not a user directory.
    if not exists (select 1 from public.trips t where t.id=p_trip_id
      and (t.owner_uid=uid or public.app_is_admin())) then
      raise exception 'Only owner or admin may manage collaboration' using errcode='42501';
    end if;
    if exists (select 1 from jsonb_object_keys(p_payload) k
      where k not in ('email','role','expiresAt')) then
      raise exception 'Unexpected collaboration payload fields';
    end if;
    if jsonb_typeof(p_payload->'email') is distinct from 'string' then
      raise exception '請輸入有效的 Email。';
    end if;
    email_value := lower(btrim(p_payload->>'email'));
    if length(email_value)>254 or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception '請輸入有效的 Email。';
    end if;
    select count(*),min(u.id::text)::uuid into candidates,target
      from auth.users u join public.user_roles r on r.user_id=u.id
      where lower(u.email)=email_value and r.role in ('member','admin');
    if candidates<>1 then
      raise exception '無法邀請此 Email，請確認對方已註冊且具有工作區使用權限。';
    end if;
    result := public.app_trip_collaboration('invite',p_trip_id,
      (p_payload-'email') || jsonb_build_object('inviteeUserId',target));
    return result;
  end if;

  result := public.app_trip_collaboration(p_action,p_trip_id,p_payload);
  if p_action='details' then
    manager := result->'trip'->>'access'='owner';
    result := jsonb_set(result,'{trip}',(result->'trip') || jsonb_build_object(
      'ownerEmail',(select u.email from auth.users u where u.id=(result->'trip'->>'ownerUid')::uuid)));
    result := jsonb_set(result,'{members}',coalesce((
      select jsonb_agg(m || jsonb_build_object('email',
        case when manager or (m->>'userId')::uuid=uid then
          (select u.email from auth.users u where u.id=(m->>'userId')::uuid)
        else null end) order by m->>'userId')
      from jsonb_array_elements(result->'members') m
    ),'[]'::jsonb));
  end if;
  if p_action in ('list','details') then
    result := jsonb_set(result,'{invitations}',coalesce((
      select jsonb_agg(i || jsonb_build_object('inviteeEmail',
        (select u.email from auth.users u where u.id=(i->>'inviteeUserId')::uuid))
        order by i->>'createdAt',i->>'id')
      from jsonb_array_elements(result->'invitations') i
    ),'[]'::jsonb));
  end if;
  return result;
end;
$$;
revoke all on function public.app_trip_collaboration_v2(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.app_trip_collaboration_v2(text,uuid,jsonb) to authenticated;
commit;
