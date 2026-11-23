# IA do Primus — configuração e operação

## Quem pode configurar

Somente uma conta ativa em `platform_admins` (Administrador Master/dono da plataforma) pode cadastrar provedores, armazenar credenciais, validar conexões, definir a IA principal e alternativas, ligar a IA global e liberar provedores/capacidades por Secretaria. Equipe Interna, Suporte e administradores municipais não recebem essa permissão por herança. A autorização é verificada pela Edge Function e novamente nas RPCs protegidas.

## Provedores e APIs suportados

O gerenciador multiprovedor aceita:

- **OpenAI:** API Responses.
- **Google Gemini:** API `generateContent`.
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
8. Para remover um cadastro, use **Excluir** na lista de provedores e confirme a operação. A credencial correspondente é removida do Vault; o histórico de consumo permanece, sem vínculo ao cadastro excluído. Se o provedor removido for o principal, uma alternativa conectada é promovida automaticamente; sem alternativa, a IA global é desligada. Secretarias sem outro provedor autorizado também são desligadas.

Falhas transitórias (HTTP 408, 409, 425, 429, 5xx, timeout, rede ou indisponibilidade temporária do Vault) são registradas com diagnóstico e Retry-After, mas não desabilitam o provedor nem removem sua autorização por Secretaria. Falhas permanentes (por exemplo, credencial inválida, modelo inexistente ou endpoint incompatível) desabilitam o provedor e promovem uma alternativa global conectada quando aplicável; Secretarias sem outra alternativa já autorizada são desabilitadas. Alterar chave, modelo ou endpoint exige novo teste.

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

- Cada solicitação passa pela sessão autenticada e por vínculo ativo da conta à Secretaria. Consultas de contexto usam o cliente Supabase do próprio usuário com RLS; o navegador não envia `tenant_id` como prova de autorização.
- O conteúdo e o contexto selecionado são enviados ao provedor que responder à solicitação. Com failover, o mesmo contexto pode ser enviado a mais de um provedor autorizado na mesma tentativa. O órgão deve aprovar contrato, privacidade, retenção e transferência de dados de cada provedor liberado antes do uso com dados pessoais ou sensíveis.
- A conversa não é persistida pelo Primus. A auditoria registra Secretaria, usuário, capacidade, provedor, modelo e contagem de tokens, sem registrar prompts, respostas, documentos ou segredos.
- Limite atual: 10 mensagens por chamada, até 3.000 caracteres por mensagem e 40 solicitações por usuário/Secretaria por hora.
- A IA não aprova preços, não assina, não publica, não altera cadastros, não grava documentos no GED e não envia e-mail. A pessoa responsável continua conferindo conteúdo, normas, fatos e valores.
- OCR/leitura de DOCX/PDF privados, conexão a PNCP/Compras.gov.br, gravação automática de documentos, automações transacionais e execução autônoma de ações não fazem parte desta ativação; dependem de integrações, análise de privacidade, controles de permissão e homologação próprios.
- A desativação global interrompe imediatamente novas solicitações e desabilita todas as Secretarias. Desativar uma Secretaria interrompe os recursos dela sem alterar seus dados operacionais.

## Implantação controlada

As migrations `20261123144614_platform_ai_multi_provider.sql`, `20261123144927_fix_ai_non_primary_provider_failure.sql` e `20261123174818_fix_ai_provider_test_diagnostics.sql` foram aplicadas diretamente ao SMS2 em 23/11/2026. A Edge Function `platform-ai-configuration` foi publicada na versão 23 e `primus-ai` na versão 21, ambas com JWT obrigatório. A versão 23 grava código HTTP, tipo de erro, mensagem sanitizada e Retry-After; falhas transitórias preservam o estado anterior do provedor. O teste usa 512 tokens e esforço de raciocínio baixo para o Nemotron no OpenRouter. O Perplexity Decider é recusado no adaptador de chat por exigir a Decisions API. Após a publicação, o SMS2 registrou novos testes bem-sucedidos para Nemotron e Moonshot Kimi; o Decider permanece com falha de compatibilidade. Os testes SQL de segurança (20 verificações) e comportamento foram executados com fixtures transacionais e rollback. **Estado observado antes da implantação:** o SMS2 não possuía registro de configuração OpenAI nem credencial legada; portanto, foi criado somente o registro global inicial, desligado, e nenhum provedor foi cadastrado ou habilitado automaticamente. Antes de liberar uso real, o Administrador Master precisa cadastrar credenciais próprias diretamente no Painel Master, testar cada conexão e autorizar provedores/capacidades por Secretaria. Não enviar chaves pelo chat nem executar `db push` indiscriminado.

## Evidências de aceite

Guardar somente evidências sem credenciais ou conteúdo de processos: versão/commit, resultado da CI e pgTAP, resultado genérico dos testes de conexão, provedores/modelos configurados, identificação da Secretaria, capacidades habilitadas e aprovação do responsável de privacidade/TI. Não guardar chave, prompt, saída com dados pessoais, token ou link temporário.
