# Monitoramento Contínuo e Resposta a Incidentes

Este documento descreve os controles nativos e gratuitos implantados na Fase 6 para detecção contínua de anomalias, prevenção de regressões e resposta rápida a incidentes no **Primus Gestão** (`SMS2`).

## 1. Painel ao Vivo no Sistema (`/admin-master` → Auditoria Global)

A função RPC `public.get_platform_security_signals()` (acessível exclusivamente a `platform_admins` ativos com nível `AAL2` após ativação do MFA) consolida telemetria agregada **sem armazenar ou retornar senhas, tokens ou PII**:

- **Cobertura MFA Master:** compara administradores ativos contra fatores `verified` em `auth.mfa_factors`.
- **Integridade RLS / FORCE RLS:** verifica ao vivo em `pg_catalog.pg_class` se todas as tabelas do esquema `public` mantêm `relrowsecurity` e `relforcerowsecurity` ativos.
- **Falhas de autorização (`ACCESS_DENIED`):** contabiliza eventos em 24h e 7 dias e dispara alerta automático a partir de 1 ocorrência (`Médio`) ou 5+ ocorrências em 24h (`Alto`).
- **Mudanças de privilégios:** monitora `platform_admins`, `platform_staff_members`, `platform_support_agents`, `membership_roles`, `tenant_roles` e `tenant_role_permissions`.
- **Saúde / abuso de IA:** monitora taxa de falhas em `platform_ai_usage` (alerta quando >= 3 falhas ou >= 40% em 24h).
- **Sessões de suporte cross-tenant ativas:** lista contagem em tempo real de `platform_support_sessions` abertas.

## 2. Consultas ClickHouse Recomendadas (`Supabase Logs Explorer`)

No painel do Supabase (`Logs Explorer`), utilize as consultas abaixo (janelas de até 24h) para investigar anomalias sem coletar dados sensíveis:

- **Tentativas repetidas de login ou força bruta (`auth_logs`):**
  ```sql
  SELECT timestamp, event_message
  FROM auth_logs
  WHERE event_message LIKE '%Invalid login%'
     OR event_message LIKE '%429%'
  ORDER BY timestamp DESC
  LIMIT 50
  ```
- **Rejeições de autorização, assinaturas inválidas de webhook ou rate limit (`function_edge_logs`):**
  ```sql
  SELECT timestamp, metadata.function_id, metadata.status_code
  FROM function_edge_logs
  WHERE metadata.status_code IN (401, 403, 429, 503)
  ORDER BY timestamp DESC
  LIMIT 100
  ```
- **Erros SQL / violações de RLS (`postgres_logs`):**
  ```sql
  SELECT timestamp, event_message
  FROM postgres_logs
  WHERE event_message LIKE '%42501%'
     OR event_message LIKE '%permission denied%'
  ORDER BY timestamp DESC
  LIMIT 50
  ```

## 3. Prevenção Contínua no GitHub (Gratuito)

- **Detecção de vazamento de segredos:** `.github/workflows/security-monitor.yml` executa `gitleaks/gitleaks-action@v2` em todo push, PR e toda segunda-feira.
- **Vulnerabilidades em dependências:** `.github/dependabot.yml` abre PRs semanais automáticos para `npm` e `github-actions`, e `bun pm audit --audit-level=high` bloqueia dependências com CVEs graves conhecidos.
- **Invariantes automatizadas:** `src/test/security-invariants.test.ts` impede regressão em CORS, `nosniff`, `verify_jwt`, `FORCE RLS`, CSP, CSRF, MFA e exposição de chaves no frontend.

## 4. Proteção Recomendada na Branch `main` (GitHub Settings → Branches)

Para proteção institucional no GitHub:

1. Ativar **Require a pull request before merging** na branch `main`.
2. Marcar **Require status checks to pass before merging** selecionando `validate`, `database-security` e `security-monitor`.
3. Bloquear **Allow force pushes** e **Allow deletions**.
4. Habilitar no repositório: **Secret scanning** e **Push protection** (Settings → Code security and analysis).

## 5. Playbook Resumido de Resposta a Incidentes

1. **Suspeita de conta comprometida:** revogar acesso administrativo (`platform_admins.is_active = false` / suspender membro da Secretaria) e encerrar sessões de suporte na aba _Equipe de Suporte_.
2. **Suspeita de chave/segredo exposto:** rotacionar imediatamente o segredo em _Supabase Secrets_, _GitHub Actions Secrets_ ou na aba _Cobrança / IA / Integrações_ (recriptografando no Vault/AES-GCM).
3. **Pico de `429` / `401` em Edge Functions:** verificar origem em `function_edge_logs`; se necessário, ativar `DISABLE_PREVIEW_ORIGIN=true` nos Secrets do Supabase para restringir estritamente ao domínio oficial `APP_URL`.
