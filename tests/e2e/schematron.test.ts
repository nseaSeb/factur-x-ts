import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/xml/serializer.js';
import { computeTotals } from '../../src/totals.js';
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
    'accepts a well-formed invoice against the EXTENDED Schematron',
    async () => {
      // The EXTENDED ruleset is a separate, larger XSL (44 @currencyID "not
      // used" contexts vs EN 16931's 22) — bundled but, before this test,
      // never actually run. Also confirms BR-CO-25 (payment due date or terms
      // required when the amount due is positive): the sample invoice now
      // carries paymentTerms (BT-20), which SpecifiedTradePaymentTerms maps.
      const xml = serialize(sampleInvoice(), 'EXTENDED');
      const result = await validateSchematron(xml, { endpoint: SAXON_URL, timeoutMs: SAXON_TIMEOUT_MS });
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    },
    SAXON_TIMEOUT_MS,
  );

  it.runIf(SAXON_URL !== undefined)(
    'accepts an invoice whose arithmetic computeTotals derived',
    async () => {
      // The point of the exercise: BR-CO-10 to BR-CO-17 are Schematron rules
      // the XSD never sees, so the test that matters for `computeTotals` is a
      // document put in front of Saxon — not a unit test of its own output.
      // The figures are chosen so the 5.5% group lands off a cent boundary:
      // 33.33 x 3 = 99.99, and 99.99 at 5.5% is 5.49945, rounded to 5.50. The
      // allowance is deliberately in the *other* VAT group, so it cannot move
      // that basis and blunt the case.
      const { lines: _lines, taxBreakdown: _taxBreakdown, totals: _totals, ...header } = sampleInvoice();
      const result = computeTotals({
        ...header,
        lines: [
          { id: '1', name: 'Prestation', quantity: 3, unit: 'C62', netPrice: 33.33, vatCategory: 'S', vatRate: 5.5 },
          { id: '2', name: 'Livraison', quantity: 1, unit: 'C62', netPrice: 12.5, vatCategory: 'S', vatRate: 20 },
        ],
        allowances: [{ amount: 4.44, reason: 'Remise commerciale', vatCategory: 'S', vatRate: 20 }],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const xml = serialize(result.invoice, 'EN 16931');
      const report = await validateSchematron(xml, { endpoint: SAXON_URL, timeoutMs: SAXON_TIMEOUT_MS });
      expect(report.errors).toEqual([]);
      expect(report.valid).toBe(true);
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
