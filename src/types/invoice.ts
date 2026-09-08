// src/types/invoice.ts
// Invoicing model Factur-X EN 16931.

export interface FacturXInvoice {
  readonly number: string;
  readonly issueDate: Date;
  readonly currency: CurrencyCode;
  readonly typeCode: DocumentTypeCode;

  readonly seller: TradeParty;
  readonly buyer: TradeParty;
  /** BG-11 — représentant fiscal du vendeur. Seul son `vatId` (BT-63) est réglementaire. */
  readonly taxRepresentative?: TradeParty;

  readonly lines: LineItem[];
  readonly taxBreakdown: TaxBreakdown[];
  readonly totals: MonetaryTotals;

  /**
   * Document-level allowances (BG-20). Their sum is BT-107
   * (`totals.allowanceTotal`). Distinct from `LineItem.allowances` (BG-27),
   * which are already folded into the line's own `lineTotal`.
   */
  readonly allowances?: AllowanceCharge[];
  /** Document-level charges (BG-21). Their sum is BT-108 (`totals.chargeTotal`). */
  readonly charges?: AllowanceCharge[];

  readonly notes?: Note[];
  readonly billingPeriod?: BillingPeriod;
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

// ---- Types auxiliaires ----

export type CurrencyCode = 'EUR' | 'USD' | 'GBP';
export type DocumentTypeCode = '380' | '381' | '386' | '500';

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
}

export interface TradeContact {
  readonly name?: string;
  readonly phone?: string;
  readonly email?: string;
}

export interface LineItem {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly quantity: number;
  readonly unit: string; // UN/ECE Rec 20, ex: 'C62' (unité), 'H87' (pièce)
  readonly netPrice: number;
  readonly grossPrice?: number;
  readonly priceDiscount?: number;
  readonly lineTotal: number;
  readonly vatCategory: VatCategoryCode;
  readonly vatRate: number;
  readonly allowances?: AllowanceCharge[];
  readonly charges?: AllowanceCharge[];

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
  /** EXT-FR-FE-BG-06 — preceding invoice reference specific to this line, distinct from the document-level `precedingInvoices`. EXTENDED only. */
  readonly precedingInvoice?: PrecedingInvoice;
}

export type VatCategoryCode = 'S' | 'E' | 'Z' | 'G' | 'O' | 'K' | 'AE';

export interface AllowanceCharge {
  readonly amount: number;
  readonly reason?: string;
  readonly reasonCode?: string;
  readonly basisAmount?: number;
  readonly percent?: number;
  readonly vatCategory: VatCategoryCode;
  readonly vatRate: number;
}

export interface TaxBreakdown {
  readonly type: 'VAT';
  readonly category: VatCategoryCode;
  readonly rate: number;
  readonly basisAmount: number;
  readonly calculatedAmount: number;
  readonly exemptionReason?: string;
  readonly exemptionReasonCode?: string;
  readonly dueDateTypeCode?: string;
}

export interface MonetaryTotals {
  /**
   * BT-106 — sum of the line net amounts.
   *
   * Optional because MINIMUM has no `ram:LineTotalAmount`: it carries no lines,
   * and stating a sum of nothing as 0 would be a fabricated figure rather than
   * a missing one. Mandatory at EN 16931 (BR-CO-10), where `validateEn16931`
   * requires it.
   */
  readonly lineTotal?: number;
  readonly allowanceTotal?: number;
  readonly chargeTotal?: number;
  readonly taxBasisTotal: number;
  readonly taxTotal: number;
  readonly grandTotal: number;
  readonly prepaid?: number;
  readonly duePayable: number;
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
