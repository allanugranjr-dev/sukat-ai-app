-- Keep provider completion private until the customer explicitly shares it.
-- This migration is intentionally separate from the policy/function migration:
-- PostgreSQL requires a newly added enum value to be committed before it can
-- be used by later statements.
alter type public.scan_status add value if not exists 'ready_to_share';
