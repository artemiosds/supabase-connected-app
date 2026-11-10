# Plano de conclusão da estrutura — Gestão de Fornecedores da Saúde

Escopo: só estrutura. Sem testes, E2E, CI nem homologação nesta etapa. Itens marcados "(a confirmar)" vieram da leitura dos nomes, abas e consultas no código, sem conferir cada linha.

## 1. O que já existe no código (e onde)

| Área | Onde está | Situação |
|---|---|---|
| Autenticação (entrar, cadastro, recuperar/redefinir senha) | `src/routes/entrar|cadastro|recuperar-senha|redefinir-senha.tsx`, `src/hooks/use-auth.tsx` | Código pronto |
| Portal da Secretaria (layout, menu por módulos, bloqueio comercial, sino) | `src/routes/_authenticated.tsx`, `src/lib/commercial-access.ts`, `src/components/sino-alertas.tsx` | Código pronto |
| Painel da Secretaria | `_authenticated/painel.tsx` (6 cards) | Só indicadores, sem gráficos nem pendências |
| Organizações / tenant ativo | `_authenticated/organizacoes.tsx`, `src/hooks/use-tenant.tsx` | Pronto |
| Usuários, convites, perfis | `_authenticated/usuarios.tsx`, Edge `invite-tenant-user`, RPCs de convite/papel | Código pronto; e-mail depende de SMTP |
| Fornecedores (CNPJ, contato, endereço) | `_authenticated/fornecedores.tsx`, `src/lib/cnpj.ts` | Pronto |
| GED de fornecedor (bucket privado `gfs-private-documents`) | `documentos.tsx` aba Vencimentos, tabela `supplier_documents` | Código pronto; sem arquivos reais |
| Modelos, versões, biblioteca-base, importação DOCX, geração, assinatura simples, impressão | `documentos.tsx` (abas Modelos/Gerados/Biblioteca), `src/lib/docx-import.ts` | Pronto; PDF = impressão do navegador; assinatura não ICP-Brasil |
| Processos (Kanban 6 etapas, checklist, itens, cotações, dotação) | `_authenticated/processos.tsx`, `src/lib/contratacao.ts` | Núcleo pronto |
| Contratos e aditivos, régua 120/90/60/30 | `_authenticated/contratos.tsx`, `src/lib/expiry-alerts.ts` | Pronto |
| Auditoria | `_authenticated/historico.tsx`, gatilhos no banco | Pronto (leitura) |
| Configurações | `_authenticated/configuracoes.tsx` (perfil, dados da Secretaria, conta) | Básico |
| Suporte técnico | `_authenticated/suporte.tsx`, `admin-master-support.tsx`, `src/lib/support-rpc.ts`, Edge `invite-platform-support-agent` | Código pronto |
| Painel Master (visão geral, clientes, planos, cobrança, métricas, auditoria, equipe, suporte) | `src/routes/admin-master.tsx`, `admin-master-billing|staff|support.tsx`, `use-platform-admin.tsx` | Código pronto |
| Equipe interna (RBAC) | `platform-staff-workspace.tsx`, Edge `invite-platform-staff` | Código pronto |
| Alertas por e-mail | Edge `send-expiry-notifications` (Resend), outbox no banco, workflow GitHub | Código pronto; sem segredo, agendador nem remetente |
| Cobrança | `admin-master-billing.tsx`, Edge `platform-billing-config` | Só guarda credenciais; `payments_enabled=false` |
| Backup | `.github/workflows/backup-sms2.yml` | Código; restauração nunca comprovada |

Conectado de verdade hoje: Supabase SMS2 (banco, Auth, Storage, Edge Functions publicadas). Não conectado: SMTP/remetente de e-mail, Resend, agendador, Google Drive, gateway de pagamento, WhatsApp, assinatura ICP-Brasil, domínio próprio.

## 2. O que falta ou está incompleto

### A. Construível agora, só tela/código (sem banco novo nem credenciais)
1. **Dividir arquivos gigantes** (`documentos.tsx` 1.737 linhas, `processos.tsx` 1.538, `admin-master.tsx` 1.383) em componentes por aba, sem mudar comportamento. Facilita todo o resto.
2. **Assistente por etapa no processo**: dentro do detalhe, botão "Gerar DFD/ETP/TR/Riscos desta etapa" que abre o modelo certo com dados do processo preenchidos (`generate_document_from_process` já existe).
3. **Linha do tempo do processo**: histórico de etapa/checklist lendo `audit_events` filtrado pelo processo.
4. **Dossiê para impressão**: página `/processos/$id/dossie` montando capa, índice, checklist, itens, cotações, dotação e documentos gerados, impresso pelo navegador.
5. **Página de detalhe** para fornecedor (`/fornecedores/$id`: documentos, contratos, processos) e contrato (`/contratos/$id`: aditivos, linha do tempo, dias restantes).
6. **Painel da Secretaria**: pendências do dia, processos parados por etapa, contratos por faixa de vencimento, documentos vencidos.
7. **Central de alertas** (`/alertas`): lista completa do que o sino já calcula, com filtros.
8. **Busca global** no cabeçalho (fornecedor, processo, contrato).
9. **Experiência responsiva**: Kanban em rolagem horizontal/lista no celular, tabelas como cartões, diálogos em tela cheia no celular.
10. **Página inicial pública** (`index.tsx` hoje 26 linhas) com apresentação do produto e entrada.
11. **Estados vazios orientados** (primeiro fornecedor, primeiro processo) para usuário não técnico.
12. **Ajuda contextual** curta por tela, com o fluxo da Lei 14.133.

