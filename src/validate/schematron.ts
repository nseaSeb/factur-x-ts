// src/validate/schematron.ts
// Validate CII XML against the EN 16931 / EXTENDED Schematron business rules.
//
// The Schematron compiles to XSLT 2.0, which Node cannot run in-process (no
// native XSLT2 engine). Like the Python akretion/factur-x library — and the
// Elixir sibling factur-x-ts is modelled on — we delegate to a Saxon server
// over HTTP. The same docker/compose.yml Saxon container can serve both
// libraries. The compiled Schematron XSLT ships under schemas/schematron/
// (see schemas/NOTICE.md for provenance and licensing).
//
// Run a Saxon server (e.g. `docker compose -f docker/compose.yml up -d`,
// or ghcr.io/willemvlh/saxon-server directly) and point `options.endpoint`
// at its `/transform` route.
//
// > Privacy: a public Saxon endpoint means sending real invoice data to a
// > third party. Self-host in production.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import type { Profile } from '../types/profiles.js';
import type {
  SchematronValidationOptions,
  SchematronValidationResult,
  SchematronViolation,
} from '../types/schematron.js';
import { hasDoctype, resolveProfile, stripBom } from './shared.js';

export class FacturXSchematronNotBundledError extends Error {
  constructor(profile: Profile) {
    super(
      `No bundled Schematron for profile "${profile}". Only "EN 16931" and "EXTENDED" ship with factur-x-ts.`,
    );
    this.name = 'FacturXSchematronNotBundledError';
  }
}

// Anything that stops us getting a real SVRL report back from Saxon: the
// server unreachable, a non-2xx response, or a 200 OK body that isn't SVRL
// (a misconfigured proxy, a Saxon fault page, an empty body). Distinct from
// FacturXSchematronNotBundledError so callers can tell "this profile has no
// rule set" apart from "the validation infrastructure failed" — the latter
// must never be swallowed into a silent valid:true.
export class FacturXSaxonError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'FacturXSaxonError';
  }
}

interface SchematronBundle {
  readonly xsl: string;
  readonly codedbFile: string;
  readonly defaultCodedbUrl: string;
}

// Only EN 16931 and EXTENDED ship their Schematron — mirrors the Elixir
// sibling, which errors on the rest rather than silently falling back.
const SCHEMATRON: Partial<Record<Profile, SchematronBundle>> = {
  'EN 16931': {
    xsl: 'en16931/Factur-X_1.09_EN16931.xsl',
    codedbFile: 'FACTUR-X_EN16931_codedb.xml',
    defaultCodedbUrl:
      'https://raw.githubusercontent.com/akretion/factur-x/refs/heads/master/src/facturx/xsd_and_schematron/facturx-en16931/FACTUR-X_EN16931_codedb.xml',
  },
  EXTENDED: {
    xsl: 'extended/Factur-X_1.09_EXTENDED.xsl',
    codedbFile: 'FACTUR-X_EXTENDED_codedb.xml',
    defaultCodedbUrl:
      'https://raw.githubusercontent.com/akretion/factur-x/refs/heads/master/src/facturx/xsd_and_schematron/facturx-extended/FACTUR-X_EXTENDED_codedb.xml',
  },
};

const SCHEMATRON_DIR = new URL('../../schemas/schematron/', import.meta.url);
const DEFAULT_ENDPOINT = 'http://localhost:5000/transform';
const DEFAULT_TIMEOUT_MS = 20_000;

// SVRL severities that don't make a document invalid. Anything else —
// including an absent flag — counts as an error: defaulting to "invalid" is
// the safe direction. PEPPOL-EN16931-R008 ("no empty elements") is flagged
// "warning" and fires on every conformant invoice with no delivery data,
// since CII still requires an empty ram:ApplicableHeaderTradeDelivery.
const WARNING_FLAGS = new Set(['warning', 'info']);

// The XSL is 640KB-1.8MB and rewriting the codedb URL into it is an O(file
// size) copy; cache the resolved text per (bundle, codedbUrl) so validating
// many invoices in a row doesn't re-read and re-rewrite it every call. Small,
// bounded key space (2 bundles, each keyed by whatever distinct codedbUrl
// values a process actually uses), so an unbounded nested Map is fine —
// nothing to evict.
const xslCache = new Map<string, Map<string, Promise<string>>>();

async function loadXsl(bundle: SchematronBundle, codedbUrl: string | undefined): Promise<string> {
  const resolvedCodedbUrl = codedbUrl ?? bundle.defaultCodedbUrl;

  let byCodedbUrl = xslCache.get(bundle.xsl);
  if (byCodedbUrl === undefined) {
    byCodedbUrl = new Map();
    xslCache.set(bundle.xsl, byCodedbUrl);
  }

  const cached = byCodedbUrl.get(resolvedCodedbUrl);
  if (cached !== undefined) {
    return cached;
  }

  const cacheForThisBundle = byCodedbUrl;
  const promise = (async () => {
    const path = fileURLToPath(new URL(bundle.xsl, SCHEMATRON_DIR));
    const xsl = await readFile(path, 'utf-8');
    // The XSLT resolves the code-list DB via document('<filename>'); point it
    // at a URL the Saxon server can fetch (matches the Python reference
    // library). Passing codedbUrl: 'file:///opt/facturx/...' (the path baked
    // into docker/Dockerfile) is what actually keeps validation offline —
    // the default above is a live, unpinned GitHub URL.
    return xsl.split(bundle.codedbFile).join(resolvedCodedbUrl);
  })().catch((error: unknown) => {
    // Don't cache a failure (e.g. a transient read error) forever.
    cacheForThisBundle.delete(resolvedCodedbUrl);
    throw error;
  });

  byCodedbUrl.set(resolvedCodedbUrl, promise);
  return promise;
}

