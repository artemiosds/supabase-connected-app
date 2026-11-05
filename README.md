# Gestão de Fornecedores da Saúde

Plataforma web multitenant para Secretarias de Saúde, com cadastro e acompanhamento de fornecedores, documentos, vencimentos, modelos documentais, usuários, permissões, configurações institucionais e histórico de auditoria.

## Fontes oficiais

- **Código-fonte:** repositório `artemiosds/supabase-connected-app`, branch `main`.
- **Banco:** projeto gerenciado Supabase SMS2. As migrations versionadas em `supabase/migrations` devem permanecer sincronizadas com o histórico aplicado no banco.
- **Pré-visualização:** Lovable conectado ao GitHub. O preview não substitui testes autenticados nem homologação de produção.
- **Isolamento:** autorização e separação entre Secretarias são aplicadas no PostgreSQL por RLS, chaves estrangeiras compostas e funções internas. Filtros da interface nunca são considerados barreira de segurança.

## Desenvolvimento local

Requisitos: Node.js 22 ou superior e Bun estável.

```sh
git clone https://github.com/artemiosds/supabase-connected-app.git
cd supabase-connected-app
bun install --frozen-lockfile
bun run dev
```

Validações locais:

```sh
bun run test
bunx tsc --noEmit
bun run build
bun run lint
```

O lockfile oficial é `bun.lock`. Use `bun install --frozen-lockfile` para reproduzir exatamente as dependências sem atualizar o lockfile.

## Configuração do Supabase

Conecte o projeto SMS2 no ambiente Lovable ou configure as variáveis de ambiente esperadas pelo projeto: `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`, com equivalentes de servidor quando aplicável.

Use somente chave publicável no navegador. **Nunca exponha `service_role`, chaves secretas, tokens ou credenciais administrativas em código cliente ou variáveis `VITE_*`.**

## Módulos implementados

- Autenticação, confirmação de e-mail e recuperação de senha.
- Administração global e provisionamento de Secretarias.
- Cadastro, pesquisa, edição e inativação de fornecedores.
- Documentos de fornecedores e controle visual de vencimentos.
- Modelos e geração de documentos com registro de versão do conteúdo.
- Assinatura eletrônica simples ligada à sessão autenticada.
- Usuários, papéis e permissões por Secretaria.
- Painel, configurações institucionais e histórico de auditoria.

Consulte `roadmap.md` para as evidências da Fundação Multitenant e da Fase 2, os limites conhecidos e os itens que ainda impedem a liberação comercial.
