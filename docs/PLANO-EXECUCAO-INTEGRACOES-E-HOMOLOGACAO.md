# Plano de execução — integrações, homologação e liberação comercial

**Projeto:** Gestão de Fornecedores da Saúde  
**Repositório de referência:** `artemiosds/supabase-connected-app`, branch `main`  
**Supabase:** SMS2, projeto `rwbbznqtocunzrpcvjvk`, região São Paulo  
**Estado observado:** 09/11/2026

## Objetivo e limite de escopo

A fundação multitenant e os módulos principais já estão versionados e aplicados. O próximo ciclo não deve reconstruir as Fases 1 e 2, repetir o bootstrap do Administrador Master nem criar tabelas preventivamente.

O trabalho passa a ser orientado a evidências: integração de serviços externos, homologação autenticada por duas Secretarias, recuperação testada e preparação comercial. Qualquer necessidade de alteração estrutural deve ser demonstrada por um requisito concreto, revisada isoladamente e adicionada por migration versionada somente depois de confirmar que as estruturas atuais não atendem ao caso.

**Proibições operacionais:** não apagar dados, não popular SMS2 com dados fictícios permanentes, não expor chaves administrativas no frontend, não habilitar pagamentos reais antes dos testes de Sandbox e não liberar produção enquanto algum gate obrigatório estiver sem evidência.

## Fotografia técnica conferida

