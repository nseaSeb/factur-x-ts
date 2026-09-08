// src/types/totals.ts
// Input and result shapes for the document arithmetic (`computeTotals`).

import type { FacturXInvoice, LineItem, MonetaryTotals, TaxBreakdown } from './invoice.js';

/**
 * A line whose BT-131 has not been worked out yet.
 *
 * `lineTotal` may still be given: it is then compared against the derived
 * figure and reported as a divergence rather than silently kept.
 */
export interface DraftLineItem extends Omit<LineItem, 'lineTotal'> {
  readonly lineTotal?: number;
}

/**
 * A VAT breakdown entry carrying only what cannot be derived.
 *
 * `category` and `rate` are required — they are what groups the entry, and
 * nothing in the document implies them. `exemptionReason` / `exemptionReasonCode`
 * (BT-120 / BT-121) are the reason a caller supplies an entry at all: they are
 * merged into the derived entry, not overwritten.
 */
export interface DraftTaxBreakdown extends Omit<TaxBreakdown, 'type' | 'basisAmount' | 'calculatedAmount'> {
  readonly type?: 'VAT';
  readonly basisAmount?: number;
  readonly calculatedAmount?: number;
}

/** An invoice with the arithmetic left out — the input of `computeTotals`. */
export interface DraftInvoice extends Omit<FacturXInvoice, 'lines' | 'taxBreakdown' | 'totals'> {
  readonly lines: readonly DraftLineItem[];
  readonly taxBreakdown?: readonly DraftTaxBreakdown[];
  readonly totals?: Partial<MonetaryTotals>;
}

export type TotalsErrorCode =
  /** No lines: nothing implies the amounts, and deriving zero would be a lie. */
  | 'NO_LINES'
  /** A breakdown entry whose category/rate matches no line, allowance or charge. */
  | 'ORPHAN_TAX_BREAKDOWN'
  /** Two supplied breakdown entries share a category and rate: one would silently win. */
  | 'DUPLICATE_TAX_BREAKDOWN'
  /** NaN or Infinity reached an amount. Adding those propagates instead of failing. */
  | 'NOT_A_FINITE_AMOUNT'
  /** A figure the caller stated disagrees with the derived one. */
  | 'TOTALS_MISMATCH';

export interface TotalsError {
  readonly code: TotalsErrorCode;
  /** Dotted path, e.g. `totals.grandTotal`, `lines[0].lineTotal`, `taxBreakdown[1].basisAmount`. */
  readonly field: string;
  readonly message: string;
  /** Present on `TOTALS_MISMATCH` only: what the caller stated. */
  readonly given?: number;
  /** Present on `TOTALS_MISMATCH` only: what the arithmetic gives. */
  readonly computed?: number;
}

export type TotalsResult =
  | { readonly ok: true; readonly invoice: FacturXInvoice }
  | { readonly ok: false; readonly errors: readonly TotalsError[] };

export interface TotalsOptions {
  /**
   * Take the computed figures even where the caller's disagree.
   *
   * Off by default: a disagreement is reported, never resolved. A wrong figure
   * usually means the caller and the library disagree about the invoice, not
   * about arithmetic.
   */
  readonly overwrite?: boolean;
}
