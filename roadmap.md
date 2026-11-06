# Roadmap — Gestão de Fornecedores da Saúde

Atualizado em **06/11/2026**, com conferência do GitHub `main` e do Supabase SMS2.

## Estado real verificado

- **Repositório oficial:** `artemiosds/supabase-connected-app`, branch `main`.
- **Banco gerenciado:** Supabase SMS2, projeto `rwbbznqtocunzrpcvjvk`, região São Paulo.
- **Preview:** projeto Lovable conectado ao GitHub. “Ready” no preview não substitui homologação autenticada.
- **Migrations:** 30 versões registradas no histórico do SMS2. As duas últimas são `20261106204304_phase4_document_templates_and_process_links` e `20261106205404_phase4_1_validate_required_document_fields`. As tabelas de processos/contratos já existem, mas o DDL original não está registrado no histórico; o script antigo em `supabase/operations` é obsoleto e não deve ser executado.
- **Dados atuais:** 1 usuário Auth confirmado, 1 perfil e 1 administrador global ativo; 0 Secretarias, 0 vínculos municipais, 0 fornecedores, 0 documentos de fornecedores, 0 modelos instalados por Secretaria, 0 processos, 0 contratos e 0 documentos gerados. Existem 5 modelos-base no catálogo global. Não há dados municipais reais para homologação.

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
- [x] As tabelas `procurement_processes`, `process_items`, `contracts` e `contract_amendments` existem no SMS2, com RLS habilitado e FORCE ROW LEVEL SECURITY, oito políticas por tabela e políticas comerciais por módulo.
- [ ] Envio automático de e-mail/WhatsApp (ainda não existe; hoje os alertas aparecem só dentro do sistema).

## FASE 4 — Biblioteca de modelos e geração por processo (06/11/2026)

**Status:** banco atualizado e código versionado; homologação funcional com uma Secretaria real ainda pendente.

### Implementado no SMS2
- Catálogo global com cinco modelos-base orientativos: DFD, ETP, Mapa de Análise de Riscos, Matriz Contratual de Alocação de Riscos e TR.
- Modelos do catálogo são copiados para o tenant; cada Secretaria edita sua própria cópia sem alterar o catálogo global.
- Versionamento automático dos modelos por Secretaria e tabela histórica somente leitura.
- Documentos gerados podem guardar process_id, tipo, versão do modelo, snapshot do processo e snapshot dos campos usados.
- Chave estrangeira composta (process_id, tenant_id) impede vincular documento a processo de outra Secretaria.
- RPCs install_document_template e generate_document_from_process são SECURITY INVOKER, autorizadas apenas para sessão autenticada e protegidas por permissões/módulos.
- Validação de campos obrigatórios também no banco; não depende apenas da tela.
- Tela Documentos: biblioteca-base, instalação por Secretaria, edição de modelos, histórico e geração de rascunho vinculado a processo. O fluxo antigo de documento avulso foi preservado.
- Tipos Supabase regenerados e sincronizados com o repositório.

### Limites desta Fase 4
- Modelos são referências orientativas, não minutas homologadas por cada município. Exigem conferência jurídica e adaptação ao regulamento local.
- A Matriz Contratual de Alocação de Riscos é diferente do Mapa de Análise de Riscos; a matriz contratual não é automaticamente obrigatória em toda contratação.
- A tela usa impressão do navegador para salvar PDF; não há ainda PDF gerado/armazenado no servidor.
- Não foi possível fazer teste ponta a ponta com processo real porque ainda não existe tenant, membro municipal ou processo cadastrado.

### Próxima homologação funcional
1. Criar Secretaria de teste e administrador municipal confirmado.
2. Habilitar módulos processos, documentos e modelos; atribuir permissões de gestão de modelos e criação de documentos.
3. Instalar os cinco modelos, alterar uma cópia, conferir o histórico e gerar DFD → ETP → Mapa de Riscos → TR a partir de um processo.
4. Testar isolamento com duas Secretarias e papéis diferentes, incluindo tentativa de acesso por ID de outro tenant.
5. Conferir impressão/PDF, assinatura simples e trilha de auditoria.

## FASE 5 — O que falta para o SaaS estar pronto para clientes

1. **Onboarding real de tenant:** criar fluxo completo de cadastro, validação institucional, convite do administrador municipal e primeira configuração de módulos/permissões.
2. **Reconciliação das migrations:** versionar corretamente o DDL de processos/contratos já presente no SMS2, sem reaplicar o script antigo.
3. **GED privado:** buckets privados no Supabase Storage, políticas por tenant, upload/download seguro, limite de tamanho/tipo, versões, retenção e backup.
4. **Convites por e-mail:** convite e ativação de usuário sem depender de o usuário já ter criado e confirmado a própria conta.
5. **Cobrança real:** provedor de pagamento, planos/assinaturas, faturas, webhooks, inadimplência, tentativas de cobrança, cancelamento e conciliação. Hoje existem somente os metadados comerciais.
6. **Dados estruturados de compras:** itens/itens de fornecimento, unidade, quantidade, preço unitário, pesquisa de preços, dotação e memória de cálculo; hoje o checklist de processo não substitui esses dados estruturados.
7. **Assinatura e documentos finais:** avaliar provedor de assinatura adequado ao nível jurídico exigido; a atual é simples e não ICP-Brasil. Implementar PDF server-side e armazenamento/versionamento da via final se exigido.
8. **Alertas operacionais:** e-mail/WhatsApp e agendamento de alertas de vencimento, com logs, retentativas e preferências.
9. **LGPD e operação:** termos de uso, política de privacidade, contrato de tratamento de dados, retenção/eliminação, plano de incidentes, backups testados, monitoramento, suporte e SLA.
10. **Produção:** domínio próprio, TLS, redirects de Auth, SMTP, segredos, ambientes de homologação/produção e publicação controlada.
11. **Homologação e CI:** testes com duas Secretarias e perfis reais, testes de bloqueio comercial/módulos, restauração de backup, build/typecheck/lint/testes e validação visual autenticada do preview.

**Avisos que continuam abertos:** Security Advisor ainda aponta auth_leaked_password_protection desativado. O CI executado antes desta Fase 4 não comprova a qualidade dos commits novos; a validação desta etapa precisa ser repetida no GitHub Actions e em preview autenticado antes de produção.