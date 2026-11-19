BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(6);

SELECT extensions.ok(
  EXISTS (
    SELECT 1
    FROM public.document_template_catalog
    WHERE template_code = 'ADITIVO_PRORROGACAO_CONTINUO'
      AND version = 1
      AND is_active
  ),
  'the continuous renewal addendum template is available in the base catalog'
);

SELECT extensions.is(
  (
    SELECT template_type
    FROM public.document_template_catalog
    WHERE template_code = 'ADITIVO_PRORROGACAO_CONTINUO'
      AND version = 1
  ),
  'term_addendum_renewal',
  'the catalog template has a dedicated document type'
);

SELECT extensions.ok(
  (
    SELECT variables_schema @> '[
      {"key":"natureza_continuada","required":true,"source":"manual"},
      {"key":"previsao_edital_contrato","required":true,"source":"manual"},
      {"key":"analise_vantajosidade","required":true,"source":"manual"},
      {"key":"autorizacao_autoridade","required":true,"source":"manual"},
      {"key":"nova_vigencia_fim","required":true,"source":"manual"}
    ]'::jsonb
    FROM public.document_template_catalog
    WHERE template_code = 'ADITIVO_PRORROGACAO_CONTINUO'
      AND version = 1
  ),
  'the draft requires the legal and administrative checks before use'
);

SELECT extensions.ok(
  (
    SELECT content LIKE '%{{numero_contrato}}%'
       AND content LIKE '%{{nova_vigencia_fim}}%'
       AND content LIKE '%{{analise_vantajosidade}}%'
       AND content ILIKE '%não utilizar automaticamente%'
    FROM public.document_template_catalog
    WHERE template_code = 'ADITIVO_PRORROGACAO_CONTINUO'
      AND version = 1
  ),
  'the draft includes contract data, required manual fields and a scope warning'
);

SELECT extensions.ok(
  (
    SELECT source_reference LIKE '%gov.br/agu%'
       AND source_reference LIKE '%ManualoperacionalFiscalizao_final.pdf%'
       AND source_reference LIKE '%planalto.gov.br%'
    FROM public.document_template_catalog
    WHERE template_code = 'ADITIVO_PRORROGACAO_CONTINUO'
      AND version = 1
  ),
  'the template cites the official AGU, MGI and Planalto references'
);

SELECT extensions.ok(
  (
    SELECT count(*) = 4
    FROM pg_catalog.pg_constraint
    WHERE conrelid IN (
      'public.document_template_catalog'::regclass,
      'public.document_templates'::regclass,
      'public.document_template_versions'::regclass,
      'public.generated_documents'::regclass
    )
      AND contype = 'c'
      AND pg_catalog.pg_get_constraintdef(oid) ILIKE '%term_addendum_renewal%'
  ),
  'all four document type constraints accept the new template type'
);

SELECT * FROM extensions.finish();
ROLLBACK;
