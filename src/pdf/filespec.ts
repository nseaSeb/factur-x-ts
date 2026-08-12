// src/pdf/filespec.ts
// Shared /Filespec handling for the Factur-X XML attachment.
//
// Both the generator (which strips a superseded attachment before writing a new
// one) and the parser (which locates the attachment to read) must agree on which
// filenames count as the invoice XML. Keeping the list and the name-decoding in
// one place is what stops those two answers from drifting apart.

import { PDFDict, PDFHexString, PDFName, PDFString } from 'pdf-lib';

/** Attachment names carrying a Factur-X / ZUGFeRD invoice XML. */
export const FACTURX_ATTACHMENT_NAMES: readonly string[] = ['factur-x.xml', 'zugferd-invoice.xml'];

/**
 * Filename of a /Filespec dictionary, or undefined if it carries none.
 *
 * /UF (Unicode) is preferred over /F per PDF 32000-1 §7.11.3. Either key may
 * hold a literal *or* a hex string, so the single-type `lookupMaybe` overload
 * is unusable here: it asserts the type and throws on a hex-string producer.
 * Decoding uses `decodeText()` rather than `asString()` — the latter returns the
 * raw hex digits for a PDFHexString, which would silently never match a name.
 */
export function filespecName(fileSpec: PDFDict | undefined): string | undefined {
  if (!fileSpec) return undefined;

  for (const key of ['UF', 'F'] as const) {
    const value = fileSpec.lookupMaybe(PDFName.of(key), PDFString, PDFHexString);
    if (value) return value.decodeText();
  }
  return undefined;
}

/** True when the /Filespec points at a Factur-X invoice XML. */
export function isFacturXFilespec(fileSpec: PDFDict | undefined): boolean {
  const name = filespecName(fileSpec);
  return name !== undefined && FACTURX_ATTACHMENT_NAMES.includes(name);
}
