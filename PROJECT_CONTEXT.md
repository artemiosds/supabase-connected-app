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

Schema `public` no SMS2 consultado em 2026-11-12: 38 tabelas, todas com RLS habilitada; 27 com FORCE RLS e 133 políticas. O histórico remoto contém 74 versões até `20261112123300`. O repositório `main` possui 82 migrations SQL; oito migrations futuras permanecem sem aplicação no SMS2: fonte DOCX, timbrado por Secretaria, bloqueio de campos não configurados, cobertura final de índices FK e remoção de políticas SELECT redundantes. A baseline `20261106194000` está registrada como marcador vazio. Não executar `db push` indiscriminadamente; consultar `docs/RECONCILIACAO-MIGRATIONS-SMS2.md`.

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


Autenticação e recuperação; administração e provisionamento de Secretarias; fornecedores; GED privado no Supabase Storage; templates e documentos gerados; usuários e permissões; equipe interna e suporte; processos de contratação, cotações, orçamento, contratos e aditivos.

O Painel Master tem uma aba Configuração técnica com instruções para SMTP, alertas, backup e cobrança, além dos limites atuais de Drive, PDF e assinatura. A tela não coleta segredos nem confirma configuração externa.

O workflow de contratação foi expandido para dez etapas sem renomear os identificadores já usados; cada atividade do checklist pode receber responsável e prazo. A migration versionada também substitui as constraints de etapa nas duas tabelas e permanece não aplicada ao SMS2.

O motor documental agora possui catálogo comum de placeholders para Secretaria, fornecedor, processo e contrato; substituição de campos divididos entre runs; linhas repetíveis de itens; geração Word a partir do DOCX original privado por versão; e prévia/lista de campos pendentes. O editor continua textual: se o conteúdo for alterado, o vínculo com o DOCX original é descartado; ao reabrir/editar ou restaurar uma versão sem alterar texto, o sistema recupera e preserva o original. A RPC de tramitação bloqueia envio à aprovação quando permanecem `[PREENCHER: ...]`, `[CAMPO NÃO CONFIGURADO: ...]` ou `{{...}}`. A exportação PDF agora usa renderizador próprio com cabeçalho, rodapé, margens, paginação e brasão configuráveis por Secretaria; não é conversor Word completo, portanto recursos incompatíveis são sinalizados ou bloqueados. As migrations de fonte DOCX, timbrado e bloqueio de campos ainda não foram aplicadas ao SMS2. Também dependem de configuração ou homologação: Google Drive OAuth/sincronização, SMTP e entrega real de e-mails, restauração de backup em projeto isolado, PDF server-side, assinatura qualificada ICP-Brasil, WhatsApp, gateway de pagamento/webhooks e validação de isolamento com duas Secretarias. PDF atual usa impressão do navegador; assinatura existente é simples.



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


## Saldo de contratos e Atas — em construção

- A migration versionada `20261111200821_contract_arp_item_balances.sql` adiciona tipo de instrumento (contrato/ARP), itens com limite financeiro, saldo por item e livro razão imutável de consumo/estorno.
- RPCs de consumo e estorno validam sessão, Secretaria ativa, módulo habilitado, permissão, vigência, saldo e justificativa; os movimentos não podem ser inseridos ou editados diretamente por usuários autenticados.
- A migration inclui RLS forçada, chaves compostas com tenant, índices e eventos de auditoria sem gravar valores pessoais nos detalhes.
- A migration permanece no repositório e **não foi aplicada ao SMS2**. A tela de contratos permite classificar contrato/ARP, cadastrar itens, consultar saldo, registrar consumo com justificativa e estornar sem apagar o histórico. O CI do commit `9f2dc569b886b8a9564b73e42a0c2cab01001595` passou migrations em banco descartável e pgTAP; homologação visual/E2E por papéis permanece pendente.


- Validação local do saldo de contratos/Atas: 3 testes unitários passaram; `tsc --noEmit` passou no snapshot local sincronizado com os tipos novos. Build, lint e pipeline oficial passaram no commit `9f2dc56`. A migration continua sem aplicação no SMS2.


## Relatórios e exportação

