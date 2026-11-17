-- Store a normalized, tenant-scoped CNPJ consultation snapshot.
-- QSA entries intentionally exclude CPF/CNPJ of natural-person partners.
alter table public.suppliers
  add column if not exists cnpj_details jsonb not null default '{}'::jsonb,
  add column if not exists cnpj_source text,
  add column if not exists cnpj_consulted_at timestamptz;

alter table public.suppliers
  add constraint suppliers_cnpj_details_object_check
  check (jsonb_typeof(cnpj_details) = 'object');

alter table public.suppliers
  add constraint suppliers_cnpj_source_length_check
  check (cnpj_source is null or char_length(cnpj_source) <= 120);

comment on column public.suppliers.cnpj_details is
  'Normalized public company registration snapshot. QSA stores names, qualifications and entry dates only; no personal CPF/CNPJ.';
comment on column public.suppliers.cnpj_source is
  'Provider/source label for the latest successful CNPJ consultation.';
comment on column public.suppliers.cnpj_consulted_at is
  'Timestamp of the latest successful CNPJ consultation.';
