const MAX_DOCX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_DOCX_XML_BYTES = 2 * 1024 * 1024;
const MAX_TEMPLATE_TEXT_LENGTH = 50_000;
const WORD_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type InflateRaw = (bytes: Uint8Array) => Promise<Uint8Array>;

function readUint16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) {
    throw new Error("O arquivo DOCX está incompleto ou corrompido.");
  }
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) {
    throw new Error("O arquivo DOCX está incompleto ou corrompido.");
  }
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimumOffset = Math.max(0, view.byteLength - 22 - 65_535);
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (readUint32(view, offset) === ZIP_EOCD_SIGNATURE) {
      const commentLength = readUint16(view, offset + 20);
      if (offset + 22 + commentLength === view.byteLength) return offset;
    }
  }
  throw new Error("O arquivo não contém uma estrutura ZIP válida de documento Word.");
}

function decodeWordXml(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("O documento Word contém texto em uma codificação inválida.");
  }
}

async function decompressDeflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "Este navegador não oferece suporte à leitura de DOCX. Atualize o navegador ou salve o modelo como TXT.",
    );
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const stableBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(stableBuffer).set(bytes);
    const compressed = new Blob([stableBuffer]).stream();
    const decompressed = compressed.pipeThrough(
      new DecompressionStream("deflate-raw" as CompressionFormat),
    );
    reader = decompressed.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_DOCX_XML_BYTES) {
        await reader.cancel();
        throw new Error("O conteúdo interno do DOCX ultrapassa o limite de segurança.");
      }
      chunks.push(value);
    }

    const result = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes("limite de segurança")) throw cause;
    throw new Error(
      "Não foi possível descompactar o documento Word. O arquivo pode estar corrompido.",
    );
  } finally {
    reader?.releaseLock();
  }
}

/**
 * Reads only word/document.xml from a DOCX ZIP container. It rejects encrypted,
 * oversized, unsupported and malformed archives before parsing any XML.
 * The optional inflater is exposed to keep the ZIP parser deterministic in tests.
 */
export async function extractDocxDocumentXml(
  archive: ArrayBuffer,
  inflateRaw: InflateRaw = decompressDeflateRaw,
): Promise<string> {
  if (archive.byteLength < 22 || archive.byteLength > MAX_DOCX_FILE_BYTES) {
    throw new Error("O arquivo Word deve ter no máximo 5 MB e não pode estar vazio.");
  }

  const bytes = new Uint8Array(archive);
  const view = new DataView(archive);
  const endOffset = findEndOfCentralDirectory(view);
  const diskNumber = readUint16(view, endOffset + 4);
  const centralDisk = readUint16(view, endOffset + 6);
  const entriesOnDisk = readUint16(view, endOffset + 8);
  const entryCount = readUint16(view, endOffset + 10);
  const centralSize = readUint32(view, endOffset + 12);
  const centralOffset = readUint32(view, endOffset + 16);

  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralOffset === 0xffffffff ||
    centralSize === 0xffffffff ||
    centralOffset + centralSize > endOffset
  ) {
    throw new Error("O documento Word usa uma estrutura ZIP não suportada.");
  }

  let cursor = centralOffset;
  let documentEntry:
    | {
        flags: number;
        method: number;
        crc: number;
        compressedSize: number;
        uncompressedSize: number;
        localOffset: number;
      }
    | undefined;

  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(view, cursor) !== ZIP_CENTRAL_SIGNATURE || cursor + 46 > view.byteLength) {
      throw new Error("A lista interna de arquivos do DOCX está corrompida.");
    }

    const flags = readUint16(view, cursor + 8);
    const method = readUint16(view, cursor + 10);
    const crc = readUint32(view, cursor + 16);
    const compressedSize = readUint32(view, cursor + 20);
    const uncompressedSize = readUint32(view, cursor + 24);
    const fileNameLength = readUint16(view, cursor + 28);
    const extraLength = readUint16(view, cursor + 30);
    const commentLength = readUint16(view, cursor + 32);
    const localOffset = readUint32(view, cursor + 42);
    const nameStart = cursor + 46;
    const entryEnd = nameStart + fileNameLength + extraLength + commentLength;

    if (entryEnd > centralOffset + centralSize || entryEnd > view.byteLength) {
      throw new Error("A lista interna de arquivos do DOCX está incompleta.");
    }

    const fileName = new TextDecoder("utf-8").decode(
      bytes.subarray(nameStart, nameStart + fileNameLength),
    );
    if (fileName === "word/document.xml") {
      if (documentEntry) {
        throw new Error("O documento Word contém mais de um arquivo principal.");
      }
      documentEntry = { flags, method, crc, compressedSize, uncompressedSize, localOffset };
    }

    cursor = entryEnd;
  }

  if (!documentEntry) {
    throw new Error("O arquivo DOCX não contém o documento principal do Word.");
  }
  if ((documentEntry.flags & 0x0001) !== 0 || (documentEntry.flags & 0x0040) !== 0) {
    throw new Error("Documentos Word protegidos por criptografia não podem ser importados.");
  }
  if (documentEntry.uncompressedSize > MAX_DOCX_XML_BYTES) {
    throw new Error("O documento Word contém uma estrutura interna maior que o limite permitido.");
  }
  if (![0, 8].includes(documentEntry.method)) {
    throw new Error("O documento Word usa um método de compactação não suportado.");
  }

  const localOffset = documentEntry.localOffset;
  if (readUint32(view, localOffset) !== ZIP_LOCAL_SIGNATURE || localOffset + 30 > view.byteLength) {
    throw new Error("O conteúdo principal do DOCX está corrompido.");
  }
  const localFlags = readUint16(view, localOffset + 6);
  const localMethod = readUint16(view, localOffset + 8);
  const localCrc = readUint32(view, localOffset + 14);
  const localCompressedSize = readUint32(view, localOffset + 18);
  const localUncompressedSize = readUint32(view, localOffset + 22);
  const localNameLength = readUint16(view, localOffset + 26);
  const localExtraLength = readUint16(view, localOffset + 28);
  const localName = new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength),
  );
  const dataStart = localOffset + 30 + localNameLength + localExtraLength;
  const dataEnd = dataStart + documentEntry.compressedSize;
  if (
    localName !== "word/document.xml" ||
    localFlags !== documentEntry.flags ||
    localMethod !== documentEntry.method
  ) {
    throw new Error("O cabeçalho local do documento Word não corresponde ao índice ZIP.");
  }
  if (
    dataStart < localOffset ||
    dataEnd > centralOffset ||
    dataEnd < dataStart ||
    (localFlags & 0x0008) === 0 &&
      (localCrc !== documentEntry.crc ||
        localCompressedSize !== documentEntry.compressedSize ||
        localUncompressedSize !== documentEntry.uncompressedSize)
  ) {
    throw new Error("O conteúdo principal do DOCX está incompleto ou inconsistente.");
  }

  const compressedBytes = bytes.slice(dataStart, dataEnd);
  const xmlBytes = documentEntry.method === 0 ? compressedBytes : await inflateRaw(compressedBytes);
  if (xmlBytes.byteLength !== documentEntry.uncompressedSize) {
    throw new Error("O tamanho do conteúdo Word não corresponde ao arquivo.");
  }
  if (crc32(xmlBytes) !== documentEntry.crc) {
    throw new Error("A integridade do conteúdo Word não pôde ser confirmada (CRC inválido).");
  }
  return decodeWordXml(xmlBytes);
}

function textFromWordNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as Element;
  switch (element.localName) {
    case "del":
    case "instrText":
    case "delText":
      return "";
    case "tab":
      return "\t";
    case "br":
    case "cr":
      return "\n";
    case "noBreakHyphen":
      return "‑";
    case "softHyphen":
      return "\u00ad";
    default:
      return Array.from(element.childNodes, textFromWordNode).join("");
  }
}

function paragraphText(paragraph: Element): string {
  return textFromWordNode(paragraph).replaceAll(String.fromCharCode(0), "").replace(/\r\n?/g, "\n");
}

/**
 * Converts WordprocessingML into plain text for the existing template editor.
 * Paragraphs and simple table rows/cells are preserved; visual styles, images,
 * headers, footers, comments and embedded objects are intentionally not imported.
 */
export function extractWordDocumentText(xml: string): string {
  if (xml.length > MAX_DOCX_XML_BYTES) {
    throw new Error("O conteúdo interno do DOCX ultrapassa o limite de segurança.");
  }

  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  if (parsed.getElementsByTagName("parsererror").length > 0) {
    throw new Error("O documento Word contém XML inválido.");
  }

  const body = parsed.getElementsByTagNameNS(WORD_NAMESPACE, "body").item(0);
  if (!body) {
    throw new Error("Não foi possível localizar o conteúdo principal do documento Word.");
  }

  const blocks: string[] = [];
  for (const child of Array.from(body.children)) {
    if (child.localName === "p") {
      blocks.push(paragraphText(child));
      continue;
    }
    if (child.localName === "tbl") {
      const rows = Array.from(child.getElementsByTagNameNS(WORD_NAMESPACE, "tr")).map((row) =>
        Array.from(row.getElementsByTagNameNS(WORD_NAMESPACE, "tc"))
          .map((cell) =>
            Array.from(cell.getElementsByTagNameNS(WORD_NAMESPACE, "p"))
              .map(paragraphText)
              .join("\n"),
          )
          .join("\t"),
      );
      if (rows.length > 0) blocks.push(rows.join("\n"));
    }
  }

  const text = blocks.join("\n").replace(/\r\n?/g, "\n").trim();
  if (!text) throw new Error("O documento Word não contém texto para importar.");
  if (text.length > MAX_TEMPLATE_TEXT_LENGTH) {
    throw new Error("O texto extraído ultrapassa o limite de 50.000 caracteres do modelo.");
  }
  return text;
}

/** Imports TXT/Markdown as-is or extracts plain text from a DOCX document. */
export async function importarTextoDeModelo(file: File): Promise<string> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["txt", "md", "docx"].includes(extension)) {
    throw new Error("Formato não permitido. Use TXT, MD ou DOCX.");
  }

  if (extension === "docx") {
    const xml = await extractDocxDocumentXml(await file.arrayBuffer());
    return extractWordDocumentText(xml);
  }

  if (file.size > MAX_TEMPLATE_TEXT_LENGTH) {
    throw new Error("O arquivo de texto ultrapassa o limite de 50 KB.");
  }
  const text = await file.text();
  if (!text.trim()) throw new Error("O arquivo não contém texto para importar.");
  return text;
}
