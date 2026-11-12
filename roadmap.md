# Roadmap — Gestão de Fornecedores da Saúde

> **Estado verificado em 11/11/2026 — prevalece sobre as fotografias anteriores neste documento.** Consulta somente leitura ao Supabase SMS2 e CI do commit `49ec420f4d202dc040ae893b606e50b7f5050e06`:
> - O schema `public` tem 35 tabelas e todas estão com RLS habilitada. Há 68 versões de migration registradas, até `20261111021946` (`link_generated_documents_to_contracts`). O repositório tem 69 arquivos SQL; `20261106194000` não tem versão correspondente no histórico remoto. Alguns arquivos foram registrados sob versões/timestamps diferentes; não executar `db push` ou reparo do histórico sem comparar cada migration.
> - Há 1 Secretaria e 1 vínculo municipal; 2 perfis; nenhum fornecedor, documento operacional, processo, contrato, aditivo ou documento gerado. Catálogo global contém 5 modelos. Outbox de notificações está vazia.
> - Cinco Edge Functions estão ativas: `invite-tenant-user` v15, `platform-billing-config` v13, `invite-platform-support-agent` v6, `invite-platform-staff` v4 e `send-expiry-notifications` v3. As quatro primeiras exigem JWT; a última usa `verify_jwt = false` e autenticação por segredo de servidor. Ativa não significa que e-mail real ou scheduler esteja homologado.
> - No commit acima passaram formatação, testes utilitários/unitários, build, TypeScript, Deno, lint, inicialização do Supabase local sem Mailpit, aplicação de migrations e testes pgTAP. Nenhum dado fictício foi escrito no SMS2 e nenhum e-mail real foi enviado.
> - Integrações/configurações ainda pendentes: SMTP e agendamento de alertas, Drive OAuth, gateway/webhooks de pagamento, restore de backup em projeto separado e homologação autenticada com duas Secretarias. O estado permanece **NO-GO para venda/liberação comercial**.


Atualizado em **10/11/2026** após integração da importação DOCX e dos alertas visuais. A análise detalhada está em [docs/DIAGNOSTICO-FASES-2026-11-10.md](docs/DIAGNOSTICO-FASES-2026-11-10.md).

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

- Fase 1 — Documentos: catálogo de campos automáticos, prévia com lacunas explícitas e RPC vinculada a contrato/fornecedor com validação de complementos. Exportação fiel DOCX/PDF permanece pendente. Migration de geração está versionada e não aplicada ao SMS2.
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
- O DOCX importado continua convertido a texto ao salvar o modelo. Preservar estilos, tabelas e brasão do arquivo original exige vincular seu binário privado ao modelo e versionar esse vínculo.
- Não afirmar fidelidade visual nem assinatura qualificada antes da homologação.


## Fonte binária dos modelos — 12/11/2026

- O DOCX importado passa a ser anexado em Storage privado à versão imutável do modelo, sem alterar a edição de texto. O Word exportado usa o original somente para rascunho não editado com valores de snapshot consistentes; a revisão humana permanece soberana.
- A migration está no repositório e aguarda reconciliação do histórico do SMS2 para publicação. Layout Word complexo, imagens em PDF, brasão configurável, identidade visual oficial e homologação autenticada seguem pendentes.
