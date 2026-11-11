import { W_NS, XML_NS, wAncestor, wDescendants, wEl, wFirst } from "./xml";

export const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)?)\s*\}\}/g;

export type Replacement = {
  /** Text to insert. Line breaks become Word line breaks. */
  text: string;
  /** Highlights the inserted text so pending fields are visible in Word. */
  pending?: boolean;
};

export type Resolver = (key: string) => Replacement;

/** Text nodes (w:t) that belong directly to the paragraph, in reading order. */
function paragraphTextNodes(paragraph: Element): Element[] {
  return wDescendants(paragraph, "t").filter((t) => wAncestor(t, "p") === paragraph);
}

export function paragraphPlainText(paragraph: Element): string {
  return paragraphTextNodes(paragraph)
    .map((t) => t.textContent ?? "")
    .join("");
}

export function listPlaceholders(text: string): string[] {
  const keys: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER_PATTERN)) if (m[1]) keys.push(m[1].toLowerCase());
  return keys;
}

function setText(t: Element, value: string): void {
  t.textContent = value;
  t.setAttributeNS(XML_NS, "xml:space", "preserve");
}

/**
 * Builds runs for a replacement, cloning the formatting (w:rPr) of the run where the
 * placeholder started. Returns null when the source run holds more than one content
 * child and can't be split safely; callers then fall back to in-place text.
 */
function buildReplacementRuns(sourceRun: Element, replacement: Replacement): Element[] {
  const doc = sourceRun.ownerDocument;
  const run = wEl(doc, "r");
  const rPr = wFirst(sourceRun, "rPr");
  const newRPr = rPr ? (rPr.cloneNode(true) as Element) : wEl(doc, "rPr");
  if (replacement.pending) {
    for (const old of Array.from(newRPr.childNodes)) {
      if ((old as Element).localName === "highlight") newRPr.removeChild(old);
    }
    const hl = wEl(doc, "highlight");
    hl.setAttributeNS(W_NS, "w:val", "yellow");
    newRPr.appendChild(hl);
  }
  if (newRPr.childNodes.length > 0) run.appendChild(newRPr);
  const lines = replacement.text.replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((line, i) => {
    if (i > 0) run.appendChild(wEl(doc, "br"));
    const t = wEl(doc, "t");
    setText(t, line);
    run.appendChild(t);
  });
  return [run];
}

function isSplittableRun(run: Element): boolean {
  const content = Array.from(run.childNodes).filter(
    (n) => n.nodeType === 1 && (n as Element).localName !== "rPr",
  );
  return content.length === 1 && (content[0] as Element).localName === "t";
}

/**
 * Replaces every {{placeholder}} in a paragraph, including placeholders whose
 * characters are split across several runs (common after Word spell-check or
 * partial formatting). Formatting of the run where the placeholder starts is kept.
 * Returns the keys replaced, in order.
 */
export function replaceInParagraph(paragraph: Element, resolve: Resolver): string[] {
  const nodes = paragraphTextNodes(paragraph);
  if (nodes.length === 0) return [];
  const texts = nodes.map((t) => t.textContent ?? "");
  const full = texts.join("");
  const matches = [...full.matchAll(PLACEHOLDER_PATTERN)];
  if (matches.length === 0) return [];

  // char index -> node index / offset
  const starts: number[] = [];
  let acc = 0;
  for (const t of texts) {
    starts.push(acc);
    acc += t.length;
  }
  const locate = (index: number, preferEnd: boolean) => {
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const s = starts[i]!;
      const len = texts[i]!.length;
      if (preferEnd ? index > s && index <= s + len : index >= s && index < s + len) {
        return { node: i, offset: index - s };
      }
    }
    return { node: nodes.length - 1, offset: texts[nodes.length - 1]!.length };
  };

  const keys: string[] = [];
  // Right-to-left so earlier offsets stay valid.
  for (const m of matches.reverse()) {
    const key = m[1]!.toLowerCase();
    keys.unshift(key);
    const begin = locate(m.index!, false);
    const end = locate(m.index! + m[0].length, true);
    const replacement = resolve(key);

    const startNode = nodes[begin.node]!;
    const startText = texts[begin.node]!;
    const before = startText.slice(0, begin.offset);
    const after = begin.node === end.node ? startText.slice(end.offset) : "";

    for (let i = begin.node + 1; i < end.node; i += 1) {
      texts[i] = "";
      setText(nodes[i]!, "");
    }
    if (end.node !== begin.node) {
      texts[end.node] = texts[end.node]!.slice(end.offset);
      setText(nodes[end.node]!, texts[end.node]!);
    }

    const run = startNode.parentElement;
    const needsSplit = replacement.pending || replacement.text.includes("\n");
    if (run && run.localName === "r" && needsSplit && isSplittableRun(run)) {
      const parent = run.parentNode!;
      const afterRun = run.cloneNode(true) as Element;
      setText(wFirst(afterRun, "t")!, after);
      setText(startNode, before);
      texts[begin.node] = before;
      const newRuns = buildReplacementRuns(run, replacement);
      const next = run.nextSibling;
      for (const r of newRuns) parent.insertBefore(r, next);
      if (after) parent.insertBefore(afterRun, next);
    } else {
      const inline = replacement.text.replace(/\r\n?|\n/g, " ");
      texts[begin.node] = before + inline + after;
      setText(startNode, texts[begin.node]!);
    }
  }
  return keys;
}
