// src/normalize.ts
// The one place a caller's numbers are checked and turned into decimals.
//
// The Elixir sibling's `Facturx.Invoice.new/1`: every amount, quantity and
// rate is parsed once, every problem is reported with the path that locates
// it, and what comes out carries canonical decimal strings. `serialize`,
// `validateEn16931` and `computeTotals` all start here, so a NaN, an
// `Infinity`, a malformed string or a drifted float is refused the same way
// whichever entry point it reaches.

import { describeRefusal, parseDecimal, toText, type DecimalInput, type DecimalRefusal } from './decimal.js';
import type {
  AllowanceCharge,
  FacturXInvoice,
  LineItem,
  MonetaryTotals,
  ParsedInvoice,
  TaxBreakdown,
} from './types/invoice.js';
import type { DraftInvoice } from './types/totals.js';

export interface DecimalError {
  /** Dotted path, e.g. `lines[2].netPrice`, `totals.grandTotal`. */
  readonly field: string;
  readonly reason: DecimalRefusal;
  readonly message: string;
}

export type NormalizeResult =
  | { readonly ok: true; readonly invoice: ParsedInvoice }
  | { readonly ok: false; readonly errors: readonly DecimalError[] };

/**
 * Check every decimal in an invoice and return it with canonical decimal strings.
 *
 * Numbers are accepted when they are finite and show no float drift (at most
 * six decimals — `0.1 + 0.2` is refused); strings when they are `xsd:decimal`.
 * The canonical form keeps the value's own scale: `100`, `"100.00"` and
 * `"+100.00"` become `"100"`, `"100.00"` and `"100.00"`. Returns every problem,
 * not the first.
 */
export function normalizeInvoice(invoice: FacturXInvoice): NormalizeResult {
  const { errors, value } = normalizeTree(invoice);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, invoice: value as ParsedInvoice };
}

/** A `DraftInvoice` whose decimals are canonical strings — what `computeTotals` works on. */
export interface NormalizedDraft extends Omit<ParsedInvoice, 'lines' | 'taxBreakdown' | 'totals'> {
  readonly lines: readonly (Omit<LineItem<string>, 'lineTotal'> & { readonly lineTotal?: string })[];
  readonly taxBreakdown?: readonly (Omit<TaxBreakdown<string>, 'type' | 'basisAmount' | 'calculatedAmount'> & {
    readonly type?: 'VAT';
    readonly basisAmount?: string;
    readonly calculatedAmount?: string;
  })[];
  readonly totals?: Partial<MonetaryTotals<string>>;
}

export function normalizeDraft(
  draft: DraftInvoice,
): { readonly ok: true; readonly draft: NormalizedDraft } | { readonly ok: false; readonly errors: readonly DecimalError[] } {
  const { errors, value } = normalizeTree(draft);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, draft: value as NormalizedDraft };
}

function normalizeTree(tree: FacturXInvoice | DraftInvoice): { errors: DecimalError[]; value: unknown } {
  const errors: DecimalError[] = [];
  const value = convertDecimals(tree, (input, field) => {
    const parsed = parseDecimal(input);
    if (parsed.ok) return toText(parsed.value);
    errors.push({ field, reason: parsed.reason, message: `${field}: ${describeRefusal(input, parsed.reason)}` });
    return '0';
  });
  return { errors, value };
}

type Convert = (value: DecimalInput, field: string) => string;

/**
 * Rebuild an invoice with every decimal field passed through `convert`.
 *
 * Structural rather than generic over `D`: it also carries the draft shapes of
 * `computeTotals`, whose derivable fields are optional, so a field is converted
 * when present and left absent otherwise.
 */
function convertDecimals(source: FacturXInvoice | DraftInvoice, convert: Convert): unknown {
  // Read through the full invoice shape: a draft differs only in fields being
  // optional, and every access below already treats them as possibly absent.
  const invoice = source as FacturXInvoice;
  const opt = (value: DecimalInput | undefined, field: string): string | undefined =>
    value === undefined ? undefined : convert(value, field);

  const groups = (list: readonly AllowanceCharge[] | undefined, prefix: string) =>
    list?.map((ac, i) =>
      compact({
        ...ac,
        amount: convert(ac.amount, `${prefix}[${i}].amount`),
        basisAmount: opt(ac.basisAmount, `${prefix}[${i}].basisAmount`),
        percent: opt(ac.percent, `${prefix}[${i}].percent`),
        vatRate: convert(ac.vatRate, `${prefix}[${i}].vatRate`),
      }),
    );

  const lines = invoice.lines.map((line: LineItem, i) =>
    compact({
      ...line,
      quantity: convert(line.quantity, `lines[${i}].quantity`),
      netPrice: convert(line.netPrice, `lines[${i}].netPrice`),
      grossPrice: opt(line.grossPrice, `lines[${i}].grossPrice`),
      priceDiscount: opt(line.priceDiscount, `lines[${i}].priceDiscount`),
      // Optional on a draft line: converted when present, like every field.
      lineTotal: opt(line.lineTotal as DecimalInput | undefined, `lines[${i}].lineTotal`),
      vatRate: convert(line.vatRate, `lines[${i}].vatRate`),
      allowances: groups(line.allowances, `lines[${i}].allowances`),
      charges: groups(line.charges, `lines[${i}].charges`),
    }),
  );

  const taxBreakdown = (invoice.taxBreakdown as readonly TaxBreakdown[] | undefined)?.map(
    (tb, i) =>
      compact({
        ...tb,
        rate: convert(tb.rate, `taxBreakdown[${i}].rate`),
        basisAmount: opt(tb.basisAmount as DecimalInput | undefined, `taxBreakdown[${i}].basisAmount`),
        calculatedAmount: opt(tb.calculatedAmount as DecimalInput | undefined, `taxBreakdown[${i}].calculatedAmount`),
      }),
  );

  const totals = invoice.totals as FacturXInvoice['totals'] | undefined;
  const convertedTotals =
    totals &&
    compact({
      lineTotal: opt(totals.lineTotal, 'totals.lineTotal'),
      allowanceTotal: opt(totals.allowanceTotal, 'totals.allowanceTotal'),
      chargeTotal: opt(totals.chargeTotal, 'totals.chargeTotal'),
      taxBasisTotal: opt(totals.taxBasisTotal as DecimalInput | undefined, 'totals.taxBasisTotal'),
      taxTotal: opt(totals.taxTotal, 'totals.taxTotal'),
      taxTotalInTaxCurrency: opt(totals.taxTotalInTaxCurrency, 'totals.taxTotalInTaxCurrency'),
      rounding: opt(totals.rounding, 'totals.rounding'),
      grandTotal: opt(totals.grandTotal as DecimalInput | undefined, 'totals.grandTotal'),
      prepaid: opt(totals.prepaid, 'totals.prepaid'),
      duePayable: opt(totals.duePayable as DecimalInput | undefined, 'totals.duePayable'),
    });

  return compact({
    ...invoice,
    lines,
    taxBreakdown,
    totals: convertedTotals,
    allowances: groups(invoice.allowances, 'allowances'),
    charges: groups(invoice.charges, 'charges'),
  });
}

/** `T` with every possibly-undefined property made optional instead — what `compact` returns. */
type Compact<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] } & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/** Drop keys whose value is undefined, so a converted object has the same keys as its source. */
function compact<T extends object>(value: T): Compact<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Compact<T>;
}