### B. Precisa de mudança no banco (aguarda sua autorização para cada migration)
13. **Fluxo de 9 etapas do PPTX** (hoje são 6): novas etapas/checklist padrão e conversão das etapas atuais.
14. **Anexos de processo e de contrato no GED** (hoje o GED é só de fornecedor): tabela de anexos com tenant, RLS e caminho no bucket.
15. **Tramitação e despachos**: tabela de despachos (de setor, para setor, parecer, prazo) e tela no processo.
16. **Matriz de riscos estruturada** (risco, probabilidade, impacto, resposta, responsável) em vez de só texto.
17. **Fiscal e gestor como usuários** (hoje texto livre): vínculo a usuários, portaria, data, substituto — necessário para alertas irem à pessoa certa.
18. **Notificações internas persistidas** (lida/não lida) e preferências por usuário; hoje o sino só calcula na hora.
19. **Destinatários de alerta e prazos por Secretaria** em Configurações.
20. **Ocorrências/penalidades e avaliação de fornecedor** por contrato.
21. **Saldo e execução do contrato** (empenhos/medições) — decisão de negócio sobre quanto detalhar.
22. **Faturas/cobranças por cliente** no Master (registro manual antes de qualquer gateway).
23. **Reconciliar o histórico de migrations** do SMS2 (versões divergentes já documentadas) antes de qualquer nova migration.

### C. Depende de provedor externo, credencial ou decisão de negócio
24. **E-mail** (convites e alertas): escolher remetente/SMTP (Resend já previsto no código), domínio, URLs de retorno; segredo `RESEND_API_KEY`.
25. **Agendador dos alertas**: GitHub Actions (já existe workflow) ou `pg_cron` (não instalado). Decisão + segredo.
26. **WhatsApp**: escolher provedor (ex.: Twilio/Meta). Nada no código.
27. **Google Drive**: OAuth por Secretaria, pasta, sincronização. Hoje só reconhece link.
28. **PDF de verdade** (servidor) e **assinatura ICP-Brasil**: escolher provedor; manter impressão e assinatura simples até lá.
29. **Gateway de pagamento + webhooks** (Mercado Pago/Asaas/Stripe etc.): escolha, chaves, rota pública verificada e conciliação.
30. **Planos, preços, limites, cancelamento, LGPD/contrato SaaS** — decisões comerciais/jurídicas.
31. **Domínio, monitoramento, backup com restauração comprovada** — infraestrutura.

## 3. Ordem sugerida (entregas pequenas)

```text
Etapa 1  (agora)   A1 dividir arquivos grandes  -> base para o resto
Etapa 2  (agora)   A5 detalhes fornecedor/contrato + A3 linha do tempo
Etapa 3  (agora)   A2 assistente DFD/ETP/TR por etapa + A4 dossiê
Etapa 4  (agora)   A6 painel + A7 central de alertas + A8 busca
Etapa 5  (agora)   A9 responsivo + A11 estados vazios + A12 ajuda + A10 página inicial
Etapa 6  (banco)   B23 reconciliar histórico -> B13 9 etapas -> B14 anexos -> B15 tramitação
Etapa 7  (banco)   B17 fiscal/gestor -> B18/B19 notificações e destinatários -> B16 riscos
Etapa 8  (banco)   B20 ocorrências -> B21 execução -> B22 faturas manuais
Etapa 9  (externo) C24 e-mail + C25 agendador -> C26 WhatsApp
Etapa 10 (externo) C27 Drive, C28 PDF/ICP, C29 gateway, C30/C31 comercial e infraestrutura
```

Cada migration da Etapa 6 em diante: SQL apresentado antes, nova migration com data em `supabase/migrations`, RLS por tenant, auditoria por gatilho, aplicada só com sua aprovação explícita.

## Detalhes técnicos
- Divisão de arquivos: `src/components/documentos/*`, `src/components/processos/*`, `src/components/admin-master/*`; rotas ficam só com carregamento e composição.
- Novas rotas: `_authenticated/fornecedores.$id.tsx`, `contratos.$id.tsx`, `processos.$id.dossie.tsx`, `alertas.tsx`, todas com `head()` próprio.
- Leituras via `db` tipado de `src/lib/db.ts`; nada de `any` nem `dbFase3`.
- Responsivo usando `use-mobile.tsx` e tokens do `src/styles.css`.
- Gateway: rota pública em `src/routes/api/public/*` verificando assinatura do provedor.
- Decisões que preciso de você: 9 ou 6 etapas; nível de detalhe da execução contratual; provedores de e-mail, WhatsApp, pagamento e assinatura.
