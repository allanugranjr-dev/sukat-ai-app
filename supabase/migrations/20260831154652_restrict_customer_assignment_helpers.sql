-- These functions are invoked by database triggers, not by REST clients.
revoke execute on function public.active_organization_id() from public, anon, authenticated, service_role;
revoke execute on function public.mark_first_organization_active() from public, anon, authenticated, service_role;
revoke execute on function public.assign_customer_active_organization() from public, anon, authenticated, service_role;
