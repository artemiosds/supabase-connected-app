# Diagnóstico por fases — Gestão de Fornecedores da Saúde

**Atualizado em:** 10/11/2026  
**Código:** `artemiosds/supabase-connected-app`, branch `main`  
**Banco:** Supabase SMS2, projeto `rwbbznqtocunzrpcvjvk`  
**Escopo desta conferência:** leitura do código, CI, histórico de migrations e consultas somente de leitura ao SMS2. Nenhum funcionário/fornecedor/processo de teste foi criado e nenhuma migration pendente foi aplicada ao banco de produção nesta etapa.

## Resumo executivo

A fundação multitenant e os principais módulos de fornecedores, documentos, processos, compras e contratos já estão estruturados. O portal de Equipe Interna e a Equipe de Suporte foram implementados e suas migrations foram implantadas no SMS2. A importação de modelos DOCX como texto e o sino de alertas visuais para contratos/documentos já estão no `main`.

O sistema ainda não está pronto para uso comercial com dados reais. O trabalho restante concentra-se em: homologar o fluxo com duas Secretarias; fechar o ciclo operacional dos convites; validar GED em navegador autenticado; completar alertas automáticos, Drive OAuth e cobrança; comprovar backup/restauração; e finalizar domínio, jurídico, suporte e operação.

## Fotografia verificada do SMS2

| Indicador | Resultado |
| --- | ---: |
| Migrations aplicadas | 59 |
| Tabelas públicas | 32 |
| Tabelas com RLS | 32 |
| Tabelas com FORCE RLS | 21 |
| Políticas RLS | 114 |
| Contas Auth | 2 |
| Secretarias | 1 |
| Vínculos municipais | 1 |
| Masters ativos | 1 |
| Colaboradores internos | 0 |
| Perfis padrão da Equipe Interna | 5 |
| Permissões da Equipe Interna | 7 |
| Técnicos de suporte | 0 |
| Atribuições/sessões de suporte | 0 |
| Fornecedores e documentos operacionais | 0 |
| Modelos instalados na Secretaria | 0 |
| Modelos-base globais | 5 |
| Processos, itens, cotações e dotações | 0 |
| Contratos e aditivos | 0 |
| Documentos gerados | 0 |
| Eventos de auditoria | 43 |
| Objetos no Storage | 0 |

O bucket `gfs-private-documents` é privado, permite PDF/DOC/DOCX/XLS/XLSX/JPG/PNG e tem limite de 20 MiB. Não há arquivos armazenados.

### Edge Functions ativas

| Função | Versão | JWT |
| --- | ---: | --- |
| `invite-tenant-user` | 12 | Obrigatório |
| `platform-billing-config` | 10 | Obrigatório |
| `invite-platform-support-agent` | 3 | Obrigatório |
| `invite-platform-staff` | 1 | Obrigatório |

A função estar ativa não comprova entrega de e-mail: SMTP, domínio remetente, Redirect URLs e teste de convite ainda precisam ser feitos.

### Advisors e segurança

