// src/types/invoice.ts
// Invoicing model Factur-X EN 16931.

import type { DecimalInput } from '../decimal.js';

export type { DecimalInput } from '../decimal.js';

/**
 * An invoice.
 *
 * Every amount, quantity and rate is a `D`: what you pass in may be a number
 * or a decimal string (`FacturXInvoice`, the default), and what the library
 * hands back — from `parse`, `deserialize`, `computeTotals` — is always a
 * canonical decimal string (`ParsedInvoice`), so no figure read from a
 * third-party document loses a digit to a float.
 */
export interface FacturXInvoice<D extends DecimalInput = DecimalInput> {
  readonly number: string;
  readonly issueDate: Date;
  readonly currency: CurrencyCode;
  readonly typeCode: DocumentTypeCode;

  /**
   * BT-6 — the VAT accounting currency, when it differs from `currency`.
   * Requires `totals.taxTotalInTaxCurrency` (BR-53) and must not equal
   * `currency`: the Schematron tells BT-110 and BT-111 apart by their
   * currency, so two identical ones are rejected. BASIC WL and above.
   */
  readonly taxCurrency?: string;

  readonly seller: TradeParty;
  readonly buyer: TradeParty;
  /** BG-11 — représentant fiscal du vendeur. Seul son `vatId` (BT-63) est réglementaire. */
  readonly taxRepresentative?: TradeParty;

  readonly lines: readonly LineItem<D>[];
  readonly taxBreakdown: readonly TaxBreakdown<D>[];
  readonly totals: MonetaryTotals<D>;

  /**
   * Document-level allowances (BG-20). Their sum is BT-107
   * (`totals.allowanceTotal`). Distinct from `LineItem.allowances` (BG-27),
   * which are already folded into the line's own `lineTotal`.
   */
  readonly allowances?: readonly AllowanceCharge<D>[];
  /** Document-level charges (BG-21). Their sum is BT-108 (`totals.chargeTotal`). */
  readonly charges?: readonly AllowanceCharge<D>[];

  readonly notes?: Note[];
  readonly billingPeriod?: BillingPeriod;
  /**
   * BG-13 — where the goods or services were delivered, when that is not the
   * buyer's address: BT-70 (`name`), BT-71 (`globalId`) and BG-15
   * (`address`). BASIC WL and above.
   */
  readonly shipTo?: TradeParty;
  /** BT-72 — the actual delivery date. BASIC WL and above. */
  readonly deliveryDate?: Date;
  readonly paymentMeans?: PaymentMean[];
  readonly precedingInvoices?: PrecedingInvoice[];

  /** Cadre de facturation français (BT-23). Ex: 'S1', 'B1' */
  readonly businessProcess?: string;
  /** Date d'exigibilité TVA (BT-8). Ex: '5', '29', '72' */
  readonly taxDueDateTypeCode?: string;

  /** BT-9 — date d'échéance de paiement. */
  readonly paymentDueDate?: Date;
  /**
   * BT-20 — conditions de paiement, texte libre (ex: '30 jours net').
   *
   * BR-CO-25 exige l'un des deux (`paymentDueDate` ou `paymentTerms`) dès que
   * `totals.duePayable` est positif.
   */
  readonly paymentTerms?: string;
}

/** What every reader returns: amounts, quantities and rates as canonical decimal strings. */
export type ParsedInvoice = FacturXInvoice<string>;

// ---- Types auxiliaires ----

/**
 * ISO 4217 alphabetic code. Any three upper-case letters are accepted; the
 * named ones are only there for autocompletion.
 */
// `string & {}` keeps the literals offered by autocompletion instead of
// collapsing the whole union into `string`.
export type CurrencyCode = 'EUR' | 'USD' | 'GBP' | 'CHF' | (string & {});
/**
 * BT-3, UNTDID 1001. The named codes are the common French ones: invoice
 * (380), credit note (381), corrected invoice (384), prepayment invoice
 * (386), self-billed invoice (389), factored invoice (393) and the
 * self-billed / factored variants (500–503). Any code is accepted; the
 * Schematron checks the list (BR-CL-01).
 */
