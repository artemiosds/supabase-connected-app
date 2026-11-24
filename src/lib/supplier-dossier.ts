// =============================================================================
// supplier-dossier.ts — Geração do Dossiê Administrativo do Fornecedor
// Primus Gestão — Fase 2.1 — Central Inteligente de Fornecedores (Entrega 6)
// =============================================================================

import { formatarCnpj } from "./cnpj";
import { formatarData } from "./contratacao";
import { rotuloStatusHomologacao } from "./supplier-homologation";
import { rotuloStatusRegularidade } from "./supplier-regularity";
import {
  rotuloStatusConsolidado360,
  type StatusConsolidado360,
  type HomologacaoPerfil,
  type RegularidadePerfil,
} from "./supplier-profile";

export interface DadosFornecedorDossie {
  id: string;
  legal_name: string;
  trade_name?: string | null;
  cnpj: string;
  state_registration?: string | null;
  municipal_registration?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  phone?: string | null;
  email?: string | null;
  contact_name?: string | null;
  category?: string | null;
  status: string;
}

export interface DocumentoDossie {
  id: string;
  title: string;
  document_type: string;
  status: string;
  issue_date?: string | null;
  expires_at?: string | null;
  notes?: string | null;
}

export interface SancaoDossie {
  id: string;
  measure: string;
  reason?: string | null;
  reference_number?: string | null;
  start_date: string;
  end_date?: string | null;
  status: string;
}

export interface InstrumentoDossie {
  id: string;
  number: string;
  instrument_type: string;
  object?: string | null;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  total_value?: number | null;
}

export interface DossieCompletoParams {
  secretariaNome?: string;
  municipioNome?: string;
  fornecedor: DadosFornecedorDossie;
  statusConsolidado: StatusConsolidado360;
  ultimaHomologacao?: HomologacaoPerfil | null;
  regularidades: RegularidadePerfil[];
  documentos: DocumentoDossie[];
  sancoes: SancaoDossie[];
  instrumentos: InstrumentoDossie[];
  cotacoesCount?: number;
  emissaoDataHora?: string;
  servidorNome?: string;
}

