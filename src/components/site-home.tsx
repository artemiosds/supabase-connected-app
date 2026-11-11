import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  ClipboardCheck,
  FileClock,
  FileText,
  Building2,
  HeartPulse,
  LayoutDashboard,
  LockKeyhole,
  ShieldCheck,
  Truck,
  Workflow,
} from "lucide-react";

const features = [
  {
    icon: Truck,
    number: "01",
    title: "Fornecedores organizados",
    description:
      "Mantenha cadastros, contatos e documentos de cada fornecedor em uma visão fácil de consultar.",
  },
  {
    icon: FileClock,
    number: "02",
    title: "Prazos sob acompanhamento",
    description:
      "Veja documentos e contratos próximos do vencimento e saiba o que precisa de atenção.",
  },
  {
    icon: Workflow,
    number: "03",
    title: "Processos conectados",
    description:
      "Acompanhe etapas, itens, cotações, orçamento, contratos e aditivos no mesmo ambiente.",
  },
];


const accessPortals = [
  {
    icon: LayoutDashboard,
    portal: "master" as const,
    title: "Painel Master",
    description: "Administração global da plataforma e gestão das Secretarias.",
    action: "Entrar no Master",
  },
  {
    icon: Building2,
    portal: "secretaria" as const,
    title: "Portal da Secretaria",
    description: "Fornecedores, documentos, processos, contratos e histórico da organização.",
    action: "Entrar na Secretaria",
  },
  {
    icon: ShieldCheck,
    portal: "suporte" as const,
    title: "Central de Suporte",
    description: "Atendimento técnico autorizado, com acesso controlado por organização.",
    action: "Acessar suporte",
  },
];

const safeguards = [
  {
    icon: LockKeyhole,
    title: "Acesso por perfil",
    description: "Cada pessoa vê e realiza o que suas permissões autorizam.",
  },
  {
    icon: ShieldCheck,
    title: "Separação por Secretaria",
    description: "O trabalho de cada organização permanece em seu próprio espaço.",
  },
  {
    icon: ClipboardCheck,
    title: "Histórico de operações",
    description: "Ações importantes ficam registradas para consulta e rastreabilidade.",
  },
];

