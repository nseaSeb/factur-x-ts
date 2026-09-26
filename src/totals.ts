// src/totals.ts
// The EN 16931 document arithmetic: line amounts, the VAT breakdown and the
// document totals — BR-CO-10 to BR-CO-17.
//
// Every rule here is one the Schematron checks and the XSD does not, so the
// test that matters is not a unit test of these functions but a document put in
// front of Saxon.

import {
  abs,
  add,
  cmp,
  dec,
  mul,
  neg,
  percentOf,
  round,
  sub,
  sum,
  toFixed,
  toKey,
  type Decimal,
} from './decimal.js';
import { normalizeDraft, type NormalizedDraft } from './normalize.js';
import type { LineItem, MonetaryTotals, ParsedInvoice, TaxBreakdown } from './types/invoice.js';
import type { DraftInvoice, TotalsError, TotalsOptions, TotalsResult } from './types/totals.js';

type NormalizedLine = NormalizedDraft['lines'][number];
interface Group {
  readonly amount: string;
}

/** The totals compared against a caller-stated figure, in report order. */
const REPORTED_TOTALS = [
  'lineTotal',
  'allowanceTotal',
  'chargeTotal',
  'taxBasisTotal',
  'taxTotal',
  'grandTotal',
  'duePayable',
] as const satisfies readonly (keyof MonetaryTotals)[];

/**
 * Derive the line amounts, the VAT breakdown and the document totals.
 *
 * A figure the caller supplied is checked, not kept: every derivable amount in
 * the returned invoice is the derived one, and a disagreement comes back as
 * `TOTALS_MISMATCH` instead of an invoice. Pass `{ overwrite: true }` to take
 * the computed figures anyway. What a caller supplies and the arithmetic cannot
 * derive is carried through untouched — BT-113, and a breakdown entry's
 * BT-120 / BT-121 and BT-8 override.
 *
 * Amounts may be numbers or decimal strings; the arithmetic is exact decimal
 * (src/decimal.ts), and the returned invoice carries canonical decimal
 * strings. A value that is not a decimal — NaN, a malformed string, a float
 * showing arithmetic drift — is reported as `INVALID_DECIMAL`, every one of
 * them, before anything is computed.
 *
 * Three amounts are never derived, because nothing in the invoice determines
 * them: BT-113 (`prepaid`) and BT-114 (`rounding`) are carried through as
 * given, and `duePayable` is `grandTotal - prepaid + rounding` exactly as
 * `validateEn16931` asserts it (BR-CO-16); BT-111
 * (`taxTotalInTaxCurrency`) needs an exchange rate, and is carried too.
 */
export function computeTotals(source: DraftInvoice, options: TotalsOptions = {}): TotalsResult {
  const empty = noLines(source);
  if (empty) return { ok: false, errors: empty };

  const normalized = normalizeDraft(source);
  if (!normalized.ok) {
    return {
      ok: false,
      errors: normalized.errors.map((e) => ({ code: 'INVALID_DECIMAL', field: e.field, message: e.message })),
    };
  }
  const draft = normalized.draft;

  const structural = orphanBreakdown(draft) ?? duplicateBreakdown(draft);
  if (structural) return { ok: false, errors: structural };

  const lines = draft.lines.map(deriveLine);
  const taxBreakdown = deriveBreakdown(lines, draft);
  const totals = deriveTotals(lines, taxBreakdown, draft);

  const { lines: _lines, taxBreakdown: _taxBreakdown, totals: _totals, ...rest } = draft;
  const invoice: ParsedInvoice = { ...rest, lines, taxBreakdown, totals };

  const divergences = compare(draft, invoice);
  if (divergences.length > 0 && options.overwrite !== true) {
    return { ok: false, errors: divergences };
  }

  return { ok: true, invoice };
}

// --- refusing what cannot be derived -----------------------------------------

// Everything here is founded on the line amounts: BT-106 sums them, BT-109 and
// BT-112 follow from it, and each BT-116 groups them. With no lines there is
// nothing to derive, and deriving zero would be a lie — a BASIC WL or MINIMUM
// invoice carries no lines and still has a VAT liability. Such a caller states
// their totals; they do not ask for them.
function noLines(draft: DraftInvoice): TotalsError[] | undefined {
  if (draft.lines.length > 0) return undefined;
  return [
    {
      code: 'NO_LINES',
      field: 'lines',
      message: 'Cannot derive the totals of an invoice with no lines — state them instead',
    },
  ];
}

