# ADR 0001 — Amounts are exact decimals

Date: 2026-09-26. Status: accepted, from 0.3.0.

## Context

Until 0.2.0 every amount, quantity and rate in the model was a JavaScript `number`, and the library rounded with `toFixed(2)`. Three consequences followed:

- **Rounding followed the float, not the rule.** `(1.005).toFixed(2)` is `"1.00"` and `(2.675).toFixed(2)` is `"2.67"`, because those values are stored just below the tie. A decimal implementation writes `1.01` and `2.68`. BR-CO-17 accepts both, but `computeTotals` then needed a cent of slack on every VAT-derived total, and a README caveat.
- **Float noise needed its own guards.** A chain like `0.02 - 0.05 + 0.03` is `-3.469e-18`, whose `toFixed(2)` is `"-0.00"`. The code carried a `snapNearZero` helper and a `+ 0` in every formatter for this.
- **Third-party figures could be altered.** `parse` and `deserialize` returned `Number(text)`. An amount beyond fifteen significant digits came back changed, silently, on the extract → parse → correct → generate path the library exists to support.

The Elixir sibling (`nseaSeb/facturx`, ADR 0001 there) uses `Decimal` throughout and refuses floats at its `Invoice.new/1` boundary. Its reasoning: a float reaching the library has usually been through float arithmetic already, and `0.1 + 0.2` is `0.30000000000000004` before anything can see it; accepting it records the drift and calls it validated.

## Decision

1. **Arithmetic is exact decimal**, on scaled `BigInt`s (`src/decimal.ts`). Rounding is half away from zero. There is no division except by powers of ten, so no precision is lost anywhere.
2. **Readers return canonical decimal strings.** `parse`, `deserialize` and `computeTotals` return `ParsedInvoice`, which is `FacturXInvoice<string>`. The canonical form keeps the value's own scale (`"100.00"` stays `"100.00"`) and drops a leading `+`, leading zeros and a trailing dot.
3. **Writers accept a number or a string** (`DecimalInput`). `FacturXInvoice` defaults to that union, so existing callers passing numbers still compile.
4. **A number is refused when it shows float drift**: more than six fraction digits, an exponent, or not finite. Six leaves room for any precision an invoice states (unit prices and quantities are written at four) while drift lands at fourteen to seventeen. A string is exempt: it was written, not computed.
5. **One boundary.** `normalizeInvoice` checks every decimal field and reports every refusal with its path. `serialize`, `validateEn16931`, `computeTotals` and `generate` all call it first, so the refusal is the same whichever entry point a value reaches.
6. **No decimal dependency.** Add, subtract, multiply, compare and round fit in one short module. A dependency would add its own parsing surface to a library that parses third-party amounts; the Elixir sibling had to ship a CVE fix for an unbounded exponent in `Decimal.parse`. Strings are length-capped and exponents refused before any arithmetic.

## Alternatives rejected

- **Keep `number` in the API, compute in integer cents inside.** Non-breaking, and it fixes rounding. It still returns third-party figures as floats, and still cannot tell a stated `0.3` from a computed `0.30000000000000004`.
- **A `Decimal` class in the model** (decimal.js, big.js). Forces every caller to construct objects for every figure, and ties the public types to a third-party class.
- **Refuse all numbers, as the Elixir sibling refuses floats.** JavaScript has one number type, so this would refuse `100` too. The drift test catches what matters without that cost.

## Consequences

- Breaking in 0.3.0: readers return strings, `TotalsError.given` / `computed` are strings, the `NOT_A_FINITE_AMOUNT` code became `INVALID_DECIMAL`, and model arrays are `readonly`.
- A caller-supplied amount with more than two decimals is still rounded to two on the wire, now exactly. Refusing it instead would be a separate decision.
- `computeTotals` now derives `2.68` where it derived `2.67` for a 2.675 tie. It still accepts a stated `2.67` within its one-cent tolerance.
