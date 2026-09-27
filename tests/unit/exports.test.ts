// Every type the library declares for its callers must be reachable from the
// package entry point. 0.3.0 shipped without DecimalInput and ParsedInvoice —
// the very type parse returns — and a consumer had to redeclare them.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', 'src');
const index = readFileSync(join(root, 'index.ts'), 'utf8');
const exportedNames = new Set([...index.matchAll(/\b([A-Z]\w*)\b/g)].map((m) => m[1]));

function declaredTypes(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const declared = [...text.matchAll(/^export (?:interface|type) (\w+)/gm)].map((m) => m[1]!);
  // Re-exports too: DecimalInput lives in src/decimal.ts and is re-exported
  // from types/invoice.ts, which is exactly how 0.3.0 lost it.
  const reexported = [...text.matchAll(/^export type \{([^}]+)\} from/gm)].flatMap((m) =>
    m[1]!.split(',').map((name) => name.trim()).filter(Boolean),
  );
  // And types pulled in from outside src/types to shape a public type:
  // ExtractResult.filename is a FacturXAttachmentName from src/pdf/filespec.ts.
  const importedFromOutside = [...text.matchAll(/^import type \{([^}]+)\} from '\.\.\/(?!types\/)[^']+';/gm)].flatMap((m) =>
    m[1]!.split(',').map((name) => name.trim()).filter(Boolean),
  );
  return [...declared, ...reexported, ...importedFromOutside];
}

describe('the package entry point', () => {
  it('exports every public type declared under src/types', () => {
    const dir = join(root, 'types');
    const declared = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
      .flatMap((f) => declaredTypes(join(dir, f)));
    expect(declared.length).toBeGreaterThan(30);
    expect(declared.filter((name) => !exportedNames.has(name))).toEqual([]);
  });

  it('exports the error-code and decimal types callers switch on', () => {
    for (const name of ['FacturXParseErrorCode', 'FacturXGenerateErrorCode', 'DecimalRefusal', 'DecimalError', 'NormalizeResult']) {
      expect(exportedNames.has(name), name).toBe(true);
    }
  });
});

