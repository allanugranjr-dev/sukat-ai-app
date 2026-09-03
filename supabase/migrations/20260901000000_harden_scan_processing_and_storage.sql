-- Explicit processing lifecycle metadata and private-storage path binding.
-- This migration is additive and keeps the existing scan status contract intact.

-- These columns are declared before the trigger below references them. The
-- follow-up provenance migration keeps this block idempotent for projects
-- applying migrations incrementally.
alter table public.measurements
  add column if not exists measurement_method text,
  add column if not exists measurement_source text;

alter table public.measurements
  drop constraint if exists measurements_method_length;
alter table public.measurements
  add constraint measurements_method_length check (measurement_method is null or char_length(measurement_method) between 1 and 40);

alter table public.measurements
  drop constraint if exists measurements_source_length;
alter table public.measurements
  add constraint measurements_source_length check (measurement_source is null or char_length(measurement_source) between 1 and 120);

alter table public.scans
  add column if not exists processing_attempts integer not null default 0,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_completed_at timestamptz,
  add column if not exists processing_error_code text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'scans_processing_attempts_nonnegative'
      and conrelid = 'public.scans'::regclass
  ) then
    alter table public.scans add constraint scans_processing_attempts_nonnegative check (processing_attempts >= 0);
  end if;
end
$$;

alter table public.scans
  drop constraint if exists scans_processing_error_code_length;
alter table public.scans
  add constraint scans_processing_error_code_length check (processing_error_code is null or char_length(processing_error_code) between 1 and 80);

-- SECURITY DEFINER functions are only called by RLS policies/triggers. They
-- must not be callable by anonymous clients as arbitrary RPC functions.
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_org_admin(uuid) from public, anon;
revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.can_access_scan(uuid) from public, anon;
revoke all on function public.touch_updated_at() from public, anon;
revoke all on function public.create_order_ready_notification() from public, anon;
revoke all on function public.handle_new_user() from public, anon;
revoke all on function public.protect_profile_privileges() from public, anon;
revoke all on function public.protect_customer_scan_update() from public, anon;
revoke all on function public.protect_order_update() from public, anon;
revoke all on function public.protect_measurement_update() from public, anon;
revoke all on function public.sync_customer_organization() from public, anon;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.can_access_scan(uuid) to authenticated;

-- Keep trigger authorization compatible with the current Supabase JWT claim
-- without relying on the deprecated auth.role() helper.
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and not public.is_admin() then
    if new.role is distinct from old.role or new.organization_id is distinct from old.organization_id then
      raise exception 'Only an administrator can change role or organization assignment';
    end if;
  end if;
  if new.id is distinct from old.id or new.email is distinct from old.email or new.created_at is distinct from old.created_at then
    raise exception 'Profile identity fields cannot be changed here';
  end if;
  return new;
end;
$$;

create or replace function public.protect_customer_scan_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and not public.is_admin() then
    if old.customer_id = auth.uid() then
      if new.customer_id is distinct from old.customer_id or new.organization_id is distinct from old.organization_id then
        raise exception 'Customers cannot change scan ownership or organization assignment';
      end if;
      if new.status is distinct from old.status and new.status not in ('draft', 'uploaded', 'processing_queued', 'ready_for_review', 'needs_recapture') then
        raise exception 'Customers cannot set a scan to a staff or provider status';
      end if;
    else
      if new.customer_id is distinct from old.customer_id or new.organization_id is distinct from old.organization_id then
        raise exception 'Dressmakers cannot change scan ownership or organization assignment';
      end if;
      if new.status is distinct from old.status and new.status not in ('verified', 'needs_recapture') then
        raise exception 'Dressmakers can only verify or request recapture for a scan';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.protect_order_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and not public.is_admin() then
    if new.id is distinct from old.id
      or new.customer_id is distinct from old.customer_id
      or new.organization_id is distinct from old.organization_id
      or new.dressmaker_id is distinct from old.dressmaker_id
      or new.scan_id is distinct from old.scan_id
      or new.created_at is distinct from old.created_at then
      raise exception 'Order ownership and identity fields cannot be changed here';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.protect_measurement_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and not public.is_admin() then
    if new.id is distinct from old.id
      or new.scan_id is distinct from old.scan_id
      or new.key is distinct from old.key
      or new.value is distinct from old.value
      or new.unit is distinct from old.unit
      or new.confidence is distinct from old.confidence
      or new.measurement_method is distinct from old.measurement_method
      or new.measurement_source is distinct from old.measurement_source
      or new.ai_value is distinct from old.ai_value
      or new.created_at is distinct from old.created_at then
      raise exception 'Provider measurement fields cannot be changed during review';
    end if;
    if new.adjusted_value is not null and new.adjusted_by is distinct from auth.uid() then
      raise exception 'Measurement adjustments must identify the reviewing user';
    end if;
  end if;
  return new;
