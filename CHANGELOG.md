# Changelog

All notable changes to this project. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/) — while in `0.x`, a minor version may break the API.

## [0.3.0] - 2026-09-26

### Breaking

- **Amounts are exact decimals.** Every amount, quantity and rate accepts a `number` or a decimal string on the way in. `parse`, `deserialize` and `computeTotals` return `ParsedInvoice`, whose decimals are canonical strings (`'240.00'`), never floats. See `docs/adr/0001-decimal-amounts.md`.
- **A number showing float drift is refused.** `0.1 + 0.2` is `0.30000000000000004`: more than six decimals, an exponent, `NaN` or `Infinity` is reported as `INVALID_DECIMAL`, by `normalizeInvoice`, `validateEn16931`, `computeTotals`, `serialize` and `generate`. Round the value, or pass a string.
- **Rounding is half away from zero.** A 2.675 tie now derives `2.68`, where `toFixed` gave `2.67`. `computeTotals` still accepts a stated `2.67` within its one-cent tolerance.
- `TotalsError.given` and `.computed` are strings. The `NOT_A_FINITE_AMOUNT` code is now `INVALID_DECIMAL`, and every invalid field is reported, not the first.
- Model arrays (`lines`, `taxBreakdown`, `allowances`, `charges`) are `readonly`.
- `FacturXParseError` and `FacturXGenerateError` carry a `code`, and their constructors take it.
- `generate` refuses a visual PDF that uses a font it does not embed (`FONT_NOT_EMBEDDED`). PDF/A-3 requires every font embedded; pdf-lib's `StandardFonts` embed none.
- `deserialize` refuses a `<!DOCTYPE>`, a number outside `xsd:decimal` (`1e400`, `0x10`, an empty element) and an impossible date (`20260230`). It used to read them as `Infinity`, `16`, `0` and March 2nd.

### Added

- **The three reduced profiles** — MINIMUM, BASIC WL, BASIC — each emitting only what its schema allows, and each validated against its own XSD and Schematron.
- **`computeTotals`** derives the line amounts, the VAT breakdown and the document totals (BR-CO-10 to BR-CO-17), and reports a stated figure it disagrees with.
- **The XML level is public**: `serialize`, `deserialize`, `extract`, and `generate({ xml })` for ready-made CII.
- **Fields the Elixir sibling models**: BT-6 tax currency and BT-111, BG-13 ship-to, BT-72 delivery date, BG-26 line billing period, BT-39 country subdivision, BT-82 payment information, BT-84 non-IBAN account, BT-114 rounding. Each is written from its profile floor and checked against the official rule set of every profile that carries it.
- `normalizeInvoice` checks every decimal field and reports every problem with its path, before anything is built. `validateDecimals` returns the same as validation errors.
- Open code lists: any ISO 4217 currency shape (`CHF`) and any UNTDID 1001 document type (`503`). VAT categories `L` and `M`.
- Validation: BR-53 (BT-111 with BT-6, and BT-6 different from BT-5), BR-CO-16 with the rounding amount, `INVALID_CURRENCY_CODE`, and `UNEMITTABLE_ROUNDING_AMOUNT` for a non-zero BT-114 below EN 16931, which has no element for it.
- Typed input errors: `ENCRYPTED_PDF`, `MALFORMED_PDF`, `NO_EMBEDDED_XML`, `INVALID_XMP` on reading; `ENCRYPTED_PDF`, `MALFORMED_PDF`, `FONT_NOT_EMBEDDED`, `INVALID_INVOICE`, `INVALID_XML`, `PROFILE_MISMATCH` on writing.
- Property tests over generated invoices: exact rounding, BR-CO-10 to BR-CO-16 on every derived invoice, and the serialize/deserialize round-trip at EN 16931 and EXTENDED.

### Fixed

- The XMP packet and the header sniffers (`detectProfile`, `detectInvoiceNumber`) no longer parse a `<!DOCTYPE>`.
- An optional amount that is present but unreadable is an error, no longer silently dropped.
- `serialize` with an unknown profile throws `FacturXSerializeError`, not a `TypeError`.
- VAT grouping and BR-CO-18 compare rates by value: `'20'` and `'20.00'` are one rate.
- A ship-to with no name (BT-70 is optional) is read, not refused; `shipTo` is typed `DeliveryParty`, whose `name` is optional.
- `totals.taxTotal` (BT-110) is optional, as in every schema: a summation without it is read, and counts as zero in BR-CO-14 and BR-CO-15.
- A tax currency equal to the invoice currency is dropped on read, so such a document regenerates instead of failing BR-53.
- Money amounts are rounded to the cent before anything sums them. Two allowances of `0.005` used to give a BT-107 of `0.01` next to two written amounts of `0.01`, which BR-CO-11 rejects.

## [0.2.0] - 2026-08-19

- XSD validation against the bundled EN 16931 and EXTENDED schemas, and Schematron validation through a Saxon server, with an offline Docker setup.
- Legal identifiers: SIREN, assujetti unique, tax representative.
- BT-9 / BT-20 payment terms (BR-CO-25).
- EXTENDED-only line fields: notes with subject codes, ship-to, delivery date, preceding invoice.
- Unit prices keep four decimals; only the country is mandatory in an address.
- CI workflow.

## [0.1.0] - 2026-08-13

- First release: EN 16931 generation and parsing, and the French reform socle — BT-23 and BT-8.
