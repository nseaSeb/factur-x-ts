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
| `validateEn16931(invoice, options?)` | `ValidationResult` — run the rules without generating a PDF. |
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

## French e-invoicing reform

No separate schema or profile is needed for the French mandate. Verified against the DGFiP *spécifications externes B2B* v3.2: the requirement reduces to two business terms already present in the EN 16931 CII vocabulary, and both are `minOccurs="0"` in the standard XSD.

| Term | Field | CII path |
| --- | --- | --- |
| **BT-23** cadre de facturation | `invoice.businessProcess` | `ExchangedDocumentContext/BusinessProcessSpecifiedDocumentContextParameter/ID` |
| **BT-8** exigibilité TVA | `invoice.taxDueDateTypeCode` | `ApplicableHeaderTradeSettlement/ApplicableTradeTax/DueDateTypeCode` |

The PPF control profile (`Base` / `Full`) is a **separate axis** from the Factur-X profile: it is carried by the transmitted filename prefix (rule S1.06), not by BT-24. The widely-cited URN `…extended-ctc-fr` does not exist in the specifications. Naming the transmitted file is the caller's responsibility — this library produces a document, not a flux.

```ts
await generate({
  invoice,
  profile: 'EN 16931',
  validation: { validateBusinessProcess: true }, // French rules G1.02, G1.60, S1.13
});
```

Two validation switches, with deliberately different defaults:

| Option | Default | Why |
| --- | --- | --- |
| `validateVatPointDate` | **on** | BT-8 is restricted by EN 16931 itself (BR-CL-06) to `5` / `29` / `72`, so the check is universally correct. |
| `validateBusinessProcess` | **off** | BT-23 values are *not* restricted by EN 16931 — Peppol uses `urn:fdc:peppol.eu:…`, Chorus Pro uses `A1`/`A2`. Applying the French closed list universally would lock out non-French callers and break round-tripping of third-party documents. |

Both stay switchable: "invalid" does not mean "must never be serializable", and the *extract → parse → correct → generate* pipeline over a received invoice is a central use case.

These two checks run on **every** profile, not just `EN 16931`: BT-8 and BT-23 are serialized whatever the profile, and the French mandate accepts reduced profiles. The full EN 16931 mandatory-field set stays limited to `profile: 'EN 16931'`, since the reduced profiles legitimately omit fields it requires.

Exported code tables: `BUSINESS_PROCESS_CODES` (the 13 G1.02 codes) and `VAT_POINT_DATE_CODES`.

> The codes `3` / `35` / `432` are frequently quoted for BT-8 but belong to UNTDID **2005**, which is the **UBL** subset. In CII they pass the XSD — `qdt:TimeReferenceCodeType` is an unenumerated `xs:token` — and are then rejected by the Schematron, hence by the platform. `validateVatPointDate` catches them immediately.

### BT-8 is normalised, not preserved verbatim

BT-8 lives inside each `ram:ApplicableTradeTax`, but French rule S1.13 requires one value per document, so `taxDueDateTypeCode` is a document-level field copied onto every entry when serializing. On parsing, a **uniform** code is lifted back to the document level; **divergent** codes are kept per entry with no document-level field.

`parse(generate(invoice))` therefore reproduces `invoice` exactly for the two canonical shapes — a document-level code with no per-entry override, or no BT-8 at all — and rewrites the two mixed shapes into their canonical equivalent:

| Input | Comes back as |
| --- | --- |
| document-level `'5'`, no override | unchanged |
| no BT-8 anywhere | unchanged |
| per-entry `'29'`, no document-level code | document-level `'29'`, entry stripped |
| document-level `'5'`, one entry overriding to `'29'` | no document-level code, entries `['29', '5']` |

Every rewrite is semantically identical to its input. What the library will **not** do is collapse divergent codes: EN 16931 permits differing codes per entry, so turning `29, 72` into `29, 29` would silently falsify the second entry's VAT point date.

Under `validateBusinessProcess`, rule S1.13 rejects both divergent codes and a BT-8 present on only *some* breakdown groups — the latter being the likelier mistake, since it serializes `ram:DueDateTypeCode` onto some `BG-23` groups and not others.

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
