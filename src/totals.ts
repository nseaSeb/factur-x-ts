// src/totals.ts
// The EN 16931 document arithmetic: line amounts, the VAT breakdown and the
// document totals — BR-CO-10 to BR-CO-17.
//
// Every rule here is one the Schematron checks and the XSD does not, so the
// test that matters is not a unit test of these functions but a document put in
// front of Saxon.

import { isClose, round2 } from './amounts.js';
import type {
  AllowanceCharge,
  FacturXInvoice,
  LineItem,
  MonetaryTotals,
  TaxBreakdown,
} from './types/invoice.js';
import type {
  DraftInvoice,
  DraftLineItem,
  DraftTaxBreakdown,
  TotalsError,
  TotalsOptions,
  TotalsResult,
} from './types/totals.js';

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
 * Two amounts are never derived, because nothing in the invoice determines
 * them: BT-113 (`prepaid`) is carried through as given, and BT-114 (the
 * rounding amount) has no field in `MonetaryTotals` yet, so `duePayable` is
 * `grandTotal - prepaid` exactly as `validateEn16931` asserts it (BR-CO-16).
 */
export function computeTotals(draft: DraftInvoice, options: TotalsOptions = {}): TotalsResult {
  // Checked in order, first failure wins: an orphan-breakdown report on a
  // line-less invoice, or a sum over a NaN, says nothing useful.
  const structural =
    noLines(draft) ?? nonFiniteAmount(draft) ?? orphanBreakdown(draft) ?? duplicateBreakdown(draft);
  if (structural) return { ok: false, errors: structural };

  const lines = draft.lines.map(deriveLine);
  const taxBreakdown = deriveBreakdown(lines, draft);
  const totals = deriveTotals(lines, taxBreakdown, draft);

  const { lines: _lines, taxBreakdown: _taxBreakdown, totals: _totals, ...rest } = draft;
  const invoice: FacturXInvoice = { ...rest, lines, taxBreakdown, totals };

  const divergences = compare(draft, invoice);
  if (divergences.length > 0 && options.overwrite !== true) {
    return { ok: false, errors: divergences };
  }

  return { ok: true, invoice };
}

// --- refusing what cannot be derived, or added safely ------------------------

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

// NaN and Infinity propagate through addition rather than failing, and the
// result would be serialized as `<ram:GrandTotalAmount>NaN</ram:GrandTotalAmount>`.
// This module is the first place the library does arithmetic of its own, so it
// is the first place that has to say no. NaN is what the guard exists for
// precisely because it is *type-valid*: it satisfies `number`, so no consumer
// is stopped from passing it. Structural garbage (a missing `lines`, a `null`
// allowance list) is a different case — the types rule it out, and guarding
// every field against it would be endless.
function nonFiniteAmount(draft: DraftInvoice): TotalsError[] | undefined {
  const offender = amountPaths(draft).find(([, value]) => !Number.isFinite(value));
  if (!offender) return undefined;

  const [path, value] = offender;
  return [
    {
      code: 'NOT_A_FINITE_AMOUNT',
      field: path,
      message: `${path} is ${String(value)}, which cannot be added — every amount must be a finite number`,
    },
  ];
}

