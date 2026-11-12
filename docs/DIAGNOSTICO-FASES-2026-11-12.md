# Diagnóstico geral por fases — Gestão de Fornecedores da Saúde

**Fotografia confirmada em 12/11/2026.** Fonte de código: GitHub `main`; fonte de dados: leitura somente leitura do Supabase SMS2 (`rwbbznqtocunzrpcvjvk`). Este diagnóstico não significa liberação comercial.

## Resumo executivo

O produto já tem uma fundação SaaS multitenant e módulos operacionais substanciais: fornecedores, documentos, modelos e geração com aprovação, processos de contratação, pesquisa de preços, dotações, contratos/aditivos, saldos de contrato/ARP, sanções, exportações, Equipe Interna e Suporte. O código principal está aprovado nos workflows de testes, build, TypeScript, lint e formatação.

A estrutura ainda precisa de homologação real. **Não foi confirmado um ciclo autenticado entre duas Secretarias, upload/download GED com usuários municipais, envio de e-mails externos, restauração de backup, Google Drive OAuth, pagamento real ou operação em domínio oficial.** O estado permanece **NO-GO para venda e dados reais**.

## Estado real do SMS2

| Indicador | Resultado em 12/11/2026 |
| --- | ---: |
| Migrations registradas | 74 |
| Tabelas públicas | 38 |
| Tabelas com RLS | 38 |
| Tabelas com FORCE RLS | 27 |
| Políticas RLS | 133 |
| Contas Auth | 2 |
| Perfis | 2 |
| Secretarias | 1 |
| Vínculos municipais | 1 |
| Administradores Master ativos | 1 |
| Colaboradores internos cadastrados | 0 |
| Perfis padrão internos | 5 |
| Permissões internas | 7 |
| Técnicos de suporte | 0 |
| Atribuições/sessões de suporte | 0 |
| Fornecedores | 0 |
| Documentos de fornecedor | 0 |
| Modelos instalados na Secretaria | 0 |
| Documentos gerados | 0 |
| Processos de contratação | 0 |
| Itens/cotações/dotações | 0 |
| Contratos/aditivos | 0 |
| Itens/movimentos de contrato/ARP | 0 |
| Sanções de fornecedor | 0 |
| Entregas de alertas de vencimento | 0 |
| Eventos de auditoria | 46 |
| Objetos no Storage privado | 0 |

O bucket `gfs-private-documents` existe, é privado e permite arquivos até 20 MiB. Nenhum arquivo foi armazenado.

### Edge Functions ativas

| Função | Versão | JWT obrigatório |
| --- | ---: | --- |
| `invite-tenant-user` | 15 | Sim |
| `platform-billing-config` | 13 | Sim |
| `invite-platform-support-agent` | 6 | Sim |
| `invite-platform-staff` | 4 | Sim |
| `send-expiry-notifications` | 3 | Não — autenticação própria por segredo de servidor |

A função de alertas ativa não prova que o serviço de e-mail ou o agendamento estejam homologados.

### Segurança e desempenho

- Todas as 38 tabelas públicas têm RLS; 27 também têm FORCE RLS.
- O Security Advisor aponta 36 funções `SECURITY DEFINER` executáveis por `authenticated`. Muitas são RPCs deliberadas do produto; não revogar em lote. Manter autorização explícita por usuário, papel, tenant e `search_path` fixo.
- O Security Advisor também aponta a proteção contra senhas vazadas desativada. No plano Free, não assumir que o recurso esteja disponível; rever opção/plano Supabase.
- O Performance Advisor aponta seis FKs sem índice, 72 índices sem uso (INFO) e sete grupos com políticas permissivas múltiplas (WARN). A migration com seis índices está em PR #18; ainda não integrada nem aplicada ao SMS2. Não remover índices existentes sem carga real e benchmark.
- `pg_cron` e `pg_net` não estão instalados; a relação `cron.job` não existe no SMS2. O repositório possui workflow GitHub diário para alertas, condicionado à variável `EXPIRY_ALERTS_ENABLED=true` e a secrets que ainda não foram comprovados/configurados.

## Fases do produto

### Fase 0 — Base técnica, interface e publicação

**Código:** pronto para homologação. O GitHub `main` é a fonte de código ligada ao Lovable; CI completo passou no commit observado. O portal público e os contextos Master/Secretaria/Suporte existem.

**Falta:** proteção formal da branch com checks obrigatórios, confirmar publicação do build no Lovable, domínio oficial, DNS/TLS, redirects de Auth, revisão em desktop/tablet/celular e plano de release/rollback. Build verde não prova que a versão publicada está atualizada.

### Fase 1 — Fundação multitenant, usuários e segurança

**Código/schema:** implementados tenants, vínculos, papéis, permissões, módulos, limites, provisionamento, auditoria, separação de identidade Master/municipal/interna/suporte e RLS.

**Falta:** criar duas Secretarias fictícias em ambiente isolado e testar todos os limites cruzados no navegador e no banco: fornecedores, documentos, Storage, modelos, processos, cotações, orçamento, contratos, aditivos, sanções, saldos e auditoria. Confirmar API Exposed Schemas e todas as rotas por perfis de permissão. SMS2 tem somente uma Secretaria; portanto o isolamento multitenant ainda não está comprovado ponta a ponta.

### Fase 2 — Fornecedores, documentos e GED

**Código:** cadastro e consulta de fornecedores; validação de CNPJ; documentos e vencimentos; histórico de sanções por Secretaria com revogação auditada; GED em bucket privado; modelos e versões; campos automáticos; geração com snapshots; aprovação documental; exportação Word/PDF; importação DOCX; fonte binária privada de modelos versionados (migration pendente).

