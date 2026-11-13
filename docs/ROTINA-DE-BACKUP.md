# Backup operacional do Supabase SMS2

## Objetivo e limites

Este procedimento cria um **backup lógico criptografado dos dados da aplicação e dos arquivos do GED privado**. Ele é uma proteção adicional para o projeto Free e não substitui o backup integral gerenciado pelo Supabase.

O Supabase CLI exclui os schemas gerenciados `auth` e `storage` dos dumps. Por isso, o pacote:
- inclui schema, dados e roles dos schemas da aplicação;
- baixa todos os arquivos do bucket privado `gfs-private-documents` e cria um manifesto SHA-256;
- **não inclui** identidades, senhas, credenciais ou sessões do Supabase Auth;
- **não inclui** os metadados internos/configurações de Storage, configurações do projeto, secrets das Edge Functions, SMTP, allowlists de Auth nem logs gerenciados.

Na recuperação em outro projeto, será necessário recriar o bucket privado e suas políticas por migrations, recriar as contas Auth, validar a associação do Administrador Master e revisar os vínculos dos usuários. Não trate o pacote como restauração integral de projeto ou ponto-no-tempo.

## Pré-requisitos

No repositório GitHub `artemiosds/supabase-connected-app`, abra **Settings → Secrets and variables → Actions**. Atenção: o repositório está atualmente **público**. Pessoas com acesso de leitura podem baixar os artefatos do Actions; por isso, o workflow envia somente o pacote `.age` criptografado e seu checksum, nunca o TAR aberto. Mantenha a identidade privada do age fora do GitHub e fora do computador/conta que armazena os artefatos. Não altere o workflow para publicar arquivos sem criptografia.

Configure os seguintes **Repository secrets**:

- `SUPABASE_DB_URL`: connection string PostgreSQL do SMS2, obtida em Supabase → Connect. Use uma conexão direta ou Session Pooler indicada pelo painel e codifique caracteres especiais da senha no URL. Nunca coloque essa string em arquivos do repositório.
- `SUPABASE_SERVICE_ROLE_KEY`: chave administrativa legada do projeto, usada apenas pelo job e pelo script de exportação de Storage. Nunca use essa chave no navegador, não a envie em conversa e não a registre em logs.

Configure as seguintes **Repository variables**:

- `AGE_RECIPIENT`: chave pública do age, gerada localmente com `age-keygen`. É uma chave de criptografia pública e pode ficar como variável.
- `SUPABASE_BACKUP_ENABLED`: defina como `true` somente depois de executar e validar um backup manual.

Gere a chave em uma máquina sob seu controle:

```bash
age-keygen -o sms2-backup-identity.txt
```

O comando mostra a chave pública `age1...` e grava a identidade privada no arquivo. Copie apenas a chave pública para `AGE_RECIPIENT`. Guarde `sms2-backup-identity.txt` em um gerenciador de senhas ou mídia offline criptografada. **Nunca envie a identidade privada ao GitHub nem a compartilhe.** Sem ela, os arquivos criptografados não podem ser recuperados.

## Execução

1. Abra GitHub → Actions → **Encrypted SMS2 backup**.
2. Use **Run workflow** para o primeiro teste.
3. Confirme que os passos de dump, Storage, criptografia e upload terminaram com sucesso.
4. Baixe o artefato `sms2-encrypted-backup-...` e valide o SHA-256.
5. Em uma máquina segura, confira que a identidade privada do age consegue descriptografar o arquivo e listar o conteúdo do TAR. Faça isso sem publicar o conteúdo.
6. Só depois de testar a descriptografia, defina `SUPABASE_BACKUP_ENABLED=true` para habilitar a rotina semanal de domingo às 06:00 UTC.

O workflow mantém os artefatos criptografados por 90 dias no GitHub Actions. Ele não envia dados abertos ao repositório e não executa backup automaticamente até a variável de ativação ser habilitada.

## Recuperação do pacote lógico

Em uma estação segura com Supabase CLI v2 e age:

```bash
sha256sum -c sms2-backup.tar.gz.age.sha256
age -d -i sms2-backup-identity.txt sms2-backup.tar.gz.age > sms2-backup.tar.gz
tar -tzf sms2-backup.tar.gz
```

Antes de restaurar:
1. Crie um projeto Supabase de destino e confirme a versão do PostgreSQL, extensões e configurações de API.
2. Revise a ordem das migrations e a baseline de processos/contratos em `docs/INSTALACAO-BASELINE.md`.
3. Recrie o bucket privado, tamanho, MIME types e políticas de Storage a partir das migrations.
4. Planeje a criação/convite de usuários Auth e o bootstrap do Administrador Master antes de importar tabelas que referenciam `auth.users`.
5. Restaure o schema e os dados da aplicação com revisão de permissões padrão; a carga não deve ser executada em SMS2 atual como teste.

**Não faça o primeiro restore diretamente em produção.** Primeiro use um projeto de homologação descartável, valide relacionamentos, usuários, downloads do GED e login do Master, e documente cada diferença.

## Estado atual de execução

A rotina está versionada, mas a consulta às 828 execuções do GitHub Actions em 12/11/2026 não encontrou nenhuma execução do workflow Encrypted SMS2 backup. Portanto, ainda não há evidência de que os secrets/variables estejam configurados, de que um artefato criptografado tenha sido gerado, nem de que a chave privada consiga descriptografá-lo. O primeiro backup manual e o teste de restauração em projeto separado continuam obrigatórios.

## Frequência e política

- Enquanto o projeto estiver no Free, execute o workflow manual após mudanças relevantes e pelo menos semanalmente, depois de habilitar os secrets e a variável de agendamento.
- Guarde a identidade privada do age separada dos artefatos do GitHub.
- Antes de qualquer release, migration estrutural, troca de domínio ou ajuste de Storage, gere e teste um novo pacote.
- Defina um responsável para conferir o último backup bem-sucedido e sua possibilidade de descriptografia.
- Para produção com dados municipais, adote backup nativo diário do Supabase em plano elegível ou uma solução externa que também proteja Auth, configurações e credenciais. A rotina lógica deste repositório não cobre esses componentes.