// A breakdown entry whose category/rate matches no line and no document-level
// allowance or charge. It cannot be completed — nothing implies its taxable
// amount — and dropping it would remove a declared VAT liability from the
// document without a word.
function orphanBreakdown(draft: DraftInvoice): TotalsError[] | undefined {
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
function duplicateBreakdown(draft: DraftInvoice): TotalsError[] | undefined {
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
function deriveLine(line: DraftLineItem): LineItem {
  const { lineTotal: _given, ...rest } = line;
  return { ...rest, lineTotal: deriveLineTotal(line) };
}

function deriveLineTotal(line: DraftLineItem): number {
  const base = round2(line.netPrice * line.quantity);
  return round2(base - sumAmounts(line.allowances) + sumAmounts(line.charges));
}

// --- VAT breakdown -----------------------------------------------------------

interface BreakdownMember {
  readonly key: string;
  readonly category: LineItem['vatCategory'];
  readonly rate: number;
  readonly amount: number;
}

interface BreakdownGroup {
  readonly category: LineItem['vatCategory'];
  readonly rate: number;
  readonly basis: number;
}

// One entry per category/rate. BT-116 is the sum of the line amounts in that
// group, less the document allowances and plus the document charges falling
// under the same VAT — BR-S-08 and its siblings, one per category.
//
// An entry the caller supplied is completed, never replaced: BT-120 and BT-121
// (the exemption reason and its code) cannot be derived from amounts, and
// category E is rejected without them (BR-E-10).
function deriveBreakdown(lines: readonly LineItem[], draft: DraftInvoice): TaxBreakdown[] {
  const members: BreakdownMember[] = [
    ...lines.map((line) => member(line.vatCategory, line.vatRate, line.lineTotal)),
    ...(draft.allowances ?? []).map((ac) => member(ac.vatCategory, ac.vatRate, -ac.amount)),
    ...(draft.charges ?? []).map((ac) => member(ac.vatCategory, ac.vatRate, ac.amount)),
  ];

  const declared = new Map<string, DraftTaxBreakdown>(
    (draft.taxBreakdown ?? []).map((tb) => [vatKey(tb.category, tb.rate), tb]),
  );

  // Accumulated as we go rather than collected into per-key lists: the group's
  // category and rate come from whichever member opened it, so there is never a
  // "first element of a bucket that must exist" to reach for.
  const grouped = new Map<string, BreakdownGroup>();
  for (const entry of members) {
    const bucket = grouped.get(entry.key);
    grouped.set(
      entry.key,
      bucket
        ? { ...bucket, basis: bucket.basis + entry.amount }
        : { category: entry.category, rate: entry.rate, basis: entry.amount },
    );
  }

  return [...grouped.entries()]
    .map(([key, group]): TaxBreakdown => {
      const { category, rate } = group;
      const basisAmount = round2(group.basis);

      return {
        ...declared.get(key),
        type: 'VAT',
        category,
        rate,
        basisAmount,
        // BT-117 = BT-116 × BT-119 / 100, rounded to the cent (BR-CO-17).
        calculatedAmount: round2((basisAmount * rate) / 100),
      };
    })
    // Deterministic order, so the same invoice always serializes to the same bytes.
    .sort((a, b) => a.rate - b.rate || a.category.localeCompare(b.category));
}

function member(category: LineItem['vatCategory'], rate: number, amount: number): BreakdownMember {
  return { key: vatKey(category, rate), category, rate, amount };
}

// Grouping key. Unlike the Elixir sibling — where `Decimal.new("20")` and
// `Decimal.new("20.00")` are equal numbers but distinct terms, and had to be
// normalised before grouping — a JS number has one representation per value, so
// interpolating it is already canonical: `${20.0}` and `${20}` are both "20".
function vatKey(category: string, rate: number): string {
  return `${category}|${rate}`;
}

// --- document totals ---------------------------------------------------------

function deriveTotals(
  lines: readonly LineItem[],
  breakdown: readonly TaxBreakdown[],
  draft: DraftInvoice,
): MonetaryTotals {
  const given = draft.totals;

  // BR-CO-10
  const lineTotal = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));
  const allowanceTotal = sumAmounts(draft.allowances);
  const chargeTotal = sumAmounts(draft.charges);
  // BR-CO-13
  const taxBasisTotal = round2(lineTotal - allowanceTotal + chargeTotal);
  // BR-CO-14
  const taxTotal = round2(breakdown.reduce((sum, tb) => sum + tb.calculatedAmount, 0));
  // BR-CO-15
  const grandTotal = round2(taxBasisTotal + taxTotal);
  // BR-CO-16 — BT-113 is the caller's to state; it cannot be derived, and
  // defaults to absent rather than to zero.
  const prepaid = given?.prepaid;
  const duePayable = round2(grandTotal - (prepaid ?? 0));

  return {
    lineTotal,
    // BT-107 and BT-108 are emitted only when there is a group behind them:
    // a total with no group is exactly what BR-CO-11 / BR-CO-12 reject.
    ...((draft.allowances ?? []).length > 0 ? { allowanceTotal } : {}),
    ...((draft.charges ?? []).length > 0 ? { chargeTotal } : {}),
    taxBasisTotal,
    taxTotal,
    grandTotal,
    ...(prepaid !== undefined ? { prepaid } : {}),
    duePayable,
  };
}

// --- reporting what the caller had that we disagree with ---------------------

