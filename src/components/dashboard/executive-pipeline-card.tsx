import { Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight, FolderKanban, UserCheck, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ETAPAS, formatarData, formatarMoeda } from "@/lib/contratacao";
import type { ResumoEsteiraPainel } from "@/lib/executive-dashboard-helper";

interface Props {
  resumo: ResumoEsteiraPainel;
}

export function ExecutivePipelineCard({ resumo }: Props) {
  return (
    <section
      aria-labelledby="esteira-processos-titulo"
      className="overflow-hidden rounded-2xl border border-border/75 bg-card shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-muted/20 px-5 py-4 sm:px-7">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
            <FolderKanban className="size-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Esteira da contratação · Lei nº 14.133/2021
            </p>
            <h2
              id="esteira-processos-titulo"
              className="mt-0.5 text-lg font-semibold tracking-tight"
            >
              Semáforo do fluxo de processos
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="secondary" className="font-medium">
            {resumo.totalAtivos} ativo(s) · {formatarMoeda(resumo.valorTotalEstimado)}
          </Badge>
          {resumo.naMinhaMesa > 0 && (
            <Badge className="bg-primary text-primary-foreground">
              <UserCheck className="mr-1 h-3 w-3" />
              {resumo.naMinhaMesa} na minha mesa
            </Badge>
          )}
          {resumo.semResponsavel > 0 && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
              <Users className="mr-1 h-3 w-3" />
              {resumo.semResponsavel} sem responsável
            </Badge>
          )}
        </div>
      </div>

      <div className="space-y-5 px-5 py-5 sm:px-7">
        {/* Semáforo compacto das 10 etapas */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-10">
          {resumo.porEtapa.map((etapa, idx) => (
            <Link
              key={etapa.id}
              to="/processos"
              className={`group flex flex-col justify-between rounded-xl border p-2.5 transition-colors hover:border-primary/40 ${
                etapa.naMinhaMesa > 0
                  ? "border-primary/35 bg-primary/[0.06]"
                  : etapa.total > 0
                    ? "border-border bg-muted/20"
                    : "border-border/50 bg-background opacity-70"
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-semibold text-muted-foreground">
                  {idx + 1}
                </span>
                {etapa.naMinhaMesa > 0 && (
                  <span className="rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground">
                    {etapa.naMinhaMesa} meu
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-xl font-bold tabular-nums">{etapa.total}</p>
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-muted-foreground group-hover:text-foreground">
                {etapa.nome}
              </p>
            </Link>
          ))}
        </div>

        {/* Fila "Na minha mesa agora" (só aparece se houver processos com o usuário) */}
        {resumo.processosNaMinhaMesa.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Na minha mesa agora
              </p>
              <Link
                to="/processos"
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                Abrir esteira completa <ArrowRight className="size-3.5" />
              </Link>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {resumo.processosNaMinhaMesa.slice(0, 4).map((proc) => {
                const etapaNome =
                  ETAPAS.find((e) => e.id === proc.stage)?.nome ?? proc.stage;
                return (
                  <Link
                    key={proc.id}
                    to="/processos"
                    search={{ processo: proc.id } as never}
                    className="flex items-center justify-between gap-3 rounded-xl border bg-background p-3 transition-colors hover:border-primary/40 hover:bg-muted/20"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">
                          Nº {proc.number}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {etapaNome}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {proc.title}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {proc.due_date ? `Prazo: ${formatarData(proc.due_date)}` : "Sem prazo"}
                        {typeof proc.estimated_value === "number" && proc.estimated_value > 0
                          ? ` · ${formatarMoeda(proc.estimated_value)}`
                          : ""}
                      </p>
                    </div>
                    <ArrowUpRight className="size-4 shrink-0 text-primary" />
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
