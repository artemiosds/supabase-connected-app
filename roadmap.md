# Roadmap — Gestão de Fornecedores da Saúde

Atualizado em **08/11/2026**, com conferência do GitHub `main` e do Supabase SMS2.

## Estado real verificado

- **Repositório oficial:** `artemiosds/supabase-connected-app`, branch `main`.
- **Banco gerenciado:** Supabase SMS2, projeto `rwbbznqtocunzrpcvjvk`, região São Paulo.
- **Preview:** projeto Lovable conectado ao GitHub. “Ready” no preview não substitui homologação autenticada.
- **Migrations:** 41 versões registradas no histórico do SMS2. A mais recente é `20261108154457_tenant_first_invitation_mutation_locking`. As migrations das Fases 1, 2, 3, 4, 5.1, 5.2 e 5.3/5.3.1/5.3.2, além dos reforços finais de capacidade, RLS, índices e privilégios, estão aplicadas e versionadas. A estrutura histórica inicial de processos/contratos continua sendo instalada pela baseline manual documentada; não execute essa baseline no SMS2 atual.
- **Dados atuais:** 1 administrador global ativo; 0 Secretarias, 0 vínculos municipais, 0 fornecedores, 0 documentos de fornecedores, 0 convites, 0 arquivos GED, 0 processos, 0 itens/cotações/orçamentos, 0 contratos e 0 documentos gerados. Existem 5 modelos-base no catálogo e o bucket GED privado está criado. Não há dados municipais reais para homologação.

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
- Todas as 23 tabelas de aplicação
- As 12 tabelas operacionais multi-tenant usam também FORCE ROW LEVEL SECURITY; as tabelas auxiliares globais e de identidade mantêm RLS com políticas próprias.
- Schema interno `app_auth`: `anon` não possui USAGE; as funções privilegiadas têm caminho de busca fixado.
- As 41 migrations registradas estão sincronizadas
- Já existe um superadministrador global ativo, com usuário Auth confirmado. **Não execute o bootstrap inicial novamente neste SMS2.** O script em `supabase/operations/bootstrap_first_platform_admin.sql` serve apenas para instalação nova, sem nenhum administrador global.
- Testes SQL transacionais anteriores validaram criação de Secretaria, papéis padrão, proteção de papéis/permissões administrativas e isolamento entre duas Secretarias. As transações foram revertidas.
- A consulta atual confirmou que não há tenants ou dados operacionais fictícios persistidos.

### Pendências de configuração/homologação da Fase 1
1. No Supabase Dashboard, confirme em **Project Settings → API → Exposed schemas** que `app_auth` não está listado. A lista de schemas expostos é uma configuração da API e não pode ser comprovada só pela consulta SQL.
2. **Proteção contra senhas vazadas:** o Supabase informa que esse recurso está disponível apenas no plano Pro ou superior. O SMS2 permanece no Free; remover esse alerta exige aprovação de upgrade pago.
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
- **Google Drive:** o sistema reconhece links e extrai o ID do arquivo; OAuth, autorização de pastas, upload e sincronização automática ainda não foram configurados. O GED privado pelo Supabase Storage foi iniciado na Fase 5.1.
- **PDF:** a versão atual usa a impressão do navegador; não há geração PDF no servidor nem armazenamento persistente da via assinada.
- **Assinatura:** é eletrônica simples e associada à sessão; não é assinatura qualificada ICP-Brasil nem integração com provedor de assinatura.
- **Alertas:** painel e listagem exibem vencimentos; envio agendado por e-mail/WhatsApp requer provedor e agendador.
- **Convites:** a Fase 5.3 implementou convite por e-mail, aceite após confirmação e definição de senha, administração e cancelamento de convites; depende de SMTP próprio e homologação com destinatários reais.
- **Importação de modelos:** arquivos `.txt` e `.md`; DOC/DOCX precisam ser copiados e colados, pois não existe importador Word nativo.

## Qualidade e liberação

