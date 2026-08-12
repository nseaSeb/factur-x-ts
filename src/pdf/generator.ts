// src/pdf/generator.ts
// PDF/A-3 Factur-X generator from a FacturXInvoice object.

import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFObject,
  PDFRef,
  PDFString,
  PDFHexString,
  AFRelationship,
  PageSizes,
} from 'pdf-lib';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { GenerateOptions } from '../types/index.js';
import type { Profile } from '../types/profiles.js';
import { serialize } from '../xml/serializer.js';
import { buildXmpMetadata } from './metadata.js';
import { isFacturXFilespec } from './filespec.js';
import { validateEn16931, type ValidationError } from '../profiles/en16931.js';

export class FacturXGenerateError extends Error {
  readonly validationErrors: readonly ValidationError[];

  constructor(message: string, validationErrors: readonly ValidationError[] = []) {
    super(message);
    this.name = 'FacturXGenerateError';
    this.validationErrors = validationErrors;
  }
}

const ICC_PROFILE_PATH = fileURLToPath(new URL('../../schemas/sRGB.icc', import.meta.url));
const OUTPUT_CONDITION_IDENTIFIER = 'sRGB IEC61966-2.1';

// Profiles where the XML *is* the primary content get AFRelationship=Data;
// profiles with a human-readable visual layout get AFRelationship=Alternative.
const DATA_RELATIONSHIP_PROFILES: readonly Profile[] = ['MINIMUM', 'BASIC WL'];

export async function generate(options: GenerateOptions): Promise<Uint8Array> {
  const { invoice, profile, visualPdf, validation: validationOptions } = options;

  if (profile === 'EN 16931') {
    const validation = validateEn16931(invoice, validationOptions);
    if (!validation.valid) {
      throw new FacturXGenerateError(
        `Invoice does not satisfy EN 16931 mandatory rules (${validation.errors.length} error(s))`,
        validation.errors,
      );
    }
  }

  const xml = serialize(invoice, profile);
  const xmlBytes = new TextEncoder().encode(xml);

  const pdfDoc = visualPdf ? await PDFDocument.load(visualPdf) : await createBlankTemplate();
  removeSupersededFacturXAttachments(pdfDoc);
  await ensureOutputIntent(pdfDoc);

  const now = new Date();
  const documentIdHex = randomBytes(16).toString('hex');
  const title = `Factur-X — ${invoice.number}`;

  pdfDoc.setProducer('factur-x-ts');
  pdfDoc.setCreator('factur-x-ts');
  pdfDoc.setTitle(title);
  pdfDoc.setCreationDate(now);
  pdfDoc.setModificationDate(now);

  await pdfDoc.attach(xmlBytes, 'factur-x.xml', {
    mimeType: 'text/xml',
    creationDate: now,
    modificationDate: now,
    afRelationship: DATA_RELATIONSHIP_PROFILES.includes(profile) ? AFRelationship.Data : AFRelationship.Alternative,
  });

  setXmpMetadata(
    pdfDoc,
    buildXmpMetadata({ conformanceLevel: profile, documentIdHex, title, creationDate: now }),
  );
  setDocumentId(pdfDoc, documentIdHex);

  // PDF/A-3b forbids cross-reference/object streams.
  return pdfDoc.save({ useObjectStreams: false });
}

async function createBlankTemplate(): Promise<PDFDocument> {
  const pdfDoc = await PDFDocument.create();
  // No text, no fonts: PDF/A-3b requires every font embedded, so the simplest
  // correct blank page draws nothing rather than referencing a standard font.
  pdfDoc.addPage(PageSizes.A4);
  return pdfDoc;
}

/**
 * Drops any Factur-X XML already attached to a loaded PDF.
 *
 * `PDFDocument.attach()` appends unconditionally: re-generating over a PDF that
 * is already a Factur-X invoice (the natural "reissue this invoice" flow) would
 * otherwise leave two /AF entries both named factur-x.xml. Readers take the
 * first match, so the *superseded* invoice would win and the corrected one would
 * be silently ignored.
 *
 * The filespec and its embedded stream are deleted from the context, not merely
 * unreferenced: pdf-lib does not collect unreachable objects, and an orphaned
 * file specification that no /AF entry points at fails PDF/A-3 clause 6.8 test 4
 * (`isAssociatedFile == true`) — so leaving it behind would both keep the old
 * invoice bytes recoverable and break conformance.
 *
 * Scope: catalog-level /AF plus a flat /Names/EmbeddedFiles name array, which is
 * what this library itself emits. Page-level /AF entries and /Kids-based name
 * trees from third-party producers are not traversed.
 */
