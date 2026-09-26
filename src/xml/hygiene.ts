// src/xml/hygiene.ts
// Input hygiene for untrusted XML, shared by every reader in the library:
// the validators, the deserializer, the header sniffer and the XMP reader.
// A DOCTYPE is refused wherever XML enters, never expanded: fast-xml-parser
// processes internal entity declarations, so an unguarded reader is an
// entity-expansion vector on third-party invoices.

export function stripBom(xml: string): string {
  return xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
}

// A real XML DOCTYPE can only appear in the prolog, before the root element,
// preceded only by whitespace, the XML declaration, comments or processing
// instructions. Scanning only that prefix — rather than testing "<!DOCTYPE"
// against the whole document — avoids flagging a legitimate document whose
// text content happens to contain that literal substring (e.g. a free-text
// note field used as an XML-authoring example).
export function hasDoctype(xml: string): boolean {
  let i = 0;
  const len = xml.length;
  for (;;) {
    while (i < len && /\s/.test(xml.charAt(i))) i++;
    if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i);
      if (end === -1) return false;
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i);
      if (end === -1) return false;
      i = end + 3;
      continue;
    }
    // Case-insensitive: strict XML requires the uppercase keyword, but this
    // is a defense-in-depth XXE pre-filter meant to reject anything a
    // downstream processor might still treat as a doctype declaration in
    // lenient/recovery mode — matching only the strict-case form would let a
    // miscased "<!doctype" straight through to that processor. Safe to do
    // here: this position is only ever reached by whitespace, an XML
    // declaration, comments or processing instructions (per the loop above),
    // never document body text, so there is no free-text false-positive risk
    // the way a whole-document substring search would have.
    return /^<!doctype/i.test(xml.slice(i, i + 9));
  }
}
