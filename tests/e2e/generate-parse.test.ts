import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib';
import { generate, FacturXGenerateError } from '../../src/pdf/generator.js';
import { parse } from '../../src/pdf/parser.js';
import { sampleInvoice, expectedRoundTrip } from '../fixtures/invoice.js';

const VERAPDF_AVAILABLE = spawnSync('which', ['verapdf']).status === 0;

describe('generate -> parse round-trip', () => {
  it('reproduces the invoice and metadata for a generated blank-template PDF', async () => {
    const invoice = sampleInvoice();
    const pdfBytes = await generate({ invoice, profile: 'EN 16931' });

    const result = await parse(pdfBytes);

    expect(result.invoice).toEqual(expectedRoundTrip(invoice));
    expect(result.metadata).toEqual({
      documentType: 'INVOICE',
      documentFileName: 'factur-x.xml',
      version: '1.07',
      conformanceLevel: 'EN 16931',
    });
  });

  it('reproduces the invoice when a plain visual PDF is supplied', async () => {
    const visualDoc = await PDFDocument.create();
    visualDoc.addPage([595.28, 841.89]);
    const visualPdf = await visualDoc.save();

    const invoice = sampleInvoice();
    const pdfBytes = await generate({ invoice, profile: 'BASIC', visualPdf });
    const result = await parse(pdfBytes);

    // BG-6 (DefinedTradeContact) starts at EN 16931: BASIC's TradePartyType has
    // no such element, so the seller contact is not on the wire to read back.
    // Everything else survives.
    const { contact: _contact, ...sellerWithoutContact } = invoice.seller;
    expect(result.invoice).toEqual({ ...expectedRoundTrip(invoice), seller: sellerWithoutContact });
    expect(result.metadata.conformanceLevel).toBe('BASIC');
  });

  it('round-trips a MINIMUM document, which carries neither lines nor VAT breakdown', async () => {
    // The reduced profiles drop whole blocks, so the deserializer meets absent
    // ram:IncludedSupplyChainTradeLineItem and ram:ApplicableTradeTax paths —
    // a different case from the single-object-instead-of-array one.
    const pdfBytes = await generate({ invoice: sampleInvoice(), profile: 'MINIMUM' });
    const result = await parse(pdfBytes);

    expect(result.metadata.conformanceLevel).toBe('MINIMUM');
    expect(result.invoice.lines).toEqual([]);
    expect(result.invoice.taxBreakdown).toEqual([]);
    // BT-8 lives inside ram:ApplicableTradeTax, so it has nowhere to sit here.
    expect(result.invoice.taxDueDateTypeCode).toBeUndefined();
    // The four amounts MINIMUM does keep.
    expect(result.invoice.totals).toEqual({
      taxBasisTotal: '195.00',
      taxTotal: '39.00',
      grandTotal: '234.00',
      duePayable: '234.00',
    });
    expect(result.invoice.seller.name).toBe('Ma Société SARL');
    // BG-5 belongs to the seller alone in MINIMUM: the buyer has no address at
    // all on the wire, and none is invented on the way back.
    expect(result.invoice.buyer.address).toBeUndefined();
    expect(result.invoice.seller.address).toEqual({ country: 'FR' });
  });

  it('produces a PDF using no cross-reference/object streams', async () => {
    const pdfBytes = await generate({ invoice: sampleInvoice(), profile: 'EN 16931' });
    const text = new TextDecoder('latin1').decode(pdfBytes);
    expect(text).not.toContain('/Type /ObjStm');
  });

  it.runIf(VERAPDF_AVAILABLE)('validates as PDF/A-3b under veraPDF', async () => {
    const pdfBytes = await generate({ invoice: sampleInvoice(), profile: 'EN 16931' });
    const dir = await mkdtemp(join(tmpdir(), 'facturx-verapdf-'));
    const pdfPath = join(dir, 'invoice.pdf');
    await writeFile(pdfPath, pdfBytes);

    const result = spawnSync('verapdf', ['--flavour', '3b', '--format', 'text', pdfPath], { encoding: 'utf8' });
    expect(result.stdout).toContain('PASS');
  });
});

async function countFacturXAttachments(pdfBytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(pdfBytes);
  const af = doc.catalog.lookupMaybe(PDFName.of('AF'), PDFArray);
  if (!af) return 0;

  let count = 0;
  for (let i = 0; i < af.size(); i++) {
    const spec = af.lookupMaybe(i, PDFDict);
    const name = spec?.lookupMaybe(PDFName.of('F'), PDFString, PDFHexString)?.decodeText();
    if (name === 'factur-x.xml') count++;
  }
  return count;
}

