# IA do Primus — configuração e operação

## Quem pode configurar

Somente uma conta ativa em \`platform_admins\` (Administrador Master/dono da plataforma) pode cadastrar provedores, armazenar credenciais, validar conexões, definir a IA principal e alternativas, ligar a IA global e liberar provedores/capacidades por Secretaria. Equipe Interna, Suporte e administradores municipais não recebem essa permissão por herança. A autorização é verificada pela Edge Function e novamente nas RPCs protegidas.

## Provedores e APIs suportados

O gerenciador multiprovedor aceita:

- **OpenAI:** API Responses.
- **Google Gemini:** API \`generateContent\`.
- **Anthropic Claude:** API Messages.
- **Azure OpenAI:** endpoint do recurso, versão da API e nome do deployment.
- **APIs compatíveis com OpenAI:** endpoint HTTPS com interface Chat Completions, para serviços que documentem compatibilidade com esse contrato.

Cada cadastro possui nome de identificação, provedor, modelo/deployment, chave, estado de conexão e tarifas opcionais. Azure OpenAI e APIs compatíveis exigem URL base HTTPS. A URL não aceita usuário, senha, query string ou fragmento. A credencial é gravada exclusivamente no Supabase Vault e nunca é retornada ao navegador.

A configuração OpenAI já existente é migrada automaticamente para o novo registro de provedores, preservando a referência ao segredo do Vault. As permissões das Secretarias existentes são preservadas somente para os provedores que já estavam conectados e autorizados pela configuração anterior.

## IA principal, contingência e acesso por Secretaria

1. Cadastre cada provedor e informe o identificador de modelo/deployment correspondente à conta contratada.
2. Informe as tarifas de entrada e saída em USD por milhão de tokens, quando disponíveis. Esses valores são configurados manualmente e não são sincronizados automaticamente com tabelas de preços dos fornecedores.
3. Salve e execute **Testar**. O teste faz uma solicitação mínima real; somente uma resposta válida marca a conexão como disponível.
4. Defina um provedor conectado como **IA principal**. Outros provedores conectados podem permanecer habilitados como alternativas; a menor prioridade numérica é tentada primeiro.
5. Para cada Secretaria, libere explicitamente os provedores que ela pode utilizar. A execução tenta a IA principal e, se houver falha, percorre apenas as alternativas autorizadas para aquela Secretaria.
6. Ative a IA global e, em seguida, habilite cada Secretaria e suas capacidades. Todas as permissões permanecem desligadas até autorização explícita.
7. Em homologação, entre como membro de uma Secretaria autorizada e teste cada capacidade com dados isolados.

Se o teste da IA principal falhar, o backend desabilita esse provedor e promove automaticamente a primeira alternativa global conectada. Secretarias sem uma alternativa que já tenha sido autorizada ficam desabilitadas até que o Administrador Master ajuste suas permissões. Alterar chave, modelo ou endpoint de um provedor ativo exige novo teste; ao alterar a configuração da principal, a ativação global e as habilitações por Secretaria são desligadas preventivamente até nova validação.

## Métricas de consumo e custo

- Cada solicitação registra Secretaria, provedor, modelo, capacidade, estado, tokens de entrada/saída e horário.
- O painel agrega o consumo por Secretaria e provedor nos últimos 30 dias.
- O custo estimado é calculado com as tarifas de entrada e saída cadastradas pelo Administrador Master e o uso informado pela API.
- Se a tarifa ou a contagem de tokens estiver ausente, o painel marca o custo como parcial. Valores estimados não substituem a fatura oficial do provedor.
- A tabela de métricas não armazena prompts, respostas, documentos, chaves ou segredos.

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

- Cada solicitação passa pela sessão autenticada e por vínculo ativo da conta à Secretaria. Consultas de contexto usam o cliente Supabase do próprio usuário com RLS; o navegador não envia \`tenant_id\` como prova de autorização.
- O conteúdo e o contexto selecionado são enviados ao provedor que responder à solicitação. Com failover, o mesmo contexto pode ser enviado a mais de um provedor autorizado na mesma tentativa. O órgão deve aprovar contrato, privacidade, retenção e transferência de dados de cada provedor liberado antes do uso com dados pessoais ou sensíveis.
- A conversa não é persistida pelo Primus. A auditoria registra Secretaria, usuário, capacidade, provedor, modelo e contagem de tokens, sem registrar prompts, respostas, documentos ou segredos.
- Limite atual: 10 mensagens por chamada, até 3.000 caracteres por mensagem e 40 solicitações por usuário/Secretaria por hora.
- A IA não aprova preços, não assina, não publica, não altera cadastros, não grava documentos no GED e não envia e-mail. A pessoa responsável continua conferindo conteúdo, normas, fatos e valores.
- OCR/leitura de DOCX/PDF privados, conexão a PNCP/Compras.gov.br, gravação automática de documentos, automações transacionais e execução autônoma de ações não fazem parte desta ativação; dependem de integrações, análise de privacidade, controles de permissão e homologação próprios.
- A desativação global interrompe imediatamente novas solicitações e desabilita todas as Secretarias. Desativar uma Secretaria interrompe os recursos dela sem alterar seus dados operacionais.

## Implantação controlada

A migration \`20261123153000_platform_ai_multi_provider.sql\` é aditiva e deve ser validada em projeto descartável/homologação antes de qualquer aplicação ao SMS2. O deploy das Edge Functions \`platform-ai-configuration\` e \`primus-ai\` deve ocorrer somente depois da migration, dos testes de segurança e da homologação do fluxo multiprovedor. Não executar \`db push\` indiscriminado nem publicar as funções novas antes do schema correspondente.

## Evidências de aceite

Guardar somente evidências sem credenciais ou conteúdo de processos: versão/commit, resultado da CI e pgTAP, resultado genérico dos testes de conexão, provedores/modelos configurados, identificação da Secretaria, capacidades habilitadas e aprovação do responsável de privacidade/TI. Não guardar chave, prompt, saída com dados pessoais, token ou link temporário.