export type DocumentTypeCode =
  | '380'
  | '381'
  | '384'
  | '386'
  | '389'
  | '393'
  | '500'
  | '501'
  | '502'
  | '503'
    | (string & {});

export interface TradeParty {
  readonly name: string;
  /** BT-31 / BT-48 — identifiant à la TVA, émis avec `schemeID="VA"`. */
  readonly vatId?: string;
  /**
   * BT-30 (vendeur) / BT-47 (acheteur) — SIREN.
   *
   * Obligatoire `1..1` pour le domestique français dès la trajectoire
   * DEMARRAGE. Émis dans `ram:SpecifiedLegalOrganization/ram:ID`.
   */
  readonly legalId?: string;
  /** BT-30-1 / BT-47-1 — schéma de `legalId`. Défaut `'0002'` (SIRENE). */
  readonly legalScheme?: string;
  /**
   * BT-29d — SIREN d'un assujetti unique (groupe TVA).
   *
   * L'annexe ne le prévoit que côté vendeur ; c'est pourquoi le schéma par
   * défaut `'0231'` n'est appliqué qu'au vendeur — l'imposer partout
   * étiquetterait par exemple un GLN d'acheteur comme un identifiant de
   * groupe TVA français.
   */
  readonly globalId?: string;
  /** BT-29d-1 — schéma de `globalId`. Défaut `'0231'` sur le vendeur seul. */
  readonly globalScheme?: string;
  /**
   * BG-5 / BG-8 — postal address.
   *
   * Optional because MINIMUM carries the seller's address and refuses every
   * other party's (BR-08 / BR-09 require the seller's; the buyer's is not in
   * the profile at all), so a party read back from such a document has none.
   * Required for both seller and buyer at EN 16931, where `validateEn16931`
   * enforces it.
   */
  readonly address?: PostalAddress;
  readonly contact?: TradeContact;
}

export interface PostalAddress {
  // Only country is mandatory in the CII schema (ram:TradeAddressType has
  // no minOccurs on CountryID, minOccurs="0" on everything else) and in
  // EN 16931's own Schematron (BR-8/BR-10/BR-12 etc. require
  // ram:PostalTradeAddress/ram:CountryID, never Postcode/LineOne/City) —
  // confirmed by reading both, not assumed. Requiring the rest
  // unconditionally would force fabricated data into any invoice built for
  // a reduced profile, or any third-party document legitimately using
  // country-only addresses.
  readonly lineOne?: string;
  readonly lineTwo?: string;
  readonly lineThree?: string;
  readonly postcode?: string;
  readonly city?: string;
  readonly country: string; // ISO 3166-1 alpha-2
  /** BT-39 / BT-54 / BT-68 / BT-79 — region, county or state. BASIC WL and above. */
  readonly countrySubdivision?: string;
}

export interface TradeContact {
  readonly name?: string;
  readonly phone?: string;
  readonly email?: string;
}

export interface LineItem<D extends DecimalInput = DecimalInput> {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly quantity: D;
  readonly unit: string; // UN/ECE Rec 20, ex: 'C62' (unité), 'H87' (pièce)
  readonly netPrice: D;
  readonly grossPrice?: D;
  readonly priceDiscount?: D;
  readonly lineTotal: D;
  readonly vatCategory: VatCategoryCode;
  readonly vatRate: D;
  readonly allowances?: readonly AllowanceCharge<D>[];
  readonly charges?: readonly AllowanceCharge<D>[];

