-- One family account owns one private space. Re-run safely for the same project.
create table if not exists public.family_spaces (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  version bigint not null default 1 check (version > 0),
  last_request_id uuid not null,
  updated_at timestamptz not null default now(),
  constraint family_payload_object check (jsonb_typeof(payload) = 'object')
);
alter table public.family_spaces enable row level security;
revoke all on public.family_spaces from anon, authenticated;
grant select, insert, update on public.family_spaces to authenticated;
drop policy if exists family_owner_read on public.family_spaces;
create policy family_owner_read on public.family_spaces for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists family_owner_insert on public.family_spaces;
create policy family_owner_insert on public.family_spaces for insert to authenticated
  with check ((select auth.uid()) = owner_id);
drop policy if exists family_owner_update on public.family_spaces;
create policy family_owner_update on public.family_spaces for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- Compare-and-swap: stale clients cannot overwrite newer task progress or rewards.
-- Retrying an acknowledged request is idempotent. No unauthenticated writes.
create or replace function public.sync_family_space(
  expected_version bigint,
  new_payload jsonb,
  request_id uuid
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  caller uuid := auth.uid();
  current_row public.family_spaces%rowtype;
begin
  if caller is null then raise exception 'authentication_required'; end if;
  if request_id is null or expected_version is null or expected_version < 0 then
    raise exception 'invalid_sync_request';
  end if;
  if new_payload is null or jsonb_typeof(new_payload) <> 'object'
     or jsonb_typeof(new_payload->'people') is distinct from 'array'
     or jsonb_typeof(new_payload->'tasks') is distinct from 'array'
     or jsonb_typeof(new_payload->'history') is distinct from 'array'
     or jsonb_typeof(new_payload->'records') is distinct from 'array'
     or jsonb_typeof(new_payload->'goal') is distinct from 'array'
     or pg_column_size(new_payload) > 2097152 then
    raise exception 'invalid_family_data';
  end if;
  if jsonb_array_length(new_payload->'people') < 1 then raise exception 'member_required'; end if;
  -- Serialize initial creation as well as updates for a given account.
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));
  select * into current_row from public.family_spaces where owner_id = caller for update;
  if found then
    if current_row.last_request_id = request_id then
      return jsonb_build_object('ok',true,'version',current_row.version,'payload',current_row.payload);
    end if;
    if current_row.version <> expected_version then
      return jsonb_build_object('ok',false,'conflict',true,'version',current_row.version,'payload',current_row.payload);
    end if;
    update public.family_spaces set payload = new_payload, version = version + 1,
      last_request_id = request_id, updated_at = now()
      where owner_id = caller returning * into current_row;
  else
    if expected_version <> 0 then raise exception 'family_space_missing'; end if;
    insert into public.family_spaces(owner_id,payload,last_request_id)
      values(caller,new_payload,request_id) returning * into current_row;
  end if;
  return jsonb_build_object('ok',true,'version',current_row.version,'payload',current_row.payload);
end;
$$;
revoke all on function public.sync_family_space(bigint,jsonb,uuid) from public, anon;
grant execute on function public.sync_family_space(bigint,jsonb,uuid) to authenticated;
