export const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
export const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
export const XML_NS = "http://www.w3.org/XML/1998/namespace";

export class DocxEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocxEngineError";
  }
}

/** Parses XML and refuses malformed input instead of returning a partial tree. */
export function parseXml(xml: string, partName: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0 || !doc.documentElement) {
    throw new DocxEngineError(`O arquivo interno ${partName} contém XML inválido.`);
  }
  return doc;
}

export function serializeXml(doc: Document): string {
  const body = new XMLSerializer().serializeToString(doc);
  return body.startsWith("<?xml")
    ? body
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + body;
}

export function wEl(doc: Document, localName: string): Element {
  return doc.createElementNS(W_NS, "w:" + localName);
}

export function wChildren(parent: Element, localName: string): Element[] {
  return Array.from(parent.childNodes).filter(
    (n): n is Element =>
      n.nodeType === 1 && (n as Element).namespaceURI === W_NS && (n as Element).localName === localName,
  );
}

export function wFirst(parent: Element, localName: string): Element | null {
  return wChildren(parent, localName)[0] ?? null;
}

export function wDescendants(parent: Element | Document, localName: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS(W_NS, localName));
}

export function wAttr(el: Element | null, name: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(W_NS, name) ?? el.getAttribute("w:" + name);
}

/** Nearest ancestor with the given w: local name (excluding the element itself). */
export function wAncestor(el: Element, localName: string): Element | null {
  let cur = el.parentElement;
  while (cur) {
    if (cur.namespaceURI === W_NS && cur.localName === localName) return cur;
    cur = cur.parentElement;
  }
  return null;
}

export function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
