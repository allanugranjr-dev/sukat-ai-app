-- Durable provider attempt history. This is additive: the existing scan,
-- measurement, model, storage, and review tables remain the public contract.

alter table public.scans
  add column if not exists processing_attempt_id uuid,
  add column if not exists processing_progress_reported boolean not null default false;

-- Existing terminal rows have a real terminal state; older in-flight rows do
-- not get promoted to a made-up provider percentage.
update public.scans
set processing_progress_reported = true
where status in ('ready_for_review', 'verified') and processing_progress >= 100;

create table if not exists public.scan_processing_attempts (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans(id) on delete cascade,
  attempt_number integer not null,
  status text not null default 'queued',
  provider text,
  processing_version text,
  idempotency_key text not null,
  claim_token text,
  quality text,
  quality_issues jsonb not null default '[]'::jsonb,
  reconstruction jsonb not null default '{}'::jsonb,
  staged_measurements jsonb not null default '[]'::jsonb,
  staged_model_path text,
  error_code text,
  error_message text,
  is_promoted boolean not null default false,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  promoted_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint scan_processing_attempts_status_valid check (status in ('queued', 'validating', 'processing', 'retrying', 'failed', 'promoted')),
  constraint scan_processing_attempts_number_valid check (attempt_number > 0),
  constraint scan_processing_attempts_error_length check (error_message is null or char_length(error_message) between 1 and 1000),
  constraint scan_processing_attempts_key_unique unique (scan_id, idempotency_key),
  constraint scan_processing_attempts_number_unique unique (scan_id, attempt_number)
);

create index if not exists scan_processing_attempts_scan_idx
  on public.scan_processing_attempts (scan_id, created_at desc);

create unique index if not exists scan_processing_attempts_active_idx
  on public.scan_processing_attempts (scan_id)
  where status in ('queued', 'validating', 'processing', 'retrying');

alter table public.scan_processing_attempts enable row level security;
revoke all on public.scan_processing_attempts from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'scans_processing_attempt_id_fkey'
      and conrelid = 'public.scans'::regclass
  ) then
    alter table public.scans
      add constraint scans_processing_attempt_id_fkey
      foreign key (processing_attempt_id)
      references public.scan_processing_attempts(id)
      on delete set null;
  end if;
end
$$;

-- Keep the browser from manufacturing the provider-progress provenance flag.
create or replace function public.protect_processing_progress_reported()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and not public.is_admin()
    and new.processing_progress_reported is distinct from old.processing_progress_reported then
    raise exception 'Scan processing lifecycle fields are managed by the backend';
  end if;
  return new;
end;
$$;

drop trigger if exists scans_protect_processing_progress_reported on public.scans;
create trigger scans_protect_processing_progress_reported
before update of processing_progress_reported on public.scans
for each row execute function public.protect_processing_progress_reported();

