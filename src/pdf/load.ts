// src/pdf/load.ts
// Opening PDF bytes the caller handed us, and inspecting what we opened.
//
// Every PDF this library reads is untrusted input — a received invoice, a
// visual layout from some other tool — so a load failure is a statement about
// that input, never a bug: it is reported as a typed, coded error instead of
// whatever pdf-lib happened to throw.

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream, type PDFObject } from 'pdf-lib';

export type PdfLoadFailure = 'ENCRYPTED_PDF' | 'MALFORMED_PDF';

export async function loadPdf(
  bytes: Uint8Array,
  fail: (code: PdfLoadFailure, message: string, cause: unknown) => Error,
): Promise<PDFDocument> {
  let pdfDoc: PDFDocument;
  try {
    // ignoreEncryption: pdf-lib's own refusal is a plain Error (its
    // EncryptedPDFError fails `instanceof` once compiled), so the document is
    // opened and its `isEncrypted` flag checked instead — an explicit signal
    // rather than a message match. updateMetadata: false — reading a document
    // must not rewrite its Info dictionary; `generate` sets Producer/Creator.
    pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw fail('MALFORMED_PDF', `PDF could not be read: ${detail}`, cause);
  }
  if (pdfDoc.isEncrypted) {
    throw fail('ENCRYPTED_PDF', 'PDF is encrypted (/Encrypt in the trailer) — decrypt it upstream', undefined);
  }
  return pdfDoc;
}

/**
 * Names of the fonts the document uses without embedding them.
 *
 * PDF/A (every part, ISO 19005-3 §6.2.11.4.1 for part 3) requires every font
 * program to be embedded. `generate` declares its output PDF/A-3, so a visual
 * PDF referencing, say, pdf-lib's `StandardFonts.Helvetica` — which is never
 * embedded — would come out labelled PDF/A-3 while failing it, with nothing to
 * say so. This is the most common way a visual layout breaks conformance, and
 * the only one cheap enough to detect without a full PDF/A validator.
 *
 * Walks page resources and the resources of form XObjects they draw, since a
 * font used inside a form is used by the page. Type 3 fonts are exempt: their
 * glyphs are content streams, there is no font program to embed.
 */
export function unembeddedFonts(pdfDoc: PDFDocument): string[] {
  const missing = new Set<string>();
  const seen = new Set<PDFObject>();
  const context = pdfDoc.context;

  const resolve = (obj: PDFObject | undefined): PDFObject | undefined =>
    obj instanceof PDFRef ? context.lookup(obj) : obj;

  const asDict = (obj: PDFObject | undefined): PDFDict | undefined => {
    const resolved = resolve(obj);
    if (resolved instanceof PDFDict) return resolved;
    if (resolved instanceof PDFStream) return resolved.dict;
    return undefined;
  };

  const fontName = (font: PDFDict): string => {
    const base = font.get(PDFName.of('BaseFont'));
    return base instanceof PDFName ? base.decodeText() : '(unnamed font)';
  };

  const hasFontProgram = (descriptor: PDFDict | undefined): boolean =>
    descriptor !== undefined &&
    ['FontFile', 'FontFile2', 'FontFile3'].some((key) => descriptor.has(PDFName.of(key)));

  const checkFont = (font: PDFDict): void => {
    const subtype = font.get(PDFName.of('Subtype'));
    if (subtype === PDFName.of('Type3')) return;
    if (subtype === PDFName.of('Type0')) {
      const descendants = resolve(font.get(PDFName.of('DescendantFonts')));
      const descendant = descendants instanceof PDFArray ? asDict(descendants.get(0)) : undefined;
      if (!hasFontProgram(asDict(descendant?.get(PDFName.of('FontDescriptor'))))) missing.add(fontName(font));
      return;
    }
    if (!hasFontProgram(asDict(font.get(PDFName.of('FontDescriptor'))))) missing.add(fontName(font));
  };

  const walkResources = (resources: PDFDict | undefined): void => {
    if (resources === undefined || seen.has(resources)) return;
    seen.add(resources);

    const fonts = asDict(resources.get(PDFName.of('Font')));
    for (const [, value] of fonts?.entries() ?? []) {
      const font = asDict(value);
      if (font !== undefined) checkFont(font);
    }

    const xobjects = asDict(resources.get(PDFName.of('XObject')));
    for (const [, value] of xobjects?.entries() ?? []) {
      const xobject = asDict(value);
      if (xobject?.get(PDFName.of('Subtype')) === PDFName.of('Form')) {
        walkResources(asDict(xobject.get(PDFName.of('Resources'))));
      }
    }
  };

  for (const page of pdfDoc.getPages()) {
    // Resources may be inherited from the page tree; pdf-lib's `node.Resources()`
    // resolves the inherited value.
    walkResources(page.node.Resources());
  }

  return [...missing].sort();
}
