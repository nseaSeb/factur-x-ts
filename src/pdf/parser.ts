// src/pdf/parser.ts
// XML CII extract from PDF/A-3 Factur-X.

import { type PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { XMLParser } from 'fast-xml-parser';
import type { ExtractResult, ParseResult } from '../types/index.js';
import { Profile, type FacturXMetadata } from '../types/profiles.js';
import { deserialize } from '../xml/deserializer.js';
import { detectProfile } from '../xml/guideline.js';
import { hasDoctype, stripBom } from '../xml/hygiene.js';
import { loadPdf } from './load.js';
import {
  FACTURX_ATTACHMENT_NAMES,
  filespecName,
  isFacturXAttachmentName,
  type FacturXAttachmentName,
} from './filespec.js';

/**
 * Why a PDF could not be read as a Factur-X invoice.
 *
 * - `ENCRYPTED_PDF` — the file is encrypted; its attachment is unreadable, which
 *   is not the same as absent.
 * - `MALFORMED_PDF` — not a PDF this library can open, or a stream in it cannot
 *   be decoded.
 * - `NO_EMBEDDED_XML` — a readable PDF with no Factur-X attachment.
 * - `INVALID_XMP` — `parse` only: the XMP packet is missing, refused (DOCTYPE),
 *   or does not describe a Factur-X 1.07 invoice.
 */
export type FacturXParseErrorCode = 'ENCRYPTED_PDF' | 'MALFORMED_PDF' | 'NO_EMBEDDED_XML' | 'INVALID_XMP';

export class FacturXParseError extends Error {
  readonly code: FacturXParseErrorCode;

  constructor(message: string, code: FacturXParseErrorCode, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FacturXParseError';
    this.code = code;
  }
}

const loadFailure = (code: FacturXParseErrorCode, message: string, cause: unknown): Error =>
  new FacturXParseError(message, code, { cause });

export async function parse(buffer: Uint8Array): Promise<ParseResult> {
  const pdfDoc = await loadPdf(buffer, loadFailure);

  const { bytes: rawXml } = extractEmbeddedXml(pdfDoc);
  const xml = new TextDecoder('utf-8').decode(rawXml);
  const invoice = deserialize(xml);
  const metadata = extractXmpMetadata(pdfDoc);

  return { invoice, metadata, rawXml };
}

/**
 * Read the embedded invoice XML out of a PDF, and nothing more.
 *
 * Deliberately more permissive than `parse`: it never opens the XMP packet
 * and never runs the deserializer, so it works on a PDF whose metadata is
 * missing or malformed, and on a document this library's model cannot
 * express — reading cannot damage the document, so there is no reason to be
 * strict about it. The profile comes from the XML's own guideline URN.
 */
export async function extract(buffer: Uint8Array): Promise<ExtractResult> {
  const pdfDoc = await loadPdf(buffer, loadFailure);
  const { bytes, name } = extractEmbeddedXml(pdfDoc);
  const profile = detectProfile(stripBom(new TextDecoder('utf-8').decode(bytes)));
  return { xml: bytes, filename: name, profile };
}

interface EmbeddedXml {
  readonly bytes: Uint8Array;
  readonly name: FacturXAttachmentName;
}

function extractEmbeddedXml(pdfDoc: PDFDocument): EmbeddedXml {
  const catalog = pdfDoc.catalog;

  // 1. Récupérer le tableau /AF (Associated Files)
  const af = catalog.lookupMaybe(PDFName.of('AF'), PDFArray);
  if (!af) {
    throw new FacturXParseError('No /AF array found in PDF catalog — not a Factur-X PDF', 'NO_EMBEDDED_XML');
  }

  // 2. Parcourir les file specs pour trouver factur-x.xml
  for (let i = 0; i < af.size(); i++) {
    const fileSpec = af.lookupMaybe(i, PDFDict);

    const name = filespecName(fileSpec);
    if (isFacturXAttachmentName(name)) {
      const ef = fileSpec?.lookupMaybe(PDFName.of('EF'), PDFDict);
      if (!ef) continue;

      const embeddedFileRef = ef.lookup(PDFName.of('F'));
      if (!embeddedFileRef) continue;

      return { bytes: decodeStream(pdfDoc.context.lookup(embeddedFileRef), `embedded file ${name}`), name };
    }
  }

  throw new FacturXParseError(`No ${FACTURX_ATTACHMENT_NAMES.join(' or ')} attachment found`, 'NO_EMBEDDED_XML');
}

function decodeStream(obj: unknown, what: string): Uint8Array {
  if (!(obj instanceof PDFRawStream)) {
    throw new FacturXParseError(`The ${what} is not a stream`, 'MALFORMED_PDF');
  }
  try {
    return decodePDFRawStream(obj).decode();
  } catch (cause) {
    throw new FacturXParseError(`The ${what} could not be decoded`, 'MALFORMED_PDF', { cause });
  }
}

// ---- XMP metadata (Factur-X extension schema) ----

interface ParsedXmpDescription {
  readonly '@_DocumentType'?: string;
  readonly '@_DocumentFileName'?: string;
  readonly '@_Version'?: string;
  readonly '@_ConformanceLevel'?: string;
  readonly DocumentType?: string;
  readonly DocumentFileName?: string;
  readonly Version?: string;
  readonly ConformanceLevel?: string;
}

interface ParsedXmpRoot {
  readonly xmpmeta?: {
    readonly RDF?: {
      readonly Description?: readonly ParsedXmpDescription[];
    };
  };
}

function extractXmpMetadata(pdfDoc: PDFDocument): FacturXMetadata {
  const metadataRef = pdfDoc.catalog.get(PDFName.of('Metadata'));
  if (!metadataRef) {
    throw new FacturXParseError('No /Metadata stream found in PDF catalog', 'INVALID_XMP');
  }
  const xmpXml = stripBom(new TextDecoder('utf-8').decode(decodeStream(pdfDoc.context.lookup(metadataRef), 'XMP metadata')));
  if (hasDoctype(xmpXml)) {
    throw new FacturXParseError('XMP packet carries a DOCTYPE declaration, which is refused (XXE / entity expansion)', 'INVALID_XMP');
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
    ignoreDeclaration: true,
    isArray: (tagName) => tagName === 'Description',
  });

  let root: ParsedXmpRoot;
  try {
    root = parser.parse(xmpXml) as ParsedXmpRoot;
  } catch (cause) {
    throw new FacturXParseError('XMP packet is not well-formed XML', 'INVALID_XMP', { cause });
  }
  const descriptions = root.xmpmeta?.RDF?.Description ?? [];

  const documentType = firstDefined(descriptions.map((d) => d['@_DocumentType'] ?? d.DocumentType));
  const documentFileName = firstDefined(descriptions.map((d) => d['@_DocumentFileName'] ?? d.DocumentFileName));
  const version = firstDefined(descriptions.map((d) => d['@_Version'] ?? d.Version));
  const conformanceLevel = firstDefined(descriptions.map((d) => d['@_ConformanceLevel'] ?? d.ConformanceLevel));

  if (documentType !== 'INVOICE') {
    throw new FacturXParseError(`Unexpected fx:DocumentType: ${documentType ?? '(missing)'}`, 'INVALID_XMP');
  }
  // Was an exact match against 'factur-x.xml' alone — rejected a PDF whose
  // attachment (and this same XMP field) legitimately says
  // zugferd-invoice.xml instead, even though extractEmbeddedXml above just
  // accepted that same PDF via the same FACTURX_ATTACHMENT_NAMES list.
  if (!isFacturXAttachmentName(documentFileName)) {
    throw new FacturXParseError(
      `Unexpected fx:DocumentFileName: ${documentFileName ?? '(missing)'} (expected one of ${FACTURX_ATTACHMENT_NAMES.join(' or ')})`,
      'INVALID_XMP',
    );
  }
  if (version !== '1.07') {
    throw new FacturXParseError(`Unexpected fx:Version: ${version ?? '(missing)'}`, 'INVALID_XMP');
  }
  if (conformanceLevel === undefined || !isProfile(conformanceLevel)) {
    throw new FacturXParseError(`Unexpected fx:ConformanceLevel: ${conformanceLevel ?? '(missing)'}`, 'INVALID_XMP');
  }

  return {
    documentType: 'INVOICE',
    documentFileName,
    version: '1.07',
    conformanceLevel,
  };
}

function firstDefined(values: readonly (string | undefined)[]): string | undefined {
  return values.find((value) => value !== undefined);
}

function isProfile(value: string): value is Profile {
  return (Object.values(Profile) as readonly string[]).includes(value);
}