// A breakdown entry whose category/rate matches no line and no document-level
// allowance or charge. It cannot be completed — nothing implies its taxable
// amount — and dropping it would remove a declared VAT liability from the
// document without a word.
function orphanBreakdown(draft: NormalizedDraft): TotalsError[] | undefined {
  const declared = draft.taxBreakdown ?? [];
  if (declared.length === 0) return undefined;

  const groups = new Set<string>([
    ...draft.lines.map((line) => vatKey(line.vatCategory, line.vatRate)),
    ...[...(draft.allowances ?? []), ...(draft.charges ?? [])].map((ac) => vatKey(ac.vatCategory, ac.vatRate)),
  ]);

  const errors = declared
    .map((tb, index): TotalsError | undefined =>
      groups.has(vatKey(tb.category, tb.rate))
        ? undefined
        : {
            code: 'ORPHAN_TAX_BREAKDOWN' as const,
            field: `taxBreakdown[${index}]`,
            message: `VAT breakdown ${tb.category} at ${tb.rate}% matches no line, allowance or charge — its taxable amount cannot be derived`,
          },
    )
    .filter((error): error is TotalsError => error !== undefined);

  return errors.length > 0 ? errors : undefined;
}

// Two supplied entries sharing a category and rate. They are keyed by exactly
// that pair, so one would overwrite the other — and what it takes with it is the
// half that cannot be derived: BT-120 / BT-121 and the BT-8 override. Dropping
// an exemption reason here would surface much later, as a BR-E-10 rejection of a
// document whose caller did supply one. CII carries one BG-23 per pair anyway,
// so there is no shape this could legitimately describe.
function duplicateBreakdown(draft: NormalizedDraft): TotalsError[] | undefined {
  const seen = new Set<string>();
  const errors: TotalsError[] = [];

  (draft.taxBreakdown ?? []).forEach((tb, index) => {
    const key = vatKey(tb.category, tb.rate);
    if (seen.has(key)) {
      errors.push({
        code: 'DUPLICATE_TAX_BREAKDOWN',
        field: `taxBreakdown[${index}]`,
        message: `VAT breakdown ${tb.category} at ${tb.rate}% is declared more than once — CII carries one BG-23 per category and rate`,
      });
    }
    seen.add(key);
  });

  return errors.length > 0 ? errors : undefined;
}

// --- lines -------------------------------------------------------------------

// BT-131 = net price × quantity, less the line's allowances, plus its charges.
//
// Always derived, even when the line already carries a total. Keeping the
// caller's figure would be worse than useless: the document totals are summed
// from these, so one wrong line amount would propagate into BT-106, BT-109,
// BT-112 and BT-115 without a single rule noticing. What the caller stated is
// not lost — `compare` reports it.
function deriveLine(line: NormalizedLine): LineItem<string> {
  const { lineTotal: _given, ...rest } = line;
  return { ...rest, lineTotal: toFixed(deriveLineTotal(line), 2) };
}

function deriveLineTotal(line: NormalizedLine): Decimal {
  const base = round(mul(dec(line.netPrice), dec(line.quantity)), 2);
  return round(add(sub(base, sumGroups(line.allowances)), sumGroups(line.charges)), 2);
}

// --- VAT breakdown -----------------------------------------------------------

interface BreakdownGroup {
  readonly category: LineItem['vatCategory'];
  readonly rate: string;
  readonly basis: Decimal;
}

