-- Keep already-deployed projects aligned with the hardened baseline policy.

drop policy if exists organizations_admin_write on public.organizations;
create policy organizations_admin_write on public.organizations
  for all
  using (public.is_admin())
  with check (public.is_admin());