**Falta:** homologar upload/download, URLs assinadas, expiração/arquivamento, substituição e isolamento de Storage com dois tenants. A migration `document_template_binary_source` está no repositório, mas a tabela `document_template_sources` não existe no SMS2. A geração/exportação atual não deve ser descrita como fidelidade completa ao Word original em todos os casos. Assinatura atual é eletrônica simples; não é qualificada ICP-Brasil. Google Drive é reconhecido como link externo, sem OAuth/sincronização integrada ao `main`.

### Fase 3 — Processos, compras, contratos e relatórios

**Código:** processo com checklist atômico; dez etapas com responsável/prazo; itens de contratação; pesquisa e mapa comparativo de preços; frete rateado; cotação selecionada; dotações; contratos/aditivos com guardas de prazo/valor; saldo de contrato/ARP com ledger auditável e estorno; exportação CSV/XLSX das listas; relatórios imprimíveis; sinalização de processo parado.

**Falta:** homologação funcional no navegador com cenários legais e operacionais reais, inclusive modalidades, três cotações, preço de referência, frete, dotação, saldo por item, aditivos e reversões. O relatório CSV específico de contratos vigentes a vencer em até 90 dias está em PR #17 (rascunho/sem merge) e não deve ser contado como parte do `main`.

### Fase 4 — Convites, Equipe Interna e Suporte

**Código/schema:** convites municipais; administração de usuários e papéis; portal interno com RBAC; perfis e permissões customizáveis; técnicos de suporte com atribuição por Secretaria e sessão temporária; suspensão; revogação/cancelamento auditado de convites, preservando a identidade Auth.

**Falta:** fluxo seguro de reenvio de convite para identidade Auth pendente já existente, sem duplicar conta ou permitir autoativação de convite revogado. Também faltam SMTP/domínio de envio, Redirect URLs, SPF/DKIM/DMARC e homologação de convite, confirmação, senha, revogação e expiração. Nenhum colaborador interno ou técnico foi cadastrado.

### Fase 5 — Alertas e integrações

**Código:** sino visual de vencimentos de contratos e documentos; outbox idempotente; Edge Function de entrega em lotes com retries/estado incerto; workflow diário do GitHub com chave de habilitação e confirmação manual.

**Falta:** configurar Resend/SMTP, remetente, `APP_URL`, secret do job e variable `EXPIRY_ALERTS_ENABLED`; homologar e-mails reais com caixa controlada, sem duplicidade e com isolamento por tenant. O workflow não deve ser ativado antes da homologação. Google Drive OAuth por Secretaria, refresh/revogação e política de pasta continuam ausentes do `main`. WhatsApp não está integrado.

### Fase 6 — Backup e continuidade

**Código:** workflow para exportar schema/dados/roles da aplicação, baixar objetos GED e criptografar pacote com age; testes da rotina de Storage.

**Falta:** configurar os secrets/variables; executar backup real; conferir hash; descriptografar com a identidade privada offline; restaurar em projeto Supabase separado; testar Auth, vínculos, policies, funções, bucket e downloads. O pacote lógico não contém identidades/senhas Auth, configurações do projeto, secrets de Edge Functions, SMTP ou metadados gerenciados completos. Não existe restore comprovado nem RPO/RTO aprovado.

### Fase 7 — Comercial, cobrança, LGPD e operação

**Código:** administração de plano/cliente e configuração protegida da integração de cobrança, mantendo `payments_enabled=false`.

**Falta:** escolher gateway, implementar checkout/adaptador, webhooks assinados, idempotência e conciliação; definir preço, limites, trial, tributos, cancelamento, estorno e inadimplência; revisar contrato SaaS, termos, privacidade, DPA/LGPD, retenção e resposta a incidentes; definir SLA, suporte, monitoramento, domínio e piloto. Nenhum pagamento real está ativo.

## Estado das migrations — cuidado obrigatório

O SMS2 registra 74 versões. O repositório contém 75 arquivos SQL. Em cinco migrations já aplicadas, o Supabase registrou timestamp diferente do prefixo local; a branch `chore/align-applied-supabase-migration-versions` renomeia esses arquivos para os timestamps remotos. A migration de fonte binária Word permanece pendente e foi renumerada para `20261112124000`, depois da última versão aplicada (`20261112123300`).

A baseline `20261106194000_restore_operational_process_and_contract_tables` está registrada no SMS2 com `statements` vazio como marcador de histórico; as estruturas já existem. Não reaplicar o SQL de baseline no projeto remoto.

Não executar `supabase db push` ou migration remota em lote enquanto a branch de alinhamento não for revisada e integrada. Não executar os scripts históricos de reparo/reversão depois da correção já registrada. A migration de fonte binária e o PR #18 (seis índices) são mudanças futuras, não aplicadas ao SMS2.

## Próxima sequência técnica recomendada

1. Integrar a conciliação de nomes das migrations após CI verde.
2. Fechar a revisão do PR #18 e integrar os seis índices se CI/pgTAP passarem.
3. Rever PR #17 e decidir se o relatório de vencimentos em 90 dias entra no produto.
4. Implementar reenvio seguro de convites sem duplicar identidades nem reviver convites cancelados.
5. Concluir documentação/validação do motor de documentos e migration de fonte DOCX.
6. Homologar GED, duas Secretarias e os fluxos de processos/contratos em ambiente isolado.
7. Configurar SMTP e workflow de alertas, depois testar envio real.
8. Concluir Drive OAuth, backup/restore, gateway Sandbox e gates jurídico/comercial.

**Decisão atual: NO-GO para produção comercial.** O sistema está estruturalmente avançado, mas as etapas de homologação, integrações externas, continuidade, domínio e conformidade ainda impedem a venda.
