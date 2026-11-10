import { describe, expect, it } from "vitest";
import { extractDocxDocumentXml, extractWordDocumentText } from "./docx-import";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function createStoredZip(fileName: string, content: string, flags = 0): ArrayBuffer {
  const encoder = new TextEncoder();
  const name = encoder.encode(fileName);
  const data = encoder.encode(content);
  const localLength = 30 + name.length + data.length;
  const centralLength = 46 + name.length;
  const archive = new Uint8Array(localLength + centralLength + 22);
  const view = new DataView(archive.buffer);

  view.setUint32(0, 0x04034b50, true);
  view.setUint16(6, flags, true);
  view.setUint16(8, 0, true);
  view.setUint32(18, data.length, true);
  view.setUint32(22, data.length, true);
  view.setUint16(26, name.length, true);
  archive.set(name, 30);
  archive.set(data, 30 + name.length);

  const centralOffset = localLength;
  view.setUint32(centralOffset, 0x02014b50, true);
  view.setUint16(centralOffset + 8, flags, true);
  view.setUint16(centralOffset + 10, 0, true);
  view.setUint32(centralOffset + 20, data.length, true);
  view.setUint32(centralOffset + 24, data.length, true);
  view.setUint16(centralOffset + 28, name.length, true);
  view.setUint32(centralOffset + 42, 0, true);
  archive.set(name, centralOffset + 46);

  const endOffset = centralOffset + centralLength;
  view.setUint32(endOffset, 0x06054b50, true);
  view.setUint16(endOffset + 8, 1, true);
  view.setUint16(endOffset + 10, 1, true);
  view.setUint32(endOffset + 12, centralLength, true);
  view.setUint32(endOffset + 16, centralOffset, true);
  return archive.buffer;
}

const wordXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="${WORD_NS}">
  <w:body>
    <w:p><w:r><w:t>TERMO DE REFERÊNCIA</w:t></w:r></w:p>
    <w:p><w:r><w:t>Fornecedor: {{fornecedor}}</w:t><w:tab/><w:t>CNPJ: {{cnpj}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Primeira linha</w:t><w:br/><w:t>Segunda linha</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Quantidade</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Material hospitalar</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>10</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:p><w:del><w:r><w:delText>Texto excluído</w:delText></w:r></w:del><w:r><w:t>Texto vigente</w:t></w:r></w:p>
  </w:body>
</w:document>`;

describe("importação segura de modelos DOCX", () => {
  it("extrai texto, parágrafos, tabulações e tabelas simples", () => {
    expect(extractWordDocumentText(wordXml)).toBe(
      [
        "TERMO DE REFERÊNCIA",
        "Fornecedor: {{fornecedor}}\tCNPJ: {{cnpj}}",
        "Primeira linha\nSegunda linha",
        "Item\tQuantidade\nMaterial hospitalar\t10",
        "Texto vigente",
      ].join("\n"),
    );
  });

  it("lê word/document.xml de um arquivo DOCX armazenado sem compressão", async () => {
    const archive = createStoredZip("word/document.xml", wordXml);
    await expect(extractDocxDocumentXml(archive)).resolves.toBe(wordXml);
  });

  it("usa o descompactador para entradas DEFLATE", async () => {
    const compressedPlaceholder = new Uint8Array([1, 2, 3]);
    const archive = createStoredZip("word/document.xml", wordXml);
    const bytes = new Uint8Array(archive);
    const view = new DataView(archive);
    const nameLength = view.getUint16(26, true);
    const dataOffset = 30 + nameLength;
    const centralOffset = dataOffset + new TextEncoder().encode(wordXml).length;
    // Simulate a DEFLATE entry and inject an inflater so this test is deterministic.
    view.setUint16(8, 8, true);
    view.setUint32(18, compressedPlaceholder.length, true);
    view.setUint32(22, new TextEncoder().encode(wordXml).length, true);
    view.setUint16(centralOffset + 10, 8, true);
    view.setUint32(centralOffset + 20, compressedPlaceholder.length, true);
    view.setUint32(centralOffset + 24, new TextEncoder().encode(wordXml).length, true);
    bytes.set(compressedPlaceholder, dataOffset);

    await expect(
      extractDocxDocumentXml(archive, async () => new TextEncoder().encode(wordXml)),
    ).resolves.toBe(wordXml);
  });

  it("rejeita arquivo sem o documento principal e arquivo criptografado", async () => {
    const missingDocument = createStoredZip("word/styles.xml", "<w:styles/>");
    await expect(extractDocxDocumentXml(missingDocument)).rejects.toThrow(
      "não contém o documento principal",
    );

    const encrypted = createStoredZip("word/document.xml", wordXml, 0x0001);
    await expect(extractDocxDocumentXml(encrypted)).rejects.toThrow("criptografia");
  });

  it("rejeita XML Word inválido e documento sem texto", () => {
    expect(() => extractWordDocumentText("<w:document><w:body></w:document>")).toThrow(
      "XML inválido",
    );
    const empty = `<w:document xmlns:w="${WORD_NS}"><w:body/></w:document>`;
    expect(() => extractWordDocumentText(empty)).toThrow("não contém texto");
  });
});
