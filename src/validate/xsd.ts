// src/validate/xsd.ts
// Validate CII XML against the official EN 16931 / EXTENDED XSD schemas,
// bundled under schemas/xsd/ (see schemas/NOTICE.md for provenance).
//
// Uses xmllint-wasm — libxml2 compiled to WebAssembly, in-process, no native
// build step and no external server. It is an **optional** dependency: only
// installed if a caller actually validates. Install it with
// `npm install xmllint-wasm` to use validateXsd.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Profile } from '../types/profiles.js';
import type { XsdValidationError, XsdValidationOptions, XsdValidationResult } from '../types/xsd.js';
import { hasDoctype, resolveProfile, stripBom } from './shared.js';

export class FacturXXsdNotBundledError extends Error {
  constructor(profile: Profile) {
    super(
      `No bundled XSD schema for profile "${profile}".`,
    );
    this.name = 'FacturXXsdNotBundledError';
  }
}

interface SchemaBundle {
  readonly main: string;
  readonly imports: readonly string[];
}

// All five profiles ship their XSD, as the Elixir sibling does. Kept a
// Partial<Record> rather than a Record so removing one is a data change, not a
// type error, and so the not-bundled path stays reachable and tested.
const SCHEMAS: Partial<Record<Profile, SchemaBundle>> = {
  MINIMUM: {
    main: 'minimum/Factur-X_MINIMUM.xsd',
    imports: [
      'minimum/Factur-X_1.09_MINIMUM_urn_un_unece_uncefact_data_standard_QualifiedDataType_100.xsd',
      'minimum/Factur-X_1.09_MINIMUM_urn_un_unece_uncefact_data_standard_ReusableAggregateBusinessInformationEntity_100.xsd',
      'minimum/Factur-X_1.09_MINIMUM_urn_un_unece_uncefact_data_standard_UnqualifiedDataType_100.xsd',
    ],
  },
  'BASIC WL': {
    main: 'basicwl/Factur-X_BASICWL.xsd',
    imports: [
      'basicwl/Factur-X_1.09_BASICWL_urn_un_unece_uncefact_data_standard_QualifiedDataType_100.xsd',
      'basicwl/Factur-X_1.09_BASICWL_urn_un_unece_uncefact_data_standard_ReusableAggregateBusinessInformationEntity_100.xsd',
      'basicwl/Factur-X_1.09_BASICWL_urn_un_unece_uncefact_data_standard_UnqualifiedDataType_100.xsd',
    ],
  },
  BASIC: {
    main: 'basic/Factur-X_BASIC.xsd',
    imports: [
      'basic/Factur-X_1.09_BASIC_urn_un_unece_uncefact_data_standard_QualifiedDataType_100.xsd',
      'basic/Factur-X_1.09_BASIC_urn_un_unece_uncefact_data_standard_ReusableAggregateBusinessInformationEntity_100.xsd',
      'basic/Factur-X_1.09_BASIC_urn_un_unece_uncefact_data_standard_UnqualifiedDataType_100.xsd',
    ],
  },
  'EN 16931': {
    main: 'en16931/Factur-X_EN16931.xsd',
    imports: [
      'en16931/Factur-X_1.09_EN16931_urn_un_unece_uncefact_data_standard_QualifiedDataType_100.xsd',
      'en16931/Factur-X_1.09_EN16931_urn_un_unece_uncefact_data_standard_ReusableAggregateBusinessInformationEntity_100.xsd',
      'en16931/Factur-X_1.09_EN16931_urn_un_unece_uncefact_data_standard_UnqualifiedDataType_100.xsd',
    ],
  },
  EXTENDED: {
    main: 'extended/Factur-X_EXTENDED.xsd',
    imports: [
      'extended/Factur-X_1.09_EXTENDED_urn_un_unece_uncefact_data_standard_QualifiedDataType_100.xsd',
      'extended/Factur-X_1.09.2_EXTENDED_urn_un_unece_uncefact_data_standard_ReusableAggregateBusinessInformationEntity_100.xsd',
      'extended/Factur-X_1.09_EXTENDED_urn_un_unece_uncefact_data_standard_UnqualifiedDataType_100.xsd',
    ],
  },
};

const SCHEMA_DIR = new URL('../../schemas/xsd/', import.meta.url);

function schemaFileName(relativePath: string): string {
  return relativePath.slice(relativePath.lastIndexOf('/') + 1);
}

async function readSchemaFile(relativePath: string): Promise<string> {
  return readFile(fileURLToPath(new URL(relativePath, SCHEMA_DIR)), 'utf-8');
}

