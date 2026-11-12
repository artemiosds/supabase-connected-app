BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(13);

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


SELECT extensions.ok(
  (SELECT c.relrowsecurity AND c.relforcerowsecurity
   FROM pg_catalog.pg_class c
   WHERE c.oid = 'public.generated_document_workflows'::regclass),
  'document workflow table enforces row-level security'
);
SELECT extensions.ok(
  (SELECT c.relrowsecurity AND c.relforcerowsecurity
   FROM pg_catalog.pg_class c
   WHERE c.oid = 'public.generated_document_workflow_events'::regclass),
  'document workflow event table enforces row-level security'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='generated_document_workflows'
      AND policyname='p_document_workflows_read'
      AND roles=ARRAY['authenticated'::name]
      AND cmd='SELECT'
  )
  AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='generated_document_workflow_events'
      AND policyname='p_document_workflow_events_read'
      AND roles=ARRAY['authenticated'::name]
      AND cmd='SELECT'
  ),
  'workflow and event rows are exposed only through authenticated read policies'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.generated_document_workflows'::regclass
      AND conname='fk_document_workflow_document'
      AND contype='f'
  ),
  'workflow document relationship is enforced by a database foreign key'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.transition_generated_document_workflow(uuid,uuid,text,text)'::regprocedure
  ) LIKE '%d.tenant_id=p_tenant_id%'
  AND pg_catalog.pg_get_functiondef(
    'public.transition_generated_document_workflow(uuid,uuid,text,text)'::regprocedure
  ) LIKE '%FOR UPDATE%'
  AND pg_catalog.pg_get_functiondef(
    'public.transition_generated_document_workflow(uuid,uuid,text,text)'::regprocedure
  ) LIKE '%is_tenant_module_enabled%',
  'workflow transition scopes the document to its tenant, locks rows and checks module availability'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.transition_generated_document_workflow(uuid,uuid,text,text)'::regprocedure
  ) LIKE '%v_workflow.submitted_by=v_actor%'
  AND pg_catalog.pg_get_functiondef(
    'public.transition_generated_document_workflow(uuid,uuid,text,text)'::regprocedure
  ) LIKE '%length(v_comment)<5%',
  'approval requires a different actor and rejection requires a reason'
);
SELECT extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.transition_generated_document_workflow(uuid,uuid,text,text)'::regprocedure
  ) LIKE '%generated_document_workflow_events%'
  AND pg_catalog.pg_get_functiondef(
    'public.transition_generated_document_workflow(uuid,uuid,text,text)'::regprocedure
  ) LIKE '%audit_events%',
  'every workflow transition records both a workflow event and an audit event'
);

-- Behavioral fail-closed checks: no identity and a valid identity without
-- membership in the requested tenant must never advance a workflow.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{}', true);
SELECT extensions.throws_ok(
  $SELECT public.transition_generated_document_workflow(
    '00000000-0000-4000-8000-000000000010'::uuid,
    '00000000-0000-4000-8000-000000000011'::uuid,
    'submit', NULL
  )$,
  '42501',
  'Sessão autenticada obrigatória.',
  'workflow transition rejects a request without an authenticated identity'
);

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000012',
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000012","role":"authenticated"}',
  true
);
SELECT extensions.throws_ok(
  $SELECT public.transition_generated_document_workflow(
    '00000000-0000-4000-8000-000000000013'::uuid,
    '00000000-0000-4000-8000-000000000014'::uuid,
    'submit', NULL
  )$,
  '42501',
  'Secretaria inativa ou módulo de documentos indisponível.',
  'workflow transition rejects a user without access to the requested tenant'
);

SELECT * FROM extensions.finish();
ROLLBACK;