/** Decoded contents of every embedded stream that holds a CII invoice, reachable or not. */
async function embeddedInvoiceXmls(pdfBytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(pdfBytes);
  const found: string[] = [];

  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    let text: string;
    try {
      text = new TextDecoder('utf-8').decode(decodePDFRawStream(obj).decode());
    } catch {
      continue; // Not a decodable stream — irrelevant here.
    }
    if (text.includes('CrossIndustryInvoice')) found.push(text);
  }
  return found;
}

describe('regenerating over an existing Factur-X PDF', () => {
  async function regenerate(): Promise<Uint8Array> {
    const original = await generate({ invoice: sampleInvoice(), profile: 'EN 16931' });
    const corrected = { ...sampleInvoice(), number: 'INV-2026-CORRECTED' };
    return generate({ invoice: corrected, profile: 'EN 16931', visualPdf: original });
  }

  it('returns the corrected invoice, not the superseded one', async () => {
    const result = await parse(await regenerate());
    expect(result.invoice.number).toBe('INV-2026-CORRECTED');
  });

  it('leaves exactly one factur-x.xml attachment', async () => {
    expect(await countFacturXAttachments(await regenerate())).toBe(1);
  });

  it('leaves exactly one embedded invoice XML, carrying the corrected invoice', async () => {
    // Counting /AF entries is not enough: an orphaned attachment is unreachable
    // from /AF yet still present in the file, since pdf-lib collects nothing.
    // Enumerating indirect objects is what catches it without veraPDF.
    const xmls = await embeddedInvoiceXmls(await regenerate());

    expect(xmls).toHaveLength(1);
    expect(xmls[0]).toContain('INV-2026-CORRECTED');
    expect(xmls[0]).not.toContain('INV-2026-001');
  });

  it('leaves no superseded XMP packet in the output bytes', async () => {
    // PDF/A forbids a filter on /Metadata, so a stale packet is greppable as-is.
    const text = new TextDecoder('latin1').decode(await regenerate());
    expect(text).not.toContain('INV-2026-001');
  });

  it.runIf(VERAPDF_AVAILABLE)('still validates as PDF/A-3b after regeneration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'facturx-verapdf-regen-'));
    const pdfPath = join(dir, 'invoice.pdf');
    await writeFile(pdfPath, await regenerate());

    const result = spawnSync('verapdf', ['--flavour', '3b', '--format', 'text', pdfPath], { encoding: 'utf8' });
    expect(result.stdout).toContain('PASS');
  });
});

