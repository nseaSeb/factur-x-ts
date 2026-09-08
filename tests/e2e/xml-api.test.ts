import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { generate, FacturXGenerateError } from '../../src/pdf/generator.js';
import { extract, parse } from '../../src/pdf/parser.js';
import { serialize } from '../../src/xml/serializer.js';
import { detectInvoiceNumber } from '../../src/xml/guideline.js';
import { FacturXProfileNotDetectedError } from '../../src/validate/shared.js';
import { expectedRoundTrip, sampleInvoice } from '../fixtures/invoice.js';

describe('generate from ready-made XML', () => {
  it('produces the same invoice as the model path once parsed back', async () => {
    const invoice = sampleInvoice();
    const xml = serialize(invoice, 'EN 16931');

    const pdfBytes = await generate({ xml });
    const result = await parse(pdfBytes);

    expect(result.invoice).toEqual(expectedRoundTrip(invoice));
    expect(result.metadata.conformanceLevel).toBe('EN 16931');
  });

  it('embeds a Uint8Array byte for byte, BOM included', async () => {
    // A BOM is the cheapest byte a re-encoding pass would silently drop: if
    // it survives, the attachment was never decoded and re-encoded.
    const text = serialize(sampleInvoice(), 'BASIC');
    const input = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);

    const pdfBytes = await generate({ xml: input });
    const { xml, profile, filename } = await extract(pdfBytes);

    expect(xml).toEqual(input);
    expect(profile).toBe('BASIC');
    expect(filename).toBe('factur-x.xml');
  });

  it('reads the conformance level off the guideline URN when no profile is given', async () => {
    const pdfBytes = await generate({ xml: serialize(sampleInvoice(), 'MINIMUM') });
    const { metadata } = await parse(pdfBytes);
    expect(metadata.conformanceLevel).toBe('MINIMUM');
  });

  it('titles the PDF after BT-1, read without deserializing', async () => {
    const pdfBytes = await generate({ xml: serialize(sampleInvoice(), 'EN 16931') });
    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getTitle()).toBe('Factur-X — INV-2026-001');
  });

  it('refuses a profile that contradicts the guideline URN', async () => {
    const xml = serialize(sampleInvoice(), 'MINIMUM');
    await expect(generate({ xml, profile: 'EN 16931' })).rejects.toBeInstanceOf(FacturXGenerateError);
  });

  it('refuses XML whose profile cannot be detected, rather than guessing one into the XMP', async () => {
    const xml = serialize(sampleInvoice(), 'EN 16931').replace('urn:cen.eu:en16931:2017', 'urn:example:unknown');
    await expect(generate({ xml })).rejects.toBeInstanceOf(FacturXProfileNotDetectedError);
    // An explicit profile is the way through, and is then trusted.
    await expect(generate({ xml, profile: 'EN 16931' })).resolves.toBeInstanceOf(Uint8Array);
  });

  it('refuses a DOCTYPE, like both validators do', async () => {
    const xml = '<!DOCTYPE foo>' + serialize(sampleInvoice(), 'EN 16931').replace(/^<\?xml[^>]*\?>/, '');
    await expect(generate({ xml })).rejects.toBeInstanceOf(FacturXGenerateError);
  });
});

describe('extract', () => {
  it('reads the attachment out of a PDF whose XMP packet parse refuses', async () => {
    // Strip /Metadata from a generated PDF: parse needs the fx:* packet and
    // must throw; extract only needs the attachment and must not.
    const pdfBytes = await generate({ invoice: sampleInvoice(), profile: 'EXTENDED' });
    const doc = await PDFDocument.load(pdfBytes);
    doc.catalog.delete(PDFName.of('Metadata'));
    const stripped = await doc.save({ useObjectStreams: false });

    await expect(parse(stripped)).rejects.toThrow(/Metadata/);

    const { xml, profile, filename } = await extract(stripped);
    expect(profile).toBe('EXTENDED');
    expect(filename).toBe('factur-x.xml');
    expect(new TextDecoder().decode(xml)).toContain('<rsm:CrossIndustryInvoice');
  });

  it('reports no profile, rather than a guessed one, for a guideline URN it does not know', async () => {
    const xml = serialize(sampleInvoice(), 'EN 16931').replace('urn:cen.eu:en16931:2017', 'urn:example:unknown');
    const pdfBytes = await generate({ xml, profile: 'EN 16931' });
    const result = await extract(pdfBytes);
    expect(result.profile).toBeUndefined();
  });
});

describe('detectInvoiceNumber', () => {
  it('reads BT-1 from rsm:ExchangedDocument/ram:ID', () => {
    expect(detectInvoiceNumber(serialize(sampleInvoice(), 'EN 16931'))).toBe('INV-2026-001');
  });

  it('is undefined for XML that is not a CII document', () => {
    expect(detectInvoiceNumber('<foo/>')).toBeUndefined();
    expect(detectInvoiceNumber('not xml at all <')).toBeUndefined();
  });
});
