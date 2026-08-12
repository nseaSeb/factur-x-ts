// src/types/invoice.ts
// Invoicing model Factur-X EN 16931.

export interface FacturXInvoice {
  readonly number: string;
  readonly issueDate: Date;
  readonly currency: CurrencyCode;
  readonly typeCode: DocumentTypeCode;

  readonly seller: TradeParty;
  readonly buyer: TradeParty;

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
}

// ---- Types auxiliaires ----

export type CurrencyCode = 'EUR' | 'USD' | 'GBP';
export type DocumentTypeCode = '380' | '381' | '386' | '500';

export interface TradeParty {
  readonly name: string;
  readonly vatId?: string;
  readonly address: PostalAddress;
  readonly contact?: TradeContact;
}

export interface PostalAddress {
  readonly lineOne: string;
  readonly lineTwo?: string;
  readonly lineThree?: string;
  readonly postcode: string;
  readonly city: string;
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
  readonly lineTotal: number;
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
