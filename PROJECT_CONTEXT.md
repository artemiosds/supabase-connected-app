# Contexto do projeto SMS

## Stack e fontes oficiais

- Aplicação web em React 19, TypeScript, TanStack Start/Router e Vite 8; estilos com Tailwind CSS e componentes Radix/shadcn.
- Dependências e formatação usam Bun com `bun.lock`; o Prettier atualmente travado no lockfile é 3.9.6.
- Backend oficial: projeto Supabase SMS2 (`rwbbznqtocunzrpcvjvk`), PostgreSQL 17, Auth, Storage e Edge Functions em Deno.
- O repositório GitHub `artemiosds/supabase-connected-app`, branch `main`, é a fonte de código. Lovable é apenas preview sincronizado pelo GitHub.
- Nunca inserir segredos em código frontend, `VITE_*`, documentação ou commits. Não exibir nem copiar valores locais de `.env`.

## Estrutura do código

- `src/routes`: páginas TanStack Router; área autenticada em `_authenticated`.
- `src/components` e `src/components/ui`: componentes da aplicação e primitives visuais. A aba
  Configuração técnica no Painel Master documenta ajustes manuais sem armazenar segredos.
- `src/hooks`: estado de autenticação, tenant, permissões e responsividade.
- `src/lib`: regras de negócio, validação, consultas e utilitários.
- `src/integrations/supabase`: cliente Supabase tipado e tipos gerados; `src/lib/db.ts` concentra o acesso tipado e paginação.
- `supabase/migrations`: schema e segurança versionados. `supabase/functions`: backend Deno. `supabase/tests`: regressões SQL/pgTAP.
- `docs`, `roadmap.md` e `docs/GO-LIVE-CHECKLIST.md`: decisões, estado e gates de homologação.

## Banco e relações principais

Schema `public` no SMS2 consultado em 2026-11-11: 35 tabelas listadas, todas com RLS habilitada. O histórico remoto contém 68 versões até `20261111021946` (`link_generated_documents_to_contracts`). O repositório possui 69 migrations SQL; `20261106194000` não tem versão correspondente no histórico remoto e outras migrations foram registradas com timestamps diferentes. Comparar cuidadosamente histórico e arquivos antes de qualquer nova publicação; não executar `db push` indiscriminadamente.

- Identidade e multitenancy: `profiles`, `tenants`, `tenant_memberships`, `permissions`, `tenant_roles`, `tenant_role_permissions`, `membership_roles`, `platform_admins`, `audit_events`.
- Fornecedores e documentos: `suppliers`, `supplier_documents`, `document_templates`, `generated_documents`, `document_template_catalog`, `document_template_versions`.
- Compras e contratos: `procurement_processes`, `process_items` (etapas/checklist), `procurement_items`, `procurement_price_quotes`, `procurement_budget_allocations`, `contracts`, `contract_amendments`.
- Fluxos de aprovação: `generated_document_workflows`, `generated_document_workflow_events`.
- Convites e cobrança: `tenant_invitations`, `platform_payment_integrations`, `expiry_notification_deliveries`.
- Operação interna: `platform_staff`, `platform_staff_roles`, `platform_staff_permissions`, `platform_staff_role_permissions`, `platform_staff_role_assignments`, `platform_support_agents`, `platform_support_assignments`, `platform_support_sessions`.
- Há relações por tenant e chaves compostas para impedir vínculos cruzados; alterações de autorização devem permanecer em RLS/RPCs validadas no banco. Eventos de auditoria não recebem gravações diretas do cliente.

## Perfis e autorização

- Membros municipais usam memberships, papéis e permissões por Secretaria (`tenant_memberships`, `tenant_roles`, `membership_roles`, `tenant_role_permissions`). A interface não é fronteira de autorização; RLS e RPCs são.
- `platform_admins`, `platform_staff` e `platform_support_agents` são classes de identidade separadas das memberships municipais. Suporte tem atribuições e sessões limitadas por Secretaria.
- Helpers privilegiados ficam no schema não exposto `app_auth` quando necessário, com `SECURITY DEFINER` restrito, `search_path` fixo e validação de identidade/escopo.
- Tabelas de usuário em `public` devem manter RLS e políticas explícitas. Revisar as migrations e permissões reais antes de mudar acesso.

## Módulos e limites confirmados

Autenticação e recuperação; administração e provisionamento de Secretarias; fornecedores; GED privado no Supabase Storage; templates e documentos gerados; usuários e permissões; equipe interna e suporte; processos de contratação, cotações, orçamento, contratos e aditivos.

O Painel Master tem uma aba Configuração técnica com instruções para SMTP, alertas, backup e cobrança, além dos limites atuais de Drive, PDF e assinatura. A tela não coleta segredos nem confirma configuração externa.

Ainda dependem de integração/configuração ou homologação: Google Drive OAuth/sincronização, SMTP e entrega real de e-mails, restauração de backup em projeto isolado, PDF server-side, assinatura qualificada ICP-Brasil, WhatsApp, gateway de pagamento/webhooks e validação de isolamento com duas Secretarias. PDF atual usa impressão do navegador; assinatura existente é simples. A tabela de integração de pagamento não significa que processamento esteja ativo.

## Convenções de manutenção

- Ler este arquivo, `AGENTS.md`, o módulo relacionado e as migrations/tabelas existentes antes de alterar.
- Alterações de schema somente por nova migration timestampada e revisão da história remota; não reescrever migration aplicada nem alterar o banco manualmente.
- Preservar tipos gerados, cliente Supabase tipado, paginação e separação de identidade. Preferir arquivamento a exclusão física.
- Não deixar dados fictícios no SMS2. Fixtures de banco devem rodar em transação e terminar em `ROLLBACK`; validar RLS localmente/CI com papéis representativos.
- Verificações disponíveis no CI: `bun run test`, `bun run build`, `bunx tsc --noEmit`, `bun run lint`, `deno check` da Edge Function e testes `supabase test db` em banco local descartável.
- `supabase start -x inbucket` é suficiente para o job de migrations/pgTAP e evita a porta Mailpit `54324`; nenhum teste de entrega de e-mail é feito nesse job.
- CI verde não comprova E2E autenticado, interface em mobile/tablet/desktop, envio externo, restauração ou prontidão para venda.

## Pendências conhecidas

- O CI do commit `07af1ade09f7ca6fc3d2fc2b5936040097e80298` passou em formatação, testes utilitários/unitários, build, TypeScript, Deno, lint e segurança do banco. O job excluiu Inbucket/Mailpit porque o teste não depende de e-mail, evitando conflito na porta `54324`; aplicou as migrations localmente e executou pgTAP.
- Não liberar comercialmente até terminar a homologação real, revisão operacional/jurídica e gates de e-mail, backup, integrações e isolamento multi-tenant.
