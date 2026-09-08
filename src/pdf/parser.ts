// src/pdf/parser.ts
// XML CII extract from PDF/A-3 Factur-X.

import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { XMLParser } from 'fast-xml-parser';
import type { ExtractResult, ParseResult } from '../types/index.js';
import { Profile, type FacturXMetadata } from '../types/profiles.js';
import { deserialize } from '../xml/deserializer.js';
import { detectProfile } from '../xml/guideline.js';
import { stripBom } from '../validate/shared.js';
import {
  FACTURX_ATTACHMENT_NAMES,
  filespecName,
  isFacturXAttachmentName,
  type FacturXAttachmentName,
} from './filespec.js';

export class FacturXParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FacturXParseError';
  }
}

export async function parse(buffer: Uint8Array): Promise<ParseResult> {
  const pdfDoc = await PDFDocument.load(buffer);

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
  const pdfDoc = await PDFDocument.load(buffer);
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
    throw new FacturXParseError('No /AF array found in PDF catalog — not a Factur-X PDF');
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

      const stream = pdfDoc.context.lookup(embeddedFileRef) as PDFRawStream;
      return { bytes: decodePDFRawStream(stream).decode(), name };
    }
  }

  throw new FacturXParseError(`No ${FACTURX_ATTACHMENT_NAMES.join(' or ')} attachment found`);
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
    throw new FacturXParseError('No /Metadata stream found in PDF catalog');
  }
  const stream = pdfDoc.context.lookup(metadataRef) as PDFRawStream;
  const xmpXml = new TextDecoder('utf-8').decode(decodePDFRawStream(stream).decode());

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

  const root = parser.parse(xmpXml) as ParsedXmpRoot;
  const descriptions = root.xmpmeta?.RDF?.Description ?? [];

  const documentType = firstDefined(descriptions.map((d) => d['@_DocumentType'] ?? d.DocumentType));
  const documentFileName = firstDefined(descriptions.map((d) => d['@_DocumentFileName'] ?? d.DocumentFileName));
  const version = firstDefined(descriptions.map((d) => d['@_Version'] ?? d.Version));
  const conformanceLevel = firstDefined(descriptions.map((d) => d['@_ConformanceLevel'] ?? d.ConformanceLevel));

  if (documentType !== 'INVOICE') {
    throw new FacturXParseError(`Unexpected fx:DocumentType: ${documentType ?? '(missing)'}`);
  }
  // Was an exact match against 'factur-x.xml' alone — rejected a PDF whose
  // attachment (and this same XMP field) legitimately says
  // zugferd-invoice.xml instead, even though extractEmbeddedXml above just
  // accepted that same PDF via the same FACTURX_ATTACHMENT_NAMES list.
  if (!isFacturXAttachmentName(documentFileName)) {
    throw new FacturXParseError(
      `Unexpected fx:DocumentFileName: ${documentFileName ?? '(missing)'} (expected one of ${FACTURX_ATTACHMENT_NAMES.join(' or ')})`,
    );
  }
  if (version !== '1.07') {
    throw new FacturXParseError(`Unexpected fx:Version: ${version ?? '(missing)'}`);
  }
  if (conformanceLevel === undefined || !isProfile(conformanceLevel)) {
    throw new FacturXParseError(`Unexpected fx:ConformanceLevel: ${conformanceLevel ?? '(missing)'}`);
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
