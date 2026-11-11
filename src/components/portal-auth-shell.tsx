import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Building2,
  HeartPulse,
  Layers3,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type PortalEntrada = "master" | "secretaria" | "suporte";

const CONTEUDO_PORTAL = {
  master: {
    marca: "BACKOFFICE SAAS SAÚDE",
    nome: "Painel Master",
    chamada: "Gestão da plataforma.",
    descricao: "Administre os ambientes e a operação global em um espaço reservado.",
    nota: "Acesso restrito à equipe autorizada",
    login: "Entre com as credenciais da equipe autorizada.",
    gradiente: "from-emerald-950 via-slate-950 to-teal-900",
    Icone: Layers3,
  },
  secretaria: {
    marca: "GESTÃO MUNICIPAL DA SAÚDE",
    nome: "Portal da Secretaria",
    chamada: "Sua rotina, em um só lugar.",
    descricao: "Acompanhe fornecedores, documentos, processos e contratos da sua organização.",
    nota: "Acesso conforme vínculo e permissões",
    login: "Entre com a conta vinculada à sua Secretaria.",
    gradiente: "from-teal-950 via-slate-950 to-cyan-900",
    Icone: Building2,
  },
  suporte: {
    marca: "ATENDIMENTO CONTROLADO",
    nome: "Central de Suporte",
    chamada: "Apoio técnico com responsabilidade.",
    descricao: "Acesse atendimentos autorizados e ferramentas da equipe de suporte.",
    nota: "Acesso controlado durante o atendimento",
    login: "Entre com a conta técnica autorizada.",
    gradiente: "from-indigo-950 via-slate-950 to-blue-900",
    Icone: ShieldCheck,
  },
  default: {
    marca: "PLATAFORMA DE GESTÃO",
    nome: "Gestão de Fornecedores da Saúde",
    chamada: "Acesso à plataforma.",
    descricao: "Acesse apenas os ambientes e recursos autorizados para sua conta.",
    nota: "Acesso protegido por perfil",
    login: "Entre com as credenciais da sua conta.",
    gradiente: "from-teal-950 via-slate-950 to-emerald-900",
    Icone: HeartPulse,
  },
};

export function PortalAuthShell({
  portal,
  children,
}: {
  portal?: PortalEntrada;
  children: ReactNode;
}) {
  const conteudo = CONTEUDO_PORTAL[portal ?? "default"];
  const IconeMarca = conteudo.Icone;

  return (
    <main className="grid min-h-screen bg-background text-foreground lg:grid-cols-2">
      <aside
        className={`relative hidden min-h-screen flex-col justify-between overflow-hidden bg-gradient-to-br ${conteudo.gradiente} p-10 text-white lg:flex xl:p-14`}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-40 -top-36 h-[34rem] w-[34rem] rounded-full border border-white/10"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-16 h-[25rem] w-[25rem] rounded-full border border-white/10"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-24 right-12 h-40 w-40 rounded-full bg-white/5 blur-3xl"
        />

        <Link to="/" className="relative z-10 flex items-center gap-3 text-sm font-semibold">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/20 bg-white/10 backdrop-blur">
            <IconeMarca className="h-5 w-5" aria-hidden />
          </span>
          <span className="tracking-wide">{conteudo.marca}</span>
        </Link>

        <div className="relative z-10 max-w-xl py-20">
          <p className="mb-7 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/80">
            <span className="h-2 w-2 rounded-full bg-emerald-300" aria-hidden />
            {conteudo.marca}
          </p>
          <h2 className="text-balance text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
            {conteudo.nome}
          </h2>
          <p className="mt-5 text-xl text-white/80">{conteudo.chamada}</p>
          <p className="mt-4 max-w-md text-sm leading-6 text-white/70">{conteudo.descricao}</p>

          <div className="mt-12 flex items-center gap-3 border-t border-white/15 pt-6 text-sm text-white/85">
            <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden />
            <span>{conteudo.nota}</span>
          </div>
        </div>

        <p className="relative z-10 text-xs text-white/55">
          Gestão de Fornecedores da Saúde
        </p>
      </aside>

      <section className="flex min-h-screen flex-col px-5 py-6 sm:px-8 sm:py-8 lg:px-12 xl:px-16">
        <header className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <IconeMarca className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-semibold">{conteudo.nome}</span>
              <span className="block text-xs uppercase tracking-wider text-muted-foreground">
                Gestão da plataforma
              </span>
            </span>
          </div>
          <span className="hidden shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground sm:inline-flex">
            <LockKeyhole className="h-3.5 w-3.5" aria-hidden />
            Acesso privado
          </span>
        </header>

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <Button asChild variant="ghost" size="sm" className="mb-8 -ml-2 self-start">
            <Link to="/">
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
              Voltar ao início
            </Link>
          </Button>

          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <LockKeyhole className="h-6 w-6" aria-hidden />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Bem-vindo à central
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Acesse sua conta</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{conteudo.login}</p>
          <div className="mt-7">{children}</div>
          <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">
            A tela escolhida não concede acesso. As permissões da sua conta determinam o ambiente
            liberado.
          </p>
        </div>

        <footer className="text-center text-xs text-muted-foreground">
          Gestão de Fornecedores da Saúde
        </footer>
      </section>
    </main>
  );
}