function compare(draft: DraftInvoice, computed: FacturXInvoice): TotalsError[] {
  const errors: TotalsError[] = [];

  for (const key of REPORTED_TOTALS) {
    const given = draft.totals?.[key];
    if (given === undefined) continue;
    // `?? 0` and not a skip: a stated BT-107 that the derived document drops for
    // want of any allowance group is precisely the BR-CO-11 disagreement.
    const value = computed.totals[key] ?? 0;
    if (!isClose(given, value)) errors.push(mismatch(`totals.${key}`, given, value));
  }

  // Driven from the derived lines, which are a 1:1 map of the draft's: indexing
  // the other way round would need an assertion that the element exists.
  computed.lines.forEach((line, index) => {
    const given = draft.lines[index]?.lineTotal;
    if (given !== undefined && !isClose(given, line.lineTotal)) {
      errors.push(mismatch(`lines[${index}].lineTotal`, given, line.lineTotal));
    }
  });

  (draft.taxBreakdown ?? []).forEach((tb, index) => {
    const match = computed.taxBreakdown.find((entry) => vatKey(entry.category, entry.rate) === vatKey(tb.category, tb.rate));
    if (!match) return;

    if (tb.basisAmount !== undefined && !isClose(tb.basisAmount, match.basisAmount)) {
      errors.push(mismatch(`taxBreakdown[${index}].basisAmount`, tb.basisAmount, match.basisAmount));
    }
    // One cent of slack, on this figure only. BT-117 is the one derived amount
    // whose value two correct implementations can legitimately disagree on: a
    // half-cent tie is settled by the float representation here and by decimal
    // half-up in a Decimal-based system (see `round2`). Reporting that as a
    // disagreement would refuse a document both validateEn16931 and the
    // Schematron accept — BR-CO-17 itself tolerates a full currency unit, which
    // is far too wide to catch anything real, so it is not used as the bound.
    if (tb.calculatedAmount !== undefined && !withinACent(tb.calculatedAmount, match.calculatedAmount)) {
      errors.push(mismatch(`taxBreakdown[${index}].calculatedAmount`, tb.calculatedAmount, match.calculatedAmount));
    }
  });

  return errors;
}

function withinACent(given: number, computed: number): boolean {
  return Math.abs(round2(given) - round2(computed)) <= 0.01 + 1e-9;
}

function mismatch(field: string, given: number, computed: number): TotalsError {
  return {
    code: 'TOTALS_MISMATCH',
    field,
    message: `${field}: stated ${given.toFixed(2)}, derived ${computed.toFixed(2)}`,
    given,
    computed,
  };
}

// --- helpers -----------------------------------------------------------------

function sumAmounts(entries: readonly AllowanceCharge[] | undefined): number {
  return round2((entries ?? []).reduce((sum, entry) => sum + entry.amount, 0));
}

/** Every numeric field the arithmetic will touch, with the path to report it by. */
function amountPaths(draft: DraftInvoice): [string, number][] {
  const paths: [string, number][] = [];

  const push = (path: string, value: number | undefined): void => {
    if (value !== undefined) paths.push([path, value]);
  };

  const pushGroups = (prefix: string, groups: readonly AllowanceCharge[] | undefined): void => {
    (groups ?? []).forEach((ac, index) => {
      push(`${prefix}[${index}].amount`, ac.amount);
      push(`${prefix}[${index}].basisAmount`, ac.basisAmount);
      push(`${prefix}[${index}].percent`, ac.percent);
      push(`${prefix}[${index}].vatRate`, ac.vatRate);
    });
  };

  draft.lines.forEach((line, index) => {
    push(`lines[${index}].quantity`, line.quantity);
    push(`lines[${index}].netPrice`, line.netPrice);
    push(`lines[${index}].grossPrice`, line.grossPrice);
    push(`lines[${index}].priceDiscount`, line.priceDiscount);
    push(`lines[${index}].lineTotal`, line.lineTotal);
    push(`lines[${index}].vatRate`, line.vatRate);
    pushGroups(`lines[${index}].allowances`, line.allowances);
    pushGroups(`lines[${index}].charges`, line.charges);
  });

  pushGroups('allowances', draft.allowances);
  pushGroups('charges', draft.charges);

  (draft.taxBreakdown ?? []).forEach((tb, index) => {
    push(`taxBreakdown[${index}].rate`, tb.rate);
    push(`taxBreakdown[${index}].basisAmount`, tb.basisAmount);
    push(`taxBreakdown[${index}].calculatedAmount`, tb.calculatedAmount);
  });

  const totals = draft.totals;
  if (totals) {
    for (const key of [...REPORTED_TOTALS, 'prepaid'] as const) {
      push(`totals.${key}`, totals[key]);
    }
  }

  return paths;
}