async function resolveXsl(xml: string, options: SchematronValidationOptions): Promise<string> {
  if (options.xsl !== undefined) {
    return options.xsl;
  }

  // No fallback profile here (unlike validateXsd): a wrong guess produces a
  // misleading pass/fail against the wrong profile's business rules, so an
  // undetectable profile must throw rather than silently pick EN 16931.
  const profile = resolveProfile(xml, options.profile);
  const bundle = SCHEMATRON[profile];
  if (bundle === undefined) {
    throw new FacturXSchematronNotBundledError(profile);
  }

  return loadXsl(bundle, options.codedbUrl);
}

async function postToSaxon(
  endpoint: string,
  xml: string,
  xsl: string,
  timeoutMs: number,
): Promise<string> {
  const form = new FormData();
  form.set('xml', new Blob([xml], { type: 'text/xml' }), 'file_to_check.xml');
  form.set('xsl', new Blob([xsl], { type: 'text/xml' }), 'schematron.xsl');

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new FacturXSaxonError(`Saxon server unreachable at ${endpoint}: ${message}`, { cause: error });
  }

  if (!response.ok) {
    throw new FacturXSaxonError(`Saxon server returned HTTP ${response.status} for ${endpoint}`);
  }

  return response.text();
}

// --- SVRL interpretation ---------------------------------------------------
// Findings (svrl:failed-assert / svrl:successful-report) are flat children of
// the root svrl:schematron-output per the ISO SVRL schema.

interface SvrlFinding {
  readonly '@_flag'?: string;
  readonly '@_location'?: string;
  readonly '@_test'?: string;
  readonly text?: string;
}

interface ParsedSvrl {
  readonly 'schematron-output'?: {
    readonly 'failed-assert'?: SvrlFinding | SvrlFinding[];
    readonly 'successful-report'?: SvrlFinding | SvrlFinding[];
  };
}

function asFindingArray(value: SvrlFinding | SvrlFinding[] | undefined): SvrlFinding[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function violationOf(node: SvrlFinding): SchematronViolation {
  const violation: {
    message?: string;
    location?: string;
    test?: string;
    flag?: string;
  } = {};
  if (node.text !== undefined) violation.message = node.text;
  if (node['@_location'] !== undefined) violation.location = node['@_location'];
  if (node['@_test'] !== undefined) violation.test = node['@_test'];
  if (node['@_flag'] !== undefined) violation.flag = node['@_flag'];
  return violation;
}

export function parseSvrl(svrl: string): SchematronViolation[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
    ignoreDeclaration: true,
    isArray: (tagName) => tagName === 'failed-assert' || tagName === 'successful-report',
  });

  const parsed = parser.parse(svrl) as ParsedSvrl;
  const output = parsed['schematron-output'];
  if (output === undefined) {
    // A 200 OK body that isn't actually an SVRL report (a misconfigured
    // endpoint, a Saxon fault page, an empty body) must not read as "zero
    // violations found" — that would silently report valid: true for a
    // document that was never actually checked.
    throw new FacturXSaxonError(
      'Saxon server response is not an SVRL report (missing schematron-output root element).',
    );
  }
  return [
    ...asFindingArray(output['failed-assert']),
    ...asFindingArray(output['successful-report']),
  ].map(violationOf);
}

/**
 * Validate CII XML against the EN 16931 / EXTENDED Schematron business rules,
 * via a Saxon server (see the module doc for why this can't run in-process).
 *
 * Throws `FacturXSchematronNotBundledError` for a profile whose Schematron
 * isn't bundled (`BASIC`, `BASIC WL`, `MINIMUM`) unless `options.xsl` supplies
 * one directly, `FacturXProfileNotDetectedError` if the profile is omitted
 * and can't be detected, and `FacturXSaxonError` for anything that stops a
 * real SVRL report coming back from Saxon.
 */
export async function validateSchematron(
  xml: string,
  options: SchematronValidationOptions = {},
): Promise<SchematronValidationResult> {
  const stripped = stripBom(xml);

  if (hasDoctype(stripped)) {
    return {
      valid: false,
      errors: [{ message: 'DOCTYPE declarations are not allowed (XXE / entity-expansion risk).' }],
      warnings: [],
    };
  }

  const xsl = await resolveXsl(stripped, options);
  const svrl = await postToSaxon(
    options.endpoint ?? DEFAULT_ENDPOINT,
    stripped,
    xsl,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  const violations = parseSvrl(svrl);
  const errors = violations.filter((v) => v.flag === undefined || !WARNING_FLAGS.has(v.flag));
  const warnings = violations.filter((v) => v.flag !== undefined && WARNING_FLAGS.has(v.flag));

  return { valid: errors.length === 0, errors, warnings };
}
