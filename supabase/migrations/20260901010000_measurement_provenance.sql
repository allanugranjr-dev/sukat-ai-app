-- Preserve the method and source for every provider value without changing
-- the existing measurement review workflow.
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