- Fornecedores, processos e contratos/Atas exportam a lista filtrada em CSV UTF-8 com separador regional compatível com Excel. Os arquivos incluem campos operacionais necessários, sem exportar contatos/endereço de fornecedores.
- A saída neutraliza conteúdo que poderia ser interpretado como fórmula de planilha e sanitiza o nome do arquivo.
- Relatórios gerenciais oferecem CSV, XLSX nativo e impressão para PDF; a validação visual do relatório continua pendente. Documentos oficiais usam o fluxo documental existente, que ainda depende de homologação do layout.


## Exportação de relatórios

- Fornecedores, processos e contratos/Atas oferecem CSV UTF-8 compatível com Excel e impressão do relatório para salvar como PDF pelo navegador.
- O CSV usa separador regional e neutraliza fórmulas; a impressão escapa conteúdo HTML e permite visualizar antes de imprimir.
- PDF gerencial não é timbrado nem renderizado no servidor. XLSX nativo é gerado no navegador com o JSZip já declarado no projeto, sem fórmulas executáveis, com cabeçalho fixo, filtros e limite de 10.000 registros por exportação. A homologação visual do relatório continua pendente.


## Exportação de rascunhos documentais

- A lista de documentos gerados permite baixar Word (.docx) e PDF de rascunhos, a partir de `content_snapshot` revisado e do motor `src/lib/docx-engine`; documentos assinados e cancelados não recebem cópia editável por esse fluxo.
- O cabeçalho usa o nome da Secretaria e o rodapé indica rascunho. Não há brasão configurado nem garantia de fidelidade aos estilos de um DOCX originalmente importado.
- O fluxo foi verificado em build, tipos, lint e testes do motor; download no navegador e conferência visual continuam pendentes.


## Motor DOCX/PDF e timbrado — código de 12/11/2026