- **5 avisos INFO** de RLS habilitado sem políticas nas cinco tabelas internas. Elas usam FORCE RLS e não têm grants diretos para `anon`/ `authenticated`; sem política, a decisão é negar. O PR #10 foi integrado ao código e adiciona políticas explícitas `USING(false)`/ `WITH CHECK(false)` e três índices, mas essa migration nova ainda não foi aplicada ao SMS2.
- **27 avisos WARN** de funções `SECURITY DEFINER` executáveis por `authenticated`. São RPCs de aplicação; não devem ser revogadas em lote. Cada uma precisa manter validação de identidade, permissão, tenant e `search_path`.
- **1 aviso WARN** de proteção contra senhas vazadas desativada.
- Performance Advisor: 7 FKs sem índice (PR #10 cobre três), 57 índices não utilizados (INFO) e 7 grupos de políticas permissivas múltiplas (WARN, ligadas a leituras adicionais do suporte). Não remover índices ou políticas sem benchmark e preservação do isolamento.
- `pg_cron`/`pg_net` não estão instalados e `cron.job` não existe.

## Situação por fase

### Fase 0 — Base técnica
**Estrutura pronta.** GitHub `main` é a fonte do código e está ligado ao Lovable; Supabase gerenciado; build, TypeScript, lint, Vitest e testes de banco local em CI. Falta proteger `main` com checks obrigatórios, confirmar a publicação final e definir domínio/DNS/TLS.

### Fase 1 — Fundação multitenant
**Estrutura implantada.** Tenants, membros, papéis, permissões, módulos, limites, provisionamento, auditoria e RLS existem. Falta E2E com duas Secretarias e administradores diferentes, tentativas cruzadas em todas as tabelas e confirmação das configurações de API Exposed Schemas.

### Fase 2 — Fornecedores, documentos e GED
**Módulos implementados; homologação pendente.** Cadastro de fornecedor, CNPJ, documentos, vencimentos, histórico, GED privado, modelos versionados e geração estão no código. PR #8 adicionou importação DOCX para texto simples e foi integrado ao `main`; não mantém layout, imagens ou cabeçalhos do Word. Falta upload/download real com contas municipais, isolamento de Storage, retenção/restauração, Google Drive OAuth, PDF server-side e definição do nível de assinatura digital.

### Fase 3 — Processos, compras e contratos
**Núcleo funcional implementado; E2E pendente.** Processo/checklist atômico, itens, cotações com frete, seleção de referência, dotações, contratos e guardas de aditivo estão no banco/código. Há testes transacionais revertidos por ROLLBACK. Falta validar no navegador com usuários municipais, conferir todas as modalidades/campos, provar isolamento e medir desempenho com dados representativos.

### Fase 4 — Usuários, Equipe Interna e Suporte
**Estrutura implantada; convites reais pendentes.** Convites municipais, portal interno RBAC e suporte técnico com escopo por Secretaria estão criados. Nenhuma conta interna ou técnica foi cadastrada. Falta SMTP, domínio/redirects, teste de entrega e fechar o ciclo de convites pendentes: cancelar/revogar, reenviar após expiração e tratar conta Auth não confirmada sem excluir identidades automaticamente.

### Fase 5 — Alertas e integrações externas
**Parcial.** Vencimentos são apresentados nas telas. PR #9 amplia o sino para contratos e documentos e está em validação; até merge, não considerar parte do `main`. Não existe disparo programado e não há scheduler. Google Drive é reconhecido como link, sem OAuth/upload/sync. Não há gateway de cobrança ativo.

### Fase 6 — Backup e continuidade
**Código preparado, recuperação não comprovada.** Workflow de backup criptografado com age e cópia de objetos GED existe, mas não há evidência de execução, descriptografia ou restore. O pacote lógico não inclui identidades/senhas Auth, configuração integral do projeto, secrets de Edge Functions ou SMTP. Falta restaurar em projeto separado e documentar RPO/RTO.

### Fase 7 — Comercialização e operação
**Não concluída.** `payments_enabled=false`; sem gateway, webhooks ou conciliação. Faltam preços/planos/tributos/cancelamento/estorno, revisão jurídica/LGPD, contrato SaaS/DPA, domínio, monitoramento, SLA, suporte e piloto.

## Alterações recentes no código

- **PR #8 — DOCX:** integrado ao `main`; CI passou em testes unitários, build, TypeScript, lint, formatação e reset/testes pgTAP em banco local descartável. Importa texto e tabelas simples, sem preservar o layout visual do Word.
- **PR #9 — alertas:** integrado ao `main`; combina vencimentos de contratos e documentos, pagina consultas, limita ao tenant selecionado e trata falhas parciais. Não envia e-mail/WhatsApp.
- **PR #10 — RLS e índices:** migration forward-only no `main`, ainda não aplicada ao SMS2. O PR #12 reforça o deny-all como política restritiva e amplia os testes para 55 assertions; aguardando CI.
  
A próxima migration nova é código preparado, não alteração de produção. O SMS2 continua com 59 migrations aplicadas até `20261110121336`; a migration `20261110143000` permanece pendente no código e aguarda CI/aprovação antes de qualquer janela futura de implantação.

## Próxima sequência recomendada

1. Fechar PR #9 com CI completo verde.
2. Completar revogação/cancelamento e reenvio de convites internos/técnicos.
3. Homologar GED, modelos, geração, processos e contratos em duas Secretarias fictícias isoladas.
4. Implementar alertas recorrentes após escolha de provedor de e-mail e scheduler.
5. Implementar Google Drive OAuth por Secretaria com tokens protegidos e revogação.
6. Executar backup e restore em projeto isolado.
7. Implementar gateway em Sandbox e fechar requisitos jurídicos/comerciais.
8. Proteger branch, publicar frontend em domínio oficial e executar piloto.

**Decisão atual: NO-GO para produção comercial.** A fundação está avançada; os gates de SMTP, duas Secretarias, GED autenticado, backup restaurado, E2E de navegador, alertas, Drive, cobrança, domínio e jurídico seguem pendentes.