- 47 migrations registradas no Supabase e correspondência anterior de 47 arquivos SQL no repositório.
- 24/24 tabelas públicas com RLS; 13/24 com FORCE RLS.
- 2 identidades Auth: Administrador Master ativo e outra conta; ainda não há Secretaria municipal, vínculo municipal, convite enviado ou dado operacional.
- Bucket `gfs-private-documents` privado, limite 20 MiB e tipos PDF/DOC/DOCX/XLS/XLSX/JPG/PNG; nenhum objeto persistido no Storage.
- Duas Edge Functions ativas: `invite-tenant-user` v6 e `platform-billing-config` v4. Não há Edge Function de alertas nem integração OAuth/sincronização Drive publicada.
- `pg_cron` e `pg_net` não estão instalados; a relação `cron.job` não existe no banco consultado.
- Advisor de segurança: um aviso externo `auth_leaked_password_protection`; Health Advisor sem alertas; Performance Advisor com 56 observações INFO de índices não utilizados. Não remover índices sem carga real e benchmark.
- CI no commit `5b9da605e534711ef092c130362cd34b7adc68f9`: Validate application #225 e Format procurement module #107 aprovados. Esses checks não substituem E2E autenticado no navegador.
- Branch `main) estava sem proteção e sem status checks obrigatórios. A configuração de proteção deve ser concluída em GitHub Settings após validar os nomes dos checks.
- O backup lógico está versionado, mas não há prova de execução, descriptografia e restauração num projeto separado.

## Ordem de execução

### Etapa 0 — Controle de release e CI

**Objetivo:** impedir que uma alteração entre na branch principal sem validação.

Ajuste implementado neste ciclo: o workflow `.github/workflows/format-procurement.yml` foi alterado para rodar também em Pull Requests, executar `prettier --check` e operar com `contents: read`. A etapa de commit/push automático foi removida.

**Ações restantes no GitHub:**
1. Aguardar e conferir os dois workflows no commit desta alteração.
2. Abrir Settings → Branches (ou Rulesets) e exigir Pull Request para `main).
3. Tornar obrigatórios os checks do workflow `Validate application` e `Format procurement module`, usando os nomes exatos exibidos no primeiro PR de validação.
4. Restringir bypass administrativo a uma exceção deliberada e auditada; não permitir que um workflow de CI faça push direto em `main).

**Aceite:** PR de teste executa ambos os checks; merge é bloqueado quando um check falha; workflow de formatação não escreve no repositório.

### Etapa 1 — Auth, SMTP e convites

**Pré-requisitos externos:** domínio remetente controlado pelo proprietário, provedor SMTP e acesso administrativo ao Supabase.

1. Configurar SMTP próprio no Supabase Auth; não usar o remetente compartilhado do Supabase como serviço de produção.
2. Publicar SPF, DKIM e DMARC para o domínio de envio e verificar a autenticação do remetente no provedor.
3. Configurar Auth Site URL e Redirect URLs para homologação; adicionar o domínio oficial quando definido.
4. Configurar os secrets de servidor `APP_URL` e `INVITE_ALLOWED_ORIGINS` nas Edge Functions; não colocar segredo service-role em variáveis públicas.
5. Revisar templates de confirmação, convite e recuperação de senha com identidade visual e instruções claras.
6. Homologar cadastro, confirmação, login, recuperação, convite, aceite, revogação, expiração, usuário já existente e limite de vagas com contas/e-mails controlados.
7. Registrar evidências sem incluir links com tokens ou dados pessoais nos logs.

**Aceite:** cada e-mail chega ao destino de teste, link usa a origem correta, fluxo conclui com o papel esperado e convites expirados/revogados não concedem acesso.

### Etapa 2 — Duas Secretarias e isolamento multitenant

**Pré-requisitos externos:** pelo menos três endereços de e-mail controlados (Master e dois administradores/usuários municipais) e navegador autenticado.

1. Provisionar Secretaria A pelo fluxo normal, com administrador municipal A.
2. Provisionar Secretaria B com usuário municipal B independente.
3. Criar registros de homologação identificáveis nas duas organizações.
4. Validar acesso normal em cada organização.
5. Tentar cruzar IDs de fornecedores, documentos, processos, itens, cotações, orçamento, contratos, aditivos, arquivos GED, modelos privados e histórico.
6. Validar tenant suspenso, bloqueio comercial, módulo desativado, permissão insuficiente, limite de usuários e convite concorrente.
7. Confirmar que Administrador Master não ganha acesso operacional automaticamente aos dados dos clientes.

**Aceite:** nenhuma leitura, alteração, assinatura de URL, download ou operação cruzada entre Secretarias; tentativa indevida deve falhar no servidor/banco, não apenas esconder a opção na interface.

### Etapa 3 — GED e documentos

1. Com usuário municipal, enviar um arquivo de cada MIME permitido e testar download autenticado.
2. Confirmar que os objetos ficam em bucket privado e que o aplicativo entrega somente URL assinada temporária após autorização.
3. Testar tamanho acima de 20 MiB, extensão incompatível, conteúdo incompatível, substituição, arquivamento e tentativa de novo link após arquivamento.
4. Repetir a leitura com a conta da outra Secretaria.
5. Verificar histórico e auditoria sem gravar tokens/URLs assinadas.
6. Definir a política de retenção, recuperação e exclusão lógica antes de armazenar documentos reais.

**Aceite:** upload e download válidos funcionam; arquivos indevidos são recusados; URL expirada não funciona; organização diferente não acessa arquivo; arquivo arquivado não recebe novo link; backup inclui os objetos.

### Etapa 4 — Homologação funcional completa

Executar no navegador, com contas municipais e dados fictícios, os roteiros de `docs/TESTE-MVP.md` e `docs/GO-LIVE-CHECKLIST.md`.

Cobrir, no mínimo: fornecedores e CNPJ; documentos e vencimentos; instalação/versionamento de modelos; geração de DFD/ETP/TR e campos obrigatórios; processo e checklist; três ou mais cotações com frete; seleção atômica; dotação; contrato; aditivos de prazo/valor; assinatura simples; auditoria; perfis/permissões; paginação e desempenho.

**Aceite:** cada cenário tem evidência de sucesso, cenário negativo correspondente e identidade/Secretaria usada, sem dados de teste persistentes no SMS2 após a homologação.

### Etapa 5 — Alertas automáticos de vencimento

**Estado atual:** estados de vencimento aparecem na interface; SMTP ainda não foi homologado e não há agendamento ativo.

Ordem técnica:
1. Confirmar o modelo atual dos documentos e como identificar vencimento, arquivamento, destinatários e Secretaria. Não duplicar campos já existentes.
2. Definir regras de alerta com o usuário comercial (por exemplo, antecedência, frequência, horário, destinatários e fuso), inclusive como tratar documentos renovados/arquivados.
3. Antes de criar tabela de envio, verificar se há trilha existente apropriada. Só adicionar estrutura se for indispensável para idempotência, tentativas e auditoria; documentar a justificativa.
4. Implementar envio no servidor com autenticação do job, limites por tenant, deduplicação, idempotência, retry com backoff e logs sem conteúdo sensível.
5. Escolher scheduler após confirmar compatibilidade/custo: extensão `pg_cron` + `pg_net` se habilitadas no projeto ou scheduler externo. Proteger o segredo de invocação e evitar chamada pública não autenticada.
6. Testar duplicidade, falha temporária do SMTP, renovação de documento, tenant suspenso e volume em lote.

**Aceite:** alerta correto é enviado uma única vez por regra/janela; falhas são recuperáveis; nenhum e-mail cruza o tenant; desligamento/retry é auditável. Não enviar WhatsApp sem provedor e consentimento/escopo definido.

### Etapa 6 — Google Drive

1. Confirmar que o requisito comercial é armazenamento no Drive do município/Secretaria (e não na conta pessoal do desenvolvedor).
2. Definir projeto Google Cloud, OAuth consent screen, escopos mínimos, política de verificação e credenciais de homologação.
3. Definir conexão independente por Secretaria, armazenamento cifrado dos tokens no servidor, refresh, revogação, rotação e desconexão.
4. Definir pasta-raiz, permissões, compartilhamento, versionamento, lixeira e comportamento quando Drive fica indisponível.
5. Testar acesso cruzado, revogação OAuth, token expirado e reconexão.
6. Manter GED Supabase como opção/fallback até a integração ser comprovada.

**Aceite:** cada Secretaria conecta a própria conta, arquivos não ficam acessíveis ao desenvolvedor ou a outro tenant, desconexão revoga o acesso e auditoria registra as operações.

### Etapa 7 — Backup e restauração

1. Gerar chave age localmente e armazenar a identidade privada offline; cadastrar apenas a chave pública no GitHub.
2. Configurar os dois Repository Secrets necessários e a variável `AGE_RECIPIENT`.
3. Executar workflow manual; conferir dump, objetos GED, hash e artefato criptografado.
4. Descriptografar em estação segura e validar conteúdo do TAR.
5. Restaurar em projeto Supabase separado, nunca no SMS2 em operação.
6. Recriar bucket/policies e usuários Auth conforme runbook; validar login, vínculos, funções, dados, arquivo e downloads.
7. Documentar tempo de recuperação, diferenças e RPO/RTO. Só então habilitar agendamento semanal.

**Aceite:** artefato pode ser descriptografado e restaurado num projeto isolado, e um usuário de homologação consegue entrar e baixar documentos.

### Etapa 8 — Cobrança e operação comercial

1. Definir gateway, pessoa jurídica/conta comercial, planos, preços, trial, limites, tributos, regras de inadimplência, cancelamento, estorno e emissão fiscal com contador/assessoria.
2. Implementar adaptador no servidor, credenciais em cofre, checkout, criação/alteração/cancelamento de assinatura e webhook com assinatura, idempotência, replay protection e reconciliação.
3. Validar tudo em Sandbox e manter `payments_enabled=false` até aprovação.
4. Definir contrato SaaS, termos de uso, aviso de privacidade e contrato de tratamento de dados por município; mapear controlador/operador, finalidade, base legal, retenção, direitos e incidente com assessoria jurídica.
5. Definir domínio, DNS, TLS, ambientes separados, monitoramento, alertas, suporte, SLA, canal de incidentes, processo de release e rollback.
6. Fazer piloto com uma Secretaria, obter aceite formal e só então liberar novos clientes.

**Aceite:** pagamentos somente após Sandbox e validação de webhooks; contratos e políticas revisados; monitoramento e suporte operacionais; piloto assina aceite.

## Dependências que precisam do proprietário do serviço

Esses itens não podem ser inventados ou configurados sem acesso/decisão do titular:
- domínio oficial e provedor SMTP;
- credenciais SMTP e registros DNS;
- contas Google Cloud/OAuth e política de Drive de cada Secretaria;
- gateway escolhido, conta comercial e credenciais Sandbox/produção;
- escolha de plano Supabase e aprovação de custos;
- e-mails controlados para homologação e Secretaria piloto;
- aprovação jurídica de termos, privacidade, retenção e contrato.

As credenciais devem ser inseridas diretamente nos painéis/cofres correspondentes. Não enviá-las em mensagens nem adicioná-las ao Git.

## Referências internas

- `docs/GO-LIVE-CHECKLIST.md` — critérios GO/NO-GO.
- `docs/TESTE-MVP.md` — roteiro de homologação funcional.
- `docs/CONFIGURAR-CONVITES-E-MAIL.md` — Auth/SMTP/convites.
- `docs/ROTINA-DE-BACKUP.md` — backup e recuperação.
- `supabase/migrations/` — histórico versionado do schema existente.

## Decisão atual

**NO-GO para produção comercial.** A fundação permanece preservada; o próximo marco de liberação é comprovar Auth/SMTP, duas Secretarias isoladas e GED em navegador autenticado, além de executar e restaurar um backup real. As demais integrações e conformidade comercial seguem como gates antes da venda.
