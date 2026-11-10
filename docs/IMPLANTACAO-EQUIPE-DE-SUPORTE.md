# Equipe de Suporte — estado e operação

## Estado atual no SMS2

Atualizado em 10/11/2026 após a implantação controlada.

- As tabelas `platform_support_agents`, `platform_support_assignments` e `platform_support_sessions` estão criadas, com RLS e FORCE RLS.
- A função Edge `invite-platform-support-agent` está ACTIVE, versão 3, com `verify_jwt=true`.
- A autorização compartilhada `can_manage_platform_support_team()` permite ao Master ou a colaborador interno ativo com `support.team.manage` administrar técnicos e atribuições.
- Nenhum técnico, atribuição ou sessão de suporte foi criado. Não reutilizar conta Master ou municipal.
- A revogação de convite pendente está preparada no PR #13, com migration `20261110144000`; permanece fora do SMS2 até futura homologação e implantação.
- O cancelamento marca o técnico como `revoked`, desativa atribuições, preserva a identidade Auth e bloqueia ativação pelo link antigo. Reenvio do mesmo endereço ainda não está habilitado.
- As regras impedem sobreposição entre contas técnicas, equipe interna, Masters e usuários municipais.

## Sequência de migrações aplicada

1. `20261110114727_apply_commercial_guards_after_operational_tables.sql`
2. `20261110115500_platform_support_team_and_scoped_sessions.sql`
3. `20261110115627_complete_procurement_relations_and_amendment_trigger.sql`
4. `20261110115723_revalidate_platform_support_assignments.sql`
5. `20261110115818_preserve_supplier_permission_path.sql`
6. `20261110115937_support_invitation_activation_and_session_context.sql`
7. `20261110115954_harden_support_lifecycle_and_data_minimization.sql`
8. `20261110120237_enforce_support_identity_separation.sql`
9. `20261110120321_enforce_support_identity_separation.sql` (marcador de reexecução idempotente)
10. `20261110121323_enforce_support_identity_separation.sql` (marcador de reexecução idempotente)
11. `20261110121329_reconcile_tenant_row_identity_helper.sql`
12. `20261110121336_platform_internal_staff_access.sql`

O SQL efetivo de separação de identidade está na primeira execução registrada, `20261110120237`; os dois arquivos seguintes são marcadores vazios para preservar o histórico real sem repetir DDL.

## Regras de acesso

- Uma conta técnica precisa ser exclusiva e não pode ser Master nem possuir vínculo municipal.
- A atribuição é por Secretaria e define separadamente consulta, cadastro e atualização de fornecedores.
- O técnico só acessa a Secretaria atribuída, em sessão temporária com justificativa.
- A sessão tem duração limitada e pode ser encerrada ou revogada.
- Não há permissão de excluir/inativar fornecedores, acessar prontuários, usuários municipais, cobrança ou segredos.
- A equipe interna pode administrar convites e atribuições técnicas somente com `support.team.manage`; não recebe acesso à sessão de suporte Master.
- Convite e ativação dependem de confirmação de e-mail e definição de senha.

## Antes do primeiro convite

1. Configurar SMTP próprio no Supabase Auth para permitir entrega a e-mails externos.
2. Configurar `APP_URL` com o domínio HTTPS publicado e `INVITE_ALLOWED_ORIGINS` somente para origens adicionais necessárias.
3. Confirmar o Redirect URL de aceite/redefinição de senha no Supabase Auth.
4. Fazer teste com e-mail exclusivo, validar confirmação, senha e primeiro acesso.
5. Testar atribuição a uma Secretaria, escopo negado para outra Secretaria, permissões individuais, expiração, suspensão e auditoria.
6. Só então cadastrar técnicos reais.

O SMTP padrão do Supabase é restrito a endereços da equipe do projeto e tem limite baixo; não é adequado para operação de convites de funcionários/clientes externos. Não colocar credenciais SMTP ou service-role key em código ou no chat.

## Backup

Ainda não existe backup restaurável verificado desta implantação. O projeto está no plano Free e não recebe backups diários automáticos nem PITR gerenciado. O workflow `.github/workflows/backup-sms2.yml` está preparado, mas requer os secrets `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY` e as variables `AGE_RECIPIENT` e `SUPABASE_BACKUP_ENABLED=true`. O arquivo de restauração descreve explicitamente seus limites: não inclui Auth users, senhas, configurações do projeto, secrets de Edge Functions ou SMTP. Guardar a identidade privada age offline e testar restauração em outro projeto.

## Segurança e CI

As tabelas de suporte usam RLS e FORCE RLS, sem acesso direto à tabela por `anon`/ `authenticated`; as operações são expostas por RPCs com verificação de autorização no banco. O CI completo de banco (reset local e pgTAP) passou no commit de validação anterior à conciliação dos prefixos; a validação mais recente está aguardando inicialização do contêiner local no GitHub Actions.

O Security Advisor indica proteção contra senhas vazadas desativada. O recurso está disponível no Supabase a partir do plano Pro; no Free, manter política forte de senha e avaliar upgrade antes da operação comercial.

## Rollback

Não remover tabelas ou registros de técnicos em operação. Suspender a conta/atribuição, encerrar sessões ativas, preservar auditoria e corrigir por migration forward-only. Nunca executar `supabase db reset` no projeto remoto.