// One entry per category/rate. BT-116 is the sum of the line amounts in that
// group, less the document allowances and plus the document charges falling
// under the same VAT — BR-S-08 and its siblings, one per category.
//
// An entry the caller supplied is completed, never replaced: BT-120 and BT-121
// (the exemption reason and its code) cannot be derived from amounts, and
// category E is rejected without them (BR-E-10).
function deriveBreakdown(lines: readonly LineItem<string>[], draft: NormalizedDraft): TaxBreakdown<string>[] {
  const members = [
    ...lines.map((line) => ({ category: line.vatCategory, rate: line.vatRate, amount: dec(line.lineTotal) })),
    ...(draft.allowances ?? []).map((ac) => ({ category: ac.vatCategory, rate: ac.vatRate, amount: neg(dec(ac.amount)) })),
    ...(draft.charges ?? []).map((ac) => ({ category: ac.vatCategory, rate: ac.vatRate, amount: dec(ac.amount) })),
  ];

  const declared = new Map((draft.taxBreakdown ?? []).map((tb) => [vatKey(tb.category, tb.rate), tb]));

  // Accumulated as we go rather than collected into per-key lists: the group's
  // category and rate come from whichever member opened it, so there is never a
  // "first element of a bucket that must exist" to reach for.
  const grouped = new Map<string, BreakdownGroup>();
  for (const entry of members) {
    const key = vatKey(entry.category, entry.rate);
    const bucket = grouped.get(key);
    grouped.set(
      key,
      bucket
        ? { ...bucket, basis: add(bucket.basis, entry.amount) }
        : { category: entry.category, rate: entry.rate, basis: entry.amount },
    );
  }

  return [...grouped.entries()]
    .map(([key, group]): TaxBreakdown<string> => {
      const { category, rate } = group;
      const basis = round(group.basis, 2);
      const given = declared.get(key);

      return {
        ...given,
        type: 'VAT',
        category,
        // The caller's own spelling of the rate when they declared the entry,
        // so a declared "20.00" is not rewritten to the line's "20".
        rate: given?.rate ?? rate,
        basisAmount: toFixed(basis, 2),
        // BT-117 = BT-116 × BT-119 / 100, rounded to the cent half away from
        // zero (BR-CO-17) — exactly, not through a float.
        calculatedAmount: toFixed(percentOf(basis, dec(rate)), 2),
      };
    })
    // Deterministic order, so the same invoice always serializes to the same bytes.
    .sort((a, b) => cmp(dec(a.rate), dec(b.rate)) || a.category.localeCompare(b.category));
}

// Grouping key on the rate's value, not its spelling: "20" and "20.00" are the
// same rate and must land in the same group. The Elixir sibling hit exactly
// this with Decimal terms, and had to normalise before grouping too.
function vatKey(category: string, rate: string): string {
  return `${category}|${toKey(dec(rate))}`;
}

// --- document totals ---------------------------------------------------------

function deriveTotals(
  lines: readonly LineItem<string>[],
  breakdown: readonly TaxBreakdown<string>[],
  draft: NormalizedDraft,
): MonetaryTotals<string> {
  // BR-CO-10
  const lineTotal = round(sum(lines.map((line) => dec(line.lineTotal))), 2);
  const allowanceTotal = sumGroups(draft.allowances);
  const chargeTotal = sumGroups(draft.charges);
  // BR-CO-13
  const taxBasisTotal = round(add(sub(lineTotal, allowanceTotal), chargeTotal), 2);
  // BR-CO-14
  const taxTotal = round(sum(breakdown.map((tb) => dec(tb.calculatedAmount))), 2);
  // BR-CO-15
  const grandTotal = add(taxBasisTotal, taxTotal);
  // BR-CO-16 — BT-113 is the caller's to state; it cannot be derived, and
  // defaults to absent rather than to zero.
  const prepaid = draft.totals?.prepaid;
  // BT-114 is the caller's too: rounding to a cash unit is a decision, not
  // arithmetic. BT-111 needs an exchange rate this library does not have.
  const rounding = draft.totals?.rounding;
  const taxTotalInTaxCurrency = draft.totals?.taxTotalInTaxCurrency;
  const duePayable = round(
    add(sub(grandTotal, prepaid === undefined ? dec(0) : dec(prepaid)), rounding === undefined ? dec(0) : dec(rounding)),
    2,
  );

  return {
    lineTotal: toFixed(lineTotal, 2),
    // BT-107 and BT-108 are emitted only when there is a group behind them:
    // a total with no group is exactly what BR-CO-11 / BR-CO-12 reject.
    ...((draft.allowances ?? []).length > 0 ? { allowanceTotal: toFixed(allowanceTotal, 2) } : {}),
    ...((draft.charges ?? []).length > 0 ? { chargeTotal: toFixed(chargeTotal, 2) } : {}),
    taxBasisTotal: toFixed(taxBasisTotal, 2),
    taxTotal: toFixed(taxTotal, 2),
    ...(taxTotalInTaxCurrency !== undefined ? { taxTotalInTaxCurrency } : {}),
    ...(rounding !== undefined ? { rounding } : {}),
    grandTotal: toFixed(grandTotal, 2),
    ...(prepaid !== undefined ? { prepaid } : {}),
    duePayable: toFixed(duePayable, 2),
  };
}

