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
import type { XsdValidationOptions, XsdValidationResult } from '../types/xsd.js';
import { detectProfile } from '../xml/guideline.js';

export class FacturXXsdNotBundledError extends Error {
  constructor(profile: Profile) {
    super(
      `No bundled XSD schema for profile "${profile}". Only "EN 16931" and "EXTENDED" ship with factur-x-ts.`,
    );
    this.name = 'FacturXXsdNotBundledError';
  }
}

interface SchemaBundle {
  readonly main: string;
  readonly imports: readonly string[];
}

// Only EN 16931 and EXTENDED ship their XSD — mirrors the Elixir sibling
// library, which bundles the same two and errors on the rest rather than
// silently falling back to EN 16931.
const SCHEMAS: Partial<Record<Profile, SchemaBundle>> = {
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

// Input is untrusted: reject a DOCTYPE outright rather than rely on the
// validator's own defaults, so the no-XXE / no-entity-expansion guarantee is
// ours regardless of how xmllint-wasm is configured.
const DOCTYPE_RE = /<!DOCTYPE/i;

function stripBom(xml: string): string {
  return xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
}

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

async function loadValidateXML(): Promise<typeof import('xmllint-wasm').validateXML> {
  try {
    const mod = await import('xmllint-wasm');
    return mod.validateXML;
  } catch {
    throw new Error(
      'validateXsd requires the optional dependency "xmllint-wasm". Install it with `npm install xmllint-wasm`.',
    );
  }
}

/**
 * Validate CII XML against the bundled EN 16931 or EXTENDED XSD.
 *
 * `options.profile` picks the schema; if omitted it is read from
 * `ram:GuidelineSpecifiedDocumentContextParameter/ram:ID` in `xml`, falling
 * back to `'EN 16931'`. Throws `FacturXXsdNotBundledError` for a profile
 * whose XSD isn't bundled (`BASIC`, `BASIC WL`, `MINIMUM`).
 */
export async function validateXsd(
  xml: string,
  options: XsdValidationOptions = {},
): Promise<XsdValidationResult> {
  const stripped = stripBom(xml);

  if (DOCTYPE_RE.test(stripped)) {
    return {
      valid: false,
      errors: [{ message: 'DOCTYPE declarations are not allowed (XXE / entity-expansion risk).' }],
    };
  }

  const profile = options.profile ?? detectProfile(stripped) ?? 'EN 16931';
  const bundle = SCHEMAS[profile];
  if (bundle === undefined) {
    throw new FacturXXsdNotBundledError(profile);
  }

  const [validateXML, mainContents, preload] = await Promise.all([
    loadValidateXML(),
    readSchemaFile(bundle.main),
    loadPreload(bundle.imports),
  ]);

  const result = await validateXML({
    xml: [{ fileName: 'invoice.xml', contents: stripped }],
    schema: [mainContents],
    preload,
  });

  return {
    valid: result.valid,
    errors: result.errors.map((error) => ({ message: error.message })),
  };
}
