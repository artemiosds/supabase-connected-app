# Auditoria técnica de segurança — 09/11/2026

**Projeto:** Gestão de Fornecedores da Saúde  
**Repositório:** `artemiosds/supabase-connected-app`, branch `main`  
**Supabase:** SMS2 (`rwbbznqtocunzrpcvjvk`)  
**Natureza:** leitura e verificação; nenhuma migration, DDL, DML, alteração de configuração ou criação de dados foi executada nesta auditoria.

## Resultado executivo

A fundação de segurança do banco apresenta controles importantes já aplicados. A auditoria confirmou RLS em todas as tabelas públicas, políticas limitadas a `authenticated` ou `service_role`, ausência de privilégios de tabela para `anon`, schema interno `app_auth` não acessível a `anon` e funções privilegiadas com `search_path` controlado.

Isso **não comprova isolamento ponta a ponta entre Secretarias**: o banco não possui organizações nem dados operacionais de clientes e, portanto, não foi possível testar dois usuários municipais reais, Storage autenticado ou chamadas concorrentes. A liberação comercial continua NO-GO.

## Evidências verificadas

### Banco e políticas

- 24 de 24 tabelas no schema `public` estão com Row Level Security habilitado.
- 13 de 24 tabelas estão com `FORCE ROW LEVEL SECURITY`.
- Foram encontradas 104 políticas RLS no schema `public`.
- Nenhuma política foi atribuída ao papel genérico `PUBLIC`.
- Os privilégios de tabela consultados mostram acesso de aplicação concedido a `authenticated`; não foram encontrados privilégios de tabela concedidos a `anon`.
- O schema `app_auth` não concede `USAGE` a `anon`. O papel `authenticated` tem `USAGE` para que as políticas possam chamar as funções internas; isso não significa que o schema esteja publicado no PostgREST.
- As funções `SECURITY DEFINER` em `app_auth` verificadas usam `search_path = ''`; não foi identificado `EXECUTE` para `anon`.
- As funções de credenciais de cobrança com privilégio elevado são restritas a `service_role`; `payments_enabled` permanece desativado.
- A consulta ao catálogo não encontrou views no schema `public`.

### CI e código

No commit `3f52860d074af07f5e1fef11e414cc2c07d5fc17`, os dois workflows terminaram com sucesso:

- [Validate application #243](https://github.com/artemiosds/supabase-connected-app/actions/runs/42619809936) — testes, build, TypeScript e lint.
- [Format procurement module #125](https://github.com/artemiosds/supabase-connected-app/actions/runs/42619809927) — verificação de formatação.

O workflow de publicação das Edge Functions continua condicionado à variável `SUPABASE_EDGE_DEPLOY_ENABLED=true` para disparos por push e exige o secret `SUPABASE_ACCESS_TOKEN`. Não foi habilitado nem executado deploy nesta auditoria.

### Alertas do Supabase

- **Security Advisor:** um aviso `auth_leaked_password_protection`. A documentação oficial informa que a proteção contra senhas vazadas exige plano Pro ou superior. Nenhum upgrade foi solicitado ou executado.
- **Health Advisor:** sem alertas.
- **Performance Advisor:** 53 observações INFO de índices não utilizados na consulta atual. Como as tabelas não têm carga operacional, não se recomenda remover índices sem benchmark com dados representativos.

## Limitações e gates ainda abertos

1. Não há Secretarias, vínculos municipais, fornecedores, processos ou documentos de cliente no SMS2. O isolamento entre dois tenants precisa ser homologado em ambiente separado, com contas distintas.
2. O bucket GED é privado, mas upload, download, URLs temporárias, arquivamento e negação de acesso cruzado ainda precisam de teste autenticado no navegador.
3. O backup lógico ainda não tem execução, descriptografia e restauração comprovadas. Além disso, não inclui identidades/senhas Auth, metadados internos de Storage, configuração do projeto, SMTP nem secrets das Edge Functions.
4. SMTP e domínio remetente não estão configurados; os convites e a recuperação de senha não têm entrega externa comprovada.
5. A branch `main` permanece sem proteção e sem checks obrigatórios, conforme a verificação operacional registrada no roadmap. A configuração administrativa do GitHub deve ser feita pelo titular quando os nomes dos checks estiverem confirmados.
6. A proteção contra senhas vazadas depende de decisão de plano/custo do proprietário.
7. Nenhum teste E2E autenticado com duas Secretarias foi executado.

## Próximas ações seguras

1. Configurar a proteção da branch `main` no GitHub e exigir os checks validados.
2. Executar backup manual somente depois que o titular configurar os secrets e a chave pública age; descriptografar e restaurar em projeto separado.
3. Preparar homologação separada com duas Secretarias e usuários distintos, sem popular o SMS2 atual.
4. Homologar GED e Auth/SMTP com contas controladas.
5. Reavaliar os Advisors depois de dados representativos e antes de qualquer ajuste de índices.

## Decisão

**NO-GO para produção comercial.** O banco apresenta controles de base relevantes, mas os gates de recuperação, autenticação externa, Storage e isolamento autenticado ainda não têm evidência operacional suficiente.

Nenhum dado, migration, configuração de produção ou credencial foi alterado por este relatório.
