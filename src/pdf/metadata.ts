// src/pdf/metadata.ts
// XMP packet: standard PDF/A-3 schemas (pdfaid, dc, pdf, xmp, xmpMM) + Factur-X extension schema.

import type { Profile } from '../types/profiles.js';

export interface XmpMetadataOptions {
  readonly conformanceLevel: Profile;
  readonly documentIdHex: string;
  readonly title: string;
  readonly creationDate: Date;
}

export function buildXmpMetadata(options: XmpMetadataOptions): string {
  const { conformanceLevel, documentIdHex, title, creationDate } = options;
  const createDateIso = creationDate.toISOString();
  const documentIdUri = `uuid:${toUuid(documentIdHex)}`;

  return (
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">` +
    `<pdfaid:part>3</pdfaid:part>` +
    `<pdfaid:conformance>B</pdfaid:conformance>` +
    `</rdf:Description>` +
    `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(title)}</rdf:li></rdf:Alt></dc:title>` +
    `</rdf:Description>` +
    `<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">` +
    `<pdf:Producer>factur-x-ts</pdf:Producer>` +
    `</rdf:Description>` +
    `<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">` +
    `<xmp:CreatorTool>factur-x-ts</xmp:CreatorTool>` +
    `<xmp:CreateDate>${createDateIso}</xmp:CreateDate>` +
    `<xmp:ModifyDate>${createDateIso}</xmp:ModifyDate>` +
    `</rdf:Description>` +
    `<rdf:Description rdf:about="" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/">` +
    `<xmpMM:DocumentID>${documentIdUri}</xmpMM:DocumentID>` +
    `</rdf:Description>` +
    `<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">` +
    `<fx:DocumentType>INVOICE</fx:DocumentType>` +
    `<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>` +
    `<fx:Version>1.07</fx:Version>` +
    `<fx:ConformanceLevel>${xmlEscape(conformanceLevel)}</fx:ConformanceLevel>` +
    `</rdf:Description>` +
    `<rdf:Description rdf:about="" ` +
    `xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" ` +
    `xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" ` +
    `xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">` +
    `<pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource">` +
    `<pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>` +
    `<pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>` +
    `<pdfaSchema:prefix>fx</pdfaSchema:prefix>` +
    `<pdfaSchema:property><rdf:Seq>` +
    fxPropertyEntry('DocumentFileName', 'name of the embedded XML invoice file') +
    fxPropertyEntry('DocumentType', 'INVOICE') +
    fxPropertyEntry('Version', 'version of the Factur-X/ZUGFeRD data') +
    fxPropertyEntry('ConformanceLevel', 'conformance level of the Factur-X/ZUGFeRD data') +
    `</rdf:Seq></pdfaSchema:property>` +
    `</rdf:li></rdf:Bag></pdfaExtension:schemas>` +
    `</rdf:Description>` +
    `</rdf:RDF>` +
    `</x:xmpmeta>` +
    `<?xpacket end="w"?>`
  );
}

function fxPropertyEntry(name: string, description: string): string {
  return (
    `<rdf:li rdf:parseType="Resource">` +
    `<pdfaProperty:name>${name}</pdfaProperty:name>` +
    `<pdfaProperty:valueType>Text</pdfaProperty:valueType>` +
    `<pdfaProperty:category>external</pdfaProperty:category>` +
    `<pdfaProperty:description>${xmlEscape(description)}</pdfaProperty:description>` +
    `</rdf:li>`
  );
}

function toUuid(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
