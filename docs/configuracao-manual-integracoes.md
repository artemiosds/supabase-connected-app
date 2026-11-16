# Configuração manual das integrações por Secretaria

Esta entrega adiciona a fundação de configuração isolada por tenant. A migration deve ser aplicada primeiro em um Supabase local descartável e validada pelos testes SQL antes de qualquer implantação no SMS2.

## Segredos do servidor

Configure em Supabase → Edge Functions → Secrets:

- `INTEGRATION_SECRETS_KEY`: chave aleatória de 32 bytes, codificada em Base64. Gere localmente com `openssl rand -base64 32`. Não cole essa chave no sistema, no GitHub ou nesta conversa.
- `APP_URL`: origem HTTPS oficial da aplicação.
- `GOOGLE_DRIVE_REDIRECT_URI`: URL pública exata da função `google-drive-oauth-callback`, por exemplo `https://<PROJECT_REF>.supabase.co/functions/v1/google-drive-oauth-callback`.

A mesma chave `INTEGRATION_SECRETS_KEY` precisa permanecer estável entre implantações. Perder ou substituir a chave sem um procedimento de rotação torna os segredos já criptografados irrecuperáveis. Faça backup seguro da chave fora do repositório.

## E-mail

A tela aceita remetente institucional e credenciais por Secretaria. O provedor Resend já possui ação de teste que envia uma mensagem apenas para o e-mail da conta autenticada e grava o resultado sem armazenar a resposta completa do provedor.

O SMTP de saída por Secretaria está preparado para armazenar host, porta, segurança, usuário e senha criptografada, mas **não está habilitado para envio**: Supabase Edge Functions não oferecem um transporte SMTP TCP genérico confiável. Não selecione SMTP esperando que o envio operacional passe a funcionar. Para e-mails operacionais, use o provedor API implementado ou um gateway HTTPS a ser integrado.

Convites, confirmação de cadastro e recuperação de senha são enviados pelo Supabase Auth. O SMTP global desses fluxos continua sendo configurado no painel Supabase em Authentication → SMTP Settings; não é alterado por esta tela.

## Google Drive

Cadastre o OAuth Client ID e Client Secret do projeto Google Cloud na tela de configurações da Secretaria. No Google Cloud Console, adicione o valor de `GOOGLE_DRIVE_REDIRECT_URI` como URI de redirecionamento autorizado. Salve os dados e inicie “Conectar Google Drive”.

A autorização usa `state` de uso único, expiração de 10 minutos, PKCE S256 e escopo `drive.file`. O refresh token é criptografado no servidor. A tela permite iniciar uma sincronização manual de até 20 arquivos por execução: documentos privados de fornecedores e fontes DOCX de modelos. O worker cria uma pasta raiz quando não foi informada, registra jobs idempotentes e guarda o ID remoto. Os arquivos originais no Storage nunca são apagados nem substituídos. Resultados ambíguos são marcados como `uncertain` e não são reenviados automaticamente para evitar duplicatas; exigem reconciliação manual.

## Modelos DOCX

A gestão de modelos, versões e fontes DOCX já existe no módulo Documentos. Use a área Documentos para cadastrar e validar os modelos oficiais. Esta entrega não duplica essa estrutura nem altera o motor de geração existente.

## LGPD

A política de retenção e sua aprovação ficam registradas por Secretaria. O prazo configurado não dispara exclusões. Solicitações de titulares e execução de descarte seguro exigem fluxo operacional, análise de base legal, aprovação e auditoria; nenhum dado será apagado automaticamente por esta configuração.

## Implantação segura

1. Inicie um projeto Supabase local descartável.
2. Aplique todas as migrations desde o início, inclusive a nova migration de integrações.
3. Execute `supabase test db` e os testes de aplicação.
4. Configure os secrets somente no ambiente de homologação.
5. Implante as Edge Functions e valide e-mail, OAuth e isolamento entre duas Secretarias.
6. Só então avalie uma implantação controlada no SMS2, com backup e plano de rollback.
