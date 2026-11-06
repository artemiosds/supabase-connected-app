# Roadmap — Gestão de Fornecedores da Saúde

Atualizado em **04/11/2026**, com conferência do GitHub `main` e do Supabase SMS2.

## Estado real verificado

- **Repositório oficial:** `artemiosds/supabase-connected-app`, branch `main`.
- **Banco gerenciado:** Supabase SMS2, projeto `rwbbznqtocunzrpcvjvk`, região São Paulo.
- **Preview:** projeto Lovable conectado ao GitHub. “Ready” no preview não substitui homologação autenticada.
- **Migrations:** 23 aplicadas no Supabase e 23 arquivos correspondentes no repositório. A reconciliação encontrou 23/23 versões correspondentes, sem migration aplicada ausente e sem migration versionada pendente. A última é `20261105024856_phase1_validate_tenant_constraints`, que validou formalmente as seis CHECK constraints institucionais.
- **Dados atuais:** 1 usuário Auth confirmado, 1 perfil e 1 administrador global ativo e confirmado; 0 Secretarias, 0 vínculos municipais, 0 fornecedores, 0 documentos de fornecedores, 0 modelos e 0 documentos gerados. Há 1 evento de auditoria preexistente. Os testes anteriores usaram transações revertidas e não deixaram dados fictícios.

## FASE 1 — Fundação multitenant e segurança

<badge color="success">Estrutura implementada</badge> **Homologação operacional ainda pendente.**

Inclui:
- Perfis ligados ao Supabase Auth.
- Secretarias (tenants), status e identificador amigável.
- Administração global separada dos papéis municipais.
- Membros por Secretaria, papéis, permissões e vínculos compostos para impedir associação de papel de outro tenant.
- Provisionamento de Secretaria com administrador municipal confirmado.
- Políticas RLS, proteção de identidade, bloqueio de exclusão física de Secretaria, auditoria e funções internas de autorização.
- Dados institucionais: CNPJ, e-mail, telefone, endereço, município e UF.
- Validação de CNPJ numérico e alfanumérico no banco e no frontend.

### Evidências da Fase 1
- Todas as 13 tabelas de aplicação no schema `public` estão com RLS habilitado.
- As quatro tabelas operacionais usam também FORCE ROW LEVEL SECURITY.
- Schema interno `app_auth`: `anon` não possui USAGE; as funções privilegiadas têm caminho de busca fixado.
- As 22 migrations estão sincronizadas entre o Supabase e o GitHub.
- Já existe um superadministrador global ativo, com usuário Auth confirmado. **Não execute o bootstrap inicial novamente neste SMS2.** O script em `supabase/operations/bootstrap_first_platform_admin.sql` serve apenas para instalação nova, sem nenhum administrador global.
- Testes SQL transacionais anteriores validaram criação de Secretaria, papéis padrão, proteção de papéis/permissões administrativas e isolamento entre duas Secretarias. As transações foram revertidas.
- A consulta atual confirmou que não há tenants ou dados operacionais fictícios persistidos.

### Pendências de configuração/homologação da Fase 1
1. No Supabase Dashboard, confirme em **Project Settings → API → Exposed schemas** que `app_auth` não está listado. A lista de schemas expostos é uma configuração da API e não pode ser comprovada só pela consulta SQL.
2. Habilite a proteção contra senhas vazadas em **Auth → Settings / Password Security**. O Security Advisor ainda aponta `auth_leaked_password_protection` como WARN.
3. Homologue o fluxo real com uma conta municipal confirmada e duas Secretarias de teste. Não use dados pessoais reais na primeira rodada.

## FASE 2 — Fornecedores, documentos e operação

<badge color="success">Estrutura principal implementada</badge> **Homologação completa da interface e comportamento em escala ainda pendente.**

### Fase 2.1 — Fornecedores
- Cadastro com CNPJ, razão social, nome fantasia, categoria, contatos e endereço.
- Validação de CNPJ numérico/alfanumérico e unicidade por Secretaria.
- Pesquisa, filtros de categoria e situação, edição e inativação/reativação sem exclusão física.
- Permissões separadas para visualizar, cadastrar, editar e inativar.
- Auditoria automática das alterações e RLS por `tenant_id`.

### Fase 2.2 — Documentos e gestão
- Documentos ligados ao fornecedor, tipo, datas de emissão/vencimento, observação e URL externa.
- Indicadores visuais de documentos vencidos e próximos do vencimento.
- Modelos por Secretaria, substituição de campos e geração de documentos com snapshot do conteúdo.
- Registro de assinatura eletrônica simples associado ao usuário autenticado e proteção de imutabilidade após assinar.
- Usuários municipais: localizar conta confirmada, vincular, atribuir/alterar papel, suspender e reativar, com proteções contra auto-suspensão e suspensão do último administrador.
- Painel, configurações institucionais e histórico de auditoria.
- RLS forçado nas tabelas operacionais de documentos, templates e documentos gerados.

### Limites conhecidos — não marcar como implementados
- **Google Drive:** o sistema reconhece links e extrai o ID do arquivo; OAuth, autorização de pastas, upload e sincronização automática ainda não foram configurados.
- **PDF:** a versão atual usa a impressão do navegador; não há geração PDF no servidor nem armazenamento persistente da via assinada.
- **Assinatura:** é eletrônica simples e associada à sessão; não é assinatura qualificada ICP-Brasil nem integração com provedor de assinatura.
- **Alertas:** painel e listagem exibem vencimentos; envio agendado por e-mail/WhatsApp requer provedor e agendador.
- **Convites:** o administrador vincula contas previamente cadastradas e confirmadas; convite automático por e-mail não está integrado.
- **Importação de modelos:** arquivos `.txt` e `.md`; DOC/DOCX precisam ser copiados e colados, pois não existe importador Word nativo.

## Qualidade e liberação

- CI do commit `f26b1b02f80e3da8e5ba39331b67f75d7d9fb4ad` passou integralmente no GitHub Actions: instalação congelada do Bun, 9 testes unitários, TypeScript, build de produção e lint. Execução: [GitHub Actions #50](https://github.com/artemiosds/supabase-connected-app/actions/runs/41957688389).
- Foram adicionadas verificações de rotas para todas as telas autenticadas e um teste do exemplo alfanumérico de CNPJ `00.000.000/E08G-12`.
- O workflow de CI usa Bun e o lockfile oficial `bun.lock`; o último run completo passou em todas as etapas.
- O roteiro de homologação está em `docs/TESTE-MVP.md`.
- Security Advisor: WARN por proteção contra senhas vazadas desativada.
- Performance Advisor: índices INFO ainda sem uso, esperado porque não há carga operacional; não remover índices só por essa observação.
- **Fase 3** deve ser estabilização/homologação autenticada, teste de escala, correção dos defeitos observados e preparação para produção. Evitar novas migrations se não houver necessidade comprovada.

## FASE 3 — Contratos e Processos de Contratação (06/11/2026)
- [x] Telas: Processos (quadro por etapas DFD→ETP→TR→Pesquisa→Parecer→Conclusão, checklist automático) e Contratos (aditivos, régua 120/90/60/30 dias, sino de alertas).
- [ ] **Bloqueado — aprovação do usuário:** aplicar `supabase/operations/pending_phase3_contracts_and_processes.sql` como nova migration no SMS2 (ferramenta de migração desativada pela preferência de aprovação).
- [ ] Envio automático de e-mail/WhatsApp (ainda não existe; hoje os alertas aparecem só dentro do sistema).
