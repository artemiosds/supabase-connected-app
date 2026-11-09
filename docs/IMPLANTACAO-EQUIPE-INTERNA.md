# Implantação — Equipe Interna

## Objetivo

Disponibilizar no Painel Master a gestão dos colaboradores da empresa operadora do SaaS, sem transformar essas contas em administradores globais e sem misturá-las com usuários municipais ou técnicos de suporte.

A implementação contém:

- Convite individual por e-mail, confirmação e criação de senha antes da ativação.
- Perfis padrão editáveis e perfis personalizados.
- Matriz de permissões aplicada por funções SQL, não apenas pela interface.
- Mais de um perfil por colaborador; permissões efetivas são a união dos perfis ativos.
- Suspensão e reativação auditadas.
- Área interna separada do Painel Master, com consultas somente leitura para clientes, planos, resumo financeiro, métricas e auditoria, de acordo com o perfil.
- Acesso da equipe interna à gestão da equipe técnica somente com a permissão `support.team.manage`. Isso não habilita sessão de suporte Master.
- Contas internas não recebem credenciais privadas de cobrança e não podem ser simultaneamente Master, técnico ou usuário municipal.

## Perfis padrão

| Perfil | Escopo inicial |
|---|---|
| Comercial | Consultar clientes, planos e métricas |
| Financeiro | Consultar clientes, valores e métricas financeiras agregadas |
| Implantação | Consultar situação cadastral e implantação |
| Suporte interno | Gerenciar técnicos, convites e atribuições da Equipe de Suporte |
| Auditoria | Consultar clientes, métricas e eventos de auditoria |

O Master pode editar as permissões dos perfis padrão e criar perfis adicionais. A permissão-base `dashboard.view` é obrigatória. O catálogo contém somente permissões que já possuem uma operação segura implementada; não conceda poderes de cadastro/edição de clientes, alteração de planos, acesso a segredos ou operações administrativas globais por fora deste catálogo.

## Pré-requisitos e sequência

1. Fazer backup verificável do projeto SMS2 e registrar o estado da migration history.
2. Confirmar que as migrations anteriores da Equipe de Suporte já foram aplicadas; esta migration integra a gestão interna à permissão restrita para administrar técnicos.
3. Revisar a branch/PR e validar localmente:
   ```bash
   supabase start
   supabase db reset --local
   supabase test db
   npm ci
   npm run lint
   npm test
   npm run build
   ```
4. Aplicar a migration `20261109170000_platform_internal_staff_access.sql` somente depois do backup e da aprovação do responsável pelo ambiente.
5. Publicar as Edge Functions `invite-platform-staff` e a versão atualizada de `invite-platform-support-agent`. Ambas usam os secrets padrão do Supabase (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) no servidor. Nunca inserir a service-role key no frontend.
6. Confirmar que o domínio de produção está em `APP_URL` e/ou `INVITE_ALLOWED_ORIGINS`, para que o link de convite volte ao domínio autorizado.
7. Fazer homologação com um e-mail de teste controlado: convite, confirmação, senha, portal, permissão permitida, permissão negada, suspensão e reativação.
8. Só depois de homologado, cadastrar colaboradores reais e atribuir o menor conjunto de permissões necessário.

## Verificações de segurança

- Tabelas internas com RLS e FORCE ROW LEVEL SECURITY, sem grants diretos para o frontend.
- Consultas expostas por RPCs com `SECURITY DEFINER`, `search_path` fixo e autorização por `auth.uid()`.
- Convite somente pelo Master; conta interna inicia como `invited`.
- A ativação confere e-mail confirmado, usuário autenticado e correspondência com o e-mail cadastrado.
- Suspensão é verificada pelo banco em cada operação; o token de login não preserva permissões depois da suspensão.
- Triggers impedem sobreposição entre staff, `platform_admins`, `platform_support_agents` e `tenant_memberships`.
- A Equipe Interna não tem acesso à função de suporte Master nem à configuração/segredos do provedor de cobrança.
- A auditoria registra convite, ativação, suspensão/reativação, troca de perfis e edição da matriz.

## Limites conhecidos da entrega

- Os perfis Comercial, Financeiro e Implantação são de consulta nesta fase; operações de cadastro/edição de clientes e mudança de plano continuam exclusivas do Master.
- O perfil Financeiro recebe valores e agregados, mas não configura provedor, não visualiza tokens/chaves e não realiza cobranças.
- A gestão da Equipe de Suporte permite administrar técnicos e atribuições, mas somente o Master inicia uma sessão de suporte como administrador global.
- A migration e a Edge Function não são aplicadas automaticamente neste rollout de código. O ambiente SMS2 permanece sem alteração até a execução controlada dos passos acima.

## Rollback

Não apagar as tabelas nem remover registros de colaboradores depois de utilizar o recurso: os registros referenciam usuários Auth e eventos de auditoria. Em caso de interrupção, suspender os colaboradores pela função administrativa, remover a rota/feature apenas com migration reversível revisada e preservar evidências de auditoria. Não executar rollback destrutivo diretamente em produção.