end;
$$;

-- Supabase client paths are organization/customer/scan/file. Bind all three
-- identifiers to the scan row so a customer cannot place a file in another
-- organization folder or attach an arbitrary path to their scan.
create or replace function public.validate_scan_asset_storage_path()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  scan_record record;
  path_parts text[];
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;

  select s.id, s.customer_id, s.organization_id
    into scan_record
    from public.scans s
   where s.id = new.scan_id;
  if not found then
    raise exception 'The scan does not exist';
  end if;

  path_parts := string_to_array(replace(new.storage_path, chr(92), '/'), '/');
  if coalesce(array_length(path_parts, 1), 0) <> 4
     or path_parts[1] <> coalesce(scan_record.organization_id::text, 'unassigned')
     or path_parts[2] !~* uuid_pattern
     or path_parts[3] !~* uuid_pattern
     or public.try_uuid(path_parts[2]) <> scan_record.customer_id
     or public.try_uuid(path_parts[3]) <> scan_record.id
     or new.asset_type not in ('front', 'side', 'back', 'detail', 'garment_reference')
     or path_parts[4] not like new.asset_type || '-%' then
    raise exception 'The scan asset path does not match the scan';
  end if;
  if new.storage_path like '%..%' or new.storage_path ~ '[[:cntrl:]]' then
    raise exception 'The scan asset path is invalid';
  end if;
  return new;
end;
$$;

drop trigger if exists scan_assets_validate_storage_path on public.scan_assets;
create trigger scan_assets_validate_storage_path
before insert or update of scan_id, storage_path on public.scan_assets
for each row execute function public.validate_scan_asset_storage_path();

revoke all on function public.validate_scan_asset_storage_path() from public, anon;

create or replace function public.try_uuid(value text)
returns uuid
language plpgsql immutable
as $$
begin
  return value::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

revoke all on function public.try_uuid(text) from public, anon;
grant execute on function public.try_uuid(text) to authenticated;

drop policy if exists scan_objects_read on storage.objects;
create policy scan_objects_read on storage.objects for select using (
  bucket_id = 'scan-captures'
  and (storage.foldername(name))[1] = coalesce((select s.organization_id::text from public.scans s where s.id = public.try_uuid((storage.foldername(name))[3])), 'unassigned')
  and public.try_uuid((storage.foldername(name))[2]) = (select s.customer_id from public.scans s where s.id = public.try_uuid((storage.foldername(name))[3]))
  and public.can_access_scan(public.try_uuid((storage.foldername(name))[3]))
);

drop policy if exists scan_objects_insert on storage.objects;
create policy scan_objects_insert on storage.objects for insert with check (
  bucket_id = 'scan-captures'
  and (storage.foldername(name))[1] = coalesce((select s.organization_id::text from public.scans s where s.id = public.try_uuid((storage.foldername(name))[3])), 'unassigned')
  and public.try_uuid((storage.foldername(name))[2]) = auth.uid()
  and exists (
    select 1 from public.scans s
    where s.id = public.try_uuid((storage.foldername(name))[3]) and s.customer_id = auth.uid()
  )
);

drop policy if exists scan_objects_delete on storage.objects;
create policy scan_objects_delete on storage.objects for delete using (
  bucket_id = 'scan-captures'
  and (storage.foldername(name))[1] = coalesce((select s.organization_id::text from public.scans s where s.id = public.try_uuid((storage.foldername(name))[3])), 'unassigned')
  and public.try_uuid((storage.foldername(name))[2]) = (select s.customer_id from public.scans s where s.id = public.try_uuid((storage.foldername(name))[3]))
  and exists (
    select 1 from public.scans s
    where s.id = public.try_uuid((storage.foldername(name))[3])
      and (s.customer_id = auth.uid() or public.is_admin())
  )
);

drop policy if exists model_objects_read on storage.objects;
create policy model_objects_read on storage.objects for select using (
  bucket_id = 'body-models'
  and public.can_access_scan(public.try_uuid((storage.foldername(name))[3]))
);