// --- reporting what the caller had that we disagree with ---------------------

// The three totals that inherit BT-117's rounding: BT-110 is the sum of the
// calculated amounts, and BT-112 and BT-115 are built on it. Each group's own
// BT-117 is accepted within a cent (see `withinACent`), so their sum can differ
// legitimately by a cent per group — comparing these exactly would cancel that
// slack and refuse the very documents it exists to accept. The other four
// totals are sums of amounts the caller supplied verbatim, with no rate
// multiplication and so no rounding tie: those stay exact.
const VAT_DERIVED_TOTALS: readonly (typeof REPORTED_TOTALS)[number][] = ['taxTotal', 'grandTotal', 'duePayable'];

const CENT: Decimal = { units: 1n, scale: 2 };

function compare(draft: NormalizedDraft, computed: ParsedInvoice): TotalsError[] {
  const errors: TotalsError[] = [];
  const vatTolerance = mul(CENT, dec(computed.taxBreakdown.length));

  for (const key of REPORTED_TOTALS) {
    const given = draft.totals?.[key];
    if (given === undefined) continue;
    // `?? '0'` and not a skip: a stated BT-107 that the derived document drops
    // for want of any allowance group is precisely the BR-CO-11 disagreement.
    const value = computed.totals[key] ?? '0';
    const agrees = VAT_DERIVED_TOTALS.includes(key) ? within(given, value, vatTolerance) : sameCents(given, value);
    if (!agrees) errors.push(mismatch(`totals.${key}`, given, value));
  }

  // Driven from the derived lines, which are a 1:1 map of the draft's: indexing
  // the other way round would need an assertion that the element exists.
  computed.lines.forEach((line, index) => {
    const given = draft.lines[index]?.lineTotal;
    if (given !== undefined && !sameCents(given, line.lineTotal)) {
      errors.push(mismatch(`lines[${index}].lineTotal`, given, line.lineTotal));
    }
  });

  (draft.taxBreakdown ?? []).forEach((tb, index) => {
    const match = computed.taxBreakdown.find((entry) => vatKey(entry.category, entry.rate) === vatKey(tb.category, tb.rate));
    if (!match) return;

    if (tb.basisAmount !== undefined && !sameCents(tb.basisAmount, match.basisAmount)) {
      errors.push(mismatch(`taxBreakdown[${index}].basisAmount`, tb.basisAmount, match.basisAmount));
    }
    // One cent of slack, on this figure only. BT-117 is the one derived amount
    // two correct implementations can legitimately disagree on: rounding a
    // half-cent tie is a convention (half away from zero here, half-even or a
    // float's representation elsewhere). Reporting that as a disagreement would
    // refuse a document both validateEn16931 and the Schematron accept —
    // BR-CO-17 itself tolerates a full currency unit, which is far too wide to
    // catch anything real, so it is not used as the bound.
    if (tb.calculatedAmount !== undefined && !within(tb.calculatedAmount, match.calculatedAmount, CENT)) {
      errors.push(mismatch(`taxBreakdown[${index}].calculatedAmount`, tb.calculatedAmount, match.calculatedAmount));
    }
  });

  return errors;
}

/** Equality as the Schematron sees it: both sides rounded to cents, then compared exactly. */
function sameCents(given: string, computed: string): boolean {
  return cmp(round(dec(given), 2), round(dec(computed), 2)) === 0;
}

function within(given: string, computed: string, tolerance: Decimal): boolean {
  return cmp(abs(sub(round(dec(given), 2), round(dec(computed), 2))), tolerance) <= 0;
}

function mismatch(field: string, given: string, computed: string): TotalsError {
  return {
    code: 'TOTALS_MISMATCH',
    field,
    message: `${field}: stated ${toFixed(dec(given), 2)}, derived ${toFixed(dec(computed), 2)}`,
    given,
    computed,
  };
}

// --- helpers -----------------------------------------------------------------

function sumGroups(groups: readonly Group[] | undefined): Decimal {
  return round(sum((groups ?? []).map((g) => dec(g.amount))), 2);
}
