-- Provider results are complete but private until the customer shares them.
-- Existing ready_for_review/verified rows remain visible to their organization.

update public.scans
   set processing_status = 'completed',
       processing_progress = 100,
       processing_progress_reported = true
 where status = 'ready_to_share';

create or replace function public.can_access_scan(target_scan uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.scans s
    left join public.profiles p on p.id = auth.uid()
    where s.id = target_scan and (
      s.customer_id = auth.uid()
      or (p.role = 'dressmaker' and p.organization_id = s.organization_id and s.status in ('ready_for_review', 'verified', 'needs_recapture'))
      or (p.role = 'admin' and p.organization_id = s.organization_id)
    )
  );
$$;

drop policy if exists scans_read on public.scans;
create policy scans_read on public.scans for select using (
  public.is_admin()
  or customer_id = auth.uid()
  or (public.is_org_member(organization_id) and status in ('ready_for_review', 'verified', 'needs_recapture'))
);

drop policy if exists scans_staff_update on public.scans;
create policy scans_staff_update on public.scans for update
using (
  public.is_admin()
  or (public.is_org_member(organization_id) and status in ('ready_for_review', 'verified', 'needs_recapture'))
)
with check (
  public.is_admin()
  or (public.is_org_member(organization_id) and status in ('ready_for_review', 'verified', 'needs_recapture'))
);

drop policy if exists measurements_review_update on public.measurements;
create policy measurements_review_update on public.measurements for update
using (
  public.is_admin()
  or (
    public.is_org_member((select organization_id from public.scans where id = scan_id))
    and (select status from public.scans where id = scan_id) in ('ready_for_review', 'verified', 'needs_recapture')
  )
)
with check (
  public.is_admin()
  or (
    public.is_org_member((select organization_id from public.scans where id = scan_id))
    and (select status from public.scans where id = scan_id) in ('ready_for_review', 'verified', 'needs_recapture')
  )
);

drop policy if exists review_events_staff_insert on public.measurement_review_events;
create policy review_events_staff_insert on public.measurement_review_events for insert
with check (
  actor_id = auth.uid()
  and (
    public.is_admin()
    or (
      public.is_org_member((select organization_id from public.scans where id = scan_id))
      and (select status from public.scans where id = scan_id) in ('ready_for_review', 'verified', 'needs_recapture')
    )
  )
);

-- Keep the existing customer/staff lifecycle guard, while allowing the
-- explicit ready_to_share -> ready_for_review action and rejecting fabricated
-- provider states from browser clients.
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
      if new.status = 'ready_for_review' and old.status <> 'ready_to_share' then
        raise exception 'A result can only be shared after processing is complete';
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

-- Promotion remains server-only, but now stops at the private pre-share state.
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
     set status = 'ready_to_share',
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
