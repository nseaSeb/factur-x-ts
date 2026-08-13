// src/xml/serializer.ts
// FacturXInvoice → CII XML (UN/CEFACT SCRDM D22B), EN 16931 mapping.

import type {
  FacturXInvoice,
  TradeParty,
  LineItem,
  AllowanceCharge,
  TaxBreakdown,
  PaymentMean,
  PrecedingInvoice,
  Note,
} from '../types/invoice.js';
import type { Profile } from '../types/profiles.js';

const GUIDELINE_URN: Record<Profile, string> = {
  MINIMUM: 'urn:factur-x.eu:1p0:minimum',
  'BASIC WL': 'urn:factur-x.eu:1p0:basicwl',
  BASIC: 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic',
  'EN 16931': 'urn:cen.eu:en16931:2017',
  EXTENDED: 'urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended',
};

export class FacturXSerializeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FacturXSerializeError';
  }
}

export function serialize(invoice: FacturXInvoice, profile: Profile): string {
  const currency = invoice.currency;

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<rsm:CrossIndustryInvoice ` +
    `xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" ` +
    `xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" ` +
    `xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" ` +
    `xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">` +
    buildExchangedDocumentContext(invoice, profile) +
    buildExchangedDocument(invoice) +
    buildSupplyChainTradeTransaction(invoice, currency) +
    `</rsm:CrossIndustryInvoice>`;

  return body;
}

// ---- ExchangedDocumentContext ----

function buildExchangedDocumentContext(invoice: FacturXInvoice, profile: Profile): string {
  const businessProcess = invoice.businessProcess
    ? `<ram:BusinessProcessSpecifiedDocumentContextParameter>` +
      el('ram:ID', invoice.businessProcess) +
      `</ram:BusinessProcessSpecifiedDocumentContextParameter>`
    : '';

  const guideline =
    `<ram:GuidelineSpecifiedDocumentContextParameter>` +
    el('ram:ID', GUIDELINE_URN[profile]) +
    `</ram:GuidelineSpecifiedDocumentContextParameter>`;

  return `<rsm:ExchangedDocumentContext>${businessProcess}${guideline}</rsm:ExchangedDocumentContext>`;
}

// ---- ExchangedDocument ----

function buildExchangedDocument(invoice: FacturXInvoice): string {
  const notes = (invoice.notes ?? []).map(buildNote).join('');

  return (
    `<rsm:ExchangedDocument>` +
    el('ram:ID', invoice.number) +
    el('ram:TypeCode', invoice.typeCode) +
    elDate102('ram:IssueDateTime', 'udt:DateTimeString', invoice.issueDate) +
    notes +
    `</rsm:ExchangedDocument>`
  );
}

function buildNote(note: Note): string {
  const subjectCode = note.subjectCode ? el('ram:SubjectCode', note.subjectCode) : '';
  return `<ram:IncludedNote>${el('ram:Content', note.content)}${subjectCode}</ram:IncludedNote>`;
}

// ---- SupplyChainTradeTransaction ----

function buildSupplyChainTradeTransaction(invoice: FacturXInvoice, currency: string): string {
  const lineItems = invoice.lines.map((line) => buildLineItem(line, currency)).join('');

  return (
    `<rsm:SupplyChainTradeTransaction>` +
    lineItems +
    buildApplicableHeaderTradeAgreement(invoice) +
    `<ram:ApplicableHeaderTradeDelivery/>` +
    buildApplicableHeaderTradeSettlement(invoice, currency) +
    `</rsm:SupplyChainTradeTransaction>`
  );
}

// ---- Line items ----

