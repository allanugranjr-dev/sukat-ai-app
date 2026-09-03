-- Backend-authoritative processing lifecycle. Business review status remains
-- on scans.status; these fields expose durable provider work state separately.
alter table public.scans
  add column if not exists processing_status text not null default 'queued',
  add column if not exists processing_progress smallint not null default 0,
  add column if not exists processing_error text;

alter table public.scans
  drop constraint if exists scans_processing_status_valid,
  add constraint scans_processing_status_valid
    check (processing_status in ('queued', 'validating', 'processing', 'completed', 'failed')),
  drop constraint if exists scans_processing_progress_valid,
  add constraint scans_processing_progress_valid
    check (processing_progress between 0 and 100),
  drop constraint if exists scans_processing_error_length,
  add constraint scans_processing_error_length
    check (processing_error is null or char_length(processing_error) between 1 and 1000);

-- Existing terminal scans retain their review status while gaining a truthful
-- processing state. No table, bucket, or object is recreated here.
update public.scans
set processing_status = case
  when status in ('ready_for_review', 'verified') then 'completed'
  when status = 'failed' then 'failed'
  when status = 'processing' then 'processing'
  else 'queued'
end,
processing_progress = case
  when status in ('ready_for_review', 'verified') then 100
  when status = 'failed' then least(greatest(processing_progress, 0), 99)
  when status = 'processing' then greatest(processing_progress, 25)
  else processing_progress
end,
processing_error = coalesce(processing_error, failure_reason);

create index if not exists scans_processing_lifecycle_idx
  on public.scans (processing_status, updated_at);

-- The scan lifecycle is written by the processing backend. Preserve the
-- current customer/dressmaker review rules while refusing client-side state,
-- progress, provider, or error fabrication.
create or replace function public.protect_customer_scan_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and not public.is_admin() then
    if new.processing_provider is distinct from old.processing_provider
      or new.processing_version is distinct from old.processing_version
      or new.processing_attempts is distinct from old.processing_attempts
      or new.processing_started_at is distinct from old.processing_started_at
      or new.processing_completed_at is distinct from old.processing_completed_at
      or new.processing_error_code is distinct from old.processing_error_code
      or new.processing_status is distinct from old.processing_status
      or new.processing_progress is distinct from old.processing_progress
      or new.processing_error is distinct from old.processing_error then
      raise exception 'Scan processing lifecycle fields are managed by the backend';
    end if;
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
