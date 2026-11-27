import { useState, useEffect } from "react";
import { db, carregarTodasAsPaginas } from "@/lib/db";
export type AssigneeMember = { user_id: string; profiles: { full_name: string } | null };
type Member = AssigneeMember;
export function useAssignees(tenant?: string) {
  const [result, setResult] = useState<{ tenant: string; rows: Member[] | null }>();
  useEffect(() => {
    if (!tenant) return;
    let live = true;
    carregarTodasAsPaginas((a, b) =>
      db
        .from("tenant_memberships")
        .select("user_id,profiles(full_name)")
        .eq("tenant_id", tenant)
        .eq("status", "active")
        .order("user_id")
        .range(a, b),
    ).then(
      (rows) => {
        if (live) setResult({ tenant, rows });
      },
      () => {
        if (live) setResult({ tenant, rows: null });
      },
    );
    return () => {
      live = false;
    };
  }, [tenant]);
  return result?.tenant === tenant ? result?.rows : undefined;
}
export function AssigneeSelect({
  members,
  value,
  onChange,
  label,
}: {
  members: Member[] | null | undefined;
  value: string | null;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      className="w-full rounded-md border bg-background p-2 text-sm"
      value={value || ""}
      disabled={!members}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">
        {members === undefined
          ? "Carregando usuários…"
          : members === null
            ? "Falha ao carregar usuários"
            : "Sem usuário vinculado"}
      </option>
      {value && !members?.some((m) => m.user_id === value) && (
        <option value={value}>Vínculo existente</option>
      )}
      {members?.map((m) => (
        <option key={m.user_id} value={m.user_id}>
          {m.profiles?.full_name || "Membro"} · {m.user_id.slice(-6)}
        </option>
      ))}
    </select>
  );
}