function buildLineItem(line: LineItem, currency: string): string {
  const priceDiscount =
    line.grossPrice !== undefined && line.priceDiscount !== undefined
      ? `<ram:AppliedTradeAllowanceCharge>` +
        `<ram:ChargeIndicator>${elIndicator(false)}</ram:ChargeIndicator>` +
        elAmount('ram:ActualAmount', line.priceDiscount, currency) +
        `</ram:AppliedTradeAllowanceCharge>`
      : '';

  const grossPrice =
    line.grossPrice !== undefined
      ? `<ram:GrossPriceProductTradePrice>` +
        elAmount('ram:ChargeAmount', line.grossPrice, currency) +
        priceDiscount +
        `</ram:GrossPriceProductTradePrice>`
      : '';

  const settlementAllowancesCharges = [
    ...(line.allowances ?? []).map((ac) => buildTradeAllowanceCharge(ac, false, currency)),
    ...(line.charges ?? []).map((ac) => buildTradeAllowanceCharge(ac, true, currency)),
  ].join('');

  const description = line.description ? el('ram:Description', line.description) : '';

  return (
    `<ram:IncludedSupplyChainTradeLineItem>` +
    `<ram:AssociatedDocumentLineDocument>${el('ram:LineID', line.id)}</ram:AssociatedDocumentLineDocument>` +
    `<ram:SpecifiedTradeProduct>${el('ram:Name', line.name)}${description}</ram:SpecifiedTradeProduct>` +
    `<ram:SpecifiedLineTradeAgreement>` +
    grossPrice +
    `<ram:NetPriceProductTradePrice>${elAmount('ram:ChargeAmount', line.netPrice, currency)}</ram:NetPriceProductTradePrice>` +
    `</ram:SpecifiedLineTradeAgreement>` +
    `<ram:SpecifiedLineTradeDelivery>` +
    `<ram:BilledQuantity unitCode="${xmlEscape(line.unit)}">${formatQuantity(line.quantity)}</ram:BilledQuantity>` +
    `</ram:SpecifiedLineTradeDelivery>` +
    `<ram:SpecifiedLineTradeSettlement>` +
    `<ram:ApplicableTradeTax>` +
    el('ram:TypeCode', 'VAT') +
    el('ram:CategoryCode', line.vatCategory) +
    el('ram:RateApplicablePercent', formatAmount(line.vatRate)) +
    `</ram:ApplicableTradeTax>` +
    settlementAllowancesCharges +
    `<ram:SpecifiedTradeSettlementLineMonetarySummation>` +
    elAmount('ram:LineTotalAmount', line.lineTotal, currency) +
    `</ram:SpecifiedTradeSettlementLineMonetarySummation>` +
    `</ram:SpecifiedLineTradeSettlement>` +
    `</ram:IncludedSupplyChainTradeLineItem>`
  );
}

function buildTradeAllowanceCharge(ac: AllowanceCharge, isCharge: boolean, currency: string): string {
  const calculationPercent = ac.percent !== undefined ? el('ram:CalculationPercent', formatAmount(ac.percent)) : '';
  const basisAmount = ac.basisAmount !== undefined ? elAmount('ram:BasisAmount', ac.basisAmount, currency) : '';
  const reasonCode = ac.reasonCode ? el('ram:ReasonCode', ac.reasonCode) : '';
  const reason = ac.reason ? el('ram:Reason', ac.reason) : '';

  return (
    `<ram:SpecifiedTradeAllowanceCharge>` +
    `<ram:ChargeIndicator>${elIndicator(isCharge)}</ram:ChargeIndicator>` +
    calculationPercent +
    basisAmount +
    elAmount('ram:ActualAmount', ac.amount, currency) +
    reasonCode +
    reason +
    `<ram:CategoryTradeTax>` +
    el('ram:TypeCode', 'VAT') +
    el('ram:CategoryCode', ac.vatCategory) +
    el('ram:RateApplicablePercent', formatAmount(ac.vatRate)) +
    `</ram:CategoryTradeTax>` +
    `</ram:SpecifiedTradeAllowanceCharge>`
  );
}

// ---- ApplicableHeaderTradeAgreement ----

function buildApplicableHeaderTradeAgreement(invoice: FacturXInvoice): string {
  const taxRepresentative = invoice.taxRepresentative
    ? buildTradeParty(invoice.taxRepresentative, 'ram:SellerTaxRepresentativeTradeParty')
    : '';

  return (
    `<ram:ApplicableHeaderTradeAgreement>` +
    buildTradeParty(invoice.seller, 'ram:SellerTradeParty', SELLER_GLOBAL_ID_SCHEME) +
    buildTradeParty(invoice.buyer, 'ram:BuyerTradeParty') +
    // CII sequence: SellerTaxRepresentativeTradeParty follows BuyerTradeParty.
    taxRepresentative +
    `</ram:ApplicableHeaderTradeAgreement>`
  );
}

/** BT-30-1 / BT-47-1 — SIRENE. */
const LEGAL_ID_SCHEME = '0002';
/** BT-29d-1 — French VAT group (assujetti unique). Seller only, per the annexe. */
const SELLER_GLOBAL_ID_SCHEME = '0231';

