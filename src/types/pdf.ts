// src/types/pdf.ts
// PDF types.

import type { FacturXMetadata } from './profiles.js';
import type { FacturXInvoice } from './invoice.js';

export interface ParseResult {
  readonly invoice: FacturXInvoice;
  readonly metadata: FacturXMetadata;
  readonly rawXml: Uint8Array;
}

export interface GenerateOptions {
  readonly invoice: FacturXInvoice;
  readonly profile: FacturXMetadata['conformanceLevel'];
  /** PDF visuel source (PDF/A-2b ou A-3b). Si absent, un template minimal est généré. */
  readonly visualPdf?: Uint8Array;
}
