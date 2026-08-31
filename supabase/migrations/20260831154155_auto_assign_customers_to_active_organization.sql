-- Keep customer organization assignment server-side so every auth client,
-- including the mobile clients, receives the same organization scope.

create or replace function public.active_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select o.id
      from public.organizations o
      where o.settings ->> 'active' = 'true'
      order by o.created_at asc, o.id asc
      limit 1
    ),
    (
      select o.id
      from public.organizations o
      where (select count(*) from public.organizations) = 1
      limit 1
    )
  );
$$;

-- This helper is used by database triggers only; do not expose it as a
-- client-callable RPC that could become an authorization shortcut.
revoke all on function public.active_organization_id() from public;

create or replace function public.mark_first_organization_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.organizations
    where settings ->> 'active' = 'true'
  ) then
    new.settings := jsonb_set(
      coalesce(new.settings, '{}'::jsonb),
      '{active}',
      'true'::jsonb,
      true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_mark_first_active on public.organizations;
create trigger organizations_mark_first_active
before insert on public.organizations
for each row execute function public.mark_first_organization_active();

-- The existing project has one organization. Preserve it as the active
-- default, while also choosing the oldest organization if a migrated database
-- already has multiple organizations and no active marker.
update public.organizations target
set settings = jsonb_set(
  coalesce(target.settings, '{}'::jsonb),
  '{active}',
  'true'::jsonb,
  true
)
where not exists (
  select 1
  from public.organizations
  where settings ->> 'active' = 'true'
)
and target.id = (
  select o.id
  from public.organizations o
  order by o.created_at asc, o.id asc
  limit 1
);

create or replace function public.assign_customer_active_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'customer' and new.organization_id is null then
    new.organization_id := public.active_organization_id();
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_assign_customer_active_organization on public.profiles;
create trigger profiles_assign_customer_active_organization
before insert on public.profiles
for each row execute function public.assign_customer_active_organization();