- A migration `20261112124000_document_template_binary_source.sql` cria `document_template_sources` imutável por `(template_id, version)`, chaves compostas e políticas de Storage privado em `gfs-private-documents`.
- A migration `20261112124500_tenant_document_branding.sql` cria configurações por Secretaria para título, subtítulo, rodapé, brasão PNG/JPEG privado, margens e numeração de páginas, com RLS, políticas de Storage e auditoria.
- A migration `20261112125000_block_unconfigured_document_fields.sql` reforça o bloqueio server-side de envio para aprovação quando restam campos ausentes ou não configurados.
- As três migrations estão no `main`, testadas em Supabase descartável/pgTAP, mas não foram aplicadas no SMS2.
- O DOCX original é carregado por versão, preservado ao editar metadados/restaurar versão e usado na exportação Word quando o texto não foi alterado. O editor da página ainda é textual; editar o texto desvincula o original. Editor visual rico preservando formatação durante edição permanece pendente.
- O PDF usa renderizador `pdf-lib` a partir do modelo; logo, margens, cabeçalho/rodapé e paginação são testados. Não é conversão Word completa: recursos incompatíveis são bloqueados e alguns estilos de fonte/cor/tabela podem ser simplificados.
- A homologação de modelos reais, duas Secretarias, perfis, downloads autenticados, comparação visual Word/PDF e aplicação segura das migrations continuam pendentes.
- No commit `1e6207cec299912a8212595a0ffd57c5928f5dc7`, o PDF passou a centralizar brasão, cabeçalho e rodapé pela largura real da página, inclusive paisagem. O teste automatizado cobre as duas larguras.
- O leitor DOCX agora verifica o tamanho descompactado declarado de cada entrada e o total do pacote antes de inflar qualquer arquivo; teste ZIP comprimido excessivamente grande incluído.
- CI completo aprovado no run [43271911944](https://github.com/artemiosds/supabase-connected-app/actions/runs/43271911944): testes, build, tipos, Deno, lint, aplicação das 79 migrations em banco descartável e pgTAP.
- SMS2 permanece inalterado: 74 migrations até `20261112123300`; as tabelas `document_template_sources` e `tenant_document_branding` não existem nele.


## Reconciliação de migrations — auditoria de 12/11/2026

- Fotografia da reconciliação inicial: o SMS2 registra 74 versões até `20261112123300`; o `main` agora possui 82 arquivos SQL, com oito migrations futuras ainda não aplicadas. Os cinco timestamps divergentes foram alinhados ao histórico remoto no PR #19, preservando o SQL.
- A baseline `20261106194000` está registrada como marcador vazio; as estruturas correspondentes existem. Não reaplicar a baseline nem reparar o histórico sem backup restaurado e comparação de definições.
- Oito migrations futuras aguardam implantação: fonte DOCX privada (`20261112124000`), timbrado por Secretaria (`20261112124500`), bloqueio de campos não configurados (`20261112125000`), proteção das transições do workflow de contratação (`20261112125500`), endurecimento da imutabilidade do checklist (`20261112132000`), FORCE RLS dos originais DOCX (`20261112133000`), cobertura de índices FK (`20261112150000`) e remoção de políticas SELECT redundantes (`20261112162000`). As tabelas `document_template_sources` e `tenant_document_branding` estão ausentes no SMS2.
- As migrations futuras foram aplicadas e testadas em banco Supabase descartável no CI do commit `2a3570d`; nenhuma foi aplicada ao SMS2. Plano e mapeamento em `docs/RECONCILIACAO-MIGRATIONS-SMS2.md`.


## Pré-requisito de backup para corrigir o histórico — 12/11/2026

- A baseline sem versão foi conferida em leitura: quatro tabelas com colunas de base esperadas, 14 índices e 12 políticas presentes; RLS/FORCE ativos, sem grants `anon` e zero linhas nas quatro tabelas. Isso não demonstra um backup restaurável nem a equivalência de toda definição após migrations posteriores.
- O SMS2 é o único projeto conectado da organização Free; nenhuma das 828 execuções de Actions foi do workflow de backup. Não há evidência de artefato criptografado, chave privada de recuperação ou restauração isolada. Não alterar histórico ou schema do SMS2 antes de cumprir esse gate.
- Ver `docs/RECONCILIACAO-MIGRATIONS-SMS2.md` e `docs/ROTINA-DE-BACKUP.md`. O usuário autorizou continuar a correção, mas nenhum DDL ou reparo de produção foi executado nesta etapa.


## Correção autorizada do histórico — 12/11/2026

- O usuário dispensou o backup como pré-requisito; isso remove o bloqueio de processo, não o risco de recuperação. A alteração do metadata será transacional e está registrada nos dois SQLs em `docs/REPARO-HISTORICO-SMS2*.sql` antes de execução.
- A baseline também exige a unicidade de `suppliers(tenant_id,id)`; no SMS2 a constraint nomeada está ausente, mas o índice único `ux_suppliers_tenant_id_id` provê a mesma chave. As quatro tabelas operacionais e `supplier_documents` têm zero linhas na pré-verificação.


## Validação de segurança adicional — 12/11/2026, commit `2a3570daef8d931f6bcf2a9e5c4e7ab033c9d51b`

- O importador DOCX valida CRC-32 do XML principal, nome/caminho do cabeçalho local, flags, método de compressão, tamanhos declarados e limite anterior ao diretório central. Pacotes corrompidos ou inconsistentes são rejeitados antes da importação.
- A tela Documentos descarta resultados assíncronos de seleção, análise/importação, URL temporária, cadastro, upload e arquivamento quando a Secretaria selecionada muda; upload sem vínculo é removido quando a troca ocorre antes da gravação dos metadados.
- CI integral aprovado no run [43302243085](https://github.com/artemiosds/supabase-connected-app/actions/runs/43302243085): testes unitários, build, TypeScript, Deno, lint, aplicação das 82 migrations em banco descartável e pgTAP; formatação aprovada no run [43302243137](https://github.com/artemiosds/supabase-connected-app/actions/runs/43302243137).
- O SMS2 continua com 74 migrations até `20261112123300`; as oito migrations futuras listadas acima permanecem sem aplicação.
- Continuam pendentes E2E autenticado em navegador, homologação visual com modelos DOCX oficiais anonimizados, teste de isolamento com duas Secretarias e backup/restauração em projeto isolado. Não declarar a Fase 1 homologada apenas pela CI.
