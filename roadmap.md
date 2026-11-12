# Roadmap — Gestão de Fornecedores da Saúde

> **Estado atualizado em 12/11/2026.** A fotografia atual e o diagnóstico por fases estão em [docs/DIAGNOSTICO-FASES-2026-11-12.md](docs/DIAGNOSTICO-FASES-2026-11-12.md). Use esse documento como referência; os blocos históricos abaixo são registro de evolução, não estado atual.

- SMS2: 74 migrations, 38 tabelas públicas com RLS, 27 com FORCE RLS e 133 políticas.
- 1 Secretaria, 1 vínculo municipal, 1 Master ativo, 2 identidades Auth; zero fornecedores, arquivos GED, processos, contratos, sanções, funcionários internos ou técnicos de suporte.
- Cinco Edge Functions ativas (convites municipais, cobrança, suporte, equipe interna e alertas de vencimento).
- Código no `main`: motor documental com aprovação, preservação de DOCX original por versão, exportação Word, PDF por renderizador próprio, timbrado por Secretaria, lista/bloqueio de campos pendentes, processo de dez etapas, pesquisa de preços, contratos/aditivos, saldo de contrato/ARP, sanções, relatórios e alertas.
- Pendências principais: editor visual rico, E2E com duas Secretarias, GED autenticado, SMTP/alertas reais, Google Drive OAuth, restore de backup, gateway/webhooks, domínio, LGPD e piloto.
- SMS2 permanece com 74 migrations; cinco migrations futuras estão no `main` e não foram aplicadas: fonte DOCX, timbrado, bloqueio de campos pendentes, índices FK e remoção de políticas SELECT redundantes.
- **NO-GO comercial** até conclusão dos gates descritos no diagnóstico.

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
| 0 — Base técnica | Estrutura pronta | Proteção de branch e publicação final |
| 1 — Multitenant/RLS | Estrutura implantada | E2E com duas Secretarias |
| 2 — Fornecedores/GED/Documentos | Módulos implementados | GED real, Drive, PDF e assinatura definidos |
| 3 — Compras/Contratos | Núcleo implementado | Homologação completa no navegador |
| 4 — Usuários/Equipe/Suporte | Estrutura implantada | SMTP e ciclo completo de convites |
| 5 — Alertas/Integrações | Parcial | Alertas agendados, OAuth Drive, gateway |
| 6 — Backup/Continuidade | Código preparado | Backup e restore comprovados |
| 7 — Comercial/Produção | Não concluída | Cobrança, jurídico, domínio, SLA e piloto |

## Decisão
**NO-GO para produção comercial.** Não reconstruir Fases 1 e 2. DOCX já importa parágrafos e tabelas simples como texto editável; alertas visuais cobrem contratos e documentos. Priorizar fluxo de convites, provar isolamento com duas Secretarias, testar GED e recuperar backup antes de inserir dados reais.

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
