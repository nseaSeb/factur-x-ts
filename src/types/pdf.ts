// src/types/pdf.ts
// PDF types.

import type { FacturXAttachmentName } from '../pdf/filespec.js';
import type { FacturXMetadata, Profile } from './profiles.js';
import type { FacturXInvoice, ParsedInvoice } from './invoice.js';
import type { ValidationOptions } from './validation.js';

export interface ParseResult {
  /** Amounts, quantities and rates as canonical decimal strings. */
  readonly invoice: ParsedInvoice;
  readonly metadata: FacturXMetadata;
  readonly rawXml: Uint8Array;
}

/**
 * What `extract` reads out of a PDF: the attachment as it is, and what the
 * XML says about itself. Nothing here needs the XMP packet or the
 * deserializer, so it is available for documents `parse` refuses.
 */
export interface ExtractResult {
  /** The attachment bytes, undecoded and verbatim. */
  readonly xml: Uint8Array;
  /** Whichever accepted name the PDF actually carries. */
  readonly filename: FacturXAttachmentName;
  /** Read from the XML's own guideline URN — undefined if it carries none this library knows. */
  readonly profile: Profile | undefined;
}

/** Build the PDF from an invoice model: validated, then serialized. */
export interface GenerateFromInvoiceOptions {
  readonly invoice: FacturXInvoice;
  readonly profile: Profile;
  readonly xml?: never;
  /** PDF visuel source (PDF/A-2b ou A-3b). Si absent, un template minimal est généré. */
  readonly visualPdf?: Uint8Array;
  /**
   * Réglage de la validation EN 16931, appliquée avant écriture pour le profil
   * `EN 16931`. Voir `ValidationOptions` — activer `validateFrenchRules`
   * pour le socle réglementaire français.
   */
  readonly validation?: ValidationOptions;
}

/**
 * Build the PDF from ready-made CII XML, embedded as given.
 *
 * No business validation runs — the document is the caller's, and this path
 * exists precisely for XML the model cannot express (a third-party document
 * being re-issued, a national extension). `validateXsd` and
 * `validateSchematron` are there to check it first.
 */
export interface GenerateFromXmlOptions {
  /** A `Uint8Array` is embedded byte for byte; a string is encoded as UTF-8. */
  readonly xml: string | Uint8Array;
  /**
   * The conformance level to declare. Read from the XML's guideline URN when
   * omitted; when given, it must agree with that URN — a PDF whose XMP and
   * XML disagree about the profile is refused rather than written.
   */
  readonly profile?: Profile;
  readonly visualPdf?: Uint8Array;
  readonly invoice?: never;
  // Not merely absent: a union member is lenient about the other member's
  // keys in an object literal, so without this `generate({ xml, validation })`
  // would compile and the option would be silently ignored.
  readonly validation?: never;
}

export type GenerateOptions = GenerateFromInvoiceOptions | GenerateFromXmlOptions;
