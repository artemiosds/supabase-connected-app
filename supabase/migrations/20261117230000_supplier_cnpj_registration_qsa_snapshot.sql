BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

-- Snapshot cadastral obtido em consulta pública. Mantém os dados vinculados
-- ao fornecedor e, portanto, ao mesmo tenant/RLS já aplicado em suppliers.
ALTER TABLE public.suppliers
  ADD COLUMN cnpj_registration_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN cnpj_qsa jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN cnpj_consulted_at timestamptz,
  ADD COLUMN cnpj_data_sources text[] NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_cnpj_registration_data_object
    CHECK (jsonb_typeof(cnpj_registration_data) = 'object'),
  ADD CONSTRAINT suppliers_cnpj_qsa_array
    CHECK (
      CASE
        WHEN jsonb_typeof(cnpj_qsa) = 'array'
          THEN jsonb_array_length(cnpj_qsa) <= 300
        ELSE false
      END
    ),
  ADD CONSTRAINT suppliers_cnpj_data_sources_valid
    CHECK (
      cardinality(cnpj_data_sources) <= 5
      AND array_position(cnpj_data_sources, '') IS NULL
    );

COMMENT ON COLUMN public.suppliers.cnpj_registration_data IS
  'Snapshot informativo de dados cadastrais públicos retornados por consulta de CNPJ; não representa certidão oficial.';
COMMENT ON COLUMN public.suppliers.cnpj_qsa IS
  'QSA público normalizado, limitado a 300 participantes e sem armazenar CPF/documentos pessoais.';
COMMENT ON COLUMN public.suppliers.cnpj_consulted_at IS
  'Instante da consulta às fontes públicas de CNPJ.';
COMMENT ON COLUMN public.suppliers.cnpj_data_sources IS
  'Fontes públicas que contribuíram para o snapshot cadastral.';

COMMIT;