- CI do commit `f26b1b02f80e3da8e5ba39331b67f75d7d9fb4ad` passou integralmente no GitHub Actions: instalação congelada do Bun, 9 testes unitários, TypeScript, build de produção e lint. Execução: [GitHub Actions #50](https://github.com/artemiosds/supabase-connected-app/actions/runs/41957688389).
- Foram adicionadas verificações de rotas para todas as telas autenticadas e um teste do exemplo alfanumérico de CNPJ `00.000.000/E08G-12`.
- O workflow de CI usa Bun e o lockfile oficial `bun.lock`; o último run completo passou em todas as etapas.
- O roteiro de homologação está em `docs/TESTE-MVP.md`.
- Security Advisor:
- Performance Advisor:
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


## FASE 5.1 — GED privado de documentos de fornecedores (07/11/2026)

**Status:** migration aplicada e UI de upload/acesso implementada; teste autenticado com arquivo real ainda pendente.

- Bucket `gfs-private-documents` privado, limite de 20 MiB e allowlist de PDF, DOC, DOCX, XLS, XLSX, JPG e PNG.
- `supplier_documents` recebeu `storage_path`, `file_name`, `mime_type` e `file_size`; metadados antigos de links/Drive foram preservados.
- RLS do Storage separa cada arquivo por Secretaria, fornecedor e documento; leitura exige documento ativo e permissões/módulos corretos.
- Upload valida extensão, MIME, assinatura básica e tamanho; download usa URL assinada temporária.
- Arquivo vinculado não pode ser sobrescrito em edição; substituição exige novo documento e preserva o anterior.
- **Pendente:** teste autenticado de upload/download, isolamento entre duas Secretarias, arquivamento e bloqueio do link.

## FASE 5.2 — Dados estruturados da contratação (07/11/2026)

**Status:** banco e telas implementados; homologação com cotações e orçamento reais de teste pendente.

- Tabelas `procurement_items`, `procurement_price_quotes` e `procurement_budget_allocations` estão criadas e isoladas por `tenant_id`.
- Processos aceitam itens de compra estruturados, especificação, unidade e quantidade.
- Cotações registram fornecedor, fonte e valores; a escolha de cotação de referência é atômica.
- Dados de itens, cotações e orçamento são incorporados ao contexto/snapshot dos documentos.
- **Pendente:** cadastrar três cotações, escolher referência, verificar totais, vincular dotação e testar isolamento entre Secretarias.

## FASE 5.3 — Convites de usuários por e-mail (08/11/2026)

**Status:** schema aplicado, Edge Function publicada e interface integrada; entrega real depende de SMTP próprio e homologação com destinatários controlados.

- Tabela `tenant_invitations` com validade de 7 dias, papel atribuído, aceite, revogação e auditoria.
- Edge Function `invite-tenant-user` publicada no SMS2 com `verify_jwt=true`; chave administrativa permanece apenas no ambiente servidor.
- Tela Usuários oferece **Convidar por e-mail**, lista convites e permite cancelar convites pendentes; o vínculo de contas existentes foi preservado.
- Convidado confirma o mesmo endereço, define senha em `/redefinir-senha?convite=1` e recebe o vínculo no primeiro acesso.
- O aceite respeita Secretaria ativa, limite de usuários e papel escolhido; não reativa vínculo suspenso/inativo nem concede acesso a administrador global.
- RPCs públicas de convite são `SECURITY INVOKER`; a lógica privilegiada está no schema interno `app_auth`. O Security Advisor deixou de apontar essas quatro RPCs públicas como SECURITY DEFINER.
- **Configuração pendente:** SMTP personalizado e URLs de redirecionamento no Supabase Auth. O preview atual está autorizado; o domínio de produção precisa ser incluído em `INVITE_ALLOWED_ORIGINS` e nas URLs permitidas do Auth.
- A criação do convite reserva uma vaga no limite de usuários: o cálculo considera vínculos ativos mais convites pendentes e não expirados. A expiração libera a vaga.
- **Pendente:** SMTP próprio, envio/recebimento real, confirmação, definição de senha, aceite, revogação, expiração e testes do limite com duas Secretarias.

## FASE 6 — O que falta para o SaaS estar pronto para clientes

1. **Onboarding/homologação real:** cadastrar a primeira Secretaria de teste, confirmar o administrador municipal, habilitar módulos, atribuir permissões e percorrer os fluxos com duas Secretarias. O convite está preparado, mas depende de SMTP.
2. **Instalações novas:** a baseline manual de processos/contratos e a ordem completa de instalação estão documentadas em `docs/INSTALACAO-BASELINE.md`. O SMS2 atual já possui as quatro tabelas; não executar a baseline nele.
3. **GED completo:** testar upload/download real, definir retenção e validar restauração dos arquivos. O backup lógico criptografado de `gfs-private-documents` foi preparado; os documentos gerados ainda precisam de PDF server-side e integração ao GED.
4. **E-mail operacional:** configurar SMTP próprio, allowlist de URLs/domínios e monitorar entregas/retentativas dos convites e notificações.
5. **Cobrança real:** provedor de pagamento, planos/assinaturas, faturas, webhooks, inadimplência, tentativas de cobrança, cancelamento e conciliação. Hoje existem somente os metadados comerciais.
6. **Compras estruturadas:** homologar itens, cotações, cotação vencedora, orçamento e relatórios com processos reais; ampliar depois a pesquisa formal e memória de cálculo.
7. **Assinatura e documentos finais:** avaliar provedor de assinatura adequado ao nível jurídico exigido; a atual é simples e não ICP-Brasil. Implementar PDF server-side e armazenamento/versionamento da via final se exigido.
8. **Alertas operacionais:** e-mail/WhatsApp e agendamento de alertas de vencimento, com logs, retentativas e preferências.
9. **LGPD e operação:** termos de uso, política de privacidade, contrato de tratamento de dados, retenção/eliminação, plano de incidentes, backups testados, monitoramento, suporte e SLA. A rotina lógica de backup está em `docs/ROTINA-DE-BACKUP.md`, mas exige secrets e chave de criptografia; não substitui backup integral de Auth.
10. **Produção:** escolher domínio próprio, TLS, redirects de Auth, SMTP, segredos, ambientes de homologação/produção e publicação controlada. O domínio de produção ainda não foi informado e não foi configurado.
11. **Homologação e CI:** testes com duas Secretarias e perfis reais, testes de bloqueio comercial/módulos, restauração de backup, build/typecheck/lint/testes e validação visual autenticada do preview.

**Avisos que continuam abertos:**