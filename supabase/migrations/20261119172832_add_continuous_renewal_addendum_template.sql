BEGIN;

-- Keep document type constraints aligned across the catalog, tenant copies,
-- version history and generated drafts.
DO $migration$
DECLARE
  target_table regclass;
  constraint_row record;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'public.document_template_catalog'::regclass,
    'public.document_templates'::regclass,
    'public.document_template_versions'::regclass,
    'public.generated_documents'::regclass
  ] LOOP
    FOR constraint_row IN
      SELECT conname
      FROM pg_catalog.pg_constraint
      WHERE conrelid = target_table
        AND contype = 'c'
        AND pg_catalog.pg_get_constraintdef(oid) ILIKE
          CASE
            WHEN target_table = 'public.generated_documents'::regclass THEN '%document_type%'
            ELSE '%template_type%'
          END
    LOOP
      EXECUTE pg_catalog.format(
        'ALTER TABLE %s DROP CONSTRAINT %I',
        target_table,
        constraint_row.conname
      );
    END LOOP;
  END LOOP;
END
$migration$;

ALTER TABLE public.document_template_catalog
  ADD CONSTRAINT document_template_catalog_template_type_check
  CHECK (template_type IN ('dfd', 'etp', 'risk_analysis', 'risk_matrix', 'tr', 'term_addendum_renewal'));

ALTER TABLE public.document_templates
  ADD CONSTRAINT document_templates_type_check
  CHECK (template_type IN ('dfd', 'etp', 'risk_analysis', 'risk_matrix', 'tr', 'custom', 'term_addendum_renewal'));

ALTER TABLE public.document_template_versions
  ADD CONSTRAINT document_template_versions_template_type_check
  CHECK (template_type IN ('dfd', 'etp', 'risk_analysis', 'risk_matrix', 'tr', 'custom', 'term_addendum_renewal'));

ALTER TABLE public.generated_documents
  ADD CONSTRAINT generated_documents_type_check
  CHECK (document_type IN ('dfd', 'etp', 'risk_analysis', 'risk_matrix', 'tr', 'custom', 'term_addendum_renewal'));

