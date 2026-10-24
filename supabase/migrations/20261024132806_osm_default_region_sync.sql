begin;
set local lock_timeout='10s';
-- Keep quick-import and browser-created system regions byte-for-byte compatible.
create or replace function public.app_import_place(
  p_name text, p_latitude double precision, p_longitude double precision,
  p_operation_id uuid, p_source_url text default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  dataset text;
  region_name text;
  region_center jsonb;
  clean_name text := btrim(p_name);
  normalized_name text;
  region_bytes bytea;
  region_id uuid;
  previous public.places;
  duplicate record;
  record_body jsonb;
  new_location jsonb;
begin
  if uid is null or not public.app_is_member() then
    raise exception '請先使用已開通的 TripMap 帳號登入。' using errcode='42501';
  end if;
  if clean_name is null or clean_name='' or char_length(clean_name)>300
    or p_operation_id is null or p_latitude is null or p_longitude is null
    or not (p_latitude between -90 and 90) or not (p_longitude between -180 and 180) then
    raise exception '請提供有效的名稱、緯度、經度與操作識別碼。' using errcode='22023';
  end if;
  dataset := case when public.app_osm_contains('okinawa',p_latitude::numeric,p_longitude::numeric) then 'okinawa'
    when public.app_osm_contains('taiwan',p_latitude::numeric,p_longitude::numeric) then 'taiwan' else null end;
  if dataset is null then raise exception '此地點超出支援的沖繩／台灣圖資範圍，尚未新增。' using errcode='22023'; end if;
  region_name := case dataset when 'taiwan' then '台灣' else '沖繩' end;
  region_center := case dataset when 'taiwan' then '{"latitude":23.7,"longitude":120.95}'::jsonb else '{"latitude":26.44,"longitude":127.97}'::jsonb end;
  if p_source_url is not null and (char_length(p_source_url)>8192
    or p_source_url !~ '^https://[^[:space:]@/]+(/[^[:space:]]*)?$') then
    raise exception '來源網址必須是有效的 HTTPS 網址。' using errcode='22023';
  end if;
  new_location := jsonb_build_object('source','user','kind','user-picked',
    'coordinate',jsonb_build_object('latitude',p_latitude,'longitude',p_longitude));
  normalized_name := lower(regexp_replace(clean_name,'\s+',' ','g'));

  -- Same ordering as existing app_save_place / sync writers. Serializes dedup + create.
  perform pg_advisory_xact_lock(741293,1);
  select * into previous from public.places where id=p_operation_id and owner_uid=uid;
  if found then
    if previous.name is distinct from clean_name or previous.location is distinct from new_location
      or previous.maps_url is distinct from p_source_url then
      raise exception '操作識別碼已使用，請重新送出。' using errcode='22023';
    end if;
    return jsonb_build_object('status','already_imported','placeId',previous.id,'name',previous.name);
  end if;

  -- Match the website's existing duplicate rules: same normalized name OR < 50m.
  select candidate.* into duplicate from (
    select p.id,p.name,
      lower(regexp_replace(btrim(p.name),'\s+',' ','g'))=normalized_name as same_name,
      6371008.8*2*asin(sqrt(least(1.0,greatest(0.0,
        power(sin(radians((p.location->'coordinate'->>'latitude')::double precision-p_latitude)/2),2)
        +cos(radians(p_latitude))*cos(radians((p.location->'coordinate'->>'latitude')::double precision))
        *power(sin(radians((p.location->'coordinate'->>'longitude')::double precision-p_longitude)/2),2)
      )))) as meters
    from public.places p where p.owner_uid=uid and p.location is not null and p.google_place_id is null and exists(select 1 from public.place_regions pr join public.regions r on r.id=pr.region_id where pr.place_id=p.id and r.map_provider='osm' and coalesce(r.osm_dataset,'okinawa')=dataset)
  ) candidate where candidate.same_name or candidate.meters<50
  order by candidate.same_name desc,candidate.id limit 1;
  if found then
    return jsonb_build_object('status','duplicate','placeId',duplicate.id,'name',duplicate.name,
      'reason',case when duplicate.meters<50 then 'nearby' else 'name' end);
  end if;

  -- Same stable account-scoped region ID as src/geo/osm-coverage.ts.
  region_bytes := substring(sha256(convert_to(uid::text||':'||dataset||'-osm-region','UTF8')) for 16);
  region_bytes := set_byte(region_bytes,6,(get_byte(region_bytes,6)&15)|128);
  region_bytes := set_byte(region_bytes,8,(get_byte(region_bytes,8)&63)|128);
  region_id := encode(region_bytes,'hex')::uuid;
  insert into public.regions(id,name,map_provider,center,center_metadata,zoom,osm_dataset)
    values(region_id,region_name,'osm',region_center,
      '{"source":"user","kind":"approximate-center"}',case when dataset='taiwan' then 7 else 8 end,case when dataset='taiwan' then dataset else null end)
    on conflict(id) do nothing;
  if not exists(select 1 from public.regions where id=region_id and owner_uid=uid and map_provider='osm') then
    raise exception '預設沖繩區域無法使用，請先在 TripMap 確認區域設定。' using errcode='22023';
  end if;
  record_body := jsonb_strip_nulls(jsonb_build_object('name',clean_name,'location',new_location,
    'mapsUrl',p_source_url,'regionIds',jsonb_build_array(region_id),'labelIds','[]'::jsonb));
  perform public.app_save_place(p_operation_id,record_body,true);
  return jsonb_build_object('status','created','placeId',p_operation_id,'name',clean_name,'regionId',region_id);
end;
$$;
-- Correct the initial quick-import default only; leave user/custom/shared regions intact.
with defaults as (
  select id,owner_uid,
    substring(sha256(convert_to(owner_uid::text||':taiwan-osm-region','UTF8')) for 16) as bytes
  from public.regions where map_provider='osm' and osm_dataset='taiwan' and name='台灣'
    and center='{"latitude":23.7,"longitude":120.95}'::jsonb
    and center_metadata='{"source":"user","kind":"approximate-center"}'::jsonb and zoom=8
), expected as (
  select id,encode(set_byte(set_byte(bytes,6,(get_byte(bytes,6)&15)|128),8,(get_byte(bytes,8)&63)|128),'hex')::uuid as expected_id from defaults
)
update public.regions set zoom=7 from expected where regions.id=expected.id and expected.id=expected.expected_id;
notify pgrst,'reload schema';
commit;
