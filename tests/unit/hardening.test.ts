// Untrusted-input hardening: what every reader refuses, and how it says so.

import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { deserialize, FacturXDeserializeError } from '../../src/xml/deserializer.js';
import { serialize, FacturXSerializeError } from '../../src/xml/serializer.js';
import { detectProfile, detectInvoiceNumber } from '../../src/xml/guideline.js';
import { generate, FacturXGenerateError } from '../../src/pdf/generator.js';
import { parse, extract, FacturXParseError } from '../../src/pdf/parser.js';
import type { Profile } from '../../src/types/profiles.js';
import { sampleInvoice } from '../fixtures/invoice.js';

const xml = (): string => serialize(sampleInvoice(), 'EN 16931');

function withGrandTotal(text: string): string {
  const out = xml().replace(/<ram:GrandTotalAmount>[^<]*</, `<ram:GrandTotalAmount>${text}<`);
  expect(out).toContain(`<ram:GrandTotalAmount>${text}<`);
  return out;
}

function withDoctype(doc: string): string {
  return doc.replace(/^(<\?xml[^>]*\?>)/, '$1<!DOCTYPE x [<!ENTITY a "EXPANDED">]>');
}

describe('deserialize refuses what Number() would silently accept', () => {
  it.each(['1e400', '1e2', '0x10', 'Infinity', 'NaN', '1,5', '', ' ', '1 000.00', '12.5.1'])(
    'refuses "%s" as an amount',
    (text) => {
      expect(() => deserialize(withGrandTotal(text))).toThrow(FacturXDeserializeError);
    },
  );

  it('refuses an amount longer than any real one', () => {
    expect(() => deserialize(withGrandTotal('1'.repeat(40)))).toThrow(/GrandTotalAmount/);
  });

  it.each([
    ['1234.50', '1234.50'],
    ['-3.20', '-3.20'],
    ['+7', '7'],
    ['.5', '0.5'],
    ['10.', '10'],
    ['007.10', '7.10'],
  ])('accepts the xsd:decimal form "%s", read back as the canonical "%s"', (text, canonical) => {
    expect(deserialize(withGrandTotal(text)).totals.grandTotal).toBe(canonical);
  });

  it('keeps every digit of an amount a float could not hold', () => {
    const big = '12345678901234567890.12';
    expect(Number(big).toFixed(2)).not.toBe(big);
    expect(deserialize(withGrandTotal(big)).totals.grandTotal).toBe(big);
  });

  it('refuses an optional amount that is present but unreadable, rather than dropping it', () => {
    const doc = xml().replace(/(<ram:TaxBasisTotalAmount>)/, '<ram:TotalPrepaidAmount>abc</ram:TotalPrepaidAmount>$1');
    expect(doc).toContain('TotalPrepaidAmount>abc');
    expect(() => deserialize(doc)).toThrow(/TotalPrepaidAmount/);
  });

  it.each(['20260230', '2026-02-01', '2026021', '20261301', 'abcdefgh'])('refuses the date "%s"', (date) => {
    const doc = xml().replace(/(<ram:IssueDateTime><udt:DateTimeString format="102">)\d{8}/, `$1${date}`);
    expect(doc).toContain(`format="102">${date}<`);
    expect(() => deserialize(doc)).toThrow(/Invalid date/);
  });
});

describe('DOCTYPE is refused wherever XML enters', () => {
  it('deserialize refuses it before any entity is expanded', () => {
    expect(() => deserialize(withDoctype(xml()))).toThrow(/DOCTYPE/);
  });

  it('the header sniffers report nothing rather than parse it', () => {
    const doc = withDoctype(xml());
    expect(detectProfile(xml())).toBe('EN 16931');
    expect(detectProfile(doc)).toBeUndefined();
    expect(detectInvoiceNumber(doc)).toBeUndefined();
  });

  it('parse refuses an XMP packet carrying one', async () => {
    const pdf = await PDFDocument.load(await generate({ invoice: sampleInvoice(), profile: 'EN 16931' }));
    const xmp = '<!DOCTYPE x [<!ENTITY a "b">]><x:xmpmeta xmlns:x="adobe:ns:meta/"/>';
    const stream = pdf.context.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
    pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(stream));
    const error = await parse(await pdf.save({ useObjectStreams: false })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FacturXParseError);
    expect((error as FacturXParseError).code).toBe('INVALID_XMP');
  });
});

async function encryptedPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const encrypt = pdf.context.obj({ Filter: 'Standard', V: 1, R: 2, O: '', U: '', P: -4 });
  pdf.context.trailerInfo.Encrypt = pdf.context.register(encrypt);
  return pdf.save({ useObjectStreams: false });
}

describe('PDF input errors are typed and coded', () => {
  it('reports an encrypted PDF as such, on both read paths', async () => {
    const bytes = await encryptedPdf();
    for (const read of [parse, extract]) {
      const error = await read(bytes).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(FacturXParseError);
      expect((error as FacturXParseError).code).toBe('ENCRYPTED_PDF');
    }
  });

  it('reports bytes that are not a PDF as MALFORMED_PDF', async () => {
    const error = await extract(new TextEncoder().encode('definitely not a pdf')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FacturXParseError);
    expect((error as FacturXParseError).code).toBe('MALFORMED_PDF');
  });

  it('reports a readable PDF with no invoice as NO_EMBEDDED_XML', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const error = await extract(await pdf.save()).catch((e: unknown) => e);
    expect((error as FacturXParseError).code).toBe('NO_EMBEDDED_XML');
  });

  it('refuses an encrypted visual PDF', async () => {
    const error = await generate({ invoice: sampleInvoice(), profile: 'EN 16931', visualPdf: await encryptedPdf() }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(FacturXGenerateError);
    expect((error as FacturXGenerateError).code).toBe('ENCRYPTED_PDF');
  });
});

describe('visual PDF fonts', () => {
  it('refuses a visual that uses a font it does not embed, naming it', async () => {
    const visual = await PDFDocument.create();
    const font = await visual.embedFont(StandardFonts.Helvetica);
    visual.addPage().drawText('Facture', { font });
    const error = await generate({ invoice: sampleInvoice(), profile: 'EN 16931', visualPdf: await visual.save() }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(FacturXGenerateError);
    expect((error as FacturXGenerateError).code).toBe('FONT_NOT_EMBEDDED');
    expect((error as Error).message).toContain('Helvetica');
  });

  it('finds the font inside a form XObject too', async () => {
    const visual = await PDFDocument.create();
    const font = await visual.embedFont(StandardFonts.Courier);
    const donor = await PDFDocument.create();
    donor.addPage().drawText('x', { font: await donor.embedFont(StandardFonts.Courier) });
    const [embedded] = await visual.embedPdf(await donor.save());
    if (!embedded) throw new Error('embedPdf returned no page');
    visual.addPage().drawPage(embedded);
    void font;
    const error = await generate({ invoice: sampleInvoice(), profile: 'EN 16931', visualPdf: await visual.save() }).catch(
      (e: unknown) => e,
    );
    expect((error as FacturXGenerateError).code).toBe('FONT_NOT_EMBEDDED');
  });

  it('accepts a visual with no text at all', async () => {
    const visual = await PDFDocument.create();
    visual.addPage();
    await expect(generate({ invoice: sampleInvoice(), profile: 'EN 16931', visualPdf: await visual.save() })).resolves.toBeInstanceOf(
      Uint8Array,
    );
  });
});

describe('serialize', () => {
  it('refuses an unknown profile with its own error, not a TypeError', () => {
    expect(() => serialize(sampleInvoice(), 'EN16931' as Profile)).toThrow(FacturXSerializeError);
  });
});
