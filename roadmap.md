# Roadmap — Gestão de Fornecedores da Saúde

> **Estado consolidado em 16/11/2026.** O diagnóstico operacional detalhado está em [docs/GO-LIVE-CHECKLIST.md](docs/GO-LIVE-CHECKLIST.md).
>
> - Repositório: `artemiosds/supabase-connected-app`, branch `main`. A última consulta encontrou o commit documental `80ac3ad9174f33d5928657edf4cd2e77d69df3c5`, que atualiza o checklist GO/NO-GO.
> - SMS2: 91 migrations aplicadas na consulta mais recente; as duas migrations documentais de 16/11 constam como aplicadas. Não reaplicar nem executar `db push` sem reconciliação explícita do histórico.
> - Schema público: tabelas retornadas com RLS e políticas. A cobertura de autorização deve continuar sendo comprovada por testes comportamentais, por papel e tenant.
> - Auditoria SQL: 73 funções públicas `SECURITY DEFINER`, todas com `search_path` fixado; nenhuma executável por `anon`; 36 executáveis por `authenticated` exigem revisão individual de autorização interna.
> - CI do commit de aplicação `000ba78f62750fcfb1623b4617e514c174aab638`: validação e formatação passaram; E2E autenticado estava em execução na última consulta. O commit documental posterior `80ac3ad` disparou nova validação; acompanhar seus resultados separadamente.
> - O E2E de navegador inclui fluxo de compras/contratos e cenários de isolamento. Não declarar cobertura completa antes do resultado final e da revisão dos cenários executados.
> - Backup criptografado/restauração sintéticos não equivalem a backup real recuperável do SMS2. Envio real de e-mail, Drive OAuth, gateway de cobrança, documentos oficiais, GED completo, homologação municipal e aceite formal permanecem pendentes.
> - **NO-GO para produção/comercialização** até fechar os gates do checklist. Prioridade imediata: concluir CI/E2E no HEAD atual, corrigir falhas comprovadas e ampliar homologação do GED de fornecedores, aditivos, convites e permissões.

## Registro histórico — fotografia anterior a 11/11/2026

O bloco abaixo registra o estado anterior e não deve orientar alterações no SMS2. Para o estado atual, use o resumo verificado no início deste documento.

- SMS2 tinha **59 migrations aplicadas** até `20261110121336`.
- Repositório `main` tem a migration adicional `20261110143000` para explicitar negação RLS e indexar FKs de suporte; já está no código, mas ainda não foi aplicada ao SMS2. O PR #12 prepara a política restritiva e amplia testes; aguarda CI.
- 32 tabelas públicas, todas com RLS; 21 com FORCE RLS; 114 políticas.
- 1 Secretaria, 1 vínculo municipal, 1 Master, 2 contas Auth.
- Equipe Interna: cinco perfis e sete permissões; zero funcionários.
- Suporte técnico: zero técnicos, atribuições e sessões.
- Quatro Edge Functions ativas: convites municipais v12, configuração de cobrança v10, convite suporte v3, convite equipe interna v1.
- Nenhum dado operacional (fornecedores/documentos/processos/contratos); cinco modelos-base globais e GED privado sem objetos.
- O sino visual já reúne vencimentos de contratos e documentos de fornecedores; ainda sem scheduler/e-mail/WhatsApp. Google Drive OAuth, gateway ativo e backup restaurado continuam pendentes.

## Atualizações de construção — 11/11/2026

- Fase 1 — Documentos: catálogo de campos automáticos, geração server-side vinculada a processo/contrato, fonte DOCX privada por versão, substituição de placeholders fragmentados, linhas repetíveis, exportação Word e PDF com timbrado configurável, prévia e bloqueio de campos pendentes. O editor visual rico e a homologação visual/E2E ainda permanecem pendentes; três migrations documentais futuras não foram aplicadas ao SMS2.
- Fase 2 — Pesquisa de preços: média, mediana, menor preço unitário com frete rateado, coeficiente de variação e CSV compatível com Excel; nenhum valor é excluído automaticamente.
- Fase 3 — Workflow: dez etapas, responsável/prazo por atividade e constraints do banco atualizadas. Código em `main`; migration não aplicada ao SMS2.
- Fase 4 — Sanções: histórico por Secretaria, período, fundamento, referência, revogação auditada e sinalização visual de vigência. Migration versionada; saldo por item de contrato/ARP ainda pendente.
- Fases 5–6 seguem pendentes: relatórios, integrações externas, restauração, isolamento multi-tenant e homologação real.

## Atualização de construção — continuidade em 11/11/2026

