# Configuração de convites por e-mail

A funcionalidade de convite está implementada no projeto e a Edge Function `invite-tenant-user` está publicada no Supabase SMS2 com verificação JWT obrigatória.

## Provisionamento inicial e convites são etapas diferentes

1. Antes de criar uma Secretaria, o futuro administrador municipal precisa ter uma conta Supabase Auth cadastrada e com e-mail confirmado.
2. O Administrador Master abre **Organizações**, escolhe essa conta elegível e usa o provisionamento para criar a Secretaria e seu primeiro vínculo de administrador.
3. Depois que a Secretaria existe, seu administrador municipal pode convidar outros usuários em **Usuários → Convidar por e-mail**.

O cadastro/convite do primeiro administrador municipal não é enviado pela função `invite-tenant-user`; ele depende de uma conta confirmada já disponível para seleção no painel Master.

## O que o fluxo de convite faz

1. O administrador municipal informa nome, e-mail e papel na tela **Usuários → Convidar por e-mail**.
2. A aplicação chama a Edge Function com a sessão autenticada.
3. O servidor confirma o JWT e chama a RPC `create_tenant_invitation`, que verifica permissões, plano/módulos da Secretaria, papel e duplicidade.
4. O serviço administrativo do Supabase Auth envia o convite.
5. O convidado abre o link, confirma o e-mail e define sua senha.
6. No primeiro acesso, o sistema aceita o convite usando o e-mail confirmado e cria o vínculo com o papel escolhido.
7. O convite e as transições de estado ficam registrados na auditoria. O administrador pode cancelar convites que ainda estejam pendentes.

A chave administrativa do Supabase é utilizada exclusivamente na Edge Function; não fica no navegador nem no repositório.

## Configuração necessária antes de enviar para e-mails externos

### 1. SMTP próprio no Supabase

No painel do projeto SMS2, acesse **Authentication → SMTP Settings** e configure um provedor SMTP com domínio de envio verificado, remetente, usuário, senha, host e porta.

O SMTP padrão do Supabase **não é suficiente para esta homologação com novos endereços externos**: ele só entrega a endereços que já pertencem à equipe da organização do projeto, tem limite atual de 2 mensagens por hora e não oferece SLA. Esse limite pode mudar; consulte a documentação vigente antes de um teste.

Para convidar administradores e servidores de Secretarias que não sejam membros da equipe Supabase, configure SMTP próprio. A documentação oficial está em:

- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail

### 2. URL de redirecionamento do Auth

Em **Authentication → URL Configuration**, mantenha o Site URL correto e inclua os destinos de redirecionamento permitidos.

Para o preview atual:
`https://id-preview--0f44b9ce-9cdb-4fc9-892b-0bd2cf70b798.lovable.app/**`

Quando houver domínio próprio, inclua também o domínio de produção, por exemplo:
`https://app.seudominio.gov.br/**`

O link de convite redireciona para:
`/redefinir-senha?convite=1`

Não publique o sistema com o domínio de produção ausente da lista de URLs permitidas.

### 3. Origem permitida na Edge Function

A função aceita o preview atual e o endereço local de desenvolvimento. Ao configurar o domínio definitivo, cadastre as origens adicionais como secrets da Edge Function:

- `APP_URL`: origem canônica, sem caminho.
- `INVITE_ALLOWED_ORIGINS`: lista separada por vírgulas de origens permitidas, sem caminhos, por exemplo `https://app.seudominio.gov.br,https://homolog.seudominio.gov.br`.

Não grave `SUPABASE_SERVICE_ROLE_KEY` no frontend, em arquivos `.env` publicados ou no GitHub. O runtime do Supabase fornece a chave administrativa à função no ambiente servidor.

## Regras de segurança do fluxo

- Convites expiram em 7 dias.
- O convite só pode ser aceito pelo mesmo endereço de e-mail que o recebeu, depois de confirmado.
- Contas já existentes devem usar **Vincular conta existente**; a função de convite não cria vínculo duplicado.
- Convites cancelados ou expirados não ativam acesso.
- Convites não reativam automaticamente vínculos suspensos/inativos.
- O aceite respeita o limite comercial de usuários e o estado ativo da Secretaria.
- O usuário recebe apenas o papel escolhido pelo administrador; não existe promoção automática para administrador.
- O administrador pode cancelar somente convites pendentes da própria Secretaria.

## Estado observado em 09/11/2026

- O Supabase SMS2 está ativo e saudável.
- Há dois usuários Auth confirmados: o Administrador Master e uma segunda conta cadastrada. Essa segunda conta é a única elegível hoje para ser o primeiro administrador de uma Secretaria.
- Ainda não existem Secretarias, vínculos municipais ou convites pendentes no banco.
- A Edge Function de convites está ativa na versão 6; o código foi implantado, mas isso não comprova entrega de e-mail.
- Para homologar duas Secretarias com administradores independentes, falta cadastrar e confirmar pelo menos mais uma conta municipal controlada. Não use a mesma conta nas duas Secretarias como prova de isolamento.
- Para provar também o envio de convite, será necessário ao menos um endereço de teste adicional, diferente dos administradores municipais, para receber o e-mail de convite.
- Não foi possível configurar SMTP nesta etapa: o acesso administrativo de configuração e as credenciais do provedor não estão disponíveis nesta conexão. Cadastre essas credenciais diretamente em Supabase → Authentication → SMTP Settings; não as envie em mensagens.

## Homologação necessária

Ainda é necessário executar o roteiro com duas Secretarias de teste, dois administradores municipais independentes, pelo menos um destinatário novo de convite e SMTP real. A Edge Function está publicada, mas nenhum e-mail foi disparado nesta implantação porque o SMS2 ainda não possui uma Secretaria municipal nem destinatários de teste cadastrados.