-- Supabase client calls do not expose a transaction boundary. Promotion is
-- therefore one server-only function so a failed replacement cannot delete
-- the last promoted measurements/model before the new set is complete.
create or replace function public.promote_scan_processing_attempt(
  p_scan_id uuid,
  p_attempt_id uuid,
  p_provider text,
  p_processing_version text,
  p_model_path text,
  p_preview_data jsonb,
  p_measurements jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  scan_record public.scans%rowtype;
  attempt_record public.scan_processing_attempts%rowtype;
  measurement_record jsonb;
  measurement_key text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Only the processing service can promote a scan attempt';
  end if;
  if p_provider is null or char_length(trim(p_provider)) not between 1 and 120
    or p_processing_version is null or char_length(trim(p_processing_version)) not between 1 and 120
    or p_model_path is null or char_length(trim(p_model_path)) not between 1 and 500
    or p_model_path ~ '[[:cntrl:]]'
    or jsonb_typeof(p_preview_data) <> 'object'
    or jsonb_typeof(p_measurements) <> 'array'
    or jsonb_array_length(p_measurements) = 0
    or jsonb_array_length(p_measurements) > 100 then
    raise exception 'The scan attempt is missing promotion data';
  end if;

  select * into scan_record
    from public.scans
   where id = p_scan_id
   for update;
  if not found or scan_record.status <> 'processing' then
    raise exception 'The scan changed while it was being processed';
  end if;

  select * into attempt_record
    from public.scan_processing_attempts
   where id = p_attempt_id and scan_id = p_scan_id
   for update;
  if not found or attempt_record.status <> 'processing' or attempt_record.is_promoted then
    raise exception 'The scan attempt is not eligible for promotion';
  end if;

  -- Validate uniqueness before clearing the previous promoted set.
  for measurement_record in select value from jsonb_array_elements(p_measurements)
  loop
    measurement_key := trim(coalesce(measurement_record ->> 'key', ''));
    if jsonb_typeof(measurement_record) <> 'object'
      or measurement_key !~ '^[A-Za-z0-9][A-Za-z0-9_:-]{0,79}$'
      or trim(coalesce(measurement_record ->> 'unit', 'cm')) <> 'cm'
      or trim(coalesce(measurement_record ->> 'value', '')) !~ '^[+]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$'
      or (case when trim(coalesce(measurement_record ->> 'value', '')) ~ '^[+]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' then (measurement_record ->> 'value')::numeric else 0 end) <= 0
      or (case when trim(coalesce(measurement_record ->> 'value', '')) ~ '^[+]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' then (measurement_record ->> 'value')::numeric else 0 end) >= 500
      or trim(coalesce(measurement_record ->> 'measurement_method', '')) = ''
      or char_length(trim(coalesce(measurement_record ->> 'measurement_method', ''))) > 40
      or trim(coalesce(measurement_record ->> 'measurement_source', '')) = ''
      or char_length(trim(coalesce(measurement_record ->> 'measurement_source', ''))) > 120
      or (measurement_record ? 'confidence' and trim(coalesce(measurement_record ->> 'confidence', '')) <> '' and trim(measurement_record ->> 'confidence') !~ '^[+]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$')
      or (measurement_record ? 'confidence' and trim(coalesce(measurement_record ->> 'confidence', '')) <> '' and (case when trim(measurement_record ->> 'confidence') ~ '^[+]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' then (measurement_record ->> 'confidence')::numeric else 0 end < 0 or case when trim(measurement_record ->> 'confidence') ~ '^[+]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' then (measurement_record ->> 'confidence')::numeric else 101 end > 100))
      or (select count(*) from jsonb_array_elements(p_measurements) item where lower(trim(coalesce(item ->> 'key', ''))) = lower(measurement_key)) > 1 then
      raise exception 'The provider returned invalid or duplicate measurements';
    end if;
  end loop;

  delete from public.measurements where scan_id = p_scan_id;
  delete from public.body_models where scan_id = p_scan_id;

  for measurement_record in select value from jsonb_array_elements(p_measurements)
  loop
    insert into public.measurements (
      id, scan_id, key, value, unit, confidence,
      measurement_method, measurement_source, ai_value
    ) values (
      coalesce(public.try_uuid(measurement_record ->> 'id'), gen_random_uuid()),
      p_scan_id,
      trim(measurement_record ->> 'key'),
      (measurement_record ->> 'value')::numeric,
      coalesce(nullif(measurement_record ->> 'unit', ''), 'cm'),
      nullif(measurement_record ->> 'confidence', '')::numeric,
      nullif(trim(measurement_record ->> 'measurement_method'), ''),
      nullif(trim(measurement_record ->> 'measurement_source'), ''),
      coalesce(nullif(measurement_record ->> 'ai_value', '')::numeric, (measurement_record ->> 'value')::numeric)
    );
  end loop;

  insert into public.body_models (
    id, scan_id, provider, model_url_or_path, preview_data, status
  ) values (
    gen_random_uuid(), p_scan_id, trim(p_provider), trim(p_model_path), p_preview_data, 'ready'
  )
  on conflict (scan_id) do update set
    provider = excluded.provider,
    model_url_or_path = excluded.model_url_or_path,
    preview_data = excluded.preview_data,
    status = excluded.status;

  update public.scans
     set status = 'ready_for_review',
         processing_status = 'completed',
         processing_progress = 100,
         processing_progress_reported = true,
         processing_provider = trim(p_provider),
         processing_version = trim(p_processing_version),
         processing_attempt_id = p_attempt_id,
         processing_completed_at = now(),
         processing_error_code = null,
         processing_error = null,
         failure_reason = null
   where id = p_scan_id;

  update public.scan_processing_attempts
     set status = 'promoted',
         is_promoted = true,
         processing_version = trim(p_processing_version),
         completed_at = now(),
         promoted_at = now(),
         updated_at = now()
   where id = p_attempt_id;
end;
$$;

revoke all on function public.promote_scan_processing_attempt(uuid, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.promote_scan_processing_attempt(uuid, uuid, text, text, text, jsonb, jsonb) to service_role;
