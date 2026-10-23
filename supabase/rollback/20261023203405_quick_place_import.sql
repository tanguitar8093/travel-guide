begin;
drop function if exists public.app_import_place(text,double precision,double precision,uuid,text);
notify pgrst, 'reload schema';
commit;
