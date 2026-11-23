# Prontidão operacional — pendências verificáveis (2026-11-16)

Status geral: **NÃO pronto para venda.** Nenhum item abaixo foi provado com credenciais/artefatos reais nesta execução.

## E2E autenticado (run 43947711756)
- Causa: o card do item renderizava `"{n}. {descrição}"` num único elemento; `getByText(descrição, { exact: true })` nunca casava e expirava em `tenant-isolation.browser.mjs:1170`.
- Correção: descrição isolada em `<span>` em `src/components/contracts/contract-items-balance.tsx`. Nenhuma RLS alterada. Confirmar no próximo run do CI.

## 1. Backup/restore (ver ROTINA-DE-BACKUP.md)
- [ ] Secret de conexão de backup configurado no CI (não versionado).
- [ ] Artefato `pg_dump` gerado e checksum registrado.
- [ ] Restore em banco descartável + contagem de linhas por tabela comparada.
- Nenhum restore destrutivo no SMS2.

## 2. E-mail institucional (ver CONFIGURAR-CONVITES-E-MAIL.md)
- [ ] Domínio definido pelo órgão (não inventado).
- [ ] SPF: `dig TXT <dominio>` contém o include do provedor SMTP.
- [ ] DKIM: `dig TXT <seletor>._domainkey.<dominio>` publicado e validado no provedor.
- [ ] DMARC: `dig TXT _dmarc.<dominio>` com `p=quarantine` ou `reject` após período `none`.
- [ ] SMTP configurado no Supabase Auth; envio de teste a caixa controlada.

## 3. Documentos oficiais (ver FASE-1-MOTOR-DOCUMENTAL.md)
- [ ] Modelos oficiais fornecidos pelo órgão importados e analisados (`analyzeDocx`) sem avisos bloqueantes.
- [ ] Gerar DOCX/PDF por modelo e conferir campos pendentes = 0.
- Limites: PDF via pdf-lib não é conversão Word completa; assinatura simples, não ICP-Brasil.

## 4. Google Drive
- Apenas reconhecimento de links. OAuth/upload/sync **não configurados**; exigem client OAuth do órgão. Nenhum segredo fabricado.

## 5. LGPD/homologação
- [ ] Revisão RBAC/convites/isolamento com dois tenants em CI descartável (E2E existente).
- [ ] Política de retenção e procedimento de exportação/exclusão a pedido do titular aprovados juridicamente.
- [ ] Linter Supabase sem achados críticos novos.
