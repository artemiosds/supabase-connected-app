BEGIN;
ALTER TABLE public.document_templates
 ADD COLUMN IF NOT EXISTS template_type text NOT NULL DEFAULT 'custom',
 ADD COLUMN IF NOT EXISTS template_code text,
 ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
 ADD COLUMN IF NOT EXISTS catalog_template_id uuid,
 ADD COLUMN IF NOT EXISTS legal_basis text,
 ADD COLUMN IF NOT EXISTS source_reference text,
 ADD COLUMN IF NOT EXISTS variables_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
 ADD COLUMN IF NOT EXISTS change_summary text,
 ADD COLUMN IF NOT EXISTS is_base_template boolean NOT NULL DEFAULT false;
ALTER TABLE public.generated_documents
 ADD COLUMN IF NOT EXISTS process_id uuid,
 ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'custom',
 ADD COLUMN IF NOT EXISTS template_version integer,
 ADD COLUMN IF NOT EXISTS process_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN IF NOT EXISTS variables_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.document_templates'::regclass AND conname='document_templates_id_tenant_unique') THEN
  ALTER TABLE public.document_templates ADD CONSTRAINT document_templates_id_tenant_unique UNIQUE(id,tenant_id); END IF;
 IF pg_catalog.to_regclass('public.procurement_processes') IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=pg_catalog.to_regclass('public.procurement_processes') AND conname='procurement_processes_id_tenant_unique') THEN
  ALTER TABLE public.procurement_processes ADD CONSTRAINT procurement_processes_id_tenant_unique UNIQUE(id,tenant_id); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.document_templates'::regclass AND conname='document_templates_type_check') THEN
  ALTER TABLE public.document_templates ADD CONSTRAINT document_templates_type_check CHECK(template_type IN('dfd','etp','risk_analysis','risk_matrix','tr','custom')); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.document_templates'::regclass AND conname='document_templates_version_check') THEN
  ALTER TABLE public.document_templates ADD CONSTRAINT document_templates_version_check CHECK(version>=1); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.document_templates'::regclass AND conname='document_templates_vars_check') THEN
  ALTER TABLE public.document_templates ADD CONSTRAINT document_templates_vars_check CHECK(jsonb_typeof(variables_schema)='array'); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.generated_documents'::regclass AND conname='generated_documents_type_check') THEN
  ALTER TABLE public.generated_documents ADD CONSTRAINT generated_documents_type_check CHECK(document_type IN('dfd','etp','risk_analysis','risk_matrix','tr','custom')); END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_document_templates_tenant_type_active ON public.document_templates(tenant_id,template_type,is_active);
