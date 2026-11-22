# IA do Primus — configuração e operação

## Quem pode configurar

Somente uma conta ativa em `platform_admins` (Administrador Master/dono da plataforma) pode gravar credencial, validar o provedor, ligar a IA global e habilitar recursos por Secretaria. Equipe Interna, Suporte e administradores municipais não recebem essa permissão por herança. A autorização é verificada pela Edge Function e novamente nas RPCs protegidas.

## Ativação controlada

1. Aplicar a migration `20261122190000_platform_ai_configuration.sql` somente em ambiente descartável/homologação, depois da CI e dos gates de backup/restore previstos no [checklist Go/No-Go](GO-LIVE-CHECKLIST.md). Não executar `db push` indiscriminado nem aplicar ao SMS2 durante esta preparação.
2. Publicar as Edge Functions `platform-ai-configuration` e `primus-ai` em homologação. O workflow de deploy existente continua manual e exige confirmação explícita.
3. Entrar no Painel Master com uma conta ativa `platform_admins`, abrir **Inteligência Artificial**, informar o identificador de modelo aprovado e a chave OpenAI institucional e salvar. A chave não é devolvida ao navegador nem registrada em auditoria; fica no Supabase Vault.
4. Usar **Testar conexão**. Isso envia uma chamada técnica mínima ao provedor. A conexão só passa a “validada” após resposta HTTP bem-sucedida; salvar uma chave não simula conexão.
5. Ligar a ativação global e, em seguida, selecionar cada Secretaria elegível e marcar apenas as capacidades aprovadas pelo órgão. Todas começam desligadas. Secretarias suspensas, encerradas, bloqueadas comercialmente ou com demonstração vencida são recusadas no servidor.
6. Em homologação, entrar com um membro ativo da Secretaria, abrir **Assistente IA**, confirmar a Secretaria selecionada, escolher a capacidade e, quando exigido, o registro específico. Testar dados isolados e baixar os rascunhos DOCX/PDF quando aplicável.

## Capacidades desta entrega

- **Assistente operacional:** orientação contextual usando resumos autorizados de processos, contratos e demandas do PCA.
- **Documentos preparatórios:** rascunhos de DFD, ETP, Termo de Referência, mapa de riscos e minutas, com dados do processo e itens; exportação do texto gerado para DOCX/PDF timbrado, identificados como rascunho.
- **Pesquisa de preços:** leitura de itens e cotações já registradas para análise orientativa. Não consulta fontes externas nem cria cotações.
- **Certidões de fornecedores:** leitura apenas dos metadados já cadastrados; não baixa nem interpreta arquivos privados.
- **Contratos e renovações:** síntese de vigência, situação, fiscal/gestor e valores existentes.
- **Entregas e fiscalização:** apoio baseado no contrato e itens escolhidos; não atesta recebimento.
- **Tarefas e pendências:** organização a partir dos resumos de processos, contratos e PCA disponíveis ao usuário.
- **E-mails operacionais:** prepara texto para revisão; não envia e-mail.

## Limites, privacidade e salvaguardas

- Cada solicitação passa pela sessão autenticada e por vínculo ativo da conta à Secretaria. Consultas de contexto usam o cliente Supabase do próprio usuário com RLS; o navegador não envia `tenant_id` como prova de autorização.
- O provedor é chamado somente depois da ação do usuário, com `store: false`. O texto e o contexto selecionado saem do Primus para processamento pelo provedor configurado; o contrato institucional e as regras de retenção/privacidade desse provedor devem ser aprovados antes do uso com dados pessoais ou sensíveis.
- A conversa não é persistida pelo Primus. A auditoria registra Secretaria, usuário, função, modelo e contagem de tokens, sem registrar prompts, respostas, documentos ou segredos.
- Limite atual: 10 mensagens por chamada, até 3.000 caracteres por mensagem e 40 solicitações por usuário/Secretaria por hora.
- A IA não aprova preços, não assina, não publica, não altera cadastros, não grava documentos no GED e não envia e-mail. A pessoa responsável continua conferindo conteúdo, normas, fatos e valores.
- OCR/leitura de DOCX/PDF privados, conexão a PNCP/Compras.gov.br, gravação automática de documentos, automações transacionais e execução autônoma de ações não fazem parte desta ativação; dependem de integrações, análise de privacidade, controles de permissão e homologação próprios.
- A desativação global interrompe imediatamente novas solicitações e desabilita todas as Secretarias. Desativar uma Secretaria interrompe os recursos dela sem alterar seus dados operacionais.

## Evidências de aceite

Guardar somente evidências sem credenciais ou conteúdo de processos: versão/commit, resultado da CI e pgTAP, resultado genérico do teste de conexão, modelo configurado, identificação da Secretaria, capacidades habilitadas e aprovação do responsável de privacidade/TI. Não guardar chave, prompt, saída com dados pessoais, token ou link temporário.
