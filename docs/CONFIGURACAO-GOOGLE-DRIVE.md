# Google Drive por Secretaria — configuração e homologação

## Estado do código

A branch de integração prepara uma conexão OAuth independente por Secretaria:

- Um vínculo Google Drive por tenant, com o endereço da conta e ID de uma pasta raiz própria.
- O escopo OAuth solicitado é openid, email e
  https://www.googleapis.com/auth/drive.file. O aplicativo não solicita acesso geral a todo o Drive.
- O início do OAuth exige usuário municipal autenticado com a permissão org:edit, Secretaria
  ativa, em boa situação comercial e módulos ged e fornecedores habilitados.
- O fluxo usa state aleatório armazenado apenas por hash e PKCE, com expiração de 10 minutos e
  consumo único no callback.
- O refresh token é persistido no Supabase Vault. O navegador recebe apenas estado da conexão,
  e-mail e nome da pasta; nunca recebe refresh token.
- A pasta raiz é criada no Drive da conta conectada com o nome Gestão de Fornecedores -
  Secretaria.
- A desconexão revoga o token e remove o segredo do Vault. Ela é bloqueada enquanto existirem
  documentos de fornecedores que apontem para arquivos daquele Drive.
- O workflow de Edge Functions inclui a função OAuth, mas permanece manual e protegido pela
  confirmação confirm_deploy=true.

**Limite desta etapa:** o código prepara a conexão OAuth e a pasta da Secretaria. O upload,
download e sincronização de documentos no Google Drive ainda precisam ser implementados na etapa
seguinte; até lá, os arquivos continuam armazenados no bucket privado do Supabase ou como links
externos. O simples reconhecimento de drive_file_id já existente não constitui sincronização.

## Configuração futura no Google Cloud

1. Criar ou selecionar um projeto no Google Cloud Console dedicado ao SaaS.
2. Habilitar a Google Drive API.
3. Configurar a tela de consentimento OAuth, nome do aplicativo, e-mail de suporte, domínio
   autorizado e política de privacidade.
4. Criar credencial OAuth do tipo Web application.
5. Definir o redirect URI autorizado exatamente como:

   https://rwbbznqtocunzrpcvjvk.supabase.co/functions/v1/google-drive-oauth

6. Manter o escopo drive.file; não solicitar o escopo amplo
   https://www.googleapis.com/auth/drive.
7. Em ambiente de teste, adicionar apenas contas Google de homologação como test users. Antes do
   uso com Secretarias externas, completar a publicação/verificação exigida pelo Google para o
   consentimento e os escopos utilizados.

O redirect URI configurado no Google precisa ser idêntico ao secret GOOGLE_DRIVE_REDIRECT_URI,
incluindo protocolo, host, caminho e ausência de barra final adicional.

## Secrets de servidor no Supabase

Configurar somente no ambiente seguro de Edge Function do projeto, nunca no frontend, em arquivo
.env versionado, SQL público ou mensagens:

| Secret | Valor |
| --- | --- |
| GOOGLE_DRIVE_CLIENT_ID | OAuth Client ID do Google Cloud |
| GOOGLE_DRIVE_CLIENT_SECRET | OAuth Client Secret |
| GOOGLE_DRIVE_REDIRECT_URI | Redirect URI exato acima |
| APP_URL | Origem HTTPS publicada do portal, sem caminho |

As variáveis padrão do Supabase (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY) são
fornecidas pelo runtime. A chave service-role não deve ser copiada para o browser.

A função de início também usa a lista de origens já compartilhada com as demais funções, por meio
de APP_URL e INVITE_ALLOWED_ORIGINS. Configure somente origens HTTPS explícitas.

## Comportamento de segurança

- O state OAuth é associado ao tenant e ao usuário que iniciou a conexão. O callback consome o
  state atomicamente; replays são rejeitados.
- O código de autorização é trocado no servidor com PKCE verifier.
- O callback consulta o UserInfo do Google e exige email_verified=true.
- O refresh token é enviado diretamente ao Vault através de RPC service-role, e não é registrado
  na auditoria ou em logs.
- A criação da pasta ocorre com o escopo drive.file.
- Apenas Administradores da Secretaria com org:edit podem conectar/desconectar. Gestor, Operador
  e Consulta não ganham administração da conta Google.
- A desconexão é impedida quando há documentos vinculados ao Drive.

## Homologação futura

1. Configurar um projeto Google de teste e os secrets acima.
2. Aplicar a migration de conexão em ambiente descartável/homologação.
3. Entrar como Administrador de uma Secretaria e conectar uma conta Google de teste.
4. Confirmar que a pasta raiz aparece no Drive e que o cartão mostra apenas e-mail e pasta.
5. Inspecionar o Vault e confirmar que existe o refresh token sem que ele apareça em chamadas do
   navegador.
6. Repetir com segunda Secretaria e segunda conta Google; comprovar que pastas e conexões não se
   cruzam.
7. Confirmar que Gestor/Operador veem o status, mas não recebem botão de conexão/desconexão.
8. Testar state expirado, callback repetido, e-mail não verificado, revogação, erro de Vault e
   tentativa de desconectar com documentos vinculados.
9. Somente depois implementar e testar upload/download de documentos por Drive, limites de
   tamanho, retomada de upload, hashes, metadados e sincronização de exclusão/arquivamento.

Nenhuma conta Google real é usada no desenvolvimento. Não aplicar migrations no SMS2 até existir
backup com restauração comprovada e janela de implantação aprovada.

## Referências oficiais

- OAuth 2.0 para aplicações Web server-side:
  https://developers.google.com/identity/protocols/oauth2/web-server
- Escopos da Google Drive API:
  https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Upload de arquivos Google Drive:
  https://developers.google.com/workspace/drive/api/guides/manage-uploads
