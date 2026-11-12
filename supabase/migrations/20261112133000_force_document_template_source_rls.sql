BEGIN;
ALTER TABLE public.document_template_sources FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.document_template_sources IS
  'DOCX original privado por versão; RLS forçada para também proteger o proprietário da tabela.';
COMMIT;
