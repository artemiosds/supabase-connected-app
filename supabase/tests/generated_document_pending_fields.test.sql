BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(4);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid = 'public.transition_generated_document_workflow(uuid,uuid,text,text)'::regprocedure
  ),
  'document workflow transition function exists'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.transition_generated_document_workflow(uuid,uuid,text,text)'::regprocedure
  ) LIKE '%[PREENCHER:%'
  AND pg_catalog.pg_get_functiondef(
    'public.transition_generated_document_workflow(uuid,uuid,text,text)'::regprocedure
  ) LIKE '%[CAMPO NÃO CONFIGURADO:%',
  'submission blocks missing values and unconfigured template variables'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.transition_generated_document_workflow(uuid,uuid,text,text)'::regprocedure
  ) LIKE '%content_snapshot ~%',
  'submission also blocks unresolved double-brace placeholders'
);
SELECT extensions.ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']
   FROM pg_catalog.pg_proc
   WHERE oid = 'public.transition_generated_document_workflow(uuid,uuid,text,text)'::regprocedure)
  AND pg_catalog.has_function_privilege(
    'authenticated',
    'public.transition_generated_document_workflow(uuid,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'anon',
    'public.transition_generated_document_workflow(uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'workflow gate remains a fixed-search-path authenticated-only security definer'
);

SELECT * FROM extensions.finish();
ROLLBACK;
