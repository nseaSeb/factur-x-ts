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
| `validateXsd(xml, options?)` | `Promise<XsdValidationResult>` — validate CII XML against the bundled EN 16931 / EXTENDED XSD. Requires the optional `xmllint-wasm` dependency. Throws `FacturXXsdNotBundledError` for a profile whose schema isn't bundled; falls back to `EN 16931` if the profile is omitted and can't be detected. |
| `validateSchematron(xml, options?)` | `Promise<SchematronValidationResult>` — validate CII XML against the bundled EN 16931 / EXTENDED Schematron business rules, via an external Saxon server. Throws `FacturXSchematronNotBundledError` for a profile whose rule set isn't bundled (unless `options.xsl` supplies one), `FacturXProfileNotDetectedError` if the profile is omitted and can't be detected, `FacturXSaxonError` if the server is unreachable, answers non-2xx, or returns a body that isn't a real SVRL report. |
| `Profile` | Const object of the five Factur-X conformance levels. |
| `FacturXInvoice` and friends | The invoice model. All fields `readonly`. |
| `ValidationError`, `ValidationResult` | Shapes returned by EN 16931 business-rule validation. |
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

## Amounts don't carry a currency, except one

Every `ram:*Amount` element is serialized without `currencyID` — the invoice's single `currency` is implicit throughout, and the EN 16931 / EXTENDED Schematron rejects the attribute wherever it's redundant ("attribute not used in the given context"). The lone exception is `ram:TaxTotalAmount` (BT-110), which always carries `currencyID` set to that same `currency`: the Schematron's rule for this one element is conditional rather than a flat rejection, and permits `currencyID` when it matches `InvoiceCurrencyCode` — presumably to disambiguate it from an optional second VAT total in a separate accounting currency (BT-111, unsupported here — there's exactly one `currency` per invoice).

## Profiles

| Profile | Status |
| --- | --- |
| `EN 16931` | Implemented, validated, veraPDF-checked |
| `BASIC` | Serializes with the correct guideline URN; no profile-specific rule set |
| `EXTENDED` | Serializes with the correct guideline URN; no profile-specific rule set |
| `BASIC WL` | Guideline URN only; reduced-profile field rules not implemented |
| `MINIMUM` | Guideline URN only; reduced-profile field rules not implemented |

Only `EN 16931` runs mandatory-rule validation before generating. The others serialize whatever you hand them.

`EN 16931` and `EXTENDED` additionally ship a bundled XSD, checkable with [`validateXsd`](#xsd-validation); `BASIC`, `BASIC WL` and `MINIMUM` don't.

## Limitations

Known and unaddressed, from a review of the library:

- The XMP conformance gate in the parser rejects `zugferd-invoice.xml` even though attachment extraction accepts it, and the `1.07` version check is exact string equality.
- Unit prices (BT-146) are serialized at 2 decimals, so `quantity × netPrice` stops reconciling with `lineTotal` for prices carrying more precision.
- The deserializer does not guard `Number()` for quantity, VAT rate, calculation percent or breakdown rate — a continental `1,5` becomes `NaN` without an error.
- BR-CO-17 (`calculatedAmount ≈ basisAmount × rate / 100`) is not enforced, and line-level allowances are never reconciled against the line total.
- Amount comparisons use a fixed 0.02 absolute tolerance, which is looser than the exact comparison strict validators apply.
- Address fields are required unconditionally, which contradicts the reduced profiles the parser accepts.
- No mapping exists for BT-9 (payment due date) or BT-20 (payment terms description); `SpecifiedTradePaymentTerms` is never serialized. Found by running `validateSchematron` against the EXTENDED profile: BR-CO-25 requires one of the two whenever `duePayable` is positive, and the library's own sample invoice fails it.
- `xmlEscape` handles the five XML entities but does not strip C0 control characters.

## XSD validation

`validateXsd` checks CII XML against the official EN 16931 / EXTENDED XSD, bundled under `schemas/xsd/` (see `schemas/NOTICE.md` for provenance and licensing). It uses [`xmllint-wasm`](https://github.com/noppa/xmllint-wasm) — libxml2 compiled to WebAssembly, in-process, no native build step and no external server — declared as an **optional peer dependency**: npm won't install it or warn about its absence unless you add it yourself, so callers who never validate don't carry the 860KB.

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

The schema is picked from `options.profile`, or read from `ram:GuidelineSpecifiedDocumentContextParameter/ram:ID` in the XML, falling back to `EN 16931` if neither resolves (malformed XML, an unrecognized guideline URN) — a deliberate exception to "never guess silently": EN 16931's XSD is a structural superset, so it's still a meaningful check on a document whose exact profile isn't known, which matters for the extract → parse → correct → generate flow over a third-party document. Only `EN 16931` and `EXTENDED` ship a bundled schema; `validateXsd` throws `FacturXXsdNotBundledError` for the other three profiles when the profile *is* known (explicitly or detected) — that case isn't guessed away. Input is treated as untrusted: a `<!DOCTYPE>` is rejected outright (XXE / entity-expansion risk), never handed to the validator — checked only in the document's prolog, so a free-text field that happens to contain the literal string `<!DOCTYPE` isn't a false positive.

`validateXsd` checks structure and cardinality — mandatory elements, types, sequence order — not business rules. It does not replace `validateEn16931`, nor a full Schematron run against the official rule set.

## Schematron validation

`validateSchematron` runs the official EN 16931 / EXTENDED Schematron business rules, bundled under `schemas/schematron/` (see `schemas/NOTICE.md`). The Schematron compiles to XSLT 2.0, which Node can't run in-process — like the Python [`akretion/factur-x`](https://github.com/akretion/factur-x) library, validation is delegated to a [Saxon server](https://github.com/willemvlh/saxon-server) over HTTP:

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

The rule set is picked the same way as `validateXsd`: `options.profile`, or the XML's own guideline URN — `FacturXProfileNotDetectedError` if neither resolves. Only `EN 16931` and `EXTENDED` ship a bundled rule set; pass `options.xsl` with a compiled Schematron XSLT for anything else (e.g. a national CTC rule set). `<!DOCTYPE>` is rejected the same way as `validateXsd`, before any network call. A response that isn't network-reachable, doesn't come back 2xx, or comes back 2xx with a body that isn't an actual SVRL report (a misconfigured endpoint, a Saxon fault page) throws `FacturXSaxonError` rather than being read as "no violations found" — a broken connection to Saxon must never look like a clean `valid: true`.

If a custom `options.xsl` produces `svrl:text` with child markup (e.g. `<b>` inside the message), `error.message` still comes back as a plain string, but the fragments are joined in whatever order `fast-xml-parser` groups them in, not source order — the bundled EN 16931/EXTENDED rule sets never emit markup, so this only affects custom rule sets.

Findings are split by SVRL severity into `result.errors` and `result.warnings` — only `warning` and `info` are non-blocking, so `result.valid` is `errors.length === 0`. `PEPPOL-EN16931-R008` ("no empty elements") is flagged `warning` and fires on every invoice with no delivery data, since CII still requires an empty `ram:ApplicableHeaderTradeDelivery` — a `valid: true` result can still carry warnings worth inspecting.

> Privacy: a public Saxon endpoint means sending real invoice data to a third party. Self-host in production — `docker/Dockerfile` bakes the EN 16931 / EXTENDED code-list DB into the image so validation stays entirely offline, **provided you also pass `codedbUrl`**: the XSLT resolves the code-list DB via `document(...)`, and without `codedbUrl` the default is a live, unpinned `raw.githubusercontent.com` URL — self-hosting Saxon alone doesn't stop that fetch.
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