- Commit atual de base: `64069a0f044d56b399fd6ed602f564c43ee46f90` (`fix: extend procurement stage constraints`). O CI associado ainda não retornou verificações no conector durante esta etapa.
- A tela de fornecedores agora está sendo ampliada com histórico de sanções por Secretaria, revogação auditada, validade visual calculada no cliente e migration/RLS versionadas. Esta mudança está em preparação; não foi aplicada ao SMS2.
- O saldo de contratos/Atas, relatórios, exportações adicionais, Word/PDF fiel, integrações externas e homologação com duas Secretarias seguem pendentes.

## Resumo por fase

| Fase | Situação | Próximo marco |
| --- | --- | --- |
| 0 — Base técnica | CI de código aprovada | Proteção de branch, publicação e operação |
| 1 — Multitenant/RLS | E2E sintético de duas Secretarias aprovado | Homologar com usuários e perfis municipais |
| 2 — Fornecedores/GED/Documentos | Fornecedores, DOCX e timbrado cobertos parcialmente no E2E | GED de fornecedor e documentos oficiais |
| 3 — Compras/Contratos | Schema, telas e testes SQL presentes; E2E amplo pendente | Percorrer processo, cotações, orçamento, contrato e aditivos |
| 4 — Usuários/Equipe/Suporte | Estrutura e Edge Functions ativas | Testar ciclo de convites e entrega de e-mail |
| 5 — Alertas/Integrações | Dry-run disponível; integrações externas não homologadas | Agenda/email, Drive OAuth e gateway em sandbox |
| 6 — Backup/Continuidade | Restauração sintética aprovada | Backup e restore reais em projeto isolado |
| 7 — Comercial/Produção | Bloqueada | Domínio, jurídico, SLA, aceite e piloto |

## Decisão
**NO-GO para produção comercial.** Não reconstruir os módulos já implementados. Priorizar E2E de compras/contratos e GED de documentos de fornecedores no banco descartável; depois seguir para homologação municipal, restore real e integrações controladas. Alertas visuais não significam envio automático de e-mail.

## Atualização de implantação — 10/11/2026, conferência direta

Esta atualização prevalece sobre os retratos anteriores deste documento.

- As quatro migrations pendentes foram aplicadas ao SMS2: políticas restritivas internas, revogação de convites, sete índices de FKs e outbox de alertas.
- SMS2 agora registra 63 migrations. A outbox existe, força RLS e não permite leitura nem claim pelo papel authenticated; service_role pode executar claim.
- Cinco políticas restritivas internas, sete índices e ambas as RPCs de revogação foram confirmados por consulta ao catálogo.
- O Supabase atribuiu versões de execução diferentes das versões dos arquivos. A reconciliação do histórico foi bloqueada pela revisão automática e NÃO foi executada. Não executar db push indiscriminadamente.

| Versão do arquivo | Versão registrada no SMS2 |
| --- | --- |
| 20261110143000 | 20261110180336 |
| 20261110144000 | 20261110180349 |
| 20261110150000 | 20261110180400 |
| 20261110151000 | 20261110180414 |

A baseline 20261106194000 também continua sem versão correspondente no histórico remoto; avaliar equivalência antes de qualquer reparo.

Cinco Edge Functions estavam ativas na auditoria, incluindo send-expiry-notifications. Sua dependência de banco foi implantada nesta etapa; envio efetivo, secrets e scheduler ainda não foram homologados. O CI do commit 9dbf29f passou build, testes, tipos, lint e regressões de banco local. A verificação desta implantação foi de catálogo/permissões; não substitui E2E autenticado.

Continuam pendentes: reconciliação do histórico, configuração e entrega de e-mail, homologação com duas Secretarias, GED no navegador, backup/restauração em ambiente separado, domínio/publicação e requisitos comerciais. Nenhum e-mail foi enviado nem dado operacional de teste persistido nesta etapa. NO-GO comercial permanece.


## Atualização de construção — saldo de contratos/Atas

- Código em `main`: migration versionada para classificar contrato/ARP, registrar itens e controlar consumo por ledger auditável com estorno justificado; tela de saldo integrada ao módulo de contratos.
- Verificação: CI completo do commit `9f2dc56` passou, incluindo banco descartável e pgTAP; homologação visual/E2E por perfis segue pendente.
- A migration não foi aplicada ao SMS2; nenhum dado de produção foi alterado.


## Relatórios gerenciais — atualização