function buildTradeParty(party: TradeParty, tag: string, defaultGlobalScheme?: string): string {
  const contact = party.contact
    ? `<ram:DefinedTradeContact>` +
      (party.contact.name ? el('ram:PersonName', party.contact.name) : '') +
      (party.contact.phone
        ? `<ram:TelephoneUniversalCommunication>${el('ram:CompleteNumber', party.contact.phone)}</ram:TelephoneUniversalCommunication>`
        : '') +
      (party.contact.email
        ? `<ram:EmailURIUniversalCommunication>${el('ram:URIID', party.contact.email)}</ram:EmailURIUniversalCommunication>`
        : '') +
      `</ram:DefinedTradeContact>`
    : '';

  const address = party.address;
  const postalAddress =
    `<ram:PostalTradeAddress>` +
    el('ram:PostcodeCode', address.postcode) +
    el('ram:LineOne', address.lineOne) +
    (address.lineTwo ? el('ram:LineTwo', address.lineTwo) : '') +
    (address.lineThree ? el('ram:LineThree', address.lineThree) : '') +
    el('ram:CityName', address.city) +
    el('ram:CountryID', address.country) +
    `</ram:PostalTradeAddress>`;

  const taxRegistration = party.vatId
    ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${xmlEscape(party.vatId)}</ram:ID></ram:SpecifiedTaxRegistration>`
    : '';

  // TradePartyType sequence: GlobalID, Name, SpecifiedLegalOrganization,
  // DefinedTradeContact, PostalTradeAddress, SpecifiedTaxRegistration.
  const globalScheme = party.globalScheme ?? defaultGlobalScheme;
  const globalId =
    party.globalId !== undefined
      ? `<ram:GlobalID${globalScheme !== undefined ? ` schemeID="${xmlEscape(globalScheme)}"` : ''}>${xmlEscape(party.globalId)}</ram:GlobalID>`
      : '';

  const legalOrganization =
    party.legalId !== undefined
      ? `<ram:SpecifiedLegalOrganization>` +
        `<ram:ID schemeID="${xmlEscape(party.legalScheme ?? LEGAL_ID_SCHEME)}">${xmlEscape(party.legalId)}</ram:ID>` +
        `</ram:SpecifiedLegalOrganization>`
      : '';

  return `<${tag}>${globalId}${el('ram:Name', party.name)}${legalOrganization}${contact}${postalAddress}${taxRegistration}</${tag}>`;
}

// ---- ApplicableHeaderTradeSettlement ----

function buildApplicableHeaderTradeSettlement(invoice: FacturXInvoice, currency: string): string {
  const paymentMeans = (invoice.paymentMeans ?? []).map(buildPaymentMeans).join('');
  const taxes = invoice.taxBreakdown
    .map((tb) => buildTradeTax(tb, currency, invoice.taxDueDateTypeCode))
    .join('');
  const billingPeriod = invoice.billingPeriod
    ? `<ram:BillingSpecifiedPeriod>` +
      elDate102('ram:StartDateTime', 'udt:DateTimeString', invoice.billingPeriod.startDate) +
      elDate102('ram:EndDateTime', 'udt:DateTimeString', invoice.billingPeriod.endDate) +
      `</ram:BillingSpecifiedPeriod>`
    : '';
  const precedingInvoices = (invoice.precedingInvoices ?? []).map(buildPrecedingInvoice).join('');

  // Document-level allowances/charges (BG-20/BG-21) — the groups BT-107 and
  // BT-108 in the monetary summation below are the totals of.
  const allowancesCharges = [
    ...(invoice.allowances ?? []).map((ac) => buildTradeAllowanceCharge(ac, false, currency)),
    ...(invoice.charges ?? []).map((ac) => buildTradeAllowanceCharge(ac, true, currency)),
  ].join('');

  return (
    `<ram:ApplicableHeaderTradeSettlement>` +
    el('ram:InvoiceCurrencyCode', currency) +
    paymentMeans +
    taxes +
    billingPeriod +
    // CII D22B sequence: SpecifiedTradeAllowanceCharge sits between
    // BillingSpecifiedPeriod and SpecifiedTradeSettlementHeaderMonetarySummation.
    // Order is schema-significant and no XSD check runs here — do not reorder.
    allowancesCharges +
    buildMonetarySummation(invoice.totals, currency) +
    precedingInvoices +
    `</ram:ApplicableHeaderTradeSettlement>`
  );
}

function buildPaymentMeans(pm: PaymentMean): string {
  const card = pm.cardId
    ? `<ram:ApplicableTradeSettlementFinancialCard>` +
      el('ram:ID', pm.cardId) +
      (pm.cardholderName ? el('ram:CardholderName', pm.cardholderName) : '') +
      `</ram:ApplicableTradeSettlementFinancialCard>`
    : '';

  const payerAccount = pm.payerIban
    ? `<ram:PayerPartyDebtorFinancialAccount>${el('ram:IBANID', pm.payerIban)}</ram:PayerPartyDebtorFinancialAccount>`
    : '';

  const payeeAccount = pm.iban
    ? `<ram:PayeePartyCreditorFinancialAccount>` +
      el('ram:IBANID', pm.iban) +
      (pm.accountName ? el('ram:AccountName', pm.accountName) : '') +
      `</ram:PayeePartyCreditorFinancialAccount>`
    : '';

  const payeeInstitution = pm.bic
    ? `<ram:PayeeSpecifiedCreditorFinancialInstitution>${el('ram:BICID', pm.bic)}</ram:PayeeSpecifiedCreditorFinancialInstitution>`
    : '';

  return (
    `<ram:SpecifiedTradeSettlementPaymentMeans>` +
    el('ram:TypeCode', pm.typeCode) +
    card +
    payerAccount +
    payeeAccount +
    payeeInstitution +
    `</ram:SpecifiedTradeSettlementPaymentMeans>`
  );
}

function buildTradeTax(tb: TaxBreakdown, currency: string, invoiceTaxDueDateTypeCode: string | undefined): string {
  const exemptionReason = tb.exemptionReason ? el('ram:ExemptionReason', tb.exemptionReason) : '';
  const exemptionReasonCode = tb.exemptionReasonCode ? el('ram:ExemptionReasonCode', tb.exemptionReasonCode) : '';
  // Per-breakdown value overrides the invoice-wide French mandate default (BT-8).
  const dueDateTypeCode = tb.dueDateTypeCode ?? invoiceTaxDueDateTypeCode;
  const dueDateTypeCodeEl = dueDateTypeCode ? el('ram:DueDateTypeCode', dueDateTypeCode) : '';

  return (
    `<ram:ApplicableTradeTax>` +
    elAmount('ram:CalculatedAmount', tb.calculatedAmount, currency) +
    el('ram:TypeCode', 'VAT') +
    exemptionReason +
    elAmount('ram:BasisAmount', tb.basisAmount, currency) +
    el('ram:CategoryCode', tb.category) +
    exemptionReasonCode +
    dueDateTypeCodeEl +
    el('ram:RateApplicablePercent', formatAmount(tb.rate)) +
    `</ram:ApplicableTradeTax>`
  );
}

function buildMonetarySummation(totals: FacturXInvoice['totals'], currency: string): string {
  const chargeTotal = totals.chargeTotal !== undefined ? elAmount('ram:ChargeTotalAmount', totals.chargeTotal, currency) : '';
  const allowanceTotal =
    totals.allowanceTotal !== undefined ? elAmount('ram:AllowanceTotalAmount', totals.allowanceTotal, currency) : '';
  const prepaid = totals.prepaid !== undefined ? elAmount('ram:TotalPrepaidAmount', totals.prepaid, currency) : '';

  return (
    `<ram:SpecifiedTradeSettlementHeaderMonetarySummation>` +
    elAmount('ram:LineTotalAmount', totals.lineTotal, currency) +
    chargeTotal +
    allowanceTotal +
    elAmount('ram:TaxBasisTotalAmount', totals.taxBasisTotal, currency) +
    elAmount('ram:TaxTotalAmount', totals.taxTotal, currency) +
    elAmount('ram:GrandTotalAmount', totals.grandTotal, currency) +
    prepaid +
    elAmount('ram:DuePayableAmount', totals.duePayable, currency) +
    `</ram:SpecifiedTradeSettlementHeaderMonetarySummation>`
  );
}

function buildPrecedingInvoice(pi: PrecedingInvoice): string {
  const issueDate = pi.issueDate
    ? elDate102('ram:FormattedIssueDateTime', 'qdt:DateTimeString', pi.issueDate)
    : '';
  return `<ram:InvoiceReferencedDocument>${el('ram:IssuerAssignedID', pi.number)}${issueDate}</ram:InvoiceReferencedDocument>`;
}

// ---- Primitives ----

function el(tag: string, text: string): string {
  return `<${tag}>${xmlEscape(text)}</${tag}>`;
}

function elAmount(tag: string, value: number, currency: string): string {
  return `<${tag} currencyID="${xmlEscape(currency)}">${formatAmount(value)}</${tag}>`;
}

function elDate102(tag: string, dateTimeStringTag: 'udt:DateTimeString' | 'qdt:DateTimeString', date: Date): string {
  return `<${tag}><${dateTimeStringTag} format="102">${formatDate102(date)}</${dateTimeStringTag}></${tag}>`;
}

function elIndicator(value: boolean): string {
  return `<udt:Indicator>${value ? 'true' : 'false'}</udt:Indicator>`;
}

function formatAmount(value: number): string {
  // Normalizes -0 to "0.00" (per IEEE 754, -0 + 0 === +0).
  return (value + 0).toFixed(2);
}

function formatQuantity(value: number): string {
  return (value + 0).toFixed(4);
}

function formatDate102(date: Date): string {
  // Date-only values are treated as UTC midnight to avoid local-timezone drift.
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${year}${month}${day}`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