CREATE INDEX IF NOT EXISTS idx_generated_documents_process ON public.generated_documents(tenant_id,process_id,created_at DESC) WHERE process_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.document_template_catalog(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_code text NOT NULL,
 template_type text NOT NULL CHECK(template_type IN('dfd','etp','risk_analysis','risk_matrix','tr')),
 title text NOT NULL, description text, content text NOT NULL CHECK(length(content) BETWEEN 1 AND 50000),
 version integer NOT NULL DEFAULT 1 CHECK(version>=1), legal_basis text NOT NULL, source_reference text NOT NULL,
 variables_schema jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(variables_schema)='array'),
 is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(template_code,version)
);
ALTER TABLE public.document_templates DROP CONSTRAINT IF EXISTS document_templates_catalog_template_id_fkey;
ALTER TABLE public.document_templates ADD CONSTRAINT document_templates_catalog_template_id_fkey
 FOREIGN KEY(catalog_template_id) REFERENCES public.document_template_catalog(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_templates_tenant_catalog_active ON public.document_templates(tenant_id,catalog_template_id)
 WHERE catalog_template_id IS NOT NULL AND is_active;

ALTER TABLE public.document_template_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_template_catalog FROM anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.document_template_catalog TO authenticated;
DROP POLICY IF EXISTS p_template_catalog_select ON public.document_template_catalog;
CREATE POLICY p_template_catalog_select ON public.document_template_catalog FOR SELECT TO authenticated USING(
 (SELECT app_auth.is_platform_admin()) OR EXISTS(
  SELECT 1 FROM public.tenant_memberships tm WHERE tm.user_id=(SELECT auth.uid()) AND tm.status='active'
   AND (SELECT app_auth.is_tenant_in_good_standing(tm.tenant_id))
   AND (SELECT app_auth.is_tenant_module_enabled(tm.tenant_id,'modelos'))
   AND (SELECT app_auth.has_tenant_data_permission(tm.tenant_id,'documents:manage_templates'))
 ));
DROP POLICY IF EXISTS p_template_catalog_insert_master ON public.document_template_catalog;
CREATE POLICY p_template_catalog_insert_master ON public.document_template_catalog FOR INSERT TO authenticated WITH CHECK((SELECT app_auth.is_platform_admin()));
DROP POLICY IF EXISTS p_template_catalog_update_master ON public.document_template_catalog;
CREATE POLICY p_template_catalog_update_master ON public.document_template_catalog FOR UPDATE TO authenticated USING((SELECT app_auth.is_platform_admin())) WITH CHECK((SELECT app_auth.is_platform_admin()));
DROP POLICY IF EXISTS p_template_catalog_delete_master ON public.document_template_catalog;
CREATE POLICY p_template_catalog_delete_master ON public.document_template_catalog FOR DELETE TO authenticated USING((SELECT app_auth.is_platform_admin()));

CREATE TABLE IF NOT EXISTS public.document_template_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 template_id uuid NOT NULL, version integer NOT NULL CHECK(version>=1), title text NOT NULL, description text, content text NOT NULL,
 template_type text NOT NULL CHECK(template_type IN('dfd','etp','risk_analysis','risk_matrix','tr','custom')),
 template_code text, legal_basis text, source_reference text, variables_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
 change_summary text, created_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(template_id,version), FOREIGN KEY(template_id,tenant_id) REFERENCES public.document_templates(id,tenant_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_document_template_versions_lookup ON public.document_template_versions(tenant_id,template_id,version DESC);
ALTER TABLE public.document_template_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_template_versions FROM anon;
REVOKE INSERT,UPDATE,DELETE ON public.document_template_versions FROM authenticated;
GRANT SELECT ON public.document_template_versions TO authenticated;
DROP POLICY IF EXISTS p_document_template_versions_select ON public.document_template_versions;
CREATE POLICY p_document_template_versions_select ON public.document_template_versions FOR SELECT TO authenticated
 USING((SELECT app_auth.is_platform_admin()) OR (SELECT app_auth.has_tenant_data_permission(tenant_id,'documents:view')));
INSERT INTO public.document_template_versions(tenant_id,template_id,version,title,description,content,template_type,template_code,legal_basis,source_reference,variables_schema,change_summary,created_by,created_at)
 SELECT tenant_id,id,version,title,description,content,template_type,template_code,legal_basis,source_reference,variables_schema,
 'Snapshot inicial preservado ao ativar o historico.',updated_by,updated_at FROM public.document_templates ON CONFLICT(template_id,version) DO NOTHING;

CREATE OR REPLACE FUNCTION app_auth.bump_document_template_version() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $f$
BEGIN
 IF ROW(NEW.title,NEW.description,NEW.content,NEW.template_type,NEW.template_code,NEW.legal_basis,NEW.source_reference,NEW.variables_schema,NEW.is_base_template)
 IS DISTINCT FROM ROW(OLD.title,OLD.description,OLD.content,OLD.template_type,OLD.template_code,OLD.legal_basis,OLD.source_reference,OLD.variables_schema,OLD.is_base_template)
 THEN NEW.version:=OLD.version+1; ELSE NEW.version:=OLD.version; END IF; RETURN NEW;
END $f$;
CREATE OR REPLACE FUNCTION app_auth.archive_document_template_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO public.document_template_versions(tenant_id,template_id,version,title,description,content,template_type,template_code,legal_basis,source_reference,variables_schema,change_summary,created_by,created_at)
  VALUES(NEW.tenant_id,NEW.id,NEW.version,NEW.title,NEW.description,NEW.content,NEW.template_type,NEW.template_code,NEW.legal_basis,NEW.source_reference,NEW.variables_schema,COALESCE(NEW.change_summary,'Versao inicial.'),NEW.created_by,NEW.created_at)
  ON CONFLICT(template_id,version) DO NOTHING;
 ELSIF NEW.version IS DISTINCT FROM OLD.version THEN
  INSERT INTO public.document_template_versions(tenant_id,template_id,version,title,description,content,template_type,template_code,legal_basis,source_reference,variables_schema,change_summary,created_by,created_at)
  VALUES(OLD.tenant_id,OLD.id,OLD.version,OLD.title,OLD.description,OLD.content,OLD.template_type,OLD.template_code,OLD.legal_basis,OLD.source_reference,OLD.variables_schema,COALESCE(OLD.change_summary,'Versao anterior.'),OLD.updated_by,OLD.updated_at)
  ON CONFLICT(template_id,version) DO NOTHING;
  INSERT INTO public.document_template_versions(tenant_id,template_id,version,title,description,content,template_type,template_code,legal_basis,source_reference,variables_schema,change_summary,created_by,created_at)
  VALUES(NEW.tenant_id,NEW.id,NEW.version,NEW.title,NEW.description,NEW.content,NEW.template_type,NEW.template_code,NEW.legal_basis,NEW.source_reference,NEW.variables_schema,COALESCE(NEW.change_summary,'Nova versao.'),NEW.updated_by,NEW.updated_at)
  ON CONFLICT(template_id,version) DO NOTHING;
 END IF; RETURN NULL;
END $f$;
REVOKE ALL ON FUNCTION app_auth.bump_document_template_version() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION app_auth.archive_document_template_version() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_document_templates_version_bump ON public.document_templates;
CREATE TRIGGER trg_document_templates_version_bump BEFORE UPDATE ON public.document_templates FOR EACH ROW EXECUTE FUNCTION app_auth.bump_document_template_version();
DROP TRIGGER IF EXISTS trg_document_templates_version_history ON public.document_templates;
CREATE TRIGGER trg_document_templates_version_history AFTER INSERT OR UPDATE ON public.document_templates FOR EACH ROW EXECUTE FUNCTION app_auth.archive_document_template_version();

DO $$ BEGIN
 IF pg_catalog.to_regclass('public.procurement_processes') IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=pg_catalog.to_regclass('public.generated_documents') AND conname='generated_documents_process_tenant_fk') THEN
  ALTER TABLE public.generated_documents ADD CONSTRAINT generated_documents_process_tenant_fk
  FOREIGN KEY(process_id,tenant_id) REFERENCES public.procurement_processes(id,tenant_id) ON DELETE RESTRICT;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.fn_guard_generated_document_process_link() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $f$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.process_id IS DISTINCT FROM OLD.process_id OR NEW.document_type IS DISTINCT FROM OLD.document_type
 OR NEW.template_version IS DISTINCT FROM OLD.template_version OR NEW.process_snapshot IS DISTINCT FROM OLD.process_snapshot
 OR NEW.variables_snapshot IS DISTINCT FROM OLD.variables_snapshot) THEN RAISE EXCEPTION 'Vinculo e snapshots do processo sao imutaveis.'; END IF;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_guard_generated_document_process_link() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_generated_documents_process_link ON public.generated_documents;
