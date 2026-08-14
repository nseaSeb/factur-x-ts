import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/xml/serializer.js';
import { validateSchematron } from '../../src/validate/schematron.js';
import { sampleInvoice } from '../fixtures/invoice.js';

// Opt-in: requires a running Saxon server (docker compose -f docker/compose.yml
// up -d --build), since the EN 16931 Schematron is XSLT 2.0 and Node can't run
// it in-process. Mirrors the Elixir sibling's
// `FACTURX_SAXON_URL=... mix test --include saxon` gate.
const SAXON_URL = process.env['FACTURX_SAXON_URL'];

describe('validateSchematron against a live Saxon server', () => {
  // Saxon compiles the ~640 KB EN 16931 XSLT per request, and the upstream
  // image is amd64-only so it runs emulated on arm64 hosts — a single
  // validation can take on the order of a minute there.
  const SAXON_TIMEOUT_MS = 60_000;

  it.runIf(SAXON_URL !== undefined)(
    'flags the known @currencyID defect on an otherwise well-formed EN 16931 invoice',
    async () => {
      // KNOWN DEFECT (see README § Limitations): the serializer writes
      // currencyID on ram:*Amount elements the EN 16931 Schematron rejects it
      // on — a business-rule restriction, not an XSD one (validateXsd accepts
      // the same XML). This pins the current, wrong-but-understood behaviour
      // rather than asserting valid: true, which would be false. Fixing the
      // serializer should turn this into a plain "accepts a well-formed
      // invoice" test.
      const xml = serialize(sampleInvoice(), 'EN 16931');
      const result = await validateSchematron(xml, { endpoint: SAXON_URL, timeoutMs: SAXON_TIMEOUT_MS });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.every((e) => e.test === '@currencyID')).toBe(true);
    },
    SAXON_TIMEOUT_MS,
  );

  it.runIf(SAXON_URL !== undefined)(
    'rejects an invoice whose VAT breakdown does not cover a line category/rate',
    async () => {
      const invoice = sampleInvoice();
      const invalid = { ...invoice, taxBreakdown: [{ ...invoice.taxBreakdown[0]!, rate: 10 }] };
      const xml = serialize(invalid, 'EN 16931');
      const result = await validateSchematron(xml, { endpoint: SAXON_URL, timeoutMs: SAXON_TIMEOUT_MS });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    },
    SAXON_TIMEOUT_MS,
  );
});

if (SAXON_URL === undefined) {
  // eslint-disable-next-line no-console
  console.warn(
    'FACTURX_SAXON_URL not set — skipping Schematron validation checks against a live Saxon server. ' +
      'Run `docker compose -f docker/compose.yml up -d --build` and set FACTURX_SAXON_URL=http://localhost:5000/transform.',
  );
}
