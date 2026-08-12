// src/types/pdf.ts
// PDF types.

import type { FacturXMetadata } from './profiles.js';
import type { FacturXInvoice } from './invoice.js';
import type { ValidationOptions } from './validation.js';

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
  /**
   * Réglage de la validation EN 16931, appliquée avant écriture pour le profil
   * `EN 16931`. Voir `ValidationOptions` — activer `validateBusinessProcess`
   * pour le socle réglementaire français.
   */
  readonly validation?: ValidationOptions;
}