function escapeHtml(value: unknown): string {
  return (value == null ? "" : String(value)).replace(/[&<>"']/gu, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

/**
 * Gera um identificador de autenticidade único para o dossiê.
 */
export function gerarCodigoAutenticidade(fornecedorId: string, timestamp = Date.now()): string {
  const base = `${fornecedorId}-${timestamp}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    const char = base.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).toUpperCase().padStart(8, "0");
  return `PRM-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

/**
 * Gera o documento HTML oficial formatado do Dossiê Administrativo (A4).
 */
export function gerarHtmlDossie(params: DossieCompletoParams): string {
  const hoje = params.emissaoDataHora ?? new Date().toLocaleString("pt-BR");
  const codigoAutenticidade = gerarCodigoAutenticidade(params.fornecedor.id);
  const statusMeta = rotuloStatusConsolidado360(params.statusConsolidado);
  const f = params.fornecedor;

  const enderecoCompleto = [
    f.address_street ? `${f.address_street}${f.address_number ? `, nº ${f.address_number}` : ""}` : "",
    f.address_complement,
    f.neighborhood,
    f.city && f.state ? `${f.city}/${f.state}` : f.city,
    f.zip_code ? `CEP: ${f.zip_code}` : "",
  ]
    .filter(Boolean)
    .join(" — ");

  // Linhas de Regularidade
  const linhasRegularidade =
    params.regularidades.length === 0
      ? `<tr><td colspan="4" class="text-center muted">Nenhuma verificação de regularidade oficial registrada nesta Secretaria.</td></tr>`
      : params.regularidades
          .map((r) => {
            const statusLabel = rotuloStatusRegularidade((r.status as any) ?? "pending_review");
            const isReg = r.status === "regular";
            const isIrreg = r.status === "irregular";
            const badgeClass = isReg ? "badge-success" : isIrreg ? "badge-danger" : "badge-neutral";
            return `
              <tr>
                <td><strong>${escapeHtml(r.source_label || r.source)}</strong></td>
                <td><span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span></td>
                <td>${escapeHtml(r.valid_until ? formatarData(r.valid_until) : "—")}</td>
                <td>${r.requires_action ? '<span class="badge badge-warning">Exige ação</span>' : "Conforme"}</td>
              </tr>
            `;
          })
          .join("");

  // Linhas de Documentos
  const linhasDocumentos =
    params.documentos.length === 0
      ? `<tr><td colspan="4" class="text-center muted">Nenhum documento cadastrado.</td></tr>`
      : params.documentos
          .map((d) => `
            <tr>
              <td><strong>${escapeHtml(d.title)}</strong></td>
              <td>${escapeHtml(d.document_type.replaceAll("_", " "))}</td>
              <td>${escapeHtml(d.expires_at ? formatarData(d.expires_at) : "Sem vencimento")}</td>
              <td><span class="badge ${d.status === "active" ? "badge-neutral" : "badge-muted"}">${escapeHtml(d.status === "active" ? "Ativo" : "Arquivado")}</span></td>
            </tr>
          `)
          .join("");

  // Linhas de Sanções
  const linhasSancoes =
    params.sancoes.length === 0
      ? `<tr><td colspan="4" class="text-center muted">Nenhum registro de sanção ou impedimento vigente nesta Secretaria.</td></tr>`
      : params.sancoes
          .map((s) => `
            <tr>
              <td><strong>${escapeHtml(s.measure)}</strong></td>
              <td>${escapeHtml(s.reason || "Não informado")}</td>
              <td>${escapeHtml(formatarData(s.start_date))} a ${escapeHtml(s.end_date ? formatarData(s.end_date) : "Indeterminado")}</td>
              <td><span class="badge ${s.status === "active" ? "badge-danger" : "badge-neutral"}">${escapeHtml(s.status)}</span></td>
            </tr>
          `)
          .join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dossiê Administrativo — ${escapeHtml(f.legal_name)}</title>
<style>
  @page { size: A4 portrait; margin: 15mm 12mm 15mm 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1f2937;
    font-size: 11px;
    line-height: 1.4;
    margin: 0;
    padding: 0;
    background: #fff;
  }
  .header {
    border-bottom: 2px solid #0f766e;
    padding-bottom: 8px;
    margin-bottom: 12px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .header-left h1 {
    font-size: 15px;
    margin: 0 0 2px 0;
    color: #0f766e;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .header-left p {
    margin: 0;
    font-size: 10px;
    color: #4b5563;
    font-weight: 500;
  }
  .header-right {
    text-align: right;
    font-size: 9px;
    color: #6b7280;
  }
  .header-right .code {
    font-weight: bold;
    font-size: 11px;
    color: #111827;
  }
  .badge {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
  }
  .badge-success { background: #dcfce7; color: #15803d; border: 1px solid #86efac; }
  .badge-danger { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }
  .badge-warning { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
  .badge-neutral { background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; }
  .badge-muted { background: #f9fafb; color: #9ca3af; }

  .status-box {
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-left: 4px solid ${params.statusConsolidado === "apto" ? "#10b981" : params.statusConsolidado === "inapto" ? "#ef4444" : "#f59e0b"};
    border-radius: 4px;
    padding: 8px 12px;
    margin-bottom: 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .status-box-title {
    font-size: 12px;
    font-weight: 700;
    color: #0f172a;
  }
  .status-box-desc {
    font-size: 10px;
    color: #64748b;
    margin-top: 2px;
  }

  h2 {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    color: #0f766e;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 3px;
    margin: 12px 0 6px 0;
    letter-spacing: 0.3px;
  }

  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 14px;
    margin-bottom: 8px;
  }
  .field {
    margin-bottom: 2px;
  }
  .field-label {
    font-size: 9px;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
  }
  .field-value {
    font-size: 10.5px;
    color: #0f172a;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 4px;
    margin-bottom: 10px;
  }
  th {
    background: #f1f5f9;
    color: #475569;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    text-align: left;
    padding: 4px 6px;
    border: 1px solid #e2e8f0;
  }
  td {
    padding: 4px 6px;
    border: 1px solid #e2e8f0;
    font-size: 9.5px;
    vertical-align: middle;
  }
  tr:nth-child(even) td {
    background: #fafafa;
  }
  .text-center { text-align: center; }
  .muted { color: #94a3b8; font-style: italic; }

  .footer-sign {
    margin-top: 25px;
    border-top: 1px dashed #cbd5e1;
    padding-top: 15px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .sign-box {
    width: 250px;
    text-align: center;
  }
  .sign-line {
    border-bottom: 1px solid #334155;
    margin-bottom: 4px;
  }
  .sign-name {
    font-size: 10px;
    font-weight: 700;
  }
  .sign-role {
    font-size: 9px;
    color: #64748b;
  }
  .legal-note {
    font-size: 8.5px;
    color: #64748b;
    max-width: 450px;
  }

  @media screen {
    body {
      padding: 30px;
      max-width: 850px;
      margin: 0 auto;
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
      background: #fff;
    }
  }
</style>
</head>
<body>

  <!-- CABEÇALHO -->
  <div class="header">
    <div class="header-left">
      <h1>${escapeHtml(params.secretariaNome || "Secretaria Municipal de Saúde")}</h1>
      <p>Primus Gestão · Dossiê Administrativo e Cadastral de Fornecedor</p>
      <p>Instrução Processual de Contratações Públicas — Lei Federal nº 14.133/2021</p>
    </div>
    <div class="header-right">
      <div>Código de Controle:</div>
      <div class="code">${escapeHtml(codigoAutenticidade)}</div>
      <div>Emissão: ${escapeHtml(hoje)}</div>
    </div>
  </div>

  <!-- STATUS CONSOLIDADO 360 -->
  <div class="status-box">
    <div>
      <div class="status-box-title">Situação Operacional Consolidada: ${escapeHtml(statusMeta.label)}</div>
      <div class="status-box-desc">${escapeHtml(statusMeta.descricao)}</div>
    </div>
    <span class="badge ${params.statusConsolidado === "apto" ? "badge-success" : params.statusConsolidado === "inapto" ? "badge-danger" : "badge-warning"}">
      ${escapeHtml(statusMeta.label)}
    </span>
  </div>

  <!-- DADOS CADASTRAIS -->
  <h2>1. Identificação Cadastral do Fornecedor</h2>
  <div class="grid-2">
    <div class="field">
      <div class="field-label">Razão Social:</div>
      <div class="field-value"><strong>${escapeHtml(f.legal_name)}</strong></div>
    </div>
    <div class="field">
      <div class="field-label">Nome Fantasia:</div>
      <div class="field-value">${escapeHtml(f.trade_name || "—")}</div>
    </div>
    <div class="field">
      <div class="field-label">CNPJ:</div>
      <div class="field-value">${escapeHtml(formatarCnpj(f.cnpj))}</div>
    </div>
    <div class="field">
      <div class="field-label">Categoria / Ramo:</div>
      <div class="field-value">${escapeHtml(f.category || "Geral")}</div>
    </div>
    <div class="field">
      <div class="field-label">Endereço:</div>
      <div class="field-value">${escapeHtml(enderecoCompleto || "Não informado")}</div>
    </div>
    <div class="field">
      <div class="field-label">Contato:</div>
      <div class="field-value">${escapeHtml([f.phone, f.email, f.contact_name].filter(Boolean).join(" · ") || "—")}</div>
    </div>
  </div>

  <!-- VERIFICAÇÃO DE REGULARIDADE OFICIAL -->
  <h2>2. Consultas e Verificações em Órgãos Oficiais</h2>
  <table>
    <thead>
      <tr>
        <th>Fonte / Certidão</th>
        <th style="width: 110px;">Situação</th>
        <th style="width: 100px;">Validade</th>
        <th style="width: 100px;">Parecer</th>
      </tr>
    </thead>
    <tbody>
      ${linhasRegularidade}
    </tbody>
  </table>

  <!-- HOMOLOGAÇÃO E HABILITAÇÃO CADASTRAL -->
  <h2>3. Homologação e Habilitação na Secretaria</h2>
  <div class="grid-2">
    <div class="field">
      <div class="field-label">Status da Última Homologação:</div>
      <div class="field-value">
        ${
          params.ultimaHomologacao
            ? escapeHtml(rotuloStatusHomologacao(params.ultimaHomologacao.status as any))
            : "Nenhum processo formal de homologação iniciado"
        }
      </div>
    </div>
    <div class="field">
      <div class="field-label">Data da Conclusão:</div>
      <div class="field-value">
        ${
          params.ultimaHomologacao?.concluded_at
            ? escapeHtml(formatarData(params.ultimaHomologacao.concluded_at))
            : "—"
        }
      </div>
    </div>
  </div>

  <!-- DOCUMENTOS E CERTIDÕES COMPROBATÓRIAS -->
  <h2>4. Relação de Documentos e Certidões Cadastradas</h2>
  <table>
    <thead>
      <tr>
        <th>Título do Documento</th>
        <th style="width: 130px;">Tipo</th>
        <th style="width: 110px;">Validade</th>
        <th style="width: 90px;">Estado</th>
      </tr>
    </thead>
    <tbody>
      ${linhasDocumentos}
    </tbody>
  </table>

  <!-- SANÇÕES E IMPEDIMENTOS -->
  <h2>5. Sanções e Restrições Vigentes</h2>
  <table>
    <thead>
      <tr>
        <th>Medida Sancionatória</th>
        <th>Motivo / Justificativa</th>
        <th style="width: 140px;">Vigência</th>
        <th style="width: 80px;">Status</th>
      </tr>
    </thead>
    <tbody>
      ${linhasSancoes}
    </tbody>
  </table>

  <!-- HISTÓRICO CONTRATUAL NO MUNICÍPIO -->
  <h2>6. Histórico Contratual e Operacional no Município</h2>
  <div class="grid-2">
    <div class="field">
      <div class="field-label">Contratos e Atas Registrados:</div>
      <div class="field-value">${params.instrumentos.length} instrumento(s) formalizado(s)</div>
    </div>
    <div class="field">
      <div class="field-label">Cotações Vinculadas:</div>
      <div class="field-value">${params.cotacoesCount ?? 0} cotação(ões) de itens</div>
    </div>
  </div>

  <!-- TERMO DE FÉ PÚBLICA E ENCERRAMENTO -->
  <div class="footer-sign">
    <div class="legal-note">
      Certifico para os devidos fins de instrução processual que as informações constantes neste Dossiê
      foram consolidadas a partir dos registros oficiais da Secretaria Municipal de Saúde, em conformidade com a
      legislação de licitações e contratos vigentes (Lei nº 14.133/2021).
      <br><br>
      Autenticidade verificável eletronicamente pelo código <strong>${escapeHtml(codigoAutenticidade)}</strong>.
    </div>
    <div class="sign-box">
      <div class="sign-line"></div>
      <div class="sign-name">${escapeHtml(params.servidorNome || "Servidor / Autoridade Competente")}</div>
      <div class="sign-role">Comissão de Contratação / Fiscalização</div>
    </div>
  </div>

</body>
</html>`;
}

/**
 * Abre a janela de impressão do Dossiê Administrativo.
 */
export function imprimirDossieAdministrativo(params: DossieCompletoParams): boolean {
  if (typeof window === "undefined") return false;
  const printWindow = window.open("", "_blank");
  if (!printWindow) return false;

  printWindow.opener = null;
  printWindow.document.open();
  printWindow.document.write(gerarHtmlDossie(params));
  printWindow.document.close();

  window.setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 300);

  return true;
}