async function loadPreload(
  imports: readonly string[],
): Promise<{ fileName: string; contents: string }[]> {
  return Promise.all(
    imports.map(async (relativePath) => ({
      fileName: schemaFileName(relativePath),
      contents: await readSchemaFile(relativePath),
    })),
  );
}

interface LoadedSchema {
  readonly mainContents: string;
  readonly preload: { fileName: string; contents: string }[];
}

// The 4 schema files per profile never change within a process; cache the
// read so validating many invoices in a row doesn't re-read them every call
// — mirrors validate/schematron.ts's xslCache for the same reason. Only 2
// possible keys (the bundled profiles), so an unbounded Map is fine.
const schemaCache = new Map<SchemaBundle, Promise<LoadedSchema>>();

async function loadSchema(bundle: SchemaBundle): Promise<LoadedSchema> {
  const cached = schemaCache.get(bundle);
  if (cached !== undefined) {
    return cached;
  }

  const promise = Promise.all([readSchemaFile(bundle.main), loadPreload(bundle.imports)])
    .then(([mainContents, preload]) => ({ mainContents, preload }))
    .catch((error: unknown) => {
      // Don't cache a failure (e.g. a transient read error) forever.
      schemaCache.delete(bundle);
      throw error;
    });

  schemaCache.set(bundle, promise);
  return promise;
}

// The bare specifier resolves on its own (no execution) iff the package
// itself is present on disk — distinguishes "xmllint-wasm isn't installed"
// from "xmllint-wasm is installed but something inside it (or one of ITS
// dependencies) is broken", which also throws ERR_MODULE_NOT_FOUND/
// MODULE_NOT_FOUND and would otherwise be misreported as the former.
//
// import.meta.resolve was async (returning a Promise) before Node 20.6 and
// is synchronous (returning a string) from 20.6 onward. Checking the return
// type rather than assuming sync keeps this correct on both: an unawaited
// Promise is truthy and would otherwise always report "installed".
function isPackageInstalled(specifier: string): boolean {
  try {
    return typeof import.meta.resolve(specifier) === 'string';
  } catch {
    return false;
  }
}

async function loadValidateXML(): Promise<typeof import('xmllint-wasm').validateXML> {
  try {
    const mod = await import('xmllint-wasm');
    return mod.validateXML;
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    const isNotFound = code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';
    if (isNotFound && !isPackageInstalled('xmllint-wasm')) {
      throw new Error(
        'validateXsd requires the optional dependency "xmllint-wasm". Install it with `npm install xmllint-wasm`.',
        { cause: error },
      );
    }
    // xmllint-wasm IS resolvable (installed, or the failure isn't a missing
    // module at all — WASM instantiation, a sandboxed worker_threads
    // restriction), so reporting "not installed" here would be actively
    // misleading; the real cause travels via `cause`.
    throw new Error('validateXsd failed to load "xmllint-wasm".', { cause: error });
  }
}

/**
 * Validate CII XML against the bundled EN 16931 or EXTENDED XSD.
 *
 * `options.profile` picks the schema; if omitted it is read from
 * `ram:GuidelineSpecifiedDocumentContextParameter/ram:ID` in `xml`, falling
 * back to `'EN 16931'` (a structural superset, so it's still a meaningful
 * check on a document from an unrecognized profile). Throws
 * `FacturXXsdNotBundledError` for a profile whose XSD isn't bundled
 * (`BASIC`, `BASIC WL`, `MINIMUM`).
 */
export async function validateXsd(
  xml: string,
  options: XsdValidationOptions = {},
): Promise<XsdValidationResult> {
  const stripped = stripBom(xml);

  if (hasDoctype(stripped)) {
    return {
      valid: false,
      errors: [{ message: 'DOCTYPE declarations are not allowed (XXE / entity-expansion risk).' }],
    };
  }

  const profile = resolveProfile(stripped, options.profile, 'EN 16931');
  const bundle = SCHEMAS[profile];
  if (bundle === undefined) {
    throw new FacturXXsdNotBundledError(profile);
  }

  const [validateXML, { mainContents, preload }] = await Promise.all([
    loadValidateXML(),
    loadSchema(bundle),
  ]);

  const result = await validateXML({
    xml: [{ fileName: 'invoice.xml', contents: stripped }],
    schema: [mainContents],
    preload,
  });

  return {
    valid: result.valid,
    errors: result.errors.map(xsdErrorOf),
  };
}

function xsdErrorOf(error: {
  readonly message: string;
  readonly rawMessage: string;
  readonly loc: { readonly fileName: string; readonly lineNumber: number } | null;
}): XsdValidationError {
  return {
    message: error.message,
    rawMessage: error.rawMessage,
    ...(error.loc !== null ? { location: error.loc } : {}),
  };
}
