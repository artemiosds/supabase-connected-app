# Configuração manual: E-mail, Modelos DOCX, Google Drive e LGPD

Os quatro itens juntos são grandes demais para fazer bem numa única execução. A proposta é entregar uma frente por vez, cada uma completa (banco + servidor + tela + testes), na ordem abaixo. A primeira entrega inclui a base comum de Configurações.

## Decisão necessária antes de começar
As regras do projeto proíbem aplicar mudanças no banco de produção (SMS2) sem testar antes num banco descartável. A ferramenta de banco do Lovable aplica as mudanças direto no SMS2. Há duas opções:
- **Opção 1 (recomendada):** eu crio os arquivos de mudança do banco no repositório e os testo num Postgres descartável na sandbox, **sem aplicar no SMS2**. As telas só passam a funcionar depois que você aplicar, pelo processo de rollout. Até lá, a prévia mostra "Pendente de migração".
- **Opção 2:** aplico direto no SMS2, aditivo e revisado, com as telas funcionando na prévia já nesta etapa.

## Base comum (vai junto com a 1ª entrega)
- Configurações vira uma área com abas: Geral, E-mail institucional, Modelos de documentos, Integrações › Google Drive, Privacidade e LGPD. Cada aba exige a permissão do papel correspondente (as permissões já existentes passam por `app_auth`).
- Chave de criptografia gerada no servidor (secret `INTEGRATIONS_ENCRYPTION_KEY`). Os segredos ficam criptografados (AES-GCM) numa tabela sem acesso direto pelas permissões da API; só funções de servidor autenticadas leem e gravam. O navegador recebe apenas "configurado: sim/não".
- Toda alteração de configuração gera um registro de auditoria com os nomes dos campos alterados, sem valores.

## Entrega 1 — E-mail institucional
- Tabela por Secretaria `tenant_email_settings`: host, porta, usuário, TLS, remetente, nome, reply-to, status e último teste. A senha fica criptografada e a resposta só informa se ela existe.
- Função de servidor "testar conexão": SMTP STARTTLS/TLS por socket do worker, com timeout. Se não houver senha salva, ela recusa o teste sem fazer chamada nenhuma.
- Registro de envios (`email_delivery_log`), sem corpo nem segredos.
- Modelos de convite, recuperação e alertas, editáveis, com prévia.
- Aviso explícito: o SMTP do Supabase Auth, usado nos convites e na recuperação de senha, só é configurado no painel do Supabase. A aba mostra os valores de referência e os passos, e não finge sincronizar.

## Entrega 2 — Modelos DOCX
- Reaproveita `document_templates`, `document_template_versions` e `document_template_sources` e o bucket privado.
- Cada versão nova começa como rascunho. A validação automática (`analyzeDocx` + catálogo de variáveis) gera o relatório de pendências e grava status/validade/órgão/tipo.
- "Ativar" só é permitido para versões validadas, com bloqueio no banco. Rollback reativa uma versão anterior que já tenha sido validada.
- A geração passa a usar `generateDocx` com a versão ativa.
- Começa sem modelos e mostra instruções de importação. Nenhum modelo inventado.

## Entrega 3 — Google Drive
- `tenant_drive_settings`: client id, redirect URI, pasta raiz e escopo `drive.file`. O client secret e o refresh token ficam criptografados.
- Rotas `/api/public/drive/callback` com `state` assinado + PKCE (verifier guardado no servidor, uso único, expira em 10 min).
- Fila `drive_sync_jobs` com chave de idempotência, tentativas e backoff. A cópia original só é marcada para remoção depois do upload confirmado, e nunca é apagada automaticamente.
- Sem credenciais, a aba mostra "Pendente de configuração". Nenhuma chamada externa durante os testes.

## Entrega 4 — Privacidade e LGPD
- Tabelas: políticas de retenção por categoria (prazo, base legal e finalidade começam vazios; as sugestões vêm marcadas como "não jurídicas"; aprovação por um responsável é obrigatória), versões publicadas da política com aceite por usuário, e solicitações do titular (exportar/corrigir/excluir), com fluxo de revisão e aprovação.
- A exclusão fica bloqueada quando há vínculo legal ou contratual (contrato, processo, documento assinado, auditoria). Nesses casos o sistema oferece anonimização.
- Job de retenção somente em modo de simulação (dry-run), que gera um relatório. Nenhuma exclusão automática.

## Testes por entrega
Testes unitários (criptografia, validação, PKCE/state, regras de bloqueio), SQL em banco descartável com ROLLBACK (isolamento entre Secretarias, negação a quem não tem permissão), e checagens de tipos, lint, formatação e build. Os testes de navegador continuam com o CI.
