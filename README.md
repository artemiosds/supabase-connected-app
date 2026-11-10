# Gestão de Fornecedores da Saúde

Plataforma web SaaS multitenant para Secretarias de Saúde, com cadastro e acompanhamento de fornecedores, documentos, vencimentos, GED privado, modelos documentais, processos de contratação, compras, contratos, usuários, permissões e auditoria.

## Fontes oficiais

- **Código:** `artemiosds/supabase-connected-app`, branch `main`.
- **Banco:** Supabase gerenciado SMS2; migrations devem permanecer sincronizadas ao histórico aplicado.
- **Editor/preview:** Lovable conectado ao GitHub. Preview/build verde não substitui homologação autenticada.
- **Segurança:** tenant isolation no PostgreSQL por RLS, chaves compostas e funções internas. Filtros da UI nunca substituem autorização no banco/servidor.

## Módulos estruturados

- Autenticação, confirmação e recuperação de senha.
- Administração global, provisionamento de Secretarias e controles comerciais.
- Cadastro, pesquisa, edição e inativação de fornecedores.
- Documentos de fornecedores, validade, arquivamento e GED privado em Supabase Storage.
- Catálogo de modelos, instalação/versionamento por Secretaria, geração e assinatura eletrônica simples.
- Importação TXT/MD e DOCX para texto editável. A importação DOCX converte parágrafos e tabelas simples; não preserva layout, imagens, cabeçalho ou rodapé.
- Usuários municipais, convites, papéis, permissões e auditoria.
- Equipe Interna do Portal Master com RBAC separado e portal de trabalho próprio.
- Equipe Técnica de Suporte com atribuições por Secretaria e sessões temporárias.
- Processos/checklists, itens, cotações, frete, dotações, contratos e aditivos com guardas no banco.

## Limites conhecidos

O sistema ainda exige homologação com duas Secretarias. O GED ainda precisa de testes autenticados de upload/download e isolamento. Google Drive OAuth/sincronização, PDF server-side, assinatura qualificada ICP-Brasil, alertas recorrentes de e-mail/WhatsApp e gateway de pagamento não estão ativos. SMTP/domínio, backup restaurável, jurídico/LGPD, SLA e publicação comercial também permanecem como gates.

## Desenvolvimento

Requisitos: Node.js 22+ e Bun.

```sh
git clone https://github.com/artemiosds/supabase-connected-app.git
cd supabase-connected-app
bun install --frozen-lockfile
bun run dev
```

Validações:

```sh
bun run test
bunx tsc --noEmit
bun run build
bun run lint
```

Use `bun.lock` como lockfile oficial. Nunca coloque `service_role`, chaves secretas, senhas, JWTs ou tokens OAuth em código de navegador ou em variáveis `VITE_*`.

## Plano e liberação

- [`roadmap.md`](roadmap.md) — estado resumido por fase.
- [`docs/DIAGNOSTICO-FASES-2026-11-10.md`](docs/DIAGNOSTICO-FASES-2026-11-10.md) — auditoria de código, banco, CI e pendências.
- [`docs/GO-LIVE-CHECKLIST.md`](docs/GO-LIVE-CHECKLIST.md) — critérios GO/NO-GO.
- [`docs/PLANO-EXECUCAO-INTEGRACOES-E-HOMOLOGACAO.md`](docs/PLANO-EXECUCAO-INTEGRACOES-E-HOMOLOGACAO.md) — sequência de conclusão.
