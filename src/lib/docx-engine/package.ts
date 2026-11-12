import JSZip from "jszip";
import { DocxEngineError, parseXml, wAttr, wDescendants, W_NS } from "./xml";
import { listPlaceholders, paragraphPlainText } from "./placeholders";

export const MAX_DOCX_BYTES = 5 * 1024 * 1024;
const MAX_PART_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED = 40 * 1024 * 1024;
const MAIN_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

export const STORY_PART = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

export type DocxWarning = { code: string; message: string };

export type DocxAnalysis = {
  placeholders: string[];
  storyParts: string[];
  hasOwnHeader: boolean;
  hasOwnFooter: boolean;
  tableCount: number;
  warnings: DocxWarning[];
};

function toBytes(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

/** Opens a DOCX package, rejecting oversized, macro-enabled, encrypted or malformed files. */
export async function openDocx(input: ArrayBuffer | Uint8Array): Promise<JSZip> {
  const bytes = toBytes(input);
  if (bytes.byteLength < 22 || bytes.byteLength > MAX_DOCX_BYTES) {
    throw new DocxEngineError("O arquivo Word deve ter no máximo 5 MB e não pode estar vazio.");
  }
  // OLE compound file = encrypted/legacy .doc
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new DocxEngineError(
      "O arquivo está protegido por senha ou é um .doc antigo. Salve como .docx sem senha.",
    );
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new DocxEngineError("O arquivo não é um documento Word (.docx) válido.");
  }
  let total = 0;
  for (const file of Object.values(zip.files)) {
    // JSZip exposes uncompressed size through internal data; guard via async read below.
    if (file.name.includes("..") || file.name.startsWith("/")) {
      throw new DocxEngineError("O documento Word contém caminhos internos inválidos.");
    }
  }
  const ct = zip.file("[Content_Types].xml");
  const main = zip.file("word/document.xml");
  if (!ct || !main) {
    throw new DocxEngineError("O arquivo não contém a estrutura de um documento Word (.docx).");
  }
  const ctXml = await ct.async("string");
  if (!ctXml.includes(MAIN_CT)) {
    throw new DocxEngineError(
      "Somente documentos .docx comuns são aceitos (modelos com macros ou outros formatos não).",
    );
  }
  if (zip.file("word/vbaProject.bin")) {
    throw new DocxEngineError("Documentos com macros não são aceitos.");
  }
  for (const name of Object.keys(zip.files)) {
    if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
    const text = await zip.file(name)!.async("string");
    total += text.length;
    if (text.length > MAX_PART_BYTES || total > MAX_TOTAL_UNCOMPRESSED) {
      throw new DocxEngineError("O conteúdo interno do Word ultrapassa o limite de segurança.");
    }
  }
  return zip;
}

export function storyPartNames(zip: JSZip): string[] {
  return Object.keys(zip.files)
    .filter((n) => STORY_PART.test(n))
    .sort((a, b) =>
      a === "word/document.xml" ? -1 : b === "word/document.xml" ? 1 : a.localeCompare(b),
    );
}

export async function analyzeDocx(input: ArrayBuffer | Uint8Array | JSZip): Promise<DocxAnalysis> {
  const zip = input instanceof JSZip ? input : await openDocx(input);
  const parts = storyPartNames(zip);
  const keys = new Set<string>();
  const warnings: DocxWarning[] = [];
  const warn = (code: string, message: string) => {
    if (!warnings.some((w) => w.code === code)) warnings.push({ code, message });
  };
  let tableCount = 0;
  for (const name of parts) {
    const doc = parseXml(await zip.file(name)!.async("string"), name);
    for (const p of wDescendants(doc, "p")) {
      for (const k of listPlaceholders(paragraphPlainText(p))) keys.add(k);
    }
    if (name === "word/document.xml") tableCount = wDescendants(doc, "tbl").length;
    if (wDescendants(doc, "txbxContent").length)
      warn("textbox", "Caixas de texto: campos são preenchidos no Word, mas não aparecem no PDF.");
    if (wDescendants(doc, "tc").some((cell) => wDescendants(cell, "tbl").length > 0))
      warn(
        "nested-table",
        "Tabelas dentro de células são preservadas no Word, mas não são reproduzidas fielmente no PDF.",
      );
    if (
      wDescendants(doc, "sectPr").some((section) =>
        [
          ...wDescendants(section, "headerReference"),
          ...wDescendants(section, "footerReference"),
        ].some((reference) => {
          const type = wAttr(reference, "type");
          return type !== null && type !== "default";
        }),
      )
    )
      warn(
        "header-variants",
        "Cabeçalhos ou rodapés de primeira página/páginas pares não são reproduzidos fielmente no PDF.",
      );
    if (
      wDescendants(doc, "tblStyle").length ||
      wDescendants(doc, "tblBorders").length ||
      wDescendants(doc, "shd").length
    )
      warn(
        "table-formatting",
        "O PDF mantém o conteúdo e a grade das tabelas, mas pode simplificar estilos, cores e bordas personalizadas.",
      );
    if (wDescendants(doc, "color").length || wDescendants(doc, "rFonts").length)
      warn(
        "text-formatting",
        "O PDF pode substituir fontes e cores de texto personalizadas; esses recursos permanecem no Word.",
      );
    if (wDescendants(doc, "drawing").length || wDescendants(doc, "pict").length)
      warn("images", "Imagens do modelo são mantidas no Word, mas não são reproduzidas no PDF.");
    if (wDescendants(doc, "object").length || wDescendants(doc, "altChunk").length)
      warn("embedded", "Objetos incorporados são mantidos no Word, mas não aparecem no PDF.");
    if (wDescendants(doc, "ins").length || wDescendants(doc, "del").length)
      warn(
        "revisions",
        "O modelo tem alterações controladas pendentes; aceite-as no Word antes de importar.",
      );
    for (const instr of wDescendants(doc, "instrText")) {
      if ((instr.textContent ?? "").includes("{{"))
        warn("field-code", "Campos dentro de códigos de campo do Word não são substituídos.");
    }
    if (wDescendants(doc, "numPr").length && name === "word/document.xml")
      warn(
        "numbering",
        "Listas numeradas são mantidas no Word; no PDF aparecem como parágrafos com recuo.",
      );
    if (doc.getElementsByTagNameNS(W_NS, "sectPr").length > 1 && name === "word/document.xml")
      warn("sections", "O modelo tem várias seções; o PDF usa as margens do timbrado para todas.");
  }
  return {
    placeholders: [...keys],
    storyParts: parts,
    hasOwnHeader: parts.some((p) => /header\d*\.xml$/.test(p)),
    hasOwnFooter: parts.some((p) => /footer\d*\.xml$/.test(p)),
    tableCount,
    warnings,
  };
}

/** Base64 helpers that work in browsers and jsdom without Node Buffer. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