  /**
   * French EXTENDED extensions (EXT-FR-FE-*), not EN 16931 business terms —
   * silently dropped by `serialize` for every other profile, the same way
   * the Elixir sibling's `Facturx.CII` gates them: EN 16931's XSD caps
   * `ram:IncludedNote` at one occurrence per line with no `SubjectCode`
   * (EXT-FR-FE-183), so only `notes[0]`'s content survives there.
   */
  readonly notes?: Note[];
  /** EXT-FR-FE-BG-10 — delivery address specific to this line. EXTENDED only. */
  readonly shipTo?: TradeParty;
  /** EXT-FR-FE-BG-11 — delivery date specific to this line. EXTENDED only. */
  readonly deliveryDate?: Date;
  /**
   * BG-26 — the period this line covers. BASIC and above. Note BR-FX-EN-04
   * (DE-to-DE only) is a conjunction a line period alone does not satisfy.
   */
  readonly billingPeriod?: BillingPeriod;
  /** EXT-FR-FE-BG-06 — preceding invoice reference specific to this line, distinct from the document-level `precedingInvoices`. EXTENDED only. */
  readonly precedingInvoice?: PrecedingInvoice;
}

/**
 * UNCL 5305, as EN 16931 restricts it: standard (S), zero-rated (Z), exempt (E),
 * reverse charge (AE), intra-community (K), export (G), outside scope (O),
 * Canary Islands IGIC (L) and Ceuta/Melilla IPSI (M).
 */
export type VatCategoryCode = 'S' | 'E' | 'Z' | 'G' | 'O' | 'K' | 'AE' | 'L' | 'M';

export interface AllowanceCharge<D extends DecimalInput = DecimalInput> {
  readonly amount: D;
  readonly reason?: string;
  readonly reasonCode?: string;
  readonly basisAmount?: D;
  readonly percent?: D;
  readonly vatCategory: VatCategoryCode;
  readonly vatRate: D;
}

export interface TaxBreakdown<D extends DecimalInput = DecimalInput> {
  readonly type: 'VAT';
  readonly category: VatCategoryCode;
  readonly rate: D;
  readonly basisAmount: D;
  readonly calculatedAmount: D;
  readonly exemptionReason?: string;
  readonly exemptionReasonCode?: string;
  readonly dueDateTypeCode?: string;
}

export interface MonetaryTotals<D extends DecimalInput = DecimalInput> {
  /**
   * BT-106 — sum of the line net amounts.
   *
   * Optional because MINIMUM has no `ram:LineTotalAmount`: it carries no lines,
   * and stating a sum of nothing as 0 would be a fabricated figure rather than
   * a missing one. Mandatory at EN 16931 (BR-CO-10), where `validateEn16931`
   * requires it.
   */
  readonly lineTotal?: D;
  readonly allowanceTotal?: D;
  readonly chargeTotal?: D;
  readonly taxBasisTotal: D;
  readonly taxTotal: D;
  /**
   * BT-111 — the VAT total restated in `taxCurrency`. Required when
   * `taxCurrency` is set (BR-53), never derived: it needs an exchange rate
   * this library does not have.
   */
  readonly taxTotalInTaxCurrency?: D;
  /**
   * BT-114 — rounding applied to the amount due, e.g. to a cash unit.
   * `duePayable = grandTotal - prepaid + rounding` (BR-CO-16). EN 16931 and
   * above.
   */
  readonly rounding?: D;
  readonly grandTotal: D;
  readonly prepaid?: D;
  readonly duePayable: D;
}

export interface Note {
  readonly content: string;
  readonly subjectCode?: string;
}

export interface BillingPeriod {
  readonly startDate: Date;
  readonly endDate: Date;
}

export interface PaymentMean {
  readonly typeCode: string; // UNTDID 4461
  /** BT-82 — the payment means in words, e.g. 'Virement SEPA'. EN 16931 and above. */
  readonly information?: string;
  /**
   * BT-84 in its non-IBAN form — an account identifier that is not an IBAN.
   * Written as `ram:ProprietaryID`. BASIC WL and above.
   */
  readonly accountId?: string;
  readonly iban?: string;
  readonly accountName?: string;
  readonly bic?: string;
  readonly payerIban?: string;
  readonly cardId?: string;
  readonly cardholderName?: string;
}

export interface PrecedingInvoice {
  readonly number: string;
  readonly issueDate?: Date;
}
