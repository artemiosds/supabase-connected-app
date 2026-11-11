# Contexto do projeto SMS

## Stack e fontes oficiais

- Aplicação web em React 19, TypeScript, TanStack Start/Router e Vite 8; estilos com Tailwind CSS e componentes Radix/shadcn.
- Dependências e formatação usam Bun com `bun.lock`; o Prettier atualmente travado no lockfile é 3.9.6.
- Backend oficial: projeto Supabase SMS2 (`rwbbznqtocunzrpcvjvk`), PostgreSQL 17, Auth, Storage e Edge Functions em Deno.
- O repositório GitHub `artemiosds/supabase-connected-app`, branch `main`, é a fonte de código. Lovable é apenas preview sincronizado pelo GitHub.
- Nunca inserir segredos em código frontend, `VITE_*`, documentação ou commits. Não exibir nem copiar valores locais de `.env`.

## Estrutura do código

- `src/routes`: páginas TanStack Router; área autenticada em `_authenticated`. A raiz pública (`/`) apresenta a página inicial do produto para visitantes e preserva o redirecionamento de usuários autenticados ao painel.
- `src/components/site-home.tsx`: página pública responsiva com prévia ilustrativa e acessos ao Painel Master, Portal da Secretaria e Central de Suporte. A escolha preserva o contexto até o login compartilhado, que usa telas visuais distintas por portal e direciona ao destino; a autorização existente continua determinando o acesso liberado.
- `src/components/portal-auth-shell.tsx`: moldura visual responsiva compartilhada para o login contextual de Master, Secretaria e Suporte; não contém lógica de autenticação ou autorização.
- `src/components` e `src/components/ui`: componentes da aplicação e primitives visuais. A aba
  Configuração técnica no Painel Master documenta ajustes manuais sem armazenar segredos.
- `src/hooks`: estado de autenticação, tenant, permissões e responsividade.
- `src/lib`: regras de negócio, validação, consultas e utilitários. `src/lib/document-variables.ts` mantém o catálogo comum de campos automáticos e a substituição segura de placeholders documentais.
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

Sanções de fornecedores agora possuem histórico por Secretaria, período, fundamento, referência, revogação auditada e alerta visual de vigência. O registro não altera automaticamente o status geral do fornecedor nem decide a habilitação em outro processo.

A pesquisa de preços agora calcula menor, média, mediana e coeficiente de variação por preço unitário equivalente com frete rateado, e exporta CSV compatível com Excel. Nenhum valor é descartado automaticamente; a análise continua sendo da equipe.

O módulo de Contratos dispõe de exportação CSV compatível com Excel para contratos vigentes a vencer em até 90 dias, usando apenas dados autorizados da Secretaria selecionada. PDF executivo e exportações nas demais telas ainda não estão implementados.


Autenticação e recuperação; administração e provisionamento de Secretarias; fornecedores; GED privado no Supabase Storage; templates e documentos gerados; usuários e permissões; equipe interna e suporte; processos de contratação, cotações, orçamento, contratos e aditivos.

O Painel Master tem uma aba Configuração técnica com instruções para SMTP, alertas, backup e cobrança, além dos limites atuais de Drive, PDF e assinatura. A tela não coleta segredos nem confirma configuração externa.

O workflow de contratação foi expandido para dez etapas sem renomear os identificadores já usados; cada atividade do checklist pode receber responsável e prazo. A migration versionada também substitui as constraints de etapa nas duas tabelas e permanece não aplicada ao SMS2.

A biblioteca documental agora tem catálogo comum de placeholders para Secretaria, fornecedor, processo e contrato, com prévia e marcadores explícitos para dados ausentes. A geração vinculada a processo preenche o contexto do contrato/fornecedor pela migration versionada. A RPC restringe complementos a campos manuais declarados no modelo e bloqueia sobrescrita de valores calculados no servidor. A migration ainda não foi aplicada ao SMS2. DOCX continua sendo importado como texto, e a exportação Word/PDF fiel ao modelo continua pendente. Também dependem de configuração ou homologação: Google Drive OAuth/sincronização, SMTP e entrega real de e-mails, restauração de backup em projeto isolado, PDF server-side, assinatura qualificada ICP-Brasil, WhatsApp, gateway de pagamento/webhooks e validação de isolamento com duas Secretarias. PDF atual usa impressão do navegador; assinatura existente é simples.



As medidas administrativas de fornecedores estão em código com migration versionada `20261111160000_supplier_sanction_history.sql`; ela cria histórico por Secretaria, períodos, referência, fundamento legal, revogação auditável e RLS sem exclusão física. A interface oferece consulta, cadastro e sinalização de vigência, mas não altera automaticamente o status cadastral ou a habilitação. A migration não foi aplicada ao SMS2; validar o histórico remoto antes de qualquer implantação.

## Convenções de manutenção

- Fluxos de autenticação expõem retorno contextual: login à página inicial e redefinição ao login. Cadastro e recuperação de senha já oferecem retorno ao login; módulos internos mantêm Painel no menu global, e Master/Suporte mantêm retorno ao portal operacional.
- Links externos de documentos aceitam somente HTTP/HTTPS, sem credenciais e com limite de 2.048 caracteres; o banco aplica constraint versionada e a interface só abre URLs normalizadas. Google Drive ainda é apenas reconhecimento de link, sem OAuth ou sincronização.
- Ler este arquivo, `AGENTS.md`, o módulo relacionado e as migrations/tabelas existentes antes de alterar.
- Alterações de schema somente por nova migration timestampada e revisão da história remota; não reescrever migration aplicada nem alterar o banco manualmente.
- Preservar tipos gerados, cliente Supabase tipado, paginação e separação de identidade. Preferir arquivamento a exclusão física.
- Não deixar dados fictícios no SMS2. Fixtures de banco devem rodar em transação e terminar em `ROLLBACK`; validar RLS localmente/CI com papéis representativos.
- Verificações disponíveis no CI: `bun run test`, `bun run build`, `bunx tsc --noEmit`, `bun run lint`, `deno check` de todas as Edge Functions e testes `supabase test db` em banco local descartável.
- `supabase start -x inbucket` é suficiente para o job de migrations/pgTAP e evita a porta Mailpit `54324`; nenhum teste de entrega de e-mail é feito nesse job.
- CI verde não comprova E2E autenticado, interface em mobile/tablet/desktop, envio externo, restauração ou prontidão para venda.

## Pendências conhecidas

- O CI do commit `ab00a6b53065f205a436a52d57ccd57b60563371` passou em formatação, testes unitários, build, TypeScript, Deno nas cinco Edge Functions, lint, aplicação das migrations em Supabase descartável e pgTAP. Isso não comprova E2E autenticado, inspeção visual da interface em dispositivos nem integrações externas.
- Não liberar comercialmente até terminar a homologação real, revisão operacional/jurídica e gates de e-mail, backup, integrações e isolamento multi-tenant.
