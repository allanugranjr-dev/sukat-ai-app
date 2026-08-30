-- SukatAI production schema for Supabase Auth, Postgres, and private Storage.

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('customer', 'dressmaker', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.scan_status as enum ('draft', 'uploaded', 'processing_queued', 'processing', 'ready_for_review', 'verified', 'needs_recapture', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.capture_source as enum ('camera', 'upload');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.quality_status as enum ('pending', 'passed', 'needs_attention', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.review_event_type as enum ('opened', 'adjusted', 'approved', 'recapture_requested', 'photo_accessed', 'deleted');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum ('new', 'accepted', 'in_production', 'for_fitting', 'ready_for_pickup', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.fitting_status as enum ('requested', 'confirmed', 'completed', 'reschedule_requested', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  owner_id uuid not null references auth.users(id) on delete restrict,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'customer',
  organization_id uuid references public.organizations(id) on delete set null,
  first_name text not null check (char_length(trim(first_name)) between 1 and 80),
  last_name text not null check (char_length(trim(last_name)) between 1 and 80),
  email text not null,
  avatar_url text,
  unit_system text not null default 'cm' check (unit_system in ('cm', 'ftin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dressmaker_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (char_length(trim(email)) between 3 and 320),
  invited_role public.app_role not null default 'dressmaker' check (invited_role = 'dressmaker'),
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  invited_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.scans (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  status public.scan_status not null default 'draft',
  height_value numeric(6,2),
  height_unit text not null default 'cm' check (height_unit in ('cm', 'ftin')),
  consent_at timestamptz,
  capture_source public.capture_source not null default 'upload',
  processing_provider text,
  processing_version text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scan_assets (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans(id) on delete cascade,
  asset_type text not null check (asset_type in ('front', 'side', 'back', 'detail', 'garment_reference')),
  storage_path text not null,
  metadata jsonb not null default '{}'::jsonb,
  quality_status public.quality_status not null default 'pending',
  created_at timestamptz not null default now(),
  unique(scan_id, asset_type)
);

create table if not exists public.body_models (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null unique references public.scans(id) on delete cascade,
  provider text not null,
  model_url_or_path text,
  preview_data jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'processing', 'ready', 'failed')),
  created_at timestamptz not null default now()
);

create table if not exists public.measurements (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans(id) on delete cascade,
  key text not null check (char_length(trim(key)) between 1 and 80),
  value numeric(8,2) not null check (value > 0),
  unit text not null default 'cm' check (unit in ('cm', 'in')),
  confidence numeric(5,2) check (confidence >= 0 and confidence <= 100),
  ai_value numeric(8,2),
  adjusted_value numeric(8,2),
  adjusted_by uuid references auth.users(id) on delete set null,
  adjustment_reason text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(scan_id, key)
);

create table if not exists public.measurement_review_events (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  event_type public.review_event_type not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete set null,
  dressmaker_id uuid references public.profiles(id) on delete set null,
  scan_id uuid references public.scans(id) on delete set null,
  status public.order_status not null default 'new',
  garment_type text not null check (char_length(trim(garment_type)) between 2 and 120),
  due_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fittings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  starts_at timestamptz not null,
  location text,
  status public.fitting_status not null default 'requested',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) between 1 and 1000),
  read_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists profiles_org_idx on public.profiles(organization_id);
create index if not exists invitations_org_status_idx on public.dressmaker_invitations(organization_id, accepted_at, revoked_at);
create index if not exists scans_customer_status_idx on public.scans(customer_id, status, updated_at desc);
create index if not exists scans_org_status_idx on public.scans(organization_id, status, updated_at desc);
create index if not exists scan_assets_scan_idx on public.scan_assets(scan_id);
create index if not exists measurements_scan_idx on public.measurements(scan_id);
create index if not exists review_events_scan_idx on public.measurement_review_events(scan_id, created_at desc);
create index if not exists orders_customer_idx on public.orders(customer_id, created_at desc);
create index if not exists orders_org_status_idx on public.orders(organization_id, status);
create index if not exists fittings_order_idx on public.fittings(order_id, starts_at);
create index if not exists notifications_user_idx on public.notifications(user_id, read_at, created_at desc);

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'); $$;

create or replace function public.is_org_admin(target_org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.organization_id = target_org and p.role = 'admin'
  ) or exists (
    select 1 from public.organizations o where o.id = target_org and o.owner_id = auth.uid()
  );
$$;

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.profiles
    where id = auth.uid() and organization_id = target_org and role in ('dressmaker', 'admin')
  );
$$;

create or replace function public.can_access_scan(target_scan uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.scans s
    left join public.profiles p on p.id = auth.uid()
    where s.id = target_scan and (
      s.customer_id = auth.uid()
      or (p.role = 'dressmaker' and p.organization_id = s.organization_id)
      or (p.role = 'admin' and p.organization_id = s.organization_id)
    )
  );
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists scans_touch_updated_at on public.scans;
create trigger scans_touch_updated_at before update on public.scans for each row execute function public.touch_updated_at();
drop trigger if exists measurements_touch_updated_at on public.measurements;
create trigger measurements_touch_updated_at before update on public.measurements for each row execute function public.touch_updated_at();
drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at before update on public.orders for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  first_name_value text;
  last_name_value text;
begin
  first_name_value := coalesce(nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''), split_part(coalesce(new.email, 'account'), '@', 1));
  last_name_value := coalesce(nullif(trim(new.raw_user_meta_data ->> 'last_name'), ''), 'User');
  insert into public.profiles (id, first_name, last_name, email)
  values (new.id, left(first_name_value, 80), left(last_name_value, 80), coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
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

drop trigger if exists profiles_protect_privileges on public.profiles;
create trigger profiles_protect_privileges before update on public.profiles for each row execute function public.protect_profile_privileges();

create or replace function public.protect_customer_scan_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
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

drop trigger if exists scans_protect_customer_update on public.scans;
create trigger scans_protect_customer_update before update on public.scans for each row execute function public.protect_customer_scan_update();

create or replace function public.protect_order_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
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

drop trigger if exists orders_protect_identity on public.orders;
create trigger orders_protect_identity before update on public.orders for each row execute function public.protect_order_update();

create or replace function public.protect_measurement_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    if new.id is distinct from old.id
      or new.scan_id is distinct from old.scan_id
      or new.key is distinct from old.key
      or new.value is distinct from old.value
      or new.unit is distinct from old.unit
      or new.confidence is distinct from old.confidence
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

drop trigger if exists measurements_protect_provider_values on public.measurements;
create trigger measurements_protect_provider_values before update on public.measurements for each row execute function public.protect_measurement_update();

create or replace function public.sync_customer_organization()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    update public.scans set organization_id = new.organization_id where customer_id = new.id;
    update public.orders set organization_id = new.organization_id where customer_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_customer_organization on public.profiles;
create trigger profiles_sync_customer_organization after update of organization_id on public.profiles for each row execute function public.sync_customer_organization();

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.dressmaker_invitations enable row level security;
alter table public.scans enable row level security;
alter table public.scan_assets enable row level security;
alter table public.body_models enable row level security;
alter table public.measurements enable row level security;
alter table public.measurement_review_events enable row level security;
alter table public.orders enable row level security;
alter table public.fittings enable row level security;
alter table public.notifications enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (id = auth.uid() or public.is_admin() or (organization_id is not null and public.is_org_member(organization_id)));
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations for select using (public.is_admin() or owner_id = auth.uid() or public.is_org_member(id));
drop policy if exists organizations_admin_write on public.organizations;
create policy organizations_admin_write on public.organizations for all using (public.is_admin() or owner_id = auth.uid()) with check (public.is_admin() or owner_id = auth.uid());

drop policy if exists invitations_admin_org_read on public.dressmaker_invitations;
create policy invitations_admin_org_read on public.dressmaker_invitations for select using (public.is_org_admin(organization_id));
drop policy if exists invitations_admin_update on public.dressmaker_invitations;
create policy invitations_admin_update on public.dressmaker_invitations for update using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

drop policy if exists scans_read on public.scans;
create policy scans_read on public.scans for select using (customer_id = auth.uid() or public.is_org_member(organization_id));
drop policy if exists scans_customer_insert on public.scans;
create policy scans_customer_insert on public.scans for insert with check (
  customer_id = auth.uid()
  and (organization_id is null or organization_id = (select p.organization_id from public.profiles p where p.id = auth.uid()))
  and status = 'draft'
);
drop policy if exists scans_customer_update on public.scans;
create policy scans_customer_update on public.scans for update using (customer_id = auth.uid()) with check (customer_id = auth.uid());
drop policy if exists scans_staff_update on public.scans;
create policy scans_staff_update on public.scans for update using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
drop policy if exists scans_admin_delete on public.scans;
create policy scans_admin_delete on public.scans for delete using (customer_id = auth.uid() or public.is_admin());

drop policy if exists assets_access on public.scan_assets;
create policy assets_access on public.scan_assets for select using (public.can_access_scan(scan_id));
drop policy if exists assets_customer_insert on public.scan_assets;
create policy assets_customer_insert on public.scan_assets for insert with check (exists (select 1 from public.scans where id = scan_id and customer_id = auth.uid()));
drop policy if exists assets_customer_delete on public.scan_assets;
create policy assets_customer_delete on public.scan_assets for delete using (exists (select 1 from public.scans where id = scan_id and (customer_id = auth.uid() or public.is_admin())));

drop policy if exists models_access on public.body_models;
create policy models_access on public.body_models for select using (public.can_access_scan(scan_id));

drop policy if exists measurements_access on public.measurements;
create policy measurements_access on public.measurements for select using (public.can_access_scan(scan_id));
drop policy if exists measurements_review_update on public.measurements;
create policy measurements_review_update on public.measurements for update using (public.is_org_member((select organization_id from public.scans where id = scan_id))) with check (public.is_org_member((select organization_id from public.scans where id = scan_id)));

drop policy if exists review_events_access on public.measurement_review_events;
create policy review_events_access on public.measurement_review_events for select using (public.can_access_scan(scan_id));
drop policy if exists review_events_staff_insert on public.measurement_review_events;
create policy review_events_staff_insert on public.measurement_review_events for insert with check (actor_id = auth.uid() and public.is_org_member((select organization_id from public.scans where id = scan_id)));

drop policy if exists orders_access on public.orders;
create policy orders_access on public.orders for select using (customer_id = auth.uid() or dressmaker_id = auth.uid() or public.is_org_member(organization_id));
drop policy if exists orders_customer_insert on public.orders;
create policy orders_customer_insert on public.orders for insert with check (
  customer_id = auth.uid()
  and (organization_id is null or organization_id = (select p.organization_id from public.profiles p where p.id = auth.uid()))
  and dressmaker_id is null
  and status = 'new'
  and exists (select 1 from public.scans s where s.id = scan_id and s.customer_id = auth.uid() and s.status = 'verified')
);
drop policy if exists orders_staff_update on public.orders;
create policy orders_staff_update on public.orders for update using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists fittings_access on public.fittings;
create policy fittings_access on public.fittings for select using (exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = auth.uid() or o.dressmaker_id = auth.uid() or public.is_org_member(o.organization_id))));
drop policy if exists fittings_staff_write on public.fittings;
create policy fittings_staff_write on public.fittings for all using (exists (select 1 from public.orders o where o.id = order_id and public.is_org_member(o.organization_id))) with check (exists (select 1 from public.orders o where o.id = order_id and public.is_org_member(o.organization_id)));

drop policy if exists notifications_self on public.notifications;
create policy notifications_self on public.notifications for select using (user_id = auth.uid());
drop policy if exists notifications_self_update on public.notifications;
create policy notifications_self_update on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into storage.buckets (id, name, public) values ('scan-captures', 'scan-captures', false) on conflict (id) do update set public = false;
insert into storage.buckets (id, name, public) values ('body-models', 'body-models', false) on conflict (id) do update set public = false;

drop policy if exists scan_objects_read on storage.objects;
create policy scan_objects_read on storage.objects for select using (
  bucket_id = 'scan-captures' and public.can_access_scan((storage.foldername(name))[3]::uuid)
);
drop policy if exists scan_objects_insert on storage.objects;
create policy scan_objects_insert on storage.objects for insert with check (
  bucket_id = 'scan-captures' and exists (
    select 1 from public.scans s where s.id = (storage.foldername(name))[3]::uuid and s.customer_id = auth.uid()
  )
);
drop policy if exists scan_objects_delete on storage.objects;
create policy scan_objects_delete on storage.objects for delete using (
  bucket_id = 'scan-captures' and exists (
    select 1 from public.scans s
    where s.id = (storage.foldername(name))[3]::uuid
      and (s.customer_id = auth.uid() or public.is_admin())
  )
);

drop policy if exists model_objects_read on storage.objects;
create policy model_objects_read on storage.objects for select using (
  bucket_id = 'body-models' and public.can_access_scan((storage.foldername(name))[3]::uuid)
);

-- Provider and invitation Edge Functions use the service role for writes after checking the caller's JWT.