CREATE TRIGGER trg_generated_documents_process_link BEFORE INSERT OR UPDATE ON public.generated_documents
 FOR EACH ROW EXECUTE FUNCTION public.fn_guard_generated_document_process_link();

INSERT INTO public.document_template_catalog(template_code,template_type,title,description,content,version,legal_basis,source_reference,variables_schema) VALUES
('DFD','dfd','DFD — Documento de Formalização da Demanda','Modelo-base orientativo; adaptar à regulamentação municipal.',
$dfd$# DOCUMENTO DE FORMALIZAÇÃO DA DEMANDA

**Secretaria:** {{secretaria}} | **Município/UF:** {{municipio}}/{{uf}}
**Processo:** {{numero_processo}} | **Data:** {{data_geracao}}

## Unidade requisitante e responsável
{{unidade_requisitante}}
{{responsavel}}

## Descrição da necessidade e interesse público
{{justificativa}}

## Objeto pretendido
{{objeto}}

## Resultados esperados
{{resultado_esperado}}

## Quantidades e memória de cálculo
{{quantitativos}}

## Estimativa preliminar, metodologia e fontes
{{valor_estimado}}
{{metodo_estimativa}}

## Alinhamento ao PCA, quando elaborado
{{referencia_pca}}

## Prioridade, prazo e justificativa
{{prioridade}} — {{prazo_desejado}}
{{justificativa_prazo}}

## Adequação orçamentária
{{dotacao_orcamentaria}}

## Providências iniciais e encaminhamento
{{providencias_iniciais}}

> MODELO-BASE ORIENTATIVO. Revisar conforme regulamento municipal, PCA e procedimentos internos. O sistema não declara aprovação automática.$dfd$,
1,'Lei nº 14.133/2021, arts. 12, 18 e 40; regulamento do ente.','https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm',
'[{"key":"resultado_esperado","label":"Resultados esperados","required":true},{"key":"quantitativos","label":"Quantidades/memória","required":true},{"key":"metodo_estimativa","label":"Método/fontes","required":true},{"key":"referencia_pca","label":"PCA","required":false},{"key":"justificativa_prazo","label":"Justificativa do prazo","required":false},{"key":"dotacao_orcamentaria","label":"Dotação","required":true},{"key":"providencias_iniciais","label":"Providências","required":false}]'::jsonb),
('ETP','etp','ETP — Estudo Técnico Preliminar','Modelo-base orientativo para o art. 18, §1º, da Lei 14.133/2021.',
$etp$# ESTUDO TÉCNICO PRELIMINAR

**Secretaria:** {{secretaria}} | **Processo:** {{numero_processo}}
**Objeto:** {{objeto}} | **Unidade:** {{unidade_requisitante}}
**Responsável:** {{responsavel}} | **Data:** {{data_geracao}}

## 1. Necessidade e interesse público
{{justificativa}}

## 2. PCA, quando elaborado
{{referencia_pca}}

## 3. Requisitos da contratação
{{requisitos_contratacao}}

## 4. Quantidades e memória de cálculo
{{quantitativos}}

## 5. Levantamento de mercado e alternativas
{{levantamento_mercado}}

## 6. Estimativa de valor e método
{{valor_estimado}}
{{metodo_estimativa}}

## 7. Solução como um todo
{{descricao_solucao}}

## 8. Parcelamento ou não
{{justificativa_parcelamento}}

## 9. Resultados, providências e contratações correlatas
{{resultado_esperado}}
{{providencias_previas}}
{{contratacoes_correlatas}}

## 10. Impactos ambientais
{{impactos_ambientais}}

## 11. Análise de riscos
{{analise_riscos}}

## 12. Conclusão sobre viabilidade
{{conclusao_viabilidade}}

## 13. Elementos não aplicáveis e justificativa
{{justificativa_nao_aplicabilidade}}

**Equipe:** {{equipe_planejamento}} | **Aprovação, quando exigida:** {{aprovacao}}

> Modelo-base orientativo. Adaptar ao objeto e ao regulamento. Preenchimento automático não substitui pesquisa ou análise técnica.$etp$,
1,'Lei nº 14.133/2021, art. 18, caput e §1º; IN SEGES 58/2022 quando aplicável.','https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm | https://www.gov.br/compras/pt-br/acesso-a-informacao/legislacao/instrucoes-normativas/instrucao-normativa-seges-no-58-de-8-de-agosto-de-2022',
'[{"key":"referencia_pca","label":"PCA","required":false},{"key":"requisitos_contratacao","label":"Requisitos","required":true},{"key":"quantitativos","label":"Quantidades","required":true},{"key":"levantamento_mercado","label":"Mercado","required":true},{"key":"metodo_estimativa","label":"Método da estimativa","required":true},{"key":"descricao_solucao","label":"Solução","required":true},{"key":"justificativa_parcelamento","label":"Parcelamento","required":true},{"key":"resultado_esperado","label":"Resultados","required":true},{"key":"providencias_previas","label":"Providências","required":false},{"key":"contratacoes_correlatas","label":"Contratações correlatas","required":false},{"key":"impactos_ambientais","label":"Impactos ambientais","required":false},{"key":"analise_riscos","label":"Riscos","required":true},{"key":"conclusao_viabilidade","label":"Conclusão","required":true},{"key":"justificativa_nao_aplicabilidade","label":"Não aplicáveis","required":false},{"key":"equipe_planejamento","label":"Equipe","required":true},{"key":"aprovacao","label":"Aprovação","required":false}]'::jsonb),
('MAPA_RISCOS','risk_analysis','Mapa de Análise de Riscos','Registro de riscos do planejamento/execução; distinto da matriz contratual.',
$mr$# MAPA DE ANÁLISE DE RISCOS

**Secretaria:** {{secretaria}} | **Processo:** {{numero_processo}}
**Objeto:** {{objeto}} | **Data:** {{data_geracao}}

## Metodologia e escalas
{{metodologia_riscos}}
**Probabilidade:** {{escala_probabilidade}}
**Impacto:** {{escala_impacto}}
**Classificação:** {{criterio_classificacao}}

## Registro dos riscos
{{riscos_identificados}}

Para cada risco registrar evento, etapa, causa, consequência, probabilidade, impacto, nível, medida preventiva, responsável, contingência e evidências.

## Acompanhamento e revisão
{{acompanhamento_riscos}}

## Riscos residuais e decisão
{{riscos_residuais}}

**Equipe:** {{equipe_planejamento}} | **Ciência:** {{aprovacao}}

> Este mapa não se confunde com a matriz contratual de alocação de riscos dos arts. 6º, XXVII, e 22 da Lei 14.133/2021.$mr$,
1,'Lei nº 14.133/2021, art. 18, X; matriz contratual: arts. 6º, XXVII, e 22.','https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm',
'[{"key":"metodologia_riscos","label":"Metodologia","required":true},{"key":"escala_probabilidade","label":"Probabilidade","required":true},{"key":"escala_impacto","label":"Impacto","required":true},{"key":"criterio_classificacao","label":"Classificação","required":true},{"key":"riscos_identificados","label":"Riscos","required":true},{"key":"acompanhamento_riscos","label":"Acompanhamento","required":false},{"key":"riscos_residuais","label":"Riscos residuais","required":false},{"key":"equipe_planejamento","label":"Equipe","required":true},{"key":"aprovacao","label":"Ciência","required":false}]'::jsonb),
('MATRIZ_RISCOS','risk_matrix','Matriz Contratual de Alocação de Riscos','Distribuição contratual de responsabilidades quando cabível ou exigida; distinta do mapa de riscos.',
$mx$# MATRIZ CONTRATUAL DE ALOCAÇÃO DE RISCOS

**Secretaria:** {{secretaria}} | **Processo:** {{numero_processo}} | **Objeto:** {{objeto}}

## 1. Enquadramento e justificativa
{{enquadramento_matriz}}

## 2. Metodologia e premissas
{{metodologia_alocacao}}

## 3. Eventos e distribuição de responsabilidades
{{eventos_alocacao}}

Para cada evento indicar parte responsável, prevenção/mitigação, efeitos financeiros e mecanismos de resposta/reequilíbrio.

## 4. Obrigações das partes
{{obrigacoes_partes}}

## 5. Equilíbrio econômico-financeiro
{{efeitos_equilibrio}}

## 6. Aprovação e integração ao contrato
{{aprovacao_matriz}}

> Instrumento distinto do mapa de análise de riscos. Justificar o uso à luz dos arts. 6º, XXVII, 22 e 103 da Lei 14.133/2021.$mx$,
1,'Lei nº 14.133/2021, arts. 6º, XXVII, 22 e 103.','https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm',
'[{"key":"enquadramento_matriz","label":"Enquadramento","required":true},{"key":"metodologia_alocacao","label":"Metodologia","required":true},{"key":"eventos_alocacao","label":"Eventos","required":true},{"key":"obrigacoes_partes","label":"Obrigações","required":true},{"key":"efeitos_equilibrio","label":"Equilíbrio","required":true},{"key":"aprovacao_matriz","label":"Aprovação","required":true}]'::jsonb),
('TR','tr','TR — Termo de Referência','Modelo-base orientativo com elementos do art. 6º, XXIII, da Lei 14.133/2021.',
$tr$# TERMO DE REFERÊNCIA

**Secretaria:** {{secretaria}} | **Município/UF:** {{municipio}}/{{uf}}
**Processo:** {{numero_processo}} | **Data:** {{data_geracao}}
**Unidade:** {{unidade_requisitante}} | **Responsável:** {{responsavel}}

## 1. Objeto, natureza, quantidades e prazo
**Objeto:** {{objeto}}
{{natureza_objeto}}
{{quantitativos}}
**Prazo:** {{prazo_execucao}} | **Prorrogação:** {{prorrogacao}}

## 2. Fundamentação
{{fundamentacao_contratacao}}

## 3. Solução e requisitos
{{descricao_solucao}}
{{requisitos_contratacao}}

## 4. Execução
{{modelo_execucao}}

## 5. Gestão e fiscalização
{{modelo_gestao}}
**Gestor:** {{gestor_contrato}} | **Fiscal:** {{fiscal_contrato}}

## 6. Medição e pagamento
{{criterios_medicao_pagamento}}

## 7. Seleção do fornecedor
{{criterios_selecao}}

## 8. Estimativa e memória de cálculo
{{valor_estimado}}
{{memoria_calculo_valor}}

## 9. Adequação orçamentária
{{dotacao_orcamentaria}}

## 10. Obrigações e sanções
**Contratada:** {{obrigacoes_contratada}}
**Contratante:** {{obrigacoes_contratante}}
**Sanções:** {{sancoes}}

## 11. Entrega e especificidades do objeto de saúde
{{local_prazo_entrega}}
{{requisitos_especificos_saude}}

> Modelo-base orientativo. Conferir legislação, regulamento local e objeto concreto. A IN SEGES/ME 81/2022 tem âmbito próprio de aplicação.$tr$,
1,'Lei nº 14.133/2021, arts. 6º, XXIII, 18 e 23; IN SEGES/ME 81/2022 quando aplicável.','https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm | https://www.gov.br/compras/pt-br/acesso-a-informacao/legislacao/instrucoes-normativas/instrucao-normativa-seges-me-no-81-de-25-de-novembro-de-2022',
'[{"key":"natureza_objeto","label":"Natureza","required":true},{"key":"quantitativos","label":"Quantidades","required":true},{"key":"prazo_execucao","label":"Prazo","required":true},{"key":"prorrogacao","label":"Prorrogação","required":false},{"key":"fundamentacao_contratacao","label":"Fundamentação","required":true},{"key":"descricao_solucao","label":"Solução","required":true},{"key":"requisitos_contratacao","label":"Requisitos","required":true},{"key":"modelo_execucao","label":"Execução","required":true},{"key":"modelo_gestao","label":"Gestão","required":true},{"key":"gestor_contrato","label":"Gestor","required":true},{"key":"fiscal_contrato","label":"Fiscal","required":true},{"key":"criterios_medicao_pagamento","label":"Medição/pagamento","required":true},{"key":"criterios_selecao","label":"Seleção","required":true},{"key":"memoria_calculo_valor","label":"Memória do valor","required":true},{"key":"dotacao_orcamentaria","label":"Dotação","required":true},{"key":"obrigacoes_contratada","label":"Obrigações contratada","required":true},{"key":"obrigacoes_contratante","label":"Obrigações contratante","required":true},{"key":"sancoes","label":"Sanções","required":true},{"key":"local_prazo_entrega","label":"Local/prazo","required":true},{"key":"requisitos_especificos_saude","label":"Requisitos de saúde","required":false}]'::jsonb)
ON CONFLICT(template_code,version) DO NOTHING;