INSERT INTO public.document_template_catalog (
  template_code,
  template_type,
  title,
  description,
  content,
  version,
  legal_basis,
  source_reference,
  variables_schema
)
VALUES (
  'ADITIVO_PRORROGACAO_CONTINUO',
  'term_addendum_renewal',
  'Minuta — Termo aditivo de prorrogação de serviços e fornecimentos contínuos',
  'Modelo-base orientativo para preparar a minuta de prorrogação de contratos contínuos. Exige conferência do edital, do contrato, da vantajosidade, da documentação e do regulamento local.',
  $aditivo$# MINUTA ORIENTATIVA — TERMO ADITIVO DE PRORROGAÇÃO DE VIGÊNCIA

> **ATENÇÃO:** modelo orientativo para contratos de serviços ou fornecimentos contínuos, quando houver previsão no edital e no contrato e estiver demonstrada a vantagem para a Administração, nos termos do art. 107 da Lei nº 14.133/2021. Não utilizar automaticamente para contratos por escopo (art. 111), atas de registro de preços ou regimes especiais. Conferir o regulamento do ente e submeter à análise jurídica aplicável. A geração cria somente um rascunho; não autoriza nem formaliza a prorrogação.

## 1. Identificação das partes e do ajuste

**Órgão/Secretaria:** {{secretaria}}
**Município/UF:** {{municipio}}/{{uf}} — **CNPJ:** {{cnpj_secretaria}}
**Processo administrativo:** {{numero_processo}}
**Contrato:** {{numero_contrato}}
**Contratada:** {{fornecedor}} — **CNPJ:** {{cnpj}}
**Objeto:** {{objeto_contrato}}
**Vigência cadastrada:** {{data_inicio}} a {{data_fim}}
**Valor global cadastrado:** {{valor_contrato}}
**Gestor:** {{gestor_contrato}} — **Fiscal:** {{fiscal_contrato}}
**Ato de designação:** {{portaria_fiscal}}

## 2. Fundamentação e instrução processual

A presente minuta parte da premissa de que o objeto possui natureza contínua e de que a prorrogação é juridicamente admitida. Antes de sua utilização, devem constar dos autos, conforme o regime jurídico e a regulamentação aplicáveis:

- **Fundamento legal e cláusula contratual:** {{fundamento_prorrogacao}}
- **Demonstração da natureza contínua do objeto:** {{natureza_continuada}}
- **Previsão no edital e no contrato:** {{previsao_edital_contrato}}
- **Relatório de execução e fiscalização:** {{relatorio_execucao}}
- **Justificativa escrita do interesse público na continuidade:** {{justificativa_interesse_publico}}
- **Análise de vantajosidade, preços e eventual negociação:** {{analise_vantajosidade}}
- **Manifestação expressa da contratada:** {{manifestacao_contratada}}
- **Comprovação de manutenção das condições de habilitação:** {{habilitacao_atualizada}}
- **Autorização prévia da autoridade competente:** {{autorizacao_autoridade}}
- **Disponibilidade orçamentária e adequação para o período:** {{dotacao_orcamentaria_prorrogacao}}
- **Parecer jurídico ou referencial, conforme a regra local:** {{parecer_juridico}}

## 3. Cláusulas propostas

### CLÁUSULA PRIMEIRA — DO OBJETO E DO PRAZO

O presente termo aditivo tem por objeto prorrogar a vigência do Contrato nº {{numero_contrato}}, cujo objeto é {{objeto_contrato}}, pelo prazo de {{prazo_prorrogacao}}, com término previsto para {{nova_vigencia_fim}}, observados o fundamento legal, as condições do edital e do contrato e o limite máximo de vigência aplicável.

### CLÁUSULA SEGUNDA — DO VALOR E DAS CONDIÇÕES ECONÔMICAS

O valor previsto para o período prorrogado é de {{valor_periodo_prorrogado}}. Permanecem aplicáveis os preços e as condições contratuais cuja manutenção tenha sido justificada e autorizada no processo. Eventual reajuste, repactuação ou reequilíbrio deverá observar seu fundamento e instrumento próprios, sem presunção de concessão por esta minuta.

### CLÁUSULA TERCEIRA — DA RATIFICAÇÃO

Permanecem ratificadas as demais cláusulas e condições do contrato original e de seus aditivos anteriores que não conflitarem com este instrumento.

### CLÁUSULA QUARTA — DA PUBLICIDADE E DA EFICÁCIA

A Administração providenciará a divulgação e os registros exigidos pela legislação e pelo regulamento aplicáveis, inclusive no PNCP quando cabível.

## 4. Assinaturas

**Representantes e qualificação das partes:** {{representantes_partes}}

**Local e data:** {{local_data_assinatura}}

---

## 5. Conferência obrigatória antes de utilizar

1. Confirmar que se trata de serviço ou fornecimento contínuo e que o edital e o contrato admitem a prorrogação.
2. Verificar a vigência total acumulada e o limite legal aplicável.
3. Concluir a instrução processual, a análise de vantagem, a disponibilidade orçamentária e as autorizações exigidas.
4. Formalizar o instrumento antes do encerramento da vigência, observando a orientação aplicável ao caso.
5. Adaptar o texto ao regulamento municipal, às cláusulas do ajuste e à manifestação jurídica competente.

**Referências de apoio:** Lei nº 14.133/2021, arts. 105, 107 e 111; modelos de termos aditivos da AGU (referência federal); Manual Operacional de Gestão e Fiscalização Contratual do MGI (referência federal). Este modelo não substitui parecer jurídico, autorização da autoridade ou revisão do caso concreto.$aditivo$,
  1,
  'Lei nº 14.133/2021, arts. 105, 107 e 111; regulamento do ente. Modelos e orientações federais são referências de apoio e não substituem a regulamentação municipal.',
  'https://www.gov.br/agu/pt-br/composicao/cgu/cgu/modelos/licitacoesecontratos/14133/termos-aditivos | https://www.gov.br/compras/pt-br/acesso-a-informacao/manuais/manual-governanca-nas-contratacoes/Rev_ManualoperacionalFiscalizao_final.pdf | https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm',
  '[
    {"key":"fundamento_prorrogacao","label":"Fundamento legal e cláusula contratual","required":true,"source":"manual"},
    {"key":"natureza_continuada","label":"Natureza contínua do objeto","required":true,"source":"manual"},
    {"key":"previsao_edital_contrato","label":"Previsão no edital e no contrato","required":true,"source":"manual"},
    {"key":"relatorio_execucao","label":"Relatório de execução e fiscalização","required":true,"source":"manual"},
    {"key":"justificativa_interesse_publico","label":"Justificativa do interesse público","required":true,"source":"manual"},
    {"key":"analise_vantajosidade","label":"Análise de vantajosidade e preços","required":true,"source":"manual"},
    {"key":"manifestacao_contratada","label":"Manifestação expressa da contratada","required":true,"source":"manual"},
    {"key":"habilitacao_atualizada","label":"Comprovação de habilitação atualizada","required":true,"source":"manual"},
    {"key":"autorizacao_autoridade","label":"Autorização prévia da autoridade competente","required":true,"source":"manual"},
    {"key":"dotacao_orcamentaria_prorrogacao","label":"Disponibilidade orçamentária","required":true,"source":"manual"},
    {"key":"prazo_prorrogacao","label":"Prazo da prorrogação","required":true,"source":"manual"},
    {"key":"nova_vigencia_fim","label":"Nova data final da vigência","required":true,"source":"manual"},
    {"key":"valor_periodo_prorrogado","label":"Valor para o período prorrogado","required":false,"source":"manual"},
    {"key":"parecer_juridico","label":"Parecer jurídico ou referencial, conforme regra local","required":false,"source":"manual"},
    {"key":"representantes_partes","label":"Representantes e qualificação das partes","required":true,"source":"manual"},
    {"key":"local_data_assinatura","label":"Local e data da assinatura","required":true,"source":"manual"}
  ]'::jsonb
)
ON CONFLICT (template_code, version) DO NOTHING;

COMMIT;
