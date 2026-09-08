# factur-x-ts

TypeScript-native [Factur-X](https://fnfe-mpe.org/factur-x/) generator and parser. Produces PDF/A-3b invoices with an embedded EN 16931 CII XML attachment, and reads them back.

Strictly typed, no `any`. Two runtime dependencies: [`pdf-lib`](https://github.com/Hopding/pdf-lib) and [`fast-xml-parser`](https://github.com/NaturalIntelligence/fast-xml-parser).

> **Status: 0.2.0, pre-release.** Not published to npm yet. All five profiles are built, each validated against its own XSD and its own Schematron rule set. See [Limitations](#limitations) before using this for real invoicing.

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

## Let the library do the arithmetic

`computeTotals` derives the line amounts, the VAT breakdown and the document
totals — BR-CO-10 to BR-CO-17, which the XSD does not check and only the
Schematron catches, after the fact.

```ts
import { computeTotals } from 'factur-x-ts';

const result = computeTotals({
  number: 'FA-2026-0042',
  issueDate: new Date(Date.UTC(2026, 2, 15)),
  currency: 'EUR',
  typeCode: '380',
  seller: { name: 'Vendeur SAS', vatId: 'FR12345678901', address: { country: 'FR' } },
  buyer: { name: 'Acheteur SARL', address: { country: 'FR' } },
  lines: [
    { id: '1', name: 'Prestation', quantity: 3, unit: 'C62', netPrice: 33.33, vatCategory: 'S', vatRate: 5.5 },
  ],
  paymentTerms: '30 jours net', // BT-20 — BR-CO-25, since the amount due is positive
});

if (result.ok) {
  result.invoice.totals.lineTotal;  // 99.99
  result.invoice.totals.taxTotal;   // 5.5   — BR-CO-17 rounds 5.49945 to the cent
  result.invoice.totals.grandTotal; // 105.49
}
```

A figure you supplied is checked, not kept: every derivable amount in the
returned invoice is the derived one, and a disagreement comes back instead of an
invoice rather than being resolved silently.

```ts
const result = computeTotals(draft);
if (!result.ok) {
  for (const e of result.errors) {
    console.error(`${e.field}: ${e.message}`); // 'totals.grandTotal: stated 999.00, derived 120.00'
  }
}
```

What a caller supplies and the arithmetic cannot derive is carried through
untouched: BT-113 (`prepaid`), and a breakdown entry's BT-120 / BT-121 and BT-8
override. Pass `{ overwrite: true }` to take the computed figures anyway.

Beyond a `TOTALS_MISMATCH`, four inputs are refused outright rather than
answered with a number that means nothing:

- `NO_LINES` — nothing implies the amounts. A BASIC WL or MINIMUM document
  carries no lines and still has a VAT liability, so its caller states their
  totals rather than asking for them.
- `ORPHAN_TAX_BREAKDOWN` — a breakdown entry matching no line, allowance or
  charge. Nothing implies its taxable amount, and dropping it would silently
  remove a declared liability.
- `DUPLICATE_TAX_BREAKDOWN` — two entries sharing a category and rate. One would
  overwrite the other and take its exemption reason with it, surfacing much
  later as a BR-E-10 rejection of a document whose caller did supply one.
- `NOT_A_FINITE_AMOUNT` — a `NaN` or `Infinity` reaching an amount. It would
  propagate through every sum and be serialized as
  `<ram:GrandTotalAmount>NaN</ram:GrandTotalAmount>`.

Four comparisons are deliberately looser than the rest. A supplied BT-117
(`calculatedAmount`) is accepted within a cent of the derived one — it is the
one figure two correct implementations can legitimately disagree on, see the
rounding note under [Limitations](#limitations) — and BT-110, BT-112 and BT-115
(`taxTotal`, `grandTotal`, `duePayable`) within a cent per VAT breakdown group,
since they are built on it and comparing them exactly would cancel the slack on
the figures they sum. The other four totals are sums of amounts you supplied
verbatim, with no rate multiplication and so no rounding tie: those stay exact
after rounding to the cent, as the Schematron's own sum rules are.

An entry you supplied is completed, never replaced: BT-120 and BT-121 (the VAT
exemption reason and its code) cannot be derived from amounts, and category `E`
is rejected without them (BR-E-10).

Two amounts are never derived, because nothing in the invoice determines them.
BT-113 (`prepaid`) is carried through as given and subtracted from BT-115
(BR-CO-16). BT-114, the rounding amount, has no field in `MonetaryTotals` yet —
see [Limitations](#limitations).

## API

| Export | Description |
| --- | --- |
| `generate(options)` | `Promise<Uint8Array>` — a PDF/A-3b invoice. Throws `FacturXGenerateError`. |
| `parse(buffer)` | `Promise<ParseResult>` — `{ invoice, metadata, rawXml }`. Throws `FacturXParseError`. |
| `computeTotals(draft, options?)` | `TotalsResult` — derive BT-131, the VAT breakdown and BT-106 to BT-115 from a draft. Returns `{ ok: false, errors }` on a disagreement or on input it refuses to answer; it throws for no input the types allow (`NaN` included, which they do). |
| `validateEn16931(invoice, options?)` | `ValidationResult` — run the rules without generating a PDF. |
| `validateXsd(xml, options?)` | `Promise<XsdValidationResult>` — validate CII XML against the bundled XSD of the document's profile — all five ship one. Requires the optional `xmllint-wasm` dependency. Throws `FacturXXsdNotBundledError` for a profile whose schema isn't bundled; falls back to `EN 16931` if the profile is omitted and can't be detected. |
| `validateSchematron(xml, options?)` | `Promise<SchematronValidationResult>` — validate CII XML against the bundled Schematron business rules of the document's profile — all five ship one — via an external Saxon server. Throws `FacturXSchematronNotBundledError` for a profile whose rule set isn't bundled (unless `options.xsl` supplies one), `FacturXProfileNotDetectedError` if the profile is omitted and can't be detected, `FacturXSaxonError` if the server is unreachable, answers non-2xx, or returns a body that isn't a real SVRL report. |
| `Profile` | Const object of the five Factur-X conformance levels. |
| `atLeast(profile, floor)` | `boolean` — whether `profile` is `floor` or richer, over the five nested profiles. What `serialize` gates on; exported so a caller can ask the same question before building an invoice for a reduced profile. |
| `FacturXInvoice` and friends | The invoice model. All fields `readonly`. |
| `ValidationError`, `ValidationResult` | Shapes returned by EN 16931 business-rule validation. |
| `DraftInvoice`, `TotalsError`, `TotalsResult` | Shapes taken and returned by `computeTotals`. A `DraftInvoice` is a `FacturXInvoice` with `lineTotal`, `taxBreakdown` amounts and `totals` optional. |
| `XsdValidationError`, `XsdValidationResult` | Shapes returned by XSD validation. `XsdValidationError` carries xmllint-wasm's `rawMessage` and, when it could parse one out, `location: { fileName, lineNumber }` — both absent for factur-x-ts's own synthetic errors (e.g. the DOCTYPE rejection). |
| `SchematronViolation`, `SchematronValidationResult` | Shapes returned by Schematron validation. |

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

No separate schema or profile is needed for the French mandate. Verified against the DGFiP *spécifications externes B2B* v3.2: everything it requires is already in the EN 16931 CII vocabulary.

| Term | Card. | Field | CII path (under the party, or the document) |
| --- | --- | --- | --- |
| **BT-23** cadre de facturation | 1..1 | `invoice.businessProcess` | `ExchangedDocumentContext/BusinessProcessSpecifiedDocumentContextParameter/ID` |
| **BT-8** exigibilité TVA | 0..1 | `invoice.taxDueDateTypeCode` | `ApplicableHeaderTradeSettlement/ApplicableTradeTax/DueDateTypeCode` |
| **BT-30 / BT-47** SIREN | 1..1 | `seller.legalId`, `buyer.legalId` | `SpecifiedLegalOrganization/ID` with `@schemeID` (default `0002`) |
| **BT-29d** assujetti unique | 0..1 | `seller.globalId` | `GlobalID` with `@schemeID` (default `0231`, **seller only**) |
| **BG-11** représentant fiscal | 0..1 | `invoice.taxRepresentative` | `SellerTaxRepresentativeTradeParty` |

The `0231` default is applied to the seller alone because that is where the annexe puts BT-29d. Applying it everywhere would mislabel, say, a buyer's GLN as a French VAT-group identifier.

Coverage against *Annexe 1 — Flux 1 v1.2*: **77 of the 96** regulatory data reachable in EN 16931 (the remaining 20 of 116 exist only in the EXTENDED profile). No mandatory DEMARRAGE datum is missing; what remains is delivery information (BG-13/BG-15), payment terms (BT-9), line-level billing period and line notes — all CIBLE or optional.

The PPF control profile (`Base` / `Full`) is a **separate axis** from the Factur-X profile: it is carried by the transmitted filename prefix (rule S1.06), not by BT-24. The widely-cited URN `…extended-ctc-fr` does not exist in the specifications. Naming the transmitted file is the caller's responsibility — this library produces a document, not a flux.

```ts
await generate({
  invoice,
  profile: 'EN 16931',
  validation: { validateFrenchRules: true }, // G1.02, G1.60, S1.13, BT-30/BT-47
});
```

Two validation switches, with deliberately different defaults:

| Option | Default | Why |
| --- | --- | --- |
| `validateVatPointDate` | **on** | BT-8 is restricted by EN 16931 itself (BR-CL-06) to `5` / `29` / `72`, so the check is universally correct. |
| `validateFrenchRules` | **off** | None of these are EN 16931 restrictions. BT-23 values are unrestricted by the standard — Peppol uses `urn:fdc:peppol.eu:…`, Chorus Pro uses `A1`/`A2` — and SIREN is meaningless outside France. Applying either universally would lock out non-French callers and break round-tripping of third-party documents. |

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

Under `validateFrenchRules`, rule S1.13 rejects both divergent codes and a BT-8 present on only *some* breakdown groups — the latter being the likelier mistake, since it serializes `ram:DueDateTypeCode` onto some `BG-23` groups and not others.

## Allowances and charges

Two levels exist and they are not interchangeable:

- **Document level** — `invoice.allowances` / `invoice.charges` (BG-20 / BG-21). Their sums are `totals.allowanceTotal` (BT-107) and `totals.chargeTotal` (BT-108), and they move `taxBasisTotal` away from `lineTotal`.
- **Line level** — `line.allowances` / `line.charges` (BG-27 / BG-28). These are already folded into that line's own `lineTotal` and must **not** appear in the header totals.

Declaring a non-zero `allowanceTotal` with no document-level allowance behind it is rejected at validation, because a receiver's Schematron rejects it too (BR-CO-11).

Line-level allowances/charges are also checked arithmetically: `line.lineTotal` must equal `line.netPrice × line.quantity`, adjusted by that line's own `allowances`/`charges` — `validateEn16931` rejects a line where it doesn't (no dedicated EN 16931 rule number covers this specifically, unlike the header sums below).

## Payment terms (BT-9 / BT-20)

`paymentDueDate` (BT-9) and `paymentTerms` (BT-20, free text) serialize to `ram:SpecifiedTradePaymentTerms`. Whenever `totals.duePayable` is positive, `validateEn16931` requires at least one of the two — mirroring BR-CO-25, which the EXTENDED Schematron enforces (EN 16931's doesn't carry this particular rule, but the underlying field is the same, so checking it here is never a false positive).

## Amounts don't carry a currency, except one

Every `ram:*Amount` element is serialized without `currencyID` — the invoice's single `currency` is implicit throughout, and every bundled Schematron rejects the attribute wherever it's redundant ("attribute not used in the given context"). The lone exception is `ram:TaxTotalAmount` (BT-110), which always carries `currencyID` set to that same `currency`: the Schematron's rule for this one element is conditional rather than a flat rejection, and permits `currencyID` when it matches `InvoiceCurrencyCode` — presumably to disambiguate it from an optional second VAT total in a separate accounting currency (BT-111, unsupported here — there's exactly one `currency` per invoice).

This is applied uniformly across all five profiles and verified live against each of them: every profile's rule set is bundled, and the test suite puts each document in front of its own.

## Unit prices keep their own precision

`line.netPrice`, `line.grossPrice` and `line.priceDiscount` (BT-146/BT-148/BT-147) serialize at 4 decimals, not the 2 decimals every money total uses — `udt:AmountType` is an unconstrained `xs:decimal` and, unlike the totals, no EN 16931 Schematron rule caps their precision. A price needing more resolution than a cent (a per-liter fuel price, for instance) survives a `generate` → `parse` round-trip, and `quantity × netPrice` reconciles with `lineTotal` (within a small tolerance scaled to `quantity`, absorbing whatever residual rounding a price with more than 4 decimals still carries).

## Only country is mandatory in a `PostalAddress`

`lineOne`, `postcode` and `city` are optional — `country` is the only field `ram:TradeAddressType` requires at the XSD level, and the only one EN 16931's own Schematron mandates (`ram:PostalTradeAddress/ram:CountryID`, checked directly, not assumed). `serialize` omits whichever fields aren't given rather than emitting empty elements, and `deserialize` only throws for a missing `ram:CountryID` — a country-only address (common for a reduced profile, or a third-party document that never had more) round-trips as-is instead of being rejected or forced to carry fabricated data.

## Profiles

All five profiles are built, and `serialize` restricts what it emits to what each
one allows — a `MINIMUM` document is a MINIMUM document, not an EN 16931 one
wearing a MINIMUM label.

| Profile | Carries | XSD | Schematron |
| --- | --- | --- | --- |
| `MINIMUM` | Header only; no VAT breakdown, no lines. Seller address only | ✅ | ✅ |
| `BASIC WL` | Full header, no lines ("without lines") | ✅ | ✅ |
| `BASIC` | Header and lines, EN 16931-compliant subset | ✅ | ✅ |
| `EN 16931` | The norm itself | ✅ | ✅ |
| `EXTENDED` | The norm plus the French `EXT-FR-FE-*` line fields | ✅ | ✅ |

The five are strictly nested — every element name `MINIMUM` declares is in
`BASIC WL`, and so on up — which is what lets a single ordering decide what may
be emitted rather than one rule per profile per element. The floors, mirroring
the Elixir sibling's `Facturx.CII`:

| From | Element | Model field |
| --- | --- | --- |
| `BASIC WL` | `ram:IncludedNote` (document level) | `notes` |
| `BASIC WL` | `ram:SellerTaxRepresentativeTradeParty` | `taxRepresentative` |
| `BASIC WL` | Everything in the settlement but the currency and the summation | `paymentMeans`, `taxBreakdown`, `billingPeriod`, `allowances`, `charges`, `paymentTerms`, `precedingInvoices` |
| `BASIC WL` | `ram:LineTotalAmount`, `ram:ChargeTotalAmount`, `ram:AllowanceTotalAmount`, `ram:TotalPrepaidAmount` | `totals.lineTotal`, `.chargeTotal`, `.allowanceTotal`, `.prepaid` |
| `BASIC WL` | `ram:GlobalID`; every address field but `ram:CountryID`; any party's address but the seller's | `globalId`, `address` |
| `BASIC` | `ram:IncludedSupplyChainTradeLineItem` | `lines` |
| `EN 16931` | `ram:DefinedTradeContact` | `contact` |
| `EN 16931` | `ram:Description` (BT-154) — BASIC's `TradeProductType` declares `GlobalID` and `Name` and nothing else | `lines[].description` |
| `EN 16931` | `ram:ApplicableTradeSettlementFinancialCard`, `ram:AccountName`, `ram:BICID` | `paymentMeans[].cardId`/`.cardholderName`, `.accountName`, `.bic` |
| `EXTENDED` | The four French line extensions below | `lines[].notes`/`.shipTo`/`.deliveryDate`/`.precedingInvoice` |

Setting a field a profile does not carry is not an error — same "profile decides,
not the caller" philosophy as `taxDueDateTypeCode` — but it is dropped on the
wire, so a `parse(generate(...))` round-trip only reproduces it under a profile
that carries it.

Two model fields are optional *because* of the reduced profiles, and required
again at `EN 16931` where `validateEn16931` asks for them: `totals.lineTotal`
(BT-106, absent from `MINIMUM`'s summation) and `TradeParty.address` (BG-5 /
BG-8 — `MINIMUM` carries the seller's and refuses everyone else's). Neither is
invented on the way back: a `MINIMUM` document parses to an invoice with no
`lineTotal` and a buyer with no address, rather than to zero and an empty
country.

> **MINIMUM is not an invoice.** Its schema has no `ram:ApplicableTradeTax`, so
> it cannot carry the VAT breakdown (BG-23) the French mandate requires from day
> one — nor BT-8, which lives inside it. `BASIC WL` carries no lines, which the
> mandate requires on its target trajectory (BG-25). Neither is a valid French
> e-invoice; `BASIC` is the leanest profile that is.

Only `EN 16931` runs the full mandatory-field validation before generating.
Two narrower sets run whatever the profile: the code-list rules (BT-8, and
BT-23 under `validateFrenchRules`), since both are serialized wherever the
profile carries them, and what the profile's own XSD makes mandatory —
`ram:LineTotalAmount` and at least one `ram:ApplicableTradeTax` from `BASIC WL`
up, at least one line from `BASIC` up. "Reduced" is not "anything goes", and
this path is reachable from the library's own output: `parse` on a `MINIMUM`
PDF gives back an invoice with neither, so re-issuing it at `BASIC WL` is
refused rather than written as an XSD-invalid PDF.

### EXTENDED-only line fields (EXT-FR-FE-\*)

Four `LineItem` fields are French EXTENDED extensions — not EN 16931 business terms — and `serialize` silently drops them under every other profile rather than erroring, mirroring `Facturx.CII`'s `line_notes` / `line_ship_to` / `line_delivery_event` / `line_preceding_invoice`:

| Field | CII element | EN 16931 behaviour |
| --- | --- | --- |
| `notes` | `ram:IncludedNote` (× N, with `SubjectCode`) | Only `notes[0]`'s content survives, without `SubjectCode` — EN 16931's XSD caps this at one occurrence with no subject code |
| `shipTo` | `ram:ShipToTradeParty` | Dropped |
| `deliveryDate` | `ram:ActualDeliverySupplyChainEvent` | Dropped |
| `precedingInvoice` | `ram:InvoiceReferencedDocument` (line-level, distinct from the document-level `precedingInvoices`) | Dropped |

Setting any of these on a non-`EXTENDED` invoice is not an error — same "profile decides, not the caller" philosophy as `taxDueDateTypeCode` — but a `parse(generate(...))` round-trip only reproduces them under `EXTENDED`.

Every profile ships a bundled XSD and rule set, checkable with [`validateXsd`](#xsd-validation) and [`validateSchematron`](#schematron-validation).

## Limitations

Left as-is, either unverifiable or deliberate — not correctness bugs:

- Amounts are `number`, not a decimal type, and are rounded with `toFixed(2)` — the same way they are serialized. A half-cent tie therefore follows the float representation rather than decimal half-up (`(1.005).toFixed(2)` is `1.00`), so a figure may differ by a cent from a decimal-based implementation. BR-CO-17's tolerance is a full currency unit and accepts either.
- BT-114 (the rounding amount) has no field in `MonetaryTotals`, so it is neither serialized nor usable in `computeTotals`. BR-CO-16 is therefore `duePayable = grandTotal - prepaid`, with no rounding term.
- `parse` requires `fx:Version` to equal `1.07` exactly, by design rather than oversight: `1.07` is the only Factur-X/ZUGFeRD version whose XMP shape this parser was written against, and it's also the only version `generate` ever writes. A PDF declaring a different version may well be a legitimate Factur-X document under an older or newer XMP shape, which `parse` currently has no way to read.

## XSD validation

`validateXsd` checks CII XML against the official XSD of its profile — all five are bundled under `schemas/xsd/` (see `schemas/NOTICE.md` for provenance and licensing). It uses [`xmllint-wasm`](https://github.com/noppa/xmllint-wasm) — libxml2 compiled to WebAssembly, in-process, no native build step and no external server — declared as an **optional peer dependency**: npm won't install it or warn about its absence unless you add it yourself, so callers who never validate don't carry the 860KB.

```bash
npm install xmllint-wasm
```

```ts
import { validateXsd } from 'factur-x-ts';

const { rawXml } = await parse(await readFile('invoice.pdf'));
const result = await validateXsd(new TextDecoder().decode(rawXml));

if (!result.valid) {
  for (const e of result.errors) console.error(e.message);
}
```

The schema is picked from `options.profile`, or read from `ram:GuidelineSpecifiedDocumentContextParameter/ram:ID` in the XML, falling back to `EN 16931` if neither resolves (malformed XML, an unrecognized guideline URN) — a deliberate exception to "never guess silently": EN 16931's XSD is a structural superset, so it's still a meaningful check on a document whose exact profile isn't known, which matters for the extract → parse → correct → generate flow over a third-party document. All five profiles ship a schema, so `FacturXXsdNotBundledError` is now unreachable through the public API; it stays for a bundle dropped from a future build, where a known profile with no schema must be an error rather than a silent fallback to EN 16931. Input is treated as untrusted: a `<!DOCTYPE>` is rejected outright (XXE / entity-expansion risk), never handed to the validator — checked only in the document's prolog, so a free-text field that happens to contain the literal string `<!DOCTYPE` isn't a false positive.

`validateXsd` checks structure and cardinality — mandatory elements, types, sequence order — not business rules. It does not replace `validateEn16931`, nor a full Schematron run against the official rule set.

## Schematron validation

`validateSchematron` runs the official Schematron business rules of the document's profile — all five rule sets are bundled under `schemas/schematron/` (see `schemas/NOTICE.md`). The Schematron compiles to XSLT 2.0, which Node can't run in-process — like the Python [`akretion/factur-x`](https://github.com/akretion/factur-x) library, validation is delegated to a [Saxon server](https://github.com/willemvlh/saxon-server) over HTTP:

```bash
docker compose -f docker/compose.yml up -d --build
```

```ts
import { validateSchematron } from 'factur-x-ts';

const result = await validateSchematron(xml, { endpoint: 'http://localhost:5000/transform' });

if (!result.valid) {
  for (const e of result.errors) console.error(`${e.test}: ${e.message}`);
}
```

The rule set is picked the same way as `validateXsd`: `options.profile`, or the XML's own guideline URN — `FacturXProfileNotDetectedError` if neither resolves. All five profiles ship a rule set, and each document is checked against its own: validating a `MINIMUM` document with the EN 16931 rules would report it as missing everything MINIMUM deliberately omits. Pass `options.xsl` with a compiled Schematron XSLT to run something else (e.g. a national CTC rule set). `<!DOCTYPE>` is rejected the same way as `validateXsd`, before any network call. A response that isn't network-reachable, doesn't come back 2xx, or comes back 2xx with a body that isn't an actual SVRL report (a misconfigured endpoint, a Saxon fault page) throws `FacturXSaxonError` rather than being read as "no violations found" — a broken connection to Saxon must never look like a clean `valid: true`.

If a custom `options.xsl` produces `svrl:text` with child markup (e.g. `<b>` inside the message), `error.message` still comes back as a plain string, but the fragments are joined in whatever order `fast-xml-parser` groups them in, not source order — the bundled EN 16931/EXTENDED rule sets never emit markup, so this only affects custom rule sets.

Findings are split by SVRL severity into `result.errors` and `result.warnings` — only `warning` and `info` are non-blocking, so `result.valid` is `errors.length === 0`. `PEPPOL-EN16931-R008` ("no empty elements") is flagged `warning` and fires on every invoice with no delivery data, since CII still requires an empty `ram:ApplicableHeaderTradeDelivery` — a `valid: true` result can still carry warnings worth inspecting.

> Privacy: a public Saxon endpoint means sending real invoice data to a third party. Self-host in production — `docker/Dockerfile` bakes all five code-list DBs into the image so validation stays entirely offline, **provided you also pass `codedbUrl`**: the XSLT resolves the code-list DB via `document(...)`, and without `codedbUrl` the default is a live, unpinned `raw.githubusercontent.com` URL — self-hosting Saxon alone doesn't stop that fetch.
>
> ```ts
> await validateSchematron(xml, {
>   endpoint: 'http://localhost:5000/transform',
>   codedbUrl: 'file:///opt/facturx/FACTUR-X_EN16931_codedb.xml', // baked into docker/Dockerfile
> });
> ```
>
> The Docker image also pins the upstream Saxon image by digest, not by a floating tag (that exact substitution has broken this check before).

The `docker/` files aren't published to npm — clone the repository to use them. The bundled Schematron XSL (`schemas/schematron/`, ~2.5MB for both profiles) *is* published unconditionally, alongside the XSD, so every install carries it whether or not `validateSchematron` is ever called.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run lint        # eslint, type-aware on src
npm run build       # tsc -> dist/
```

The end-to-end suite checks PDF/A-3b conformance with [veraPDF](https://verapdf.org/) when the `verapdf` binary is on `PATH`; those tests skip with a warning when it is not, and the rest of the suite still verifies round-trip fidelity and attachment hygiene without it.

Likewise, the Schematron e2e tests run only when `FACTURX_SAXON_URL` is set to a running Saxon server (`docker compose -f docker/compose.yml up -d --build`, then `FACTURX_SAXON_URL=http://localhost:5000/transform npm test`); they skip with a warning otherwise. macOS binds port 5000 to AirPlay Receiver by default, which answers with a plain HTTP 403 instead of a connection error — free the port or map another one (`docker compose -f docker/compose.yml run --rm -p 5055:5000 saxon`).

## Licence

MIT — see [LICENSE](LICENSE).