function removeSupersededFacturXAttachments(pdfDoc: PDFDocument): void {
  const catalog = pdfDoc.catalog;
  const orphans = new Map<string, PDFRef>();

  const collectOrphans = (entry: PDFObject | undefined, spec: PDFDict): void => {
    if (entry instanceof PDFRef) orphans.set(entry.tag, entry);
    const streamRef = spec.lookupMaybe(PDFName.of('EF'), PDFDict)?.get(PDFName.of('F'));
    if (streamRef instanceof PDFRef) orphans.set(streamRef.tag, streamRef);
  };

  const af = catalog.lookupMaybe(PDFName.of('AF'), PDFArray);
  if (af) {
    // Iterate backwards: remove() shifts every later index down by one.
    for (let i = af.size() - 1; i >= 0; i--) {
      const spec = af.lookupMaybe(i, PDFDict);
      if (!spec || !isFacturXFilespec(spec)) continue;
      collectOrphans(af.get(i), spec);
      af.remove(i);
    }
  }

  // /Names/EmbeddedFiles/Names is a flat [name, filespec, name, filespec, ...] array.
  const nameArray = catalog
    .lookupMaybe(PDFName.of('Names'), PDFDict)
    ?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict)
    ?.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (nameArray) {
    for (let i = nameArray.size() - 2; i >= 0; i -= 2) {
      const spec = nameArray.lookupMaybe(i + 1, PDFDict);
      if (!spec || !isFacturXFilespec(spec)) continue;
      collectOrphans(nameArray.get(i + 1), spec);
      nameArray.remove(i + 1);
      nameArray.remove(i);
    }
  }

  for (const ref of orphans.values()) pdfDoc.context.delete(ref);
}

async function ensureOutputIntent(pdfDoc: PDFDocument): Promise<void> {
  if (pdfDoc.catalog.has(PDFName.of('OutputIntents'))) return;

  const iccBytes = await readFile(ICC_PROFILE_PATH);
  const iccStream = pdfDoc.context.flateStream(iccBytes, { N: 3, Alternate: 'DeviceRGB' });
  const iccStreamRef = pdfDoc.context.register(iccStream);

  const outputIntent = pdfDoc.context.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of(OUTPUT_CONDITION_IDENTIFIER),
    Info: PDFString.of(OUTPUT_CONDITION_IDENTIFIER),
    DestOutputProfile: iccStreamRef,
  });
  const outputIntentRef = pdfDoc.context.register(outputIntent);

  pdfDoc.catalog.set(PDFName.of('OutputIntents'), pdfDoc.context.obj([outputIntentRef]));
}

function setXmpMetadata(pdfDoc: PDFDocument, xmp: string): void {
  const xmpBytes = new TextEncoder().encode(xmp);
  // Uncompressed, per the PDF/A-3 requirement that /Metadata streams not use a filter.
  const stream = pdfDoc.context.stream(xmpBytes, { Type: 'Metadata', Subtype: 'XML' });

  // Overwrite the existing metadata object in place when regenerating. Registering
  // a fresh stream and re-pointing the catalog would orphan the previous XMP —
  // pdf-lib collects no unreachable objects, so the superseded invoice's title
  // would stay recoverable in the output bytes.
  const existing = pdfDoc.catalog.get(PDFName.of('Metadata'));
  if (existing instanceof PDFRef) {
    pdfDoc.context.assign(existing, stream);
    return;
  }

  pdfDoc.catalog.set(PDFName.of('Metadata'), pdfDoc.context.register(stream));
}

function setDocumentId(pdfDoc: PDFDocument, hex: string): void {
  const id = PDFHexString.of(hex);
  pdfDoc.context.trailerInfo.ID = pdfDoc.context.obj([id, id]);
}