describe('profile-structure validation', () => {
  it('refuses to write a BASIC WL document with no VAT breakdown, which its schema requires', async () => {
    const invoice = { ...sampleInvoice(), taxBreakdown: [] };
    const error = await generate({ invoice, profile: 'BASIC WL' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FacturXGenerateError);
    const codes = (error as FacturXGenerateError).validationErrors.map((e) => e.code);
    expect(codes).toContain('NO_TAX_BREAKDOWN');
    // The code-list rules run alongside: BT-8 lives inside the group that is
    // missing, so it is unemittable for the same reason.
    expect(codes).toContain('UNEMITTABLE_VAT_POINT_DATE');
  });

  it('refuses to write a BASIC WL document with no BT-106, which its schema requires', async () => {
    const invoice = sampleInvoice();
    const { lineTotal: _dropped, ...totals } = invoice.totals;
    await expect(generate({ invoice: { ...invoice, totals }, profile: 'BASIC WL' })).rejects.toMatchObject({
      validationErrors: [{ code: 'MISSING_FIELD', field: 'totals.lineTotal' }],
    });
  });

  it('refuses to write a BASIC document with no lines, which its schema requires', async () => {
    const invoice = { ...sampleInvoice(), lines: [] };
    await expect(generate({ invoice, profile: 'BASIC' })).rejects.toMatchObject({
      validationErrors: [{ code: 'NO_LINES', field: 'lines' }],
    });
  });

  it('refuses to re-issue a parsed MINIMUM document at BASIC WL', async () => {
    // The reachable path: MINIMUM carries neither BT-106 nor a VAT breakdown,
    // so what parse gives back cannot be re-generated at a profile whose
    // schema makes both mandatory. Silently writing an invalid PDF here is
    // exactly what the check exists to prevent.
    const minimum = await generate({ invoice: sampleInvoice(), profile: 'MINIMUM' });
    const { invoice } = await parse(minimum);

    await expect(generate({ invoice, profile: 'BASIC WL' })).rejects.toBeInstanceOf(FacturXGenerateError);
    // MINIMUM itself round-trips: its schema requires neither.
    await expect(generate({ invoice, profile: 'MINIMUM' })).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('code-list validation across profiles', () => {
  it('rejects an invalid BT-8 even on a reduced profile', async () => {
    // BT-8 is serialized whatever the profile, so the code-list check must run
    // whatever the profile — BASIC WL is an accepted French mandate profile.
    const invoice = { ...sampleInvoice(), taxDueDateTypeCode: '3' };

    await expect(generate({ invoice, profile: 'BASIC WL' })).rejects.toThrow(/INVALID|rules/);
  });

  it('does not apply EN 16931 mandatory-field rules to a reduced profile', async () => {
    // A missing VAT breakdown is an EN 16931 error, not a BASIC WL one.
    const invoice = { ...sampleInvoice(), taxDueDateTypeCode: undefined, taxBreakdown: [] };

    await expect(generate({ invoice, profile: 'MINIMUM' })).resolves.toBeInstanceOf(Uint8Array);
  });

  it('generates for EN 16931 with a country-only buyer address', async () => {
    // validateEn16931 only checks address.country, matching the Schematron's
    // own CountryID-only requirement — this exercises that path end-to-end,
    // not just serialize()/deserialize() directly.
    const base = sampleInvoice();
    const invoice = { ...base, buyer: { ...base.buyer, address: { country: base.buyer.address.country } } };

    await expect(generate({ invoice, profile: 'EN 16931' })).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('attachment filename encodings', () => {
  it('finds the attachment when /F is a hex string and /UF is absent', async () => {
    const pdfBytes = await generate({ invoice: sampleInvoice(), profile: 'EN 16931' });

    // Rewrite the filespec the way a hex-string-emitting producer would.
    const doc = await PDFDocument.load(pdfBytes);
    const af = doc.catalog.lookupMaybe(PDFName.of('AF'), PDFArray);
    const spec = af?.lookupMaybe(0, PDFDict);
    if (!spec) throw new Error('generated PDF has no /AF filespec to rewrite');
    spec.set(PDFName.of('F'), PDFHexString.fromText('factur-x.xml'));
    spec.delete(PDFName.of('UF'));
    const mutated = await doc.save({ useObjectStreams: false });

    const result = await parse(mutated);
    expect(result.invoice.number).toBe('INV-2026-001');
  });
});

describe('zugferd-invoice.xml as the attachment name', () => {
  it('accepts a PDF whose attachment and XMP both say zugferd-invoice.xml, not just factur-x.xml', async () => {
    // FACTURX_ATTACHMENT_NAMES accepts both names for the attachment itself
    // (filespec.ts) — the XMP gate must agree, not hardcode the other one.
    const pdfBytes = await generate({ invoice: sampleInvoice(), profile: 'EN 16931' });
    const doc = await PDFDocument.load(pdfBytes);

    const af = doc.catalog.lookupMaybe(PDFName.of('AF'), PDFArray);
    const spec = af?.lookupMaybe(0, PDFDict);
    if (!spec) throw new Error('generated PDF has no /AF filespec to rewrite');
    spec.set(PDFName.of('F'), PDFString.of('zugferd-invoice.xml'));
    spec.set(PDFName.of('UF'), PDFString.of('zugferd-invoice.xml'));

    const metadataRef = doc.catalog.get(PDFName.of('Metadata'));
    if (!metadataRef) throw new Error('generated PDF has no /Metadata stream to rewrite');
    const stream = doc.context.lookup(metadataRef) as PDFRawStream;
    const xmpText = new TextDecoder('utf-8').decode(decodePDFRawStream(stream).decode());
    const rewrittenXmp = xmpText.replace(
      '<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>',
      '<fx:DocumentFileName>zugferd-invoice.xml</fx:DocumentFileName>',
    );
    expect(rewrittenXmp).not.toBe(xmpText); // guards against the replace silently no-op'ing
    doc.context.assign(metadataRef, PDFRawStream.of(stream.dict, new TextEncoder().encode(rewrittenXmp)));

    const mutated = await doc.save({ useObjectStreams: false });
    const result = await parse(mutated);

    expect(result.metadata.documentFileName).toBe('zugferd-invoice.xml');
    expect(result.invoice.number).toBe('INV-2026-001');
  });
});

if (!VERAPDF_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn('veraPDF not found on PATH — skipping PDF/A-3b conformance check (round-trip fidelity still verified).');
}