CREATE OR REPLACE FUNCTION public.install_document_template(p_tenant_id uuid,p_catalog_template_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
DECLARE c public.document_template_catalog%ROWTYPE; new_id uuid;
BEGIN
 IF (SELECT auth.uid()) IS NULL OR NOT app_auth.has_tenant_data_permission(p_tenant_id,'documents:manage_templates')
 OR NOT app_auth.is_tenant_in_good_standing(p_tenant_id) OR NOT app_auth.is_tenant_module_enabled(p_tenant_id,'modelos') THEN
  RAISE EXCEPTION 'Sem permissao ou modulo de modelos indisponivel.' USING ERRCODE='42501';
 END IF;
 SELECT * INTO c FROM public.document_template_catalog WHERE id=p_catalog_template_id AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Modelo-base inexistente ou inativo.'; END IF;
 INSERT INTO public.document_templates(tenant_id,title,description,content,is_active,template_type,template_code,version,catalog_template_id,legal_basis,source_reference,variables_schema,change_summary,is_base_template)
 VALUES(p_tenant_id,c.title,c.description,c.content,true,c.template_type,c.template_code,1,c.id,c.legal_basis,c.source_reference,c.variables_schema,'Instalado do catalogo-base; adaptar ao regulamento municipal.',true)
 RETURNING id INTO new_id; RETURN new_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Este modelo ja foi instalado nesta Secretaria.';
END $f$;
REVOKE ALL ON FUNCTION public.install_document_template(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.install_document_template(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.generate_document_from_process(p_process_id uuid,p_template_id uuid,p_overrides jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
DECLARE p public.procurement_processes%ROWTYPE; t public.document_templates%ROWTYPE; org record;
 new_id uuid; vars jsonb; snap jsonb; body text; k text; v text; checklist jsonb; item jsonb;
 allowed text[]:=ARRAY['quantitativos','dotacao_orcamentaria','metodo_estimativa','referencia_pca','resultado_esperado','justificativa_prazo','providencias_iniciais','requisitos_contratacao','levantamento_mercado','descricao_solucao','justificativa_parcelamento','providencias_previas','contratacoes_correlatas','impactos_ambientais','analise_riscos','conclusao_viabilidade','justificativa_nao_aplicabilidade','equipe_planejamento','aprovacao','metodologia_riscos','escala_probabilidade','escala_impacto','criterio_classificacao','riscos_identificados','acompanhamento_riscos','riscos_residuais','enquadramento_matriz','metodologia_alocacao','eventos_alocacao','obrigacoes_partes','efeitos_equilibrio','aprovacao_matriz','natureza_objeto','prazo_execucao','prorrogacao','fundamentacao_contratacao','modelo_execucao','modelo_gestao','gestor_contrato','fiscal_contrato','criterios_medicao_pagamento','criterios_selecao','memoria_calculo_valor','obrigacoes_contratada','obrigacoes_contratante','sancoes','local_prazo_entrega','requisitos_especificos_saude'];
BEGIN
 IF (SELECT auth.uid()) IS NULL OR p_overrides IS NULL OR jsonb_typeof(p_overrides)<>'object' THEN RAISE EXCEPTION 'Sessao e complementos em objeto JSON obrigatorios.' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM public.procurement_processes WHERE id=p_process_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Processo nao encontrado ou sem acesso.'; END IF;
 IF NOT app_auth.has_tenant_data_permission(p.tenant_id,'documents:create') OR NOT app_auth.has_tenant_data_permission(p.tenant_id,'documents:view')
 OR NOT app_auth.is_tenant_in_good_standing(p.tenant_id) OR NOT app_auth.is_tenant_module_enabled(p.tenant_id,'processos')
 OR NOT app_auth.is_tenant_module_enabled(p.tenant_id,'documentos') OR NOT app_auth.is_tenant_module_enabled(p.tenant_id,'modelos') THEN
  RAISE EXCEPTION 'Acesso negado: verifique permissoes e modulos.' USING ERRCODE='42501';
 END IF;
 SELECT * INTO t FROM public.document_templates WHERE id=p_template_id AND tenant_id=p.tenant_id AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Modelo inexistente, inativo ou de outra Secretaria.'; END IF;
 FOR k IN SELECT jsonb_object_keys(p_overrides) LOOP
  IF NOT(k=ANY(allowed)) OR jsonb_typeof(p_overrides->k) NOT IN('string','number','boolean') THEN RAISE EXCEPTION 'Campo complementar invalido: %.',k; END IF;
 END LOOP;
 SELECT name,municipality,state INTO org FROM public.tenants WHERE id=p.tenant_id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('stage',stage,'title',title,'completed',is_done,'sort_order',sort_order) ORDER BY sort_order,created_at),'[]'::jsonb)
 INTO checklist FROM public.process_items WHERE process_id=p.id AND tenant_id=p.tenant_id;
 vars:=jsonb_build_object('secretaria',COALESCE(org.name,'[PREENCHER: secretaria]'),'municipio',COALESCE(org.municipality,'[PREENCHER: municipio]'),'uf',COALESCE(org.state,'[PREENCHER: uf]'),
 'numero_processo',p.number,'objeto',p.title,'justificativa',COALESCE(p.description,'[PREENCHER: justificativa]'),'modalidade',p.modality,'etapa_atual',p.stage,'situacao_processo',p.status,
 'prioridade',p.priority,'unidade_requisitante',COALESCE(p.requesting_unit,'[PREENCHER: unidade requisitante]'),'responsavel',COALESCE(p.responsible_name,'[PREENCHER: responsavel]'),
 'usuario_email',COALESCE((SELECT auth.jwt()->>'email'),''),'valor_estimado',CASE WHEN p.estimated_value IS NULL THEN '[PREENCHER: valor estimado]' ELSE 'R$ '||pg_catalog.to_char(p.estimated_value,'FM999G999G999G990D00') END,
 'prazo_desejado',COALESCE(pg_catalog.to_char(p.due_date,'DD/MM/YYYY'),'[PREENCHER: prazo desejado]'),'data_geracao',pg_catalog.to_char(pg_catalog.now(),'DD/MM/YYYY'));
 FOR item IN SELECT value FROM jsonb_array_elements(t.variables_schema) LOOP
  k:=item->>'key'; IF k IS NOT NULL AND NOT(vars?k) THEN vars:=vars||jsonb_build_object(k,'[PREENCHER: '||COALESCE(item->>'label',k)||']'); END IF;
 END LOOP;
 vars:=vars||p_overrides;
 snap:=jsonb_build_object('id',p.id,'tenant_id',p.tenant_id,'number',p.number,'title',p.title,'description',p.description,'modality',p.modality,'stage',p.stage,'status',p.status,'priority',p.priority,'requesting_unit',p.requesting_unit,'responsible_name',p.responsible_name,'estimated_value',p.estimated_value,'due_date',p.due_date,'checklist',checklist,'captured_at',pg_catalog.now());
 body:=t.content; FOR k,v IN SELECT key,value FROM jsonb_each_text(vars) LOOP body:=replace(body,'{{'||k||'}}',COALESCE(v,'[PREENCHER: '||k||']')); END LOOP;
 INSERT INTO public.generated_documents(tenant_id,process_id,template_id,title,content_snapshot,status,document_type,template_version,process_snapshot,variables_snapshot)
 VALUES(p.tenant_id,p.id,t.id,t.title||' - Processo '||p.number,body,'draft',t.template_type,t.version,snap,vars) RETURNING id INTO new_id;
 RETURN new_id;
END $f$;
REVOKE ALL ON FUNCTION public.generate_document_from_process(uuid,uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.generate_document_from_process(uuid,uuid,jsonb) TO authenticated;
COMMENT ON TABLE public.document_template_catalog IS 'Catalogo de modelos-base orientativos; requer adaptacao e revisao juridica local.';
COMMENT ON TABLE public.document_template_versions IS 'Historico imutavel das versoes de modelos por Secretaria.';
COMMENT ON COLUMN public.generated_documents.process_id IS 'Processo de origem; FK composta protege tenant_id.';
COMMENT ON COLUMN public.generated_documents.process_snapshot IS 'Snapshot do processo no momento da geracao.';
COMMIT;