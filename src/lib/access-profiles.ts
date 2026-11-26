export const MODULE_LABELS_PT: Record<string, string> = {
  audit: "Auditoria",
  documents: "Documentos",
  organizations: "Organização",
  processes: "Processos e Preços",
  roles: "Perfis de Acesso",
  suppliers: "Fornecedores",
  users: "Usuários e Equipe",
};

export function traduzirModuloPermissao(module: string | null | undefined): string {
  const key = (module ?? "").trim().toLowerCase();
  if (!key) return "Outros";
  return MODULE_LABELS_PT[key] ?? module!.trim();
}

export function selecionarPapelPadraoConvite(
  roles: ReadonlyArray<{ id: string; slug: string }>,
): string {
  const prioritySlugs = ["operator", "viewer", "fiscal", "pregoeiro", "manager"];
  for (const slug of prioritySlugs) {
    const match = roles.find((r) => r.slug === slug);
    if (match) return match.id;
  }
  const nonAdmin = roles.find((r) => r.slug !== "admin");
  return nonAdmin?.id ?? roles[0]?.id ?? "";
}

export function gerarSlugPerfilPersonalizado(
  baseNameOrSlug: string,
  existingSlugs: ReadonlyArray<string>,
): string {
  const raw = baseNameOrSlug
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 48);

  const prefix = raw.length >= 2 && /^[a-z0-9]/.test(raw) ? `${raw}_custom` : "perfil_custom";
  const taken = new Set(existingSlugs.map((s) => s.toLowerCase()));
  if (!taken.has(prefix)) return prefix;

  for (let i = 2; i < 100; i += 1) {
    const candidate = `${prefix.slice(0, 55)}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${prefix.slice(0, 45)}_${Date.now().toString().slice(-6)}`;
}

export function filtrarPermissaoPorTexto(
  permission: { name: string; description?: string | null; code: string; module?: string | null },
  query: string,
): boolean {
  const term = query.trim().toLocaleLowerCase("pt-BR");
  if (!term) return true;
  const haystacks = [
    permission.name,
    permission.description ?? "",
    permission.code,
    traduzirModuloPermissao(permission.module),
  ];
  return haystacks.some((text) => text.toLocaleLowerCase("pt-BR").includes(term));
}