- Fornecedores, processos e contratos/Atas têm exportação da lista e dos filtros ativos em CSV UTF-8 compatível com Excel.
- O gerador protege campos de texto contra injeção de fórmulas e os testes unitários cobrem codificação, aspas, valores nulos/zero e entradas maliciosas.
- PDF gerencial pode ser salvo pela impressão do navegador, sem timbre oficial e sem renderização server-side. XLSX nativo agora é gerado com texto seguro, números tipados, filtro e cabeçalho fixo; CSV continua disponível.


## XLSX gerencial — 12/11/2026

- Exportação nativa em `.xlsx` disponível para as listas filtradas de fornecedores, processos e contratos/Atas usando a dependência JSZip existente.
- Verificação local: arquivo lido com `openpyxl`, testes de estrutura e conteúdo passaram, TypeScript, lint localizado, formatação e build passaram.
- CI do commit `9f2dc56` passou formatação, testes, build, tipos, lint, migrations em banco descartável e pgTAP. Validação visual no Excel/LibreOffice e E2E autenticado continuam pendentes. Nenhuma migration foi aplicada ao SMS2 nesta etapa.


## Documentos — exportação de rascunhos

- Word e PDF de rascunhos agora são gerados a partir do texto revisado usando o motor DOCX/PDF existente; cabeçalho com nome da Secretaria e aviso de rascunho.
- O DOCX original agora é vinculado de forma privada à versão do modelo e pode ser reutilizado na exportação Word; editar o texto na tela desvincula a fonte. O PDF usa renderizador próprio e timbrado por Secretaria, mas não é conversor Word completo.
- Não afirmar fidelidade visual integral nem assinatura qualificada antes da homologação.


## Fonte binária dos modelos — 12/11/2026

- O DOCX importado passa a ser anexado em Storage privado à versão imutável do modelo, sem alterar a edição de texto. O Word exportado usa o original somente para rascunho não editado com valores de snapshot consistentes; a revisão humana permanece soberana.
- A migration está no repositório e aguarda reconciliação do histórico do SMS2 para publicação. Layout Word complexo, imagens em PDF, brasão configurável, identidade visual oficial e homologação autenticada seguem pendentes.


## Atualização — PR #18 e conciliação de nomes (12/11/2026)

O PR #18 acrescentou seis índices de chaves estrangeiras; o PR #22 adicionou a remoção de sete políticas SELECT redundantes. O motor documental também recebeu duas migrations futuras adicionais para timbrado por Secretaria e bloqueio de campos não configurados. O repositório tem 82 arquivos SQL; oito migrations permanecem pendentes no SMS2: `20261112124000_document_template_binary_source.sql`, `20261112124500_tenant_document_branding.sql`, `20261112125000_block_unconfigured_document_fields.sql`, `20261112125500_guard_procurement_process_stage_transitions.sql`, `20261112132000_harden_procurement_process_stage_guard.sql`, `20261112133000_force_document_template_source_rls.sql`, `20261112150000_complete_foreign_key_index_coverage.sql` e `20261112162000_remove_redundant_master_select_policies.sql`. Nenhuma foi aplicada ao SMS2 nesta etapa.


## Atualização de segurança do motor documental — 12/11/2026

- Importador DOCX valida CRC-32 e consistência dos cabeçalhos ZIP; conteúdo adulterado/inconsistente é rejeitado antes da importação.
- A tela Documentos descarta respostas assíncronas após troca de Secretaria, inclusive seleção/importação, URL temporária, upload/cadastro e arquivamento.
- CI do commit `2a3570daef8d931f6bcf2a9e5c4e7ab033c9d51b` aprovado ([run 43302243085](https://github.com/artemiosds/supabase-connected-app/actions/runs/43302243085)); formatação aprovada ([run 43302243137](https://github.com/artemiosds/supabase-connected-app/actions/runs/43302243137)). Migrations aplicadas apenas em banco descartável; SMS2 preservado.
- Fase 1 segue em homologação: E2E autenticado, comparação visual DOCX/PDF com modelos oficiais, isolamento com duas Secretarias e restore em projeto separado ainda pendentes. NO-GO comercial permanece.


## Workflow de contratação — testes comportamentais — 12/11/2026

- Teste pgTAP ampliado para 33 assertions, com fixtures sintéticas e ROLLBACK; inclui nove verificações comportamentais de transições, checklist e conclusão.
- CI do commit `44862e0749f52e70b7bf111b1dd611dc5593c094` passou validação e banco descartável ([run 43304160591](https://github.com/artemiosds/supabase-connected-app/actions/runs/43304160591)); formatação ([run 43304160274](https://github.com/artemiosds/supabase-connected-app/actions/runs/43304160274)).
- Ainda falta E2E autenticado com duas Secretarias, papéis distintos e Storage. SMS2 preservado; NO-GO comercial permanece.
