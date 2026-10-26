# Gestão de Fornecedores da Saúde — Etapa 0: confirmar o backend (Fase 1 bloqueada)

## Diagnóstico (somente leitura, já feito)
- **Nenhum projeto Supabase está conectado a este projeto Lovable.** O status informado pela plataforma é "no_supabase".
- Não há arquivos de integração com o Supabase, nem endereço do projeto configurado, nem biblioteca do Supabase instalada.
- O projeto é o modelo inicial em branco. Nenhuma tabela, política RLS ou migração foi criada.
- O fato de sua conta Supabase estar autenticada **não** significa que um projeto foi escolhido para este app. Não há nenhum projeto selecionado.
- Também não é possível ver o banco do projeto dedicado daqui: o diagnóstico de tabelas, autenticação, RLS e funções só pode ser feito depois que ele for conectado.

## Opções (nada será criado ou alterado sem sua escolha)
1. **Conectar o seu projeto Supabase dedicado (sua "Opção 1")**: em Configurações do projeto → Integrações → Supabase, você escolhe o projeto dedicado "Gestão de Fornecedores da Saúde". Por segurança, quem seleciona o projeto é você, não eu. Confira o nome antes de confirmar para não ligar o banco de outro sistema.
2. **Lovable Cloud** (backend gerenciado criado automaticamente): neste momento está desativado para o seu usuário. Além disso, contraria a decisão de usar o projeto existente. Fica listado só como referência.

## Depois que o projeto dedicado estiver conectado
1. Confirmo o nome e o estado da conexão, sem mostrar chaves.
2. Faço o diagnóstico somente leitura: tabelas existentes, usuários e configurações de login, políticas RLS, funções, triggers e storage.
3. Apresento um plano técnico separado da Fase 1, que só será executado com sua aprovação explícita. Ele trará:
   - Estrutura: organizações (tenants), perfis, vínculos usuário↔organização com papel, tabela de papéis separada, administrador global separado dos administradores das organizações, log de auditoria.
   - SQL completo das migrações e das políticas RLS, com funções de segurança e verificações também no servidor.
   - Testes de isolamento: um usuário da organização A tentando ler ou alterar dados da organização B, acesso sem login e tentativa de se promover a administrador.
   - Limites do plano gratuito do Supabase (projeto pausa por inatividade, limites de banco, storage e e-mails de autenticação), sem nenhum serviço pago.

## Fora do escopo agora
Fornecedores, documentos, PDFs, assinaturas, Google Drive, cobrança e VPS. Nada disso será tratado como pronto.

## Detalhes técnicos
- Verificações feitas: ausência de `src/integrations/supabase`, da pasta `supabase/`, de `SUPABASE_URL` e de `@supabase/*` no package.json. `LOVABLE_BROWSER_AUTH_STATUS=no_supabase`.
- Aprovar este plano autoriza apenas os itens 1 e 2 de leitura acima. Nenhuma migração será executada.