export function SiteHome() {
  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <header className="relative z-10 border-b border-border/70 bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link to="/" className="flex min-w-0 items-center gap-3" aria-label="Página inicial">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <HeartPulse className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-bold tracking-tight sm:text-base">
                Gestão de Fornecedores
              </span>
              <span className="block text-xs text-muted-foreground">da Saúde</span>
            </span>
          </Link>

          <nav aria-label="Navegação principal" className="hidden items-center gap-8 md:flex">
            <a
              href="#recursos"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Recursos
            </a>
            <a
              href="#seguranca"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Gestão responsável
            </a>
          </nav>

          <Link
            to="/entrar"
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="hidden sm:inline">Acessar plataforma</span>
            <span className="sm:hidden">Entrar</span>
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </header>

      <section className="relative isolate">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_78%_18%,color-mix(in_oklch,var(--primary)_12%,transparent),transparent_38%),linear-gradient(to_bottom,var(--background),color-mix(in_oklch,var(--muted)_55%,var(--background)))]"
        />
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 pb-16 pt-14 sm:px-8 sm:pb-20 sm:pt-20 lg:grid-cols-[1.02fr_0.98fr] lg:gap-10 lg:pb-24 lg:pt-24">
          <div className="max-w-2xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-semibold tracking-wide text-primary">
              <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
              GESTÃO MUNICIPAL DA SAÚDE
            </div>
            <h1 className="text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.04em] sm:text-5xl lg:text-[3.8rem]">
              Mais clareza para organizar o que{" "}
              <span className="text-primary">faz a saúde pública avançar.</span>
            </h1>
            <p className="mt-6 max-w-xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              Fornecedores, documentos, prazos e processos de contratação em um só ambiente,
              organizado para a rotina das Secretarias Municipais de Saúde.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/entrar"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/15 transition hover:-translate-y-0.5 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Entrar no meu ambiente
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <a
                href="#recursos"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border bg-background/80 px-6 text-sm font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Conhecer os recursos
                <ChevronRight className="h-4 w-4" aria-hidden />
              </a>
            </div>

            <div className="mt-9 flex flex-wrap gap-x-5 gap-y-3 text-xs font-medium text-muted-foreground sm:text-sm">
              <span className="inline-flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" aria-hidden />
                Organização por Secretaria
              </span>
              <span className="inline-flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" aria-hidden />
                Permissões por perfil
              </span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
            <div
              aria-hidden="true"
              className="absolute -inset-6 rounded-[2.5rem] bg-primary/10 blur-3xl"
            />
            <div
              role="img"
              aria-label="Prévia ilustrativa do painel: visão de fornecedores, documentos, prazos e etapas de contratação, sem dados reais."
              className="relative rounded-[1.6rem] border border-border/80 bg-card p-2.5 shadow-[0_30px_90px_-36px_color-mix(in_oklch,var(--primary)_42%,transparent)] sm:rounded-[2rem] sm:p-3"
            >
              <div className="overflow-hidden rounded-[1.15rem] border bg-background sm:rounded-[1.5rem]">
                <div className="flex items-center justify-between border-b px-4 py-3 sm:px-5">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <HeartPulse className="h-4 w-4" aria-hidden />
                    </span>
                    <div>
                      <p className="text-xs font-semibold sm:text-sm">Painel de gestão</p>
                      <p className="text-[10px] text-muted-foreground sm:text-xs">
                        Secretaria de Saúde
                      </p>
                    </div>
                  </div>
                  <span className="rounded-full border bg-muted/60 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-[10px]">
                    Prévia ilustrativa
                  </span>
                </div>

                <div className="grid min-h-[21rem] sm:min-h-[24rem] sm:grid-cols-[9rem_1fr]">
                  <aside className="hidden border-r bg-muted/25 p-3 sm:block">
                    <p className="px-2 py-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Ambiente
                    </p>
                    <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-2 py-2 text-[10px] font-semibold text-primary">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                      Visão geral
                    </div>
                    <div className="mt-1 flex items-center gap-2 rounded-lg px-2 py-2 text-[10px] text-muted-foreground">
                      <Truck className="h-3.5 w-3.5" aria-hidden />
                      Fornecedores
                    </div>
                    <div className="flex items-center gap-2 rounded-lg px-2 py-2 text-[10px] text-muted-foreground">
                      <FileText className="h-3.5 w-3.5" aria-hidden />
                      Documentos
                    </div>
                    <div className="flex items-center gap-2 rounded-lg px-2 py-2 text-[10px] text-muted-foreground">
                      <Workflow className="h-3.5 w-3.5" aria-hidden />
                      Processos
                    </div>
                    <div className="mt-6 rounded-xl border bg-background p-2.5">
                      <p className="text-[9px] font-semibold">Acesso controlado</p>
                      <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
                        Permissões definidas por perfil
                      </p>
                    </div>
                  </aside>

                  <div className="min-w-0 p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold tracking-tight sm:text-base">
                          Sua rotina, em perspectiva
                        </p>
                        <p className="mt-1 text-[10px] text-muted-foreground sm:text-xs">
                          Uma visão clara das frentes de trabalho
                        </p>
                      </div>
                      <span className="hidden h-8 w-8 items-center justify-center rounded-full border text-primary sm:flex">
                        <ShieldCheck className="h-4 w-4" aria-hidden />
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      {[
                        { icon: Truck, label: "Fornecedores", note: "Cadastros" },
                        { icon: FileClock, label: "Documentos", note: "Validades" },
                        { icon: Workflow, label: "Processos", note: "Etapas" },
                      ].map(({ icon: Icon, label, note }) => (
                        <div key={label} className="rounded-xl border bg-card p-2.5 sm:p-3">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Icon className="h-3.5 w-3.5" aria-hidden />
                          </span>
                          <p className="mt-2 truncate text-[9px] font-semibold sm:text-[10px]">
                            {label}
                          </p>
                          <p className="mt-0.5 text-[9px] text-muted-foreground">{note}</p>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 rounded-xl border bg-card p-3 sm:p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-semibold sm:text-xs">
                          Acompanhamento de trabalho
                        </p>
                        <span className="text-[9px] text-muted-foreground sm:text-[10px]">
                          Fluxos conectados
                        </span>
                      </div>
                      <div className="mt-3 space-y-2.5">
                        {[
                          { title: "Cadastro de fornecedor", status: "Dados organizados" },
                          { title: "Documento e vencimento", status: "Prazo acompanhado" },
                          { title: "Processo de contratação", status: "Etapas registradas" },
                        ].map(({ title, status }, index) => (
                          <div
                            key={title}
                            className="flex items-center gap-2.5 rounded-lg bg-muted/40 px-2.5 py-2"
                          >
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                              {index === 0 ? (
                                <Truck className="h-3 w-3" aria-hidden />
                              ) : index === 1 ? (
                                <FileText className="h-3 w-3" aria-hidden />
                              ) : (
                                <Workflow className="h-3 w-3" aria-hidden />
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[9px] font-medium sm:text-[10px]">
                                {title}
                              </span>
                              <span className="block truncate text-[9px] text-muted-foreground">
                                {status}
                              </span>
                            </span>
                            <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                          </div>
                        ))}
                      </div>
                    </div>

                    <p className="mt-3 text-center text-[9px] text-muted-foreground">
                      Demonstração visual · nenhum dado real
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute -bottom-5 -left-2 hidden rounded-2xl border bg-background p-3 shadow-lg sm:block lg:-left-8">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700">
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <p className="text-xs font-semibold">Mais organização</p>
                  <p className="text-[10px] text-muted-foreground">com controle de acesso</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="portais" className="scroll-mt-12 border-y bg-primary/[0.035]">
        <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-16">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
              Acesso por ambiente
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              Escolha por onde você trabalha.
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              Cada perfil tem um espaço próprio para as tarefas que realiza na plataforma.
            </p>
          </div>

          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {accessPortals.map(({ icon: Icon, portal, title, description, action }) => (
              <Link
                key={title}
                to="/entrar"
                search={{ portal }}
                className="group flex min-h-52 flex-col rounded-2xl border bg-card p-5 shadow-sm transition hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:p-6"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="mt-4 text-base font-semibold tracking-tight">{title}</span>
                <span className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">
                  {description}
                </span>
                <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary">
                  {action}
                  <ArrowRight
                    className="h-4 w-4 transition-transform group-hover:translate-x-1"
                    aria-hidden
                  />
                </span>
              </Link>
            ))}
          </div>

          <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
            O acesso usa uma única tela de login. As permissões da conta determinam quais ambientes
            e recursos ficam disponíveis.
          </p>
        </div>
      </section>

      <section id="recursos" className="scroll-mt-12 border-y bg-background">
        <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
              Um fluxo mais organizado
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Do cadastro à contratação, com contexto.
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              Reúna as informações essenciais para acompanhar o trabalho da Secretaria com mais
              continuidade e menos dispersão.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {features.map(({ icon: Icon, number, title, description }) => (
              <article
                key={number}
                className="group rounded-2xl border bg-card p-5 transition duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/5 sm:p-6"
              >
                <div className="flex items-start justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="text-xs font-semibold tracking-widest text-muted-foreground/70">
                    {number}
                  </span>
                </div>
                <h3 className="mt-6 text-lg font-semibold tracking-tight">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
                <a
                  href="#acesso"
                  className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Acessar plataforma
                  <ArrowRight
                    className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1"
                    aria-hidden
                  />
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="seguranca" className="bg-muted/40">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
              Feito para equipes públicas
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Organização com responsabilidade e rastreabilidade.
            </h2>
            <p className="mt-4 max-w-xl leading-7 text-muted-foreground">
              A rotina administrativa pede clareza sobre quem acessa, onde cada informação está e
              quais etapas já foram registradas.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {safeguards.map(({ icon: Icon, title, description }) => (
              <article key={title} className="rounded-2xl border bg-background p-4 sm:p-5">
                <Icon className="h-5 w-5 text-primary" aria-hidden />
                <h3 className="mt-4 text-sm font-semibold">{title}</h3>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="acesso" className="border-t bg-background">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-5 py-12 sm:px-8 sm:py-14 md:flex-row md:items-center">
          <div>
            <p className="text-xl font-semibold tracking-tight">
              Seu ambiente de trabalho está a um acesso de distância.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Entre com sua conta institucional para continuar.
            </p>
          </div>
          <Link
            to="/entrar"
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:w-auto"
          >
            Acessar plataforma
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </section>

      <footer className="border-t bg-background">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-6 text-xs text-muted-foreground sm:px-8 md:flex-row md:items-center md:justify-between">
          <p>Gestão de Fornecedores da Saúde</p>
          <p>Plataforma de apoio à gestão municipal da saúde</p>
        </div>
      </footer>
    </main>
  );
}
