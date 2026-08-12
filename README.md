# factur-x-ts

TypeScript-native [Factur-X](https://fnfe-mpe.org/factur-x/) generator and parser. Produces PDF/A-3b invoices with an embedded EN 16931 CII XML attachment, and reads them back.

Strictly typed, no `any`. Two runtime dependencies: [`pdf-lib`](https://github.com/Hopding/pdf-lib) and [`fast-xml-parser`](https://github.com/NaturalIntelligence/fast-xml-parser).

> **Status: 0.1.0, pre-release.** Not published to npm yet. The EN 16931 profile is implemented and validated; the other four profiles are declared but not fully mapped. See [Limitations](#limitations) before using this for real invoicing.

## Install

```bash
npm install github:nseaSeb/factur-x-ts
```

Requires Node 20.11 or newer. The package is ESM-only.

## Generate an invoice

```ts
import { generate } from 'factur-x-ts';
import type { FacturXInvoice } from 'factur-x-ts';
import { writeFile } from 'node:fs/promises';

const invoice: FacturXInvoice = {
  number: 'INV-2026-001',
  issueDate: new Date(Date.UTC(2026, 7, 9)),
  currency: 'EUR',
  typeCode: '380', // commercial invoice
  seller: {
    name: 'Ma Société SARL',
    vatId: 'FR12345678901',
    address: { lineOne: '1 rue de la Paix', postcode: '75001', city: 'Paris', country: 'FR' },
  },
  buyer: {
    name: 'Client & Co',
    address: { lineOne: '2 avenue des Champs', postcode: '69000', city: 'Lyon', country: 'FR' },
  },
  lines: [
    {
      id: '1',
      name: 'Prestation de conseil',
      quantity: 2,
      unit: 'C62', // UN/ECE Rec 20
      netPrice: 100,
      lineTotal: 200,
      vatCategory: 'S',
      vatRate: 20,
    },
  ],
  taxBreakdown: [
    { type: 'VAT', category: 'S', rate: 20, basisAmount: 200, calculatedAmount: 40 },
  ],
  totals: {
    lineTotal: 200,
    taxBasisTotal: 200,
    taxTotal: 40,
    grandTotal: 240,
    duePayable: 240,
  },
};

const pdfBytes = await generate({ invoice, profile: 'EN 16931' });
await writeFile('invoice.pdf', pdfBytes);
```

With no `visualPdf`, a blank A4 page is generated as the visual carrier. To attach the XML to your own rendered invoice instead:

```ts
const pdfBytes = await generate({
  invoice,
  profile: 'EN 16931',
  visualPdf: await readFile('rendered-invoice.pdf'),
});
```

The source PDF should already be PDF/A-2b or PDF/A-3b. An sRGB output intent is added if one is missing, but nothing else about the input is corrected — notably, PDF/A-3b requires every font to be embedded.

Re-running `generate` over a PDF that is *already* a Factur-X invoice is supported: the superseded XML and its metadata are removed rather than appended to, so the result carries exactly one invoice.

## Parse an invoice

```ts
import { parse } from 'factur-x-ts';
import { readFile } from 'node:fs/promises';

const { invoice, metadata, rawXml } = await parse(await readFile('invoice.pdf'));

console.log(invoice.number);          // 'INV-2026-001'
console.log(invoice.totals.duePayable); // 240
console.log(metadata.conformanceLevel); // 'EN 16931'
```

`rawXml` is the undecoded attachment bytes, for callers that want to run their own Schematron or archive the original.

## API

| Export | Description |
| --- | --- |
| `generate(options)` | `Promise<Uint8Array>` — a PDF/A-3b invoice. Throws `FacturXGenerateError`. |
| `parse(buffer)` | `Promise<ParseResult>` — `{ invoice, metadata, rawXml }`. Throws `FacturXParseError`. |
| `Profile` | Const object of the five Factur-X conformance levels. |
| `FacturXInvoice` and friends | The invoice model. All fields `readonly`. |
| `ValidationError`, `ValidationResult` | Shapes returned by EN 16931 validation. |

`generate` validates before it writes when `profile` is `'EN 16931'`. On failure it throws `FacturXGenerateError`, whose `validationErrors` array carries a `code`, the offending `field` path, and a message naming the business rule:

```ts
import { FacturXGenerateError } from 'factur-x-ts';

try {
  await generate({ invoice, profile: 'EN 16931' });
} catch (error) {
  if (error instanceof FacturXGenerateError) {
    for (const e of error.validationErrors) {
      console.error(`${e.field}: ${e.message}`); // 'totals.grandTotal: grandTotal must equal taxBasisTotal + taxTotal (BR-CO-15)'
    }
  }
}
```

## Allowances and charges

Two levels exist and they are not interchangeable:

- **Document level** — `invoice.allowances` / `invoice.charges` (BG-20 / BG-21). Their sums are `totals.allowanceTotal` (BT-107) and `totals.chargeTotal` (BT-108), and they move `taxBasisTotal` away from `lineTotal`.
- **Line level** — `line.allowances` / `line.charges` (BG-27 / BG-28). These are already folded into that line's own `lineTotal` and must **not** appear in the header totals.

Declaring a non-zero `allowanceTotal` with no document-level allowance behind it is rejected at validation, because a receiver's Schematron rejects it too (BR-CO-11).

## Profiles

| Profile | Status |
| --- | --- |
| `EN 16931` | Implemented, validated, veraPDF-checked |
| `BASIC` | Serializes with the correct guideline URN; no profile-specific rule set |
| `EXTENDED` | Serializes with the correct guideline URN; no profile-specific rule set |
| `BASIC WL` | Guideline URN only; reduced-profile field rules not implemented |
| `MINIMUM` | Guideline URN only; reduced-profile field rules not implemented |

Only `EN 16931` runs mandatory-rule validation before generating. The others serialize whatever you hand them.

## Limitations

Known and unaddressed, from a review of the library:

- The XMP conformance gate in the parser rejects `zugferd-invoice.xml` even though attachment extraction accepts it, and the `1.07` version check is exact string equality.
- Unit prices (BT-146) are serialized at 2 decimals, so `quantity × netPrice` stops reconciling with `lineTotal` for prices carrying more precision.
- The deserializer does not guard `Number()` for quantity, VAT rate, calculation percent or breakdown rate — a continental `1,5` becomes `NaN` without an error.
- BR-CO-17 (`calculatedAmount ≈ basisAmount × rate / 100`) is not enforced, and line-level allowances are never reconciled against the line total.
- Amount comparisons use a fixed 0.02 absolute tolerance, which is looser than the exact comparison strict validators apply.
- Address fields are required unconditionally, which contradicts the reduced profiles the parser accepts.
- `xmlEscape` handles the five XML entities but does not strip C0 control characters.

No Schematron or XSD validation runs in this library. Validate against the official EN 16931 artefacts before sending invoices to a real recipient.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run lint        # eslint, type-aware on src
npm run build       # tsc -> dist/
```

The end-to-end suite checks PDF/A-3b conformance with [veraPDF](https://verapdf.org/) when the `verapdf` binary is on `PATH`; those tests skip with a warning when it is not, and the rest of the suite still verifies round-trip fidelity and attachment hygiene without it.

## Licence

MIT — see [LICENSE](LICENSE).
