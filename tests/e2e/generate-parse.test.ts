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
import { generate } from '../../src/pdf/generator.js';
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

    expect(result.invoice).toEqual(expectedRoundTrip(invoice));
    expect(result.metadata.conformanceLevel).toBe('BASIC');
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

if (!VERAPDF_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn('veraPDF not found on PATH — skipping PDF/A-3b conformance check (round-trip fidelity still verified).');
}
