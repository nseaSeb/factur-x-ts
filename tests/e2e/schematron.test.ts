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
    'accepts a well-formed EN 16931 invoice',
    async () => {
      // Previously failed here: the serializer wrote currencyID on
      // ram:*Amount elements the EN 16931 Schematron rejects it on (fixed —
      // see elAmount / elAmountWithCurrency in src/xml/serializer.ts).
      const xml = serialize(sampleInvoice(), 'EN 16931');
      const result = await validateSchematron(xml, { endpoint: SAXON_URL, timeoutMs: SAXON_TIMEOUT_MS });
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    },
    SAXON_TIMEOUT_MS,
  );

  it.runIf(SAXON_URL !== undefined)(
    'has no @currencyID violations against the EXTENDED Schematron',
    async () => {
      // The EXTENDED ruleset is a separate, larger XSL (44 @currencyID "not
      // used" contexts vs EN 16931's 22) — bundled but, before this test,
      // never actually run. Confirms the currencyID fix (verified against
      // EN 16931 above) holds there too.
      //
      // Not asserting valid: true / errors: [] here: EXTENDED's Schematron
      // also enforces BR-CO-25 (payment due date or terms required when the
      // amount due is positive), which the library doesn't support at all
      // (no BT-9/BT-20 mapping) — a real, separate, pre-existing gap outside
      // this fix's scope. See README § Limitations.
      const xml = serialize(sampleInvoice(), 'EXTENDED');
      const result = await validateSchematron(xml, { endpoint: SAXON_URL, timeoutMs: SAXON_TIMEOUT_MS });
      expect(result.errors.some((e) => e.test?.includes('currencyID'))).toBe(false);
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
